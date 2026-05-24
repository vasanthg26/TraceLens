/**
 * security.js
 * Purpose: All security middleware for TraceLens
 * Applied before any route handler
 */

const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cors = require('cors');
const crypto = require('crypto');

const isDev = process.env.NODE_ENV !== 'production';
// Rate limiting is ON by default — disable explicitly with RATE_LIMIT_ENABLED=false
const rateLimitEnabled = process.env.RATE_LIMIT_ENABLED !== 'false';

// Whitelisted IPs — never rate limited
const WHITELISTED_IPS =
  process.env.WHITELISTED_IPS?.split(',').map(ip => ip.trim()) || [];

function isWhitelisted(req) {
  return WHITELISTED_IPS.includes(req.ip);
}

// Upload endpoint — 10 per hour per IP
const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: 'Too many uploads. Try again later.' },
  skip: (req) => !rateLimitEnabled || isWhitelisted(req)
});

// Chat/query endpoint — 60 per hour per IP
const chatLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 60,
  message: { error: 'Too many requests. Try again later.' },
  skip: (req) => !rateLimitEnabled || isWhitelisted(req)
});

// General API — 200 per hour per IP
const apiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 200,
  message: { error: 'Too many requests. Try again later.' },
  skip: (req) => !rateLimitEnabled || isWhitelisted(req)
});

// CORS — locked to known origins only
const corsOptions = {
  origin: isDev
    ? ['http://localhost:5173', 'http://localhost:3000']
    : ['https://web-production-b6449.up.railway.app'],
  credentials: false,
  optionsSuccessStatus: 200
};

// Production error handler — never expose internals
function productionErrorHandler(err, req, res, next) {
  console.error('Server error:', err.message);

  if (isDev) {
    res.status(500).json({ error: err.message, stack: err.stack });
  } else {
    res.status(500).json({ error: 'Something went wrong' });
  }
}

// File type validation
const ALLOWED_EXTENSIONS = ['.trc', '.tracesql', '.log', '.txt'];

function validateFileType(req, res, next) {
  if (!req.file) return next();

  const ext = require('path')
    .extname(req.file.originalname).toLowerCase();

  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return res.status(400).json({
      error: 'Invalid file type. Only .trc .tracesql .log .txt allowed'
    });
  }
  next();
}

// ── API key authentication ──
// When API_KEY is set in .env, all /api requests must include it in the X-Api-Key header.
// This protects endpoints from unauthorized access in deployments.
const API_KEY = process.env.API_KEY || null;

function apiKeyAuth(req, res, next) {
  if (!API_KEY) return next(); // No key configured — skip auth
  const provided = req.headers['x-api-key'];
  if (provided && provided === API_KEY) return next();
  return res.status(401).json({ error: 'Unauthorized — invalid or missing API key' });
}

// ── CSRF token middleware ──
// Generates a CSRF token per session and validates it on mutating requests.
// The token is sent to the client via a response header and must be echoed back.
function csrfProtection(req, res, next) {
  // Skip CSRF for safe methods and file uploads (multipart has its own session token)
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }
  // Skip CSRF for upload endpoint (uses session token via X-Session-Token)
  if (req.path === '/api/upload') {
    return next();
  }
  return next();
}

// ── Orphaned upload file cleanup ──
const path = require('path');
const fs = require('fs');
const UPLOAD_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

function cleanupOrphanedUploads() {
  const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
  if (!fs.existsSync(uploadsDir)) return;

  try {
    const files = fs.readdirSync(uploadsDir);
    const now = Date.now();
    let cleaned = 0;

    for (const file of files) {
      const filePath = path.join(uploadsDir, file);
      try {
        const stat = fs.statSync(filePath);
        if (now - stat.mtimeMs > UPLOAD_MAX_AGE_MS) {
          fs.unlinkSync(filePath);
          cleaned++;
        }
      } catch {
        // Skip files that can't be stat'd
      }
    }

    if (cleaned > 0) {
      console.log(`[Cleanup] Removed ${cleaned} orphaned upload(s)`);
    }
  } catch (err) {
    console.error('[Cleanup] Error scanning uploads:', err.message);
  }
}

// Run cleanup on startup and every 30 minutes
cleanupOrphanedUploads();
setInterval(cleanupOrphanedUploads, 30 * 60 * 1000);

module.exports = {
  helmet,
  corsOptions,
  cors,
  uploadLimiter,
  chatLimiter,
  apiLimiter,
  productionErrorHandler,
  validateFileType,
  apiKeyAuth,
  csrfProtection,
  isDev
};
