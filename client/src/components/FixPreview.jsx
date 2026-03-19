/**
 * FixPreview.jsx
 * Purpose: Side-by-side before/after code blocks from LLM suggestions
 * Author: TraceLens
 */

import React, { useState } from 'react';
import './FixPreview.css';

function FixPreview({ fixes }) {
  const [copiedIdx, setCopiedIdx] = useState(null);

  const handleCopy = async (text, idx, side) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIdx(`${idx}-${side}`);
      setTimeout(() => setCopiedIdx(null), 2000);
    } catch {
      // Clipboard API may not be available
    }
  };

  const impactClass = (impact) => {
    const upper = (impact || '').toUpperCase();
    if (upper === 'HIGH') return 'high';
    if (upper === 'MEDIUM') return 'medium';
    return 'low';
  };

  if (!fixes || fixes.length === 0) {
    return <div className="empty-state">No fix previews available. AI analysis may still be processing.</div>;
  }

  return (
    <div className="fix-preview">
      {fixes.map((fix, i) => (
        <div key={i} className="fix-card">
          <div className="fix-card-header">
            <div className="fix-title">{fix.title}</div>
            <div className="fix-meta">
              <span className={`impact-badge ${impactClass(fix.impact)}`}>
                {fix.impact}
              </span>
              {fix.saving && (
                <span className="fix-saving">{fix.saving}</span>
              )}
            </div>
          </div>

          <div className="fix-code-compare">
            {/* BEFORE */}
            <div className="fix-code-block before">
              <div className="fix-code-header">
                <span>BEFORE</span>
                <button
                  className="copy-btn"
                  onClick={() => handleCopy(fix.before, i, 'before')}
                >
                  {copiedIdx === `${i}-before` ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <pre><code>{fix.before}</code></pre>
            </div>

            {/* AFTER */}
            <div className="fix-code-block after">
              <div className="fix-code-header">
                <span>AFTER</span>
                <button
                  className="copy-btn"
                  onClick={() => handleCopy(fix.after, i, 'after')}
                >
                  {copiedIdx === `${i}-after` ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <pre><code>{fix.after}</code></pre>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default FixPreview;
