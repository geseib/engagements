import React from 'react';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import QuestionsPanel from '../components/QuestionsPanel';
import { authFetch } from '../auth/authFetch';

/*
 * TASK 7 — the Background field in the console editor (question-background
 * spec §1, §7). Admins can read and edit it; the field is labelled so nobody
 * mistakes it for anything shown to players. The recipe is
 * questionsPanelPreview.test.jsx's: `authFetch` is the only mock, so the real
 * panel loads, edits and renders.
 */
jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));

const SET = { id: 'release-talk', name: 'Release Talk', engagementType: 'call-and-answer', canManage: true };
const QUESTIONS = {
  setId: SET.id,
  questions: [{ id: 'c001#001', Category: 'Delivery', title: 'WHAT SLOWS A RELEASE', Background: 'Git records every change.' }],
};
const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body),
});
beforeEach(() => {
  window.API_BASE = 'https://api.test/';
  authFetch.mockReset();
  authFetch.mockImplementation(async (url, options = {}) => {
    if ((options.method || 'GET').toUpperCase() === 'GET' && url.includes('/questions')) return jsonResponse(200, QUESTIONS);
    throw new Error(`Unhandled request: ${url}`);
  });
});

test('the editor shows and edits Background, labelled as never shown to players', async () => {
  render(<QuestionsPanel questionSet={SET} availableSets={[SET]} plannedVersion={2}
    onChanged={jest.fn()} onDirtyChange={jest.fn()} />);
  await waitFor(() => expect(screen.getByTestId('question-0')).toBeInTheDocument());
  fireEvent.click(within(screen.getByTestId('question-0')).getByRole('button', { name: /edit/i }));
  const field = screen.getByLabelText('Background for Workie');
  expect(field.value).toBe('Git records every change.');
  expect(field).toHaveAttribute('maxLength', '600');
  expect(screen.getByText('Facts and context Workie may use. Never shown to players.')).toBeInTheDocument();
  fireEvent.change(field, { target: { value: 'Trunk-based teams merge daily.' } });
  expect(screen.getByLabelText('Background for Workie').value).toBe('Trunk-based teams merge daily.');
});

test('the outside-author guide names the Background column and the certainty rule', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../config/aiAuthoringPrompt.js'), 'utf8');
  expect(src).toMatch(/Background/);
  expect(src).toMatch(/certain/);
});
