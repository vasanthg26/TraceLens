/**
 * ResultsTabs.jsx
 * Purpose: Main tab navigation — 4 tabs: Errors, Events, SQL, Ask
 *   - Errors: ErrorPanel + ValueIssues merged
 *   - Events: EventFlowPanel + FlameChart sub-tabs
 *   - SQL:    SqlGroups + SqlByTable + LoopDetector sub-tabs
 *   - Ask:    ChatPanel (auto-analysis + chat)
 */

import React, { useState, useMemo } from 'react';
import './ResultsTabs.css';
import FlameChart from './FlameChart';
import SqlGroups from './SqlGroups';
import LoopDetector from './LoopDetector';
import FixPreview from './FixPreview';
import ErrorPanel from './ErrorPanel';
import ValueIssues from './ValueIssues';
import ChatPanel from './ChatPanel';
import { COLOR_MAP, EVENT_LEGEND, eventToLegendKey } from './eventConstants';
import SqlByTable from './SqlByTable/SqlByTable';

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

/**
 * @param {object}   props
 * @param {object}   props.results
 * @param {object}   props.llmAnalysis
 * @param {string}   props.llmTokens
 * @param {string}   props.llmError
 * @param {function} props.onReset
 * @param {function} props.onSaveToHistory
 * @param {boolean}  props.historySaved
 * @param {object}   props.componentMetadata
 * @param {string}   props.activeTab             - controlled from App.jsx
 * @param {function} props.onTabChange           - (tabId) => void
 * @param {Array}    props.chatMessages
 * @param {function} props.onChatSend
 * @param {boolean}  props.chatStreaming
 * @param {string}   props.autoAnalysisStatus    - null | 'loading' | 'done'
 * @param {string}   props.autoAnalysisContent
 * @param {boolean}  props.autoAnalysisUpgrade
 * @param {boolean}  props.hasAnthropicKey
 * @param {function} props.onOpenSettings - opens the Settings panel (for UpgradeCard CTA)
 */
function ResultsTabs({
  results,
  llmAnalysis,
  llmTokens,
  llmError,
  onReset,
  onSaveToHistory,
  historySaved,
  componentMetadata,
  activeTab,
  onTabChange,
  chatMessages,
  onChatSend,
  chatStreaming,
  autoAnalysisStatus,
  autoAnalysisContent,
  autoAnalysisUpgrade,
  hasAnthropicKey,
  onOpenSettings,
}) {
  const [activeSubTabEvents, setActiveSubTabEvents] = useState('flow');
  const [activeSubTabSql, setActiveSubTabSql] = useState('groups');
  const [eventFilter, setEventFilter] = useState(null);

  const { summary, sql, loops, events, errors } = results;

  const health = llmAnalysis?.health || 'fair';
  const errorCount  = (errors?.errorStats?.critical || 0) + (errors?.errorStats?.warnings || 0);
  const valueIssueCount = errors?.errorStats?.valueIssueCount || 0;
  const errBadge = errorCount + valueIssueCount || null;
  const eventCount = events?.eventCount || 0;
  const loopCount  = loops?.loopCount || 0;
  const sqlCount   = sql?.sqlStats?.slowQueryCount || 0;

  const tabs = [
    { id: 'errors',  label: 'Errors',  badge: errBadge },
    { id: 'events',  label: 'Events',  badge: eventCount || null },
    { id: 'sql',     label: 'SQL',     badge: sqlCount || null },
    { id: 'ask',     label: 'Ask',     badge: null, special: autoAnalysisStatus === 'loading' },
  ];

  const eventSubTabs = [
    { id: 'flow',  label: 'Event Flow' },
    { id: 'flame', label: 'Flame Chart' },
  ];

  const sqlSubTabs = [
    { id: 'groups',  label: 'SQL Groups' },
    { id: 'table',   label: 'By Table' },
    { id: 'loops',   label: `Loops${loopCount ? ` (${loopCount})` : ''}` },
    { id: 'fixes',   label: 'Fix Previews' },
  ];

  const currentTab = activeTab || 'errors';

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
              <span className="stat-label">Slow</span>
            </div>
            <div className="stat">
              <span className="stat-value">{loopCount}</span>
              <span className="stat-label">Loops</span>
            </div>
            <div className="stat">
              <span className="stat-value">{errors?.errorStats?.critical || 0}</span>
              <span className="stat-label">Errors</span>
            </div>
            <div className="stat">
              <span className="stat-value">{errors?.errorStats?.warnings || 0}</span>
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
            className={`tab-btn ${currentTab === tab.id ? 'active' : ''} ${tab.id === 'ask' ? 'ask-tab' : ''}`}
            onClick={() => onTabChange ? onTabChange(tab.id) : null}
          >
            {tab.id === 'ask' && (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 4 }}>
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            )}
            {tab.label}
            {tab.badge != null && tab.badge > 0 && <span className="badge">{tab.badge}</span>}
            {tab.special && <span className="ai-streaming-dot" />}
          </button>
        ))}
      </div>

      {/* ── Events Sub-tabs ── */}
      {currentTab === 'events' && (
        <div className="subtabs-bar">
          {eventSubTabs.map(t => (
            <button
              key={t.id}
              className={`subtab-btn ${activeSubTabEvents === t.id ? 'active' : ''}`}
              onClick={() => setActiveSubTabEvents(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* ── SQL Sub-tabs ── */}
      {currentTab === 'sql' && (
        <div className="subtabs-bar">
          {sqlSubTabs.map(t => (
            <button
              key={t.id}
              className={`subtab-btn ${activeSubTabSql === t.id ? 'active' : ''}`}
              onClick={() => setActiveSubTabSql(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Tab Content ── */}
      <div className={`tab-content ${currentTab === 'ask' ? 'tab-content--ask' : ''}`}>
        {currentTab === 'errors' && (
          <>
            <ErrorPanel errors={errors?.errors || []} />
            {(errors?.valueIssues?.length > 0) && (
              <ValueIssues issues={errors.valueIssues} />
            )}
          </>
        )}

        {currentTab === 'events' && activeSubTabEvents === 'flow' && (
          <EventFlowPanel events={events} activeFilters={eventFilter} onFilterChange={setEventFilter} />
        )}
        {currentTab === 'events' && activeSubTabEvents === 'flame' && (
          <FlameChart data={events?.flameData || []} activeFilters={eventFilter} onFilterChange={setEventFilter} />
        )}

        {currentTab === 'sql' && activeSubTabSql === 'groups' && (
          <SqlGroups data={sql?.sqlGroups || []} stats={sql?.sqlStats} />
        )}
        {currentTab === 'sql' && activeSubTabSql === 'table' && (
          <SqlByTable data={sql?.sqlByTable || []} />
        )}
        {currentTab === 'sql' && activeSubTabSql === 'loops' && (
          <LoopDetector data={loops?.loopPatterns || []} codeLoops={loops?.codeLoops || []} totalWasted={loops?.totalWastedTime || 0} />
        )}
        {currentTab === 'sql' && activeSubTabSql === 'fixes' && (
          <FixPreview fixes={llmAnalysis?.fixes || []} />
        )}

        {currentTab === 'ask' && (
          <ChatPanel
            messages={chatMessages || []}
            onSend={onChatSend}
            streaming={chatStreaming}
            autoAnalysisStatus={autoAnalysisStatus}
            autoAnalysisContent={autoAnalysisContent}
            autoAnalysisUpgrade={autoAnalysisUpgrade}
            hasAnthropicKey={hasAnthropicKey}
            onOpenSettings={onOpenSettings}
          />
        )}
      </div>
    </div>
  );
}

export default ResultsTabs;
