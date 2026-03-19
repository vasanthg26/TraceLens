/**
 * LoopDetector.jsx
 * Purpose: Cards showing SQL repeat patterns AND PeopleCode loop constructs with fix suggestions
 * Author: TraceLens
 */

import React, { useState } from 'react';
import './LoopDetector.css';

function LoopDetector({ data, codeLoops, totalWasted }) {
  const [expandedCard, setExpandedCard] = useState(null);

  const hasData = (data && data.length > 0) || (codeLoops && codeLoops.length > 0);

  if (!hasData) {
    return <div className="empty-state">No loop patterns detected. Your code looks clean!</div>;
  }

  const getSeverityForSqlRepeat = (repeatCount) => {
    if (repeatCount >= 10) return { icon: '\u26A0', className: 'high' };
    if (repeatCount >= 5) return { icon: '\u26A0', className: 'medium' };
    return { icon: '\u2139', className: 'low' };
  };

  const getSeverityForCodeLoop = (severity) => {
    if (severity === 'critical') return { icon: '\u26A0', className: 'high' };
    if (severity === 'warning') return { icon: '\u26A0', className: 'medium' };
    return { icon: '\u2139', className: 'low' };
  };

  const totalPatterns = (data?.length || 0) + (codeLoops?.length || 0);

  return (
    <div className="loop-detector">
      <div className="loop-summary">
        <span>{totalPatterns} loop pattern{totalPatterns !== 1 ? 's' : ''} detected</span>
        {totalWasted > 0 && (
          <span className="loop-wasted-total">
            ~{totalWasted}s total estimated wasted time
          </span>
        )}
      </div>

      {/* ── PeopleCode Loop Constructs (For/While/Repeat with SQL) ── */}
      {codeLoops && codeLoops.length > 0 && (
        <>
          <div className="loop-section-header">
            <span className="loop-section-label">PeopleCode Loops with SQL</span>
            <span className="badge red">{codeLoops.length}</span>
          </div>
          <div className="loop-cards">
            {codeLoops.map((loop, i) => {
              const severity = getSeverityForCodeLoop(loop.severity);
              const cardKey = `code-${i}`;
              const isExpanded = expandedCard === cardKey;

              return (
                <div key={cardKey} className={`loop-card ${severity.className}`}>
                  <div className="loop-card-header">
                    <div className="loop-card-left">
                      <span className={`loop-severity-icon ${severity.className}`}>
                        {severity.icon}
                      </span>
                      <div className="loop-card-info">
                        <div className="loop-location">
                          <span className="loop-type-badge">{loop.loopType}</span>
                          {loop.location}
                        </div>
                        <div className="loop-sql-preview">
                          <code>{loop.loopStatement}</code>
                        </div>
                      </div>
                    </div>
                    <div className="loop-card-right">
                      <div className="loop-repeat-count">
                        {loop.sqlCount} SQL call{loop.sqlCount !== 1 ? 's' : ''} inside
                      </div>
                      <div className="loop-line-ref">
                        Lines {loop.startLine}-{loop.endLine}
                      </div>
                      {loop.nestingDepth > 0 && (
                        <div className="loop-nested-badge">NESTED</div>
                      )}
                    </div>
                  </div>

                  {/* SQL calls found inside this loop */}
                  {loop.sqlCalls && loop.sqlCalls.length > 0 && (
                    <div className="loop-sql-list">
                      {loop.sqlCalls.map((sql, j) => (
                        <div key={j} className="loop-sql-item">
                          <code>{sql}</code>
                        </div>
                      ))}
                    </div>
                  )}

                  <button
                    className="loop-expand-btn"
                    onClick={() => setExpandedCard(isExpanded ? null : cardKey)}
                  >
                    {isExpanded ? 'Hide Fix Suggestion' : 'Show Fix Suggestion'}
                  </button>

                  {isExpanded && (
                    <div className="loop-fix-section">
                      <div className="loop-fix-hint">
                        <strong>Suggested Fix:</strong>
                        <p>{loop.fixHint}</p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ── SQL Repeat Patterns (sliding window) ── */}
      {data && data.length > 0 && (
        <>
          <div className="loop-section-header">
            <span className="loop-section-label">Repeated SQL Patterns</span>
            <span className="badge orange">{data.length}</span>
          </div>
          <div className="loop-cards">
            {data.map((loop, i) => {
              const severity = getSeverityForSqlRepeat(loop.repeatCount);
              const cardKey = `sql-${i}`;
              const isExpanded = expandedCard === cardKey;

              return (
                <div key={cardKey} className={`loop-card ${severity.className}`}>
                  <div className="loop-card-header">
                    <div className="loop-card-left">
                      <span className={`loop-severity-icon ${severity.className}`}>
                        {severity.icon}
                      </span>
                      <div className="loop-card-info">
                        <div className="loop-location">{loop.location}</div>
                        <div className="loop-sql-preview">
                          <code>{loop.sqlPreview}</code>
                        </div>
                      </div>
                    </div>
                    <div className="loop-card-right">
                      <div className="loop-repeat-count">
                        {loop.repeatCount}x repeats
                      </div>
                      {loop.totalWastedTime > 0 && (
                        <div className="loop-wasted-time">
                          {loop.totalWastedTime}s wasted
                        </div>
                      )}
                    </div>
                  </div>

                  <button
                    className="loop-expand-btn"
                    onClick={() => setExpandedCard(isExpanded ? null : cardKey)}
                  >
                    {isExpanded ? 'Hide Fix Suggestion' : 'Show Fix Suggestion'}
                  </button>

                  {isExpanded && (
                    <div className="loop-fix-section">
                      <div className="loop-fix-hint">
                        <strong>Suggested Fix:</strong>
                        <p>{loop.fixHint}</p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export default LoopDetector;
