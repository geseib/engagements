import React from 'react';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import QuestionsPanel from '../components/QuestionsPanel';
import { authFetch } from '../auth/authFetch';

/*
 * IN A BUILD ROOM (step 7b, C15). A set tagged build-room shows each
 * question's "In a Build Room" section: how it is asked (derived, never
 * typed), what Claude gets when the room decides, and a note for Claude.
 * Both fields ride the CSV the console saves, as ClaudeGets and ClaudeNote.
 */
jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));

const SET = (tags) => ({
  id: 'br-starters', name: 'Build Room starters', engagementType: 'call-and-answer',
  totalQuestions: 1, categoryCount: 1, activeVersion: 1, canManage: true, tags,
});
const POLL = {
  id: 'br-pulse', name: 'Build Room pulse', engagementType: 'poll',
  totalQuestions: 2, categoryCount: 1, activeVersion: 1, canManage: true, tags: ['build-room'],
};
const QUESTIONS = {
  'br-starters': [{ id: 'c001#001', Category: 'While building', QuestionNumber: 1, title: 'What should we cut?', detail: 'One thing.', ClaudeGets: 'do-now', ClaudeNote: 'Remove the winning item.' }],
  'br-pulse': [
    { id: 'c001#001', Category: 'While building', QuestionNumber: 1, title: 'How clear is the main screen?', kind: 'rating', scale: '1-5' },
    { id: 'c001#002', Category: 'While building', QuestionNumber: 2, title: 'Ship it?', kind: 'yesno' },
  ],
};

const jsonResponse = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
function mockApi(setId) {
  const posts = [];
  authFetch.mockImplementation(async (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    if (method === 'POST' && url.includes('upload-questions')) {
      posts.push(JSON.parse(opts.body));
      return jsonResponse(200, { setId, version: 2, questionCount: 1 });
    }
    if (method === 'GET' && url.includes('/questions')) return jsonResponse(200, { setId, questions: QUESTIONS[setId] });
    throw new Error(`Unhandled request: ${method} ${url}`);
  });
  return { posts };
}

beforeEach(() => { window.API_BASE = 'https://api.test/'; authFetch.mockReset(); });
afterEach(() => { document.body.style.overflow = ''; });

const renderPanel = (set) => render(
  <QuestionsPanel questionSet={set} availableSets={[set]} plannedVersion={2} onChanged={jest.fn()} onDirtyChange={jest.fn()} />,
);
const edit = async (title) => {
  await screen.findByText(title);
  fireEvent.click(within(screen.getByText(title).closest('li')).getByRole('button', { name: /edit/i }));
  return screen.findByRole('dialog');
};

describe('the question form in a build-room set (C15)', () => {
  test('Call and Answer: asked as Ideas; Claude gets and the note are editable and saved as CSV columns', async () => {
    const { posts } = mockApi('br-starters');
    renderPanel(SET(['build-room']));
    const dialog = await edit('What should we cut?');
    const section = within(dialog).getByRole('group', { name: 'In a Build Room' });
    expect(section.textContent).toMatch('Asked as Ideas. Everyone answers, then votes.');
    expect(within(section).getByLabelText('When decided, Claude gets it as')).toHaveValue('do-now');
    expect(within(section).getByLabelText('Note for Claude')).toHaveValue('Remove the winning item.');
    fireEvent.change(within(section).getByLabelText('When decided, Claude gets it as'), { target: { value: 'keep' } });
    expect(section.textContent).toMatch('Goes on the brief; Claude does not stop.');
    fireEvent.change(within(section).getByLabelText('Note for Claude'), { target: { value: 'Treat it as a rule.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    fireEvent.click(screen.getAllByRole('button', { name: /Save as version 2/ })[0]);
    await waitFor(() => expect(posts).toHaveLength(1));
    const [header, row] = posts[0].fileContent.split('\n');
    expect(header).toBe('Category,Question#,Title,Detail_lesson,School,CustomInstruction,ClaudeGets,ClaudeNote,Tags');
    expect(row).toBe('"While building",1,"What should we cut?","One thing.","","","keep","Treat it as a rule.",""');
  });

  test('without the tag, no Build Room section', async () => {
    mockApi('br-starters');
    renderPanel(SET(['retro']));
    const dialog = await edit('What should we cut?');
    expect(within(dialog).queryByRole('group', { name: 'In a Build Room' })).toBeNull();
  });

  test('Poll: a 1 to 5 rating is Rate; a yes or no says it is not offered, and why', async () => {
    mockApi('br-pulse');
    renderPanel(POLL);
    let dialog = await edit('How clear is the main screen?');
    expect(within(dialog).getByRole('group', { name: 'In a Build Room' }).textContent).toMatch('Asked as Rate. The room rates 1 to 5: 1 needs work, 5 is great.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    dialog = await edit('Ship it?');
    const section = within(dialog).getByRole('group', { name: 'In a Build Room' });
    expect(section.textContent).toMatch('Not offered in a Build Room. A yes or no question cannot be asked in a Build Room.');
    expect(within(section).queryByLabelText('Note for Claude')).toBeNull();
  });
});
