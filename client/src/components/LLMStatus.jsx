/**
 * LLMStatus.jsx
 * Purpose: Navbar indicator showing LLM provider status with polling
 * Author: TraceLens
 */

import React, { useState, useEffect, useCallback } from 'react';
import './LLMStatus.css';

/**
 * uiConfig: { apiUrl, apiKey } from SettingsPanel localStorage — when present, test those
 *           credentials instead of the server's .env config.
 */
function LLMStatus({ uiConfig }) {
  const [status, setStatus] = useState({
    provider: '',
    providerName: '',
    model: '',
    status: 'checking',
    latencyMs: 0
  });
  const [showTooltip, setShowTooltip] = useState(false);

  const checkStatus = useCallback(async () => {
    try {
      let res;
      if (uiConfig?.apiUrl && uiConfig?.apiKey) {
        res = await fetch('/api/llm/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiUrl: uiConfig.apiUrl, apiKey: uiConfig.apiKey })
        });
      } else {
        res = await fetch('/api/llm/status');
      }
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      } else {
        setStatus(prev => ({ ...prev, status: 'offline' }));
      }
    } catch {
      setStatus(prev => ({ ...prev, status: 'offline' }));
    }
  }, [uiConfig]);

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 30000);
    return () => clearInterval(interval);
  }, [checkStatus]);

  const dotClass = status.status === 'online' ? 'online'
    : status.status === 'offline' ? 'offline'
    : 'checking';

  return (
    <div
      className="llm-status"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <div className={`llm-dot ${dotClass}`} />
      <span className="llm-label">
        {status.providerName || status.provider || 'LLM'}
      </span>

      {showTooltip && (
        <div className="llm-tooltip">
          <div className="llm-tooltip-row">
            <span>Provider</span>
            <span>{status.providerName || status.provider}</span>
          </div>
          <div className="llm-tooltip-row">
            <span>Model</span>
            <span>{status.model}</span>
          </div>
          <div className="llm-tooltip-row">
            <span>Status</span>
            <span className={`status-text ${dotClass}`}>
              {status.status}
            </span>
          </div>
          <div className="llm-tooltip-row">
            <span>Source</span>
            <span className={uiConfig?.apiUrl ? 'source-ui' : 'source-env'}>
              {uiConfig?.apiUrl ? 'UI' : 'ENV'}
            </span>
          </div>
          {status.latencyMs > 0 && (
            <div className="llm-tooltip-row">
              <span>Latency</span>
              <span>{status.latencyMs}ms</span>
            </div>
          )}
          {status.error && (
            <div className="llm-tooltip-error">{status.error}</div>
          )}
        </div>
      )}
    </div>
  );
}

export default LLMStatus;
