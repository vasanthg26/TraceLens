/**
 * router.js
 * Purpose: Routes queries to correct LLM agent
 * Pure Node.js — zero LLM calls, zero cost, instant
 *
 * Returns: { provider, model, tables, triggerType }
 */

const TRIGGER = {
  AUTO_ANALYSIS: 'auto_analysis',
  SLASH_COMMAND: 'slash_command',
  FREE_TEXT: 'free_text'
};

const ALL_TABLES = [
  'trace_meta', 'trace_events', 'trace_sql',
  'trace_errors', 'trace_fields'
];

function routeQuery(input) {
  // AUTO ANALYSIS — always Sonnet, all tables
  if (input.triggerType === TRIGGER.AUTO_ANALYSIS) {
    return sonnetRoute(ALL_TABLES);
  }

  const query = (input.query || '').toLowerCase().trim();

  // SLASH COMMANDS
  if (query.startsWith('/')) {
    return routeSlashCommand(query);
  }

  // FREE TEXT
  return routeFreeText(query);
}

function routeSlashCommand(query) {
  // Groq — simple lookups
  if (query.startsWith('/error'))
    return groqRoute(['trace_meta', 'trace_errors']);
  if (query.startsWith('/events'))
    return groqRoute(['trace_meta', 'trace_events']);
  if (query.startsWith('/sql'))
    return groqRoute(['trace_meta', 'trace_sql']);
  if (query.startsWith('/perf'))
    return groqRoute(['trace_meta', 'trace_sql']);
  if (query.startsWith('/validate'))
    return groqRoute(['trace_meta', 'trace_events', 'trace_errors']);

  // Haiku — medium complexity
  if (query.startsWith('/trace'))
    return haikuRoute(['trace_meta', 'trace_events', 'trace_fields', 'trace_errors']);
  if (query.startsWith('/variable'))
    return haikuRoute(['trace_meta', 'trace_fields', 'trace_events']);
  if (query.startsWith('/path'))
    return haikuRoute(['trace_meta', 'trace_events', 'trace_sql']);

  // Sonnet — deep reasoning
  if (query.startsWith('/why'))    return sonnetRoute(ALL_TABLES);
  if (query.startsWith('/compare')) return sonnetRoute(ALL_TABLES);

  // Unknown slash command — default Groq
  return groqRoute(['trace_meta', 'trace_errors', 'trace_events']);
}

function routeFreeText(query) {
  const deepKeywords = [
    'why', 'root cause', 'trace entire', 'how did',
    'what caused', 'calculate', 'full flow',
    'across all', 'correlate', 'explain',
    'diagnose', 'investigate', 'what happened'
  ];

  const mediumKeywords = [
    'track', 'journey', 'assignment', 'value of',
    'where was', 'who changed', 'sequence',
    'follow', 'show me all', 'list all'
  ];

  if (deepKeywords.some(k => query.includes(k)))
    return sonnetRoute(ALL_TABLES);

  if (mediumKeywords.some(k => query.includes(k)))
    return haikuRoute(['trace_meta', 'trace_events', 'trace_fields', 'trace_errors']);

  // Default — Groq
  return groqRoute(['trace_meta', 'trace_errors', 'trace_events']);
}

function groqRoute(tables) {
  return {
    provider: 'groq',
    model: 'llama-3.3-70b-versatile',
    tables,
    triggerType: TRIGGER.FREE_TEXT
  };
}

function haikuRoute(tables) {
  return {
    provider: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
    tables,
    triggerType: TRIGGER.FREE_TEXT
  };
}

function sonnetRoute(tables) {
  return {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    tables,
    triggerType: TRIGGER.AUTO_ANALYSIS
  };
}

module.exports = { routeQuery, TRIGGER };
