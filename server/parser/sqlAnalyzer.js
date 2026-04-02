/**
 * sqlAnalyzer.js
 * Purpose: Detect SQL statements from PeopleTools trace format, group by normalized signature,
 *          flag slow and N+1 queries. Uses a COM→Bind→EXE→Fetch state machine to track
 *          full execution lifecycle per cursor.
 * Author: TraceLens
 *
 * Trace format (actual PeopleTools):
 *   Cur#1.1507888.CNVFIN RC=0 Dur=0.000155 COM Stmt=SELECT ... FROM ...
 *   Bind-1 type=2 length=10 value=12345
 *   Cur#1.1507888.CNVFIN RC=0 Dur=0.000500 EXE
 *   Cur#1.1507888.CNVFIN RC=0 Dur=0.001234 Fetch
 */

const SLOW_THRESHOLD = parseFloat(process.env.SLOW_QUERY_THRESHOLD_SECS) || 1;

class SqlAnalyzer {
  constructor() {
    this.sqlGroups = new Map();
    this.recentSignatures = [];
    this.nPlusOnePatterns = [];
    this.totalSqlCount = 0;
    this.totalSqlTime = 0;
    this.slowQueryCount = 0;

    // Cursor state machine: tracks in-flight cursors by cursor ID
    this.cursors = new Map();
    this._lastActiveCursor = null;
  }

  /**
   * Normalize SQL by replacing bind variables (:1, :2, etc.) and string literals
   * with ? and collapsing whitespace for consistent grouping.
   */
  normalizeSql(sql) {
    return sql
      .replace(/:\d+/g, '?')
      .replace(/'[^']*'/g, '?')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Generate a short signature hash for quick comparison.
   */
  signature(normalizedSql) {
    let hash = 0;
    for (let i = 0; i < normalizedSql.length; i++) {
      const char = normalizedSql.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return `sql_${Math.abs(hash).toString(36)}`;
  }

  /**
   * Extract process number from the trace line header (processNo-lineNo ...).
   * Returns null if the header isn't present.
   */
  _extractProcessNo(line) {
    const m = line.match(/^(\d+)-\d+\s/);
    if (m) return m[1];
    // Also check PSAPPSRV prefix
    const ps = line.match(/^PSAPPSRV\.(\d+)\s/);
    return ps ? ps[1] : null;
  }

  /**
   * Extract primary table name from a SQL statement (first table in FROM clause).
   */
  _extractPrimaryTable(sql) {
    const m = sql.match(/\bFROM\s+([\w.]+)/i);
    if (m) return m[1].toUpperCase().replace(/^PS_/, 'PS_');
    // INSERT INTO
    const ins = sql.match(/\bINSERT\s+INTO\s+([\w.]+)/i);
    if (ins) return ins[1].toUpperCase();
    // UPDATE
    const upd = sql.match(/\bUPDATE\s+([\w.]+)/i);
    if (upd) return upd[1].toUpperCase();
    // DELETE FROM
    const del = sql.match(/\bDELETE\s+FROM\s+([\w.]+)/i);
    if (del) return del[1].toUpperCase();
    return 'UNKNOWN';
  }

  /**
   * Finalize a cursor: record its SQL with aggregated timing.
   */
  _finalizeCursor(cursorId) {
    const c = this.cursors.get(cursorId);
    if (!c || !c.sql) {
      this.cursors.delete(cursorId);
      return;
    }

    // Total elapsed = COM + EXE + Fetch
    const elapsed = c.comDur + c.execDur + c.fetchDur;
    this.recordSql(c.sql, elapsed, c.processNo, {
      comDur: c.comDur,
      execDur: c.execDur,
      fetchDur: c.fetchDur,
      binds: c.binds,
      rc: c.rc
    });

    this.cursors.delete(cursorId);
  }

  /**
   * Process a single line from the trace file.
   */
  processLine(line) {
    const processNo = this._extractProcessNo(line);

    // Match cursor line: Cur#1.1507888.CNVFIN RC=0 Dur=0.000155 OP [Stmt=SQL]
    const curMatch = line.match(/Cur#([\d.]+\.\w+)\s+RC=(\d+)\s+Dur=([\d.]+)\s+(\w+)(?:\s+Stmt=(.+))?/);
    if (curMatch) {
      const cursorId = curMatch[1];
      const rc = parseInt(curMatch[2], 10);
      const dur = parseFloat(curMatch[3]);
      const op = curMatch[4].toUpperCase();
      const stmt = curMatch[5]?.trim();

      if (op === 'COM' && stmt) {
        // Finalize any previous open cursor with this ID (re-use of cursor)
        if (this.cursors.has(cursorId)) {
          this._finalizeCursor(cursorId);
        }
        this.cursors.set(cursorId, {
          sql: stmt,
          comDur: dur,
          execDur: 0,
          fetchDur: 0,
          binds: [],
          processNo,
          rc
        });
        this._lastActiveCursor = cursorId;
        return;
      }

      if (op === 'CEX' && stmt) {
        // CEX = combined COM+EXE in some trace versions
        if (this.cursors.has(cursorId)) {
          this._finalizeCursor(cursorId);
        }
        this.cursors.set(cursorId, {
          sql: stmt,
          comDur: 0,
          execDur: dur,
          fetchDur: 0,
          binds: [],
          processNo,
          rc
        });
        this._lastActiveCursor = cursorId;
        return;
      }

      if (op === 'EXE') {
        if (this.cursors.has(cursorId)) {
          const c = this.cursors.get(cursorId);
          c.execDur += dur;
          c.rc = rc;
        }
        this._lastActiveCursor = cursorId;
        return;
      }

      if (op === 'FETCH') {
        if (this.cursors.has(cursorId)) {
          this.cursors.get(cursorId).fetchDur += dur;
        }
        return;
      }

      if (op === 'CLOSE' || op === 'REUSE') {
        if (this.cursors.has(cursorId)) {
          this._finalizeCursor(cursorId);
        }
        if (this._lastActiveCursor === cursorId) {
          this._lastActiveCursor = null;
        }
        return;
      }

      // For any other op on a cursor with stmt — treat as COM
      if (stmt && !this.cursors.has(cursorId)) {
        this.cursors.set(cursorId, {
          sql: stmt,
          comDur: dur,
          execDur: 0,
          fetchDur: 0,
          binds: [],
          processNo,
          rc
        });
        this._lastActiveCursor = cursorId;
        return;
      }

      return;
    }

    // Bind variable line: "Bind-N type=... [length=N] value=..."
    const bindMatch = line.match(/Bind-(\d+)\s+type=\S+(?:\s+length=\d+)?\s+value=(.*)/i);
    if (bindMatch && this._lastActiveCursor && this.cursors.has(this._lastActiveCursor)) {
      const cursor = this.cursors.get(this._lastActiveCursor);
      const bindIdx = parseInt(bindMatch[1], 10);
      const bindVal = bindMatch[2].trim().substring(0, 100);
      // Store as indexed array (Bind-1 → index 0)
      cursor.binds[bindIdx - 1] = bindVal;
      return;
    }

    // Fallback: legacy format without cursor state machine
    // Matches: Cur#1.1507888.CNVFIN RC=0 Dur=0.000155 COM Stmt=SELECT ...
    // (already handled above, but keep for non-cursor SQL patterns)
    const altMatch = line.match(/Cur#[\d.]+\.\w+\s+RC=\d+\s+Dur=([\d.]+)\s+(.+)/);
    if (altMatch) {
      const duration = parseFloat(altMatch[1]);
      const rest = altMatch[2].trim();
      if (/^(SELECT|INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP)\s/i.test(rest)) {
        this.recordSql(rest, duration, processNo);
      }
    }
  }

  /**
   * Record a completed SQL statement.
   * @param {string}      rawSql
   * @param {number}      elapsed   seconds (total lifecycle time)
   * @param {string|null} processNo process number from trace header, or null
   * @param {object}      meta      optional: { comDur, execDur, fetchDur, binds, rc }
   */
  recordSql(rawSql, elapsed, processNo = null, meta = {}) {
    if (!rawSql) return null;
    this.totalSqlCount++;
    this.totalSqlTime += elapsed;

    const normalized = this.normalizeSql(rawSql);
    const sig = this.signature(normalized);
    const isSlow = elapsed > SLOW_THRESHOLD;
    if (isSlow) this.slowQueryCount++;

    const table = this._extractPrimaryTable(normalized);
    const sqlType = normalized.match(/^\s*(SELECT|INSERT|UPDATE|DELETE|MERGE)/i)?.[1]?.toUpperCase() || 'OTHER';

    // Group by signature
    if (this.sqlGroups.has(sig)) {
      const group = this.sqlGroups.get(sig);
      group.count++;
      group.totalTime += elapsed;
      group.avgTime = group.totalTime / group.count;
      group.maxTime = Math.max(group.maxTime, elapsed);
      if (isSlow) group.slowCount++;
      if (processNo !== null) group.processes.add(processNo);
      // Track exec/fetch timing
      if (meta.execDur !== undefined) {
        group.totalExecTime = (group.totalExecTime || 0) + meta.execDur;
        group.totalFetchTime = (group.totalFetchTime || 0) + meta.fetchDur;
      }
      // Keep a few bind samples (up to 3 executions)
      if (meta.binds?.length > 0 && group.bindSamples.length < 3) {
        group.bindSamples.push(meta.binds.filter(Boolean).slice(0, 5));
      }
    } else {
      const processes = new Set();
      if (processNo !== null) processes.add(processNo);
      this.sqlGroups.set(sig, {
        signature: sig,
        normalizedSql: normalized,
        preview: normalized.substring(0, 120),
        table,
        sqlType,
        count: 1,
        totalTime: elapsed,
        avgTime: elapsed,
        maxTime: elapsed,
        slowCount: isSlow ? 1 : 0,
        totalExecTime: meta.execDur || 0,
        totalFetchTime: meta.fetchDur || 0,
        bindSamples: meta.binds?.length > 0 ? [meta.binds.filter(Boolean).slice(0, 5)] : [],
        isNPlusOne: false,
        processes
      });
    }

    // Track recent signatures for N+1 detection
    this.recentSignatures.push({ sig, rawSql });
    if (this.recentSignatures.length > 10) {
      this.recentSignatures.shift();
    }
    this.detectNPlusOne(sig);

    return { sig, elapsed, preview: normalized.substring(0, 120) };
  }

  /**
   * Detect N+1 pattern: same signature appearing 3+ consecutive times.
   */
  detectNPlusOne(currentSig) {
    const recent = this.recentSignatures;
    if (recent.length < 3) return;

    let consecutiveCount = 0;
    for (let i = recent.length - 1; i >= 0; i--) {
      if (recent[i].sig === currentSig) {
        consecutiveCount++;
      } else {
        break;
      }
    }

    if (consecutiveCount >= 3) {
      const group = this.sqlGroups.get(currentSig);
      if (group && !group.isNPlusOne) {
        group.isNPlusOne = true;
        this.nPlusOnePatterns.push({
          signature: currentSig,
          sqlPreview: group.preview,
          consecutiveHits: consecutiveCount
        });
      }
    }
  }

  /**
   * Return final results.
   */
  getResults() {
    // Flush any cursors that never received a Close (truncated traces)
    for (const cursorId of Array.from(this.cursors.keys())) {
      this._finalizeCursor(cursorId);
    }

    const allProcesses = new Set();

    const sqlGroups = Array.from(this.sqlGroups.values())
      .sort((a, b) => b.totalTime - a.totalTime)
      .map(g => {
        g.processes.forEach(p => allProcesses.add(p));
        return { ...g, processes: Array.from(g.processes).sort() };
      });

    // Build SQL-by-table grouping
    const tableMap = new Map();
    for (const group of sqlGroups) {
      const t = group.table || 'UNKNOWN';
      if (!tableMap.has(t)) {
        tableMap.set(t, { table: t, count: 0, totalTime: 0, sqlTypes: new Set() });
      }
      const tg = tableMap.get(t);
      tg.count += group.count;
      tg.totalTime += group.totalTime;
      tg.sqlTypes.add(group.sqlType || 'OTHER');
    }

    const sqlByTable = Array.from(tableMap.values())
      .map(tg => ({
        table: tg.table,
        count: tg.count,
        totalTime: Math.round(tg.totalTime * 1000) / 1000,
        avgTime: Math.round((tg.totalTime / tg.count) * 1000) / 1000,
        sqlTypes: Array.from(tg.sqlTypes).sort()
      }))
      .sort((a, b) => b.totalTime - a.totalTime);

    return {
      sqlGroups,
      sqlByTable,
      sqlStats: {
        totalStatements: this.totalSqlCount,
        uniqueStatements: this.sqlGroups.size,
        totalSqlTime: Math.round(this.totalSqlTime * 1000) / 1000,
        slowQueryCount: this.slowQueryCount,
        nPlusOneCount: this.nPlusOnePatterns.length,
        topSlow: sqlGroups.filter(g => g.slowCount > 0).slice(0, 5),
        nPlusOnePatterns: this.nPlusOnePatterns,
        allProcesses: Array.from(allProcesses).sort()
      }
    };
  }
}

module.exports = SqlAnalyzer;
