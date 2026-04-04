/**
 * UpgradeCard.jsx
 * Purpose: Inline chat card shown when user attempts a Haiku/Sonnet command without an Anthropic key.
 */

import React from 'react';
import './UpgradeCard.css';

/**
 * @param {function} props.onOpenSettings - opens the Settings panel
 */
function UpgradeCard({ onOpenSettings }) {
  return (
    <div className="upgrade-card">
      <div className="upgrade-card__header">
        <span className="upgrade-card__icon">🔑</span>
        <span className="upgrade-card__title">Unlock Deep Analysis</span>
      </div>
      <p className="upgrade-card__subtitle">
        This feature requires an Anthropic API key
      </p>
      <ul className="upgrade-card__bullets">
        <li>Free $5 credit to get started</li>
        <li>No credit card required</li>
        <li>Your key — your cost</li>
      </ul>
      <div className="upgrade-card__actions">
        <a
          className="upgrade-card__btn upgrade-card__btn--primary"
          href="https://console.anthropic.com"
          target="_blank"
          rel="noopener noreferrer"
        >
          Get Free API Key ↗
        </a>
        <button
          className="upgrade-card__btn upgrade-card__btn--secondary"
          onClick={onOpenSettings}
        >
          Add Key in Settings
        </button>
      </div>
    </div>
  );
}

export default UpgradeCard;
