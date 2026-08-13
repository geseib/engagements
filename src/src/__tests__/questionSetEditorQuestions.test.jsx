import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import QuestionsPanel from '../components/QuestionsPanel';
import QuestionSetEditor from '../components/QuestionSetEditor';
import { authFetch } from '../auth/authFetch';

/*
 * QUESTION-LEVEL EDITING — the working copy, and the promise that it cannot be
 * lost by accident.
 *
 * Everything here drives the real component. `authFetch` is the only mock (a
 * plain module, not a hook, so the panel renders with no auth provider — the
 * same recipe questionSetEditor.test.jsx uses and the reason AdminPage.jsx
 * itself cannot be mounted in jsdom). The CSV the Save posts is parsed and
 * asserted, because the CSV IS the write: there is no per-question API and the
 * importer matches column names exactly.
 *
 * The serialiser's own contract — that its bytes equal what
 * download-question-set.js emits, and that a question survives the trip
 * field for field — is proved against the REAL lambda handlers in
 * tests/question-set-roundtrip.js. That belongs there, not here: jsdom cannot
 * run the importer, and a test that re-implements it would only prove itself.
 */
jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));

const SET = {
  id: 'lessons-learned',
  name: 'Lessons Learned',
  engagementType: 'call-and-answer',
  totalQuestions: 3,
  categoryCount: 2,
  activeVersion: 2,
  canManage: true,
};

/**
 * The set as `GET /question-sets/{setId}/questions` answers it.
 *
 * Deliberately in the order that endpoint really returns: it sorts on
 * `sortOrder`, which no writer has ever set, so every set comes back
 * alphabetical by title. The stored key is the set's real order.
 */
const QUESTIONS = {
  setId: SET.id,
  questions: [
    {
      id: 'c002#001', Category: 'Delivery', title: 'ARE WE SHIPPING', QuestionNumber: 1,
      questionDetail: 'Weekly, or when it is ready?', School: 'Business School',
      customInstructions: 'Answer from your own experience.', Tags: ['delivery'],
    },
    {
      id: 'c001#002', Category: 'Retro', title: 'WHAT WOULD YOU CHANGE', QuestionNumber: 2,
      questionDetail: 'One thing only.', School: 'Business School',
      customInstructions: 'Answer from your own experience.', Tags: ['retro'],
      RoundKind: 'improve',
    },
    {
      id: 'c001#001', Category: 'Retro', title: 'WHAT WENT WRONG', QuestionNumber: 1,
      questionDetail: 'Pick one incident.', School: 'Business School',
      customInstructions: 'Answer from your own experience.', Tags: ['retro', 'opening'],
    },
  ],
};

/** Another set to pull from, with two categories so a filter has something to do. */
const OTHER_QUESTIONS = {
  setId: 'premortems',
  questions: [
    {
      id: 'c001#001', Category: 'Transfer', title: 'THE PRE-MORTEM RULE', QuestionNumber: 1,
      questionDetail: 'The team writes the failure report first.', School: 'Business School',
      RoundKind: 'apply', SourceAttribution: 'Gary Klein', Tags: ['planning'],
    },
    {
      id: 'c002#001', Category: 'Verdict', title: 'IS THE PLAN READY', QuestionNumber: 1,
      questionDetail: 'Judge it against January\'s bar.', School: 'Business School',
      RoundKind: 'judge', Tags: ['release'],
    },
  ],
};

const AVAILABLE_SETS = [
  SET,
  { id: 'premortems', name: 'Pre-mortems', engagementType: 'call-and-answer', totalQuestions: 2, categoryCount: 2, mine: false, canManage: false },
  { id: '80s-trivia', name: '80s Trivia', engagementType: 'trivia', totalQuestions: 100, categoryCount: 4, mine: true, canManage: true },
];

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

/** Every request the panel makes, and a record of the ones that write. */
function mockApi(handlers = {}) {
  const posts = [];
  authFetch.mockImplementation(async (url, options = {}) => {
    const method = (options.method || 'GET').toUpperCase();
    for (const [match, handler] of Object.entries(handlers)) {
      const [wantMethod, pattern] = match.split(' ');
      if (method === wantMethod && url.includes(pattern)) return handler(url, options);
    }
    if (method === 'GET' && url.includes('premortems/questions')) return jsonResponse(200, OTHER_QUESTIONS);
    if (method === 'GET' && url.includes('/questions')) return jsonResponse(200, QUESTIONS);
    if (method === 'GET' && url.includes('/versions')) return jsonResponse(200, []);
    if (method === 'POST' && url.includes('upload-questions')) {
      posts.push(JSON.parse(options.body));
      return jsonResponse(200, { setId: SET.id, setName: SET.name, version: 3, questionCount: 3 });
    }
    throw new Error(`Unhandled request: ${method} ${url}`);
  });
  return posts;
}

beforeEach(() => {
  window.API_BASE = 'https://api.test/';
  authFetch.mockReset();
});

const renderPanel = (props = {}) => render(
  <QuestionsPanel
    questionSet={SET}
    availableSets={AVAILABLE_SETS}
    plannedVersion={3}
    onChanged={jest.fn()}
    onDirtyChange={jest.fn()}
    {...props}
  />
);

/** The rows of the CSV a Save posted, header first. */
const csvRows = (post) => post.fileContent.trim().split('\n');
const titlesIn = (post) => csvRows(post).slice(1).map((line) => line.split(',')[2].replace(/"/g, ''));

const rowFor = (title) => screen.getByText(title).closest('li');
/** Save appears twice once the copy is dirty — in the bar and under the list. */
const saveButton = (name) => screen.getAllByRole('button', { name })[0];

async function ready() {
  await screen.findByText('WHAT WENT WRONG');
}

describe('the working copy', () => {
  it('lists the questions in set order, not the order the endpoint returns them', async () => {
    // rejects: rendering the payload as it arrives. That endpoint sorts on
    // `sortOrder`, which NO writer sets, so it comes back alphabetical —
    // ARE WE SHIPPING first — and saving that order silently reorders somebody's
    // set on a save that was only meant to fix a typo.
    mockApi();
    renderPanel();
    await ready();

    const rendered = [...document.querySelectorAll('.qs-question-title strong')].map((n) => n.textContent);
    expect(rendered).toEqual(['WHAT WENT WRONG', 'WHAT WOULD YOU CHANGE', 'ARE WE SHIPPING']);
  });

  it('writes nothing until Save, and then writes exactly once', async () => {
    // rejects: a save that fires per edit. Three operations must land as ONE
    // replace and ONE version — that is decision 3, and it is what keeps the
    // version list a list of changes rather than a keystroke log.
    const posts = mockApi();
    renderPanel();
    await ready();

    // Edit one.
    fireEvent.click(within(rowFor('WHAT WENT WRONG')).getByRole('button', { name: /edit/i }));
    fireEvent.change(screen.getByLabelText('Title *'), { target: { value: 'WHAT REALLY WENT WRONG' } });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    // Remove another.
    fireEvent.click(within(rowFor('ARE WE SHIPPING')).getByRole('button', { name: /remove/i }));

    // Add a third.
    fireEvent.click(screen.getByRole('button', { name: /Add a question/i }));
    fireEvent.change(screen.getByLabelText('Category *'), { target: { value: 'Retro' } });
    fireEvent.change(screen.getByLabelText('Title *'), { target: { value: 'WHAT WOULD YOU KEEP' } });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(posts).toHaveLength(0);

    fireEvent.click(saveButton(/Save as version 3/i));
    await waitFor(() => expect(posts).toHaveLength(1));

    const post = posts[0];
    expect(post.replaceSetId).toBe('lessons-learned');
    expect(titlesIn(post)).toEqual(['WHAT REALLY WENT WRONG', 'WHAT WOULD YOU CHANGE', 'WHAT WOULD YOU KEEP']);
    // rejects: a note left empty, which is what made every version in the list
    // read identically and a rollback a guess.
    expect(post.versionNote).toMatch(/1 added.*1 edited.*1 removed/);
  });

  it('will not save until something has changed', async () => {
    // rejects: an always-enabled Save. Pressing it on an untouched set would
    // write a new version that changed nothing, and every real version after it
    // would be one harder to find.
    mockApi();
    renderPanel();
    await ready();

    expect(saveButton(/Save as version 3/i)).toBeDisabled();
    fireEvent.click(within(rowFor('ARE WE SHIPPING')).getByRole('button', { name: /remove/i }));
    expect(saveButton(/Save as version 3/i)).toBeEnabled();
  });

  it('keeps a removed question on screen, and puts it back', async () => {
    // rejects: splicing the row out of the array. A delete you cannot see is a
    // delete you cannot undo, and the whole working copy exists in one tab with
    // no draft saved anywhere.
    const posts = mockApi();
    renderPanel();
    await ready();

    fireEvent.click(within(rowFor('ARE WE SHIPPING')).getByRole('button', { name: /remove/i }));
    expect(screen.getByText('ARE WE SHIPPING')).toBeInTheDocument();
    expect(rowFor('ARE WE SHIPPING')).toHaveClass('removed');

    fireEvent.click(within(rowFor('ARE WE SHIPPING')).getByRole('button', { name: /restore/i }));
    expect(rowFor('ARE WE SHIPPING')).not.toHaveClass('removed');
    expect(saveButton(/Save as version 3/i)).toBeDisabled();
    expect(posts).toHaveLength(0);
  });

  it('names every unsaved change and says nothing has been written', async () => {
    // rejects: a bare "unsaved changes" dot. The bar is the answer to "what did
    // I do and what happens if I press Save", so it counts the operations and
    // names the version it will write.
    mockApi();
    renderPanel();
    await ready();

    fireEvent.click(within(rowFor('ARE WE SHIPPING')).getByRole('button', { name: /remove/i }));
    const bar = await screen.findByTestId('unsaved-bar');
    expect(bar).toHaveTextContent('Unsaved: 1 removed');
    expect(bar).toHaveTextContent(/Nothing has been written yet/i);
    expect(bar).toHaveTextContent(/2 questions will be saved as version 3/i);
  });

  it('asks before discarding, and puts the set back as it was', async () => {
    // rejects: a Discard that fires on the first click. It is the one control
    // that destroys work with no server call to fail and nothing to recover.
    mockApi();
    renderPanel();
    await ready();

    fireEvent.click(within(rowFor('ARE WE SHIPPING')).getByRole('button', { name: /remove/i }));

    // First click only asks.
    fireEvent.click(screen.getAllByRole('button', { name: /Discard changes/i })[0]);
    const asked = (await screen.findByText(/Discard your changes\?/i)).closest('.modal-content');
    expect(rowFor('ARE WE SHIPPING')).toHaveClass('removed');

    // Backing out changes nothing.
    fireEvent.click(within(asked).getByRole('button', { name: /Keep editing/i }));
    await waitFor(() => expect(screen.queryByText(/Discard your changes\?/i)).not.toBeInTheDocument());
    expect(rowFor('ARE WE SHIPPING')).toHaveClass('removed');

    // Confirming puts the set back where it started.
    fireEvent.click(screen.getAllByRole('button', { name: /Discard changes/i })[0]);
    const confirmed = (await screen.findByText(/Discard your changes\?/i)).closest('.modal-content');
    fireEvent.click(within(confirmed).getByRole('button', { name: /^Discard changes$/i }));

    await waitFor(() => expect(rowFor('ARE WE SHIPPING')).not.toHaveClass('removed'));
    expect(screen.queryByTestId('unsaved-bar')).not.toBeInTheDocument();
  });

  it('keeps the working copy when the save fails', async () => {
    // rejects: clearing or reloading the working copy on a failed save. The
    // edits exist nowhere else — a 500 that also throws away the afternoon's
    // work is the worst outcome this panel has.
    mockApi({
      'POST upload-questions': async () => jsonResponse(500, { error: 'DynamoDB is having a day' }),
    });
    renderPanel();
    await ready();

    fireEvent.click(within(rowFor('ARE WE SHIPPING')).getByRole('button', { name: /remove/i }));
    fireEvent.click(saveButton(/Save as version 3/i));

    const banner = await screen.findByText(/DynamoDB is having a day/);
    expect(banner).toHaveTextContent(/nothing was written, and your changes are still here/i);
    expect(banner.closest('.status-message')).toHaveClass('error');
    expect(rowFor('ARE WE SHIPPING')).toHaveClass('removed');
    expect(screen.getByTestId('unsaved-bar')).toBeInTheDocument();
  });

  it('refuses a half-filled question instead of letting the importer drop it', async () => {
    // rejects: trusting the server to validate. upload-questions SKIPS a row
    // with no Category or Title — 200, cheerful message, one question quietly
    // missing — so the refusal has to happen while the text is still on screen.
    const posts = mockApi();
    renderPanel();
    await ready();

    fireEvent.click(screen.getByRole('button', { name: /Add a question/i }));
    fireEvent.change(screen.getByLabelText('Category *'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Title *'), { target: { value: 'NO CATEGORY ON ME' } });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(await screen.findByText(/needs a category/i)).toBeInTheDocument();
    expect(posts).toHaveLength(0);
  });
});

describe('pulling questions out of another set', () => {
  it('filters what was already fetched, without asking the server again', async () => {
    // rejects: a request per filter change, and a filter that claims to search
    // across sets. This reads ONE set and narrows what it read — search is out
    // (owner's call) and there is no index behind this.
    mockApi();
    renderPanel();
    await ready();

    fireEvent.click(screen.getByRole('button', { name: /Pull from another set/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Pre-mortems/i }));

    const list = await screen.findByTestId('pull-questions');
    expect(within(list).getByText('THE PRE-MORTEM RULE')).toBeInTheDocument();
    expect(within(list).getByText('IS THE PLAN READY')).toBeInTheDocument();

    const before = authFetch.mock.calls.length;
    fireEvent.change(screen.getByLabelText(/Filter by direction/i), { target: { value: 'apply' } });

    await waitFor(() =>
      expect(within(screen.getByTestId('pull-questions')).queryByText('IS THE PLAN READY')).not.toBeInTheDocument());
    expect(within(screen.getByTestId('pull-questions')).getByText('THE PRE-MORTEM RULE')).toBeInTheDocument();
    expect(authFetch.mock.calls.length).toBe(before);
  });

  it('copies the chosen questions in as independent copies, stamped with where they came from', async () => {
    // rejects: a copy that shares identity with the original, and one that
    // arrives without its material. The copy is a new row in THIS set; the
    // provenance is recorded and read by nothing.
    const posts = mockApi();
    renderPanel();
    await ready();

    fireEvent.click(screen.getByRole('button', { name: /Pull from another set/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Pre-mortems/i }));
    await screen.findByTestId('pull-questions');

    // The dialog has to say it, at the moment of copying.
    expect(screen.getByText(/Editing them in this set will not change the originals/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Select all 2/i }));
    fireEvent.click(screen.getByRole('button', { name: /Copy 2 questions in/i }));

    expect(await screen.findByText('THE PRE-MORTEM RULE')).toBeInTheDocument();
    fireEvent.click(saveButton(/Save as version 3/i));
    await waitFor(() => expect(posts).toHaveLength(1));

    const rows = csvRows(posts[0]);
    expect(rows[0]).toContain('SourceSetId');
    expect(rows[0]).toContain('SourceQuestionSk');
    const copied = rows.find((r) => r.includes('THE PRE-MORTEM RULE'));
    expect(copied).toContain('premortems');
    expect(copied).toContain('c001#001');
    expect(copied).toContain('The team writes the failure report first.');
    expect(copied).toContain('Gary Klein');
    // Five questions out, one POST, and the source set was never written to.
    expect(titlesIn(posts[0])).toHaveLength(5);
    expect(posts[0].replaceSetId).toBe('lessons-learned');
  });

  it('offers only sets of the same kind, and says why the others are missing', async () => {
    // rejects: offering a trivia set to a call-and-answer editor. The importer
    // only parses OptionA..F and CorrectAnswer for a trivia set, so that copy
    // would arrive stripped of every answer — silently, which is this repo's
    // most expensive recurring defect.
    mockApi();
    renderPanel();
    await ready();

    fireEvent.click(screen.getByRole('button', { name: /Pull from another set/i }));
    expect(await screen.findByRole('button', { name: /Pre-mortems/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /80s Trivia/i })).not.toBeInTheDocument();
    expect(screen.getByText(/1 set is hidden for that reason/i)).toBeInTheDocument();
  });
});

describe('saving a set that is not yours', () => {
  const NOT_MINE = { ...SET, id: 'premortems', name: 'Pre-mortems', canManage: false };

  it('says the save will fork before anything is pressed', async () => {
    // rejects: a Save button that looks the same on somebody else's set.
    // Silently creating a second set that looks like the first is the worst
    // outcome available — they would edit the wrong one next time.
    mockApi();
    renderPanel({ questionSet: NOT_MINE });
    await screen.findByText('THE PRE-MORTEM RULE');

    expect(screen.getByText(/saving makes your own copy and leaves the original alone/i)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Save as my own copy/i }).length).toBeGreaterThan(0);
  });

  it('creates a new set of your own and never replaces the original', async () => {
    // rejects: a fork that posts replaceSetId. The handler would refuse it
    // (proved in tests/question-set-roundtrip.js) but the UI must not even try:
    // the fork is a client-side choice of WHICH set to write, not a relaxation
    // of who may write where.
    const posts = mockApi();
    renderPanel({ questionSet: NOT_MINE });
    await screen.findByText('THE PRE-MORTEM RULE');

    fireEvent.click(within(rowFor('IS THE PLAN READY')).getByRole('button', { name: /remove/i }));
    fireEvent.click(saveButton(/Save as my own copy/i));

    // The name is offered, and it is theirs to change.
    const nameField = await screen.findByLabelText(/Name the new set/i);
    expect(nameField).toHaveValue('Pre-mortems (adapted)');
    fireEvent.change(nameField, { target: { value: 'Pre-mortems for my team' } });
    fireEvent.click(screen.getByRole('button', { name: /Create the set/i }));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].replaceSetId).toBeUndefined();
    expect(posts[0].customTitle).toBe('Pre-mortems for my team');
    expect(posts[0].sourceSetId).toBe('premortems');
    expect(titlesIn(posts[0])).toEqual(['THE PRE-MORTEM RULE']);
    // Provenance travels on the rows too, the same way a pulled question's does.
    expect(csvRows(posts[0])[0]).toContain('SourceSetId');
  });

  it('turns the handler\'s 403 into the fork offer rather than losing the work', async () => {
    // rejects: reporting a bare "403" and dropping the working copy. The server
    // is the authority on ownership; when the list said otherwise, the edits
    // still have somewhere to go.
    mockApi({
      'POST upload-questions': async () => jsonResponse(403, {
        error: 'This question set belongs to someone else. You can only change sets you created.',
      }),
    });
    renderPanel();   // canManage: true, but the server disagrees
    await ready();

    fireEvent.click(within(rowFor('ARE WE SHIPPING')).getByRole('button', { name: /remove/i }));
    fireEvent.click(saveButton(/Save as version 3/i));

    expect(await screen.findByLabelText(/Name the new set/i)).toBeInTheDocument();
    expect(screen.getByText(/Your changes are still here/i)).toBeInTheDocument();
    expect(screen.getByTestId('unsaved-bar')).toBeInTheDocument();
  });
});

describe('carving a subset out', () => {
  it('creates a new set from the selected questions and leaves this one alone', async () => {
    // rejects: a subset flow that needs its own screen, its own route, or its
    // own write path. It is the fork path with different rows — new set, seeded
    // from a working copy — which is why there is one code path and not three.
    const posts = mockApi();
    renderPanel();
    await ready();

    fireEvent.click(screen.getByLabelText('Select WHAT WENT WRONG'));
    fireEvent.click(screen.getByLabelText('Select ARE WE SHIPPING'));
    fireEvent.click(screen.getByRole('button', { name: /Save 2 selected as a new set/i }));

    fireEvent.change(await screen.findByLabelText(/Name the new set/i), { target: { value: 'Openers' } });
    fireEvent.click(screen.getByRole('button', { name: /Create the set/i }));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].replaceSetId).toBeUndefined();
    expect(posts[0].customTitle).toBe('Openers');
    expect(titlesIn(posts[0])).toEqual(['WHAT WENT WRONG', 'ARE WE SHIPPING']);
    expect(posts[0].sourceSetId).toBe('lessons-learned');
  });
});

describe('closing the editor', () => {
  it('asks before throwing away an unsaved working copy', async () => {
    // rejects: a Cancel that closes straight away. The working copy lives in
    // this tab and nowhere else, and Cancel is one click from the Save button.
    mockApi();
    const onCancel = jest.fn();
    render(
      <QuestionSetEditor
        questionSet={SET}
        availableSets={AVAILABLE_SETS}
        onSaved={jest.fn()}
        onChanged={jest.fn()}
        onCancel={onCancel}
      />
    );
    await ready();

    fireEvent.click(within(rowFor('ARE WE SHIPPING')).getByRole('button', { name: /remove/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Cancel$/ }));

    expect(await screen.findByText(/You have unsaved questions/i)).toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Close and lose the changes/i }));
    expect(onCancel).toHaveBeenCalled();
  });
});
