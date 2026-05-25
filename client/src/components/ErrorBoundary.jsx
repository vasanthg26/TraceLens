/**
 * ErrorBoundary.jsx
 * Purpose: Catches unhandled React render errors and shows a recovery UI
 */

import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary]', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '60vh',
          padding: '2rem',
          textAlign: 'center',
          color: 'var(--text-primary, #e0e0e0)'
        }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none"
            stroke="var(--accent-red, #ff6b6b)" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
          <h2 style={{ margin: '1rem 0 0.5rem', fontSize: '1.25rem' }}>Something went wrong</h2>
          <p style={{ color: 'var(--text-muted, #888)', maxWidth: '400px', fontSize: '0.9rem' }}>
            {this.state.error?.message || 'An unexpected error occurred'}
          </p>
          <button
            onClick={this.handleReset}
            style={{
              marginTop: '1.5rem',
              padding: '0.5rem 1.5rem',
              background: 'var(--accent-blue, #4a9eff)',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '0.9rem'
            }}
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
