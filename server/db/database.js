/**
 * database.js
 * Purpose: SQLite database setup using better-sqlite3;
 *          creates tables on first run, exports CRUD functions for analysis history.
 * Author: TraceLens
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Ensure data/ directory exists
const dataDir = path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(path.join(dataDir, 'tracelens.db'));

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');

// ── Create tables on first run ──
db.exec(`
  CREATE TABLE IF NOT EXISTS analyses (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    filename          TEXT,
    filesize          INTEGER,
    analyzedAt        DATETIME DEFAULT CURRENT_TIMESTAMP,
    overallHealth     TEXT,
    summary           TEXT,
    totalLines        INTEGER,
    totalSql          INTEGER,
    slowQueries       INTEGER,
    errorCount        INTEGER,
    loopCount         INTEGER,
    processCount      INTEGER,
    topRecommendation TEXT,
    llmProvider       TEXT,
    llmModel          TEXT
  );

  CREATE TABLE IF NOT EXISTS analysis_details (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    analysisId   INTEGER NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
    section      TEXT NOT NULL,
    data         TEXT NOT NULL
  );
`);

// ── Prepared statements ──
const stmtInsertAnalysis = db.prepare(`
  INSERT INTO analyses
    (filename, filesize, overallHealth, summary, totalLines, totalSql,
     slowQueries, errorCount, loopCount, processCount, topRecommendation,
     llmProvider, llmModel)
  VALUES
    ($filename, $filesize, $overallHealth, $summary, $totalLines, $totalSql,
     $slowQueries, $errorCount, $loopCount, $processCount, $topRecommendation,
     $llmProvider, $llmModel)
`);

const stmtInsertDetail = db.prepare(`
  INSERT INTO analysis_details (analysisId, section, data)
  VALUES ($analysisId, $section, $data)
`);

const stmtGetAnalyses = db.prepare(`
  SELECT id, filename, filesize, analyzedAt, overallHealth, summary,
         totalLines, totalSql, slowQueries, errorCount, loopCount,
         processCount, topRecommendation, llmProvider, llmModel
  FROM analyses
  ORDER BY analyzedAt DESC
  LIMIT $limit
`);

const stmtGetAnalysisById = db.prepare(`
  SELECT id, filename, filesize, analyzedAt, overallHealth, summary,
         totalLines, totalSql, slowQueries, errorCount, loopCount,
         processCount, topRecommendation, llmProvider, llmModel
  FROM analyses
  WHERE id = $id
`);

const stmtGetDetails = db.prepare(`
  SELECT section, data FROM analysis_details WHERE analysisId = $analysisId
`);

const stmtDeleteAnalysis = db.prepare(`DELETE FROM analyses WHERE id = $id`);
const stmtClearAll = db.prepare(`DELETE FROM analyses`);

// ── Exported functions ──

/**
 * Save a completed analysis to history.
 * @param {object} summary - meta fields for the analyses row
 * @param {object} details - keyed sections (sql, loops, events, errors, variables)
 * @returns {number} new analysis id
 */
function saveAnalysis(summary, details) {
  const run = db.transaction(() => {
    const info = stmtInsertAnalysis.run({
      $filename:          summary.filename          ?? null,
      $filesize:          summary.filesize          ?? null,
      $overallHealth:     summary.overallHealth     ?? null,
      $summary:           summary.summary           ?? null,
      $totalLines:        summary.totalLines        ?? null,
      $totalSql:          summary.totalSql          ?? null,
      $slowQueries:       summary.slowQueries       ?? null,
      $errorCount:        summary.errorCount        ?? null,
      $loopCount:         summary.loopCount         ?? null,
      $processCount:      summary.processCount      ?? null,
      $topRecommendation: summary.topRecommendation ?? null,
      $llmProvider:       summary.llmProvider       ?? null,
      $llmModel:          summary.llmModel          ?? null
    });

    const id = info.lastInsertRowid;

    for (const [section, data] of Object.entries(details)) {
      stmtInsertDetail.run({
        $analysisId: id,
        $section:    section,
        $data:       JSON.stringify(data)
      });
    }

    return id;
  });

  return run();
}

/**
 * Return the last N analyses (default 20), most recent first.
 * @param {number} limit
 * @returns {Array}
 */
function getAnalyses(limit = 20) {
  return stmtGetAnalyses.all({ $limit: limit });
}

/**
 * Return a single analysis with all its detail sections.
 * @param {number} id
 * @returns {object|null}
 */
function getAnalysisById(id) {
  const row = stmtGetAnalysisById.get({ $id: id });
  if (!row) return null;

  const detailRows = stmtGetDetails.all({ $analysisId: id });
  const sections = {};
  for (const { section, data } of detailRows) {
    try {
      sections[section] = JSON.parse(data);
    } catch {
      sections[section] = data;
    }
  }

  return { ...row, sections };
}

/**
 * Delete a single analysis (cascades to analysis_details).
 * @param {number} id
 */
function deleteAnalysis(id) {
  stmtDeleteAnalysis.run({ $id: id });
}

/**
 * Delete all analyses.
 */
function clearAllHistory() {
  stmtClearAll.run();
}

module.exports = {
  saveAnalysis,
  getAnalyses,
  getAnalysisById,
  deleteAnalysis,
  clearAllHistory
};
