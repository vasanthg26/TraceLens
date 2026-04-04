/**
 * ChatPanel.jsx
 * Purpose: Post-analysis chat with streaming LLM responses, slash commands, and finding cards.
 */

import React, { useState, useRef, useEffect } from 'react';
import './ChatPanel.css';
import { FindingCard, PeopleCodeBlock } from './FindingCard';
import SlashCommandInput from './SlashCommandInput';
import UpgradeCard from './UpgradeCard';
import { parseResponse } from '../utils/responseParser';

const STARTER_QUESTIONS = [
  'Which SQL is slowest and how to fix it?',
  'Explain the errors found in this trace',
  'Are there any N+1 or loop patterns?',
  'Trace the value path of a key variable',
  'What PeopleCode events took the longest?'
];

/**
 * Renders a single assistant message using typed segments from responseParser.
 * Falls back to markdown rendering for older plain-text messages.
 */
function AssistantMessage({ content, streaming, isLast }) {
  const segments = parseResponse(content);

  // If no structured segments, fall back to simple markdown
  if (!segments.length || (segments.length === 1 && segments[0].type === 'narrative')) {
    return (
      <>
        <ChatMarkdown text={content} />
        {streaming && isLast && <span className="cursor">|</span>}
      </>
    );
  }

  return (
    <>
      {segments.map((seg, i) => {
        if (seg.type === 'finding') {
          return <FindingCard key={i} data={seg.data} severity={seg.severity} />;
        }
        if (seg.type === 'peoplecode') {
          return <PeopleCodeBlock key={i} code={seg.code} />;
        }
        // narrative
        return <ChatMarkdown key={i} text={seg.text} />;
      })}
      {streaming && isLast && <span className="cursor">|</span>}
    </>
  );
}

/**
 * Auto-analysis banner shown at the top of the Ask tab after upload.
 */
function AutoAnalysisBanner({ status, content, upgradePrompt }) {
  const [collapsed, setCollapsed] = useState(false);

  if (!status) return null;

  if (status === 'loading') {
    return (
      <div className="auto-analysis-banner auto-analysis-banner--loading">
        <div className="auto-analysis-banner__header">
          <span className="auto-analysis-banner__icon">⟳</span>
          <span className="auto-analysis-banner__title">Analysing trace…</span>
          <div className="auto-analysis-banner__dots">
            <span /><span /><span />
          </div>
        </div>
      </div>
    );
  }

  if (status === 'done' && content) {
    const segments = parseResponse(content);
    return (
      <div className={`auto-analysis-banner auto-analysis-banner--done ${collapsed ? 'collapsed' : ''}`}>
        <div className="auto-analysis-banner__header" onClick={() => setCollapsed(c => !c)}>
          <span className="auto-analysis-banner__icon">✦</span>
          <span className="auto-analysis-banner__title">Auto-Analysis</span>
          {upgradePrompt && (
            <span className="auto-analysis-banner__upgrade" title="Add Anthropic key for deeper analysis">
              FREE
            </span>
          )}
          <button className="auto-analysis-banner__toggle">
            {collapsed ? '▾' : '▴'}
          </button>
        </div>
        {!collapsed && (
          <div className="auto-analysis-banner__body">
            {segments.map((seg, i) => {
              if (seg.type === 'finding') {
                return <FindingCard key={i} data={seg.data} severity={seg.severity} />;
              }
              if (seg.type === 'peoplecode') {
                return <PeopleCodeBlock key={i} code={seg.code} />;
              }
              return <ChatMarkdown key={i} text={seg.text} />;
            })}
            {upgradePrompt && (
              <div className="auto-analysis-banner__upgrade-msg">
                Add your Anthropic API key in settings to get deeper analysis with Claude Sonnet.
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return null;
}

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

/**
 * @param {object}  props
 * @param {Array}   props.messages          - chat history
 * @param {function} props.onSend           - (text: string) => void
 * @param {boolean} props.streaming         - streaming in progress
 * @param {string}  props.autoAnalysisStatus - null | 'loading' | 'done'
 * @param {string}  props.autoAnalysisContent - text content when done
 * @param {boolean} props.autoAnalysisUpgrade - true if free-tier analysis
 * @param {boolean} props.hasAnthropicKey   - from localStorage
 */
function ChatPanel({ messages, onSend, streaming, autoAnalysisStatus, autoAnalysisContent, autoAnalysisUpgrade, hasAnthropicKey, onOpenSettings }) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, autoAnalysisStatus]);

  const handleSend = (text) => {
    const trimmed = (text || input).trim();
    if (!trimmed || streaming) return;
    onSend(trimmed);
    setInput('');
  };

  const handleChipClick = (question) => {
    if (streaming) return;
    onSend(question);
  };

  const showStarters = messages.length === 0 && !autoAnalysisStatus;

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent-purple)" strokeWidth="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        Ask about this trace
      </div>

      <div className="chat-messages">
        <AutoAnalysisBanner
          status={autoAnalysisStatus}
          content={autoAnalysisContent}
          upgradePrompt={autoAnalysisUpgrade}
        />

        {showStarters && (
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

        {messages.map((msg, i) => {
          if (msg.role === 'upgrade') {
            return <UpgradeCard key={i} onOpenSettings={onOpenSettings} />;
          }
          return (
            <div key={i} className={`chat-bubble ${msg.role}`}>
              <div className="chat-bubble-content">
                {msg.role === 'assistant' ? (
                  <AssistantMessage
                    content={msg.content}
                    streaming={streaming}
                    isLast={i === messages.length - 1}
                  />
                ) : (
                  msg.content
                )}
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-bar">
        <SlashCommandInput
          value={input}
          onChange={setInput}
          onSubmit={handleSend}
          disabled={streaming}
          hasAnthropicKey={hasAnthropicKey}
        />
        <button
          className="chat-send-btn"
          onClick={() => handleSend()}
          disabled={!input.trim() || streaming}
        >
          {streaming ? '…' : 'Send'}
        </button>
      </div>
    </div>
  );
}

export default ChatPanel;
