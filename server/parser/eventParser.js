/**
 * eventParser.js
 * Purpose: Parse PeopleCode event markers from actual PeopleTools trace format,
 *          build hierarchy, flame chart data, and capture code+SQL per event
 * Author: TraceLens
 *
 * Trace format (actual PeopleTools):
 *   >>>>> Begin RECORD.FIELD.EventName level X row Y
 *   Code lines:   N: PeopleCode statement
 *   SQL lines:    Cur#... Dur=... COM Stmt=...
 *   Field ops:    Fetch Field: RECORD.FIELD Value=X
 *   No explicit end markers — events end when the next Begin at same/higher level starts
 */

class EventParser {
  constructor() {
    this.eventStack = [];
    this.eventFlow = [];
    this.flameData = [];
    this.flameStack = [];
    this.eventCount = 0;
    this.lastTimestamp = null;

    // Capture lines inside current event
    this.currentEventLines = [];   // { type, text, lineNum? }
  }

  /**
   * Strip trace header, return clean content.
   */
  stripHeader(line) {
    const match = line.match(/\d+-\d+\s+[\d.]+\s+(.*)/);
    return match ? match[1] : line.trim();
  }

  /**
   * Extract ISO timestamp from a trace line header.
   */
  extractTimestamp(line) {
    const tsMatch = line.match(/\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+)\]/);
    if (tsMatch) {
      return new Date(tsMatch[1]).getTime() / 1000;
    }
    return null;
  }

  /**
   * Determine color category based on PeopleCode event name.
   */
  eventColor(eventName) {
    const name = eventName.toLowerCase();
    if (name.includes('rowinit')) return 'red';
    if (name.includes('rowinsert')) return 'coral';
    if (name.includes('rowdelete')) return 'crimson';
    if (name.includes('rowselect')) return 'salmon';
    if (name.includes('fieldchange')) return 'blue';
    if (name.includes('fieldedit')) return 'sky';
    if (name.includes('fielddefault')) return 'cyan';
    if (name.includes('fieldformula')) return 'slate';
    if (name.includes('saveprechange')) return 'orange';
    if (name.includes('savepostchange')) return 'amber';
    if (name.includes('saveedit')) return 'gold';
    if (name.includes('searchinit')) return 'purple';
    if (name.includes('searchsave')) return 'violet';
    if (name.includes('activate')) return 'green';
    if (name.includes('prebuild')) return 'lime';
    if (name.includes('postbuild')) return 'teal';
    if (name.includes('prepopup')) return 'pink';
    if (name.includes('itemselected')) return 'magenta';
    if (name.includes('workflow')) return 'indigo';
    return 'grey';
  }

  /**
   * Process a single line from the trace file.
   */
  processLine(line) {
    const ts = this.extractTimestamp(line);
    if (ts !== null) this.lastTimestamp = ts;
    const content = this.stripHeader(line.trim());

    // Detect event start: >>>>> Begin RECORD.FIELD.EventName level X row Y
    const beginMatch = line.match(/>>>>>\s*Begin\s+(\S+)\.(\S+)\.(\S+)\s+level\s+(\d+)\s+row\s+(\d+)/);
    if (beginMatch) {
      this.eventCount++;
      const record = beginMatch[1];
      const field = beginMatch[2];
      const eventName = beginMatch[3];
      const level = parseInt(beginMatch[4]);
      const row = parseInt(beginMatch[5]);
      const fullLabel = `${record}.${field}.${eventName}`;

      // Close any events at the same or deeper level
      while (this.eventStack.length > 0) {
        const top = this.eventStack[this.eventStack.length - 1];
        if (top.level >= level) {
          this.closeEvent();
        } else {
          break;
        }
      }

      // Reset line capture for the new event
      this.currentEventLines = [];

      const event = {
        type: 'start',
        eventName,
        program: fullLabel,
        record,
        field,
        fullLabel,
        level,
        row,
        startTime: this.lastTimestamp,
        depth: this.eventStack.length
      };

      this.eventStack.push(event);
      this.eventFlow.push({
        type: 'start',
        label: fullLabel,
        eventName,
        depth: event.depth,
        level,
        row,
        timestamp: this.lastTimestamp,
        codeLines: [],    // will be populated when event closes
        sqlLines: [],
        fieldOps: []
      });

      // Build flame data node
      const flameNode = {
        label: `${fullLabel} (L${level} R${row})`,
        eventName,
        color: this.eventColor(eventName),
        duration: 0,
        unit: 'ms',
        children: []
      };
      this.flameStack.push(flameNode);
      return;
    }

    // Only capture lines if we're inside an event
    if (this.eventStack.length === 0) return;

    // PeopleCode line: "  N: code..."
    const codeMatch = content.match(/^\s*(\d+):\s*(.*)/);
    if (codeMatch) {
      const lineNum = parseInt(codeMatch[1]);
      const code = codeMatch[2].trim();
      if (code) {
        this.currentEventLines.push({
          type: 'code',
          lineNum,
          text: code
        });
      }
      return;
    }

    // SQL line: "Cur#... Dur=... COM Stmt=..."
    const sqlMatch = content.match(/Cur#[\d.]+\.\w+\s+RC=(\d+)\s+Dur=([\d.]+)\s+COM\s+Stmt=(.+)/);
    if (sqlMatch) {
      this.currentEventLines.push({
        type: 'sql',
        rc: parseInt(sqlMatch[1]),
        dur: parseFloat(sqlMatch[2]),
        text: sqlMatch[3].substring(0, 200)
      });
      return;
    }

    // Fetch/Store Field
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
   * Close the top event on the stack.
   */
  closeEvent() {
    if (this.eventStack.length === 0) return;

    const started = this.eventStack.pop();
    let duration = 0;

    if (started.startTime !== null && this.lastTimestamp !== null) {
      duration = Math.max(0, (this.lastTimestamp - started.startTime) * 1000);
    }

    // Find the matching start entry in eventFlow and attach the captured lines
    const startIdx = this.findStartEntry(started.fullLabel, started.depth);
    if (startIdx !== -1) {
      const codeLines = [];
      const sqlLines = [];
      const fieldOps = [];

      for (const entry of this.currentEventLines) {
        if (entry.type === 'code') {
          codeLines.push({ lineNum: entry.lineNum, text: entry.text });
        } else if (entry.type === 'sql') {
          sqlLines.push({ rc: entry.rc, dur: entry.dur, text: entry.text });
        } else if (entry.type === 'field') {
          fieldOps.push({ action: entry.action, field: entry.field, value: entry.value });
        }
      }

      this.eventFlow[startIdx].codeLines = codeLines;
      this.eventFlow[startIdx].sqlLines = sqlLines;
      this.eventFlow[startIdx].fieldOps = fieldOps;
    }

    // Reset for next event
    this.currentEventLines = [];

    this.eventFlow.push({
      type: 'end',
      label: started.fullLabel,
      eventName: started.eventName,
      depth: started.depth,
      timestamp: this.lastTimestamp,
      duration: Math.round(duration * 100) / 100
    });

    // Complete flame data node
    if (this.flameStack.length > 0) {
      const flameNode = this.flameStack.pop();
      flameNode.duration = Math.round(duration * 100) / 100;

      if (this.flameStack.length > 0) {
        this.flameStack[this.flameStack.length - 1].children.push(flameNode);
      } else {
        this.flameData.push(flameNode);
      }
    }
  }

  /**
   * Find the matching start entry in eventFlow (search backwards).
   */
  findStartEntry(fullLabel, depth) {
    for (let i = this.eventFlow.length - 1; i >= 0; i--) {
      const e = this.eventFlow[i];
      if (e.type === 'start' && e.label === fullLabel && e.depth === depth) {
        return i;
      }
    }
    return -1;
  }

  /**
   * Return final results.
   */
  getResults() {
    // Flush any remaining unclosed events
    while (this.eventStack.length > 0) {
      this.closeEvent();
    }
    while (this.flameStack.length > 0) {
      const node = this.flameStack.pop();
      if (this.flameStack.length > 0) {
        this.flameStack[this.flameStack.length - 1].children.push(node);
      } else {
        this.flameData.push(node);
      }
    }

    return {
      eventFlow: this.eventFlow,
      flameData: this.flameData,
      eventCount: this.eventCount
    };
  }
}

module.exports = EventParser;
