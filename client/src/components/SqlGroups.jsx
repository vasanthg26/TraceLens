/**
 * SqlGroups.jsx
 * Purpose: Sortable table of grouped SQL with expandable details and N+1 badges
 * Author: TraceLens
 */

import React, { useState, useMemo } from 'react';
import './SqlGroups.css';

function SqlGroups({ data, stats }) {
  const [sortBy, setSortBy] = useState('totalTime');
  const [sortDir, setSortDir] = useState('desc');
  const [expandedRow, setExpandedRow] = useState(null);
  const [selectedProcess, setSelectedProcess] = useState('all');

  const allProcesses = stats?.allProcesses || [];
  const showProcessFilter = allProcesses.length > 1;

  const handleSort = (column) => {
    if (sortBy === column) {
      setSortDir(prev => prev === 'desc' ? 'asc' : 'desc');
    } else {
      setSortBy(column);
      setSortDir('desc');
    }
  };

  const filtered = useMemo(() => {
    if (!showProcessFilter || selectedProcess === 'all') return data;
    return data.filter(g => g.processes?.includes(selectedProcess));
  }, [data, selectedProcess, showProcessFilter]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const mult = sortDir === 'desc' ? -1 : 1;
      if (sortBy === 'preview') return mult * a.preview.localeCompare(b.preview);
      return mult * ((a[sortBy] || 0) - (b[sortBy] || 0));
    });
  }, [filtered, sortBy, sortDir]);

  const sortIndicator = (col) => {
    if (sortBy !== col) return '';
    return sortDir === 'desc' ? ' \u25BC' : ' \u25B2';
  };

  if (!data || data.length === 0) {
    return <div className="empty-state">No SQL statements detected in this trace.</div>;
  }

  return (
    <div className="sql-groups">
      {stats && (
        <div className="sql-summary-row">
          <span>{stats.totalStatements} total statements</span>
          <span>{stats.uniqueStatements} unique</span>
          <span>{stats.totalSqlTime.toFixed(2)}s total SQL time</span>
          {stats.nPlusOneCount > 0 && (
            <span className="badge red">N+1: {stats.nPlusOneCount}</span>
          )}
          {showProcessFilter && (
            <select
              className="process-filter-select"
              value={selectedProcess}
              onChange={e => { setSelectedProcess(e.target.value); setExpandedRow(null); }}
            >
              <option value="all">All Processes</option>
              {allProcesses.map(p => (
                <option key={p} value={p}>Process {p}</option>
              ))}
            </select>
          )}
        </div>
      )}

      <div className="sql-table-wrapper">
        <table className="sql-table">
          <thead>
            <tr>
              <th className="sortable" onClick={() => handleSort('preview')}>
                SQL Preview{sortIndicator('preview')}
              </th>
              <th className="sortable num" onClick={() => handleSort('count')}>
                Count{sortIndicator('count')}
              </th>
              <th className="sortable num" onClick={() => handleSort('totalTime')}>
                Total Time{sortIndicator('totalTime')}
              </th>
              <th className="sortable num" onClick={() => handleSort('avgTime')}>
                Avg Time{sortIndicator('avgTime')}
              </th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((group, i) => (
              <React.Fragment key={group.signature}>
                <tr
                  className={`sql-row ${expandedRow === i ? 'expanded' : ''} ${group.slowCount > 0 ? 'slow' : ''}`}
                  onClick={() => setExpandedRow(expandedRow === i ? null : i)}
                >
                  <td className="sql-preview-cell">
                    <code>{group.preview}</code>
                  </td>
                  <td className="num">{group.count}</td>
                  <td className="num">{group.totalTime.toFixed(3)}s</td>
                  <td className="num">{group.avgTime.toFixed(3)}s</td>
                  <td className="status-cell">
                    {group.isNPlusOne && <span className="badge red">N+1</span>}
                    {group.slowCount > 0 && <span className="badge orange">SLOW</span>}
                  </td>
                </tr>

                {expandedRow === i && (
                  <tr className="sql-detail-row">
                    <td colSpan="5">
                      <div className="sql-detail">
                        <div className="sql-detail-section">
                          <h4>Full Normalized SQL</h4>
                          <pre>{group.normalizedSql}</pre>
                        </div>
                        <div className="sql-detail-stats">
                          <div><span>Executions:</span> {group.count}</div>
                          <div><span>Max Time:</span> {group.maxTime.toFixed(3)}s</div>
                          <div><span>Bind Variations:</span> {group.bindVariations.length}</div>
                        </div>
                        {group.bindVariations.length > 0 && (
                          <div className="sql-detail-section">
                            <h4>Sample Bind Values</h4>
                            <ul>
                              {group.bindVariations.map((bv, j) => (
                                <li key={j}><code>{bv}</code></li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {group.slowCount > 0 && (
                          <div className="sql-slow-warning">
                            This query exceeded the slow threshold {group.slowCount} time(s).
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default SqlGroups;
