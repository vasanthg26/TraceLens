/**
 * streamParser.js
 * Purpose: Coordinate line-by-line streaming read of trace files, dispatch to sub-parsers.
 *          Handles both legacy (processNo-lineNo) and PSAPPSRV-prefixed trace formats.
 *          Detects PSIWCEVENTS queries to extract component context metadata.
 * Author: TraceLens
 */

const fs = require('fs');
const readline = require('readline');
const SqlAnalyzer = require('./sqlAnalyzer');
const LoopDetector = require('./loopDetector');
const EventParser = require('./eventParser');
const ErrorParser = require('./errorParser');
const VariableTracer = require('./variableTracer');

// PSAPPSRV line prefix: PSAPPSRV.PID [token] sessionToken sessionID userID (threadID) \t content
const PSAPPSRV_REGEX = /^PSAPPSRV\.(\d+)\s+\[.*?\]\s+(\S+)\s+(\S+)\s+(\S+)\s+\((\d+)\)\s+\t\s*(.*)/;

// Legacy line prefix: processNo-lineNo HH.MM.SS elapsed content
const LEGACY_REGEX = /^(\d+)-\d+\s+[\d.]+\s+[\d.]+\s+(.*)/;

/**
 * Extract process key and stripped content from a raw trace line.
 * Returns { processKey, content } where content is the line after the header.
 */
function extractLineContext(line) {
  // New PSAPPSRV format: PSAPPSRV.PID (tid)\t lineNo-seq HH.MM.SS elapsed content
  const psNewMatch = line.match(/^PSAPPSRV\.(\d+)\s+\((\d+)\)\s+\t\s+\d+-\d+\s+[\d.]+\s+[\d.]+\s+(.*)/);
  if (psNewMatch) {
    return {
      processKey: `${psNewMatch[1]}:${psNewMatch[2]}`,
      pid: psNewMatch[1],
      content: psNewMatch[3].trim()
    };
  }

  const psMatch = line.match(PSAPPSRV_REGEX);
  if (psMatch) {
    const pid      = psMatch[1];
    const threadId = psMatch[5];
    return {
      processKey: `${pid}:${threadId}`,
      pid,
      content: psMatch[6].trim()
    };
  }

  const legacyMatch = line.match(LEGACY_REGEX);
  if (legacyMatch) {
    return {
      processKey: legacyMatch[1],
      pid: legacyMatch[1],
      content: legacyMatch[2].trim()
    };
  }

  return { processKey: 'default', pid: null, content: line.trim() };
}

/**
 * PSIWCEVENTS component context detector.
 * Watches for SQL against PSIWCEVENTS and captures bind values
 * to extract component/menu/portal metadata.
 */
class PsiwceventsDetector {
  constructor() {
    this.watching = false;
    this.binds = [];
    this.detected = null;
  }

  processLine(line) {
    // COM line referencing PSIWCEVENTS
    const comMatch = line.match(/Cur#[\d.]+\.\w+\s+RC=\d+\s+Dur=[\d.]+\s+COM\s+Stmt=(.+)/i);
    if (comMatch) {
      const stmt = comMatch[1].toUpperCase();
      if (stmt.includes('PSIWCEVENTS')) {
        this.watching = true;
        this.binds = [];
        return;
      }
      // New COM that isn't PSIWCEVENTS resets watch
      if (this.watching) {
        this.watching = false;
        this.binds = [];
      }
      return;
    }

    if (!this.watching) return;

    // EXE line signals execution — binds are now complete
    const exeMatch = line.match(/Cur#[\d.]+\.\w+\s+RC=\d+\s+Dur=[\d.]+\s+EXE/i);
    if (exeMatch) {
      this._resolveMetadata();
      this.watching = false;
      return;
    }

    // Bind variable lines
    const bindMatch = line.match(/Bind-(\d+)\s+type=\S+(?:\s+length=\d+)?\s+value=(.*)/i);
    if (bindMatch) {
      const idx = parseInt(bindMatch[1], 10) - 1;
      this.binds[idx] = bindMatch[2].trim();
    }
  }

  _resolveMetadata() {
    if (this.binds.length === 0) return;

    // Heuristic: PeopleTools typically queries PSIWCEVENTS with
    // WHERE PORTAL_NAME=:1 AND MENUNAME=:2 AND PNLGRPNAME=:3
    // or variations. Use positional order and length heuristics.
    const result = {
      componentName: null,
      menuName: null,
      portalName: null,
      rawBinds: [...this.binds]
    };

    // Portal names typically start with "EMP" or "EMPLOYEE" or contain "PORTAL"
    // Menu names typically look like "MENU_NAME" all-caps with underscores
    // Component names look like "COMPONENT_NAME" all-caps
    for (let i = 0; i < Math.min(this.binds.length, 6); i++) {
      const val = (this.binds[i] || '').trim();
      if (!val) continue;
      if (!result.portalName && /portal|employee|customer|supplier/i.test(val)) {
        result.portalName = val;
      } else if (!result.menuName && /^[A-Z][A-Z0-9_]+$/.test(val) && val.length > 4) {
        result.menuName = val;
      } else if (!result.componentName && /^[A-Z][A-Z0-9_]+$/.test(val)) {
        result.componentName = val;
      }
    }

    // Fallback: assign positionally if heuristics didn't work
    if (!result.portalName && this.binds[0]) result.portalName = this.binds[0];
    if (!result.menuName && this.binds[1]) result.menuName = this.binds[1];
    if (!result.componentName && this.binds[2]) result.componentName = this.binds[2];

    if (result.componentName || result.menuName || result.portalName) {
      this.detected = result;
    }
  }
}

/**
 * Parse a trace file using streaming line-by-line processing.
 * Never loads the entire file into memory.
 *
 * @param {string}   filePath   - Path to the trace file
 * @param {function} onProgress - Callback: { percent, linesProcessed, bytesProcessed, totalBytes, phase }
 * @param {function} onMetadata - Optional callback when component metadata is detected
 * @returns {Promise<object>} Consolidated parse results
 */
async function parseTraceFile(filePath, onProgress, onMetadata) {
  const stats = fs.statSync(filePath);
  const totalBytes = stats.size;

  const sqlAnalyzer   = new SqlAnalyzer();
  const loopDetector  = new LoopDetector();
  const eventParser   = new EventParser();
  const errorParser   = new ErrorParser();
  const variableTracer = new VariableTracer();
  const psiwcDetector = new PsiwceventsDetector();

  // Track unique process keys
  const processKeys = new Set();

  let linesProcessed   = 0;
  let bytesProcessed   = 0;
  let lastProgressUpdate = 0;
  const PROGRESS_INTERVAL = 250; // ms between progress updates

  const phases = [
    'Reading file...',
    'Parsing SQL statements...',
    'Detecting loop patterns...',
    'Analyzing event flow...',
    'Scanning for errors...',
    'Finalizing results...'
  ];

  if (onProgress) {
    onProgress({ percent: 0, linesProcessed: 0, bytesProcessed: 0, totalBytes, phase: phases[0] });
  }

  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    rl.on('line', (line) => {
      linesProcessed++;
      bytesProcessed += Buffer.byteLength(line, 'utf8') + 1;

      // Extract process context
      const { processKey, pid } = extractLineContext(line);
      if (pid) processKeys.add(processKey);

      // Dispatch to all sub-parsers (each strips headers internally)
      const sqlResult = sqlAnalyzer.processLine(line);
      loopDetector.processLine(line);
      eventParser.processLine(line);
      errorParser.processLine(line);
      variableTracer.processLine(line);
      psiwcDetector.processLine(line);

      // Cross-parser coordination: feed SQL data to loop detector
      if (sqlResult) {
        loopDetector.recordSql(sqlResult.sig, sqlResult.elapsed, sqlResult.preview);
      }

      // Emit metadata when PSIWCEVENTS context is detected
      if (psiwcDetector.detected && onMetadata) {
        onMetadata(psiwcDetector.detected);
        psiwcDetector.detected = null;
      }

      // Report progress at intervals
      const now = Date.now();
      if (onProgress && (now - lastProgressUpdate >= PROGRESS_INTERVAL)) {
        lastProgressUpdate = now;
        const percent = Math.min(99, Math.round((bytesProcessed / totalBytes) * 100));

        let phase;
        if (percent < 20) phase = phases[0];
        else if (percent < 40) phase = phases[1];
        else if (percent < 60) phase = phases[2];
        else if (percent < 80) phase = phases[3];
        else if (percent < 95) phase = phases[4];
        else phase = phases[5];

        onProgress({ percent, linesProcessed, bytesProcessed, totalBytes, phase });
      }
    });

    rl.on('close', () => {
      if (onProgress) {
        onProgress({ percent: 100, linesProcessed, bytesProcessed: totalBytes, totalBytes, phase: phases[5] });
      }

      // Defensive: guard each getResults() call
      let sqlResults, loopResults, eventResults, errorResults, variableResults;
      try { sqlResults = sqlAnalyzer.getResults(); } catch (e) {
        console.error('[Parser] sqlAnalyzer.getResults() failed:', e.message);
        sqlResults = { sqlGroups: [], sqlByTable: [], sqlStats: { totalStatements: 0, uniqueStatements: 0, totalSqlTime: 0, slowQueryCount: 0, nPlusOneCount: 0, topSlow: [], nPlusOnePatterns: [], allProcesses: [] } };
      }
      try { loopResults = loopDetector.getResults(); } catch (e) {
        console.error('[Parser] loopDetector.getResults() failed:', e.message);
        loopResults = { loopPatterns: [], codeLoops: [], totalWastedTime: 0, loopCount: 0, codeLoopCount: 0 };
      }
      try { eventResults = eventParser.getResults(); } catch (e) {
        console.error('[Parser] eventParser.getResults() failed:', e.message);
        eventResults = { eventFlow: [], flameData: [], eventCount: 0 };
      }
      try { errorResults = errorParser.getResults(); } catch (e) {
        console.error('[Parser] errorParser.getResults() failed:', e.message);
        errorResults = { errors: [], valueIssues: [], errorStats: { total: 0, critical: 0, warnings: 0, info: 0, valueIssueCount: 0 } };
      }
      try { variableResults = variableTracer.getResults(); } catch (e) {
        console.error('[Parser] variableTracer.getResults() failed:', e.message);
        variableResults = { events: [], uniqueVariables: 0, totalEvents: 0 };
      }

      const consolidated = {
        summary: {
          totalLines: linesProcessed,
          fileSize: totalBytes,
          fileSizeMB: Math.round(totalBytes / 1024 / 1024 * 100) / 100,
          processCount: processKeys.size || 1,
          processKeys: Array.from(processKeys).sort()
        },
        sql: sqlResults,
        loops: loopResults,
        events: eventResults,
        errors: errorResults,
        variables: variableResults
      };

      resolve(consolidated);
    });

    rl.on('error', (err) => reject(err));
    stream.on('error', (err) => reject(err));
  });
}

/**
 * Build a condensed prompt from parse results for the LLM.
 * Keeps under ~3000 tokens.
 */
function buildLlmPrompt(results) {
  const { summary, sql, loops, events, errors } = results;

  // Defensive: guard against missing sections
  const sqlStats  = sql?.sqlStats  || {};
  const loopData  = loops          || {};
  const eventData = events         || {};
  const errData   = errors         || {};
  const errStats  = errData.errorStats || {};

  let prompt = `## Trace File Analysis Results\n\n`;
  prompt += `**Overview:** ${(summary?.totalLines || 0).toLocaleString()} lines, ${summary?.fileSizeMB || 0}MB file`;
  if ((summary?.processCount || 0) > 1) {
    prompt += `, ${summary.processCount} processes`;
  }
  prompt += '\n';
  prompt += `**SQL:** ${sqlStats.totalStatements || 0} total statements, ${sqlStats.uniqueStatements || 0} unique, ${sqlStats.slowQueryCount || 0} slow queries\n`;
  prompt += `**Loops:** ${loopData.loopCount || 0} loop patterns detected, ${loopData.totalWastedTime || 0}s estimated wasted time\n`;
  prompt += `**Events:** ${eventData.eventCount || 0} PeopleCode events\n`;
  prompt += `**Errors:** ${errStats.total || 0} total (${errStats.critical || 0} critical, ${errStats.warnings || 0} warnings)\n`;
  prompt += `**Value Issues:** ${errStats.valueIssueCount || 0} (${errStats.nullValueCount || 0} null/null-bind propagation)\n\n`;

  // Top 5 slow SQL
  if (sqlStats.topSlow?.length > 0) {
    prompt += `### Top Slow SQL Statements\n`;
    sqlStats.topSlow.slice(0, 5).forEach((s, i) => {
      prompt += `${i + 1}. [${s.totalTime.toFixed(3)}s total, ${s.count}x] ${s.preview}\n`;
    });
    prompt += '\n';
  }

  // N+1 patterns
  if (sqlStats.nPlusOnePatterns?.length > 0) {
    prompt += `### N+1 Query Patterns\n`;
    sqlStats.nPlusOnePatterns.slice(0, 3).forEach((p, i) => {
      prompt += `${i + 1}. ${p.sqlPreview} (${p.consecutiveHits} consecutive hits)\n`;
    });
    prompt += '\n';
  }

  // Top loop patterns
  if (loopData.loopPatterns?.length > 0) {
    prompt += `### Loop Patterns\n`;
    loopData.loopPatterns.slice(0, 3).forEach((l, i) => {
      prompt += `${i + 1}. [${l.repeatCount}x, ${l.totalWastedTime}s wasted] at ${l.location}: ${l.sqlPreview}\n`;
    });
    prompt += '\n';
  }

  // Top errors
  if (errData.errors?.length > 0) {
    prompt += `### Top Errors\n`;
    errData.errors.slice(0, 5).forEach((e, i) => {
      prompt += `${i + 1}. [${e.severity.toUpperCase()}] ${e.title} — ${e.program}\n`;
    });
    prompt += '\n';
  }

  // Value issues
  if (errData.valueIssues?.length > 0) {
    prompt += `### Value Issues\n`;
    errData.valueIssues.slice(0, 5).forEach((v, i) => {
      prompt += `${i + 1}. [${v.type}] ${v.variable} at ${v.location}: ${v.description}\n`;
    });
  }

  return prompt;
}

module.exports = { parseTraceFile, buildLlmPrompt };
