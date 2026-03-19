/**
 * streamParser.js
 * Purpose: Coordinate line-by-line streaming read of trace files, dispatch to sub-parsers
 * Author: TraceLens
 */

const fs = require('fs');
const readline = require('readline');
const SqlAnalyzer = require('./sqlAnalyzer');
const LoopDetector = require('./loopDetector');
const EventParser = require('./eventParser');
const ErrorParser = require('./errorParser');
const VariableTracer = require('./variableTracer');

/**
 * Parse a trace file using streaming line-by-line processing.
 * Never loads the entire file into memory.
 *
 * @param {string} filePath - Path to the trace file
 * @param {function} onProgress - Callback: { percent, linesProcessed, phase }
 * @returns {Promise<object>} Consolidated parse results
 */
async function parseTraceFile(filePath, onProgress) {
  const stats = fs.statSync(filePath);
  const totalBytes = stats.size;

  const sqlAnalyzer = new SqlAnalyzer();
  const loopDetector = new LoopDetector();
  const eventParser = new EventParser();
  const errorParser = new ErrorParser();
  const variableTracer = new VariableTracer();

  let linesProcessed = 0;
  let bytesRead = 0;
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

  // Report initial progress
  if (onProgress) {
    onProgress({ percent: 0, linesProcessed: 0, phase: phases[0] });
  }

  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    rl.on('line', (line) => {
      linesProcessed++;
      bytesRead += Buffer.byteLength(line, 'utf8') + 1; // +1 for newline

      // Dispatch to all sub-parsers
      const sqlResult = sqlAnalyzer.processLine(line);
      loopDetector.processLine(line);
      eventParser.processLine(line);
      errorParser.processLine(line);
      variableTracer.processLine(line);

      // Cross-parser coordination: feed SQL data to loop detector
      if (sqlResult) {
        loopDetector.recordSql(sqlResult.sig, sqlResult.elapsed, sqlResult.preview);
      }

      // Report progress at intervals (avoid flooding WebSocket)
      const now = Date.now();
      if (onProgress && (now - lastProgressUpdate >= PROGRESS_INTERVAL)) {
        lastProgressUpdate = now;
        const percent = Math.min(99, Math.round((bytesRead / totalBytes) * 100));

        // Determine current phase based on progress
        let phase;
        if (percent < 20) phase = phases[0];
        else if (percent < 40) phase = phases[1];
        else if (percent < 60) phase = phases[2];
        else if (percent < 80) phase = phases[3];
        else if (percent < 95) phase = phases[4];
        else phase = phases[5];

        onProgress({ percent, linesProcessed, phase });
      }
    });

    rl.on('close', () => {
      // Final progress
      if (onProgress) {
        onProgress({ percent: 100, linesProcessed, phase: phases[5] });
      }

      // Gather results from all sub-parsers
      const sqlResults = sqlAnalyzer.getResults();
      const loopResults = loopDetector.getResults();
      const eventResults = eventParser.getResults();
      const errorResults = errorParser.getResults();
      const variableResults = variableTracer.getResults();

      const consolidated = {
        summary: {
          totalLines: linesProcessed,
          fileSize: totalBytes,
          fileSizeMB: Math.round(totalBytes / 1024 / 1024 * 100) / 100
        },
        sql: sqlResults,
        loops: loopResults,
        events: eventResults,
        errors: errorResults,
        variables: variableResults
      };

      resolve(consolidated);
    });

    rl.on('error', (err) => {
      reject(err);
    });

    stream.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Build a condensed prompt from parse results for the LLM.
 * Keeps under ~3000 tokens.
 */
function buildLlmPrompt(results) {
  const { summary, sql, loops, events, errors } = results;

  let prompt = `## Trace File Analysis Results\n\n`;
  prompt += `**Overview:** ${summary.totalLines.toLocaleString()} lines, ${summary.fileSizeMB}MB file\n`;
  prompt += `**SQL:** ${sql.sqlStats.totalStatements} total statements, ${sql.sqlStats.uniqueStatements} unique, ${sql.sqlStats.slowQueryCount} slow queries\n`;
  prompt += `**Loops:** ${loops.loopCount} loop patterns detected, ${loops.totalWastedTime}s estimated wasted time\n`;
  prompt += `**Events:** ${events.eventCount} PeopleCode events\n`;
  prompt += `**Errors:** ${errors.errorStats.total} total (${errors.errorStats.critical} critical, ${errors.errorStats.warnings} warnings)\n`;
  prompt += `**Value Issues:** ${errors.errorStats.valueIssueCount}\n\n`;

  // Top 5 slow SQL
  if (sql.sqlStats.topSlow.length > 0) {
    prompt += `### Top Slow SQL Statements\n`;
    sql.sqlStats.topSlow.slice(0, 5).forEach((s, i) => {
      prompt += `${i + 1}. [${s.totalTime.toFixed(3)}s total, ${s.count}x] ${s.preview}\n`;
    });
    prompt += '\n';
  }

  // N+1 patterns
  if (sql.sqlStats.nPlusOnePatterns.length > 0) {
    prompt += `### N+1 Query Patterns\n`;
    sql.sqlStats.nPlusOnePatterns.slice(0, 3).forEach((p, i) => {
      prompt += `${i + 1}. ${p.sqlPreview} (${p.consecutiveHits} consecutive hits)\n`;
    });
    prompt += '\n';
  }

  // Top loop patterns
  if (loops.loopPatterns.length > 0) {
    prompt += `### Loop Patterns\n`;
    loops.loopPatterns.slice(0, 3).forEach((l, i) => {
      prompt += `${i + 1}. [${l.repeatCount}x, ${l.totalWastedTime}s wasted] at ${l.location}: ${l.sqlPreview}\n`;
    });
    prompt += '\n';
  }

  // Top errors
  if (errors.errors.length > 0) {
    prompt += `### Top Errors\n`;
    errors.errors.slice(0, 5).forEach((e, i) => {
      prompt += `${i + 1}. [${e.severity.toUpperCase()}] ${e.title} — ${e.program}\n`;
    });
    prompt += '\n';
  }

  // Value issues
  if (errors.valueIssues.length > 0) {
    prompt += `### Value Issues\n`;
    errors.valueIssues.slice(0, 5).forEach((v, i) => {
      prompt += `${i + 1}. [${v.type}] ${v.variable} at ${v.location}: ${v.description}\n`;
    });
  }

  return prompt;
}

module.exports = { parseTraceFile, buildLlmPrompt };
