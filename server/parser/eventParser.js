/**
 * eventParser.js
 * Purpose: Parse PeopleCode program markers using the spec-defined trace format:
 *            >>> start Nest=00 . Record.Field.EventName
 *            >>> start-ext Nest=01 FunctionName Record.Field.EventName
 *            <<< end Nest=00 . Record.Field.EventName Dur=0.050
 *            <<< end-ext Nest=01 FunctionName Record.Field.EventName Dur=0.030
 *          Builds event flow list, flame chart hierarchy, and captures SQL/code
 *          captured between start and end markers.
 * Author: TraceLens
 */

class EventParser {
  constructor() {
    // Open events awaiting their <<< end marker
    this.eventStack = [];

    // Flat list of start/end records — used by EventFlowPanel in the UI
    this.eventFlow = [];

    // Top-level flame chart nodes (Nest=00 roots)
    this.flameData = [];

    // Parallel stack of flame nodes being built, each entry: { node, nestLevel, program }
    this.flameStack = [];

    this.eventCount = 0;

    // Lines captured while inside the innermost open event
    this.currentEventLines = [];
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Process one raw trace line.
   * Called by streamParser for every line in the file.
   */
  processLine(line) {
    const content = this._stripHeader(line);

    // ── >>> start Nest=NN . Record.Field.EventName ──────────────────────────
    // The dot before the name means "triggered directly by event" (not a called function)
    const startMatch = content.match(/^>>>\s+start\s+Nest=(\d+)\s+\.\s+(\S+)/);
    if (startMatch) {
      const nestLevel = parseInt(startMatch[1], 10);
      const program = startMatch[2];
      this._handleStart(nestLevel, null, program);
      return;
    }

    // ── >>> start-ext Nest=NN FunctionName Record.Field.EventName ──────────
    // "ext" means called by another program (functionName is the caller)
    const startExtMatch = content.match(/^>>>\s+start-ext\s+Nest=(\d+)\s+(\S+)\s+(\S+)/);
    if (startExtMatch) {
      const nestLevel = parseInt(startExtMatch[1], 10);
      const functionName = startExtMatch[2];
      const program = startExtMatch[3];
      this._handleStart(nestLevel, functionName, program);
      return;
    }

    // ── <<< end Nest=NN . Record.Field.EventName Dur=N.NNN ──────────────────
    const endMatch = content.match(/^<<<\s+end\s+Nest=(\d+)\s+\.\s+(\S+)\s+Dur=([\d.]+)/);
    if (endMatch) {
      const nestLevel = parseInt(endMatch[1], 10);
      const program = endMatch[2];
      const dur = parseFloat(endMatch[3]);
      this._handleEnd(nestLevel, program, dur);
      return;
    }

    // ── <<< end-ext Nest=NN FunctionName Record.Field.EventName Dur=N.NNN ───
    const endExtMatch = content.match(/^<<<\s+end-ext\s+Nest=(\d+)\s+(\S+)\s+(\S+)\s+Dur=([\d.]+)/);
    if (endExtMatch) {
      const nestLevel = parseInt(endExtMatch[1], 10);
      const program = endExtMatch[3];
      const dur = parseFloat(endExtMatch[4]);
      this._handleEnd(nestLevel, program, dur);
      return;
    }

    // ── Capture content lines if we are inside at least one event ───────────
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

    // SQL line from the 8-column format:
    // Cur#N.DBNAME  RC=N  Dur=N.NNN  COM|CEX|EXE  Stmt=...
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
    // Flush any events that never received a <<< end (truncated trace)
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
   * Strip the trace line header — processNo-lineNo, timestamp, elapsed — and
   * return the remaining content.
   *
   * Input:  "1-23343 18.22.07 0.010 >>> start Nest=00 . REC.FLD.RowInit"
   * Output: ">>> start Nest=00 . REC.FLD.RowInit"
   */
  _stripHeader(line) {
    // Match: processNo-lineNo  HH.MM.SS  elapsed  <rest>
    const match = line.match(/^\d+-\d+\s+[\d.]+\s+[\d.]+\s+(.*)/);
    return match ? match[1].trim() : line.trim();
  }

  /**
   * Push a new event onto the stack and record a 'start' entry in eventFlow.
   *
   * @param {number}      nestLevel   Nest= value from trace
   * @param {string|null} functionName  caller function, or null for event-triggered
   * @param {string}      program     "Record.Field.EventName" string
   */
  _handleStart(nestLevel, functionName, program) {
    this.eventCount++;

    const parts = program.split('.');
    const eventName = parts.length >= 3 ? parts[parts.length - 1] : program;
    const record    = parts.length >= 3 ? parts[0] : '';
    const field     = parts.length >= 3 ? parts[1] : '';

    // depth === nestLevel so the EventFlowPanel indentation works correctly
    const entry = {
      nestLevel,
      program,
      eventName,
      record,
      field,
      functionName: functionName || null
    };

    this.eventStack.push(entry);

    // Snapshot the captured lines from the previous open scope into the parent;
    // start fresh for this new event
    this.currentEventLines = [];

    this.eventFlow.push({
      type: 'start',
      label: program,
      eventName,
      record,
      field,
      functionName: functionName || null,
      depth: nestLevel,         // used by EventFlowPanel for indentation
      nestLevel,
      codeLines: [],            // populated when event closes
      sqlLines: [],
      fieldOps: []
    });

    // Build flame chart node
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
   * Pop the matching open event, record its duration, and wire it into the
   * flame chart hierarchy.
   *
   * @param {number} nestLevel
   * @param {string} program
   * @param {number} dur  seconds from Dur= on the <<< end line
   */
  _handleEnd(nestLevel, program, dur) {
    const durMs = Math.round(dur * 1000 * 100) / 100;

    // Attach captured content lines to the matching 'start' entry in eventFlow
    const startIdx = this._findStartIndex(program, nestLevel);
    if (startIdx !== -1) {
      const codeLines = [];
      const sqlLines  = [];
      const fieldOps  = [];

      for (const ln of this.currentEventLines) {
        if (ln.type === 'code')  codeLines.push({ lineNum: ln.lineNum, text: ln.text });
        else if (ln.type === 'sql')   sqlLines.push({ rc: ln.rc, dur: ln.dur, text: ln.text });
        else if (ln.type === 'field') fieldOps.push({ action: ln.action, field: ln.field, value: ln.value });
      }

      this.eventFlow[startIdx].codeLines = codeLines;
      this.eventFlow[startIdx].sqlLines  = sqlLines;
      this.eventFlow[startIdx].fieldOps  = fieldOps;
    }

    this.currentEventLines = [];

    // Remove from open stack
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

    // Parent is the nearest open node with a lower nestLevel
    const parentIdx = this.flameStack.findLastIndex(f => f.nestLevel < nestLevel);
    if (parentIdx !== -1) {
      this.flameStack[parentIdx].node.children.push(node);
    } else {
      this.flameData.push(node);
    }
  }

  /**
   * Find the most recent 'start' eventFlow entry matching program + nestLevel.
   * Searches backwards so nested calls resolve correctly.
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
   * Matches the spec colour assignments exactly.
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
