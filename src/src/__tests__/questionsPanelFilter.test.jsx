import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import QuestionsPanel from '../components/QuestionsPanel';
import { authFetch } from '../auth/authFetch';

/*
 * THE TABLE'S CATEGORY FILTER, AND THE STATE IT MUST NEVER BE LEFT IN.
 *
 * The filter is a select, and the select renders only while the working copy
 * has more than one category. Its value used to outlive it. Filter to Method,
 * move Method's only question to History, and the select was gone while the
 * table went on filtering to Method: no rows, "No questions in that category.",
 * Move up and Move down disabled with "Clear the category filter to reorder" —
 * and nothing on screen that could clear it. An empty state that lied, with no
 * way out of it.
 *
 * The rule held here: the filter is in force only while the select that shows
 * it is on screen AND its category still has rows in the table. Everything the
 * table does with the filter — which rows it lists, whether rows can be moved,
 * what an added question is seeded with — reads that, never the select's last
 * value. A category carried only by removed questions still counts, because the
 * table still lists those questions, struck through, with their Restore.
 *
 * `authFetch` is the only mock — the recipe questionSetEditorQuestions.test.jsx
 * uses — so the real panel loads, edits, discards and saves.
 */
jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));

const SET = {
  id: 'true-crime',
  name: 'True Crime',
  engagementType: 'call-and-answer',
  canManage: true,
};

/** As `GET /question-sets/{setId}/questions` answers: one question in each of two categories. */
const HISTORY_QUESTION = {
  id: 'c001#001', Category: 'History', title: 'Caught by a parking ticket', QuestionNumber: 1,
  questionDetail: 'New York, 1977.', customInstructions: 'Answer for your table.', Tags: ['history'],
};
const METHOD_QUESTION = {
  id: 'c002#001', Category: 'Method', title: 'The Green River case', QuestionNumber: 1,
  questionDetail: 'Solved by DNA in 2001.', customInstructions: 'Answer for your table.', Tags: ['method'],
};

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body),
});

/**
 * The set's questions, and what a Save writes. `afterSave` is what the
 * read-back answers once a Save has gone through — the set as the server now
 * holds it.
 */
function mockApi({ afterSave = null } = {}) {
  let payload = { setId: SET.id, questions: [HISTORY_QUESTION, METHOD_QUESTION] };
  authFetch.mockImplementation(async (url, options = {}) => {
    const method = (options.method || 'GET').toUpperCase();
    if (method === 'GET' && url.includes(`question-sets/${SET.id}/questions`)) return jsonResponse(200, payload);
    if (method === 'POST' && url.includes('admin/upload-questions')) {
      if (afterSave) payload = afterSave;
      return jsonResponse(200, {
        setId: SET.id, setName: SET.name, version: 2, questionCount: payload.questions.length,
      });
    }
    throw new Error(`Unhandled request: ${method} ${url}`);
  });
}

beforeEach(() => {
  window.API_BASE = 'https://api.test/';
  authFetch.mockReset();
});

const renderPanel = () => render(
  <QuestionsPanel questionSet={SET} availableSets={[SET]} plannedVersion={2}
    onChanged={jest.fn()} onDirtyChange={jest.fn()} />
);
async function ready() {
  await screen.findByText('Caught by a parking ticket');
}

const filterSelect = () => screen.queryByLabelText(/Filter by category/);
const filterTo = (name) => fireEvent.change(filterSelect(), { target: { value: name } });
/** The titles the table is listing, top to bottom. */
const tableTitles = () => [...document.querySelectorAll('.qs-question-title strong')].map((n) => n.textContent);
const rowFor = (title) => screen.getByText(title).closest('li');
const views = () => within(screen.getByRole('group', { name: 'How the questions are shown' }));

/**
 * Set the dialog's category the way the picker requires: typing only filters,
 * so an existing category is picked from the list and a new one is created on
 * purpose (questionAddModal.test.jsx's helper).
 */
const chooseCategory = (name) => {
  const box = screen.getByLabelText('Category *');
  fireEvent.click(box);
  fireEvent.change(box, { target: { value: name } });
  const existing = screen.queryByRole('option', { name: new RegExp(`^${name} · `) });
  if (existing) {
    fireEvent.click(existing);
    return;
  }
  fireEvent.click(screen.getByRole('option', { name: /\+ New category/ }));
  fireEvent.change(screen.getByLabelText('New category name'), { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: 'Add category' }));
};

const moveToCategory = (title, category) => {
  fireEvent.click(within(rowFor(title)).getByRole('button', { name: /edit/i }));
  chooseCategory(category);
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
};

describe('a filter whose category has left the working copy', () => {
  test('stops filtering: the table lists every question instead of an empty state it cannot leave', async () => {
    // rejects: the table reading the select's last value after the select has
    // gone. The owner's report, step for step.
    mockApi();
    renderPanel();
    await ready();
    filterTo('Method');
    expect(tableTitles()).toEqual(['The Green River case']);

    moveToCategory('The Green River case', 'History');

    expect(filterSelect()).toBeNull(); // one category left, so no select — as before
    expect(screen.queryByText(/no questions/i)).toBeNull();
    expect(tableTitles()).toEqual(['Caught by a parking ticket', 'The Green River case']);
  });

  test('seeds an added question from the last row, not from the category that left', async () => {
    // rejects: Add seeding "Method" — a category the set no longer has, read
    // from a filter nobody can see.
    mockApi();
    renderPanel();
    await ready();
    filterTo('Method');
    moveToCategory('The Green River case', 'History');

    fireEvent.click(screen.getByRole('button', { name: /Add a question/i }));
    expect(screen.getByLabelText('Category *')).toHaveValue('History');
  });

  test('does not come back on its own when the category does', async () => {
    // rejects: a filter that only stopped being READ. Moving the question back
    // into Method would bring the select back already on Method and the table
    // filtered to it: a filter nobody chose, a moment after the table showed
    // every question.
    mockApi();
    renderPanel();
    await ready();
    filterTo('Method');
    moveToCategory('The Green River case', 'History');
    moveToCategory('The Green River case', 'Method');

    expect(filterSelect()).toHaveValue('');
    expect(tableTitles()).toEqual(['Caught by a parking ticket', 'The Green River case']);
  });

  test('stops when a discard takes the category away, and the table agrees with the select still on screen', async () => {
    // rejects: the same stale value where the select SURVIVES. Two categories
    // are left, so the select stays — and with no option for "Motive" it shows
    // "All categories" while the table filtered to Motive and said "No
    // questions in that category.". Choosing "All categories" there is choosing
    // what is already chosen, which changes nothing.
    mockApi();
    renderPanel();
    await ready();
    fireEvent.click(screen.getByRole('button', { name: /Add a question/i }));
    chooseCategory('Motive');
    fireEvent.change(screen.getByLabelText('Title *'), { target: { value: 'Who wrote the note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    filterTo('Motive');
    expect(tableTitles()).toEqual(['Who wrote the note']);

    fireEvent.click(within(screen.getByTestId('unsaved-bar')).getByRole('button', { name: 'Discard changes' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Discard changes' }));

    expect(filterSelect()).toHaveValue('');
    expect(screen.queryByText(/no questions/i)).toBeNull();
    expect(tableTitles()).toEqual(['Caught by a parking ticket', 'The Green River case']);
  });

  test('stops once a Save has taken away the removed question that kept it', async () => {
    // rejects: the filter outliving the tombstone that kept its category. Until
    // Save the removed question is listed with its Restore (the next describe);
    // after it the set comes back without Method at all.
    mockApi({ afterSave: { setId: SET.id, questions: [HISTORY_QUESTION] } });
    renderPanel();
    await ready();
    filterTo('Method');
    fireEvent.click(screen.getByRole('button', { name: 'Remove The Green River case' }));

    fireEvent.click(within(screen.getByTestId('unsaved-bar')).getByRole('button', { name: /Save as version 2/ }));
    await screen.findByText(/is now live/);

    expect(screen.queryByText(/no questions/i)).toBeNull();
    expect(tableTitles()).toEqual(['Caught by a parking ticket']);
  });
});

describe('a filter on the only category left', () => {
  test('stops too, because the select that would clear it has gone', async () => {
    // rejects: a rule that only asks whether the category still exists. Here it
    // does — it is the only one — so every question is listed, but the select
    // is gone and Move up/down still asked for a filter to be cleared that
    // nothing on screen could clear. Reached through Preview, whose Edit
    // changes a question the filtered table was hiding.
    mockApi();
    renderPanel();
    await ready();
    filterTo('History');
    expect(tableTitles()).toEqual(['Caught by a parking ticket']);

    fireEvent.click(views().getByRole('button', { name: 'Preview' }));
    fireEvent.click(screen.getByRole('option', { name: /The Green River case/ }));
    fireEvent.click(screen.getByRole('button', { name: /Edit this question/ }));
    chooseCategory('History');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    fireEvent.click(views().getByRole('button', { name: 'Table' }));

    expect(filterSelect()).toBeNull();
    const down = screen.getByRole('button', { name: 'Move Caught by a parking ticket down' });
    expect(down).toBeEnabled();
    expect(down).toHaveAttribute('title', 'Move down');
  });
});

describe('a category that only removed questions carry', () => {
  test('still filters, so Remove then Restore leaves the filtered table as it was', async () => {
    // rejects: counting only live questions. The table lists a removed
    // question, struck through, with its Restore, until Save — so a category
    // held only by removed questions still has rows to show, and dropping the
    // filter on Remove would pull the view out from under the person who is
    // looking at the question they just removed.
    mockApi();
    renderPanel();
    await ready();
    filterTo('Method');

    fireEvent.click(screen.getByRole('button', { name: 'Remove The Green River case' }));
    expect(filterSelect()).toHaveValue('Method');
    expect(tableTitles()).toEqual(['The Green River case']);

    fireEvent.click(within(rowFor('The Green River case')).getByRole('button', { name: /Restore/ }));
    expect(filterSelect()).toHaveValue('Method');
    expect(tableTitles()).toEqual(['The Green River case']);
  });
});
