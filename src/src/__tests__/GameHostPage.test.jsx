import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import GameHostPage from '../GameHostPage';

// Mock WebSocketClient
jest.mock('../WebSocketClient', () => ({
  __esModule: true,
  default: {
    connect: jest.fn(),
    disconnect: jest.fn(),
    isConnected: jest.fn(() => false),
    sendMessage: jest.fn(),
    onMessage: jest.fn(),
    onConnectionChange: null,
  },
}));

describe('GameHostPage Component', () => {
  beforeEach(() => {
    // Reset fetch mock
    fetch.mockClear();
    
    // Mock successful API responses
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        players: [],
        questions: [],
        questionSets: [
          { id: 'set1', name: 'Test Set', description: 'Test Description' }
        ]
      }),
    });

    // Reset window.location
    window.location.pathname = '/';
    window.location.search = '';
  });

  test('renders welcome screen when no game ID in URL', async () => {
    render(<GameHostPage />);
    
    await waitFor(() => {
      expect(screen.getByText(/Welcome to Engagements/i)).toBeInTheDocument();
    });
  });

  test('shows new game dialog when create game button is clicked', async () => {
    render(<GameHostPage />);
    
    await waitFor(() => {
      const createButton = screen.getByText(/Create New Game/i);
      fireEvent.click(createButton);
    });

    await waitFor(() => {
      expect(screen.getByText(/Create Game/i)).toBeInTheDocument();
    });
  });

  test('handles game ID input correctly', async () => {
    render(<GameHostPage />);
    
    await waitFor(() => {
      const input = screen.getByPlaceholderText(/Enter Game ID/i);
      fireEvent.change(input, { target: { value: 'TEST123' } });
      expect(input.value).toBe('TEST123');
    });
  });

  test('displays players grid when players exist', async () => {
    // Mock API response with players
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        players: [
          { name: 'Player1', score: 10 },
          { name: 'Player2', score: 5 }
        ]
      }),
    });

    // Set game ID in URL to trigger game initialization
    window.location.search = '?gameId=TEST123';
    
    render(<GameHostPage />);
    
    await waitFor(() => {
      expect(screen.getByText('Player1')).toBeInTheDocument();
      expect(screen.getByText('Player2')).toBeInTheDocument();
    });
  });

  test('handles API errors gracefully', async () => {
    // Mock API error
    fetch.mockRejectedValueOnce(new Error('API Error'));
    
    render(<GameHostPage />);
    
    // Component should still render without crashing
    await waitFor(() => {
      expect(screen.getByText(/Welcome to Engagements/i)).toBeInTheDocument();
    });
  });
});
