/**
 * FindingCard.jsx
 * Purpose: Renders structured PS findings from LLM
 * Two visual layers:
 * 1. Finding card — monospace, dark, framed
 * 2. PeopleCode block — nested frame, syntax styled
 */

import React, { useState } from 'react';
import './FindingCard.css';

const SEVERITY_ICONS = {
  critical: '🔴',
  warning:  '⚠️',
  info:     '🔍',
  ok:       '✅'
};

/**
 * Renders a single structured PS finding.
 * @param {object} data - { title, component, record, field, event, level, evidence, suggestion }
 * @param {string} severity - 'critical' | 'warning' | 'info' | 'ok'
 */
function FindingCard({ data, severity = 'info' }) {
  const icon = SEVERITY_ICONS[severity] || SEVERITY_ICONS.info;

  return (
    <div className={`finding-card finding-card--${severity}`}>
      <div className="finding-card__header">
        <span className="finding-card__icon">{icon}</span>
        <span className="finding-card__title">{data.title}</span>
        <span className="finding-card__badge">{severity.toUpperCase()}</span>
      </div>

      <div className="finding-card__context">
        {data.component && <ContextRow label="Component" value={data.component} />}
        {data.record    && <ContextRow label="Record"    value={data.record} />}
        {data.field     && <ContextRow label="Field"     value={data.field} />}
        {data.event     && <ContextRow label="Event"     value={data.event} />}
        {data.level     && <ContextRow label="Level"     value={data.level} />}
      </div>

      {data.evidence && (
        <div className="finding-card__evidence">
          <span className="finding-card__label">Evidence</span>
          <p className="finding-card__text">{data.evidence}</p>
        </div>
      )}

      {data.suggestion && (
        <div className="finding-card__suggestion">
          <span className="finding-card__label">Suggestion</span>
          <p className="finding-card__text">{data.suggestion}</p>
        </div>
      )}
    </div>
  );
}

function ContextRow({ label, value }) {
  return (
    <div className="finding-card__context-row">
      <span className="finding-card__context-label">{label}</span>
      <span className="finding-card__context-value">{value}</span>
    </div>
  );
}

/**
 * Renders a PeopleCode block with copy button.
 */
function PeopleCodeBlock({ code }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="peoplecode-block">
      <div className="peoplecode-block__header">
        <span className="peoplecode-block__lang">PeopleCode</span>
        <button
          className={`peoplecode-block__copy ${copied ? 'copied' : ''}`}
          onClick={handleCopy}
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre className="peoplecode-block__code">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export { FindingCard, PeopleCodeBlock };
export default FindingCard;
