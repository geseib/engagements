import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import QuestionSetEditor from '../components/QuestionSetEditor';
import { authFetch } from '../auth/authFetch';

/*
 * QuestionSetEditor talks to the API through authFetch, a plain module rather
 * than a hook, so the component renders without the auth provider once that one
 * module is mocked. Everything else worth asserting about the editor lives in
 * utils/questionSetEditing and is tested there directly.
 */
jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));

const SET = {
  id: 'lessons-learned',
  name: 'Lessons Learned',
  engagementType: 'call-and-answer',
  totalQuestions: 42,
  categoryCount: 5,
  activeVersion: 3
};

const VERSIONS = [
  { version: 1, createdAt: '2026-01-01T00:00:00Z', questionCount: 10, categoryCount: 2, sourceFile: 'a.csv', isActive: false, pinnedByGames: [] },
  { version: 2, createdAt: '2026-02-01T00:00:00Z', questionCount: 11, categoryCount: 3, sourceFile: 'b.csv', isActive: false, pinnedByGames: ['GAME-7', 'GAME-8'] },
  { version: 3, createdAt: '2026-03-01T00:00:00Z', questionCount: 42, categoryCount: 5, sourceFile: 'c.csv', isActive: true, pinnedByGames: [] }
];

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body)
});

/** Route the mock by URL + method so each test only declares what it changes. */
function mockApi(handlers = {}) {
  authFetch.mockImplementation(async (url, options = {}) => {
    const method = (options.method || 'GET').toUpperCase();
    for (const [match, handler] of Object.entries(handlers)) {
      const [wantMethod, pattern] = match.split(' ');
      if (method === wantMethod && url.includes(pattern)) return handler(url, options);
    }
    if (method === 'GET' && url.includes('/versions')) return jsonResponse(200, VERSIONS);
    throw new Error(`Unhandled request: ${method} ${url}`);
  });
}

beforeEach(() => {
  window.API_BASE = 'https://api.test/';
  authFetch.mockReset();
});

const renderEditor = (props = {}) =>
  render(<QuestionSetEditor questionSet={SET} onSaved={jest.fn()} onChanged={jest.fn()} onCancel={jest.fn()} {...props} />);

describe('version list', () => {
  it('lists every version newest first and marks the active one', async () => {
    mockApi();
    renderEditor();

    const active = await screen.findByTestId('version-3');
    expect(active).toHaveClass('active');
    expect(within(active).getByText('Active')).toBeInTheDocument();

    // Exactly one row is marked, and it is not the others.
    expect(screen.getByTestId('version-2')).not.toHaveClass('active');
    expect(screen.getByTestId('version-1')).not.toHaveClass('active');
    expect(screen.getAllByText('Active')).toHaveLength(1);

    const rows = document.querySelectorAll('.qs-version-row');
    expect([...rows].map((r) => r.getAttribute('data-testid')))
      .toEqual(['version-3', 'version-2', 'version-1']);
  });

  it('does not offer to promote the version that is already active', async () => {
    mockApi();
    renderEditor();

    const active = await screen.findByTestId('version-3');
    expect(within(active).getByRole('button', { name: /promote/i })).toBeDisabled();
    expect(within(screen.getByTestId('version-2')).getByRole('button', { name: /promote/i }))
      .toBeEnabled();
  });

  it('shows how many live engagements are pinned to a version', async () => {
    mockApi();
    renderEditor();

    const pinned = await screen.findByTestId('version-2');
    expect(within(pinned).getByText(/2 in play/i)).toBeInTheDocument();
  });

  it('says so plainly when a set has no version history', async () => {
    mockApi({ 'GET /versions': async () => jsonResponse(404, { error: 'not found' }) });
    renderEditor();

    expect(await screen.findByText(/No version history for this set yet/i)).toBeInTheDocument();
  });
});

describe('deleting a version', () => {
  it('explains a 409 on the active version instead of failing generically', async () => {
    mockApi({
      'DELETE /versions/3': async () => jsonResponse(409, { error: 'Cannot delete the active version', activeVersion: 3 })
    });
    renderEditor();

    const active = await screen.findByTestId('version-3');
    fireEvent.click(within(active).getByRole('button', { name: /delete/i }));

    const banner = await screen.findByText(/Promote another version first/i);
    expect(banner).toHaveTextContent('Version 3 is the active version (v3)');
    // Tone is passed explicitly, never sniffed out of the copy.
    expect(banner.closest('.status-message')).toHaveClass('error');
  });

  it('asks before deleting a version a live engagement is pinned to, and names the games', async () => {
    const deletes = [];
    mockApi({
      'DELETE /versions/2': async (url) => {
        deletes.push(url);
        return url.includes('confirm=true')
          ? jsonResponse(200, { deleted: true })
          : jsonResponse(200, { warning: 'Version 2 is in play', pinnedByGames: ['GAME-7', 'GAME-8'] });
      }
    });
    const onChanged = jest.fn();
    renderEditor({ onChanged });

    const pinned = await screen.findByTestId('version-2');
    fireEvent.click(within(pinned).getByRole('button', { name: /delete/i }));

    // The ids reach the screen: "some games are using this" is not enough
    // information to decide with.
    const confirmButton = await screen.findByRole('button', { name: /Delete it anyway/i });
    const modal = confirmButton.closest('.modal-content');
    expect(within(modal).getAllByText(/Version 2 is in play/i).length).toBeGreaterThan(0);
    expect(within(modal).getByText('GAME-7')).toBeInTheDocument();
    expect(within(modal).getByText('GAME-8')).toBeInTheDocument();

    // Nothing has been deleted yet — one call out, and it was the unconfirmed one.
    expect(deletes).toHaveLength(1);
    expect(deletes[0]).not.toContain('confirm=true');
    expect(onChanged).not.toHaveBeenCalled();

    fireEvent.click(confirmButton);

    await waitFor(() => expect(deletes).toHaveLength(2));
    expect(deletes[1]).toContain('confirm=true');
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('lets the owner back out of a pinned delete without calling the API again', async () => {
    const deletes = [];
    mockApi({
      'DELETE /versions/2': async (url) => {
        deletes.push(url);
        return jsonResponse(200, { warning: 'Version 2 is in play', pinnedByGames: ['GAME-7'] });
      }
    });
    renderEditor();

    const pinned = await screen.findByTestId('version-2');
    fireEvent.click(within(pinned).getByRole('button', { name: /delete/i }));
    await screen.findByRole('button', { name: /Delete it anyway/i });

    fireEvent.click(screen.getByRole('button', { name: /Keep version 2/i }));

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Delete it anyway/i })).not.toBeInTheDocument());
    expect(deletes).toHaveLength(1);
  });

  it('confirms a clean delete of an unpinned version without asking', async () => {
    mockApi({ 'DELETE /versions/1': async () => jsonResponse(200, { deleted: true }) });
    renderEditor();

    const row = await screen.findByTestId('version-1');
    fireEvent.click(within(row).getByRole('button', { name: /delete/i }));

    const banner = await screen.findByText('Version 1 deleted.');
    expect(banner.closest('.status-message')).toHaveClass('success');
    expect(screen.queryByRole('button', { name: /Delete it anyway/i })).not.toBeInTheDocument();
  });
});

describe('saving details', () => {
  it('sends a diff: an untouched field is omitted, a cleared field is sent as an empty string', async () => {
    let body = null;
    mockApi({
      'PUT /admin/edit-question-set/': async (url, options) => {
        body = JSON.parse(options.body);
        return jsonResponse(200, { updated: body });
      }
    });
    renderEditor({
      questionSet: { ...SET, description: 'Retro prompts', roundNoun: 'Lesson', promptId: 'retro-v2' }
    });

    await screen.findByTestId('version-3');

    // Clear one field, leave everything else alone.
    fireEvent.change(screen.getByLabelText(/Round Label/i), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));

    await waitFor(() => expect(body).not.toBeNull());
    expect(body.roundNoun).toBe('');
    expect('roundNoun' in body).toBe(true);
    expect('description' in body).toBe(false);
    expect('promptId' in body).toBe(false);
    expect(body.name).toBe('Lessons Learned');
  });
});
