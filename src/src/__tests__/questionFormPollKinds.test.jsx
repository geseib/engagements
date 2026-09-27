import React from 'react';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import QuestionsPanel from '../components/QuestionsPanel';
import { authFetch } from '../auth/authFetch';

/*
 * A POLL SET IN THE QUESTIONS PANEL — typed polls (the owner, 27 Sep 2026: a
 * poll is "a short instant feedback version of the survey items", with the
 * survey's question mechanisms: rate, pick from a few choices, binary, open).
 *
 * What is under test is what a person can do and what reaches the wire:
 *   - each row names its kind — a row stored before polls had kinds reads as
 *     the choice (or open answer) it always meant — and keeps its category;
 *   - the question form is the survey's kind bar and kind fields, limited to
 *     the four poll kinds, and keeps the poll's Category and Title;
 *   - the options box and the "Answers allowed" select are gone;
 *   - a new poll question starts as a multiple choice in the seeded category;
 *   - Save posts the contract CSV, each row in its own category.
 *
 * The expected CSV is TYPED OUT from the contract, never built with rowsToCsv.
 * No geometry: jsdom has no layout engine.
 */
jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));

const SET = {
  id: 'team-pulse',
  name: 'Team pulse',
  engagementType: 'poll',
  totalQuestions: 4,
  categoryCount: 3,
  activeVersion: 2,
  canManage: true,
};

/* Two rows stored before polls had kinds (options, or nothing), and two typed. */
const QUESTIONS = {
  setId: SET.id,
  questions: [
    {
      id: 'c001#001', Category: 'Workplace', QuestionNumber: 1, title: 'Where do you work best?',
      options: ['Office', 'Home', 'Both'], allowMultiple: false,
    },
    { id: 'c001#002', Category: 'Workplace', QuestionNumber: 2, title: 'What should we stop doing?' },
    {
      id: 'c002#001', Category: 'Decisions', QuestionNumber: 1, title: 'Ship on Thursday?',
      kind: 'yesno', required: false, yesLabel: 'Approve', noLabel: 'Decline', unsure: false, followUpWhen: '',
    },
    {
      id: 'c003#001', Category: 'Meetings', QuestionNumber: 1, title: 'How useful was standup?',
      kind: 'rating', required: false, scale: '1-5', lowLabel: 'A waste', highLabel: 'Worth it',
    },
  ],
};

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

function mockApi() {
  const posts = [];
  authFetch.mockImplementation(async (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    if (method === 'POST' && url.includes('upload-questions')) {
      posts.push(JSON.parse(opts.body));
      return jsonResponse(200, { setId: SET.id, setName: SET.name, version: 3, questionCount: 4 });
    }
    if (method === 'GET' && url.includes('/questions')) return jsonResponse(200, QUESTIONS);
    throw new Error(`Unhandled request: ${method} ${url}`);
  });
  return { posts };
}

beforeEach(() => {
  window.API_BASE = 'https://api.test/';
  authFetch.mockReset();
});

afterEach(() => {
  document.body.style.overflow = '';
});

const renderPanel = (props = {}) => render(
  <QuestionsPanel questionSet={SET} availableSets={[SET]} plannedVersion={3}
    onChanged={jest.fn()} onDirtyChange={jest.fn()} {...props} />,
);

const ready = () => screen.findByText('Where do you work best?');
const rowOf = (title) => screen.getByText(title).closest('li');
const dialog = () => screen.getByRole('dialog');

const editQuestion = async (title) => {
  fireEvent.click(within(rowOf(title)).getByRole('button', { name: /edit/i }));
  return screen.findByRole('dialog');
};

const kindGroup = () => within(dialog()).getByRole('group', { name: 'Kind' });
const kindNames = () => within(kindGroup()).getAllByRole('button').map((b) => b.textContent);
const pressedKind = () => within(kindGroup()).getAllByRole('button')
  .filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent);
const answersGroup = () => within(dialog()).getByRole('group', { name: 'The two answers' });
const pressedPreset = () => within(answersGroup()).getAllByRole('button')
  .filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent);

describe('a poll question\'s row', () => {
  test('names its kind — a row from before kinds reads as the kind it always meant — and keeps its category', async () => {
    mockApi();
    renderPanel();
    await ready();

    const legacyChoice = rowOf('Where do you work best?');
    expect(within(legacyChoice).getByText('Multiple choice')).toBeTruthy();
    expect(within(legacyChoice).getByText('Workplace')).toBeTruthy();
    expect(within(rowOf('What should we stop doing?')).getByText('Open answer')).toBeTruthy();
    expect(within(rowOf('Ship on Thursday?')).getByText('Yes / No')).toBeTruthy();
    expect(within(rowOf('How useful was standup?')).getByText('Rating')).toBeTruthy();
    expect(within(rowOf('How useful was standup?')).getByText('Meetings')).toBeTruthy();
  });
});

describe('the poll question form is the survey\'s, limited to four kinds', () => {
  test('the kind bar offers the four poll kinds, choice first, and no Ranking', async () => {
    mockApi();
    renderPanel();
    await ready();
    await editQuestion('Where do you work best?');

    expect(kindNames()).toEqual(['Multiple choice', 'Rating', 'Yes / No', 'Open answer']);
    expect(pressedKind()).toEqual(['Multiple choice']);
    // rejects: a help line promising a Ranking switch the bar does not offer.
    expect(dialog().textContent).not.toMatch(/Ranking/);
    expect(dialog().textContent).toContain('Switching kind asks first when it would throw something away.');
  });

  test('it keeps the poll\'s Category and Title, and draws the question once', async () => {
    mockApi();
    renderPanel();
    await ready();
    await editQuestion('Where do you work best?');

    expect(screen.getByLabelText(/^Category/)).toBeTruthy();
    expect(screen.getByLabelText(/^Title/)).toHaveValue('Where do you work best?');
    // rejects: the survey form's own Question and Detail boxes drawn a second time.
    expect(screen.queryByLabelText('Question')).toBeNull();
    expect(within(dialog()).getAllByLabelText(/^Detail/)).toHaveLength(1);
  });

  test('the options box and the Answers allowed select are gone; a choice lists its options', async () => {
    mockApi();
    renderPanel();
    await ready();
    await editQuestion('Where do you work best?');

    expect(screen.queryByLabelText(/Options \(one per line\)/)).toBeNull();
    expect(screen.queryByLabelText('Answers allowed')).toBeNull();
    expect(screen.getByLabelText('Option A')).toHaveValue('Office');
    expect(screen.getByLabelText('Option C')).toHaveValue('Both');
    expect(within(dialog()).getByRole('button', { name: 'One' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('a row with no options opens as an open answer, never with no kind chosen', async () => {
    mockApi();
    renderPanel();
    await ready();
    await editQuestion('What should we stop doing?');
    expect(pressedKind()).toEqual(['Open answer']);
    expect(screen.getByLabelText('Up to')).toHaveValue(500);
  });

  test('a yes / no names its pair of answers, and a preset fills both labels', async () => {
    mockApi();
    renderPanel();
    await ready();
    await editQuestion('Ship on Thursday?');

    expect(pressedKind()).toEqual(['Yes / No']);
    expect(pressedPreset()).toEqual(['Approve / Decline']);
    expect(screen.getByLabelText('Yes reads')).toHaveValue('Approve');

    fireEvent.click(within(answersGroup()).getByRole('button', { name: 'True / False' }));
    expect(screen.getByLabelText('Yes reads')).toHaveValue('True');
    expect(screen.getByLabelText('No reads')).toHaveValue('False');
    expect(pressedPreset()).toEqual(['True / False']);
  });

  test('a new poll question is a multiple choice, in the category the list is on', async () => {
    mockApi();
    renderPanel();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: /Add a question/ }));
    await screen.findByRole('dialog', { name: /New question/ });

    expect(pressedKind()).toEqual(['Multiple choice']);
    // Seeded as every other type's add is: the category of the last row.
    expect(screen.getByLabelText(/^Category/)).toHaveValue('Meetings');
    expect(screen.getByLabelText('Option A')).toHaveValue('');
    expect(screen.getByLabelText('Option B')).toHaveValue('');
  });

  test('a choice with one option cannot be Done, in the importer\'s words', async () => {
    mockApi();
    renderPanel();
    await ready();
    await editQuestion('Where do you work best?');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Remove option C' }));
    fireEvent.change(screen.getByLabelText('Option B'), { target: { value: '' } });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Done' }));
    expect(dialog().textContent).toContain('needs at least two options');
  });
});

describe('Save posts the contract CSV, each row in its own category', () => {
  const HEADER = 'Category,Question#,Title,Detail_lesson,School,CustomInstruction,'
    + 'Kind,Required,Options,AllowMultiple,MaxPicks,AllowOther,Shuffle,Scale,LowLabel,HighLabel,'
    + 'YesLabel,NoLabel,Unsure,FollowUpWhen,FollowUpPrompt,RankTop,TextLength,MaxLength,Placeholder,Themes,Tags';

  test('an edited poll set is written as typed questions, the legacy rows as the kinds they read as', async () => {
    const { posts } = mockApi();
    renderPanel();
    await ready();

    await editQuestion('Ship on Thursday?');
    fireEvent.click(within(answersGroup()).getByRole('button', { name: 'Agree / Disagree' }));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Done' }));

    fireEvent.click(screen.getAllByRole('button', { name: /Save as version 3/ })[0]);
    await waitFor(() => expect(posts).toHaveLength(1));

    const [post] = posts;
    expect(post.engagementType).toBe('poll');
    expect(post.fileContent.split('\n')).toEqual([
      HEADER,
      '"Workplace",1,"Where do you work best?","","",""'
        + ',"choice","false","Office|Home|Both","false","","false","false","","","","","","false","","","","","","","false",""',
      '"Workplace",2,"What should we stop doing?","","",""'
        + ',"text","false","","false","","false","false","","","","","","false","","","","long","500","","true",""',
      '"Decisions",1,"Ship on Thursday?","","",""'
        + ',"yesno","false","","false","","false","false","","","","Agree","Disagree","false","","","","","","","false",""',
      '"Meetings",1,"How useful was standup?","","",""'
        + ',"rating","false","","false","","false","false","1-5","A waste","Worth it","","","false","","","","","","","false",""',
      '',
    ]);
  });
});
