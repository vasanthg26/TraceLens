/**
 * index.js
 * Purpose: Express + WebSocket server, file upload endpoint, orchestrates parse → LLM pipeline
 * Author: TraceLens
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const http = require('http');
const { WebSocketServer } = require('ws');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const { parseTraceFile, buildLlmPrompt } = require('./parser/streamParser');
const { sendMessage, sendChatMessage, SYSTEM_PROMPT } = require('./ai/llmClient');
const llmHealthRouter = require('./ai/llmHealth');
const { activeProvider, providerKey } = require('./ai/llmConfig');

const PORT = parseInt(process.env.PORT) || 3000;
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE_MB || '1024') * 1024 * 1024;

// ── Express setup ──
const app = express();
app.use(cors());
app.use(express.json());

// LLM health endpoint
app.use('/api/llm', llmHealthRouter);

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

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`[WS] Client connected (${clients.size} total)`);

  ws.on('close', () => {
    clients.delete(ws);
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
 * Broadcast to all connected clients.
 */
function wsBroadcast(data) {
  const msg = JSON.stringify(data);
  for (const ws of clients) {
    if (ws.readyState === 1) {
      ws.send(msg);
    }
  }
}

// ── File upload + analysis pipeline ──
app.post('/api/upload', upload.single('traceFile'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const filePath = req.file.path;
  const fileName = req.file.originalname;
  const fileSize = req.file.size;

  console.log(`[Upload] ${fileName} (${(fileSize / 1024 / 1024).toFixed(1)}MB)`);
  res.json({ status: 'processing', fileName, fileSize });

  // Start analysis pipeline
  try {
    // Phase 1: Parse the trace file
    wsBroadcast({ type: 'status', status: 'parsing' });

    const parseResults = await parseTraceFile(filePath, (progress) => {
      wsBroadcast({ type: 'progress', ...progress });
    });

    // Send parse results section by section
    wsBroadcast({ type: 'partial', section: 'summary', data: parseResults.summary });
    wsBroadcast({ type: 'partial', section: 'sql', data: parseResults.sql });
    wsBroadcast({ type: 'partial', section: 'loops', data: parseResults.loops });
    wsBroadcast({ type: 'partial', section: 'events', data: parseResults.events });
    wsBroadcast({ type: 'partial', section: 'errors', data: parseResults.errors });
    wsBroadcast({ type: 'partial', section: 'variables', data: parseResults.variables });

    // Phase 2: Send condensed results to LLM for analysis
    wsBroadcast({ type: 'status', status: 'analyzing' });
    const llmPrompt = buildLlmPrompt(parseResults);

    // Store parse results for chat context
    global.__lastParseResults = parseResults;
    global.__lastLlmPrompt = llmPrompt;

    await sendMessage(
      llmPrompt,
      null,
      (token) => wsBroadcast({ type: 'llm-token', token }),
      (fullText) => {
        // Parse readable text — extract health rating and summary
        let health = 'fair';
        const healthMatch = fullText.match(/\b(CRITICAL|POOR|FAIR|GOOD)\b/i);
        if (healthMatch) health = healthMatch[1].toLowerCase();

        // Extract top recommendation (first numbered item in Top Recommendations)
        let topRecommendation = '';
        const recMatch = fullText.match(/Top Recommend[\s\S]*?\n\s*1[\.\)]\s*(.+)/i);
        if (recMatch) topRecommendation = recMatch[1].trim().substring(0, 200);

        // Extract fix code blocks (BEFORE/AFTER pairs)
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

        const analysis = {
          summary: fullText,
          health,
          topRecommendation,
          fixes
        };

        // Store full LLM response for chat context
        global.__lastLlmResponse = fullText;

        wsBroadcast({ type: 'llm-done', analysis });
      },
      (err) => {
        console.error('[LLM Error]', err.message);
        wsBroadcast({ type: 'llm-error', message: err.message });
      }
    );

    // Cleanup uploaded file after processing
    fs.unlink(filePath, (err) => {
      if (err) console.error('[Cleanup] Failed to delete:', err.message);
    });

  } catch (err) {
    console.error('[Pipeline Error]', err);
    wsBroadcast({ type: 'error', message: `Analysis failed: ${err.message}` });

    // Cleanup on error too
    fs.unlink(filePath, () => {});
  }
});

// ── Chat handler ──
async function handleChat(ws, msg) {
  const { question, history } = msg;

  // Build rich context from parsed results
  let context = '';

  if (global.__lastLlmPrompt) {
    context += global.__lastLlmPrompt + '\n\n';
  }

  // Add previous LLM analysis for continuity
  if (global.__lastLlmResponse) {
    context += `## Previous AI Analysis\n${global.__lastLlmResponse.substring(0, 2000)}\n\n`;
  }

  // Add detailed SQL data for specific queries
  if (global.__lastParseResults?.sql?.sqlGroups) {
    const topSql = global.__lastParseResults.sql.sqlGroups.slice(0, 10);
    context += `## SQL Statements (top 10 by time)\n`;
    topSql.forEach((g, i) => {
      context += `${i + 1}. [${g.count}x, ${g.totalTime.toFixed(3)}s, avg ${g.avgTime.toFixed(3)}s${g.isNPlusOne ? ', N+1' : ''}] ${g.normalizedSql.substring(0, 200)}\n`;
    });
    context += '\n';
  }

  // Add variable trace data for context
  if (global.__lastParseResults?.variables) {
    const vars = global.__lastParseResults.variables;
    context += `## Variable Tracking: ${vars.uniqueVariables} unique variables, ${vars.totalEvents} trace events\n`;

    // Check if user is asking about a specific variable
    const varMention = question.match(/&\w+|\b[A-Z_]+\.[A-Z_]+\b/g);
    if (varMention && vars.events) {
      for (const varName of varMention.slice(0, 3)) {
        const term = varName.toLowerCase();
        const matches = vars.events.filter(e =>
          e.variable.toLowerCase().includes(term) ||
          (e.variable.includes('.') && e.variable.split('.').some(p => p.toLowerCase() === term))
        );
        if (matches.length > 0) {
          context += `\n### Variable trace for "${varName}" (${matches.length} events):\n`;
          matches.slice(0, 20).forEach(e => {
            context += `  Line ${e.lineNumber} [${e.type}] ${e.variable} = ${e.value} (${e.context.program}.${e.context.event})\n`;
          });
        }
      }
    }
    context += '\n';
  }

  // Add error details
  if (global.__lastParseResults?.errors?.errors?.length > 0) {
    context += `## Errors Found\n`;
    global.__lastParseResults.errors.errors.slice(0, 5).forEach((e, i) => {
      context += `${i + 1}. [${e.severity}] ${e.title} at ${e.program} > ${e.event} (line ${e.traceLineNumber})\n`;
      if (e.codeContext?.length > 0) {
        context += `   Code context:\n`;
        e.codeContext.slice(-3).forEach(c => {
          context += `     ${c.lineNum}: ${c.code}\n`;
        });
      }
    });
    context += '\n';
  }

  const contextPrompt = context
    ? `Here is the full trace analysis context:\n\n${context}\n\nUser question: ${question}`
    : question;

  const chatSystemPrompt = SYSTEM_PROMPT + `\n\nYou are now in a chat conversation about the trace analysis above. Answer questions specifically about the trace data. Reference actual SQL statements, variable values, event names, and program names from the trace. If the user asks about a variable, trace its value path. If they ask about an error, explain the code context. Be specific and actionable.`;

  const messages = [
    { role: 'system', content: chatSystemPrompt },
    ...(history || []),
    { role: 'user', content: contextPrompt }
  ];

  await sendChatMessage(
    messages,
    (token) => wsSend(ws, { type: 'chat-token', token }),
    (fullText) => wsSend(ws, { type: 'chat-done', text: fullText }),
    (err) => wsSend(ws, { type: 'chat-error', message: err.message })
  );
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
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: `File too large. Maximum: ${process.env.MAX_FILE_SIZE_MB || 1024}MB` });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err) {
    return res.status(400).json({ error: err.message });
  }
  next();
});

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
