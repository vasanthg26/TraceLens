/**
 * errorParser.js
 * Purpose: Scan for errors/warnings/exceptions in PeopleTools trace format,
 *          capture clean PeopleCode + SQL context, detect value issues
 * Author: TraceLens
 *
 * Trace format (actual PeopleTools):
 *   Context from: >>>>> Begin RECORD.FIELD.EventName level X row Y
 *   PeopleCode:   N: code line
 *   SQL:          Cur#... Dur=... COM Stmt=...
 *   Errors:       "catch Exception", SQL errors via RC!=0, PeopleCode errors
 *   Values:       "Fetch Field: RECORD.FIELD Value=X"
 */

const classifyProgram = require('./classifyProgram');

// Pre-compiled regex patterns for hot-path processLine
const RE_ERR_STRIP = /\d+-\d+\s+[\d.]+\s+(.*)/;
const RE_ERR_BEGIN = />>>>>\s*Begin\s+(\S+)\.(\S+)\.(\S+)\s+level/;
const RE_ERR_CODE_LINE = /^\s*(\d+):\s*(.*)/;
const RE_ERR_SQL = /Cur#[\d.]+\.\w+\s+RC=(\d+)\s+Dur=([\d.]+)\s+COM\s+Stmt=(.+)/;
const RE_ERR_FETCH_STORE = /(Fetch|Store) Field:\s+(\S+)\s+Value=(.*)/;
const RE_ERR_DETECT = /\b(Error|PeopleCode Error|Warning|Exception|Uninitialized|SQL Error)\b/i;
const RE_ERR_RC = /Cur#[\d.]+\.\w+\s+RC=(\d+)/;
const RE_ERR_EPO = /EPO\s+error\s+pos=(\d+)[:\s]+(.*)/i;
const RE_ERR_RTNCD = /ERR\s+rtncd=(\d+)/i;
const RE_BEGIN_MARKER = />>>>>\s*Begin/;
const RE_UNINIT = /Uninitialized variable[:\s]+(\S+)/i;
const RE_NULL_FETCH = /Fetch Field:\s+(\S+)\s+Contains Null Value/i;
const RE_EMPTY_FETCH = /Fetch Field:\s+(\S+)\s+Value=\s*$/;
const RE_BIND_NULL = /Bind-(\d+)\s+type=\S+\s+length=(\d+)\s+value=(.*)/i;

class ErrorParser {
  constructor() {
    this.errors = [];
    this.valueIssues = [];
    this.contextSize = 8; // more context for richer error display
    this.afterLinesNeeded = new Map();
    this.lineNumber = 0;
    this.currentProgram = '';
    this.currentEvent = '';

    // Clean context buffers (stripped of trace headers)
    this.codeBuffer = [];     // recent PeopleCode lines
    this.sqlBuffer = [];      // recent SQL statements
    this.rawContextBuffer = []; // raw lines for fallback

    // Null propagation tracking: fields fetched as null → may be used in SQL binds
    this._nullFields = new Set();    // fields seen with "Contains Null Value"
    this._lastCursorHadNullBind = false;
  }

  /**
   * Strip trace header, return clean content.
   */
  stripHeader(line) {
    const match = line.match(RE_ERR_STRIP);
    return match ? match[1] : line.trim();
  }

  /**
   * Classify severity based on the error content.
   */
  classifySeverity(line) {
    const upper = line.toUpperCase();
    if (upper.includes('PEOPLECODE ERROR') || upper.includes('SQL ERROR') || upper.includes('EXCEPTION')) {
      return 'critical';
    }
    if (upper.includes('WARNING') || upper.includes('UNINITIALIZED')) {
      return 'warning';
    }
    return 'info';
  }

  /**
   * Extract error title from the line.
   */
  extractTitle(line) {
    const pcErrorMatch = line.match(/PeopleCode Error at\s+(.*)/i);
    if (pcErrorMatch) return pcErrorMatch[1].trim().substring(0, 120);

    const sqlErrorMatch = line.match(/SQL Error[:\s]+(.*)/i);
    if (sqlErrorMatch) return sqlErrorMatch[1].trim().substring(0, 120);

    const exceptionMatch = line.match(/catch\s+Exception\s+(.*)/i);
    if (exceptionMatch) return `Exception handler: ${exceptionMatch[1].trim().substring(0, 100)}`;

    // Error MsgGet(msgSetNbr, msgNbr, defaultText, ...) — extract set/number and default text
    const msgGetMatch = line.match(/Error\s+MsgGet\(\s*(\d+)\s*,\s*(\d+)\s*,\s*"([^"]+)"/i);
    if (msgGetMatch) return `MsgGet(${msgGetMatch[1]},${msgGetMatch[2]}): ${msgGetMatch[3].trim().substring(0, 100)}`;

    const errorMatch = line.match(/Error[:\s]+(.*)/i);
    if (errorMatch) return errorMatch[1].trim().substring(0, 120);

    const warnMatch = line.match(/Warning[:\s]+(.*)/i);
    if (warnMatch) return warnMatch[1].trim().substring(0, 120);

    return line.trim().substring(0, 120);
  }

  /**
   * Process a single line from the trace file.
   */
  processLine(line) {
    this.lineNumber++;
    const trimmed = line.trim();
    const content = this.stripHeader(trimmed);

    // Track program/event context from Begin markers
    const beginMatch = trimmed.match(RE_ERR_BEGIN);
    if (beginMatch) {
      this.currentProgram = `${beginMatch[1]}.${beginMatch[2]}`;
      this.currentEvent = beginMatch[3];
      this._nullFields.clear(); // reset null tracking per event
    }

    // Track PeopleCode lines (clean, with line numbers)
    const codeLineMatch = content.match(RE_ERR_CODE_LINE);
    if (codeLineMatch) {
      this.codeBuffer.push({
        lineNum: parseInt(codeLineMatch[1]),
        code: codeLineMatch[2].trim(),
        traceLineNumber: this.lineNumber
      });
      if (this.codeBuffer.length > this.contextSize) {
        this.codeBuffer.shift();
      }
    }

    // Track SQL statements (clean)
    const sqlMatch = trimmed.match(RE_ERR_SQL);
    if (sqlMatch) {
      this.sqlBuffer.push({
        rc: parseInt(sqlMatch[1]),
        duration: parseFloat(sqlMatch[2]),
        stmt: sqlMatch[3].substring(0, 300),
        traceLineNumber: this.lineNumber
      });
      if (this.sqlBuffer.length > 5) {
        this.sqlBuffer.shift();
      }
    }

    // Track Fetch/Store for context
    const fetchStoreMatch = content.match(RE_ERR_FETCH_STORE);

    // Collect "after" context for pending errors
    for (const [errorIdx, remaining] of this.afterLinesNeeded) {
      const afterEntry = this.buildCleanLine(content, codeLineMatch, sqlMatch, fetchStoreMatch);
      if (afterEntry) {
        this.errors[errorIdx].contextAfter.push(afterEntry);
      }
      if (remaining <= 1) {
        this.afterLinesNeeded.delete(errorIdx);
      } else {
        this.afterLinesNeeded.set(errorIdx, remaining - 1);
      }
    }

    // Detect errors, warnings, exceptions.
    // Skip PeopleCode source code lines (e.g. "5: catch Exception &e") — these are traced
    // program text, not actual error conditions. Matching "Exception" on those lines causes
    // thousands of false CRITICAL entries for every try/catch block in every program.
    const isPcCodeLine = !!codeLineMatch;
    const isError = !isPcCodeLine && RE_ERR_DETECT.test(trimmed);

    // Detect SQL errors via return codes > 1
    // RC=0 = success, RC=1 = no rows (normal for Fetch), RC>1 = real DB error
    const rcMatch = trimmed.match(RE_ERR_RC);
    const isSqlError = rcMatch && parseInt(rcMatch[1], 10) > 1;

    // Detect EPO (SQL parse error) and ERR (SQL runtime error) lines
    const epoMatch = trimmed.match(RE_ERR_EPO);
    if (epoMatch) {
      this.errors.push({
        severity: 'critical',
        title: `SQL parse error at position ${epoMatch[1]}: ${epoMatch[2].trim().substring(0, 120)}`,
        rawLine: content.substring(0, 300),
        program: this.currentProgram,
        event: this.currentEvent,
        category: this._classifyProgram(this.currentProgram),
        traceLineNumber: this.lineNumber,
        codeContext: [...this.codeBuffer],
        sqlContext: [...this.sqlBuffer],
        contextBefore: this.rawContextBuffer.slice(-this.contextSize).map(l => this.stripHeader(l)),
        contextAfter: []
      });
    }

    const errMatch = trimmed.match(RE_ERR_RTNCD);
    if (errMatch && errMatch[1] !== '0') {
      this.errors.push({
        severity: 'warning',
        title: `SQL runtime error: rtncd=${errMatch[1]}`,
        rawLine: content.substring(0, 300),
        program: this.currentProgram,
        event: this.currentEvent,
        category: this._classifyProgram(this.currentProgram),
        traceLineNumber: this.lineNumber,
        codeContext: [...this.codeBuffer],
        sqlContext: [...this.sqlBuffer],
        contextBefore: this.rawContextBuffer.slice(-this.contextSize).map(l => this.stripHeader(l)),
        contextAfter: []
      });
    }

    if (isError || isSqlError) {
      const severity = isSqlError ? 'warning' : this.classifySeverity(content);
      const title = isSqlError
        ? `SQL returned RC=${rcMatch[1]}`
        : this.extractTitle(content);

      const errorEntry = {
        severity,
        title,
        rawLine: content.substring(0, 300),
        program: this.currentProgram,
        event: this.currentEvent,
        category: this._classifyProgram(this.currentProgram),
        traceLineNumber: this.lineNumber,
        // Clean PeopleCode context (before)
        codeContext: [...this.codeBuffer],
        // Recent SQL near this error
        sqlContext: [...this.sqlBuffer],
        // Raw context for fallback
        contextBefore: this.rawContextBuffer.slice(-this.contextSize).map(l => this.stripHeader(l)),
        contextAfter: []
      };

      // Extract the SQL statement if this is a SQL error
      if (isSqlError && sqlMatch) {
        errorEntry.errorSql = sqlMatch[3].substring(0, 500);
        errorEntry.errorSqlRc = parseInt(rcMatch[1]);
        errorEntry.errorSqlDur = parseFloat(sqlMatch[2]);
      }

      const idx = this.errors.length;
      this.errors.push(errorEntry);
      this.afterLinesNeeded.set(idx, this.contextSize);
    }

    // Detect value issues
    this.detectValueIssues(trimmed, content);

    // Maintain raw context buffer
    this.rawContextBuffer.push(trimmed);
    if (this.rawContextBuffer.length > this.contextSize) {
      this.rawContextBuffer.shift();
    }
  }

  /**
   * Build a clean context line entry for display.
   */
  buildCleanLine(content, codeMatch, sqlMatch, fetchStoreMatch) {
    if (codeMatch) {
      return { type: 'code', lineNum: parseInt(codeMatch[1]), text: codeMatch[2].trim() };
    }
    if (sqlMatch) {
      return { type: 'sql', text: sqlMatch[3].substring(0, 200), rc: parseInt(sqlMatch[1]) };
    }
    if (fetchStoreMatch) {
      return { type: 'field', action: fetchStoreMatch[1], field: fetchStoreMatch[2], value: fetchStoreMatch[3] };
    }
    if (RE_BEGIN_MARKER.test(content)) {
      return { type: 'event', text: content };
    }
    return null;
  }

  /**
   * Detect value-related issues from PeopleTools trace patterns.
   */
  detectValueIssues(line, content) {
    // Uninitialized variable
    const uninitMatch = line.match(RE_UNINIT);
    if (uninitMatch) {
      this.valueIssues.push({
        type: 'UNINIT',
        variable: uninitMatch[1],
        category: this._classifyProgram(this.currentProgram),
        location: `${this.currentProgram} > ${this.currentEvent}`,
        description: `Uninitialized variable "${uninitMatch[1]}" — may cause unexpected behavior in SQL binds or conditionals`,
        fix: `Initialize "${uninitMatch[1]}" before use. Check if it's populated from a Component Buffer field that may be empty on new rows.`,
        traceLineNumber: this.lineNumber,
        codeContext: [...this.codeBuffer]
      });
    }

    // Fetch Field: RECORD.FIELD Contains Null Value
    const nullFetchMatch = content.match(RE_NULL_FETCH);
    if (nullFetchMatch) {
      const field = nullFetchMatch[1];
      this._nullFields.add(field.split('.').pop()); // track just the field name
      this.valueIssues.push({
        type: 'NULL',
        variable: field,
        category: this._classifyProgram(this.currentProgram),
        location: `${this.currentProgram} > ${this.currentEvent}`,
        description: `Field "${field}" contains null value — if used in SQL bind or conditional, this may cause incorrect results or errors`,
        fix: `Check if "${field.split('.').pop()}" is populated before use. The rowset may have been filled with no matching rows, leaving default (null) values.`,
        traceLineNumber: this.lineNumber,
        codeContext: [...this.codeBuffer]
      });
    }

    // Detect empty/null values from Fetch Field: X Value= (empty at end)
    const fetchMatch = content.match(RE_EMPTY_FETCH);
    if (fetchMatch) {
      this.valueIssues.push({
        type: 'EMPTY',
        variable: fetchMatch[1],
        category: this._classifyProgram(this.currentProgram),
        location: `${this.currentProgram} > ${this.currentEvent}`,
        description: `Field "${fetchMatch[1]}" fetched with empty value`,
        fix: `Add a null check: If All(${fetchMatch[1].split('.').pop()}) Then ... End-If`,
        traceLineNumber: this.lineNumber,
        codeContext: [...this.codeBuffer]
      });
    }

    // Null propagation: Bind with empty/whitespace-only value when we've seen null fields recently
    // e.g. Bind-2 type=2 length=1 value= (single space = null passed to SQL)
    const bindNullMatch = line.match(RE_BIND_NULL);
    if (bindNullMatch && this._nullFields.size > 0) {
      const bindVal = bindNullMatch[3];
      const bindLen = parseInt(bindNullMatch[2], 10);
      if (bindLen <= 1 && (!bindVal || !bindVal.trim())) {
        this.valueIssues.push({
          type: 'NULL_BIND',
          variable: `Bind-${bindNullMatch[1]}`,
          category: this._classifyProgram(this.currentProgram),
          location: `${this.currentProgram} > ${this.currentEvent}`,
          description: `Null/empty value passed as Bind-${bindNullMatch[1]} to SQL — likely from a field that "Contains Null Value". SQL results may be incorrect or trigger unexpected error conditions.`,
          fix: `Verify that all field values used as SQL bind variables are populated before the SQL executes. Check preceding "Fetch Field ... Contains Null Value" lines.`,
          traceLineNumber: this.lineNumber,
          codeContext: [...this.codeBuffer],
          sqlContext: [...this.sqlBuffer]
        });
      }
    }

    // Numeric overflow
    if (/overflow|numeric value out of range/i.test(line)) {
      this.valueIssues.push({
        type: 'OVERFLOW',
        variable: 'numeric field',
        category: this._classifyProgram(this.currentProgram),
        location: `${this.currentProgram} > ${this.currentEvent}`,
        description: `Numeric overflow detected — value exceeds field capacity`,
        fix: `Check field length definition and validate input range before assignment.`,
        traceLineNumber: this.lineNumber,
        codeContext: [...this.codeBuffer]
      });
    }
  }

  _classifyProgram(program) {
    return classifyProgram(program);
  }

  /**
   * Return final results.
   */
  getResults() {
    return {
      errors: this.errors.sort((a, b) => {
        const severityOrder = { critical: 0, warning: 1, info: 2 };
        return (severityOrder[a.severity] || 2) - (severityOrder[b.severity] || 2);
      }),
      valueIssues: this.valueIssues,
      errorStats: {
        total: this.errors.length,
        critical: this.errors.filter(e => e.severity === 'critical').length,
        warnings: this.errors.filter(e => e.severity === 'warning').length,
        info: this.errors.filter(e => e.severity === 'info').length,
        valueIssueCount: this.valueIssues.length,
        nullValueCount: this.valueIssues.filter(v => v.type === 'NULL' || v.type === 'NULL_BIND').length
      }
    };
  }
}

module.exports = ErrorParser;
