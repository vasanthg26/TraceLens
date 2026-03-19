/**
 * VariableTracer.jsx
 * Purpose: Search any variable/field and see its full value-flow path through the trace
 * Author: TraceLens
 */

import React, { useState, useMemo } from 'react';
import './VariableTracer.css';

const TYPE_LABELS = {
  fetch: 'FETCH',
  store: 'STORE',
  assign: 'ASSIGN',
  'sql-bind': 'SQL BIND',
  'sql-where': 'SQL WHERE',
  param: 'PARAM',
  'param-value': 'VALUE'
};

const TYPE_COLORS = {
  fetch: 'blue',
  store: 'green',
  assign: 'purple',
  'sql-bind': 'orange',
  'sql-where': 'orange',
  param: 'cyan',
  'param-value': 'cyan'
};

function VariableTracer({ data }) {
  const [search, setSearch] = useState('');
  const [selectedVar, setSelectedVar] = useState(null);
  const [filterType, setFilterType] = useState('all');

  const variables = data?.variables || [];
  const allEvents = data?.events || [];

  // Autocomplete suggestions
  const suggestions = useMemo(() => {
    if (!search || search.length < 2) return [];
    const term = search.toLowerCase();
    return variables
      .filter(v => v.toLowerCase().includes(term))
      .slice(0, 15);
  }, [search, variables]);

  // Trace results for selected variable
  const traceResults = useMemo(() => {
    if (!selectedVar) return [];
    const term = selectedVar.toLowerCase();
    return allEvents.filter(e => {
      const varLower = e.variable.toLowerCase();
      // Match exact or partial (field name part)
      if (varLower === term) return true;
      if (varLower.includes(term)) return true;
      if (varLower.includes('.')) {
        const parts = varLower.split('.');
        if (parts.some(p => p === term)) return true;
      }
      return false;
    });
  }, [selectedVar, allEvents]);

  // Apply type filter
  const filteredResults = useMemo(() => {
    if (filterType === 'all') return traceResults;
    return traceResults.filter(e => e.type === filterType);
  }, [traceResults, filterType]);

  // Value change detection
  const valueChanges = useMemo(() => {
    const changes = [];
    let lastValue = null;
    for (const event of traceResults) {
      if ((event.type === 'fetch' || event.type === 'store' || event.type === 'assign') && event.value !== undefined) {
        if (lastValue !== null && event.value !== lastValue) {
          changes.push({
            lineNumber: event.lineNumber,
            from: lastValue,
            to: event.value,
            type: event.type,
            context: event.context
          });
        }
        lastValue = event.value;
      }
    }
    return changes;
  }, [traceResults]);

  const handleSearch = (term) => {
    setSearch(term);
    setSelectedVar(null);
    setFilterType('all');
  };

  const handleSelect = (varName) => {
    setSelectedVar(varName);
    setSearch(varName);
  };

  // Get unique event types in results for filter buttons
  const availableTypes = useMemo(() => {
    const types = new Set(traceResults.map(e => e.type));
    return Array.from(types);
  }, [traceResults]);

  if (!data || data.totalEvents === 0) {
    return <div className="empty-state">No variable data captured from this trace.</div>;
  }

  return (
    <div className="variable-tracer">
      {/* Search bar */}
      <div className="vt-search-bar">
        <div className="vt-search-input-wrap">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            className="vt-search-input"
            placeholder="Search variable or field name (e.g., &SAVE, PSOPTIONS.MULTIJOB, VENDOR_ID)..."
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && suggestions.length > 0) {
                handleSelect(suggestions[0]);
              }
            }}
          />
          {search && (
            <button className="vt-clear-btn" onClick={() => { setSearch(''); setSelectedVar(null); }}>
              &times;
            </button>
          )}
        </div>
        <div className="vt-stats">
          {data.uniqueVariables} variables tracked &middot; {data.totalEvents} events
        </div>
      </div>

      {/* Autocomplete suggestions */}
      {suggestions.length > 0 && !selectedVar && (
        <div className="vt-suggestions">
          {suggestions.map(v => (
            <button
              key={v}
              className="vt-suggestion-item"
              onClick={() => handleSelect(v)}
            >
              <code>{v}</code>
              <span className="vt-suggestion-count">
                {allEvents.filter(e => e.variable.toLowerCase().includes(v.toLowerCase())).length} events
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Results */}
      {selectedVar && (
        <>
          {/* Summary banner */}
          <div className="vt-result-summary">
            <div className="vt-result-var">
              <code>{selectedVar}</code>
              <span className="vt-result-count">{traceResults.length} trace events</span>
            </div>
            {valueChanges.length > 0 && (
              <div className="vt-value-changes-badge">
                {valueChanges.length} value change{valueChanges.length !== 1 ? 's' : ''}
              </div>
            )}
          </div>

          {/* Value change highlights */}
          {valueChanges.length > 0 && (
            <div className="vt-value-changes">
              <div className="vt-section-label">Value Changes</div>
              {valueChanges.map((ch, i) => (
                <div key={i} className="vt-change-item">
                  <span className="vt-change-arrow">
                    <code className="vt-from">{ch.from}</code>
                    <span>&rarr;</span>
                    <code className="vt-to">{ch.to}</code>
                  </span>
                  <span className="vt-change-meta">
                    Line {ch.lineNumber} &middot; {ch.context.program} &middot; {ch.context.event}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Type filter */}
          {availableTypes.length > 1 && (
            <div className="vt-filters">
              <button
                className={`vt-filter-btn ${filterType === 'all' ? 'active' : ''}`}
                onClick={() => setFilterType('all')}
              >
                All ({traceResults.length})
              </button>
              {availableTypes.map(t => (
                <button
                  key={t}
                  className={`vt-filter-btn ${filterType === t ? 'active' : ''} ${TYPE_COLORS[t] || ''}`}
                  onClick={() => setFilterType(t)}
                >
                  {TYPE_LABELS[t] || t} ({traceResults.filter(e => e.type === t).length})
                </button>
              ))}
            </div>
          )}

          {/* Timeline */}
          <div className="vt-timeline">
            {filteredResults.map((event, i) => (
              <div key={i} className={`vt-event ${TYPE_COLORS[event.type] || ''}`}>
                <div className="vt-event-line-col">
                  <span className="vt-line-num">{event.lineNumber}</span>
                </div>
                <div className="vt-event-dot-col">
                  <div className={`vt-dot ${TYPE_COLORS[event.type] || ''}`} />
                  {i < filteredResults.length - 1 && <div className="vt-connector" />}
                </div>
                <div className="vt-event-content">
                  <div className="vt-event-header">
                    <span className={`vt-type-badge ${TYPE_COLORS[event.type] || ''}`}>
                      {TYPE_LABELS[event.type] || event.type}
                    </span>
                    <span className="vt-event-var"><code>{event.variable}</code></span>
                    {event.value !== undefined && (
                      <span className="vt-event-value">
                        = <code>{event.value}</code>
                      </span>
                    )}
                  </div>
                  <div className="vt-event-meta">
                    {event.context.program && (
                      <span className="vt-event-program">{event.context.program}.{event.context.event}</span>
                    )}
                  </div>
                  {event.code && (
                    <div className="vt-event-code">
                      <code>{event.code}</code>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {filteredResults.length === 0 && (
            <div className="empty-state">No events match the current filter.</div>
          )}
        </>
      )}

      {/* No search yet — show popular variables */}
      {!selectedVar && !search && (
        <div className="vt-popular">
          <div className="vt-section-label">Most Active Variables</div>
          <div className="vt-popular-list">
            {getMostActive(allEvents).map(({ variable, count }) => (
              <button
                key={variable}
                className="vt-popular-item"
                onClick={() => handleSelect(variable)}
              >
                <code>{variable}</code>
                <span className="vt-popular-count">{count}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Get the top 20 most referenced variables.
 */
function getMostActive(events) {
  const counts = {};
  for (const e of events) {
    counts[e.variable] = (counts[e.variable] || 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([variable, count]) => ({ variable, count }));
}

export default VariableTracer;
