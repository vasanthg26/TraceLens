/**
 * ValueIssues.jsx
 * Purpose: List of variable/value problems found with badges
 * Author: TraceLens
 */

import React from 'react';
import './ValueIssues.css';

function ValueIssues({ issues }) {
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
        {issues.length} value issue{issues.length !== 1 ? 's' : ''} found
      </div>

      <div className="value-issues-list">
        {issues.map((issue, i) => (
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
