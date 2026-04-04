/**
 * sqliteReader.js
 * Purpose: Reads parsed trace data from SQLite for LLM agents
 * Single source of truth for all three agents
 * Never reads raw trace file — structured data only
 *
 * Schema note: Data is stored in analysis_details as JSON blobs keyed by section.
 * Virtual table names used in router.js map as:
 *   trace_meta   → analyses row (summary metadata)
 *   trace_events → analysis_details section='events'
 *   trace_sql    → analysis_details section='sql'
 *   trace_errors → analysis_details section='errors'
 *   trace_fields → analysis_details section='variables'
 */

const { getAnalysisById } = require('./database');

// Context size limits — prevents massive token bills
const CONTEXT_LIMITS = {
  sql_rows:   20,
  event_rows: 100,
  error_rows: 50,
  field_rows: 100
};

/**
 * Load the full analysis from SQLite by id.
 * Returns parsed section objects.
 */
function loadAnalysis(analysisId) {
  if (!analysisId) return null;
  return getAnalysisById(analysisId);
}

/**
 * Build LLM context from requested virtual tables.
 * Accepts the analysis row (with .sections) from getAnalysisById,
 * or falls back to in-memory global parse results.
 *
 * @param {object|null} analysis - result of getAnalysisById(id)
 * @param {string[]} tables - virtual table names from router
 * @param {object|null} fallbackParseResults - global.__lastParseResults
 * @returns {string} formatted context for LLM prompt
 */
function buildLlmContext(analysis, tables, fallbackParseResults) {
  const sections = analysis?.sections || {};
  const pr = fallbackParseResults || {};
  let context = '';

  // trace_meta — component/transaction metadata
  if (tables.includes('trace_meta')) {
    const summary = sections.summary || pr.summary;
    if (summary) {
      context += `## Trace Metadata\n`;
      if (summary.fileName)     context += `File: ${summary.fileName}\n`;
      if (summary.totalLines)   context += `Total Lines: ${summary.totalLines}\n`;
      if (summary.processCount) context += `Processes: ${summary.processCount}\n`;
      if (summary.componentName) context += `Component: ${summary.componentName}\n`;
      if (summary.oprid)        context += `Operator: ${summary.oprid}\n`;
      context += '\n';
    }
  }

  // trace_errors — application errors only (filter portal/framework)
  if (tables.includes('trace_errors')) {
    const errorData = sections.errors || pr.errors;
    const errors = errorData?.errors || [];
    const appErrors = errors
      .filter(e => e.category !== 'portal')
      .slice(0, CONTEXT_LIMITS.error_rows);

    if (appErrors.length > 0) {
      context += `## Application Errors (${appErrors.length})\n`;
      appErrors.forEach((e, i) => {
        context += `${i + 1}. [${e.severity || 'ERROR'}] ${e.title}\n`;
        context += `   Program: ${e.program || '?'} > Event: ${e.event || '?'} (line ${e.traceLineNumber || '?'})\n`;
        if (e.codeContext?.length > 0) {
          context += `   Code:\n`;
          e.codeContext.slice(-3).forEach(c => {
            context += `     ${c.lineNum}: ${c.code}\n`;
          });
        }
      });
      context += '\n';
    }
  }

  // trace_sql — SQL performance, top by total time
  if (tables.includes('trace_sql')) {
    const sqlData = sections.sql || pr.sql;
    const sqlGroups = sqlData?.sqlGroups || [];
    const topSql = [...sqlGroups]
      .sort((a, b) => (b.totalTime || 0) - (a.totalTime || 0))
      .slice(0, CONTEXT_LIMITS.sql_rows);

    if (topSql.length > 0) {
      context += `## SQL Statements — Top ${topSql.length} by Total Time\n`;
      topSql.forEach((g, i) => {
        context += `${i + 1}. [${g.count}x, ${(g.totalTime || 0).toFixed(3)}s total, avg ${(g.avgTime || 0).toFixed(3)}s${g.isNPlusOne ? ', N+1 PATTERN' : ''}]\n`;
        context += `   ${(g.normalizedSql || '').substring(0, 300)}\n`;
      });

      const stats = sqlData?.sqlStats;
      if (stats) {
        context += `\nSQL Summary: ${stats.totalStatements || 0} total, ${stats.slowQueryCount || 0} slow, ${stats.uniqueStatements || 0} unique\n`;
      }
      context += '\n';
    }
  }

  // trace_events — application events (filter portal/framework)
  if (tables.includes('trace_events')) {
    const eventData = sections.events || pr.events;
    const events = eventData?.events || [];
    const appEvents = events
      .filter(e => {
        const prog = (e.program || '').toUpperCase();
        return !prog.startsWith('PSTOOLS') && !prog.startsWith('PSPT');
      })
      .slice(0, CONTEXT_LIMITS.event_rows);

    if (appEvents.length > 0) {
      context += `## Event Flow (${appEvents.length} application events)\n`;
      appEvents.forEach((e, i) => {
        const dur = e.duration != null ? ` [${e.duration.toFixed(3)}s]` : '';
        context += `${i + 1}. ${e.program || '?'}.${e.event || '?'}${dur}\n`;
      });
      context += '\n';
    }
  }

  // trace_fields — variable/field assignments
  if (tables.includes('trace_fields')) {
    const varData = sections.variables || pr.variables;
    const varEvents = varData?.events || [];
    const topVars = varEvents.slice(0, CONTEXT_LIMITS.field_rows);

    if (topVars.length > 0) {
      context += `## Field/Variable Assignments (${topVars.length} of ${varEvents.length})\n`;
      topVars.forEach((e, i) => {
        context += `${i + 1}. [Line ${e.lineNumber || '?'}] [${e.type || '?'}] ${e.variable} = ${e.value} (${e.context?.program || '?'}.${e.context?.event || '?'})\n`;
      });
      context += '\n';
    }

    if (varData) {
      context += `Variable Summary: ${varData.uniqueVariables || 0} unique variables, ${varData.totalEvents || 0} trace events\n\n`;
    }
  }

  return context;
}

/**
 * Check if Sonnet auto-analysis is cached for this analysis ID.
 * Uses the summary field — if it contains the PS finding format it was from Sonnet.
 * Returns cached analysis text or null.
 */
function checkAnalysisCache(analysisId) {
  if (!analysisId) return null;
  const analysis = getAnalysisById(analysisId);
  if (!analysis) return null;

  // Check if the stored summary looks like a Sonnet PS analysis (has FINDING: markers)
  if (analysis.summary && analysis.summary.includes('FINDING:')) {
    return {
      summary: analysis.summary,
      health: analysis.overallHealth,
      topRecommendation: analysis.topRecommendation,
      cached: true
    };
  }
  return null;
}

module.exports = {
  loadAnalysis,
  buildLlmContext,
  checkAnalysisCache
};
