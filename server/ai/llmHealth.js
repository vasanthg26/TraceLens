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

module.exports = router;
