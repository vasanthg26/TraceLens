/**
 * ValueIssues.jsx
 * Purpose: List of variable/value problems found with badges
 * Author: TraceLens
 */

import React, { useState, useMemo } from 'react';
import './ValueIssues.css';

function ValueIssues({ issues }) {
  const [categoryFilter, setCategoryFilter] = useState('app');

  const appCount = useMemo(() => (issues || []).filter(i => i.category === 'app').length, [issues]);
  const portalCount = useMemo(() => (issues || []).filter(i => i.category === 'portal').length, [issues]);

  const visible = useMemo(() => {
    if (!issues) return [];
    if (categoryFilter === 'all') return issues;
    return issues.filter(i => i.category === categoryFilter);
  }, [issues, categoryFilter]);

  if (!issues || issues.length === 0) {
    return <div className="empty-state">No value issues detected.</div>;
  }

  const typeColors = {
    VALUE: 'blue',
    NULL: 'orange',
    NULL_BIND: 'red',
    EMPTY: 'orange',
    UNINIT: 'red',
    OVERFLOW: 'purple'
  };

  return (
    <div className="value-issues">
      <div className="value-issues-header">
        <span>{visible.length} value issue{visible.length !== 1 ? 's' : ''} shown</span>
        <div className="category-filter">
          {[['app', appCount], ['all', appCount + portalCount], ['portal', portalCount]].map(([cat, count]) => (
            <button
              key={cat}
              className={`category-btn ${categoryFilter === cat ? 'active' : ''}`}
              onClick={() => setCategoryFilter(cat)}
            >
              {cat === 'all' ? `All (${count})` : cat === 'app' ? `App (${count})` : `Portal (${count})`}
            </button>
          ))}
        </div>
      </div>

      <div className="value-issues-list">
        {visible.map((issue, i) => (
          <div key={i} className="value-issue-card">
            <div className="value-issue-top">
              <span className={`badge ${typeColors[issue.type] || 'blue'}`}>
                {issue.type}
              </span>
              <span className="value-issue-variable">
                <code>{issue.variable}</code>
              </span>
              <span className="value-issue-location">{issue.location}</span>
            </div>
            <div className="value-issue-description">
              {issue.description}
            </div>
            <div className="value-issue-fix">
              <strong>Fix:</strong> {issue.fix}
            </div>
            <div className="value-issue-line">
              Trace line {issue.traceLineNumber}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default ValueIssues;
