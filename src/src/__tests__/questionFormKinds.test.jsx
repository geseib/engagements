import React from 'react';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import QuestionsPanel from '../components/QuestionsPanel';
import { authFetch } from '../auth/authFetch';

/*
 * A SURVEY SET IN THE QUESTIONS PANEL — Track B2 of
 * docs/design/survey-redesign/IMPLEMENTATION-phase-0-1.md, drawn in mockups
 * 04-editor.html (the rows and the Add menu), 05-edit-question.html (the
 * question form, a rating selected) and 06-kind-fields.html (the other four
 * kinds' fields).
 *
 * What is under test is what a person can do and what reaches the wire:
 *   - each row names its kind, previews its answer, and says Required or not;
 *   - Add question is a menu of the five kinds, keyboard and all, and the kind
 *     chosen there is the kind the new question is;
 *   - the form shows the chosen kind's fields and no Category;
 *   - switching kind never throws anything away without asking first — except
 *     Choice ↔ Ranking, which share their list and so ask nothing;
 *   - Save posts the contract CSV.
 *
 * The expected CSV is TYPED OUT from the contract, never built with rowsToCsv:
 * a Save checked against the serialiser it calls agrees with itself on every
 * day it is wrong.
 *
 * NO GEOMETRY. jsdom has no layout engine; nothing here asserts a position,
 * a width or a colour (surveyQuestionFieldsPalette.test.js reads the sheet).
 */
jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));

const SET = {
  id: 'offsite-feedback',
  name: 'Offsite feedback',
  engagementType: 'survey',
  totalQuestions: 5,
  categoryCount: 1,
  activeVersion: 2,
  canManage: true,
};

/* Five stored questions, one of each kind, shaped as the questions endpoint
   passes survey attributes through: lower-case, only the kind's own fields. */
const QUESTIONS = {
  setId: SET.id,
  questions: [
    {
      id: 'c001#001', Category: 'Survey', QuestionNumber: 1, title: 'How useful was the session?',
      kind: 'rating', required: true, scale: '1-5', lowLabel: 'Not useful', highLabel: 'Very useful',
    },
    {
      id: 'c001#002', Category: 'Survey', QuestionNumber: 2, title: 'Which part was most valuable?',
      kind: 'choice', required: false, options: ['The demo', 'The case studies', 'The Q&A'],
      allowMultiple: false, allowOther: true, shuffle: false,
    },
    {
      id: 'c001#003', Category: 'Survey', QuestionNumber: 3, title: 'Was the length about right?',
      kind: 'yesno', required: true, yesLabel: '', noLabel: '', unsure: true,
      followUpWhen: 'no', followUpPrompt: 'What would you cut or add?',
    },
    {
      id: 'c001#004', Category: 'Survey', QuestionNumber: 4, title: 'Rank these topics',
      kind: 'rank', required: false, options: ['Customers', 'Roadmap', 'Team wins', 'Hiring'], rankTop: 3,
    },
    {
      id: 'c001#005', Category: 'Survey', QuestionNumber: 5, title: 'What was the best part?',
      kind: 'text', required: false, textLength: 'long', maxLength: 500, placeholder: '', themes: true,
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
      return jsonResponse(200, { setId: SET.id, setName: SET.name, version: 3, questionCount: 5 });
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

const ready = () => screen.findByText('How useful was the session?');
const rowOf = (title) => screen.getByText(title).closest('li');
const dialog = () => screen.getByRole('dialog');

const editQuestion = async (title) => {
  fireEvent.click(within(rowOf(title)).getByRole('button', { name: /edit/i }));
  return screen.findByRole('dialog');
};

const kindGroup = () => within(dialog()).getByRole('group', { name: 'Kind' });
const kindButton = (name) => within(kindGroup()).getByRole('button', { name });
const pressedKind = () => within(kindGroup()).getAllByRole('button')
  .filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent);

/* ------------------------------------------------------------------ rows -- */

describe('a survey question\'s row', () => {
  test('names its kind with an icon and a word, previews its answer, and says Required or Optional', async () => {
    mockApi();
    renderPanel();
    await ready();

    const rating = rowOf('How useful was the session?');
    expect(within(rating).getByText('Rating')).toBeTruthy();
    expect(rating.textContent).toContain('1–5 · Not useful → Very useful');
    expect(within(rating).getByText('Required')).toBeTruthy();

    const choice = rowOf('Which part was most valuable?');
    expect(within(choice).getByText('Multiple choice')).toBeTruthy();
    expect(choice.textContent).toContain('3 options · pick one · + write-in');
    expect(within(choice).getByText('Optional')).toBeTruthy();

    expect(rowOf('Was the length about right?').textContent).toContain('Yes / No / Not sure · asks why on No');
    expect(rowOf('Rank these topics').textContent).toContain('4 items · top 3 is enough');
    expect(rowOf('What was the best part?').textContent).toContain('Long answer · up to 500 characters');
    expect(within(rowOf('What was the best part?')).getByText('Open answer')).toBeTruthy();
  });

  test('shows no category — surveys expose none', async () => {
    // rejects: the trivia/poll meta line, which would print "Survey" on every
    // row, and the category filter.
    mockApi();
    renderPanel();
    await ready();
    expect(within(rowOf('How useful was the session?')).queryByText('Survey')).toBeNull();
    expect(screen.queryByText(/Filter by category/)).toBeNull();
  });

  test('moves up and down as every row does', async () => {
    mockApi();
    renderPanel();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Move Rank these topics up' }));
    const titles = [...document.querySelectorAll('.qs-question-list .qs-question-title strong')].map((n) => n.textContent);
    expect(titles.slice(2, 4)).toEqual(['Rank these topics', 'Was the length about right?']);
  });
});

/* -------------------------------------------------------------- Add menu -- */

describe('Add question is a menu of the five kinds', () => {
  const trigger = () => screen.getByRole('button', { name: 'Add question' });

  test('it lists the five kinds, each with its sentence, and "From another set"', async () => {
    mockApi();
    renderPanel();
    await ready();
    expect(screen.queryByRole('button', { name: /Add a question/ })).toBeNull();
    expect(trigger()).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger());
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem');
    expect(items.map((i) => i.querySelector('b').textContent))
      .toEqual(['Rating', 'Multiple choice', 'Yes / No', 'Ranking', 'Open answer', 'From another set']);
    expect(items[0].textContent).toContain('A scale: 1–5, 1–10, 0–10 (a recommend score) or stars.');
  });

  test('the keyboard drives it: focus lands on the first kind, ↓ ↑ move, Enter picks', async () => {
    mockApi();
    renderPanel();
    await ready();
    fireEvent.click(trigger());
    const menu = screen.getByRole('menu');
    const items = within(menu).getAllByRole('menuitem');
    await waitFor(() => expect(document.activeElement).toBe(items[0]));

    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[2]);
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[items.length - 1]);  // wraps
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[2]);

    fireEvent.keyDown(menu, { key: 'Enter' });
    expect(screen.queryByRole('menu')).toBeNull();
    await screen.findByRole('dialog', { name: /New question/ });
    expect(pressedKind()).toEqual(['Yes / No']);
    expect(screen.getByLabelText('Yes reads')).toHaveValue('');
  });

  test('Escape closes it and hands focus back to the button', async () => {
    mockApi();
    renderPanel();
    await ready();
    fireEvent.click(trigger());
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  test('the kind chosen is the kind added, with that kind\'s defaults', async () => {
    mockApi();
    renderPanel();
    await ready();
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('menuitem', { name: /^Rating/ }));
    await screen.findByRole('dialog', { name: /New question/ });

    expect(pressedKind()).toEqual(['Rating']);
    expect(within(dialog()).getByRole('button', { name: '1–5' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('checkbox', { name: /Needs an answer/ })).not.toBeChecked();

    fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'Would you come back?' } });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    const added = rowOf('Would you come back?');
    expect(within(added).getByText('Rating')).toBeTruthy();
    expect(added.textContent).toContain('1–5');
    expect(within(added).getByText('Optional')).toBeTruthy();
    expect(within(added).getByText('Added')).toBeTruthy();
  });

  test('"From another set" opens the pull dialog the panel already has', async () => {
    mockApi();
    renderPanel();
    await ready();
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('menuitem', { name: /From another set/ }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

/* ------------------------------------------------------------ the form -- */

describe('the question form shows the kind\'s fields', () => {
  test('rating: the four scales, the two end labels, and no Category', async () => {
    mockApi();
    renderPanel();
    await ready();
    await editQuestion('How useful was the session?');

    expect(pressedKind()).toEqual(['Rating']);
    expect(screen.getByLabelText('Question')).toHaveValue('How useful was the session?');
    expect(screen.getByLabelText(/^Detail/)).toHaveValue('');
    ['1–5', '1–10', '0–10 recommend score', 'Stars'].forEach((name) => {
      expect(within(dialog()).getByRole('button', { name })).toBeTruthy();
    });
    expect(screen.getByLabelText('Label under 1')).toHaveValue('Not useful');
    expect(screen.getByLabelText('Label under 5')).toHaveValue('Very useful');
    expect(screen.getByRole('checkbox', { name: /Needs an answer/ })).toBeChecked();
    expect(screen.queryByLabelText(/Category/)).toBeNull();

    // The labels follow the scale's ends.
    fireEvent.click(within(dialog()).getByRole('button', { name: '0–10 recommend score' }));
    expect(screen.getByLabelText('Label under 0')).toHaveValue('Not useful');
    expect(screen.getByLabelText('Label under 10')).toHaveValue('Very useful');
  });

  test('multiple choice: the option list, one or several with a limit, write-in and shuffle', async () => {
    mockApi();
    renderPanel();
    await ready();
    await editQuestion('Which part was most valuable?');

    expect(pressedKind()).toEqual(['Multiple choice']);
    expect(screen.getByLabelText('Option A')).toHaveValue('The demo');
    expect(screen.getByLabelText('Option C')).toHaveValue('The Q&A');
    expect(within(dialog()).getByRole('button', { name: 'One' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('up to')).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: /Something else/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Shuffle/ })).not.toBeChecked();

    fireEvent.click(within(dialog()).getByRole('button', { name: 'Add an option' }));
    expect(screen.getByLabelText('Option D')).toHaveValue('');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Several' }));
    expect(screen.getByLabelText('up to')).not.toBeDisabled();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Remove option D' }));
    expect(screen.queryByLabelText('Option D')).toBeNull();
  });

  test('yes / no: the two labels, Not sure, and the follow-up only while Ask why is on', async () => {
    mockApi();
    renderPanel();
    await ready();
    await editQuestion('Was the length about right?');

    expect(pressedKind()).toEqual(['Yes / No']);
    expect(screen.getByLabelText('Yes reads')).toHaveAttribute('placeholder', 'Yes');
    expect(screen.getByLabelText('No reads')).toHaveAttribute('placeholder', 'No');
    expect(screen.getByRole('checkbox', { name: /Offer ‘Not sure’/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Ask why/ })).toBeChecked();
    expect(screen.getByLabelText('When they say')).toHaveValue('no');
    expect(screen.getByLabelText('Ask')).toHaveValue('What would you cut or add?');

    fireEvent.click(screen.getByRole('checkbox', { name: /Ask why/ }));
    expect(screen.queryByLabelText('When they say')).toBeNull();
  });

  test('ranking: the items, and all of them or just the top N', async () => {
    mockApi();
    renderPanel();
    await ready();
    await editQuestion('Rank these topics');

    expect(pressedKind()).toEqual(['Ranking']);
    expect(screen.getByLabelText('Item 1')).toHaveValue('Customers');
    expect(screen.getByLabelText('Item 4')).toHaveValue('Hiring');
    expect(within(dialog()).getByRole('button', { name: 'Just the top' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Top how many')).toHaveValue(3);

    fireEvent.click(within(dialog()).getByRole('button', { name: 'All of them' }));
    expect(screen.getByLabelText('Top how many')).toBeDisabled();
  });

  test('open answer: short or long, the limit, a placeholder, and themes', async () => {
    mockApi();
    renderPanel();
    await ready();
    await editQuestion('What was the best part?');

    expect(pressedKind()).toEqual(['Open answer']);
    expect(within(dialog()).getByRole('button', { name: 'Long — a paragraph' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Up to')).toHaveValue(500);
    expect(screen.getByLabelText(/^Placeholder/)).toHaveValue('');
    expect(screen.getByRole('checkbox', { name: /group the answers into themes/ })).toBeChecked();

    // A limit still at the long default follows the length to the short one.
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Short — a line' }));
    expect(screen.getByLabelText('Up to')).toHaveValue(280);
  });

  test('the phone preview is not drawn yet — its slot is empty in Phase 1', async () => {
    mockApi();
    renderPanel();
    await ready();
    await editQuestion('How useful was the session?');
    expect(within(dialog()).queryByText('On a phone')).toBeNull();
    expect(dialog().querySelector('iframe')).toBeNull();
  });
});

/* ------------------------------------------------------ switching kinds -- */

describe('switching a question\'s kind', () => {
  test('choice → ranking keeps the list and asks nothing', async () => {
    mockApi();
    renderPanel();
    await ready();
    await editQuestion('Which part was most valuable?');
    // This one has a write-in box, which a ranking cannot keep — that alone
    // would (rightly) be asked about. With it off, only the list is left, and
    // the list travels.
    fireEvent.click(screen.getByRole('checkbox', { name: /Something else/ }));

    fireEvent.click(kindButton('Ranking'));
    expect(within(dialog()).queryByRole('alert')).toBeNull();
    expect(pressedKind()).toEqual(['Ranking']);
    expect(screen.getByLabelText('Item 1')).toHaveValue('The demo');
    expect(screen.getByLabelText('Item 2')).toHaveValue('The case studies');
    expect(screen.getByLabelText('Item 3')).toHaveValue('The Q&A');
  });

  test('choice → ranking with a write-in asks, naming only the write-in — never the list', async () => {
    mockApi();
    renderPanel();
    await ready();
    await editQuestion('Which part was most valuable?');
    fireEvent.click(kindButton('Ranking'));
    const ask = within(dialog()).getByRole('alert');
    expect(ask.textContent).toContain('the write-in box');
    expect(ask.textContent).not.toMatch(/options/);
  });

  test('rating → open answer asks first, naming what would go, and Keep leaves it alone', async () => {
    mockApi();
    renderPanel();
    await ready();
    await editQuestion('How useful was the session?');

    fireEvent.click(kindButton('Open answer'));
    const ask = within(dialog()).getByRole('alert');
    expect(ask.textContent).toContain('Not useful');
    expect(ask.textContent).toContain('Very useful');
    expect(pressedKind()).toEqual(['Rating']);             // nothing switched yet

    fireEvent.click(within(ask).getByRole('button', { name: /Keep/ }));
    expect(within(dialog()).queryByRole('alert')).toBeNull();
    expect(pressedKind()).toEqual(['Rating']);
    expect(screen.getByLabelText('Label under 1')).toHaveValue('Not useful');
  });

  test('confirming the switch makes it an open answer and drops the scale\'s labels', async () => {
    mockApi();
    renderPanel();
    await ready();
    await editQuestion('How useful was the session?');

    fireEvent.click(kindButton('Open answer'));
    fireEvent.click(within(within(dialog()).getByRole('alert')).getByRole('button', { name: /Switch/ }));
    expect(pressedKind()).toEqual(['Open answer']);
    expect(screen.queryByLabelText('Label under 1')).toBeNull();
    expect(screen.getByLabelText('Up to')).toHaveValue(500);
    // Title and Needs-an-answer ride along.
    expect(screen.getByLabelText('Question')).toHaveValue('How useful was the session?');
    expect(screen.getByRole('checkbox', { name: /Needs an answer/ })).toBeChecked();
  });

  test('a default rating with nothing filled switches without asking', async () => {
    mockApi();
    renderPanel();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Add question' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /^Rating/ }));
    await screen.findByRole('dialog');
    fireEvent.click(kindButton('Multiple choice'));
    expect(within(dialog()).queryByRole('alert')).toBeNull();
    expect(pressedKind()).toEqual(['Multiple choice']);
  });
});

/* ------------------------------------------------------------------ Save -- */

describe('Save posts the contract CSV', () => {
  const HEADER = 'Category,Question#,Title,Detail_lesson,School,CustomInstruction,'
    + 'Kind,Required,Options,AllowMultiple,MaxPicks,AllowOther,Shuffle,Scale,LowLabel,HighLabel,'
    + 'YesLabel,NoLabel,Unsure,FollowUpWhen,FollowUpPrompt,RankTop,TextLength,MaxLength,Placeholder,Themes,Tags';

  test('an edited survey set is written as the survey branch of the contract, one version', async () => {
    const { posts } = mockApi();
    renderPanel();
    await ready();

    // One edit: the ranking question becomes required.
    await editQuestion('Rank these topics');
    fireEvent.click(screen.getByRole('checkbox', { name: /Needs an answer/ }));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Done' }));

    fireEvent.click(screen.getAllByRole('button', { name: /Save as version 3/ })[0]);
    await waitFor(() => expect(posts).toHaveLength(1));

    const [post] = posts;
    expect(post.replaceSetId).toBe(SET.id);
    expect(post.engagementType).toBe('survey');
    expect(post.fileContent.split('\n')).toEqual([
      HEADER,
      '"Survey",1,"How useful was the session?","","",""'
        + ',"rating","true","","false","","false","false","1-5","Not useful","Very useful","","","false","","","","","","","false",""',
      '"Survey",2,"Which part was most valuable?","","",""'
        + ',"choice","false","The demo|The case studies|The Q&A","false","","true","false","","","","","","false","","","","","","","false",""',
      '"Survey",3,"Was the length about right?","","",""'
        + ',"yesno","true","","false","","false","false","","","","","","true","no","What would you cut or add?","","","","","false",""',
      '"Survey",4,"Rank these topics","","",""'
        + ',"rank","true","Customers|Roadmap|Team wins|Hiring","false","","false","false","","","","","","false","","","3","","","","false",""',
      '"Survey",5,"What was the best part?","","",""'
        + ',"text","false","","false","","false","false","","","","","","false","","","","long","500","","true",""',
      '',
    ]);
  });

  test('a new question from the Add menu is saved with its kind, filed under Survey', async () => {
    const { posts } = mockApi();
    renderPanel();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Add question' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /^Multiple choice/ }));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'Pick a date' } });
    fireEvent.change(screen.getByLabelText('Option A'), { target: { value: 'Tuesday' } });
    fireEvent.change(screen.getByLabelText('Option B'), { target: { value: 'Thursday' } });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Done' }));

    fireEvent.click(screen.getAllByRole('button', { name: /Save as version 3/ })[0]);
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].fileContent.split('\n')[6]).toBe('"Survey",6,"Pick a date","","",""'
      + ',"choice","false","Tuesday|Thursday","false","","false","false","","","","","","false","","","","","","","false",""');
  });

  test('Done refuses a question the importer would skip, in the importer\'s words', async () => {
    mockApi();
    renderPanel();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Add question' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /^Ranking/ }));
    await screen.findByRole('dialog');
    fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'Order these' } });
    fireEvent.change(screen.getByLabelText('Item 1'), { target: { value: 'One' } });
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Done' }));
    expect(dialog().textContent).toContain('needs at least three items');
  });
});

/* ------------------------------------------------------ other set types -- */

describe('a trivia set is untouched', () => {
  test('it keeps Add a question, the Category field and no kind bar', async () => {
    const TRIVIA = { ...SET, id: '80s', name: '80s', engagementType: 'trivia' };
    authFetch.mockImplementation(async (url) => {
      if (url.includes('/questions')) {
        return jsonResponse(200, { questions: [{ id: 'c001#001', Category: 'Music', title: 'WHO SANG THIS', correctAnswer: 'OptionA', optionA: 'A', optionB: 'B' }] });
      }
      throw new Error(`Unhandled ${url}`);
    });
    renderPanel({ questionSet: TRIVIA, availableSets: [TRIVIA] });
    await screen.findByText('WHO SANG THIS');
    expect(screen.queryByRole('button', { name: 'Add question' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Add a question/ }));
    await screen.findByRole('dialog');
    expect(screen.getByLabelText('Category *')).toBeTruthy();
    expect(within(dialog()).queryByRole('group', { name: 'Kind' })).toBeNull();
  });
});
