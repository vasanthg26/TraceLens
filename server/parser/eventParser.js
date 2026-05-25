/**
 * eventParser.js
 * Purpose: Parse PeopleCode program markers from PeopleTools trace files.
 *          Supports two trace formats:
 *
 *          Legacy (PT 8.4x):
 *            >>> start Nest=00 . Record.Field.EventName
 *            >>> start-ext Nest=01 FunctionName Record.Field.EventName
 *            <<< end Nest=00 . Record.Field.EventName Dur=0.050
 *            <<< end-ext Nest=01 FunctionName Record.Field.EventName Dur=0.030
 *
 *          New (PT 8.5x+):
 *            >>>>> Begin Record.Field.Event level N row N
 *            <<<<< End Record.Field.Event level N row N Dur=N.NNN
 *
 *          App Class calls:
 *            call constructor Record.Field.Event
 *            call method MethodName Record.Field.Event
 *            call setter PropertyName Record.Field.Event
 *            call getter PropertyName Record.Field.Event
 *
 *          Parameter value lines (follow call lines):
 *            Str[N]=value, Bool=value, Num=value, Object=value
 *
 * Author: TraceLens
 */

const classifyProgram = require('./classifyProgram');

class EventParser {
  constructor() {
    // Open events awaiting their end marker
    this.eventStack = [];

    // Flat list of start/end records — used by EventFlowPanel in the UI
    this.eventFlow = [];

    // Top-level flame chart nodes
    this.flameData = [];

    // Parallel stack of flame nodes being built
    this.flameStack = [];

    this.eventCount = 0;

    // Lines captured while inside the innermost open event
    this.currentEventLines = [];

    // Track the last call line for associating parameter values
    this._lastCallIdx = -1;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Process one raw trace line.
   */
  processLine(line) {
    const content = this._stripHeader(line);

    // ── New format: >>>>> Begin Record.Field.Event level N row N ────────────
    const beginMatch = content.match(/^>>>>>\s+Begin\s+(\S+)\s+level\s+(\d+)\s+row\s+(\d+)/);
    if (beginMatch) {
      const program = beginMatch[1];
      const level = parseInt(beginMatch[2], 10);
      this._handleStart(level, null, program, 'new');
      return;
    }

    // ── New format: <<<<< End Record.Field.Event level N row N Dur=N.NNN ────
    const endNewMatch = content.match(/^<<<<<\s+End\s+(\S+)\s+level\s+(\d+)\s+row\s+(\d+)\s+Dur=([\d.]+)/);
    if (endNewMatch) {
      const program = endNewMatch[1];
      const level = parseInt(endNewMatch[2], 10);
      const dur = parseFloat(endNewMatch[4]);
      this._handleEnd(level, program, dur);
      return;
    }

    // Partial new End without Dur (truncated)
    const endNewNoDur = content.match(/^<<<<<\s+End\s+(\S+)\s+level\s+(\d+)/);
    if (endNewNoDur) {
      const program = endNewNoDur[1];
      const level = parseInt(endNewNoDur[2], 10);
      this._handleEnd(level, program, 0);
      return;
    }

    // ── Legacy format: >>> start Nest=NN . Record.Field.EventName ───────────
    const startMatch = content.match(/^>>>\s+start\s+Nest=(\d+)\s+\.\s+(\S+)/);
    if (startMatch) {
      const nestLevel = parseInt(startMatch[1], 10);
      const program = startMatch[2];
      this._handleStart(nestLevel, null, program, 'legacy');
      return;
    }

    // ── Legacy: >>> start-ext Nest=NN FunctionName Record.Field.EventName ───
    const startExtMatch = content.match(/^>>>\s+start-ext\s+Nest=(\d+)\s+(\S+)\s+(\S+)/);
    if (startExtMatch) {
      const nestLevel = parseInt(startExtMatch[1], 10);
      const functionName = startExtMatch[2];
      const program = startExtMatch[3];
      this._handleStart(nestLevel, functionName, program, 'legacy');
      return;
    }

    // ── Legacy: <<< end Nest=NN . Record.Field.EventName Dur=N.NNN ──────────
    const endMatch = content.match(/^<<<\s+end\s+Nest=(\d+)\s+\.\s+(\S+)\s+Dur=([\d.]+)/);
    if (endMatch) {
      const nestLevel = parseInt(endMatch[1], 10);
      const program = endMatch[2];
      const dur = parseFloat(endMatch[3]);
      this._handleEnd(nestLevel, program, dur);
      return;
    }

    // ── Legacy: <<< end-ext Nest=NN FunctionName Record.Field.EventName Dur ─
    const endExtMatch = content.match(/^<<<\s+end-ext\s+Nest=(\d+)\s+(\S+)\s+(\S+)\s+Dur=([\d.]+)/);
    if (endExtMatch) {
      const nestLevel = parseInt(endExtMatch[1], 10);
      const program = endExtMatch[3];
      const dur = parseFloat(endExtMatch[4]);
      this._handleEnd(nestLevel, program, dur);
      return;
    }

    // ── App Class calls ──────────────────────────────────────────────────────
    // call constructor|method|setter|getter [MethodName] Record.Field.Event
    const callMatch = content.match(/^call\s+(constructor|method|setter|getter)(?:\s+(\S+))?\s+(\S+\.\S+\.\S+)/i);
    if (callMatch) {
      const callType = callMatch[1].toLowerCase();
      const methodName = callMatch[2] || null;
      const program = callMatch[3];
      if (this.eventStack.length > 0) {
        const callEntry = {
          type: 'call',
          callType,
          methodName,
          program,
          params: []
        };
        this.currentEventLines.push(callEntry);
        this._lastCallIdx = this.currentEventLines.length - 1;
      }
      return;
    }

    // ── Parameter value lines (follow call lines) ────────────────────────────
    if (this._lastCallIdx >= 0 && this.eventStack.length > 0) {
      const paramMatch = content.match(/^(Str\[\d+\]|Bool|Num|Object)=(.*)/);
      if (paramMatch) {
        const entry = this.currentEventLines[this._lastCallIdx];
        if (entry && entry.type === 'call') {
          entry.params.push({ key: paramMatch[1], value: paramMatch[2].trim().substring(0, 200) });
        }
        return;
      }
    }
    // Non-param line resets the call context
    if (content && !content.match(/^(Str\[\d+\]|Bool|Num|Object)=/)) {
      this._lastCallIdx = -1;
    }

    // ── Capture content lines if inside at least one event ──────────────────
    if (this.eventStack.length === 0) return;

    // PeopleCode line: "  N: statement text"
    const codeMatch = content.match(/^\s*(\d+):\s+(.*)/);
    if (codeMatch) {
      const code = codeMatch[2].trim();
      if (code) {
        this.currentEventLines.push({ type: 'code', lineNum: parseInt(codeMatch[1], 10), text: code });
      }
      return;
    }

    // SQL line
    const sqlMatch = content.match(/Cur#[\d.]+\.\w+\s+RC=(\d+)\s+Dur=([\d.]+)\s+\w+\s+Stmt=(.+)/);
    if (sqlMatch) {
      this.currentEventLines.push({
        type: 'sql',
        rc: parseInt(sqlMatch[1], 10),
        dur: parseFloat(sqlMatch[2]),
        text: sqlMatch[3].substring(0, 200)
      });
      return;
    }

    // Fetch/Store Field line
    const fieldMatch = content.match(/(Fetch|Store) Field:\s+(\S+)\s+Value=(.*)/);
    if (fieldMatch) {
      this.currentEventLines.push({
        type: 'field',
        action: fieldMatch[1],
        field: fieldMatch[2],
        value: fieldMatch[3]
      });
    }
  }

  /**
   * Return final results after all lines have been processed.
   */
  getResults() {
    // Flush any events that never received an end marker (truncated trace)
    while (this.eventStack.length > 0) {
      const entry = this.eventStack.pop();
      this._finaliseFlameNode(entry.nestLevel, entry.program, 0);
    }

    return {
      eventFlow: this.eventFlow,
      flameData: this.flameData,
      eventCount: this.eventCount
    };
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  /**
   * Strip the trace line header and return the remaining content.
   *
   * Handles two formats:
   *   Legacy: "1-23343 18.22.07 0.010 >>> start Nest=00 . REC.FLD.RowInit"
   *   PSAPPSRV: "PSAPPSRV.1234 [...] tok sid uid (tid) \t >>> start..."
   */
  _stripHeader(line) {
    // New PSAPPSRV format: PSAPPSRV.PID (tid)\t lineNo-seq HH.MM.SS elapsed content
    const psNewMatch = line.match(/^PSAPPSRV\.\d+\s+\(\d+\)\s+\t\s+\d+-\d+\s+[\d.]+\s+[\d.]+\s+(.*)/);
    if (psNewMatch) return psNewMatch[1].trim();

    // Original PSAPPSRV prefix: PSAPPSRV.PID [token] tok sid uid (tid)\t content
    const psMatch = line.match(/^PSAPPSRV\.\d+\s+\[.*?\]\s+\S+\s+\S+\s+\S+\s+\(\d+\)\s+\t\s*(.*)/);
    if (psMatch) return psMatch[1].trim();

    // Legacy: processNo-lineNo  HH.MM.SS  elapsed  <rest>
    const legacyMatch = line.match(/^\d+-\d+\s+[\d.]+\s+[\d.]+\s+(.*)/);
    if (legacyMatch) return legacyMatch[1].trim();

    return line.trim();
  }

  _classifyProgram(program) {
    return classifyProgram(program);
  }

  /**
   * Push a new event onto the stack and record a 'start' entry.
   */
  _handleStart(nestLevel, functionName, program, format) {
    this.eventCount++;

    const parts = program.split('.');
    const eventName = parts.length >= 3 ? parts[parts.length - 1] : program;
    const record    = parts.length >= 3 ? parts[0] : '';
    const field     = parts.length >= 3 ? parts[1] : '';

    const entry = { nestLevel, program, eventName, record, field, functionName: functionName || null };
    this.eventStack.push(entry);
    this.currentEventLines = [];
    this._lastCallIdx = -1;

    this.eventFlow.push({
      type: 'start',
      label: program,
      eventName,
      record,
      field,
      functionName: functionName || null,
      depth: nestLevel,
      nestLevel,
      format,
      category: this._classifyProgram(program),
      codeLines: [],
      sqlLines: [],
      fieldOps: [],
      appClassCalls: []
    });

    const flameNode = {
      label: program,
      eventName,
      nestLevel,
      color: this._eventColor(eventName),
      duration: 0,
      unit: 'ms',
      children: []
    };
    this.flameStack.push({ node: flameNode, nestLevel, program });
  }

  /**
   * Pop the matching open event, record its duration.
   */
  _handleEnd(nestLevel, program, dur) {
    const durMs = Math.round(dur * 1000 * 100) / 100;

    // Attach captured content to the matching 'start' entry in eventFlow
    const startIdx = this._findStartIndex(program, nestLevel);
    if (startIdx !== -1) {
      const codeLines = [];
      const sqlLines  = [];
      const fieldOps  = [];
      const appClassCalls = [];

      for (const ln of this.currentEventLines) {
        if (ln.type === 'code')  codeLines.push({ lineNum: ln.lineNum, text: ln.text });
        else if (ln.type === 'sql')   sqlLines.push({ rc: ln.rc, dur: ln.dur, text: ln.text });
        else if (ln.type === 'field') fieldOps.push({ action: ln.action, field: ln.field, value: ln.value });
        else if (ln.type === 'call')  appClassCalls.push({ callType: ln.callType, methodName: ln.methodName, program: ln.program, params: ln.params });
      }

      this.eventFlow[startIdx].codeLines = codeLines;
      this.eventFlow[startIdx].sqlLines  = sqlLines;
      this.eventFlow[startIdx].fieldOps  = fieldOps;
      this.eventFlow[startIdx].appClassCalls = appClassCalls;
    }

    this.currentEventLines = [];
    this._lastCallIdx = -1;

    const stackIdx = this.eventStack.findLastIndex(
      e => e.nestLevel === nestLevel && e.program === program
    );
    if (stackIdx !== -1) this.eventStack.splice(stackIdx, 1);

    this.eventFlow.push({
      type: 'end',
      label: program,
      eventName: program.split('.').pop(),
      depth: nestLevel,
      nestLevel,
      duration: durMs
    });

    this._finaliseFlameNode(nestLevel, program, durMs);
  }

  /**
   * Complete a flame chart node and attach it to its parent.
   */
  _finaliseFlameNode(nestLevel, program, durMs) {
    const idx = this.flameStack.findLastIndex(
      f => f.nestLevel === nestLevel && f.node.label === program
    );
    if (idx === -1) return;

    const { node } = this.flameStack[idx];
    node.duration = durMs;
    this.flameStack.splice(idx, 1);

    const parentIdx = this.flameStack.findLastIndex(f => f.nestLevel < nestLevel);
    if (parentIdx !== -1) {
      this.flameStack[parentIdx].node.children.push(node);
    } else {
      this.flameData.push(node);
    }
  }

  /**
   * Find the most recent 'start' eventFlow entry matching program + nestLevel.
   */
  _findStartIndex(program, nestLevel) {
    for (let i = this.eventFlow.length - 1; i >= 0; i--) {
      const e = this.eventFlow[i];
      if (e.type === 'start' && e.label === program && e.nestLevel === nestLevel) {
        return i;
      }
    }
    return -1;
  }

  /**
   * Map PeopleCode event names to colour tokens used by the flame chart.
   */
  _eventColor(eventName) {
    const n = eventName.toLowerCase();
    if (n === 'rowinit')          return 'red';
    if (n === 'rowinsert')        return 'coral';
    if (n === 'rowdelete')        return 'crimson';
    if (n === 'rowselect')        return 'salmon';
    if (n === 'fieldchange')      return 'blue';
    if (n === 'fieldedit')        return 'yellow';
    if (n === 'fielddefault')     return 'teal';
    if (n === 'fieldformula')     return 'slate';
    if (n === 'saveprechange')    return 'orange';
    if (n === 'savepostchange')   return 'pink';
    if (n === 'saveedit')         return 'gold';
    if (n === 'searchinit')       return 'purple';
    if (n === 'searchsave')       return 'violet';
    if (n === 'activate')         return 'green';
    if (n === 'prebuild')         return 'lime';
    if (n === 'postbuild')        return 'teal';
    if (n === 'prepopup')         return 'pink';
    if (n === 'itemselected')     return 'magenta';
    if (n === 'workflow')         return 'indigo';
    return 'grey';
  }
}

module.exports = EventParser;
