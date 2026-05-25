/**
 * variableTracer.js
 * Purpose: Track every variable assignment, field fetch/store, and SQL bind
 *          throughout the trace to build a full value-flow timeline.
 * Author: TraceLens
 *
 * Trace patterns tracked:
 *   Fetch Field: RECORD.FIELD Value=X
 *   Store Field: RECORD.FIELD Value=X
 *   PeopleCode:  &var = expression;
 *   SQL binds:   Cur#... Stmt=SELECT ... WHERE FIELD = :1
 *   Function params: Int=0, String=abc
 */

const MAX_VARIABLE_EVENTS = 100000;

class VariableTracer {
  constructor() {
    // All tracked events: { lineNumber, type, variable, value, context, code }
    this.events = [];
    this.lineNumber = 0;
    this.currentContext = { program: '', event: '', record: '' };
    this.currentCodeLine = '';
    this.capped = false;

    // Index by variable name for fast lookup
    this.variableIndex = new Map(); // variableName → [eventIndex, ...]

    // Track unique variables/fields seen
    this.fieldsSeen = new Set();
    this.varsSeen = new Set();
  }

  /**
   * Extract clean content from a trace line (strip the header).
   * Input:  PSAPPSRV.918056 [2026-...] ... 1-384171  0.000020   1: If %DbType = "DB2" Or
   * Output: 1: If %DbType = "DB2" Or
   */
  stripHeader(line) {
    // Match everything after the elapsed time and whitespace
    const match = line.match(/\d+-\d+\s+[\d.]+\s+(.*)/);
    return match ? match[1] : line.trim();
  }

  processLine(line) {
    this.lineNumber++;
    const trimmed = line.trim();
    const content = this.stripHeader(trimmed);

    // Track current program context from Begin markers
    const beginMatch = trimmed.match(/>>>>>\s*Begin\s+(\S+)\.(\S+)\.(\S+)\s+level/);
    if (beginMatch) {
      this.currentContext = {
        program: `${beginMatch[1]}.${beginMatch[2]}`,
        event: beginMatch[3],
        record: beginMatch[1]
      };
    }

    // ── Fetch Field: RECORD.FIELD Value=X ──
    const fetchMatch = content.match(/Fetch Field:\s+(\S+)\s+Value=(.*)/);
    if (fetchMatch) {
      this.addEvent({
        type: 'fetch',
        variable: fetchMatch[1],
        value: fetchMatch[2],
        code: content
      });
      return;
    }

    // ── Store Field: RECORD.FIELD Value=X ──
    const storeMatch = content.match(/Store Field:\s+(\S+)\s+Value=(.*)/);
    if (storeMatch) {
      this.addEvent({
        type: 'store',
        variable: storeMatch[1],
        value: storeMatch[2],
        code: content
      });
      return;
    }

    // ── PeopleCode variable assignment: &var = expression ──
    // Match lines like "1: &SAVE = PSOPTIONS.MULTIJOB;"
    const codeLineMatch = content.match(/^\s*\d+:\s*(.*)/);
    if (codeLineMatch) {
      const codeLine = codeLineMatch[1].trim();
      this.currentCodeLine = codeLine;

      // &variable = expression
      const assignMatch = codeLine.match(/^(&\w+)\s*=\s*(.+?);\s*$/);
      if (assignMatch) {
        const varName = assignMatch[1];
        const expression = assignMatch[2];
        this.addEvent({
          type: 'assign',
          variable: varName,
          value: expression,
          code: codeLine
        });
        this.varsSeen.add(varName);
      }

      // RECORD.FIELD = expression (field assignment in PeopleCode)
      const fieldAssignMatch = codeLine.match(/^(\w+\.\w+)\s*=\s*(.+?);\s*$/);
      if (fieldAssignMatch && !codeLine.startsWith('&')) {
        this.addEvent({
          type: 'assign',
          variable: fieldAssignMatch[1],
          value: fieldAssignMatch[2],
          code: codeLine
        });
      }

      // SQLExec with variables — track which vars go into SQL
      const sqlExecMatch = codeLine.match(/SQLExec\s*\((.+)/i);
      if (sqlExecMatch) {
        // Extract variable names from the SQLExec call
        const args = sqlExecMatch[1];
        const vars = args.match(/&\w+/g);
        if (vars) {
          vars.forEach(v => {
            this.addEvent({
              type: 'sql-bind',
              variable: v,
              value: `used in SQLExec`,
              code: codeLine.substring(0, 150)
            });
          });
        }
      }

      // Function call with variables
      const funcCallMatch = codeLine.match(/(\w+)\s*\((.+)\)/);
      if (funcCallMatch && !codeLine.match(/^(If|While|For|Evaluate|SQLExec|CreateSQL)\b/i)) {
        const args = funcCallMatch[2];
        const vars = args.match(/&\w+/g);
        if (vars) {
          vars.forEach(v => {
            this.addEvent({
              type: 'param',
              variable: v,
              value: `passed to ${funcCallMatch[1]}()`,
              code: codeLine.substring(0, 150)
            });
          });
        }
      }
    }

    // ── Function parameter values: Int=0, String=abc ──
    const paramMatch = content.match(/^\s*(Int|String|Number|Date|DateTime|Boolean|Float)=(.*)$/);
    if (paramMatch) {
      this.addEvent({
        type: 'param-value',
        variable: `[${paramMatch[1]} param]`,
        value: paramMatch[2],
        code: content
      });
    }

    // ── SQL statement — track tables/fields referenced ──
    const sqlMatch = trimmed.match(/Cur#[\d.]+\.\w+\s+RC=(\d+)\s+Dur=[\d.]+\s+COM\s+Stmt=(.+)/);
    if (sqlMatch) {
      const rc = sqlMatch[1];
      const stmt = sqlMatch[2];

      // Track fields in WHERE clauses
      const whereFields = stmt.match(/WHERE\s+(.+)/i);
      if (whereFields) {
        const fieldRefs = whereFields[1].match(/(\w+)\s*=\s*:\d+/g);
        if (fieldRefs) {
          fieldRefs.forEach(ref => {
            const fieldName = ref.match(/(\w+)\s*=/)[1];
            this.addEvent({
              type: 'sql-where',
              variable: fieldName,
              value: `used in SQL WHERE (RC=${rc})`,
              code: stmt.substring(0, 150)
            });
          });
        }
      }
    }
  }

  /**
   * Add a tracked event and index it.
   */
  addEvent(eventData) {
    if (this.events.length >= MAX_VARIABLE_EVENTS) {
      this.capped = true;
      return;
    }

    const event = {
      lineNumber: this.lineNumber,
      context: { ...this.currentContext },
      ...eventData
    };

    const idx = this.events.length;
    this.events.push(event);

    // Index by variable name (lowercase for case-insensitive lookup)
    const key = event.variable.toLowerCase();
    if (!this.variableIndex.has(key)) {
      this.variableIndex.set(key, []);
    }
    this.variableIndex.get(key).push(idx);

    // Also index by the field part (e.g., "MULTIJOB" from "PSOPTIONS.MULTIJOB")
    if (event.variable.includes('.')) {
      const parts = event.variable.split('.');
      const fieldOnly = parts[parts.length - 1].toLowerCase();
      if (!this.variableIndex.has(fieldOnly)) {
        this.variableIndex.set(fieldOnly, []);
      }
      this.variableIndex.get(fieldOnly).push(idx);
    }

    this.fieldsSeen.add(event.variable);
  }

  /**
   * Search for a variable/field and return its full trace path.
   */
  traceVariable(searchTerm) {
    const term = searchTerm.toLowerCase();
    const results = [];

    // Exact match first
    if (this.variableIndex.has(term)) {
      this.variableIndex.get(term).forEach(idx => {
        results.push(this.events[idx]);
      });
    }

    // Partial match if no exact results
    if (results.length === 0) {
      for (const [key, indices] of this.variableIndex) {
        if (key.includes(term)) {
          indices.forEach(idx => {
            results.push(this.events[idx]);
          });
        }
      }
    }

    // Sort by line number (chronological order)
    results.sort((a, b) => a.lineNumber - b.lineNumber);

    return results;
  }

  /**
   * Return final results — summary + searchable index.
   */
  getResults() {
    // Build list of all unique variables for autocomplete
    const allVariables = Array.from(this.fieldsSeen).sort();

    return {
      totalEvents: this.events.length,
      uniqueVariables: allVariables.length,
      variables: allVariables,
      capped: this.capped,
      // Send all events (frontend will search/filter)
      events: this.events
    };
  }
}

module.exports = VariableTracer;
