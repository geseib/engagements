/**
 * A SET CARVED OUT OF A WORKING COPY STILL NAMES ITS SHELF — QuestionsPanel.
 *
 * Forking somebody else's set and carving a subset out of your own are the same
 * write: `POST /admin/upload-questions` with a `customTitle` and no
 * `replaceSetId`, which is a CREATE that lands live — so the importer requires
 * a topic and answers 400 without one.
 *
 * The dialog is seeded from the set being copied, because a fork of an 80s
 * trivia set is still Music and asking again would be asking a question the
 * screen already knows the answer to.
 *
 * Harness copied from questionSetEditorQuestions.test.jsx.
 */
import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import QuestionsPanel from '../components/QuestionsPanel';
import { authFetch } from '../auth/authFetch';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));

const SET = {
  id: 'lessons-learned',
  name: 'Lessons Learned',
  engagementType: 'call-and-answer',
  totalQuestions: 2,
  categoryCount: 1,
  activeVersion: 2,
  canManage: true,
  topic: 'business-work',
  tags: ['retro'],
};

/** The same set with nothing on it — one of the forty that predate the field. */
const UNFILED = { ...SET, topic: undefined, tags: undefined };

const QUESTIONS = {
  setId: SET.id,
  questions: [
    {
      id: 'c001#001', Category: 'Retro', title: 'WHAT WENT WRONG', QuestionNumber: 1,
      questionDetail: 'Pick one incident.', School: 'Business School',
    },
    {
      id: 'c001#002', Category: 'Retro', title: 'WHAT WOULD YOU CHANGE', QuestionNumber: 2,
      questionDetail: 'One thing only.', School: 'Business School',
    },
  ],
};

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body),
});

function mockApi({ uploadFails = null } = {}) {
  const posts = [];
  authFetch.mockImplementation(async (url, options = {}) => {
    const method = (options.method || 'GET').toUpperCase();
    if (method === 'GET' && url.includes('/questions')) return jsonResponse(200, QUESTIONS);
    if (method === 'GET' && url.includes('/versions')) return jsonResponse(200, []);
    if (method === 'POST' && url.includes('upload-questions')) {
      posts.push(JSON.parse(options.body));
      if (uploadFails) return jsonResponse(uploadFails.status, uploadFails.body || { error: uploadFails.error });
      return jsonResponse(200, { setId: 'new-set', setName: 'Openers', questionCount: 1 });
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
  <QuestionsPanel questionSet={SET} plannedVersion={3} onChanged={jest.fn()} onDirtyChange={jest.fn()} {...props} />,
);

/** Tick one question and open the dialog that names the new set. */
async function openDialog() {
  await screen.findByText('WHAT WENT WRONG');
  fireEvent.click(screen.getByLabelText('Select WHAT WENT WRONG'));
  fireEvent.click(screen.getByRole('button', { name: /Save 1 selected as a new set/i }));
  return screen.findByLabelText(/Name the new set/i);
}

const dialogPicker = () => screen.getByLabelText(/topic/i);
const create = () => fireEvent.click(screen.getByRole('button', { name: /Create the set/i }));
/** The dialog box itself — `Modal` puts `role="dialog"` on the card, not the scrim. */
const dialog = () => screen.getByRole('dialog');

describe('the dialog asks where the new set will sit', () => {
  it('starts on the shelf the set it came from sits on', async () => {
    mockApi();
    renderPanel();
    await openDialog();
    expect(dialogPicker()).toHaveValue('business-work');
  });

  it('sends that shelf with the create', async () => {
    const posts = mockApi();
    renderPanel();
    fireEvent.change(await openDialog(), { target: { value: 'Openers' } });
    create();

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].topic).toBe('business-work');
    expect(posts[0].customTitle).toBe('Openers');
  });

  it('lets the new set go on a different shelf from its source', async () => {
    // A subset carved out of a mixed set is often about one thing, which is
    // precisely when this matters.
    const posts = mockApi();
    renderPanel();
    fireEvent.change(await openDialog(), { target: { value: 'Openers' } });
    fireEvent.change(dialogPicker(), { target: { value: 'history' } });
    create();

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].topic).toBe('history');
  });

  it('carries the source set’s own words across as a starting point', async () => {
    const posts = mockApi();
    renderPanel();
    fireEvent.change(await openDialog(), { target: { value: 'Openers' } });
    create();

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].tags).toEqual(['retro']);
  });
});

describe('a set carved out of an unfiled one', () => {
  it('opens Unfiled rather than inheriting a shelf nobody chose', async () => {
    mockApi();
    renderPanel({ questionSet: UNFILED });
    await openDialog();
    expect(dialogPicker()).toHaveValue('');
  });

  it('refuses the create, says what to do, and sends nothing', async () => {
    // rejects: posting it and reporting the importer's 400. The person is one
    // dropdown away from the answer and the dialog is still on screen.
    const posts = mockApi();
    renderPanel({ questionSet: UNFILED });
    fireEvent.change(await openDialog(), { target: { value: 'Openers' } });
    create();

    await screen.findByText(/Give this set a topic/);
    expect(within(dialog()).getByText(/Give this set a topic/)).toBeInTheDocument();
    expect(posts).toHaveLength(0);
    // Still open, with the name they typed still in it.
    expect(screen.getByLabelText(/Name the new set/i)).toHaveValue('Openers');
  });

  it('creates once a shelf is chosen', async () => {
    const posts = mockApi();
    renderPanel({ questionSet: UNFILED });
    fireEvent.change(await openDialog(), { target: { value: 'Openers' } });
    fireEvent.change(dialogPicker(), { target: { value: 'history' } });
    create();

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].topic).toBe('history');
  });
});

describe('a refusal is said where the dialog is', () => {
  /*
    THE PANEL'S STATUS LINE IS BEHIND THIS DIALOG. It renders outside the
    `Modal`, and `.modal-overlay` is a fixed full-viewport scrim at z-index 9999
    over a body whose scroll `Modal` has locked — so an answer written there
    while the dialog is open is an answer nobody can see, and pressing Create
    reads as a dead button. Every refusal this dialog can produce has to be a
    DESCENDANT of the dialog.

    Containment is asserted rather than mere presence because jsdom has no
    layout engine: `findByText` passes identically whether the sentence is on
    the card or behind the scrim, which is exactly the distinction that matters
    here. This is a containment fact, not a geometric one, so jsdom can answer
    it (see the design system's "no geometric assertions" rule).
  */

  it('says the missing shelf on the card, not behind it', async () => {
    mockApi();
    renderPanel({ questionSet: UNFILED });
    fireEvent.change(await openDialog(), { target: { value: 'Openers' } });
    create();

    await screen.findByText(/Give this set a topic/);
    expect(within(dialog()).getByText(/Give this set a topic/)).toBeInTheDocument();
  });

  it('says the missing name on the card, not behind it', async () => {
    // Same defect, same function, one branch earlier — and it predates the
    // shelf, so a person who cleared the name has been told nothing all along.
    mockApi();
    renderPanel();
    fireEvent.change(await openDialog(), { target: { value: '  ' } });
    create();

    await screen.findByText(/needs a name/);
    expect(within(dialog()).getByText(/needs a name/)).toBeInTheDocument();
  });

  it('says a refused create on the card, not behind it', async () => {
    // The shelf is chosen and the write still fails: the dialog stays open, so
    // the server's reason has to land on it too, or the 400 this whole path
    // exists to pre-empt becomes invisible instead of merely late.
    const posts = mockApi({ uploadFails: { status: 400, error: 'Set name already taken' } });
    renderPanel();
    fireEvent.change(await openDialog(), { target: { value: 'Openers' } });
    create();

    await waitFor(() => expect(posts).toHaveLength(1));
    await screen.findByText(/Set name already taken/);
    expect(within(dialog()).getByText(/Set name already taken/)).toBeInTheDocument();
    // Still open, so the name is still there to change.
    expect(screen.getByLabelText(/Name the new set/i)).toHaveValue('Openers');
  });

  it('drops a refusal once the create it refused succeeds', async () => {
    // rejects: a refusal that outlives the thing it was about, still on the
    // card while the set it refused is being made.
    const posts = mockApi();
    renderPanel({ questionSet: UNFILED });
    fireEvent.change(await openDialog(), { target: { value: 'Openers' } });
    create();
    await screen.findByText(/Give this set a topic/);

    fireEvent.change(dialogPicker(), { target: { value: 'history' } });
    create();

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(screen.queryByText(/Give this set a topic/)).not.toBeInTheDocument();
  });
});

describe('the replace path is untouched', () => {
  it('sends no topic when saving a new version of the same set', async () => {
    // rejects: adding `topic` to the one write path for every target. A replace
    // rewrites no set prose — not the name, not the description — and the
    // importer stores no topic on that branch, so sending one would be a value
    // that goes nowhere and reads as though it had been applied.
    const posts = mockApi();
    renderPanel();
    await screen.findByText('WHAT WENT WRONG');

    const row = screen.getByText('WHAT WOULD YOU CHANGE').closest('li');
    fireEvent.click(within(row).getByRole('button', { name: /remove/i }));
    fireEvent.click(screen.getAllByRole('button', { name: /Save as version 3/i })[0]);

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].replaceSetId).toBe('lessons-learned');
    expect('topic' in posts[0]).toBe(false);
  });
});

describe('a new set refused at the stored-set allowance', () => {
  // 22-plan-limit-notice.html: this said "Could not create "Openers": This
  // organisation cannot store another question set yet…" — the plan limit in
  // a fault's voice, with the way out left unsaid.
  it('says it on the card as the plan-limit notice, and keeps the dialog and the name', async () => {
    mockApi({ uploadFails: { status: 402, body: {
      code: 'upgrade_required',
      error: 'This organisation cannot store another question set yet.',
      limit: { kind: 'sets', used: 5, included: 5 },
      resolve: { role: 'admin', canViewBilling: true, org: { name: 'Northwind', type: 'team' }, contacts: [{ name: 'Dana Whitfield', email: 'dana@x.example', role: 'owner' }], resetsOn: '2026-10-01' },
    } } });
    renderPanel();
    fireEvent.change(await openDialog(), { target: { value: 'Openers' } });
    create();

    const box = await within(dialog()).findByTestId('plan-limit-notice');
    expect(box).toHaveTextContent('Northwind holds 5 of the 5 question sets it includes. Nothing was created.');
    expect(box).toHaveTextContent('Only the owner can move Northwind to the Team plan.');
    // rejects: the plan fact reported as "Could not create …"
    expect(within(dialog()).queryByText(/Could not create/)).toBeNull();
    expect(screen.getByLabelText(/Name the new set/i)).toHaveValue('Openers');
  });
});
