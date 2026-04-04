/**
 * LLMStatus.jsx
 * Purpose: Navbar indicator — shows Groq (always on) + Anthropic status based on localStorage key.
 * No polling of external APIs; Anthropic status is inferred from whether the user has saved a key.
 */

import React, { useState, useEffect, useCallback } from 'react';
import './LLMStatus.css';

/**
 * @param {boolean} props.hasAnthropicKey - true if user has saved an Anthropic key
 */
function LLMStatus({ hasAnthropicKey }) {
  const [groqStatus, setGroqStatus] = useState('checking'); // 'online' | 'offline' | 'checking'
  const [showTooltip, setShowTooltip] = useState(false);
  const [groqModel, setGroqModel] = useState('');

  const checkGroq = useCallback(async () => {
    try {
      const res = await fetch('/api/llm/status');
      if (res.ok) {
        const data = await res.json();
        setGroqStatus(data.status === 'online' ? 'online' : 'offline');
        setGroqModel(data.model || '');
      } else {
        setGroqStatus('offline');
      }
    } catch {
      setGroqStatus('offline');
    }
  }, []);

  useEffect(() => {
    checkGroq();
    const interval = setInterval(checkGroq, 60000);
    return () => clearInterval(interval);
  }, [checkGroq]);

  const mode = hasAnthropicKey ? 'advanced' : 'basic';
  const dotClass = groqStatus === 'online' ? 'online'
    : groqStatus === 'offline' ? 'offline'
    : 'checking';

  return (
    <div
      className="llm-status"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <div className={`llm-dot ${dotClass}`} />
      <span className="llm-label">
        {hasAnthropicKey ? 'Anthropic' : 'Groq'}
      </span>
      {hasAnthropicKey && (
        <span className="llm-mode-badge">PRO</span>
      )}

      {showTooltip && (
        <div className="llm-tooltip">
          <div className="llm-tooltip-section">FREE TIER</div>
          <div className="llm-tooltip-row">
            <span>Provider</span>
            <span>Groq</span>
          </div>
          {groqModel && (
            <div className="llm-tooltip-row">
              <span>Model</span>
              <span>{groqModel}</span>
            </div>
          )}
          <div className="llm-tooltip-row">
            <span>Status</span>
            <span className={`status-text ${dotClass}`}>{groqStatus}</span>
          </div>

          <div className="llm-tooltip-section" style={{ marginTop: 8 }}>ANTHROPIC</div>
          <div className="llm-tooltip-row">
            <span>Key</span>
            <span className={hasAnthropicKey ? 'status-text online' : 'status-text offline'}>
              {hasAnthropicKey ? 'connected' : 'not set'}
            </span>
          </div>
          {hasAnthropicKey && (
            <>
              <div className="llm-tooltip-row">
                <span>Haiku</span>
                <span className="status-text online">available</span>
              </div>
              <div className="llm-tooltip-row">
                <span>Sonnet</span>
                <span className="status-text online">available</span>
              </div>
            </>
          )}
          {!hasAnthropicKey && (
            <div className="llm-tooltip-hint">
              Add key in settings for deeper analysis
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default LLMStatus;
