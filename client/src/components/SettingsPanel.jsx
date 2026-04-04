/**
 * SettingsPanel.jsx
 * Purpose: Anthropic API key configuration — stored in localStorage, sent per-request.
 * The key never reaches the server permanently; it is forwarded to Anthropic per call.
 */

import React, { useState, useEffect, useCallback } from 'react';
import './SettingsPanel.css';

export const ANTHROPIC_KEY_STORAGE = 'anthropic_api_key';

/**
 * isOpen / onIsOpenChange allow App.jsx to open the panel programmatically
 * (e.g. from the UpgradeCard "Add Key in Settings" button).
 * When not provided the component manages its own open state.
 */
function SettingsPanel({ onSettingsChange, isOpen, onIsOpenChange }) {
  const [localOpen, setLocalOpen] = useState(false);
  const open    = isOpen !== undefined ? isOpen : localOpen;
  const setOpen = (val) => {
    if (onIsOpenChange) onIsOpenChange(val);
    else setLocalOpen(val);
  };
  const [apiKey, setApiKey]       = useState('');
  const [testStatus, setTestStatus] = useState(null); // null | 'testing' | 'ok' | 'error'
  const [testError, setTestError] = useState('');

  // Track whether a key is currently saved
  const [hasSavedKey, setHasSavedKey] = useState(() =>
    Boolean(localStorage.getItem(ANTHROPIC_KEY_STORAGE))
  );

  // Load key on open
  useEffect(() => {
    if (open) {
      setApiKey(localStorage.getItem(ANTHROPIC_KEY_STORAGE) || '');
      setTestStatus(null);
      setTestError('');
    }
  }, [open]);

  const handleSave = useCallback(() => {
    const trimmed = apiKey.trim();
    if (trimmed) {
      localStorage.setItem(ANTHROPIC_KEY_STORAGE, trimmed);
      setHasSavedKey(true);
      onSettingsChange({ anthropicApiKey: trimmed });
    } else {
      localStorage.removeItem(ANTHROPIC_KEY_STORAGE);
      setHasSavedKey(false);
      onSettingsChange(null);
    }
    setTestStatus(null);
    setOpen(false);
  }, [apiKey, onSettingsChange]);

  const handleClear = useCallback(() => {
    setApiKey('');
    setTestStatus(null);
    setTestError('');
    localStorage.removeItem(ANTHROPIC_KEY_STORAGE);
    setHasSavedKey(false);
    onSettingsChange(null);
    setOpen(false);
  }, [onSettingsChange]);

  const handleTest = useCallback(async () => {
    const trimmed = apiKey.trim();
    if (!trimmed) return;
    setTestStatus('testing');
    setTestError('');

    try {
      const res = await fetch('/api/llm/validate-anthropic', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Api-Key': trimmed,
        },
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (data.status === 'ok') {
        setTestStatus('ok');
      } else {
        setTestStatus('error');
        setTestError(data.error || 'Key validation failed');
      }
    } catch (err) {
      setTestStatus('error');
      setTestError(err.message);
    }
  }, [apiKey]);

  const handleClose = useCallback(() => {
    setTestStatus(null);
    setOpen(false);
  }, []);

  return (
    <>
      <button
        className={`settings-gear-btn ${hasSavedKey ? 'active' : ''}`}
        onClick={() => setOpen(true)}
        title="Anthropic API Key"
        aria-label="Open Anthropic key settings"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </button>

      {open && (
        <div
          className="settings-overlay"
          onClick={e => e.target === e.currentTarget && handleClose()}
        >
          <div className="settings-panel">
            <div className="settings-header">
              <span className="settings-title">ANTHROPIC API KEY</span>
              <button className="settings-close" onClick={handleClose}>✕</button>
            </div>

            <div className="settings-body">
              <div className="settings-note">
                Add your Anthropic API key to unlock Claude Haiku and Sonnet for deep trace analysis.
                The key is stored only in your browser and forwarded directly to Anthropic — it is never stored on this server.
              </div>

              <div className="settings-field">
                <label className="settings-label">ANTHROPIC API KEY</label>
                <input
                  className="settings-input"
                  type="password"
                  value={apiKey}
                  onChange={e => { setApiKey(e.target.value); setTestStatus(null); }}
                  placeholder="sk-ant-..."
                  spellCheck={false}
                  autoComplete="off"
                />
              </div>

              {testStatus && (
                <div className={`settings-test-result ${testStatus}`}>
                  {testStatus === 'testing' && '⟳  Validating key…'}
                  {testStatus === 'ok'      && '✓  Key is valid — Haiku and Sonnet are now available'}
                  {testStatus === 'error'   && `✗  ${testError || 'Validation failed'}`}
                </div>
              )}

              <div className="settings-tier-info">
                <div className="settings-tier-row">
                  <span className="settings-tier-badge settings-tier-badge--free">FREE</span>
                  <span className="settings-tier-label">Basic analysis via Groq (always on)</span>
                </div>
                <div className="settings-tier-row">
                  <span className="settings-tier-badge settings-tier-badge--haiku">HAIKU</span>
                  <span className="settings-tier-label">/trace, /variable, /path — requires key</span>
                </div>
                <div className="settings-tier-row">
                  <span className="settings-tier-badge settings-tier-badge--sonnet">SONNET</span>
                  <span className="settings-tier-label">Auto-analysis, /why, /compare — requires key</span>
                </div>
              </div>
            </div>

            <div className="settings-footer">
              <button
                className="settings-btn-action test"
                onClick={handleTest}
                disabled={!apiKey.trim() || testStatus === 'testing'}
              >
                VALIDATE KEY
              </button>
              <div className="settings-footer-right">
                <button className="settings-btn-action clear" onClick={handleClear}>
                  CLEAR
                </button>
                <button className="settings-btn-action save" onClick={handleSave}>
                  SAVE
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default SettingsPanel;
