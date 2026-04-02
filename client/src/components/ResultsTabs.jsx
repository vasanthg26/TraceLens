/**
 * ResultsTabs.jsx
 * Purpose: Main tab navigation for all result sections with badges and health indicator
 * Author: TraceLens
 */

import React, { useState, useMemo } from 'react';
import './ResultsTabs.css';
import FlameChart from './FlameChart';
import SqlGroups from './SqlGroups';
import LoopDetector from './LoopDetector';
import FixPreview from './FixPreview';
import ErrorPanel from './ErrorPanel';
import ValueIssues from './ValueIssues';
import VariableTracer from './VariableTracer';
import { COLOR_MAP, EVENT_LEGEND, eventToLegendKey } from './eventConstants';
import SqlByTable from './SqlByTable/SqlByTable';

/**
 * Simple markdown-to-JSX renderer for LLM output.
 */
function MarkdownContent({ text }) {
  if (!text) return null;

  const lines = text.split('\n');
  const elements = [];
  let inCodeBlock = false;
  let codeLines = [];
  let codeKey = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code block toggle
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        elements.push(
          <pre key={`code-${codeKey++}`} className="md-code-block">
            <code>{codeLines.join('\n')}</code>
          </pre>
        );
        codeLines = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    // Headers
    if (line.startsWith('## ')) {
      elements.push(<h3 key={i} className="md-h2">{line.substring(3)}</h3>);
      continue;
    }
    if (line.startsWith('### ')) {
      elements.push(<h4 key={i} className="md-h3">{line.substring(4)}</h4>);
      continue;
    }

    // Bullet points
    if (line.match(/^\s*[-*]\s+/)) {
      const content = line.replace(/^\s*[-*]\s+/, '');
      elements.push(
        <div key={i} className="md-bullet">
          <span className="md-bullet-dot">&bull;</span>
          <span dangerouslySetInnerHTML={{ __html: inlineMd(content) }} />
        </div>
      );
      continue;
    }

    // Numbered items
    if (line.match(/^\s*\d+[\.\)]\s+/)) {
      const numMatch = line.match(/^\s*(\d+)[\.\)]\s+(.*)/);
      if (numMatch) {
        elements.push(
          <div key={i} className="md-numbered">
            <span className="md-num">{numMatch[1]}.</span>
            <span dangerouslySetInnerHTML={{ __html: inlineMd(numMatch[2]) }} />
          </div>
        );
        continue;
      }
    }

    // Empty line
    if (!line.trim()) {
      continue;
    }

    // Regular paragraph
    elements.push(
      <p key={i} className="md-para" dangerouslySetInnerHTML={{ __html: inlineMd(line) }} />
    );
  }

  // Flush remaining code block
  if (inCodeBlock && codeLines.length > 0) {
    elements.push(
      <pre key={`code-${codeKey}`} className="md-code-block">
        <code>{codeLines.join('\n')}</code>
      </pre>
    );
  }

  return <>{elements}</>;
}

/** Inline markdown: **bold**, `code`, *italic* */
function inlineMd(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/`([^`]+)`/g, '<code class="md-inline-code">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

/**
 * EventFlowPanel — clickable event list that expands to show PeopleCode + SQL
 */
function EventFlowPanel({ events, activeFilters, onFilterChange }) {
  const [expandedEvent, setExpandedEvent] = useState(null);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [visibleCount, setVisibleCount] = useState(200);

  const allKeys = Object.keys(EVENT_LEGEND);
  const isAllActive = !activeFilters || activeFilters.size === allKeys.length;

  const handleLegendClick = (key, e) => {
    if (!onFilterChange) return;
    if (e.shiftKey) {
      const next = new Set(activeFilters || allKeys);
      if (next.has(key)) {
        next.delete(key);
        if (next.size === 0) { onFilterChange(null); return; }
      } else {
        next.add(key);
      }
      onFilterChange(next.size === allKeys.length ? null : next);
    } else {
      if (activeFilters && activeFilters.size === 1 && activeFilters.has(key)) {
        onFilterChange(null);
      } else {
        onFilterChange(new Set([key]));
      }
    }
  };

  const startEvents = useMemo(() => {
    setVisibleCount(200);
    if (!events?.eventFlow) return [];
    let starts = events.eventFlow.filter(e => e.type === 'start');
    if (categoryFilter !== 'all') {
      starts = starts.filter(e => e.category === categoryFilter);
    }
    if (!activeFilters) return starts;
    return starts.filter(e => activeFilters.has(eventToLegendKey(e.eventName)));
  }, [events, activeFilters, categoryFilter]);

  if (!events?.eventFlow?.length) {
    return <div className="empty-state">No PeopleCode events detected in this trace.</div>;
  }

  const appCount = useMemo(() => events?.eventFlow?.filter(e => e.type === 'start' && e.category === 'app').length || 0, [events]);
  const portalCount = useMemo(() => events?.eventFlow?.filter(e => e.type === 'start' && e.category === 'portal').length || 0, [events]);

  return (
    <div className="event-flow-panel">
      <div className="category-filter">
        {['all', 'app', 'portal'].map(cat => (
          <button
            key={cat}
            className={`category-btn ${categoryFilter === cat ? 'active' : ''}`}
            onClick={() => { setCategoryFilter(cat); setExpandedEvent(null); }}
          >
            {cat === 'all' ? `All (${appCount + portalCount})` : cat === 'app' ? `App (${appCount})` : `Portal (${portalCount})`}
          </button>
        ))}
      </div>
      <div className="flame-legend">
        {Object.entries(EVENT_LEGEND).map(([label, color]) => {
          const isActive = !activeFilters || activeFilters.has(label);
          return (
            <div
              key={label}
              className={`flame-legend-item ${isActive ? '' : 'inactive'} clickable`}
              onClick={(e) => handleLegendClick(label, e)}
            >
              <div
                className="flame-legend-dot"
                style={{ backgroundColor: COLOR_MAP[color], opacity: isActive ? 1 : 0.2 }}
              />
              <span>{label}</span>
            </div>
          );
        })}
        {!isAllActive && (
          <button className="filter-reset-btn" onClick={() => onFilterChange(null)}>
            Show All
          </button>
        )}
      </div>
      <div className="flame-hint">Click to solo · Shift+click to toggle · {startEvents.length} events shown</div>
      <div className="event-flow-list">
        {startEvents.slice(0, visibleCount).map((event, i) => {
          const isExpanded = expandedEvent === i;
          const hasCode = event.codeLines?.length > 0;
          const hasSql = event.sqlLines?.length > 0;
          const hasFields = event.fieldOps?.length > 0;
          const hasContent = hasCode || hasSql || hasFields;

          // Find matching end event for duration
          const endEvent = events.eventFlow.find(
            e => e.type === 'end' && e.label === event.label && e.depth === event.depth
          );

          return (
            <div key={i} className="event-block">
              <div
                className={`event-row start ${isExpanded ? 'expanded' : ''} ${hasContent ? 'clickable' : ''}`}
                style={{ paddingLeft: `${(event.depth || 0) * 20 + 12}px` }}
                onClick={() => hasContent && setExpandedEvent(isExpanded ? null : i)}
              >
                <span className={`event-marker start depth-${Math.min(event.depth || 0, 3)}`}>
                  {event.depth > 0
                    ? (hasContent ? (isExpanded ? '◇' : '◆') : '◆')
                    : (hasContent ? (isExpanded ? '▼' : '▶') : '▶')
                  }
                </span>
                <span className="event-label">{event.label}</span>
                <div className="event-badges">
                  {hasCode && <span className="event-badge code">{event.codeLines.length} lines</span>}
                  {hasSql && <span className="event-badge sql">{event.sqlLines.length} SQL</span>}
                  {hasFields && <span className="event-badge field">{event.fieldOps.length} fields</span>}
                </div>
                {endEvent?.duration !== undefined && (
                  <span className="event-duration">{endEvent.duration}ms</span>
                )}
              </div>

              {isExpanded && hasContent && (
                <div className="event-detail" style={{ marginLeft: `${(event.depth || 0) * 20 + 32}px` }}>
                  {/* PeopleCode lines */}
                  {hasCode && (
                    <div className="event-detail-section">
                      <div className="event-detail-label">PeopleCode</div>
                      <div className="event-code-block">
                        {event.codeLines.map((line, j) => (
                          <div key={j} className="event-code-line">
                            <span className="event-code-num">{line.lineNum}</span>
                            <code>{line.text}</code>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* SQL statements */}
                  {hasSql && (
                    <div className="event-detail-section">
                      <div className="event-detail-label">SQL Statements</div>
                      <div className="event-sql-list">
                        {event.sqlLines.map((sql, j) => (
                          <div key={j} className="event-sql-item">
                            <span className={`event-sql-rc ${sql.rc !== 0 ? 'error' : ''}`}>RC={sql.rc}</span>
                            <span className="event-sql-dur">{sql.dur.toFixed(6)}s</span>
                            <code>{sql.text}</code>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Field operations */}
                  {hasFields && (
                    <div className="event-detail-section">
                      <div className="event-detail-label">Field Operations</div>
                      <div className="event-field-list">
                        {event.fieldOps.map((op, j) => (
                          <div key={j} className="event-field-item">
                            <span className={`event-field-action ${op.action.toLowerCase()}`}>{op.action}</span>
                            <code className="event-field-name">{op.field}</code>
                            <span className="event-field-eq">=</span>
                            <code className="event-field-value">{op.value}</code>
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
        {startEvents.length > visibleCount && (
          <div className="event-truncated">
            <button className="load-more-btn" onClick={() => setVisibleCount(c => c + 200)}>
              Load 200 more ({startEvents.length - visibleCount} remaining)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ResultsTabs({ results, llmAnalysis, llmTokens, llmError, onReset, onSaveToHistory, historySaved, componentMetadata }) {
  const [activeTab, setActiveTab] = useState('performance');
  const [activeSubTab, setActiveSubTab] = useState('flame');
  const [aiExpanded, setAiExpanded] = useState(false);
  const [eventFilter, setEventFilter] = useState(null); // null = show all, Set = active event types

  const { summary, sql, loops, events, errors, variables } = results;

  const health = llmAnalysis?.health || 'fair';
  const errorCount = errors?.errorStats?.total || 0;
  const criticalCount = errors?.errorStats?.critical || 0;
  const warningCount = errors?.errorStats?.warnings || 0;
  const valueIssueCount = errors?.errorStats?.valueIssueCount || 0;
  const eventCount = events?.eventCount || 0;
  const varCount = variables?.uniqueVariables || 0;

  const tabs = [
    { id: 'performance', label: 'Performance Deep-Dive', badge: null },
    { id: 'errors', label: 'Errors & Warnings', badge: errorCount > 0 ? errorCount : null },
    { id: 'variables', label: 'Variable Tracer', badge: varCount },
    { id: 'values', label: 'Value Issues', badge: valueIssueCount },
    { id: 'events', label: 'Event Flow', badge: eventCount },
    { id: 'ai', label: 'AI Analysis', badge: null, icon: true }
  ];

  const subTabs = [
    { id: 'flame', label: 'Flame Chart' },
    { id: 'sql', label: 'SQL Groups' },
    { id: 'sqltable', label: 'SQL by Table' },
    { id: 'loops', label: 'Loop Detector' },
    { id: 'fixes', label: 'Fix Previews' }
  ];

  return (
    <div className="results-tabs">
      {/* ── Summary Stats Bar ── */}
      {summary && (
        <div className="summary-stats-bar">
          <div className="summary-stats">
            <div className="stat">
              <span className="stat-value">{summary.totalLines?.toLocaleString()}</span>
              <span className="stat-label">Lines</span>
            </div>
            <div className="stat">
              <span className="stat-value">{summary.fileSizeMB}</span>
              <span className="stat-label">MB</span>
            </div>
            <div className="stat">
              <span className="stat-value">{sql?.sqlStats?.totalStatements || 0}</span>
              <span className="stat-label">SQL Stmts</span>
            </div>
            <div className="stat">
              <span className="stat-value">{sql?.sqlStats?.slowQueryCount || 0}</span>
              <span className="stat-label">Slow Queries</span>
            </div>
            <div className="stat">
              <span className="stat-value">{loops?.loopCount || 0}</span>
              <span className="stat-label">Loops</span>
            </div>
            <div className="stat">
              <span className="stat-value">{criticalCount}</span>
              <span className="stat-label">Errors</span>
            </div>
            <div className="stat">
              <span className="stat-value">{warningCount}</span>
              <span className="stat-label">Warnings</span>
            </div>
          </div>
          <div className="summary-stats-right">
            <span className={`health-badge ${health}`}>{health.toUpperCase()}</span>
            {onSaveToHistory && (
              <button
                className={`btn-save-history ${historySaved ? 'saved' : ''}`}
                onClick={onSaveToHistory}
                disabled={historySaved}
                title={historySaved ? 'Saved to history' : 'Save to history'}
              >
                {historySaved ? 'Saved ✓' : 'Save to History'}
              </button>
            )}
            <button className="btn-new-analysis" onClick={onReset}>New Analysis</button>
          </div>
        </div>
      )}

      {/* ── Component Context Metadata ── */}
      {componentMetadata && (componentMetadata.componentName || componentMetadata.menuName || componentMetadata.portalName) && (
        <div className="component-context-bar">
          <span className="context-label">Component Context:</span>
          {componentMetadata.portalName && (
            <span className="context-chip portal" title="Portal">{componentMetadata.portalName}</span>
          )}
          {componentMetadata.menuName && (
            <span className="context-chip menu" title="Menu">{componentMetadata.menuName}</span>
          )}
          {componentMetadata.componentName && (
            <span className="context-chip component" title="Component">{componentMetadata.componentName}</span>
          )}
        </div>
      )}

      {/* ── Main Tabs ── */}
      <div className="tabs-bar">
        {tabs.map(tab => (
          <button
            key={tab.id}
            className={`tab-btn ${activeTab === tab.id ? 'active' : ''} ${tab.id === 'ai' ? 'ai-tab' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.icon && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            )}
            {tab.label}
            {tab.badge > 0 && <span className="badge">{tab.badge}</span>}
            {tab.id === 'ai' && llmTokens && !llmAnalysis && <span className="ai-streaming-dot" />}
          </button>
        ))}
      </div>

      {/* ── Performance Sub-tabs ── */}
      {activeTab === 'performance' && (
        <div className="subtabs-bar">
          {subTabs.map(tab => (
            <button
              key={tab.id}
              className={`subtab-btn ${activeSubTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveSubTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Tab Content ── */}
      <div className="tab-content">
        {activeTab === 'performance' && activeSubTab === 'flame' && (
          <FlameChart data={events?.flameData || []} activeFilters={eventFilter} onFilterChange={setEventFilter} />
        )}
        {activeTab === 'performance' && activeSubTab === 'sql' && (
          <SqlGroups data={sql?.sqlGroups || []} stats={sql?.sqlStats} />
        )}
        {activeTab === 'performance' && activeSubTab === 'sqltable' && (
          <SqlByTable data={sql?.sqlByTable || []} />
        )}
        {activeTab === 'performance' && activeSubTab === 'loops' && (
          <LoopDetector data={loops?.loopPatterns || []} codeLoops={loops?.codeLoops || []} totalWasted={loops?.totalWastedTime || 0} />
        )}
        {activeTab === 'performance' && activeSubTab === 'fixes' && (
          <FixPreview fixes={llmAnalysis?.fixes || []} />
        )}
        {activeTab === 'errors' && (
          <ErrorPanel errors={errors?.errors || []} />
        )}
        {activeTab === 'variables' && (
          <VariableTracer data={variables} />
        )}
        {activeTab === 'values' && (
          <ValueIssues issues={errors?.valueIssues || []} />
        )}
        {activeTab === 'events' && (
          <EventFlowPanel events={events} activeFilters={eventFilter} onFilterChange={setEventFilter} />
        )}
        {activeTab === 'ai' && (
          <div className="ai-tab-content">
            {llmAnalysis?.summary ? (
              <>
                <div className={`ai-analysis-body ${aiExpanded ? 'expanded' : 'collapsed'}`}>
                  <MarkdownContent text={llmAnalysis.summary} />
                </div>
                <button
                  className="ai-expand-btn"
                  onClick={() => setAiExpanded(!aiExpanded)}
                >
                  {aiExpanded ? 'Show Less' : 'Show Full Analysis'}
                </button>
                {llmAnalysis.topRecommendation && !aiExpanded && (
                  <div className="top-recommendation">
                    <strong>Top Recommendation:</strong> {llmAnalysis.topRecommendation}
                  </div>
                )}
              </>
            ) : llmTokens ? (
              <div className="streaming-text">
                <MarkdownContent text={llmTokens} />
                <span className="cursor">|</span>
              </div>
            ) : llmError ? (
              <p className="ai-error">LLM unavailable: {llmError}</p>
            ) : (
              <p className="ai-loading">Waiting for AI analysis...</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default ResultsTabs;
