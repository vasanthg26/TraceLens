/**
 * security.js
 * Purpose: All security middleware for TraceLens
 * Applied before any route handler
 */

const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cors = require('cors');

const isDev = process.env.NODE_ENV !== 'production';
const rateLimitEnabled = process.env.RATE_LIMIT_ENABLED === 'true';

// Whitelisted IPs — never rate limited
const WHITELISTED_IPS =
  process.env.WHITELISTED_IPS?.split(',').map(ip => ip.trim()) || [];

function isWhitelisted(req) {
  return isDev || WHITELISTED_IPS.includes(req.ip);
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

module.exports = {
  helmet,
  corsOptions,
  cors,
  uploadLimiter,
  chatLimiter,
  apiLimiter,
  productionErrorHandler,
  validateFileType,
  isDev
};
