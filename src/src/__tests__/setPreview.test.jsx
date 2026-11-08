/**
 * THE SET PREVIEW IN CREATE ENGAGEMENT (owner, 7 Nov 2026: "add the set
 * preview to the new engagement dialog"). components/SetPreview.jsx, opened
 * from components/SetChooser.jsx's Preview buttons and layered over
 * components/GameSetupDialog.jsx as its afterContent sibling.
 * Behaviour only — jsdom has no layout engine.
 */
import React from 'react';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import GameSetupDialog from '../components/GameSetupDialog';
import { authFetch } from '../auth/authFetch';
import { chosenSet } from '../testUtils/setChooser';
import { setRefKey } from '../utils/setRef';
import { groupByCategory, previewPath, previewFailure, previewQuestion } from '../config/setPreview';

jest.mock('../auth/authFetch', () => ({
  __esModule: true,
  authFetch: jest.fn(),
}));

const QUESTIONS = {
  space: [
    { id: 'q1', title: 'Largest planet', questionDetail: 'Which is the largest planet?', category: 'Planets', optionA: 'Mars', optionB: 'Jupiter', optionC: 'Venus', correctAnswer: 'OptionB' },
    { id: 'q2', title: 'Red planet', category: 'Planets', optionA: 'Mars', optionB: 'Saturn', correctAnswer: 'A' },
    { id: 'q3', title: 'First moonwalk', category: 'Missions', optionA: '1969', optionB: '1972', correctAnswer: '1969' },
  ],
};

const SETS = [
  { id: 'space', scope: 'platform', name: 'Space Trivia', description: 'Planets and missions', totalQuestions: 3, engagementType: 'trivia', topic: '', tags: ['space', 'science'] },
  { id: 'bluff', scope: 'org', name: 'Bluff Facts', totalQuestions: 4, engagementType: 'trivia', bluffRound: true },
  { id: 'broken', scope: 'org', name: null, totalQuestions: 2, engagementType: 'trivia', decryptFailed: true },
];

const base = (over = {}) => ({
  isFirstEngagement: true,
  eventTitle: 'Friday quiz',
  onEventTitleChange: jest.fn(),
  questionSets: SETS,
  personas: [],
  categories: [],
  activeCategoryIds: new Set(),
  onToggleCategory: jest.fn(),
  onQuestionSetChange: jest.fn(),
  onCancel: jest.fn(),
  onCreate: jest.fn(),
  initialFormat: 'trivia',
  ...over,
});

beforeEach(() => {
  authFetch.mockReset();
  authFetch.mockImplementation(async (url) => {
    const id = decodeURIComponent(String(url).match(/question-sets\/([^/]+)\/questions/)[1]);
    return { ok: true, status: 200, json: async () => ({ questions: QUESTIONS[id] || [] }) };
  });
});

/* The dialog focuses its title a tick after it mounts; let that land first. */
const browseAll = async () => {
  await waitFor(() => expect(document.activeElement && document.activeElement.id).toBe('gsd-title'));
  fireEvent.click(screen.getByRole('button', { name: /^Browse all/ }));
};
const preview = () => screen.queryByTestId('set-preview');
const pressPreview = (name) => {
  const button = screen.getByRole('button', { name: `Preview ${name}` });
  button.focus();
  fireEvent.click(button);
  return button;
};

describe('opening the preview', () => {
  test('from a row of the table: the set, its questions by category, the right option marked; no pick', async () => {
    render(<GameSetupDialog {...base()} />);
    await browseAll();
    pressPreview('Space Trivia');
    const panel = await screen.findByRole('dialog', { name: 'Space Trivia' });
    expect(within(panel).getByText('Preview')).toBeInTheDocument();
    expect(within(panel).getByText(/Trivia · 3 questions · Ready-made/)).toBeInTheDocument();
    expect(within(panel).getByText('Planets and missions')).toBeInTheDocument();
    expect(within(panel).getByText('science')).toBeInTheDocument();
    expect(await within(panel).findByText('Largest planet')).toBeInTheDocument();
    expect(within(panel).getByRole('heading', { name: /Planets/ })).toBeInTheDocument();
    expect(within(panel).getByRole('heading', { name: /Missions/ })).toBeInTheDocument();
    const jupiter = within(panel).getByText('Jupiter').closest('li');
    expect(jupiter).toHaveClass('is-correct');
    expect(within(jupiter).getByText(/Correct/)).toBeInTheDocument();
    expect(within(panel).getByText('Venus').closest('li')).not.toHaveClass('is-correct');
    // The read the host already may make, naming the library.
    expect(authFetch).toHaveBeenCalledWith(expect.stringMatching(/question-sets\/space\/questions\?scope=platform$/));
    // A look is not a choice.
    expect(chosenSet()).toBe('');
    // Focus is in the panel, on its heading.
    expect(document.activeElement).toBe(within(panel).getByRole('heading', { name: 'Space Trivia' }));
  });

  test('a bluff-round set says so in the header', async () => {
    render(<GameSetupDialog {...base()} />);
    await browseAll();
    pressPreview('Bluff Facts');
    const panel = await screen.findByRole('dialog', { name: 'Bluff Facts' });
    expect(within(panel).getByText('Preview · Bluff round set')).toBeInTheDocument();
  });

  test('from the picked line: ✓ name · questions · Change · Preview', async () => {
    render(<GameSetupDialog {...base()} />);
    await browseAll();
    fireEvent.click(document.querySelector(`[data-set-key="${setRefKey(SETS[0])}"]`));
    const line = screen.getByRole('group', { name: 'Question set' });
    expect(within(line).getByRole('button', { name: 'Change' })).toBeInTheDocument();
    pressPreview('Space Trivia');
    expect(await screen.findByRole('dialog', { name: 'Space Trivia' })).toBeInTheDocument();
  });

  test('an unreadable set has no Preview', async () => {
    render(<GameSetupDialog {...base()} />);
    await browseAll();
    expect(screen.queryByRole('button', { name: /^Preview .*unreadable/ })).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Preview / })).toHaveLength(2);
  });

  test('a failed read is said plainly, with Try again', async () => {
    authFetch.mockImplementationOnce(async () => ({ ok: false, status: 404, json: async () => ({}) }));
    render(<GameSetupDialog {...base()} />);
    await browseAll();
    pressPreview('Space Trivia');
    const panel = await screen.findByRole('dialog', { name: 'Space Trivia' });
    expect(await within(panel).findByRole('alert')).toHaveTextContent('not in a library you can read');
    fireEvent.click(within(panel).getByRole('button', { name: 'Try again' }));
    expect(await within(panel).findByText('Largest planet')).toBeInTheDocument();
  });
});

describe('leaving the preview', () => {
  test('Use this set chooses it by the row path, closes the panel and folds the chooser', async () => {
    const onQuestionSetChange = jest.fn();
    render(<GameSetupDialog {...base({ onQuestionSetChange })} />);
    await browseAll();
    pressPreview('Space Trivia');
    const panel = await screen.findByRole('dialog', { name: 'Space Trivia' });
    fireEvent.click(within(panel).getByRole('button', { name: 'Use this set' }));
    await waitFor(() => expect(preview()).toBeNull());
    expect(chosenSet()).toBe(setRefKey(SETS[0]));
    expect(onQuestionSetChange).toHaveBeenLastCalledWith('space', 'platform');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Change' })));
  });

  test.each([
    ['Back', () => fireEvent.click(within(screen.getByTestId('set-preview').closest('[role="dialog"]')).getByRole('button', { name: 'Back' }))],
    ['the X', () => fireEvent.click(screen.getByRole('button', { name: 'Back to Create engagement' }))],
    ['Esc', () => fireEvent.keyDown(document, { key: 'Escape' })],
  ])('%s closes it, keeps the form and returns focus to the Preview button', async (_, leave) => {
    const onCancel = jest.fn();
    render(<GameSetupDialog {...base({ onCancel })} />);
    await browseAll();
    const opener = pressPreview('Space Trivia');
    await screen.findByRole('dialog', { name: 'Space Trivia' });
    leave();
    await waitFor(() => expect(preview()).toBeNull());
    // The create dialog is still there, its list still open, nothing picked or discarded.
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: /engagement/i })).toBeInTheDocument();
    expect(chosenSet()).toBe('');
    expect(screen.getByText('Friday quiz')).toBeInTheDocument();
    expect(document.activeElement).toBe(opener);
  });
});

describe('the rules (config/setPreview.js)', () => {
  test('the path names the library', () => {
    expect(previewPath({ id: 'a b', scope: 'org' })).toBe('question-sets/a%20b/questions?scope=org');
    expect(previewPath({ id: 'x' })).toBe('question-sets/x/questions');
  });

  test('a 404 never reads as deleted', () => {
    expect(previewFailure(404)).not.toMatch(/delet/i);
    expect(previewFailure(0)).toMatch(/connection/);
  });

  test('a survey is one group; a poll question carries its kind and options', () => {
    const groups = groupByCategory([{ category: 'Survey', title: 'a', kind: 'rating', scale: '1-5' }, { category: 'Survey', title: 'b', kind: 'text' }], 'survey');
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe('');
    const poll = previewQuestion({ title: 'Day?', options: ['Mon', 'Fri'] }, 'poll');
    expect(poll.kind).toBe('Multiple choice');
    expect(poll.options.map((o) => o.text)).toEqual(['Mon', 'Fri']);
    const yes = previewQuestion({ title: 'Ok?', kind: 'yesno', yesLabel: 'Approve', noLabel: 'Decline' }, 'poll');
    expect(yes.options.map((o) => o.text)).toEqual(['Approve', 'Decline']);
  });

  test('a call & answer question keeps its image', () => {
    const q = previewQuestion({ title: 'Art', image: 'sets/art/one.jpg' }, 'call-and-answer');
    expect(q.image).toBe('sets/art/one.jpg');
    expect(q.options).toEqual([]);
  });
});
