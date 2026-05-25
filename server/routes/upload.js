/**
 * upload.js
 * Purpose: File upload endpoint + analysis pipeline (parse → LLM → save)
 * Author: TraceLens
 */

const express = require('express');
const fs = require('fs');
const crypto = require('crypto');
const { parseTraceFile, buildLlmPrompt } = require('../parser/streamParser');
const { sendMessage, sendToAnthropic } = require('../ai/llmClient');
const { PS_SYSTEM_PROMPT } = require('../ai/psSystemPrompt');
const { buildLlmContext } = require('../db/sqliteReader');
const { activeProvider } = require('../ai/llmConfig');
const { saveAnalysis } = require('../db/database');

/**
 * Create the upload router.
 * @param {object} deps - Shared dependencies
 * @param {function} deps.getSessionByToken
 * @param {function} deps.wsSessionSend
 * @param {function} deps.sonnetCacheGet
 * @param {function} deps.sonnetCacheSet
 * @param {object} deps.upload - Multer instance
 * @param {function} deps.uploadLimiter
 * @param {function} deps.validateFileType
 */
function createUploadRouter(deps) {
  const router = express.Router();
  const {
    getSessionByToken, wsSessionSend,
    sonnetCacheGet, sonnetCacheSet,
    upload, uploadLimiter, validateFileType
  } = deps;

  router.post('/', uploadLimiter, upload.single('traceFile'), validateFileType, async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = req.file.path;
    const fileName = req.file.originalname;
    const fileSize = req.file.size;
    const userApiKey = req.headers['x-user-api-key'] || null;

    const sessionToken = req.headers['x-session-token'];
    const session = sessionToken ? getSessionByToken(sessionToken) : null;

    if (!session) {
      return res.status(400).json({ error: 'Invalid or missing session token. Connect via WebSocket first.' });
    }

    console.log(`[Upload] ${fileName} (${(fileSize / 1024 / 1024).toFixed(1)}MB) session=${sessionToken.substring(0, 8)}${userApiKey ? ' [user Anthropic key]' : ''}`);
    res.json({ status: 'processing', fileName, fileSize });

    const send = (data) => wsSessionSend(sessionToken, data);

    try {
      send({ type: 'status', status: 'parsing' });

      const parseResults = await parseTraceFile(
        filePath,
        (progress) => { send({ type: 'progress', ...progress }); },
        (metadata) => { send({ type: 'metadata', data: metadata }); }
      );

      send({ type: 'partial', section: 'summary', data: parseResults.summary });
      send({ type: 'partial', section: 'sql', data: parseResults.sql });
      send({ type: 'partial', section: 'loops', data: parseResults.loops });
      send({ type: 'partial', section: 'events', data: parseResults.events });
      send({ type: 'partial', section: 'errors', data: parseResults.errors });
      send({ type: 'partial', section: 'variables', data: parseResults.variables });

      send({ type: 'status', status: 'analyzing' });

      session.parseResults = parseResults;
      session.analysisId = null;

      if (userApiKey) {
        send({ type: 'auto-analysis-start' });

        const context = buildLlmContext(null, ['trace_meta', 'trace_events', 'trace_sql', 'trace_errors', 'trace_fields'], parseResults);
        const autoPrompt = `Analyze this PeopleSoft trace file and provide a full diagnostic.\n\n${context}`;

        const contextHash = crypto.createHash('sha256').update(context).digest('hex');
        const cachedResult = sonnetCacheGet(contextHash);

        if (cachedResult) {
          console.log(`[Sonnet Cache] Hit for hash ${contextHash.substring(0, 8)} — skipping LLM call`);
          session.llmResponse = cachedResult.text;
          send({ type: 'llm-done', analysis: cachedResult.analysis });
          send({ type: 'auto-analysis-done', text: cachedResult.text, analysis: cachedResult.analysis, cached: true });
          saveAndSend(send, session, fileName, fileSize, cachedResult.analysis, parseResults, 'anthropic/sonnet (cached)');
        } else {
          let fullAnalysisText = '';

          await sendToAnthropic(
            autoPrompt,
            PS_SYSTEM_PROMPT,
            'claude-sonnet-4-6',
            userApiKey,
            (token) => {
              fullAnalysisText += token;
              send({ type: 'llm-token', token });
            },
            (fullText) => {
              fullAnalysisText = fullText;
              const analysis = buildAnalysisFromText(fullText);
              session.llmResponse = fullText;

              sonnetCacheSet(contextHash, { text: fullText, analysis });

              send({ type: 'llm-done', analysis });
              send({ type: 'auto-analysis-done', text: fullText, analysis, cached: false });

              saveAndSend(send, session, fileName, fileSize, analysis, parseResults, 'anthropic/sonnet');
            },
            (err) => {
              console.error('[Sonnet Error]', err.message);
              send({ type: 'llm-error', message: err.message });
              runGroqBasicAnalysis(send, session, parseResults, fileName, fileSize);
            }
          );
        }

      } else {
        await runGroqBasicAnalysis(send, session, parseResults, fileName, fileSize);
      }

      fs.unlink(filePath, (err) => {
        if (err) console.error('[Cleanup] Failed to delete:', err.message);
      });

    } catch (err) {
      console.error('[Pipeline Error]', err);
      send({ type: 'error', message: `Analysis failed: ${err.message}` });
      fs.unlink(filePath, () => {});
    }
  });

  return router;
}

/**
 * Run Groq-based basic analysis (no Anthropic key needed).
 */
async function runGroqBasicAnalysis(send, session, parseResults, fileName, fileSize) {
  const llmPrompt = buildLlmPrompt(parseResults);
  session.llmPrompt = llmPrompt;

  await sendMessage(
    llmPrompt,
    null,
    (token) => send({ type: 'llm-token', token }),
    (fullText) => {
      const analysis = buildAnalysisFromText(fullText);
      session.llmResponse = fullText;

      send({ type: 'llm-done', analysis });
      send({
        type: 'auto-analysis-done',
        analysis,
        cached: false,
        upgradePrompt: true
      });

      saveAndSend(send, session, fileName, fileSize, analysis, parseResults, activeProvider.name || 'groq');
    },
    (err) => {
      console.error('[LLM Error]', err.message);
      send({ type: 'llm-error', message: err.message });
    }
  );
}

/**
 * Parse LLM response text into structured analysis object.
 */
function buildAnalysisFromText(fullText) {
  let health = 'fair';
  const healthMatch = fullText.match(/\b(CRITICAL|POOR|FAIR|GOOD)\b/i);
  if (healthMatch) health = healthMatch[1].toLowerCase();

  let topRecommendation = '';
  const recMatch = fullText.match(/Top Recommend[\s\S]*?\n\s*1[\.\)]\s*(.+)/i);
  if (recMatch) topRecommendation = recMatch[1].trim().substring(0, 200);

  const fixes = [];
  const fixSections = fullText.split(/(?=###?\s*(?:Fix|Performance Fix|\d+\.))/i);
  for (const section of fixSections) {
    const titleMatch = section.match(/###?\s*(?:Fix\s*\d*[:\.]?\s*)?(.+)/i);
    const beforeMatch = section.match(/BEFORE[\s\S]*?```[\w]*\n([\s\S]*?)```/i);
    const afterMatch = section.match(/AFTER[\s\S]*?```[\w]*\n([\s\S]*?)```/i);
    if (titleMatch && beforeMatch && afterMatch) {
      fixes.push({
        title: titleMatch[1].trim().substring(0, 100),
        impact: /high/i.test(section) ? 'HIGH' : /medium/i.test(section) ? 'MEDIUM' : 'LOW',
        before: beforeMatch[1].trim(),
        after: afterMatch[1].trim()
      });
    }
  }

  return { summary: fullText, health, topRecommendation, fixes };
}

/**
 * Save analysis to SQLite and send history-saved event to session.
 */
function saveAndSend(send, session, fileName, fileSize, analysis, parseResults, providerLabel) {
  try {
    const savedId = saveAnalysis(
      {
        filename:          fileName,
        filesize:          fileSize,
        overallHealth:     analysis.health,
        summary:           analysis.summary.substring(0, 2000),
        totalLines:        parseResults.summary?.totalLines || 0,
        totalSql:          parseResults.sql?.sqlStats?.totalStatements || 0,
        slowQueries:       parseResults.sql?.sqlStats?.slowQueryCount || 0,
        errorCount:        parseResults.errors?.errorStats?.total || 0,
        loopCount:         parseResults.loops?.loopCount || 0,
        processCount:      parseResults.summary?.processCount || 1,
        topRecommendation: analysis.topRecommendation,
        llmProvider:       providerLabel,
        llmModel:          'auto'
      },
      {
        summary:   parseResults.summary,
        sql:       parseResults.sql,
        loops:     parseResults.loops,
        events:    parseResults.events,
        errors:    parseResults.errors,
        variables: parseResults.variables
      }
    );
    session.analysisId = savedId;
    send({ type: 'history-saved', id: savedId });
    console.log(`[History] Saved analysis #${savedId} for ${fileName}`);
  } catch (dbErr) {
    console.error('[History] Failed to save analysis:', dbErr.message);
  }
}

module.exports = createUploadRouter;
