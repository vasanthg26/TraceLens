/**
 * sqlAnalyzer.js
 * Purpose: Detect SQL statements from PeopleTools trace format, group by normalized signature,
 *          flag slow and N+1 queries
 * Author: TraceLens
 *
 * Trace format (actual PeopleTools):
 *   Cur#1.1507888.CNVFIN RC=0 Dur=0.000155 COM Stmt=SELECT ... FROM ...
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
  }

  /**
   * Normalize SQL by replacing bind variables (:1, :2, etc.) with ?
   * and collapsing whitespace for consistent grouping.
   */
  normalizeSql(sql) {
    return sql
      .replace(/:\d+/g, '?')
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
   * Process a single line from the trace file.
   * Matches: Cur#1.1507888.CNVFIN RC=0 Dur=0.000155 COM Stmt=SELECT ...
   */
  processLine(line) {
    // Match the actual PeopleTools SQL trace format
    const sqlMatch = line.match(/Cur#[\d.]+\.\w+\s+RC=\d+\s+Dur=([\d.]+)\s+COM\s+Stmt=(.+)/);
    if (sqlMatch) {
      const duration = parseFloat(sqlMatch[1]);
      const rawSql = sqlMatch[2].trim();
      if (rawSql) {
        this.recordSql(rawSql, duration);
      }
      return;
    }

    // Also match Dur without COM (some trace entries have different format)
    const altMatch = line.match(/Cur#[\d.]+\.\w+\s+RC=\d+\s+Dur=([\d.]+)\s+(.+)/);
    if (altMatch) {
      const duration = parseFloat(altMatch[1]);
      const rest = altMatch[2].trim();
      // Only treat as SQL if it looks like a statement
      if (/^(SELECT|INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP)\s/i.test(rest)) {
        this.recordSql(rest, duration);
      }
    }
  }

  /**
   * Record a completed SQL statement.
   */
  recordSql(rawSql, elapsed) {
    this.totalSqlCount++;
    this.totalSqlTime += elapsed;

    const normalized = this.normalizeSql(rawSql);
    const sig = this.signature(normalized);
    const isSlow = elapsed > SLOW_THRESHOLD;
    if (isSlow) this.slowQueryCount++;

    // Group by signature
    if (this.sqlGroups.has(sig)) {
      const group = this.sqlGroups.get(sig);
      group.count++;
      group.totalTime += elapsed;
      group.avgTime = group.totalTime / group.count;
      group.maxTime = Math.max(group.maxTime, elapsed);
      if (isSlow) group.slowCount++;
    } else {
      this.sqlGroups.set(sig, {
        signature: sig,
        normalizedSql: normalized,
        preview: normalized.substring(0, 120),
        count: 1,
        totalTime: elapsed,
        avgTime: elapsed,
        maxTime: elapsed,
        slowCount: isSlow ? 1 : 0,
        bindVariations: [],
        isNPlusOne: false
      });
    }

    // Track recent signatures for N+1 detection
    this.recentSignatures.push({ sig, rawSql });
    if (this.recentSignatures.length > 10) {
      this.recentSignatures.shift();
    }
    this.detectNPlusOne(sig);

    // Return signature and elapsed for cross-parser coordination
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
    const sqlGroups = Array.from(this.sqlGroups.values())
      .sort((a, b) => b.totalTime - a.totalTime);

    return {
      sqlGroups,
      sqlStats: {
        totalStatements: this.totalSqlCount,
        uniqueStatements: this.sqlGroups.size,
        totalSqlTime: Math.round(this.totalSqlTime * 1000) / 1000,
        slowQueryCount: this.slowQueryCount,
        nPlusOneCount: this.nPlusOnePatterns.length,
        topSlow: sqlGroups.filter(g => g.slowCount > 0).slice(0, 5),
        nPlusOnePatterns: this.nPlusOnePatterns
      }
    };
  }
}

module.exports = SqlAnalyzer;
