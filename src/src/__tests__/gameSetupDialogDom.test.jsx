/**
 * THE CREATE DIALOG'S FORM, AS HTML — components/GameSetupDialog.jsx and the
 * shared components/SessionOptions.jsx it renders (events M1b, Task 3).
 *
 * The options block became a shared component so the event item dialog can
 * render the same controls. This file pins the dialog's whole form, as HTML,
 * in seven shapes. It was recorded from the dialog BEFORE the block moved, and
 * the move had to reproduce it exactly. A later change to the shared block
 * updates the snapshot on purpose (`npm test -- gameSetupDialogDom -u`), and
 * the snapshot's diff is what the reviewer reads.
 *
 * React's generated ids (`useId`) are replaced by `:id:`; nothing else is.
 *
 * rejects: the extraction changing one attribute, id, class, word or order in
 * the create or edit form, for any format.
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import GameSetupDialog from '../components/GameSetupDialog';

const mockPrompts = [
  { promptId: 'lp-behavioral', name: 'LP Behavioural', gameType: 'call-and-answer', summaryPromptStatus: 'ok' },
  { promptId: 'trivia-vj', name: 'Trivia — VJ', gameType: 'trivia', summaryPromptStatus: 'ok' },
  { promptId: 'trivia-gen', name: 'Trivia generator', gameType: 'trivia', summaryPromptStatus: 'unusable' },
];
jest.mock('../auth/authFetch', () => ({
  __esModule: true,
  authFetch: jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ prompts: mockPrompts }) })),
}));

const SETS = [
  { id: 'pricing', name: 'Strategic Pricing Plays', totalQuestions: 47, engagementType: 'call-and-answer', hasImages: false, promptId: 'lp-behavioral' },
  { id: 'space', name: 'Space Trivia', totalQuestions: 12, engagementType: 'trivia', hasImages: false },
  { id: 'mood', name: 'Room Mood', totalQuestions: 6, engagementType: 'poll', hasImages: false },
  { id: 'words', name: 'One Word', totalQuestions: 9, engagementType: 'wavelength', hasImages: false },
  { id: 'pulse', name: 'Kickoff pulse', totalQuestions: 5, engagementType: 'survey', hasImages: false, namesDefault: 'finished' },
];
const CATEGORIES = [
  { name: 'Leadership', questionCount: 20 },
  { name: 'Ops', questionCount: 27 },
];

const dialog = (props = {}) => render(
  <GameSetupDialog
    isFirstEngagement
    eventTitle="Q3 Offsite"
    onEventTitleChange={jest.fn()}
    questionSets={SETS}
    personas={[{ personaId: 'coach', name: 'Coach', tagline: 'warm and direct' }]}
    categories={CATEGORIES}
    activeCategoryIds={new Set(['Ops'])}
    onToggleCategory={jest.fn()}
    onQuestionSetChange={jest.fn()}
    onCancel={jest.fn()}
    onCreate={jest.fn()}
    {...props}
  />
);
const form = () => document.querySelector('.dialog-content').innerHTML.replace(/:r[0-9a-z]+:/gi, ':id:');
// The prompt library arrives a tick after mount; let it land before reading.
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

test.each([
  ['call-and-answer', 'Call & Answer', 'platform:pricing'],
  ['trivia', 'Trivia', 'platform:space'],
  ['poll', 'Poll', 'platform:mood'],
  ['wavelength', 'Wavelength', 'platform:words'],
  ['survey', 'Survey', 'platform:pulse'],
])('create, %s, with a set picked', async (_type, pill, key) => {
  dialog();
  await settle();
  fireEvent.click(screen.getByRole('button', { name: pill }));
  fireEvent.change(screen.getByLabelText(/question set/i), { target: { value: key } });
  await settle();
  expect(form()).toMatchSnapshot();
});

test('edit, a Call & Answer session with every option changed', async () => {
  dialog({
    mode: 'edit',
    initialValues: {
      gameType: 'call-and-answer', questionSetId: 'pricing', questionSetScope: 'platform', title: 'Q3 retro',
      details: 'Why we meet.', aiContext: 'Be brief.', personaId: 'coach', promptId: 'lp-behavioral',
      randomizeQuestions: false, anonymousUntilReveal: false, selectedCategoryNames: ['Ops'],
      briefing: { text: 'Open issues are up 15%.', source: null, namesRemoved: 0, draftedAt: null, editedAt: null },
    },
  });
  await settle();
  expect(form()).toMatchSnapshot();
});

test('edit, a survey with Names chosen', async () => {
  dialog({
    mode: 'edit',
    initialValues: { gameType: 'survey', questionSetId: 'pulse', questionSetScope: 'platform', title: 'Pulse', names: 'named' },
  });
  await settle();
  expect(form()).toMatchSnapshot();
});
