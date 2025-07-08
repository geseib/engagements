import React from 'react';
import { render, screen } from '@testing-library/react';
import App from '../App';

// Mock the page components
jest.mock('../GameHostPage', () => {
  return function MockGameHostPage() {
    return <div data-testid="game-host-page">Game Host Page</div>;
  };
});

jest.mock('../PlayerPage', () => {
  return function MockPlayerPage() {
    return <div data-testid="player-page">Player Page</div>;
  };
});

jest.mock('../AdminPage', () => {
  return function MockAdminPage() {
    return <div data-testid="admin-page">Admin Page</div>;
  };
});

describe('App Component', () => {
  beforeEach(() => {
    // Reset window.location before each test
    window.location.pathname = '/';
  });

  test('renders GameHostPage by default', () => {
    render(<App />);
    expect(screen.getByTestId('game-host-page')).toBeInTheDocument();
  });

  test('renders PlayerPage when path starts with /play', () => {
    window.location.pathname = '/play/123';
    render(<App />);
    expect(screen.getByTestId('player-page')).toBeInTheDocument();
  });

  test('renders AdminPage when path starts with /admin', () => {
    window.location.pathname = '/admin';
    render(<App />);
    expect(screen.getByTestId('admin-page')).toBeInTheDocument();
  });

  test('renders GameHostPage for unknown paths', () => {
    window.location.pathname = '/unknown';
    render(<App />);
    expect(screen.getByTestId('game-host-page')).toBeInTheDocument();
  });
});
