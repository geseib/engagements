import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import PlayerPage from '../PlayerPage';

describe('PlayerPage Component', () => {
  beforeEach(() => {
    // Reset fetch mock
    fetch.mockClear();
    
    // Mock successful API responses
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        player: { name: 'TestPlayer', gameId: 'TEST123' }
      }),
    });

    // Reset window.location
    window.location.pathname = '/play';
    window.location.search = '';
  });

  test('renders join game form initially', () => {
    render(<PlayerPage />);
    
    expect(screen.getByText(/Join Engagements/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Game ID/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Your Name/i)).toBeInTheDocument();
    expect(screen.getByText(/Join Game/i)).toBeInTheDocument();
  });

  test('handles game ID input from URL', () => {
    window.location.search = '?gameId=TEST123';
    
    render(<PlayerPage />);
    
    const gameIdInput = screen.getByPlaceholderText(/Game ID/i);
    expect(gameIdInput.value).toBe('TEST123');
    expect(gameIdInput).toHaveAttribute('readOnly');
  });

  test('handles form input changes', () => {
    render(<PlayerPage />);
    
    const gameIdInput = screen.getByPlaceholderText(/Game ID/i);
    const nameInput = screen.getByPlaceholderText(/Your Name/i);
    
    fireEvent.change(gameIdInput, { target: { value: 'GAME456' } });
    fireEvent.change(nameInput, { target: { value: 'John Doe' } });
    
    expect(gameIdInput.value).toBe('GAME456');
    expect(nameInput.value).toBe('John Doe');
  });

  test('submits join game form', async () => {
    render(<PlayerPage />);
    
    const gameIdInput = screen.getByPlaceholderText(/Game ID/i);
    const nameInput = screen.getByPlaceholderText(/Your Name/i);
    const joinButton = screen.getByText(/Join Game/i);
    
    fireEvent.change(gameIdInput, { target: { value: 'TEST123' } });
    fireEvent.change(nameInput, { target: { value: 'TestPlayer' } });
    fireEvent.click(joinButton);
    
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/games/TEST123/join'),
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: expect.stringContaining('TestPlayer')
        })
      );
    });
  });

  test('displays waiting screen after joining', async () => {
    render(<PlayerPage />);
    
    const gameIdInput = screen.getByPlaceholderText(/Game ID/i);
    const nameInput = screen.getByPlaceholderText(/Your Name/i);
    const joinButton = screen.getByText(/Join Game/i);
    
    fireEvent.change(gameIdInput, { target: { value: 'TEST123' } });
    fireEvent.change(nameInput, { target: { value: 'TestPlayer' } });
    fireEvent.click(joinButton);
    
    await waitFor(() => {
      expect(screen.getByText(/Waiting for the game to start/i)).toBeInTheDocument();
    });
  });

  test('handles API errors during join', async () => {
    // Mock API error
    fetch.mockRejectedValueOnce(new Error('Join failed'));
    
    render(<PlayerPage />);
    
    const gameIdInput = screen.getByPlaceholderText(/Game ID/i);
    const nameInput = screen.getByPlaceholderText(/Your Name/i);
    const joinButton = screen.getByText(/Join Game/i);
    
    fireEvent.change(gameIdInput, { target: { value: 'TEST123' } });
    fireEvent.change(nameInput, { target: { value: 'TestPlayer' } });
    fireEvent.click(joinButton);
    
    // Should still show the join form (error handling)
    await waitFor(() => {
      expect(screen.getByText(/Join Engagements/i)).toBeInTheDocument();
    });
  });
});
