/**
 * THE MANUAL BUILDER NAMES ITS SHELF TOO — BuilderPage.jsx.
 *
 * `/builder` is routed (App.jsx) and reachable from the upload panel's "Manual
 * builder" button, and its Save is a create that lands live: no `replaceSetId`,
 * no `isAIGenerated`, no `startInactive`. `upload-questions.js` answers 400 for
 * exactly that without a topic, so a page that did not ask would send somebody
 * a refusal about a field it never showed them.
 *
 * Harness copied from builderPagePrompts.test.jsx, builders and all.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BuilderPage from '../BuilderPage';
import { authFetch } from '../auth/authFetch';
import { SET_TOPICS, SET_TOPIC_IDS } from '../config/setTopics';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));
jest.mock('../components/CallAnswerBuilder', () => () => <div data-testid="caa-builder" />);
jest.mock('../components/TriviaBuilder', () => () => <div data-testid="trivia-builder" />);
jest.mock('../components/PollBuilder', () => () => <div data-testid="poll-builder" />);
jest.mock('../components/WavelengthBuilder', () => () => <div data-testid="wavelength-builder" />);
jest.mock('../components/AIAssistant', () => () => <div data-testid="ai-assistant" />);

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body),
});

function mockApi(uploads = []) {
  authFetch.mockImplementation(async (url, options = {}) => {
    const method = (options.method || 'GET').toUpperCase();
    if (method === 'GET' && url.includes('admin/ai-prompts')) return jsonResponse(200, { prompts: [] });
    if (method === 'POST' && url.includes('admin/upload-questions')) {
      uploads.push(JSON.parse(options.body));
      return jsonResponse(200, { message: 'Created "Retro" with 1 question' });
    }
    throw new Error(`Unhandled request: ${method} ${url}`);
  });
  return uploads;
}

const picker = () => screen.getByLabelText(/topic/i);
const saveSet = () => fireEvent.click(screen.getByRole('button', { name: /Save Question Set/i }));

/** A set that is complete except for its shelf. */
async function fillSet() {
  await screen.findByLabelText(/AI Summary Prompt/i);
  fireEvent.change(screen.getByLabelText(/^Title/i), { target: { value: 'Retro' } });
  fireEvent.click(screen.getByRole('button', { name: /Add Question/i }));
}

beforeEach(() => {
  authFetch.mockReset();
  window.API_BASE = 'https://api.test/';
});

describe('the builder asks which shelf the set will sit on', () => {
  test('offers exactly the fifteen, and starts on none of them', async () => {
    mockApi();
    render(<BuilderPage />);
    await fillSet();

    const offered = [...picker().querySelectorAll('option')].filter((o) => !o.disabled);
    expect(offered.map((o) => o.textContent)).toEqual(SET_TOPIC_IDS.map((id) => SET_TOPICS[id].label));
    expect(picker()).toHaveValue('');
  });

  test('refuses the save without one and says what to do, sending nothing', async () => {
    const uploads = mockApi();
    render(<BuilderPage />);
    await fillSet();

    saveSet();

    expect(await screen.findByText(/Give this set a topic/)).toBeInTheDocument();
    expect(uploads).toHaveLength(0);
  });

  test('sends the shelf and the set’s own words once one is chosen', async () => {
    const uploads = mockApi();
    render(<BuilderPage />);
    await fillSet();

    fireEvent.change(picker(), { target: { value: 'history' } });
    fireEvent.change(screen.getByLabelText(/tags for this set/i), { target: { value: 'cold war' } });
    fireEvent.click(screen.getByRole('button', { name: /^add tag$/i }));
    saveSet();

    await waitFor(() => expect(uploads).toHaveLength(1));
    expect(uploads[0].topic).toBe('history');
    expect(uploads[0].tags).toEqual(['cold-war']);
  });

  test('forgets the shelf after a set lands, like every other field on the form', async () => {
    const uploads = mockApi();
    render(<BuilderPage />);
    await fillSet();

    fireEvent.change(picker(), { target: { value: 'history' } });
    saveSet();

    await waitFor(() => expect(uploads).toHaveLength(1));
    await waitFor(() => expect(picker()).toHaveValue(''));
  });

  test('still asks for a title first — the shelf did not replace it', async () => {
    const uploads = mockApi();
    render(<BuilderPage />);
    await screen.findByLabelText(/AI Summary Prompt/i);
    fireEvent.click(screen.getByRole('button', { name: /Add Question/i }));
    fireEvent.change(picker(), { target: { value: 'history' } });

    saveSet();

    expect(await screen.findByText(/Title is required/)).toBeInTheDocument();
    expect(uploads).toHaveLength(0);
  });
});
