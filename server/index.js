/**
 * index.js
 * Purpose: Express + WebSocket server, file upload endpoint, orchestrates parse → LLM pipeline
 * Author: TraceLens
 */

require('dotenv').config();

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const {
  helmet, cors, corsOptions,
  uploadLimiter, apiLimiter,
  productionErrorHandler, validateFileType,
  apiKeyAuth,
  isDev
} = require('./middleware/security');

const { parseTraceFile, buildLlmPrompt } = require('./parser/streamParser');
const { sendMessage, sendChatMessage, sendToAnthropic, sendAnthropicChat, SYSTEM_PROMPT } = require('./ai/llmClient');
const { PS_SYSTEM_PROMPT, PS_SYSTEM_PROMPT_SLIM } = require('./ai/psSystemPrompt');
const { routeQuery, TRIGGER } = require('./ai/router');
const { buildLlmContext, checkAnalysisCache } = require('./db/sqliteReader');
const llmHealthRouter = require('./ai/llmHealth');
const historyRouter = require('./routes/history');
const { activeProvider } = require('./ai/llmConfig');
const { saveAnalysis } = require('./db/database');
const crypto = require('crypto');

// ── Per-session state ──
// Each WebSocket connection gets its own session keyed by a random token.
// Upload responses include the token so the client can associate its WS.
const sessions = new Map(); // sessionToken → { ws, parseResults, llmResponse, analysisId, llmPrompt }

function getOrCreateSession(ws) {
  if (ws.__sessionToken && sessions.has(ws.__sessionToken)) {
    return sessions.get(ws.__sessionToken);
  }
  const token = crypto.randomUUID();
  ws.__sessionToken = token;
  const session = { ws, parseResults: null, llmResponse: null, analysisId: null, llmPrompt: null };
  sessions.set(token, session);
  return session;
}

function getSessionByToken(token) {
  return sessions.get(token) || null;
}

// ── LRU cache for Sonnet auto-analysis ──
const SONNET_CACHE_MAX = parseInt(process.env.SONNET_CACHE_MAX || '50');
const SONNET_CACHE_TTL_MS = parseInt(process.env.SONNET_CACHE_TTL_MINS || '60') * 60 * 1000;
const sonnetAutoCache = new Map(); // context hash → { text, analysis, createdAt }

function sonnetCacheGet(hash) {
  const entry = sonnetAutoCache.get(hash);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > SONNET_CACHE_TTL_MS) {
    sonnetAutoCache.delete(hash);
    return null;
  }
  return entry;
}

function sonnetCacheSet(hash, data) {
  // Evict oldest if at capacity
  if (sonnetAutoCache.size >= SONNET_CACHE_MAX) {
    const oldestKey = sonnetAutoCache.keys().next().value;
    sonnetAutoCache.delete(oldestKey);
  }
  sonnetAutoCache.set(hash, { ...data, createdAt: Date.now() });
}

const PORT = parseInt(process.env.PORT) || 3000;
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE_MB || '1024') * 1024 * 1024;

// ── Express setup ──
const app = express();
app.use(helmet());
app.use(cors(corsOptions));
app.use(express.json({ limit: '10kb' }));
app.use('/api', apiLimiter);
app.use('/api', apiKeyAuth);

// LLM health endpoint
app.use('/api/llm', llmHealthRouter);

// Analysis history endpoints
app.use('/api/history', historyRouter);

// Anthropic key validation endpoint
app.post('/api/llm/validate-anthropic', async (req, res) => {
  const userKey = req.headers['x-user-api-key'];
  if (!userKey || !userKey.startsWith('sk-ant-')) {
    return res.status(400).json({ valid: false, error: 'Invalid key format' });
  }

  // Make minimal Anthropic API call to validate key
  const { request: httpsRequest } = require('https');
  const body = JSON.stringify({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 10,
    messages: [{ role: 'user', content: 'hi' }]
  });

  const reqOptions = {
    hostname: 'api.anthropic.com',
    port: 443,
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': userKey,
      'anthropic-version': '2023-06-01',
      'Content-Length': Buffer.byteLength(body)
    }
  };

  const testReq = httpsRequest(reqOptions, (testRes) => {
    res.json({ valid: testRes.statusCode === 200 });
    testRes.resume();
  });

  testReq.on('error', () => res.json({ valid: false }));
  testReq.setTimeout(10000, () => { testReq.destroy(); res.json({ valid: false }); });
  testReq.write(body);
  testReq.end();
});

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Multer config: disk storage, max file size
const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    cb(null, `${unique}-${file.originalname}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    const allowed = ['.trc', '.tracesql', '.log', '.txt'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type: ${ext}. Allowed: ${allowed.join(', ')}`));
    }
  }
});

// ── HTTP server + WebSocket ──
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Track active WebSocket connections
const clients = new Set();

wss.on('connection', (ws, req) => {
  // Authenticate WS via session token in query string
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get('token');

  if (token && sessions.has(token)) {
    // Re-associate existing session with new WS
    const session = sessions.get(token);
    session.ws = ws;
    ws.__sessionToken = token;
  } else {
    // Create a new session for this connection
    getOrCreateSession(ws);
  }

  clients.add(ws);
  // Send the session token to the client so it can use it for uploads
  wsSend(ws, { type: 'session', token: ws.__sessionToken });
  console.log(`[WS] Client connected (${clients.size} total) session=${ws.__sessionToken.substring(0, 8)}`);

  ws.on('close', () => {
    clients.delete(ws);
    // Clean up session after disconnect
    if (ws.__sessionToken) {
      sessions.delete(ws.__sessionToken);
    }
    console.log(`[WS] Client disconnected (${clients.size} total)`);
  });

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'chat') {
        handleChat(ws, msg);
      }
    } catch (err) {
      wsSend(ws, { type: 'error', message: 'Invalid message format' });
    }
  });
});

/**
 * Send a JSON message to a WebSocket client.
 */
function wsSend(ws, data) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(data));
  }
}

/**
 * Send to a specific session's WebSocket client.
 * Falls back to broadcast only if no session ws is available (should not happen).
 */
function wsSessionSend(sessionToken, data) {
  const session = sessions.get(sessionToken);
  if (session && session.ws && session.ws.readyState === 1) {
    session.ws.send(JSON.stringify(data));
  }
}

// ── File upload + analysis pipeline ──
app.post('/api/upload', uploadLimiter, upload.single('traceFile'), validateFileType, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const filePath = req.file.path;
  const fileName = req.file.originalname;
  const fileSize = req.file.size;

  // User Anthropic key from header — never log the value
  const userApiKey = req.headers['x-user-api-key'] || null;

  // Associate upload with a session via X-Session-Token header
  const sessionToken = req.headers['x-session-token'];
  const session = sessionToken ? getSessionByToken(sessionToken) : null;

  if (!session) {
    return res.status(400).json({ error: 'Invalid or missing session token. Connect via WebSocket first.' });
  }

  console.log(`[Upload] ${fileName} (${(fileSize / 1024 / 1024).toFixed(1)}MB) session=${sessionToken.substring(0, 8)}${userApiKey ? ' [user Anthropic key]' : ''}`);
  res.json({ status: 'processing', fileName, fileSize });

  // Helper to send to this session only
  const send = (data) => wsSessionSend(sessionToken, data);

  // Start analysis pipeline
  try {
    // Phase 1: Parse the trace file
    send({ type: 'status', status: 'parsing' });

    const parseResults = await parseTraceFile(
      filePath,
      (progress) => { send({ type: 'progress', ...progress }); },
      (metadata) => { send({ type: 'metadata', data: metadata }); }
    );

    // Send parse results section by section
    send({ type: 'partial', section: 'summary', data: parseResults.summary });
    send({ type: 'partial', section: 'sql', data: parseResults.sql });
    send({ type: 'partial', section: 'loops', data: parseResults.loops });
    send({ type: 'partial', section: 'events', data: parseResults.events });
    send({ type: 'partial', section: 'errors', data: parseResults.errors });
    send({ type: 'partial', section: 'variables', data: parseResults.variables });

    // Phase 2: Auto analysis — route based on whether user has Anthropic key
    send({ type: 'status', status: 'analyzing' });

    // Store parse results in per-session state
    session.parseResults = parseResults;
    session.analysisId = null;

    if (userApiKey) {
      // User has Anthropic key — use Sonnet for deep auto-analysis
      send({ type: 'auto-analysis-start' });

      const context = buildLlmContext(null, ['trace_meta', 'trace_events', 'trace_sql', 'trace_errors', 'trace_fields'], parseResults);
      const autoPrompt = `Analyze this PeopleSoft trace file and provide a full diagnostic.\n\n${context}`;

      // Check LRU cache by context hash — avoids re-billing Sonnet for duplicate uploads
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

            // Store in LRU cache for subsequent uploads of the same trace
            sonnetCacheSet(contextHash, { text: fullText, analysis });

            send({ type: 'llm-done', analysis });
            send({ type: 'auto-analysis-done', text: fullText, analysis, cached: false });

            saveAndSend(send, session, fileName, fileSize, analysis, parseResults, 'anthropic/sonnet');
          },
          (err) => {
            console.error('[Sonnet Error]', err.message);
            send({ type: 'llm-error', message: err.message });
            // Fall through to Groq basic analysis
            runGroqBasicAnalysis(send, session, parseResults, fileName, fileSize);
          }
        );
      }

    } else {
      // No user Anthropic key — run Groq basic analysis
      await runGroqBasicAnalysis(send, session, parseResults, fileName, fileSize);
    }

    // Cleanup uploaded file
    fs.unlink(filePath, (err) => {
      if (err) console.error('[Cleanup] Failed to delete:', err.message);
    });

  } catch (err) {
    console.error('[Pipeline Error]', err);
    send({ type: 'error', message: `Analysis failed: ${err.message}` });
    fs.unlink(filePath, () => {});
  }
});

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
        upgradePrompt: true  // tells UI to show Anthropic key prompt
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

// ── Chat handler ──
async function handleChat(ws, msg) {
  const { question, history, userApiKey } = msg;

  // Route query to determine provider
  const isSlash = (question || '').trim().startsWith('/');
  const route = routeQuery({
    query: question,
    triggerType: isSlash ? TRIGGER.SLASH_COMMAND : TRIGGER.FREE_TEXT
  });

  // If Anthropic route but no user key — send key-required event so UI renders upgrade card
  if (route.provider === 'anthropic' && !userApiKey) {
    wsSend(ws, { type: 'key-required' });
    return;
  }

  // Get session state for this WS connection
  const session = ws.__sessionToken ? sessions.get(ws.__sessionToken) : null;
  const sessionParseResults = session?.parseResults || null;
  const sessionLlmResponse = session?.llmResponse || null;

  // Build context from relevant virtual tables
  const context = buildLlmContext(
    null,
    route.tables,
    sessionParseResults
  );

  // If no parse results available at all
  if (!sessionParseResults && !context) {
    wsSend(ws, { type: 'chat-token', token: 'No trace data loaded. Please upload a trace file first.' });
    wsSend(ws, { type: 'chat-done', text: '' });
    return;
  }

  // Add previous LLM analysis for continuity
  let fullContext = context;
  if (sessionLlmResponse) {
    fullContext += `## Previous Analysis Summary\n${sessionLlmResponse.substring(0, 1500)}\n\n`;
  }

  const contextPrompt = fullContext
    ? `Here is the trace analysis context:\n\n${fullContext}\n\nUser question: ${question}`
    : question;

  if (route.provider === 'anthropic') {
    // Use Anthropic (haiku or sonnet) for this query
    const chatHistory = (history || [])
      .filter(m => m.content && !m.content.startsWith('Error:'))
      .filter(m => m.role !== 'system');

    // Build messages for Anthropic: just the history + new question
    const anthropicMessages = [
      ...chatHistory,
      { role: 'user', content: contextPrompt }
    ];

    await sendAnthropicChat(
      anthropicMessages,
      PS_SYSTEM_PROMPT,
      route.model,
      userApiKey,
      (token) => wsSend(ws, { type: 'chat-token', token }),
      (fullText) => wsSend(ws, { type: 'chat-done', text: fullText }),
      (err) => wsSend(ws, { type: 'chat-error', message: err.message })
    );

  } else {
    // Use Groq (OpenAI-compatible)
    const chatSystemPrompt = PS_SYSTEM_PROMPT_SLIM + `\n\nCRITICAL RULES:
1. ONLY answer based on data in the context above. Never give generic advice.
2. If a field is marked NOT FOUND in the context, say exactly that.
3. Reference actual line numbers, program names, events, SQL from the trace.
4. If trace data does not contain the answer, say so in one sentence.`;

    const messages = [
      { role: 'system', content: chatSystemPrompt },
      ...(history || []).filter(m => m.content && !m.content.startsWith('Error:')),
      { role: 'user', content: contextPrompt }
    ];

    await sendChatMessage(
      messages,
      (token) => wsSend(ws, { type: 'chat-token', token }),
      (fullText) => wsSend(ws, { type: 'chat-done', text: fullText }),
      (err) => wsSend(ws, { type: 'chat-error', message: err.message })
    );
  }
}

// ── Serve built React frontend in production ──
const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// ── Error handling middleware ──
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: `File too large. Maximum: ${process.env.MAX_FILE_SIZE_MB || 1024}MB` });
  }
  if (err && err.message) {
    return res.status(400).json({ error: isDev ? err.message : 'Bad request' });
  }
  next(err);
});

app.use(productionErrorHandler);

// ── Start server ──
server.listen(PORT, () => {
  console.log(`\n  ╔══════════════════════════════════════╗`);
  console.log(`  ║       TraceLens Server Running        ║`);
  console.log(`  ╠══════════════════════════════════════╣`);
  console.log(`  ║  URL:      http://localhost:${PORT}      ║`);
  console.log(`  ║  Provider: ${(activeProvider.name).padEnd(24)}║`);
  console.log(`  ║  Model:    ${(activeProvider.model).padEnd(24).substring(0, 24)}║`);
  console.log(`  ╚══════════════════════════════════════╝\n`);
});
