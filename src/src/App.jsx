import React from 'react';
import GameHostPage from './GameHostPage';
import PlayerPage from './PlayerPage';
import AdminPage from './AdminPage';
import BuilderPage from './BuilderPage';
import HostRemote from './HostRemote';

function App() {
  // Simple routing based on URL path
  const path = window.location.pathname;

  if (path.startsWith('/play')) {
    return <PlayerPage />;
  }

  if (path.startsWith('/admin')) {
    return <AdminPage />;
  }

  if (path.startsWith('/builder')) {
    return <BuilderPage />;
  }

  if (path.startsWith('/remote')) {
    return <HostRemote />;
  }

  return <GameHostPage />;
}

export default App;