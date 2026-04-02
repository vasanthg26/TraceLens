/**
 * ErrorPanel.jsx
 * Purpose: Grouped error/warning/info list with expandable PeopleCode & SQL context
 * Author: TraceLens
 */

import React, { useState, useMemo } from 'react';
import './ErrorPanel.css';

function ErrorPanel({ errors }) {
  const [collapsedGroups, setCollapsedGroups] = useState({});
  const [expandedError, setExpandedError] = useState(null);
  const [categoryFilter, setCategoryFilter] = useState('app');

  const appCount = useMemo(() => (errors || []).filter(e => e.category === 'app').length, [errors]);
  const portalCount = useMemo(() => (errors || []).filter(e => e.category === 'portal').length, [errors]);

  const visibleErrors = useMemo(() => {
    if (!errors) return [];
    if (categoryFilter === 'all') return errors;
    return errors.filter(e => e.category === categoryFilter);
  }, [errors, categoryFilter]);

  if (!errors || errors.length === 0) {
    return <div className="empty-state">No errors or warnings found. Clean trace!</div>;
  }

  const grouped = {
    critical: visibleErrors.filter(e => e.severity === 'critical'),
    warning: visibleErrors.filter(e => e.severity === 'warning'),
    info: visibleErrors.filter(e => e.severity === 'info')
  };

  const toggleGroup = (group) => {
    setCollapsedGroups(prev => ({ ...prev, [group]: !prev[group] }));
  };

  const severityLabel = {
    critical: 'CRITICAL',
    warning: 'WARNING',
    info: 'INFO'
  };

  const severityClass = {
    critical: 'critical',
    warning: 'warning',
    info: 'info'
  };

  return (
    <div className="error-panel">
      <div className="error-category-bar">
        {[['app', appCount], ['all', appCount + portalCount], ['portal', portalCount]].map(([cat, count]) => (
          <button
            key={cat}
            className={`category-btn ${categoryFilter === cat ? 'active' : ''}`}
            onClick={() => { setCategoryFilter(cat); setExpandedError(null); }}
          >
            {cat === 'all' ? `All (${count})` : cat === 'app' ? `App (${count})` : `Portal (${count})`}
          </button>
        ))}
      </div>
      {Object.entries(grouped).map(([severity, items]) => {
        if (items.length === 0) return null;
        const isCollapsed = collapsedGroups[severity];

        return (
          <div key={severity} className={`error-group ${severityClass[severity]}`}>
            <div
              className="error-group-header"
              onClick={() => toggleGroup(severity)}
            >
              <span className="error-group-toggle">
                {isCollapsed ? '\u25B6' : '\u25BC'}
              </span>
              <span className={`severity-label ${severityClass[severity]}`}>
                {severityLabel[severity]}
              </span>
              <span className="error-group-count">{items.length}</span>
            </div>

            {!isCollapsed && (
              <div className="error-list">
                {items.map((error, i) => {
                  const errKey = `${severity}-${i}`;
                  const isExpanded = expandedError === errKey;

                  return (
                    <div
                      key={i}
                      className={`error-item ${isExpanded ? 'expanded' : ''}`}
                    >
                      <div
                        className="error-item-header"
                        onClick={() => setExpandedError(isExpanded ? null : errKey)}
                      >
                        <span className={`error-severity-badge ${severityClass[severity]}`}>
                          {severityLabel[severity]}
                        </span>
                        <div className="error-item-info">
                          <div className="error-title">{error.title}</div>
                          <div className="error-location">
                            {error.program}
                            {error.event && ` > ${error.event}`}
                          </div>
                        </div>
                        <span className="error-line-ref">
                          Trace line {error.traceLineNumber}
                        </span>
                      </div>

                      {isExpanded && (
                        <div className="error-context">
                          {/* PeopleCode context */}
                          {error.codeContext && error.codeContext.length > 0 && (
                            <div className="error-code-section">
                              <div className="error-section-label">PeopleCode Context</div>
                              <div className="error-code-block">
                                {error.codeContext.map((line, j) => (
                                  <div key={j} className="error-code-line">
                                    <span className="error-code-linenum">{line.lineNum}</span>
                                    <code>{line.code}</code>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* SQL context */}
                          {error.errorSql && (
                            <div className="error-sql-section">
                              <div className="error-section-label">
                                Failed SQL
                                <span className={`error-rc-badge ${error.errorSqlRc !== 0 ? 'error' : ''}`}>
                                  RC={error.errorSqlRc}
                                </span>
                                <span className="error-sql-dur">Dur={error.errorSqlDur}s</span>
                              </div>
                              <pre className="error-sql-block"><code>{error.errorSql}</code></pre>
                            </div>
                          )}

                          {/* Nearby SQL statements */}
                          {error.sqlContext && error.sqlContext.length > 0 && !error.errorSql && (
                            <div className="error-sql-section">
                              <div className="error-section-label">Nearby SQL</div>
                              {error.sqlContext.map((sql, j) => (
                                <div key={j} className="error-sql-item">
                                  <span className={`error-rc-badge ${sql.rc !== 0 ? 'error' : ''}`}>
                                    RC={sql.rc}
                                  </span>
                                  <code>{sql.stmt}</code>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Raw error line */}
                          <div className="error-raw-section">
                            <div className="error-section-label">Raw Trace Line</div>
                            <div className="context-line highlight">{error.rawLine}</div>
                          </div>

                          {/* After context (clean entries) */}
                          {error.contextAfter && error.contextAfter.length > 0 && (
                            <div className="error-after-section">
                              <div className="error-section-label">After</div>
                              <div className="error-after-lines">
                                {error.contextAfter.map((entry, j) => (
                                  <div key={j} className="error-after-line">
                                    {typeof entry === 'object' ? (
                                      <>
                                        <span className={`error-ctx-badge ${entry.type}`}>{entry.type}</span>
                                        {entry.type === 'code' && (
                                          <><span className="error-code-linenum">{entry.lineNum}</span> <code>{entry.text}</code></>
                                        )}
                                        {entry.type === 'sql' && (
                                          <><span className={`error-rc-badge ${entry.rc !== 0 ? 'error' : ''}`}>RC={entry.rc}</span> <code>{entry.text}</code></>
                                        )}
                                        {entry.type === 'field' && (
                                          <><span className="error-field-action">{entry.action}</span> <code>{entry.field}</code> = <code>{entry.value}</code></>
                                        )}
                                        {entry.type === 'event' && (
                                          <code>{entry.text}</code>
                                        )}
                                      </>
                                    ) : (
                                      <code>{entry}</code>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default ErrorPanel;
