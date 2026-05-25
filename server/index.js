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

const llmHealthRouter = require('./ai/llmHealth');
const historyRouter = require('./routes/history');
const createUploadRouter = require('./routes/upload');
const createChatHandler = require('./routes/chat');
const { activeProvider } = require('./ai/llmConfig');
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

// Health check endpoint (for Railway, container orchestration, uptime monitors)
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    provider: activeProvider.name,
    activeSessions: sessions.size
  });
});

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
    // Re-associate existing session with new WS (cancel pending cleanup)
    const session = sessions.get(token);
    if (session._cleanupTimer) clearTimeout(session._cleanupTimer);
    session._cleanupTimer = null;
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
    // Keep session alive for a grace period so reconnections can reuse it
    // and uploads in-flight during brief disconnects still succeed
    const token = ws.__sessionToken;
    if (token && sessions.has(token)) {
      const session = sessions.get(token);
      session.ws = null; // Mark WS as disconnected
      session._cleanupTimer = setTimeout(() => {
        sessions.delete(token);
      }, 60_000); // 60-second grace period
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

// ── File upload + analysis pipeline (extracted to routes/upload.js) ──
const uploadRouter = createUploadRouter({
  getSessionByToken,
  wsSessionSend,
  sonnetCacheGet,
  sonnetCacheSet,
  upload,
  uploadLimiter,
  validateFileType
});
app.use('/api/upload', uploadRouter);

// ── Chat handler (extracted to routes/chat.js) ──
const handleChat = createChatHandler({ wsSend, sessions });

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
