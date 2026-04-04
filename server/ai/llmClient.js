/**
 * llmClient.js
 * Purpose: Provider-agnostic LLM client — supports OpenAI-compatible + Anthropic native API
 * Author: TraceLens
 */

const { activeProvider, providers } = require('./llmConfig');

const SYSTEM_PROMPT = `You are an expert PeopleSoft PeopleCode developer and performance analyst with deep knowledge of PeopleTools, component processor events, SQL optimization, and Integration Broker.

You understand all 19 PeopleCode component processor events and their execution order:
- Search: SearchInit, SearchSave
- Build: RowSelect, FieldDefault, FieldFormula, RowInit, FieldChange, FieldEdit
- Component: PreBuild, PostBuild, Activate
- Save: SaveEdit, SavePreChange, Workflow, SavePostChange
- Row: RowInsert, RowDelete
- Menu: PrePopup, ItemSelected

Key rules:
- Never use Error/Warning in RowInit, RowInsert, FieldDefault, or SavePostChange (causes runtime error)
- FieldFormula fires on every field on every row — avoid it for performance
- RowInit fires after RowInsert — don't duplicate code between them
- SavePostChange runs after DB update — SQL Commit is automatic, never issue manual Commit/Rollback
- RowInit/FieldChange are commonly paired for initializing and recalculating derived values
- RowSelect is inefficient for filtering — use search record views instead
- Activate is page-level only, not row/record specific — use GetRow/GetRecord with explicit context

When analyzing a trace file, respond in clear readable text with these sections:

## Health Assessment
Rate as CRITICAL / POOR / FAIR / GOOD with 2-3 sentence justification.

## Key Findings
Bullet list of the most important issues found. Reference specific SQL statements, events, and programs.

## Top Recommendations
Numbered list of actionable fixes, most impactful first. For each:
- What the problem is (reference the specific SQL/event)
- Why it's a problem
- How to fix it with a concrete PeopleCode example

## Performance Fixes
For each fix, show a BEFORE and AFTER PeopleCode snippet.

Keep the analysis specific to the actual trace data provided. Reference actual table names, field names, SQL statements, and programs from the trace. Never give generic advice — every point should tie back to something found in the trace.`;

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000];

/**
 * Parse SSE lines from a text chunk and extract tokens.
 */
function parseSseChunk(buffer) {
  const tokens = [];
  const lines = buffer.split('\n');
  const remaining = lines.pop() || '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('data:')) continue;

    const data = trimmed.slice(5).trim();
    if (data === '[DONE]') continue;

    try {
      const parsed = JSON.parse(data);
      const token = parsed.choices?.[0]?.delta?.content;
      if (token) tokens.push(token);
    } catch {
      // Skip malformed SSE chunks
    }
  }

  return { tokens, remaining };
}

/**
 * Parse Anthropic SSE lines and extract text deltas.
 */
function parseAnthropicSseChunk(buffer) {
  const tokens = [];
  const lines = buffer.split('\n');
  const remaining = lines.pop() || '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('data:')) continue;

    const data = trimmed.slice(5).trim();
    if (data === '[DONE]') continue;

    try {
      const parsed = JSON.parse(data);
      // Anthropic streaming: content_block_delta events contain text
      if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
        tokens.push(parsed.delta.text);
      }
    } catch {
      // Skip malformed SSE chunks
    }
  }

  return { tokens, remaining };
}

/**
 * Stream a request to Anthropic's native API.
 * Uses x-api-key header + anthropic-version, system as top-level field.
 * userApiKey takes priority over Railway ANTHROPIC_API_KEY.
 */
async function streamAnthropicRequest(model, maxTokens, temperature, systemPrompt, messages, userApiKey, onToken) {
  const { request: httpsRequest } = require('https');

  // User key takes priority — NEVER log the key value
  const apiKey = (userApiKey && userApiKey.startsWith('sk-ant-'))
    ? userApiKey
    : process.env.ANTHROPIC_API_KEY;

  // Enable prompt caching for Sonnet — cache the static system prompt to save tokens
  const isSonnet = model.includes('sonnet');
  const systemField = (isSonnet && systemPrompt)
    ? [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }]
    : systemPrompt;

  const body = {
    model,
    max_tokens: maxTokens,
    temperature,
    system: systemField,
    messages,
    stream: true
  };

  const postData = JSON.stringify(body);

  return new Promise((resolve) => {
    const reqHeaders = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Length': Buffer.byteLength(postData)
    };
    if (isSonnet) reqHeaders['anthropic-beta'] = 'prompt-caching-2024-07-31';

    const req = httpsRequest({
      hostname: 'api.anthropic.com',
      port: 443,
      path: '/v1/messages',
      method: 'POST',
      headers: reqHeaders
    }, (res) => {
      if (res.statusCode !== 200) {
        let errorBody = '';
        res.on('data', (chunk) => { errorBody += chunk.toString(); });
        res.on('end', () => {
          const err = new Error(`Anthropic HTTP ${res.statusCode}: ${errorBody.substring(0, 200)}`);
          resolve({ error: err });
        });
        return;
      }

      let fullText = '';
      let buffer = '';

      res.setEncoding('utf8');

      res.on('data', (chunk) => {
        buffer += chunk;
        const { tokens, remaining } = parseAnthropicSseChunk(buffer);
        buffer = remaining;

        for (const token of tokens) {
          fullText += token;
          if (onToken) onToken(token);
        }
      });

      res.on('end', () => {
        if (buffer.trim()) {
          const { tokens } = parseAnthropicSseChunk(buffer + '\n');
          for (const token of tokens) {
            fullText += token;
            if (onToken) onToken(token);
          }
        }
        console.log(`[Anthropic] Stream complete (${fullText.length} chars)`);
        resolve({ text: fullText });
      });

      res.on('error', (err) => resolve({ error: err }));
    });

    req.on('error', (err) => resolve({ error: err }));
    req.setTimeout(120000, () => {
      req.destroy(new Error('Anthropic request timed out after 120s'));
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Send a message to Anthropic (haiku or sonnet) with streaming.
 * userApiKey: from X-User-Api-Key request header — never logged.
 */
async function sendToAnthropic(prompt, systemPrompt, model, userApiKey, onToken, onDone, onError) {
  const modelConfig = model === 'claude-haiku-4-5-20251001'
    ? providers.anthropic_haiku
    : providers.anthropic_sonnet;

  const maxTokens = modelConfig.maxTokens;
  const temperature = modelConfig.temperature;
  const system = systemPrompt || '';

  // Messages format for Anthropic — system is NOT a message
  const messages = [{ role: 'user', content: prompt }];

  console.log(`[Anthropic] Sending to ${model} (userKey: ${userApiKey ? 'yes' : 'no'})`);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const result = await streamAnthropicRequest(
      model, maxTokens, temperature, system, messages, userApiKey, onToken
    );

    if (result.text !== undefined) {
      if (onDone) onDone(result.text);
      return;
    }

    console.error(`[Anthropic] Attempt ${attempt + 1}/${MAX_RETRIES} failed:`, result.error.message);

    if (attempt < MAX_RETRIES - 1) {
      await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
    } else {
      if (onError) onError(new Error(`Anthropic failed after ${MAX_RETRIES} attempts: ${result.error.message}`));
    }
  }
}

/**
 * Send a chat message to Anthropic with conversation history.
 * userApiKey: from request context — never logged.
 */
async function sendAnthropicChat(messages, systemPrompt, model, userApiKey, onToken, onDone, onError) {
  const modelConfig = model === 'claude-haiku-4-5-20251001'
    ? providers.anthropic_haiku
    : providers.anthropic_sonnet;

  const maxTokens = modelConfig.maxTokens;
  const temperature = modelConfig.temperature;
  const system = systemPrompt || '';

  // Filter out system messages from history — Anthropic uses top-level system field
  const anthropicMessages = messages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role, content: m.content }));

  console.log(`[Anthropic Chat] Sending to ${model} (userKey: ${userApiKey ? 'yes' : 'no'})`);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const result = await streamAnthropicRequest(
      model, maxTokens, temperature, system, anthropicMessages, userApiKey, onToken
    );

    if (result.text !== undefined) {
      if (onDone) onDone(result.text);
      return;
    }

    console.error(`[Anthropic Chat] Attempt ${attempt + 1}/${MAX_RETRIES} failed:`, result.error.message);

    if (attempt < MAX_RETRIES - 1) {
      await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
    } else {
      if (onError) onError(new Error(`Anthropic chat failed after ${MAX_RETRIES} attempts: ${result.error.message}`));
    }
  }
}

/**
 * Stream an LLM response using Node.js http/https for reliable streaming.
 */
async function streamRequest(url, headers, body, onToken) {
  const { request: httpRequest } = url.startsWith('https') ? require('https') : require('http');
  const parsedUrl = new URL(url);
  const postData = JSON.stringify(body);

  return new Promise((resolve) => {
    const req = httpRequest({
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname,
      method: 'POST',
      headers: {
        ...headers,
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      if (res.statusCode !== 200) {
        let errorBody = '';
        res.on('data', (chunk) => { errorBody += chunk.toString(); });
        res.on('end', () => {
          const err = new Error(`HTTP ${res.statusCode}: ${errorBody.substring(0, 200)}`);
          resolve({ error: err });
        });
        return;
      }

      let fullText = '';
      let buffer = '';

      res.setEncoding('utf8');

      res.on('data', (chunk) => {
        buffer += chunk;
        const { tokens, remaining } = parseSseChunk(buffer);
        buffer = remaining;

        for (const token of tokens) {
          fullText += token;
          if (onToken) onToken(token);
        }
      });

      res.on('end', () => {
        // Process any remaining buffer
        if (buffer.trim()) {
          const { tokens } = parseSseChunk(buffer + '\n');
          for (const token of tokens) {
            fullText += token;
            if (onToken) onToken(token);
          }
        }
        console.log(`[LLM] Stream complete (${fullText.length} chars)`);
        resolve({ text: fullText });
      });

      res.on('error', (err) => {
        resolve({ error: err });
      });
    });

    req.on('error', (err) => {
      resolve({ error: err });
    });

    req.setTimeout(60000, () => {
      req.destroy(new Error('Request timed out after 60s'));
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Send a message to the active LLM provider with streaming.
 * providerOverride: optional { baseUrl, apiKey } from UI settings — takes priority over .env config.
 */
async function sendMessage(prompt, systemPrompt, onToken, onDone, onError, providerOverride) {
  const system = systemPrompt || SYSTEM_PROMPT;
  const provider = providerOverride
    ? { ...activeProvider, baseUrl: providerOverride.baseUrl, apiKey: providerOverride.apiKey }
    : activeProvider;

  console.log(`[LLM] Sending to ${provider.name || 'UI-configured'} (${provider.model})`);

  const url = `${provider.baseUrl}/chat/completions`;
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${provider.apiKey}`
  };
  const body = {
    model: provider.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt }
    ],
    max_tokens: provider.maxTokens,
    temperature: provider.temperature,
    stream: true
  };

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const result = await streamRequest(url, headers, body, onToken);

    if (result.text !== undefined) {
      if (onDone) onDone(result.text);
      return;
    }

    console.error(`[LLM] Attempt ${attempt + 1}/${MAX_RETRIES} failed:`, result.error.message);

    if (attempt < MAX_RETRIES - 1) {
      await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
    } else {
      const friendlyMsg = `Failed to get response from ${provider.name || 'LLM'} after ${MAX_RETRIES} attempts. ` +
        `Please check your API key and network connection. Error: ${result.error.message}`;
      if (onError) onError(new Error(friendlyMsg));
    }
  }
}

/**
 * Send a chat message with conversation history.
 * providerOverride: optional { baseUrl, apiKey } from UI settings — takes priority over .env config.
 */
async function sendChatMessage(messages, onToken, onDone, onError, providerOverride) {
  const provider = providerOverride
    ? { ...activeProvider, baseUrl: providerOverride.baseUrl, apiKey: providerOverride.apiKey }
    : activeProvider;

  console.log(`[LLM Chat] Sending to ${provider.name || 'UI-configured'} (${provider.model})`);

  const url = `${provider.baseUrl}/chat/completions`;
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${provider.apiKey}`
  };
  const body = {
    model: provider.model,
    messages,
    max_tokens: provider.maxTokens,
    temperature: provider.temperature,
    stream: true
  };

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const result = await streamRequest(url, headers, body, onToken);

    if (result.text !== undefined) {
      if (onDone) onDone(result.text);
      return;
    }

    console.error(`[LLM Chat] Attempt ${attempt + 1}/${MAX_RETRIES} failed:`, result.error.message);

    if (attempt < MAX_RETRIES - 1) {
      await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt]));
    } else {
      if (onError) onError(new Error(`Chat failed after ${MAX_RETRIES} attempts: ${result.error.message}`));
    }
  }
}

module.exports = {
  sendMessage,
  sendChatMessage,
  sendToAnthropic,
  sendAnthropicChat,
  SYSTEM_PROMPT
};
