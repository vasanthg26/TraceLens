/**
 * SlashCommandInput.jsx
 * Chat input with slash command dropdown autocomplete.
 * Typing "/" opens a dropdown of available commands.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import './SlashCommandInput.css';

const COMMANDS = [
  { cmd: '/error',    desc: 'Analyse errors and exceptions',          provider: 'groq' },
  { cmd: '/events',   desc: 'Summarise top event flow bottlenecks',   provider: 'groq' },
  { cmd: '/sql',      desc: 'Find slow or repeated SQL',              provider: 'groq' },
  { cmd: '/perf',     desc: 'Overall performance summary',            provider: 'groq' },
  { cmd: '/validate', desc: 'Validate field / record values',         provider: 'groq' },
  { cmd: '/trace',    desc: 'Deep-dive full trace flow',              provider: 'haiku' },
  { cmd: '/variable', desc: 'Track a variable through the trace',     provider: 'haiku' },
  { cmd: '/path',     desc: 'Explain code path for a component',      provider: 'haiku' },
  { cmd: '/why',      desc: 'Root-cause analysis (deep reasoning)',   provider: 'sonnet' },
  { cmd: '/compare',  desc: 'Compare two traces side-by-side',        provider: 'sonnet' },
];

const PROVIDER_BADGE = {
  haiku:  { label: 'Haiku',  className: 'slash-cmd__badge--haiku' },
  sonnet: { label: 'Sonnet', className: 'slash-cmd__badge--sonnet' },
};

/**
 * @param {object}   props
 * @param {string}   props.value           - controlled input value
 * @param {function} props.onChange         - (value: string) => void
 * @param {function} props.onSubmit         - (value: string) => void
 * @param {boolean}  props.disabled
 * @param {boolean}  props.hasAnthropicKey  - if false, show upgrade badge on haiku/sonnet commands
 * @param {string}   props.placeholder
 */
function SlashCommandInput({ value, onChange, onSubmit, disabled, hasAnthropicKey, placeholder }) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [filter, setFilter] = useState('');
  const inputRef = useRef(null);
  const dropdownRef = useRef(null);

  const filteredCommands = COMMANDS.filter(c =>
    !filter || c.cmd.startsWith(filter)
  );

  // Open dropdown when value starts with "/"
  useEffect(() => {
    if (value.startsWith('/') && !value.includes(' ')) {
      setFilter(value);
      setDropdownOpen(true);
      setSelectedIdx(0);
    } else {
      setDropdownOpen(false);
      setFilter('');
    }
  }, [value]);

  const selectCommand = useCallback((cmd) => {
    onChange(cmd + ' ');
    setDropdownOpen(false);
    inputRef.current?.focus();
  }, [onChange]);

  const handleKeyDown = (e) => {
    if (!dropdownOpen) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (value.trim()) onSubmit(value);
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIdx(i => Math.min(i + 1, filteredCommands.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIdx(i => Math.max(i - 1, 0));
        break;
      case 'Enter':
      case 'Tab':
        e.preventDefault();
        if (filteredCommands[selectedIdx]) {
          selectCommand(filteredCommands[selectedIdx].cmd);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setDropdownOpen(false);
        break;
      default:
        break;
    }
  };

  // Scroll selected item into view
  useEffect(() => {
    if (!dropdownOpen) return;
    const el = dropdownRef.current?.querySelector('.slash-cmd__item--selected');
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx, dropdownOpen]);

  return (
    <div className="slash-cmd__wrapper">
      {dropdownOpen && filteredCommands.length > 0 && (
        <div className="slash-cmd__dropdown" ref={dropdownRef}>
          {filteredCommands.map((c, i) => {
            const needsKey = !hasAnthropicKey && (c.provider === 'haiku' || c.provider === 'sonnet');
            const badge = PROVIDER_BADGE[c.provider];
            return (
              <div
                key={c.cmd}
                className={`slash-cmd__item ${i === selectedIdx ? 'slash-cmd__item--selected' : ''}`}
                onMouseDown={(e) => { e.preventDefault(); selectCommand(c.cmd); }}
                onMouseEnter={() => setSelectedIdx(i)}
              >
                <span className="slash-cmd__item-cmd">{c.cmd}</span>
                <span className="slash-cmd__item-desc">{c.desc}</span>
                <span className="slash-cmd__item-right">
                  {badge && (
                    <span className={`slash-cmd__badge ${badge.className}`}>
                      {badge.label}
                    </span>
                  )}
                  {needsKey && (
                    <span className="slash-cmd__badge slash-cmd__badge--upgrade" title="Requires Anthropic API key">
                      KEY
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
      <textarea
        ref={inputRef}
        className="slash-cmd__input"
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder={placeholder || 'Ask about this trace, or type / for commands…'}
        rows={1}
      />
    </div>
  );
}

export default SlashCommandInput;
