/**
 * ChatPanel.jsx
 * Purpose: Post-analysis chat with streaming LLM responses and starter chips
 * Author: TraceLens
 */

import React, { useState, useRef, useEffect } from 'react';
import './ChatPanel.css';

const STARTER_QUESTIONS = [
  'Which SQL is slowest and how to fix it?',
  'Explain the errors found in this trace',
  'Are there any N+1 or loop patterns?',
  'Trace the value path of a key variable',
  'What PeopleCode events took the longest?'
];

/**
 * Simple inline markdown for chat messages.
 */
function ChatMarkdown({ text }) {
  if (!text) return null;
  const lines = text.split('\n');
  const elements = [];
  let inCode = false;
  let codeLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith('```')) {
      if (inCode) {
        elements.push(<pre key={`c${i}`} className="chat-code-block"><code>{codeLines.join('\n')}</code></pre>);
        codeLines = [];
        inCode = false;
      } else {
        inCode = true;
      }
      continue;
    }
    if (inCode) { codeLines.push(line); continue; }
    if (line.startsWith('## ')) {
      elements.push(<div key={i} className="chat-heading">{line.substring(3)}</div>);
    } else if (line.startsWith('### ')) {
      elements.push(<div key={i} className="chat-subheading">{line.substring(4)}</div>);
    } else if (line.match(/^\s*[-*]\s+/)) {
      elements.push(<div key={i} className="chat-bullet" dangerouslySetInnerHTML={{ __html: '&bull; ' + chatInline(line.replace(/^\s*[-*]\s+/, '')) }} />);
    } else if (line.match(/^\s*\d+[\.\)]\s+/)) {
      elements.push(<div key={i} className="chat-bullet" dangerouslySetInnerHTML={{ __html: chatInline(line) }} />);
    } else if (line.trim()) {
      elements.push(<div key={i} className="chat-line" dangerouslySetInnerHTML={{ __html: chatInline(line) }} />);
    }
  }
  if (inCode && codeLines.length) {
    elements.push(<pre key="cf" className="chat-code-block"><code>{codeLines.join('\n')}</code></pre>);
  }
  return <>{elements}</>;
}

function chatInline(t) {
  return t
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/`([^`]+)`/g, '<code class="chat-inline-code">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

function ChatPanel({ messages, onSend, streaming }) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || streaming) return;
    onSend(trimmed);
    setInput('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleChipClick = (question) => {
    if (streaming) return;
    onSend(question);
  };

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent-purple)" strokeWidth="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        Ask about this trace
      </div>

      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-starter">
            <p>Ask follow-up questions about the analysis:</p>
            <div className="starter-chips">
              {STARTER_QUESTIONS.map((q, i) => (
                <button
                  key={i}
                  className="starter-chip"
                  onClick={() => handleChipClick(q)}
                  disabled={streaming}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`chat-bubble ${msg.role}`}>
            <div className="chat-bubble-content">
              {msg.role === 'assistant' ? (
                <>
                  <ChatMarkdown text={msg.content} />
                  {streaming && i === messages.length - 1 && (
                    <span className="cursor">|</span>
                  )}
                </>
              ) : (
                msg.content
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-bar">
        <input
          ref={inputRef}
          type="text"
          className="chat-input"
          placeholder="Ask a question about the trace..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={streaming}
        />
        <button
          className="chat-send-btn"
          onClick={handleSend}
          disabled={!input.trim() || streaming}
        >
          {streaming ? '...' : 'Send'}
        </button>
      </div>
    </div>
  );
}

export default ChatPanel;
