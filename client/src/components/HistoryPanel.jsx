/**
 * HistoryPanel.jsx
 * Purpose: Saved analysis history list — load, delete, and clear all past analyses.
 * Author: TraceLens
 */

import React, { useState, useEffect, useCallback } from 'react';
import './HistoryPanel.css';

function HistoryPanel({ onLoad, onClose }) {
  const [analyses, setAnalyses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [clearing, setClearing] = useState(false);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/history');
      if (!res.ok) throw new Error('Failed to load history');
      const data = await res.json();
      setAnalyses(data);
    } catch (err) {
      console.error('[HistoryPanel] fetch error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const handleLoad = async (id) => {
    try {
      const res = await fetch(`/api/history/${id}`);
      if (!res.ok) throw new Error('Failed to load analysis');
      const data = await res.json();
      onLoad(data);
    } catch (err) {
      console.error('[HistoryPanel] load error:', err);
      setError(err.message);
    }
  };

  const handleDelete = async (id) => {
    setDeleting(id);
    try {
      await fetch(`/api/history/${id}`, { method: 'DELETE' });
      setAnalyses(prev => prev.filter(a => a.id !== id));
    } catch (err) {
      console.error('[HistoryPanel] delete error:', err);
      setError(err.message);
    } finally {
      setDeleting(null);
    }
  };

  const handleClearAll = async () => {
    if (!window.confirm('Delete all analysis history?')) return;
    setClearing(true);
    try {
      await fetch('/api/history', { method: 'DELETE' });
      setAnalyses([]);
    } catch (err) {
      console.error('[HistoryPanel] clear error:', err);
      setError(err.message);
    } finally {
      setClearing(false);
    }
  };

  const formatDate = (dt) => {
    if (!dt) return '';
    return new Date(dt).toLocaleString();
  };

  const formatSize = (bytes) => {
    if (!bytes) return '';
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  return (
    <div className="history-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="history-panel">
        <div className="history-header">
          <h2>Analysis History</h2>
          <div className="history-header-actions">
            {analyses.length > 0 && (
              <button
                className="btn-clear-all"
                onClick={handleClearAll}
                disabled={clearing}
              >
                {clearing ? 'Clearing...' : 'Clear All'}
              </button>
            )}
            <button className="btn-close-history" onClick={onClose}>✕</button>
          </div>
        </div>

        {error && (
          <div className="history-error">{error}</div>
        )}

        {loading ? (
          <div className="history-loading">Loading history...</div>
        ) : analyses.length === 0 ? (
          <div className="history-empty">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <polyline points="10 9 9 9 8 9" />
            </svg>
            <p>No analyses saved yet.</p>
            <p className="history-empty-sub">Analyses are saved automatically after each run.</p>
          </div>
        ) : (
          <div className="history-list">
            {analyses.map(a => (
              <div key={a.id} className="history-item">
                <div className="history-item-top">
                  <div className="history-item-name">{a.filename}</div>
                  <span className={`health-badge ${a.overallHealth || 'fair'}`}>
                    {(a.overallHealth || 'fair').toUpperCase()}
                  </span>
                </div>

                <div className="history-item-meta">
                  <span>{formatDate(a.analyzedAt)}</span>
                  {a.filesize && <span>{formatSize(a.filesize)}</span>}
                  <span>{(a.totalLines || 0).toLocaleString()} lines</span>
                  <span>{a.totalSql || 0} SQL</span>
                  {(a.errorCount || 0) > 0 && (
                    <span className="history-error-count">{a.errorCount} errors</span>
                  )}
                </div>

                {a.summary && (
                  <div className="history-item-summary">
                    {a.summary.replace(/#+\s*/g, '').substring(0, 160)}...
                  </div>
                )}

                <div className="history-item-actions">
                  <button
                    className="btn-load-history"
                    onClick={() => handleLoad(a.id)}
                  >
                    Load Results
                  </button>
                  <button
                    className="btn-delete-history"
                    onClick={() => handleDelete(a.id)}
                    disabled={deleting === a.id}
                  >
                    {deleting === a.id ? '...' : 'Delete'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default HistoryPanel;
