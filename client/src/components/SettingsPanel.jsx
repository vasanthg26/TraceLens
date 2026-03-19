/**
 * SettingsPanel.jsx
 * Purpose: UI panel for configuring LLM provider — overrides .env when set, stored in localStorage
 * Author: TraceLens
 */

import React, { useState, useEffect, useCallback } from 'react';
import './SettingsPanel.css';

export const STORAGE_KEY = 'tracelens_llm_settings';

const PROVIDER_MAP = [
  { match: 'groq.com',         name: 'Groq' },
  { match: 'openai.com',       name: 'OpenAI' },
  { match: 'openrouter.ai',    name: 'OpenRouter' },
  { match: 'localhost:11434',  name: 'Ollama' },
  { match: 'localhost:1234',   name: 'LM Studio' },
];

export function detectProviderName(url) {
  if (!url) return null;
  const found = PROVIDER_MAP.find(p => url.includes(p.match));
  return found ? found.name : 'Custom';
}

function SettingsPanel({ onSettingsChange }) {
  const [open, setOpen] = useState(false);
  const [apiUrl, setApiUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [testStatus, setTestStatus] = useState(null); // null | 'testing' | 'ok' | 'error'
  const [testError, setTestError] = useState('');

  // Load from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    try {
      const { apiUrl: url, apiKey: key } = JSON.parse(saved);
      if (url) setApiUrl(url);
      if (key) setApiKey(key);
    } catch {
      // ignore malformed storage
    }
  }, []);

  const detectedProvider = detectProviderName(apiUrl);
  const hasSettings = apiUrl.trim() && apiKey.trim();

  // Check if current saved settings match inputs (to show "active" state on gear icon)
  const [savedSettings, setSavedSettings] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  const handleSave = useCallback(() => {
    if (hasSettings) {
      const settings = { apiUrl: apiUrl.trim(), apiKey: apiKey.trim() };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      setSavedSettings(settings);
      onSettingsChange(settings);
    } else {
      localStorage.removeItem(STORAGE_KEY);
      setSavedSettings(null);
      onSettingsChange(null);
    }
    setTestStatus(null);
    setOpen(false);
  }, [apiUrl, apiKey, hasSettings, onSettingsChange]);

  const handleClear = useCallback(() => {
    setApiUrl('');
    setApiKey('');
    setTestStatus(null);
    setTestError('');
    localStorage.removeItem(STORAGE_KEY);
    setSavedSettings(null);
    onSettingsChange(null);
    setOpen(false);
  }, [onSettingsChange]);

  const handleTest = useCallback(async () => {
    if (!apiUrl.trim() || !apiKey.trim()) return;
    setTestStatus('testing');
    setTestError('');

    try {
      const res = await fetch('/api/llm/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiUrl: apiUrl.trim(), apiKey: apiKey.trim() })
      });
      const data = await res.json();
      if (data.status === 'online') {
        setTestStatus('ok');
      } else {
        setTestStatus('error');
        setTestError(data.error || 'Connection failed');
      }
    } catch (err) {
      setTestStatus('error');
      setTestError(err.message);
    }
  }, [apiUrl, apiKey]);

  const handleClose = useCallback(() => {
    setTestStatus(null);
    setOpen(false);
  }, []);

  return (
    <>
      <button
        className={`settings-gear-btn ${savedSettings ? 'active' : ''}`}
        onClick={() => setOpen(true)}
        title="LLM Settings"
        aria-label="Open LLM settings"
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
              <span className="settings-title">LLM SETTINGS</span>
              <button className="settings-close" onClick={handleClose}>✕</button>
            </div>

            <div className="settings-body">
              <div className="settings-note">
                Override the server&apos;s .env LLM config. Settings are saved in your browser and sent with each request. Leave blank to use server defaults.
              </div>

              <div className="settings-field">
                <label className="settings-label">API URL</label>
                <input
                  className="settings-input"
                  type="text"
                  value={apiUrl}
                  onChange={e => { setApiUrl(e.target.value); setTestStatus(null); }}
                  placeholder="https://api.groq.com/openai/v1"
                  spellCheck={false}
                  autoComplete="off"
                />
                {apiUrl.trim() && (
                  <span className="settings-provider-tag">{detectedProvider}</span>
                )}
              </div>

              <div className="settings-field">
                <label className="settings-label">API KEY</label>
                <input
                  className="settings-input"
                  type="password"
                  value={apiKey}
                  onChange={e => { setApiKey(e.target.value); setTestStatus(null); }}
                  placeholder="sk-..."
                  spellCheck={false}
                  autoComplete="off"
                />
              </div>

              {testStatus && (
                <div className={`settings-test-result ${testStatus}`}>
                  {testStatus === 'testing' && '⟳  Testing connection...'}
                  {testStatus === 'ok'      && '✓  Connection successful'}
                  {testStatus === 'error'   && `✗  ${testError || 'Connection failed'}`}
                </div>
              )}
            </div>

            <div className="settings-footer">
              <button
                className="settings-btn-action test"
                onClick={handleTest}
                disabled={!apiUrl.trim() || !apiKey.trim() || testStatus === 'testing'}
              >
                TEST CONNECTION
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
