/**
 * loopDetector.js
 * Purpose: Detect repeated SQL patterns AND PeopleCode loop constructs (For, While, Repeat)
 *          that contain SQL — flags performance anti-patterns
 * Author: TraceLens
 */

// Pre-compiled regex patterns for hot-path processLine
const RE_BEGIN_CTX = />>>>>\s*Begin\s+(\S+)\.(\S+)\.(\S+)\s+level/;
const RE_FOR = /^\s*For\s+&\w+\s*=\s*.+\s+To\s+/i;
const RE_WHILE = /^\s*While\s+/i;
const RE_REPEAT = /^\s*Repeat\s*$/i;
const RE_END_FOR = /^\s*End-For\s*;?\s*$/i;
const RE_END_WHILE = /^\s*End-While\s*;?\s*$/i;
const RE_UNTIL = /^\s*Until\s+/i;
const RE_SQL_CALL = /\b(SQLExec|CreateSQL|GetSQL|DoSelect|ScrollSelect|ScrollSelectNew)\s*\(/i;

class LoopDetector {
  constructor() {
    // SQL repetition detection (sliding window)
    this.window = [];
    this.windowSize = 10;
    this.loopPatterns = [];
    this.detectedSignatures = new Set();
    this.currentContext = { program: '', event: '', record: '' };
    this.totalWastedTime = 0;

    // PeopleCode loop construct detection
    this.codeLoops = [];
    this.loopStack = [];       // Stack of active loop constructs
    this.lineNumber = 0;
    this.sqlInsideLoop = 0;    // Count of SQL calls seen inside current loop
    this.currentLoopSqlSigs = new Set(); // SQL signatures inside current loop
  }

  /**
   * Process a single line from the trace file.
   * Tracks program context AND detects PeopleCode loop constructs.
   */
  processLine(line) {
    this.lineNumber++;
    const trimmed = line.trim();

    // Track current program context from >>>>> Begin markers
    const beginMatch = trimmed.match(RE_BEGIN_CTX);
    if (beginMatch) {
      this.currentContext = {
        program: `${beginMatch[1]}.${beginMatch[2]}`,
        event: beginMatch[3],
        record: beginMatch[1]
      };
    }

    // ── Detect PeopleCode loop starts ──

    // For loop: "For &i = 1 To &count" or "For &i = 1 to &rs.ActiveRowCount"
    const forMatch = trimmed.match(RE_FOR);
    if (forMatch) {
      this.pushLoop('For', trimmed);
      return;
    }

    // While loop: "While ..."
    const whileMatch = trimmed.match(RE_WHILE);
    if (whileMatch) {
      this.pushLoop('While', trimmed);
      return;
    }

    // Repeat loop: "Repeat"
    const repeatMatch = trimmed.match(RE_REPEAT);
    if (repeatMatch) {
      this.pushLoop('Repeat', trimmed);
      return;
    }

    // ── Detect PeopleCode loop ends ──

    // "End-For"
    if (RE_END_FOR.test(trimmed)) {
      this.popLoop('For');
      return;
    }

    // "End-While"
    if (RE_END_WHILE.test(trimmed)) {
      this.popLoop('While');
      return;
    }

    // "Until <condition>"
    if (RE_UNTIL.test(trimmed)) {
      this.popLoop('Repeat');
      return;
    }

    // ── Detect SQL calls inside loops ──
    if (this.loopStack.length > 0) {
      // SQLExec, CreateSQL, GetSQL, DoSelect — common SQL call patterns in PeopleCode
      if (RE_SQL_CALL.test(trimmed)) {
        this.loopStack[this.loopStack.length - 1].sqlCount++;
        this.loopStack[this.loopStack.length - 1].sqlCalls.push(
          trimmed.substring(0, 120)
        );
      }

      // Also detect trace-level SQL markers inside loops
      if (trimmed.startsWith('SQL:') || trimmed === 'SQL:') {
        this.loopStack[this.loopStack.length - 1].sqlCount++;
      }
    }
  }

  /**
   * Push a new loop construct onto the stack.
   */
  pushLoop(type, rawLine) {
    this.loopStack.push({
      type,
      rawLine: rawLine.substring(0, 150),
      startLine: this.lineNumber,
      context: { ...this.currentContext },
      sqlCount: 0,
      sqlCalls: [],
      nestingDepth: this.loopStack.length
    });
  }

  /**
   * Pop a loop construct and evaluate if it's a performance issue.
   */
  popLoop() {
    if (this.loopStack.length === 0) return;

    const loop = this.loopStack.pop();

    // Only flag loops that contain SQL calls — that's the anti-pattern
    if (loop.sqlCount > 0) {
      const location = loop.context.program
        ? `${loop.context.program} > ${loop.context.record}.${loop.context.event}`
        : 'Unknown location';

      this.codeLoops.push({
        type: 'code-loop',
        loopType: loop.type,
        loopStatement: loop.rawLine,
        sqlCount: loop.sqlCount,
        sqlCalls: loop.sqlCalls.slice(0, 5), // Keep up to 5 examples
        startLine: loop.startLine,
        endLine: this.lineNumber,
        location,
        nestingDepth: loop.nestingDepth,
        severity: this.classifyCodeLoopSeverity(loop),
        fixHint: this.generateCodeLoopFixHint(loop)
      });
    }
  }

  /**
   * Classify severity of a code loop based on SQL count and nesting.
   */
  classifyCodeLoopSeverity(loop) {
    if (loop.nestingDepth > 0 && loop.sqlCount > 0) return 'critical'; // Nested loop with SQL
    if (loop.sqlCount >= 3) return 'critical';
    if (loop.sqlCount >= 1) return 'warning';
    return 'info';
  }

  /**
   * Generate fix hint for PeopleCode loop with SQL inside.
   */
  generateCodeLoopFixHint(loop) {
    const sqlExample = loop.sqlCalls[0] || '';
    const upper = sqlExample.toUpperCase();

    if (loop.nestingDepth > 0) {
      return `Nested ${loop.type} loop contains ${loop.sqlCount} SQL call(s). ` +
        `This is an N+1 (or worse) pattern. Move SQL outside the inner loop, ` +
        `use a join/view to fetch all data in one query, or cache results in an array before the loop.`;
    }

    if (upper.includes('SQLEXEC') && upper.includes('SELECT')) {
      return `${loop.type} loop contains SQLExec SELECT. ` +
        `Fetch all needed data into a Rowset or array before the loop using CreateRowset/Fill(), ` +
        `then iterate the in-memory rowset instead of querying per iteration.`;
    }

    if (upper.includes('SQLEXEC') && (upper.includes('UPDATE') || upper.includes('INSERT'))) {
      return `${loop.type} loop contains SQLExec UPDATE/INSERT. ` +
        `Consider batching: build a single SQL with multiple value sets, ` +
        `use a staging temp table, or use Record.Update()/Insert() on a rowset.`;
    }

    if (upper.includes('SCROLLSELECT') || upper.includes('DOSELECT')) {
      return `${loop.type} loop contains ScrollSelect/DoSelect. ` +
        `This re-queries the database each iteration. Restructure to select once ` +
        `before the loop and filter in memory.`;
    }

    return `${loop.type} loop contains ${loop.sqlCount} SQL call(s). ` +
      `Each iteration causes a database round-trip. Refactor to minimize SQL ` +
      `inside loops — query once, process in memory.`;
  }

  /**
   * Called by streamParser when a SQL statement is recorded.
   * Accepts the signature, elapsed time, and SQL preview.
   */
  recordSql(signature, elapsed, sqlPreview) {
    this.window.push({ signature, elapsed, sqlPreview, context: { ...this.currentContext } });
    if (this.window.length > this.windowSize) {
      this.window.shift();
    }

    this.detectLoop(signature);
  }

  /**
   * Check if the current signature forms a repeated SQL pattern.
   */
  detectLoop(currentSig) {
    if (this.detectedSignatures.has(currentSig)) return;
    if (this.window.length < 3) return;

    let count = 0;
    let totalTime = 0;
    let context = null;

    for (let i = this.window.length - 1; i >= 0; i--) {
      if (this.window[i].signature === currentSig) {
        count++;
        totalTime += this.window[i].elapsed;
        if (!context) context = this.window[i].context;
      } else {
        break;
      }
    }

    if (count >= 3) {
      this.detectedSignatures.add(currentSig);
      const sqlPreview = this.window[this.window.length - 1].sqlPreview;
      const wastedTime = Math.round(totalTime * 1000) / 1000;
      this.totalWastedTime += wastedTime;

      this.loopPatterns.push({
        type: 'sql-repeat',
        signature: currentSig,
        sqlPreview,
        repeatCount: count,
        totalWastedTime: wastedTime,
        location: context
          ? `${context.program} > ${context.record}.${context.event}`
          : 'Unknown location',
        fixHint: this.generateFixHint(sqlPreview, count)
      });
    }
  }

  /**
   * Generate a fix hint for repeated SQL patterns.
   */
  generateFixHint(sqlPreview, count) {
    const upper = sqlPreview.toUpperCase();

    if (upper.includes('SELECT') && count >= 5) {
      return 'Consider using a SQL join or subquery to fetch all rows in a single statement instead of querying inside a loop. Use a ScrollSelect or a view with the required join.';
    }
    if (upper.includes('SELECT')) {
      return 'Move this SQL outside the loop and cache results in an array or record. Use GetRow() on the cached rowset instead of re-querying.';
    }
    if (upper.includes('UPDATE')) {
      return 'Batch updates using a single UPDATE with an IN clause or use SetDefault/SetEditTable pattern to reduce round-trips.';
    }
    if (upper.includes('INSERT')) {
      return 'Use bulk insert techniques or stage data in a temporary table, then insert all rows at once.';
    }
    return `This SQL repeats ${count}+ times consecutively. Refactor to execute once and cache the result.`;
  }

  /**
   * Return final results — both SQL repeat patterns and PeopleCode loop constructs.
   */
  getResults() {
    // Flush any unclosed loops (trace may be truncated)
    while (this.loopStack.length > 0) {
      this.popLoop();
    }

    return {
      loopPatterns: this.loopPatterns.sort((a, b) => b.totalWastedTime - a.totalWastedTime),
      codeLoops: this.codeLoops.sort((a, b) => {
        const sevOrder = { critical: 0, warning: 1, info: 2 };
        return (sevOrder[a.severity] || 2) - (sevOrder[b.severity] || 2);
      }),
      totalWastedTime: Math.round(this.totalWastedTime * 1000) / 1000,
      loopCount: this.loopPatterns.length,
      codeLoopCount: this.codeLoops.length
    };
  }
}

module.exports = LoopDetector;
