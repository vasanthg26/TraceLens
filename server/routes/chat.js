/**
 * chat.js
 * Purpose: WebSocket chat handler — routes user questions to LLM providers
 * Author: TraceLens
 */

const { sendChatMessage, sendAnthropicChat } = require('../ai/llmClient');
const { PS_SYSTEM_PROMPT, PS_SYSTEM_PROMPT_SLIM } = require('../ai/psSystemPrompt');
const { routeQuery, TRIGGER } = require('../ai/router');
const { buildLlmContext } = require('../db/sqliteReader');

/**
 * Create the chat handler.
 * @param {object} deps - Shared dependencies
 * @param {function} deps.wsSend
 * @param {Map} deps.sessions
 */
function createChatHandler(deps) {
  const { wsSend, sessions } = deps;

  return async function handleChat(ws, msg) {
    const { question, history, userApiKey } = msg;

    const isSlash = (question || '').trim().startsWith('/');
    const route = routeQuery({
      query: question,
      triggerType: isSlash ? TRIGGER.SLASH_COMMAND : TRIGGER.FREE_TEXT
    });

    if (route.provider === 'anthropic' && !userApiKey) {
      wsSend(ws, { type: 'key-required' });
      return;
    }

    const session = ws.__sessionToken ? sessions.get(ws.__sessionToken) : null;
    const sessionParseResults = session?.parseResults || null;
    const sessionLlmResponse = session?.llmResponse || null;

    const context = buildLlmContext(
      null,
      route.tables,
      sessionParseResults
    );

    if (!sessionParseResults && !context) {
      wsSend(ws, { type: 'chat-token', token: 'No trace data loaded. Please upload a trace file first.' });
      wsSend(ws, { type: 'chat-done', text: '' });
      return;
    }

    let fullContext = context;
    if (sessionLlmResponse) {
      fullContext += `## Previous Analysis Summary\n${sessionLlmResponse.substring(0, 1500)}\n\n`;
    }

    const contextPrompt = fullContext
      ? `Here is the trace analysis context:\n\n${fullContext}\n\nUser question: ${question}`
      : question;

    if (route.provider === 'anthropic') {
      const chatHistory = (history || [])
        .filter(m => m.content && !m.content.startsWith('Error:'))
        .filter(m => m.role !== 'system');

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
  };
}

module.exports = createChatHandler;
