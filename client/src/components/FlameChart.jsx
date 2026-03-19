/**
 * FlameChart.jsx
 * Purpose: Pure CSS/JS horizontal bar chart of event durations with nesting
 * Author: TraceLens
 */

import React, { useState } from 'react';
import './FlameChart.css';
import { COLOR_MAP, EVENT_LEGEND, eventToLegendKey } from './eventConstants';

function FlameBar({ node, maxDuration, depth = 0, activeFilters }) {
  const [expanded, setExpanded] = useState(depth < 2);
  const [hovered, setHovered] = useState(false);

  const legendKey = eventToLegendKey(node.eventName);
  const isFiltered = activeFilters && !activeFilters.has(legendKey);

  const widthPercent = maxDuration > 0 ? Math.max(2, (node.duration / maxDuration) * 100) : 100;
  const bgColor = COLOR_MAP[node.color] || COLOR_MAP.grey;

  // Filter children
  const visibleChildren = node.children?.filter(child => {
    const childKey = eventToLegendKey(child.eventName);
    return !activeFilters || activeFilters.has(childKey);
  }) || [];

  if (isFiltered) return null;

  return (
    <div className="flame-node">
      <div
        className="flame-bar-row"
        style={{ paddingLeft: `${depth * 16}px` }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {visibleChildren.length > 0 && (
          <button
            className="flame-expand-btn"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? '\u25BC' : '\u25B6'}
          </button>
        )}
        <div
          className="flame-bar"
          style={{
            width: `${widthPercent}%`,
            backgroundColor: bgColor,
            opacity: hovered ? 1 : 0.85
          }}
        >
          <span className="flame-bar-label">{node.label}</span>
          <span className="flame-bar-duration">{node.duration}{node.unit || 'ms'}</span>
        </div>

        {hovered && (
          <div className="flame-tooltip">
            <div><strong>{node.label}</strong></div>
            <div>Duration: {node.duration}{node.unit || 'ms'}</div>
            {node.children?.length > 0 && (
              <div>Children: {node.children.length}</div>
            )}
          </div>
        )}
      </div>

      {expanded && visibleChildren.map((child, i) => (
        <FlameBar
          key={i}
          node={child}
          maxDuration={maxDuration}
          depth={depth + 1}
          activeFilters={activeFilters}
        />
      ))}
    </div>
  );
}

function FlameChart({ data, activeFilters, onFilterChange }) {
  if (!data || data.length === 0) {
    return <div className="empty-state">No event data available for flame chart.</div>;
  }

  const maxDuration = Math.max(...data.map(d => d.duration || 0), 1);
  const allKeys = Object.keys(EVENT_LEGEND);
  const isAllActive = !activeFilters || activeFilters.size === allKeys.length;

  const handleLegendClick = (key, e) => {
    if (!onFilterChange) return;
    if (e.shiftKey) {
      // Shift+click: toggle individual event type
      const next = new Set(activeFilters || allKeys);
      if (next.has(key)) {
        next.delete(key);
        if (next.size === 0) {
          // Don't allow empty — reset to all
          onFilterChange(null);
          return;
        }
      } else {
        next.add(key);
      }
      // If all are active again, clear filter
      if (next.size === allKeys.length) {
        onFilterChange(null);
      } else {
        onFilterChange(next);
      }
    } else {
      // Click: solo — show only this event type, or reset if already solo'd
      if (activeFilters && activeFilters.size === 1 && activeFilters.has(key)) {
        onFilterChange(null);
      } else {
        onFilterChange(new Set([key]));
      }
    }
  };

  // Filter top-level flame data
  const filteredData = activeFilters
    ? data.filter(node => activeFilters.has(eventToLegendKey(node.eventName)))
    : data;

  return (
    <div className="flame-chart">
      <div className="flame-legend">
        {Object.entries(EVENT_LEGEND).map(([label, color]) => {
          const isActive = !activeFilters || activeFilters.has(label);
          return (
            <div
              key={label}
              className={`flame-legend-item ${isActive ? '' : 'inactive'} ${onFilterChange ? 'clickable' : ''}`}
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
      <div className="flame-hint">Click to solo · Shift+click to toggle</div>

      <div className="flame-bars">
        {filteredData.map((node, i) => (
          <FlameBar key={i} node={node} maxDuration={maxDuration} activeFilters={activeFilters} />
        ))}
        {filteredData.length === 0 && (
          <div className="empty-state">No events match the selected filter.</div>
        )}
      </div>
    </div>
  );
}

export default FlameChart;
