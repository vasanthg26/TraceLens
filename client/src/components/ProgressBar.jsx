/**
 * ProgressBar.jsx
 * Purpose: Animated progress bar with phase label and line counter
 * Author: TraceLens
 */

import React, { useState, useEffect } from 'react';
import './ProgressBar.css';

function ProgressBar({ percent, linesProcessed, phase }) {
  const [elapsed, setElapsed] = useState(0);
  const [startTime] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [startTime]);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  const formatNumber = (num) => {
    return num.toLocaleString();
  };

  return (
    <div className="progress-container">
      <div className="progress-header">
        <svg className="progress-spinner" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent-blue)" strokeWidth="2">
          <circle cx="12" cy="12" r="10" strokeOpacity="0.2" />
          <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
        </svg>
        <h2>Analyzing Trace File</h2>
      </div>

      <div className="progress-bar-wrapper">
        <div className="progress-bar-track">
          <div
            className="progress-bar-fill"
            style={{ width: `${percent}%` }}
          />
        </div>
        <span className="progress-percent">{percent}%</span>
      </div>

      <div className="progress-details">
        <div className="progress-phase">{phase}</div>
        <div className="progress-stats">
          <span>{formatNumber(linesProcessed)} lines processed</span>
          <span className="progress-dot">·</span>
          <span>{formatTime(elapsed)} elapsed</span>
        </div>
      </div>
    </div>
  );
}

export default ProgressBar;
