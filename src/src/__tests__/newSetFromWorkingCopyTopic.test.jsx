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

function mockApi() {
  const posts = [];
  authFetch.mockImplementation(async (url, options = {}) => {
    const method = (options.method || 'GET').toUpperCase();
    if (method === 'GET' && url.includes('/questions')) return jsonResponse(200, QUESTIONS);
    if (method === 'GET' && url.includes('/versions')) return jsonResponse(200, []);
    if (method === 'POST' && url.includes('upload-questions')) {
      posts.push(JSON.parse(options.body));
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

    expect(await screen.findByText(/Give this set a topic/)).toBeInTheDocument();
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
