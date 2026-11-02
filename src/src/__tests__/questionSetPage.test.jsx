/**
 * A QUESTION SET IS A PLACE (experience plan Phase 5 step 5e; audit E §1.5 Q1).
 *
 * `/sets/<id>` is the set editor as a page: a bar (Back, the set's name, help)
 * over the same QuestionSetEditor the console mounts, with the host's three
 * admins-only panels off. App.jsx routes the address; the host's shelf opens
 * the same place in place of itself (hostQuestionSets.test.jsx).
 *
 * rejects: the page losing a capability the stacked dialogs had (details,
 * categories, questions — add, edit, delete — Add questions with Workie, the
 * set's Workie); a Back that drops an unsaved working copy without asking; an
 * address the router does not answer; a lying empty state for a set that is
 * not there.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));
jest.mock('../auth/navigate', () => ({ navigateTo: jest.fn(), default: jest.fn() }));

const { authFetch } = require('../auth/authFetch');
const { navigateTo } = require('../auth/navigate');
const QuestionSetPage = require('../components/QuestionSetPage').default;
const { setFromLocation, setPath, HOST_EDITOR_FLAGS } = require('../components/QuestionSetPage');

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });

const SETS = [
  {
    id: 'ivy-retro', name: 'Ivy Retro', description: 'Made last Tuesday', scope: 'org',
    engagementType: 'call-and-answer', totalQuestions: 2, categoryCount: 1,
    active: true, hasImages: false, canManage: true, mine: true,
  },
];
const QUESTIONS = {
  setId: 'ivy-retro',
  questions: [
    { id: 'c001#001', Category: 'Retro', title: 'WHAT WENT WRONG', QuestionNumber: 1, questionDetail: 'Pick one incident.', Tags: [] },
    { id: 'c001#002', Category: 'Retro', title: 'WHAT WOULD YOU CHANGE', QuestionNumber: 2, questionDetail: 'One thing only.', Tags: [] },
  ],
};

function mockApi({ sets = SETS } = {}) {
  authFetch.mockImplementation(async (url, options = {}) => {
    const method = (options.method || 'GET').toUpperCase();
    if (method === 'GET' && /\/admin\/question-sets$/.test(url)) return json(200, { questionSets: sets, setAllowance: null });
    if (method === 'GET' && /\/question-sets\/[^/]+\/questions$/.test(url)) return json(200, QUESTIONS);
    if (method === 'GET' && /\/admin\/ai-prompts/.test(url)) return json(200, { prompts: [] });
    if (method === 'GET' && /\/admin\/personas/.test(url)) return json(200, { personas: [] });
    if (method === 'POST' && url.includes('/admin/upload-questions')) {
      return json(200, { message: 'ok', version: 2, questionCount: 2, setName: 'Ivy Retro' });
    }
    return json(200, {});
  });
}

beforeEach(() => {
  authFetch.mockReset();
  navigateTo.mockReset();
  window.API_BASE = 'https://api.example.test/dev/';
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

async function openPage(props = {}) {
  mockApi(props.api);
  const onLeave = jest.fn();
  render(<QuestionSetPage setId="ivy-retro" onLeave={onLeave} {...props} />);
  await screen.findByTestId('question-0');
  return { onLeave };
}

describe('the address', () => {
  test('/sets/<id> names the set, and setPath writes it back', () => {
    expect(setFromLocation({ pathname: '/sets/ivy-retro', search: '' })).toEqual({ id: 'ivy-retro', scope: '' });
    expect(setFromLocation({ pathname: '/sets/a%20b/', search: '?scope=org' })).toEqual({ id: 'a b', scope: 'org' });
    expect(setFromLocation({ pathname: '/sets/', search: '' })).toBeNull();
    expect(setFromLocation({ pathname: '/sets/a/b', search: '' })).toBeNull();
    expect(setFromLocation({ pathname: '/host', search: '' })).toBeNull();
    expect(setPath({ id: 'a b', scope: 'org' })).toBe('/sets/a%20b?scope=org');
    expect(setPath({ id: 'ivy-retro' })).toBe('/sets/ivy-retro');
  });

  test('App.jsx answers it, behind sign-in, before the host page catches everything', () => {
    const app = require('fs').readFileSync(require('path').join(__dirname, '..', 'App.jsx'), 'utf8');
    const route = app.indexOf('const setPage = setFromLocation(window.location);');
    expect(route).toBeGreaterThan(0);
    expect(app.slice(route, route + 300)).toMatch(/<ProtectedRoute>\s*<QuestionSetPage setId=\{setPage\.id\} scope=\{setPage\.scope\} \/>/);
    expect(route).toBeLessThan(app.lastIndexOf('<GameHostPage />'));
  });
});

describe('the page holds what the stacked dialogs held', () => {
  test('a bar with the way back and the set\'s name, then the editor\'s sections', async () => {
    await openPage();
    const place = screen.getByTestId('set-place');
    expect(place).toHaveAttribute('data-theme', 'dark');
    expect(within(place).getByRole('heading', { level: 1, name: 'Ivy Retro' })).toBeInTheDocument();
    expect(within(place).getByTestId('set-place-back')).toHaveTextContent('Back');
    expect(within(place).getByRole('heading', { name: /details/i })).toBeInTheDocument();
    expect(within(place).getByTestId('questions-panel')).toBeInTheDocument();
    expect(within(place).getByRole('heading', { name: /images/i })).toBeInTheDocument();
    // The bar is the head: the editor's own dialog head is not drawn twice.
    expect(screen.queryByTestId('qs-editor-close')).toBeNull();
  });

  test('the host\'s admins-only panels stay off, and cannot be turned back on', async () => {
    expect(HOST_EDITOR_FLAGS).toEqual({ showVersions: false, showDownload: false, showAIAssist: false });
    await openPage();
    expect(screen.queryByRole('heading', { name: /^versions$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /download csv/i })).toBeNull();
  });

  test('add, edit and delete a question; categories; Add questions with Workie', async () => {
    await openPage();
    // Add.
    fireEvent.click(screen.getAllByRole('button', { name: /add a question/i })[0]);
    const add = await screen.findByRole('dialog', { name: /new question/i });
    // A question's category is chosen in the form (CategoryPicker).
    expect(within(add).getAllByText(/category/i).length).toBeGreaterThan(0);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /new question/i })).toBeNull());
    // Edit.
    fireEvent.click(within(screen.getByTestId('question-0')).getByRole('button', { name: /^edit$/i }));
    const form = await screen.findByRole('dialog', { name: /^edit question$/i });
    fireEvent.change(within(form).getByLabelText('Title *'), { target: { value: 'WHAT WENT RIGHT' } });
    fireEvent.click(within(form).getByRole('button', { name: /^done$/i }));
    await screen.findByTestId('unsaved-bar');
    // Delete is on the row.
    expect(within(screen.getByTestId('question-1')).getByRole('button', { name: /remove|delete/i })).toBeInTheDocument();
    // Workie writes more from here.
    expect(screen.getByRole('button', { name: /add questions/i })).toBeInTheDocument();
  });

  test('a question dialog is the only thing opened over the page — one layer, not four', async () => {
    await openPage();
    fireEvent.click(within(screen.getByTestId('question-0')).getByRole('button', { name: /^edit$/i }));
    await screen.findByRole('dialog', { name: /^edit question$/i });
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });
});

describe('the way back', () => {
  test('Back leaves when there is nothing to lose', async () => {
    const { onLeave } = await openPage();
    fireEvent.click(screen.getByTestId('set-place-back'));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  test('Back asks first while questions are unsaved, and staying keeps them', async () => {
    const { onLeave } = await openPage();
    fireEvent.click(within(screen.getByTestId('question-0')).getByRole('button', { name: /^edit$/i }));
    const form = await screen.findByRole('dialog', { name: /^edit question$/i });
    fireEvent.change(within(form).getByLabelText('Title *'), { target: { value: 'CHANGED' } });
    fireEvent.click(within(form).getByRole('button', { name: /^done$/i }));
    await screen.findByTestId('unsaved-bar');

    fireEvent.click(screen.getByTestId('set-place-back'));
    expect(await screen.findByText(/You have unsaved questions/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Go back and save them/i }));
    expect(onLeave).not.toHaveBeenCalled();
    expect(screen.getByTestId('unsaved-bar')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('set-place-back'));
    fireEvent.click(await screen.findByRole('button', { name: /Close and lose the changes/i }));
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  test('opened directly with nowhere to go back to, Back goes to the main menu', async () => {
    mockApi();
    render(<QuestionSetPage setId="ivy-retro" />);
    await screen.findByTestId('question-0');
    fireEvent.click(screen.getByTestId('set-place-back'));
    expect(navigateTo).toHaveBeenCalledWith('/');
  });
});

describe('the states a link can land in', () => {
  test('a set that is not in the library says so, with a way back', async () => {
    mockApi({ sets: [] });
    const onLeave = jest.fn();
    render(<QuestionSetPage setId="gone" onLeave={onLeave} />);
    expect(await screen.findByRole('heading', { name: /no question set here/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onLeave).toHaveBeenCalled();
  });

  test('a refused read shows the server\'s words and a retry', async () => {
    authFetch.mockImplementation(async () => json(403, { error: 'Sign in again to see this set.' }));
    render(<QuestionSetPage setId="ivy-retro" onLeave={() => {}} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign in again to see this set.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
