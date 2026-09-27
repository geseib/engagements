/**
 * THE GOAL IN THE CREATE AND EDIT DIALOG — components/GameSetupDialog.jsx and
 * the Goal field of components/SessionOptions.jsx (events M1b, Task 4).
 *
 * The owner: "even though the set contains 50 question they might have a goal
 * of 5 questions".
 *
 * rejects: a goal the chosen set cannot meet reaching onCreate; a goal offered
 * on a survey, or sent for one; a blank goal treated as an error; an edit that
 * forgets the session's goal, or cannot clear it; the Advanced line hiding a
 * goal the host set.
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import GameSetupDialog from '../components/GameSetupDialog';

jest.mock('../auth/authFetch', () => ({
  __esModule: true,
  authFetch: jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ prompts: [] }) })),
}));

const SETS = [
  { id: 'space', name: 'Space Trivia', totalQuestions: 12, engagementType: 'trivia', hasImages: false },
  { id: 'pulse', name: 'Kickoff pulse', totalQuestions: 5, engagementType: 'survey', hasImages: false },
];
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));
const setup = (overrides = {}) => {
  const props = {
    isFirstEngagement: true,
    eventTitle: 'Q3 Offsite',
    onEventTitleChange: jest.fn(),
    questionSets: SETS,
    personas: [],
    categories: [],
    activeCategoryIds: new Set(),
    onToggleCategory: jest.fn(),
    onQuestionSetChange: jest.fn(),
    onCancel: jest.fn(),
    onCreate: jest.fn(),
    ...overrides,
  };
  render(<GameSetupDialog {...props} />);
  return props;
};
const pickTrivia = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Trivia' }));
  fireEvent.change(screen.getByLabelText(/question set/i), { target: { value: 'platform:space' } });
};
const create = () => screen.getByRole('button', { name: 'Create engagement' });

describe('a goal at create', () => {
  test('a goal within the set travels in the payload, and the field says the set\'s size', async () => {
    const props = setup();
    await settle();
    pickTrivia();
    expect(screen.getByText('of 12 questions')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Goal'), { target: { value: '5' } });
    fireEvent.click(create());
    expect(props.onCreate).toHaveBeenCalledWith(expect.objectContaining({ gameType: 'trivia', target: 5 }));
  });

  test('blank is no goal, and is not an error', async () => {
    const props = setup();
    await settle();
    pickTrivia();
    expect(create()).toBeEnabled();
    fireEvent.click(create());
    expect(props.onCreate).toHaveBeenCalledWith(expect.objectContaining({ target: null }));
  });

  // rejects: a goal the set cannot meet reaching the server as a surprise 400.
  // Said TWICE on purpose: once inside the Advanced fold's own help text
  // (unchanged), and once outside it (final review Minor 1a) — the fold is
  // closed on open, so the outside copy is what a host actually sees.
  test('more questions than the set holds disables Create and says why', async () => {
    const props = setup();
    await settle();
    pickTrivia();
    fireEvent.change(screen.getByLabelText('Goal'), { target: { value: '13' } });
    expect(create()).toBeDisabled();
    expect(screen.getAllByText('This set has 12 questions, so the goal can be 12 at most.')).toHaveLength(2);
    fireEvent.click(create());
    expect(props.onCreate).not.toHaveBeenCalled();
  });

  // final review Minor 1a: the Advanced fold is closed on open, so the red
  // text at line 78 above is not what tells a host why the button is grey —
  // this is the visible, announced line outside it.
  test('the reason is also visible outside the closed Advanced fold, and wired to the button', async () => {
    const props = setup();
    await settle();
    pickTrivia();
    fireEvent.change(screen.getByLabelText('Goal'), { target: { value: '13' } });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('This set has 12 questions, so the goal can be 12 at most.');
    expect(create()).toHaveAttribute('aria-describedby', alert.id);
    expect(props.onCreate).not.toHaveBeenCalled();
  });

  test('1000 gets its own ceiling sentence, never the whole-number one', async () => {
    setup();
    await settle();
    pickTrivia();
    fireEvent.change(screen.getByLabelText('Goal'), { target: { value: '1000' } });
    expect(create()).toBeDisabled();
    // The set only holds 12, so the set-size sentence speaks first — either
    // way, never "A goal is a whole number of questions, 1 or more.", which
    // would be false for 1000 (session-goal.js's check order).
    expect(screen.getByRole('alert')).toHaveTextContent('This set has 12 questions, so the goal can be 12 at most.');
  });

  test('only digits are taken', async () => {
    setup();
    await settle();
    pickTrivia();
    fireEvent.change(screen.getByLabelText('Goal'), { target: { value: '5a!' } });
    expect(screen.getByLabelText('Goal')).toHaveValue('5');
  });

  test('the Advanced line names a goal the host set', async () => {
    setup();
    await settle();
    pickTrivia();
    fireEvent.change(screen.getByLabelText('Goal'), { target: { value: '5' } });
    expect(screen.getByTestId('gsd-adv-summary')).toHaveTextContent('Changed: a goal of 5 questions.');
  });

  test('a survey has no goal to set, and sends none', async () => {
    const props = setup();
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Survey' }));
    fireEvent.change(screen.getByLabelText(/question set/i), { target: { value: 'platform:pulse' } });
    expect(screen.queryByLabelText('Goal')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open the survey' }));
    expect(props.onCreate).toHaveBeenCalledTimes(1);
    expect('target' in props.onCreate.mock.calls[0][0]).toBe(false);
  });
});

describe('a goal on an edit', () => {
  const EDIT = {
    mode: 'edit',
    initialValues: { gameType: 'trivia', questionSetId: 'space', questionSetScope: 'platform', title: 'Space night', target: 4 },
  };

  test('the session\'s goal is shown, and saved back', async () => {
    const props = setup(EDIT);
    await settle();
    expect(screen.getByLabelText('Goal')).toHaveValue('4');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(props.onCreate).toHaveBeenCalledWith(expect.objectContaining({ target: 4 }));
  });

  test('clearing it sends null, which removes it', async () => {
    const props = setup(EDIT);
    await settle();
    fireEvent.change(screen.getByLabelText('Goal'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(props.onCreate).toHaveBeenCalledWith(expect.objectContaining({ target: null }));
  });

  /*
    final review Minor 1b: `space` shows 12 questions right now, but a session
    can be pinned to an OLDER, larger version — the set has since shrunk (or
    grown, or been re-versioned) and this dialog's live read of it is not
    proof of what the session actually plays. `update-game.js` checks the
    PINNED version through `resolveSetPartition` and says so if a save is
    really too big; this dialog must not refuse a save the server would
    accept just because the set looks smaller today.
  */
  test('a goal above the set\'s CURRENT size does not block Save — the server holds that bound', async () => {
    const props = setup({
      mode: 'edit',
      initialValues: {
        gameType: 'trivia', questionSetId: 'space', questionSetScope: 'platform', title: 'Space night', target: 20,
      },
    });
    await settle();
    expect(screen.getByLabelText('Goal')).toHaveValue('20');
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(props.onCreate).toHaveBeenCalledWith(expect.objectContaining({ target: 20 }));
  });

  test('an edit still refuses a goal over 999, and disables Save', async () => {
    const props = setup(EDIT);
    await settle();
    fireEvent.change(screen.getByLabelText('Goal'), { target: { value: '1000' } });
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('A goal can be at most 999 questions.');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(props.onCreate).not.toHaveBeenCalled();
  });
});
