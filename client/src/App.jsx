/**
 * App.jsx
 * Purpose: Root component — WebSocket connection, state management, view routing
 * Author: TraceLens
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';
import FileUpload from './components/FileUpload';
import ProgressBar from './components/ProgressBar';
import LLMStatus from './components/LLMStatus';
import SettingsPanel, { STORAGE_KEY } from './components/SettingsPanel';
import ResultsTabs from './components/ResultsTabs';
import ChatPanel from './components/ChatPanel';

function App() {
  // Connection state
  const [wsConnected, setWsConnected] = useState(false);
  const wsRef = useRef(null);

  // View state
  const [view, setView] = useState('upload'); // 'upload' | 'progress' | 'results'

  // Progress state
  const [progress, setProgress] = useState({ percent: 0, linesProcessed: 0, phase: '' });

  // Results state
  const [results, setResults] = useState({
    summary: null,
    sql: null,
    loops: null,
    events: null,
    errors: null
  });

  // LLM state
  const [llmTokens, setLlmTokens] = useState('');
  const [llmAnalysis, setLlmAnalysis] = useState(null);
  const [llmError, setLlmError] = useState(null);

  // Chat state
  const [chatMessages, setChatMessages] = useState([]);
  const [chatStreaming, setChatStreaming] = useState(false);
  const chatTokensRef = useRef('');

  // LLM settings from UI (overrides .env when set)
  const [llmSettings, setLlmSettings] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  // Error state
  const [appError, setAppError] = useState(null);

  // ── WebSocket connection ──
  const connectWs = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // In dev mode (Vite on 5173), connect directly to backend on 3000
    const host = window.location.port === '5173'
      ? window.location.hostname + ':3000'
      : window.location.host;
    const wsUrl = `${protocol}//${host}`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      setWsConnected(true);
      console.log('[WS] Connected');
    };

    ws.onclose = () => {
      setWsConnected(false);
      console.log('[WS] Disconnected — reconnecting in 3s...');
      setTimeout(connectWs, 3000);
    };

    ws.onerror = () => {
      setWsConnected(false);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleWsMessage(msg);
      } catch (err) {
        console.error('[WS] Parse error:', err);
      }
    };

    wsRef.current = ws;
  }, []);

  useEffect(() => {
    connectWs();
    return () => {
      if (wsRef.current) wsRef.current.close();
    };
  }, [connectWs]);

  // ── WebSocket message handler ──
  const handleWsMessage = useCallback((msg) => {
    switch (msg.type) {
      case 'status':
        if (msg.status === 'parsing') setView('progress');
        break;

      case 'progress':
        setProgress({
          percent: msg.percent,
          linesProcessed: msg.linesProcessed,
          phase: msg.phase
        });
        break;

      case 'partial':
        setResults(prev => ({ ...prev, [msg.section]: msg.data }));
        break;

      case 'llm-token':
        setLlmTokens(prev => prev + msg.token);
        break;

      case 'llm-done':
        setLlmAnalysis(msg.analysis);
        setView('results');
        break;

      case 'llm-error':
        setLlmError(msg.message);
        // Still show results even if LLM fails
        setView('results');
        break;

      case 'chat-token':
        chatTokensRef.current += msg.token;
        // Snapshot the accumulated text so React batching can't read a stale ref
        const tokenSnapshot = chatTokensRef.current;
        setChatMessages(prev => {
          const updated = [...prev];
          if (updated.length > 0 && updated[updated.length - 1].role === 'assistant') {
            updated[updated.length - 1] = {
              role: 'assistant',
              content: tokenSnapshot
            };
          } else {
            updated.push({ role: 'assistant', content: tokenSnapshot });
          }
          return updated;
        });
        break;

      case 'chat-done':
        setChatStreaming(false);
        // Finalize the message with the complete text before clearing the ref
        if (msg.text) {
          setChatMessages(prev => {
            const updated = [...prev];
            if (updated.length > 0 && updated[updated.length - 1].role === 'assistant') {
              updated[updated.length - 1] = { role: 'assistant', content: msg.text };
            }
            return updated;
          });
        }
        chatTokensRef.current = '';
        break;

      case 'chat-error':
        setChatStreaming(false);
        chatTokensRef.current = '';
        setChatMessages(prev => [...prev, {
          role: 'assistant',
          content: `Error: ${msg.message}`
        }]);
        break;

      case 'error':
        setAppError(msg.message);
        break;

      default:
        break;
    }
  }, []);

  // ── Upload handler ──
  const handleUpload = useCallback(async (file) => {
    setAppError(null);
    setLlmTokens('');
    setLlmAnalysis(null);
    setLlmError(null);
    setResults({ summary: null, sql: null, loops: null, events: null, errors: null, variables: null });
    setChatMessages([]);
    setProgress({ percent: 0, linesProcessed: 0, phase: 'Uploading file...' });
    setView('progress');

    const formData = new FormData();
    formData.append('traceFile', file);
    if (llmSettings?.apiUrl) formData.append('llmApiUrl', llmSettings.apiUrl);
    if (llmSettings?.apiKey) formData.append('llmApiKey', llmSettings.apiKey);

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Upload failed');
      }
    } catch (err) {
      setAppError(err.message);
      setView('upload');
    }
  }, [llmSettings]);

  // ── Chat send handler ──
  const handleChatSend = useCallback((question) => {
    if (!wsRef.current || wsRef.current.readyState !== 1) return;

    setChatStreaming(true);
    chatTokensRef.current = '';

    setChatMessages(prev => [...prev, { role: 'user', content: question }]);

    // Send chat history (without the streaming assistant messages)
    const history = chatMessages
      .filter(m => m.content && !m.content.startsWith('Error:'))
      .map(m => ({ role: m.role, content: m.content }));

    wsRef.current.send(JSON.stringify({
      type: 'chat',
      question,
      history,
      ...(llmSettings?.apiUrl && llmSettings?.apiKey ? {
        llmApiUrl: llmSettings.apiUrl,
        llmApiKey: llmSettings.apiKey
      } : {})
    }));
  }, [chatMessages, llmSettings]);

  // ── Reset handler ──
  const handleReset = useCallback(() => {
    setView('upload');
    setProgress({ percent: 0, linesProcessed: 0, phase: '' });
    setResults({ summary: null, sql: null, loops: null, events: null, errors: null, variables: null });
    setLlmTokens('');
    setLlmAnalysis(null);
    setLlmError(null);
    setChatMessages([]);
    setAppError(null);
  }, []);

  return (
    <div className="app">
      {/* ── Navbar ── */}
      <nav className="navbar">
        <div className="navbar-brand">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent-blue)" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <span>TraceLens</span>
        </div>
        <div className="navbar-right">
          <LLMStatus uiConfig={llmSettings} />
          <SettingsPanel onSettingsChange={setLlmSettings} />
          <div className="connection-status">
            <div className={`connection-dot ${wsConnected ? '' : 'disconnected'}`} />
            {wsConnected ? 'Connected' : 'Disconnected'}
          </div>
        </div>
      </nav>

      {/* ── Main Content ── */}
      <div className="main-content">
        {appError && (
          <div className="error-banner">
            {appError}
            <button onClick={() => setAppError(null)}>Dismiss</button>
          </div>
        )}

        {view === 'upload' && (
          <FileUpload onUpload={handleUpload} />
        )}

        {view === 'progress' && (
          <ProgressBar
            percent={progress.percent}
            linesProcessed={progress.linesProcessed}
            phase={progress.phase}
          />
        )}

        {view === 'results' && (
          <div className="results-layout">
            <ResultsTabs
              results={results}
              llmAnalysis={llmAnalysis}
              llmTokens={llmTokens}
              llmError={llmError}
              onReset={handleReset}
            />
            <ChatPanel
              messages={chatMessages}
              onSend={handleChatSend}
              streaming={chatStreaming}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
