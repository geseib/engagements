import React from 'react';

/**
 * Catches render errors so one broken component does not blank the screen.
 *
 * This matters more than usual here: these pages are projected in front of a
 * room. A white screen mid-session is unrecoverable without the host knowing to
 * reload, and reloading is safe — game state lives in DynamoDB and is restored
 * from the server, so nothing is lost.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('💥 Unhandled render error:', error, info?.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div role="alert" className="error-boundary">
        <h1>Something went wrong</h1>
        <p>
          The page hit an unexpected error. Your game is saved — reloading will
          pick up exactly where you left off.
        </p>
        <button type="button" onClick={() => window.location.reload()}>
          Reload
        </button>
        <details>
          <summary>Technical details</summary>
          <pre>{String(error?.stack || error)}</pre>
        </details>
      </div>
    );
  }
}
