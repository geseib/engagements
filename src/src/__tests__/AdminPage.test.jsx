import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AdminPage from '../AdminPage';

describe('AdminPage Component', () => {
  beforeEach(() => {
    // Reset fetch mock
    fetch.mockClear();
    
    // Mock successful API responses
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        questionSets: [
          { id: 'set1', name: 'Test Set 1', description: 'Description 1' },
          { id: 'set2', name: 'Test Set 2', description: 'Description 2' }
        ]
      }),
    });
  });

  test('renders admin page with all sections', async () => {
    render(<AdminPage />);
    
    expect(screen.getByText(/Admin Panel/i)).toBeInTheDocument();
    expect(screen.getByText(/Download CSV Template/i)).toBeInTheDocument();
    expect(screen.getByText(/Upload Question Set/i)).toBeInTheDocument();
    expect(screen.getByText(/Current Question Sets/i)).toBeInTheDocument();
    expect(screen.getByText(/Game Management/i)).toBeInTheDocument();
  });

  test('displays download template button', () => {
    render(<AdminPage />);
    
    expect(screen.getByText(/Download Template CSV/i)).toBeInTheDocument();
  });

  test('handles file upload selection', () => {
    render(<AdminPage />);
    
    const fileInput = screen.getByLabelText(/Choose CSV File/i);
    const file = new File(['test content'], 'test.csv', { type: 'text/csv' });
    
    fireEvent.change(fileInput, { target: { files: [file] } });
    
    expect(screen.getByText(/test.csv/i)).toBeInTheDocument();
  });

  test('displays question sets when loaded', async () => {
    render(<AdminPage />);
    
    await waitFor(() => {
      expect(screen.getByText('Test Set 1')).toBeInTheDocument();
      expect(screen.getByText('Test Set 2')).toBeInTheDocument();
      expect(screen.getByText('Description 1')).toBeInTheDocument();
      expect(screen.getByText('Description 2')).toBeInTheDocument();
    });
  });

  test('handles upload form submission', async () => {
    render(<AdminPage />);
    
    const titleInput = screen.getByPlaceholderText(/Question Set Title/i);
    const descriptionInput = screen.getByPlaceholderText(/Brief description/i);
    const fileInput = screen.getByLabelText(/Choose CSV File/i);
    
    const file = new File(['test content'], 'test.csv', { type: 'text/csv' });
    
    fireEvent.change(titleInput, { target: { value: 'New Test Set' } });
    fireEvent.change(descriptionInput, { target: { value: 'New Description' } });
    fireEvent.change(fileInput, { target: { files: [file] } });
    
    const uploadButton = screen.getByText(/Upload Question Set/i);
    fireEvent.click(uploadButton);
    
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/admin/upload-questions'),
        expect.objectContaining({
          method: 'POST'
        })
      );
    });
  });

  test('handles delete game functionality', () => {
    render(<AdminPage />);
    
    const deleteInput = screen.getByPlaceholderText(/Game ID to delete/i);
    fireEvent.change(deleteInput, { target: { value: 'GAME123' } });
    
    expect(deleteInput.value).toBe('GAME123');
    
    const deleteButton = screen.getByText(/Delete Single Game/i);
    expect(deleteButton).toBeInTheDocument();
  });

  test('shows no question sets message when empty', async () => {
    // Mock empty response
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ questionSets: [] }),
    });
    
    render(<AdminPage />);
    
    await waitFor(() => {
      expect(screen.getByText(/No question sets found/i)).toBeInTheDocument();
    });
  });

  test('handles API errors gracefully', async () => {
    // Mock API error
    fetch.mockRejectedValueOnce(new Error('API Error'));
    
    render(<AdminPage />);
    
    // Component should still render without crashing
    await waitFor(() => {
      expect(screen.getByText(/Admin Panel/i)).toBeInTheDocument();
    });
  });
});
