/**
 * BuilderPage — a save refused at the stored-set allowance.
 *
 * It said "Save failed: This organisation cannot store another question set
 * yet…" — a fault's voice for a plan fact, with nothing to click. It now shows
 * the plan-limit notice (22-plan-limit-notice.html) on the page's own paper,
 * and keeps the work: a refused save must not clear a set somebody just built.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import BuilderPage from '../BuilderPage';
import { authFetch } from '../auth/authFetch';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));
jest.mock('../components/CallAnswerBuilder', () => () => <div data-testid="caa-builder" />);
jest.mock('../components/TriviaBuilder', () => () => <div data-testid="trivia-builder" />);
jest.mock('../components/PollBuilder', () => () => <div data-testid="poll-builder" />);
jest.mock('../components/WavelengthBuilder', () => () => <div data-testid="wavelength-builder" />);
jest.mock('../components/AIAssistant', () => () => <div data-testid="ai-assistant" />);

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body),
});

beforeEach(() => {
  authFetch.mockReset();
  window.API_BASE = 'https://api.test/';
  authFetch.mockImplementation(async (url, options = {}) => {
    const method = (options.method || 'GET').toUpperCase();
    if (method === 'GET' && url.includes('admin/ai-prompts')) return jsonResponse(200, { prompts: [] });
    if (method === 'POST' && url.includes('admin/upload-questions')) {
      return jsonResponse(402, {
        code: 'upgrade_required',
        error: 'This organisation cannot store another question set yet.',
        limit: { kind: 'sets', used: 5, included: 5 },
        resolve: { role: 'admin', canViewBilling: true, org: { name: 'Northwind', type: 'team' }, contacts: [{ name: 'Dana Whitfield', email: 'dana@x.example', role: 'owner' }], resetsOn: '2026-10-01' },
      });
    }
    throw new Error(`Unhandled request: ${method} ${url}`);
  });
});

test('a refused save shows the notice, in the reader\'s voice, and keeps the set', async () => {
  render(<BuilderPage />);
  await screen.findByLabelText(/AI Summary Prompt/i);
  fireEvent.change(screen.getByLabelText(/^Title/i), { target: { value: 'Retro' } });
  fireEvent.click(screen.getByRole('button', { name: /Add Question/i }));
  fireEvent.change(screen.getByLabelText(/topic/i), { target: { value: 'history' } });
  fireEvent.click(screen.getByRole('button', { name: /Save Question Set/i }));

  const box = await screen.findByTestId('plan-limit-notice');
  expect(box).toHaveTextContent('Northwind holds 5 of the 5 question sets it includes. Nothing was saved.');
  expect(box).toHaveTextContent('Only the owner can move Northwind to the Team plan.');
  // the white page takes the paper tint, not the dusk one
  expect(box.className).toMatch(/plim--paper/);
  // rejects: the fault string for a plan fact
  expect(screen.queryByText(/Save failed/)).toBeNull();
  // rejects: clearing the set a refusal left intact
  expect(screen.getByLabelText(/^Title/i)).toHaveValue('Retro');
});
