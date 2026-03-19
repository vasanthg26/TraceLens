/**
 * llmClient.js
 * Purpose: Provider-agnostic LLM client using OpenAI-compatible API format with streaming
 * Author: TraceLens
 */

const { activeProvider } = require('./llmConfig');

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
 */
async function sendMessage(prompt, systemPrompt, onToken, onDone, onError) {
  const system = systemPrompt || SYSTEM_PROMPT;

  console.log(`[LLM] Sending to ${activeProvider.name} (${activeProvider.model})`);

  const url = `${activeProvider.baseUrl}/chat/completions`;
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${activeProvider.apiKey}`
  };
  const body = {
    model: activeProvider.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt }
    ],
    max_tokens: activeProvider.maxTokens,
    temperature: activeProvider.temperature,
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
      const friendlyMsg = `Failed to get response from ${activeProvider.name} after ${MAX_RETRIES} attempts. ` +
        `Please check your API key and network connection. Error: ${result.error.message}`;
      if (onError) onError(new Error(friendlyMsg));
    }
  }
}

/**
 * Send a chat message with conversation history.
 */
async function sendChatMessage(messages, onToken, onDone, onError) {
  console.log(`[LLM Chat] Sending to ${activeProvider.name} (${activeProvider.model})`);

  const url = `${activeProvider.baseUrl}/chat/completions`;
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${activeProvider.apiKey}`
  };
  const body = {
    model: activeProvider.model,
    messages,
    max_tokens: activeProvider.maxTokens,
    temperature: activeProvider.temperature,
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

module.exports = { sendMessage, sendChatMessage, SYSTEM_PROMPT };
