import React from 'react';
import { reportBug } from '../utils/bugReporter.js';

/**
 * Catches render-time crashes anywhere in the tree below it, reports them to
 * the Bug Finder log, and shows a recoverable fallback instead of a blank
 * white screen. Must be a class component — React only supports error
 * boundaries via getDerivedStateFromError/componentDidCatch, no hook exists.
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    reportBug({ message: error.message, stack: error.stack || info?.componentStack });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          minHeight: '100vh', padding: 24, textAlign: 'center', fontFamily: 'inherit',
        }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
          <h2 style={{ margin: '0 0 8px', color: '#1f2937' }}>Something went wrong</h2>
          <p style={{ color: '#6b7280', marginBottom: 20, maxWidth: 420 }}>
            This has been logged automatically. An admin can find the details under
            Settings → Bug Finder.
          </p>
          <button
            onClick={() => { this.setState({ hasError: false }); window.location.reload(); }}
            style={{ padding: '10px 24px', background: '#52b02c', color: 'white', border: 'none',
              borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}>
            🔄 Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
