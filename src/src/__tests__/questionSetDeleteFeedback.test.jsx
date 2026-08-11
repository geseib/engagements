/**
 * DELETING A QUESTION SET — the outcome has to be visible.
 *
 * `questionSetDeleteStatus` was assigned in six places in AdminPage.jsx and
 * rendered in none of them, and confirmDeleteQuestionSet closed the dialog on
 * its first line, before the request was sent. A delete that failed therefore
 * looked exactly like one that succeeded: dialog gone, set still listed, reason
 * only in the console.
 *
 * Each test names the implementation change it rejects.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import AdminPage from '../AdminPage';
import { authFetch } from '../auth/authFetch';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));
jest.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    currentUser: { username: 'admin', attributes: { email: 'admin@example.com' } },
    signOut: jest.fn(),
    isAdmin: () => true,
  }),
}));

const SETS = [
  { id: 'greatesthits', name: 'Greatest Hits', description: 'A set', active: true, engagementType: 'call-and-answer', questionCount: 10, categoryCount: 2 },
];

const jsonResponse = (ok, body) => Promise.resolve({
  ok,
  status: ok ? 200 : 500,
  json: () => Promise.resolve(body),
});

/** Route every admin GET to something harmless; DELETE to `deleteResult`. */
function wireApi(deleteResult) {
  authFetch.mockImplementation((url, options = {}) => {
    if (options.method === 'DELETE') return deleteResult();
    if (String(url).includes('admin/question-sets')) return jsonResponse(true, { questionSets: SETS });
    return jsonResponse(true, {});
  });
}

/** Render, open the delete dialog for the one set, and return the dialog. */
async function openDeleteDialog() {
  render(<AdminPage />);
  const deleteButton = await screen.findByTitle('Delete this question set');
  fireEvent.click(deleteButton);
  return screen.findByText(/Confirm Question Set Deletion/i);
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('question set delete feedback', () => {
  // Rejects: restoring the unconditional setShowQuestionSetDeleteConfirm(false)
  // at the top of confirmDeleteQuestionSet.
  // Rejects: removing the StatusMessage from the dialog body.
  test('a failed delete keeps the dialog open and states the reason', async () => {
    wireApi(() => jsonResponse(false, { error: 'Set is in use by an active game' }));
    await openDeleteDialog();

    fireEvent.click(screen.getByRole('button', { name: /Yes, Delete Question Set/i }));

    await waitFor(() => {
      expect(screen.getByText(/Delete failed: Set is in use by an active game/i)).toBeInTheDocument();
    });
    // Still open — the operator can read the reason and retry.
    expect(screen.getByText(/Confirm Question Set Deletion/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Yes, Delete Question Set/i })).toBeInTheDocument();
  });

  // Rejects: a `catch` that swallows a thrown request without surfacing it —
  // the network-failure branch sets the same state as the !ok branch.
  test('a delete that throws is reported too', async () => {
    wireApi(() => Promise.reject(new Error('Network down')));
    await openDeleteDialog();

    fireEvent.click(screen.getByRole('button', { name: /Yes, Delete Question Set/i }));

    await waitFor(() => {
      expect(screen.getByText(/Delete failed: Network down/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Confirm Question Set Deletion/i)).toBeInTheDocument();
  });

  // Rejects: moving the close back out of the success branch (the dialog would
  // stay open on success), and removing the list-level StatusMessage (the
  // success text would be unmounted with the dialog and leave no evidence).
  test('a successful delete closes the dialog and confirms in the list', async () => {
    wireApi(() => jsonResponse(true, { message: 'Deleted question set "Greatest Hits"' }));
    await openDeleteDialog();

    fireEvent.click(screen.getByRole('button', { name: /Yes, Delete Question Set/i }));

    await waitFor(() => {
      expect(screen.queryByText(/Confirm Question Set Deletion/i)).not.toBeInTheDocument();
    });
    expect(screen.getByText(/Deleted question set "Greatest Hits"/i)).toBeInTheDocument();
  });

  // Rejects: dropping the `disabled={isDeletingQuestionSet}` guard, which would
  // let a double-click fire a second DELETE while the first is in flight.
  test('the confirm button is disabled while the delete is in flight', async () => {
    let release;
    wireApi(() => new Promise((resolve) => { release = () => resolve({ ok: true, json: () => Promise.resolve({ message: 'Deleted' }) }); }));
    await openDeleteDialog();

    const confirm = screen.getByRole('button', { name: /Yes, Delete Question Set/i });
    fireEvent.click(confirm);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Deleting/i })).toBeDisabled();
    });
    expect(screen.getByRole('button', { name: /Cancel/i })).toBeDisabled();

    release();
    await waitFor(() => {
      expect(screen.queryByText(/Confirm Question Set Deletion/i)).not.toBeInTheDocument();
    });
  });

  // Rejects: an error banner that renders without the error tone, i.e. failure
  // styled identically to success — the original complaint.
  test('the failure banner carries the error tone, not the success tone', async () => {
    wireApi(() => jsonResponse(false, { error: 'Nope' }));
    await openDeleteDialog();

    fireEvent.click(screen.getByRole('button', { name: /Yes, Delete Question Set/i }));

    const banner = await screen.findByText(/Delete failed: Nope/i);
    const container = banner.closest('.status-message');
    expect(container).not.toBeNull();
    expect(container.className).toContain('error');
    expect(container.className).not.toContain('success');
  });
});
