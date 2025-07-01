import React from 'react';
import GameHostPage from './GameHostPage';
import PlayerPage from './PlayerPage';
import AdminPage from './AdminPage';

function App() {
  // Simple routing based on URL path
  const path = window.location.pathname;
  
  if (path.startsWith('/play')) {
    return <PlayerPage />;
  }
  
  if (path.startsWith('/admin')) {
    return <AdminPage />;
  }
  
  return <GameHostPage />;
}

export default App;