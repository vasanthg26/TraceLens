/**
 * history.js
 * Purpose: Express router for analysis history — list, fetch, and delete saved analyses.
 * Author: TraceLens
 */

const express = require('express');
const router = express.Router();
const {
  getAnalyses,
  getAnalysisById,
  deleteAnalysis,
  clearAllHistory
} = require('../db/database');

// GET /api/history — list last 20 analyses
router.get('/', (req, res) => {
  try {
    const analyses = getAnalyses(20);
    res.json(analyses);
  } catch (err) {
    console.error('[History] GET / error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve history' });
  }
});

// GET /api/history/:id — full analysis detail with all sections
router.get('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

    const analysis = getAnalysisById(id);
    if (!analysis) return res.status(404).json({ error: 'Analysis not found' });

    res.json(analysis);
  } catch (err) {
    console.error('[History] GET /:id error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve analysis' });
  }
});

// DELETE /api/history/:id — delete one analysis
router.delete('/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

    deleteAnalysis(id);
    res.json({ success: true });
  } catch (err) {
    console.error('[History] DELETE /:id error:', err.message);
    res.status(500).json({ error: 'Failed to delete analysis' });
  }
});

// DELETE /api/history — clear all history
router.delete('/', (req, res) => {
  try {
    clearAllHistory();
    res.json({ success: true });
  } catch (err) {
    console.error('[History] DELETE / error:', err.message);
    res.status(500).json({ error: 'Failed to clear history' });
  }
});

module.exports = router;
