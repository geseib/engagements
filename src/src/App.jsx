import React, { Suspense, lazy } from 'react';
import ErrorBoundary from './ErrorBoundary';

// Split per route. Participants (/play) are the large majority of traffic and
// only need PlayerPage; they previously downloaded the host and admin screens
// too, because all three were imported eagerly.
const GameHostPage = lazy(() => import('./GameHostPage'));
const PlayerPage = lazy(() => import('./PlayerPage'));
const AdminPage = lazy(() => import('./AdminPage'));

function pageFor(pathname) {
  if (pathname.startsWith('/play')) return <PlayerPage />;
  if (pathname.startsWith('/admin')) return <AdminPage />;
  return <GameHostPage />;
}

function App() {
  // Simple routing based on URL path
  const path = window.location.pathname;

  return (
    <ErrorBoundary>
      <Suspense fallback={<div className="app-loading">Loading…</div>}>
        {pageFor(path)}
      </Suspense>
    </ErrorBoundary>
  );
}

export default App;
