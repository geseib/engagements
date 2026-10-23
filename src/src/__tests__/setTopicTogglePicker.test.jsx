/**
 * SWITCHING ON AN UNFILED SET ASKS FOR ITS TOPIC IN THE ROW
 * (components/QuestionSetsPanel.jsx, `onFileTopic`).
 *
 * The owner, 23 Oct 2026: "right now the user gets an error activating sets
 * because they dont have a tag". The server still refuses an unfiled set
 * (toggle-question-set.js); the list now asks first, pre-selected with what the
 * set's name and description point to (config/topicKeywords.js), saves the
 * topic, and then switches it on.
 *
 * Pure props, like questionSetsPanel.test.jsx: no fetch, no mocks.
 *
 * // rejects: the server's refusal as the only answer to pressing Inactive on
 * //          an unfiled set; a picker with nothing pre-selected; switching on
 * //          before the topic is saved, or after it was refused; a filed set
 * //          or a switch-off routed through the picker.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import QuestionSetsPanel from '../components/QuestionSetsPanel';

const base = {
  engagementType: 'trivia', totalQuestions: 10, categoryCount: 2, quickstart: false,
  createdAt: '2026-10-01T10:00:00.000Z', canManage: true,
};
const UNFILED = { ...base, id: 'cup', name: 'World Cup football', description: 'Tournaments and leagues', active: false, scope: 'org' };
const FILED = { ...base, id: 'egypt', name: 'Ancient Egypt', description: '', active: false, topic: 'history' };
const LIVE_UNFILED = { ...base, id: 'old', name: 'Old Jazz albums', description: '', active: true };

function mount(overrides = {}) {
  const order = [];
  const onToggleActive = jest.fn(async (set) => { order.push(['toggle', set.id, set.topic]); });
  const onFileTopic = jest.fn(async (set, topic) => { order.push(['file', set.id, topic]); return { ok: true }; });
  render(
    <QuestionSetsPanel
      questionSets={[UNFILED, FILED, LIVE_UNFILED]}
      onToggleActive={onToggleActive}
      onFileTopic={onFileTopic}
      onEdit={() => {}}
      {...overrides}
    />,
  );
  return { onToggleActive, onFileTopic, order };
}
const inactiveChip = (name) => screen.getAllByRole('button', { name: 'Inactive' })
  .find((b) => b.closest('tr').textContent.includes(name));

test('pressing Inactive on an unfiled set opens the picker, pre-selected with the suggestion', () => {
  const { onToggleActive, onFileTopic } = mount();
  fireEvent.click(inactiveChip('World Cup football'));
  const picker = screen.getByTestId('set-topic-picker');
  expect(picker).toHaveTextContent('Switching on needs a topic');
  expect(screen.getByLabelText(/File “World Cup football” under/)).toHaveValue('sport-games');
  expect(picker).toHaveTextContent('(suggested from its name)');
  expect(onToggleActive).not.toHaveBeenCalled();
  expect(onFileTopic).not.toHaveBeenCalled();
});

test('saving files the topic FIRST, then switches it on', async () => {
  const { onToggleActive, onFileTopic, order } = mount();
  fireEvent.click(inactiveChip('World Cup football'));
  fireEvent.click(screen.getByRole('button', { name: 'Save topic and switch on' }));
  await waitFor(() => expect(onToggleActive).toHaveBeenCalledTimes(1));
  expect(onFileTopic).toHaveBeenCalledWith(expect.objectContaining({ id: 'cup' }), 'sport-games');
  expect(order).toEqual([['file', 'cup', 'sport-games'], ['toggle', 'cup', 'sport-games']]);
  expect(screen.queryByTestId('set-topic-picker')).toBeNull();
});

test('a changed choice is the one saved, and the "(suggested)" note goes', async () => {
  const { onFileTopic } = mount();
  fireEvent.click(inactiveChip('World Cup football'));
  fireEvent.change(screen.getByLabelText(/File “World Cup football” under/), { target: { value: 'business-work' } });
  expect(screen.getByTestId('set-topic-picker')).not.toHaveTextContent('(suggested');
  fireEvent.click(screen.getByRole('button', { name: 'Save topic and switch on' }));
  await waitFor(() => expect(onFileTopic).toHaveBeenCalledWith(expect.anything(), 'business-work'));
});

test('a refused save says why in the row and does not switch anything on', async () => {
  const onFileTopic = jest.fn(async () => ({ ok: false, error: 'Unknown topic "x".' }));
  const { onToggleActive } = mount({ onFileTopic });
  fireEvent.click(inactiveChip('World Cup football'));
  fireEvent.click(screen.getByRole('button', { name: 'Save topic and switch on' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Unknown topic "x".');
  expect(onToggleActive).not.toHaveBeenCalled();
  expect(screen.getByTestId('set-topic-picker')).toBeInTheDocument();
});

test('Cancel closes it and changes nothing', () => {
  const { onToggleActive, onFileTopic } = mount();
  fireEvent.click(inactiveChip('World Cup football'));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByTestId('set-topic-picker')).toBeNull();
  expect(onToggleActive).not.toHaveBeenCalled();
  expect(onFileTopic).not.toHaveBeenCalled();
});

test('a filed set, and switching a set OFF, go straight through as before', () => {
  const { onToggleActive } = mount();
  fireEvent.click(inactiveChip('Ancient Egypt'));
  expect(onToggleActive).toHaveBeenCalledWith(expect.objectContaining({ id: 'egypt' }));
  fireEvent.click(screen.getAllByRole('button', { name: 'Active' })[0]);
  expect(onToggleActive).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'old' }));
  expect(screen.queryByTestId('set-topic-picker')).toBeNull();
});

test('without onFileTopic the chip behaves as it always did', () => {
  const { onToggleActive } = mount({ onFileTopic: undefined });
  fireEvent.click(inactiveChip('World Cup football'));
  expect(onToggleActive).toHaveBeenCalledWith(expect.objectContaining({ id: 'cup' }));
  expect(screen.queryByTestId('set-topic-picker')).toBeNull();
});
