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
  test('more questions than the set holds disables Create and says why', async () => {
    const props = setup();
    await settle();
    pickTrivia();
    fireEvent.change(screen.getByLabelText('Goal'), { target: { value: '13' } });
    expect(create()).toBeDisabled();
    expect(screen.getByText('This set has 12 questions, so the goal can be 12 at most.')).toBeInTheDocument();
    fireEvent.click(create());
    expect(props.onCreate).not.toHaveBeenCalled();
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
});
