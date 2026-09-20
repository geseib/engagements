import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import QuestionSetEditor from '../components/QuestionSetEditor';
import { authFetch } from '../auth/authFetch';
import { setTopicChoices } from '../config/setTopics';

/**
 * FILING A SET FROM THE EDITOR — the shelf, the words, and the proposal.
 *
 * The harness is the one questionSetEditor.test.jsx uses: authFetch is a plain
 * module, so mocking it renders the whole editor without the auth provider.
 */
jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));

const SET = {
  id: 'eighties-trivia',
  name: '80s Trivia',
  engagementType: 'trivia',
  totalQuestions: 20,
  categoryCount: 2,
  activeVersion: 2,
  topic: 'music',
  tags: ['1980s'],
};

/** The same set as the forty on dev that predate the field: no topic at all. */
const UNFILED_SET = { ...SET, id: 'lessons-learned', name: 'Lessons Learned', topic: undefined, tags: undefined };

const VERSIONS = [
  { version: 2, createdAt: '2026-02-01T00:00:00Z', questionCount: 20, categoryCount: 2, isActive: true, pinnedByGames: [] },
];

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body),
});

function mockApi({ versions = VERSIONS, put = (_u, _o) => jsonResponse(200, { updated: {} }) } = {}) {
  authFetch.mockImplementation(async (url, options = {}) => {
    const method = (options.method || 'GET').toUpperCase();
    if (method === 'GET' && url.includes('/versions')) return jsonResponse(200, versions);
    if (method === 'PUT' && url.includes('edit-question-set')) return put(url, options);
    throw new Error(`Unhandled request: ${method} ${url}`);
  });
}

beforeEach(() => {
  window.API_BASE = 'https://api.test/';
  authFetch.mockReset();
});

const renderEditor = (questionSet = SET, props = {}) => render(
  <QuestionSetEditor
    questionSet={questionSet}
    onSaved={jest.fn()}
    onChanged={jest.fn()}
    onCancel={jest.fn()}
    {...props}
  />,
);

const save = () => fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
const picker = () => screen.getByLabelText(/topic/i);
const putBodies = () => authFetch.mock.calls
  .filter(([, o]) => (o?.method || '').toUpperCase() === 'PUT')
  .map(([, o]) => JSON.parse(o.body));

describe('the shelf is in the Details panel, beside the rest of the set’s prose', () => {
  it('opens on the shelf the set is already filed under', async () => {
    mockApi();
    renderEditor();
    await waitFor(() => expect(picker()).toHaveValue('music'));
  });

  it('opens Unfiled for a set that predates the field, and says so', async () => {
    mockApi();
    renderEditor(UNFILED_SET);
    await waitFor(() => expect(picker()).toHaveValue(''));
    expect(screen.getByTestId('edit-set-unfiled')).toBeInTheDocument();
  });
});

describe('a set cannot be saved onto no shelf', () => {
  it('refuses the save and names every shelf it could be', async () => {
    mockApi();
    renderEditor(UNFILED_SET);
    await waitFor(() => expect(picker()).toBeInTheDocument());

    save();

    // The whole answer to "what should I have said" is the list itself, which
    // is why the refusal carries it — the same sentence `upload-questions.js`
    // and `edit-question-set.js` answer with, so one voice says it everywhere.
    expect(await screen.findByText(new RegExp(`Give this set a topic. Choose one of: ${setTopicChoices()}`
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeInTheDocument();
  });

  it('sends nothing at all, so a refusal costs no round trip', async () => {
    // rejects: letting the PUT go and reporting the server's 400. The edit is
    // of a whole form; posting it and having it bounce would leave the person
    // unsure whether the OTHER fields they changed had landed.
    mockApi();
    renderEditor(UNFILED_SET);
    await waitFor(() => expect(picker()).toBeInTheDocument());

    save();

    await waitFor(() => expect(screen.getByText(/Give this set a topic/)).toBeInTheDocument());
    expect(putBodies()).toHaveLength(0);
  });

  it('saves as soon as a shelf is chosen, and says which one landed', async () => {
    mockApi({ put: () => jsonResponse(200, { updated: { topic: 'history' } }) });
    renderEditor(UNFILED_SET);
    await waitFor(() => expect(picker()).toBeInTheDocument());

    fireEvent.change(picker(), { target: { value: 'history' } });
    save();

    await waitFor(() => expect(putBodies()).toHaveLength(1));
    expect(putBodies()[0].topic).toBe('history');
    expect(await screen.findByText(/topic set to History/)).toBeInTheDocument();
  });
});

describe('an edit that does not touch the shelf leaves it alone', () => {
  it('omits the shelf from the body when only the title moved', async () => {
    // The ~40 legacy sets go on renaming — but a filed set must not re-send its
    // shelf on every save either, or "what changed" stops meaning anything.
    mockApi();
    renderEditor();
    await waitFor(() => expect(picker()).toHaveValue('music'));

    fireEvent.change(screen.getByLabelText(/^title/i), { target: { value: '80s Trivia II' } });
    save();

    await waitFor(() => expect(putBodies()).toHaveLength(1));
    expect('topic' in putBodies()[0]).toBe(false);
    expect(putBodies()[0].name).toBe('80s Trivia II');
  });
});

describe('the set’s own tags ride along with the details save', () => {
  it('sends the whole list when one is added', async () => {
    mockApi();
    renderEditor();
    await waitFor(() => expect(picker()).toHaveValue('music'));

    fireEvent.change(screen.getByLabelText(/tags for this set/i), { target: { value: 'synth pop' } });
    fireEvent.click(screen.getByRole('button', { name: /^add tag$/i }));
    save();

    await waitFor(() => expect(putBodies()).toHaveLength(1));
    expect(putBodies()[0].tags).toEqual(['1980s', 'synth-pop']);
  });

  it('sends an empty list when the last one is removed', async () => {
    mockApi();
    renderEditor();
    await waitFor(() => expect(picker()).toHaveValue('music'));

    fireEvent.click(screen.getByRole('button', { name: /remove 1980s/i }));
    save();

    await waitFor(() => expect(putBodies()).toHaveLength(1));
    expect(putBodies()[0].tags).toEqual([]);
  });

  it('never carries a question’s tags into the set’s list', async () => {
    // Two different fields that share a word. Nothing on this screen reads the
    // question rows, and this is the guard on that staying true.
    mockApi();
    renderEditor({ ...SET, questions: [{ id: 'q1', tags: ['ai-drafted'] }] });
    await waitFor(() => expect(picker()).toHaveValue('music'));
    expect(screen.queryByText('ai-drafted')).not.toBeInTheDocument();
  });
});

describe('the proposal the check recorded', () => {
  const suggested = (over = {}) => ([{
    ...VERSIONS[0],
    reviewTopicSuggestion: {
      topic: 'science-technology', tags: [], filedAs: '', mismatch: false, ...over,
    },
  }]);

  it('is offered in the editor, one click from filed', async () => {
    mockApi({ versions: suggested() });
    renderEditor(UNFILED_SET);

    const accept = await screen.findByRole('button', { name: /file it under science & technology/i });
    fireEvent.click(accept);
    expect(picker()).toHaveValue('science-technology');
  });

  it('is not invented for a version the check never proposed for', async () => {
    mockApi();
    renderEditor(UNFILED_SET);
    await waitFor(() => expect(picker()).toBeInTheDocument());
    expect(screen.queryByTestId('edit-set-suggestion')).not.toBeInTheDocument();
  });

  it('says a clear contradiction once, and the save still goes through', async () => {
    mockApi({ versions: suggested({ filedAs: 'music', mismatch: true }) });
    renderEditor();

    expect(await screen.findByTestId('edit-set-mismatch')).toBeInTheDocument();
    expect(screen.getAllByTestId('edit-set-mismatch')).toHaveLength(1);
    // ...and not ALSO as the plain offer, which names the same shelf: the two
    // are mutually exclusive by construction (SetTopicField.jsx).
    expect(screen.queryByTestId('edit-set-suggestion')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^title/i), { target: { value: '80s Trivia II' } });
    save();

    // Blocks nothing: the person may simply be right about their own set.
    await waitFor(() => expect(putBodies()).toHaveLength(1));
  });
});
