/**
 * llmHealth.js
 * Purpose: Express router for LLM health check endpoint
 * Author: TraceLens
 */

const express = require('express');
const { activeProvider, providerKey } = require('./llmConfig');

const router = express.Router();

/**
 * GET /api/llm/status
 * Sends a tiny test prompt to the active provider and reports status.
 */
router.get('/status', async (req, res) => {
  const startTime = Date.now();

  try {
    const response = await fetch(`${activeProvider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${activeProvider.apiKey}`
      },
      body: JSON.stringify({
        model: activeProvider.model,
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 5,
        stream: false
      }),
      signal: AbortSignal.timeout(10000)
    });

    const latencyMs = Date.now() - startTime;

    if (response.ok) {
      res.json({
        provider: providerKey,
        providerName: activeProvider.name,
        model: activeProvider.model,
        status: 'online',
        latencyMs
      });
    } else {
      const errorText = await response.text();
      res.json({
        provider: providerKey,
        providerName: activeProvider.name,
        model: activeProvider.model,
        status: 'offline',
        latencyMs,
        error: `HTTP ${response.status}: ${errorText.substring(0, 100)}`
      });
    }
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    res.json({
      provider: providerKey,
      providerName: activeProvider.name,
      model: activeProvider.model,
      status: 'offline',
      latencyMs,
      error: err.message
    });
  }
});

/**
 * POST /api/llm/test
 * Tests a user-supplied apiUrl + apiKey. Used by the UI settings panel.
 * Detects an appropriate model from the URL to keep the test valid.
 */
router.post('/test', async (req, res) => {
  const { apiUrl, apiKey } = req.body || {};

  if (!apiUrl || !apiKey) {
    return res.status(400).json({ error: 'apiUrl and apiKey are required' });
  }

  // Pick a sensible default model based on the URL
  let model = activeProvider.model;
  if (apiUrl.includes('groq.com'))         model = 'llama-3.3-70b-versatile';
  else if (apiUrl.includes('openai.com'))  model = 'gpt-4o-mini';
  else if (apiUrl.includes('openrouter.ai')) model = 'meta-llama/llama-3.1-8b-instruct:free';
  else if (apiUrl.includes('localhost:11434')) model = 'qwen2.5-coder:7b';
  else if (apiUrl.includes('localhost:1234'))  model = 'local-model';

  const startTime = Date.now();
  const endpoint = apiUrl.replace(/\/$/, '') + '/chat/completions';

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 5,
        stream: false
      }),
      signal: AbortSignal.timeout(10000)
    });

    const latencyMs = Date.now() - startTime;

    if (response.ok) {
      res.json({ status: 'online', model, latencyMs });
    } else {
      const errorText = await response.text();
      res.json({
        status: 'offline',
        model,
        latencyMs,
        error: `HTTP ${response.status}: ${errorText.substring(0, 150)}`
      });
    }
  } catch (err) {
    const latencyMs = Date.now() - startTime;
    res.json({ status: 'offline', model, latencyMs, error: err.message });
  }
});

module.exports = router;
