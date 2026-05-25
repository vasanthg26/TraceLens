/**
 * App.jsx
 * Purpose: Root component — WebSocket connection, state management, view routing
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';
import FileUpload from './components/FileUpload';
import ProgressBar from './components/ProgressBar';
import LLMStatus from './components/LLMStatus';
import SettingsPanel, { ANTHROPIC_KEY_STORAGE } from './components/SettingsPanel';
import ResultsTabs from './components/ResultsTabs';
import HistoryPanel from './components/HistoryPanel';

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
    summary: null, sql: null, loops: null, events: null, errors: null
  });

  // LLM state (retained for FixPreview compatibility)
  const [llmAnalysis, setLlmAnalysis] = useState(null);
  const [llmError, setLlmError] = useState(null);

  // Auto-analysis state (new in V2)
  const [autoAnalysisStatus, setAutoAnalysisStatus] = useState(null); // null | 'loading' | 'done'
  const [autoAnalysisContent, setAutoAnalysisContent] = useState('');
  const [autoAnalysisUpgrade, setAutoAnalysisUpgrade] = useState(false);
  const autoTokensRef = useRef('');

  // Chat state
  const [chatMessages, setChatMessages] = useState([]);
  const [chatStreaming, setChatStreaming] = useState(false);
  const chatTokensRef = useRef('');

  // Active tab (controlled here so App can switch to Ask on auto-analysis)
  const [activeTab, setActiveTab] = useState('errors');

  // Anthropic key (browser-only; never stored server-side)
  const [hasAnthropicKey, setHasAnthropicKey] = useState(
    () => Boolean(localStorage.getItem(ANTHROPIC_KEY_STORAGE))
  );

  // History state
  const [showHistory, setShowHistory] = useState(false);
  const [historyCount, setHistoryCount] = useState(0);

  // Component context metadata
  const [componentMetadata, setComponentMetadata] = useState(null);

  // Error state
  const [appError, setAppError] = useState(null);

  // Settings panel open state (lifted so UpgradeCard can trigger it)
  const [settingsOpen, setSettingsOpen] = useState(false);

  // ── Settings change handler ──
  const handleSettingsChange = useCallback((settings) => {
    setHasAnthropicKey(Boolean(settings?.anthropicApiKey));
  }, []);

  // Session token for associating WS connection with uploads
  const sessionTokenRef = useRef(null);

  // Reconnection backoff state
  const reconnectAttemptRef = useRef(0);
  const MAX_RECONNECT_ATTEMPTS = 10;
  const BASE_RECONNECT_DELAY = 1000; // 1 second
  const MAX_RECONNECT_DELAY = 30000; // 30 seconds

  // ── WebSocket connection ──
  const connectWs = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = import.meta.env.DEV
      ? window.location.hostname + ':3000'
      : window.location.host;
    const tokenParam = sessionTokenRef.current ? `?token=${sessionTokenRef.current}` : '';
    const wsUrl = `${protocol}//${host}${tokenParam}`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      setWsConnected(true);
      reconnectAttemptRef.current = 0; // Reset backoff on successful connection
    };

    ws.onclose = () => {
      setWsConnected(false);
      // Exponential backoff with jitter, capped at MAX_RECONNECT_DELAY
      if (reconnectAttemptRef.current < MAX_RECONNECT_ATTEMPTS) {
        const attempt = reconnectAttemptRef.current++;
        const delay = Math.min(
          BASE_RECONNECT_DELAY * Math.pow(2, attempt) + Math.random() * 1000,
          MAX_RECONNECT_DELAY
        );
        setTimeout(connectWs, delay);
      }
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
      case 'session':
        sessionTokenRef.current = msg.token;
        break;

      case 'status':
        if (msg.status === 'parsing') setView('progress');
        // Show results immediately after parsing completes — don't block on LLM
        if (msg.status === 'analyzing') {
          setView('results');
          setActiveTab('errors');
        }
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

      case 'metadata':
        setComponentMetadata(msg.data);
        break;

      // ── Auto-analysis (new V2 messages) ──
      case 'auto-analysis-start':
        autoTokensRef.current = '';
        setAutoAnalysisContent('');
        setAutoAnalysisStatus('loading');
        // Switch to Ask tab so user sees the analysis arriving
        setActiveTab('ask');
        break;

      case 'auto-analysis-token':
        autoTokensRef.current += msg.token;
        setAutoAnalysisContent(autoTokensRef.current);
        break;

      case 'auto-analysis-done':
        setAutoAnalysisStatus('done');
        setAutoAnalysisUpgrade(Boolean(msg.upgradePrompt));
        if (msg.text) {
          setAutoAnalysisContent(msg.text);
          autoTokensRef.current = '';
          // Also populate llmAnalysis for FixPreview/health badge
          if (msg.analysis) setLlmAnalysis(msg.analysis);
        }
        break;

      // Legacy LLM messages (kept for backwards compat with older server versions)
      case 'llm-token':
        autoTokensRef.current += msg.token;
        setAutoAnalysisContent(autoTokensRef.current);
        if (autoAnalysisStatus !== 'loading') {
          setAutoAnalysisStatus('loading');
          setActiveTab('ask');
        }
        break;

      case 'llm-done':
        setLlmAnalysis(msg.analysis);
        setAutoAnalysisStatus('done');
        setAutoAnalysisUpgrade(false);
        setView('results');
        break;

      case 'llm-error':
        setLlmError(msg.message);
        setView('results');
        break;

      // ── Chat messages ──
      case 'chat-token':
        chatTokensRef.current += msg.token;
        const tokenSnapshot = chatTokensRef.current;
        setChatMessages(prev => {
          const updated = [...prev];
          if (updated.length > 0 && updated[updated.length - 1].role === 'assistant') {
            updated[updated.length - 1] = { role: 'assistant', content: tokenSnapshot };
          } else {
            updated.push({ role: 'assistant', content: tokenSnapshot });
          }
          return updated;
        });
        break;

      case 'chat-done':
        setChatStreaming(false);
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

      case 'key-required':
        setChatStreaming(false);
        chatTokensRef.current = '';
        setChatMessages(prev => [...prev, { role: 'upgrade' }]);
        break;

      case 'history-saved':
        setHistoryCount(prev => prev + 1);
        break;

      case 'error':
        setAppError(msg.message);
        break;

      default:
        break;
    }
  }, [autoAnalysisStatus]);

  // ── Upload handler ──
  const handleUpload = useCallback(async (file) => {
    setAppError(null);
    setLlmAnalysis(null);
    setLlmError(null);
    setAutoAnalysisStatus(null);
    setAutoAnalysisContent('');
    setAutoAnalysisUpgrade(false);
    autoTokensRef.current = '';
    setResults({ summary: null, sql: null, loops: null, events: null, errors: null });
    setComponentMetadata(null);
    setChatMessages([]);
    setProgress({ percent: 0, linesProcessed: 0, phase: 'Uploading file...' });
    setView('progress');

    const formData = new FormData();
    formData.append('traceFile', file);

    const headers = {};
    const anthropicKey = localStorage.getItem(ANTHROPIC_KEY_STORAGE);
    if (anthropicKey) {
      headers['X-User-Api-Key'] = anthropicKey;
    }
    // Associate upload with our WS session
    if (sessionTokenRef.current) {
      headers['X-Session-Token'] = sessionTokenRef.current;
    }

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        headers,
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
  }, []);

  // ── Chat send handler ──
  const handleChatSend = useCallback((question) => {
    if (!wsRef.current || wsRef.current.readyState !== 1) return;

    setChatStreaming(true);
    chatTokensRef.current = '';

    setChatMessages(prev => [...prev, { role: 'user', content: question }]);

    const history = chatMessages
      .filter(m => m.content && !m.content.startsWith('Error:'))
      .map(m => ({ role: m.role, content: m.content }));

    const anthropicKey = localStorage.getItem(ANTHROPIC_KEY_STORAGE);

    wsRef.current.send(JSON.stringify({
      type: 'chat',
      question,
      history,
      ...(anthropicKey ? { userApiKey: anthropicKey } : {})
    }));
  }, [chatMessages]);

  // ── Load a saved analysis from history ──
  const handleLoadHistory = useCallback((data) => {
    setShowHistory(false);
    setAppError(null);
    setAutoAnalysisStatus(null);
    setAutoAnalysisContent('');
    autoTokensRef.current = '';
    setChatMessages([]);
    setResults({
      summary: data.sections?.summary || null,
      sql: data.sections?.sql || null,
      loops: data.sections?.loops || null,
      events: data.sections?.events || null,
      errors: data.sections?.errors || null,
    });
    setLlmAnalysis({
      summary: data.summary || '',
      health: data.overallHealth || 'fair',
      topRecommendation: data.topRecommendation || '',
      fixes: []
    });
    // Show the saved analysis in the auto-analysis banner
    if (data.summary) {
      setAutoAnalysisContent(data.summary);
      setAutoAnalysisStatus('done');
      setAutoAnalysisUpgrade(false);
    }
    setLlmError(null);
    setActiveTab('ask');
    setView('results');
  }, []);

  // ── Reset handler ──
  const handleReset = useCallback(() => {
    setView('upload');
    setProgress({ percent: 0, linesProcessed: 0, phase: '' });
    setResults({ summary: null, sql: null, loops: null, events: null, errors: null });
    setComponentMetadata(null);
    setLlmAnalysis(null);
    setLlmError(null);
    setAutoAnalysisStatus(null);
    setAutoAnalysisContent('');
    setAutoAnalysisUpgrade(false);
    autoTokensRef.current = '';
    setChatMessages([]);
    setAppError(null);
    setActiveTab('errors');
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
          <LLMStatus hasAnthropicKey={hasAnthropicKey} />
          <button
            className="btn-history-nav"
            onClick={() => setShowHistory(true)}
            title="View analysis history"
          >
            History
            {historyCount > 0 && (
              <span className="history-count-badge">{historyCount}</span>
            )}
          </button>
          <SettingsPanel
            onSettingsChange={handleSettingsChange}
            isOpen={settingsOpen}
            onIsOpenChange={setSettingsOpen}
          />
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
          <div className="results-layout results-layout--full">
            <ResultsTabs
              results={results}
              llmAnalysis={llmAnalysis}
              llmError={llmError}
              onReset={handleReset}
              componentMetadata={componentMetadata}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              chatMessages={chatMessages}
              onChatSend={handleChatSend}
              chatStreaming={chatStreaming}
              autoAnalysisStatus={autoAnalysisStatus}
              autoAnalysisContent={autoAnalysisContent}
              autoAnalysisUpgrade={autoAnalysisUpgrade}
              hasAnthropicKey={hasAnthropicKey}
              onOpenSettings={() => setSettingsOpen(true)}
            />
          </div>
        )}
      </div>

      {/* ── History Panel Overlay ── */}
      {showHistory && (
        <HistoryPanel
          onLoad={handleLoadHistory}
          onClose={() => setShowHistory(false)}
        />
      )}
    </div>
  );
}

export default App;
