/**
 * THE MANUAL BUILDER'S SUMMARY-PROMPT PICKER — BuilderPage.jsx
 *
 * The page shipped with ten prompt ids written into the JSX by hand
 * (`lessons-learned`, `problem-solving`, …) and `promptId: 'lessons-learned'`
 * as the state's default. No seeder has ever minted those ids —
 * `scripts/populate-defaults.js` mints random ones — so every one of them
 * resolved to nothing, on every tier, since the day the page was written.
 *
 * That used to be invisible: `upload-questions.js` stored whatever string it
 * was handed, and `get-ai-summary.js` quietly fell back to the game type's
 * default when the id turned out to be a ghost. It is invisible no longer.
 * `shared/workie-refs.js` now resolves the id at the write and answers 400 for
 * one that does not exist, so the shipped page cannot save AT ALL — not for
 * call-and-answer, and not for the other three types either, because the save
 * body sends `promptId` whatever the engagement type is.
 *
 * THE PAGE IS REACHABLE. `App.jsx:278` routes `/builder`, and
 * `QuestionSetUploadPanel.jsx:452` draws a "Manual builder" button that opens
 * it in a second tab — rendered in the admin console (the flag defaults on)
 * and in the host's create dialog (which passes `showManualBuilder`).
 *
 * NO GEOMETRIC ASSERTIONS. jsdom has no layout engine.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import BuilderPage from '../BuilderPage';
import { authFetch } from '../auth/authFetch';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));

/* The four builders and the AI modal are another task's subject. Stubbing them
   keeps this suite about the one control it is named for. */
jest.mock('../components/CallAnswerBuilder', () => () => <div data-testid="caa-builder" />);
jest.mock('../components/TriviaBuilder', () => () => <div data-testid="trivia-builder" />);
jest.mock('../components/PollBuilder', () => () => <div data-testid="poll-builder" />);
jest.mock('../components/WavelengthBuilder', () => () => <div data-testid="wavelength-builder" />);
jest.mock('../components/AIAssistant', () => () => <div data-testid="ai-assistant" />);

/**
 * Every id the page used to hardcode. The brief counted seven; the file
 * actually carried ten.
 */
const DEAD_IDS = [
  'lessons-learned',
  'problem-solving',
  'team-building',
  'strategic-planning',
  'innovation',
  'leadership',
  'customer-insights',
  'process-improvement',
  'change-management',
  'interview-prep',
];

/**
 * Prompts exactly as `get-ai-prompts.js` returns them, including the shapes
 * `selectableSummaryPrompts()` exists to drop: a prompt for another game type,
 * a generation prompt, and a retired one. Both spellings of the call-and-answer
 * game type are present because the table holds both.
 */
const PROMPTS = [
  { promptId: 'sum-9f3a2b', name: 'Retro Readout', gameType: 'callandanswer', status: 'active' },
  { promptId: 'sum-1c8b44', name: 'Strategic Themes', gameType: 'call-and-answer', status: 'active' },
  { promptId: 'sum-poll-7e', name: 'Poll Readout', gameType: 'polls', status: 'active' },
  { promptId: 'gen-caa-01', name: 'Question Generator', gameType: 'callandanswer', status: 'active' },
  { promptId: 'sum-retired', name: 'Retired Summary', gameType: 'callandanswer', status: 'inactive' },
];

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

function mockApi({ prompts = PROMPTS, promptStatus = 200, uploads = [] } = {}) {
  authFetch.mockImplementation(async (url, options = {}) => {
    const method = (options.method || 'GET').toUpperCase();
    if (method === 'GET' && url.includes('admin/ai-prompts')) {
      return promptStatus === 200
        ? jsonResponse(200, { prompts })
        : jsonResponse(promptStatus, { error: 'nope' });
    }
    if (method === 'POST' && url.includes('admin/upload-questions')) {
      uploads.push(JSON.parse(options.body));
      return jsonResponse(200, { message: 'Created "Retro" with 1 question' });
    }
    throw new Error(`Unhandled request: ${method} ${url}`);
  });
}

/** The prompt picker. Present from the first render, library or no library. */
const promptSelect = () => screen.findByLabelText(/AI Summary Prompt/i);

/**
 * The picker once the library has actually landed. The label and the select
 * exist before the fetch resolves, so `promptSelect()` alone would assert
 * against an empty picker and pass for the wrong reason.
 */
async function loadedPromptSelect() {
  const select = await promptSelect();
  await within(select).findByRole('option', { name: 'Retro Readout' });
  return select;
}

const optionTexts = (select) =>
  within(select).getAllByRole('option').map((o) => o.textContent.trim());

const optionValues = (select) =>
  within(select).getAllByRole('option').map((o) => o.value);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('BuilderPage summary-prompt picker', () => {
  test('offers one option per usable prompt in the library, and nothing else', async () => {
    mockApi();
    render(<BuilderPage />);

    const select = await loadedPromptSelect();

    // The two call-and-answer summary prompts, under the empty default.
    expect(optionValues(select)).toEqual(['', 'sum-9f3a2b', 'sum-1c8b44']);
    expect(optionTexts(select).slice(1)).toEqual(['Retro Readout', 'Strategic Themes']);

    // A poll prompt, a generation prompt and a retired one are not choices.
    expect(optionTexts(select)).not.toContain('Poll Readout');
    expect(optionTexts(select)).not.toContain('Question Generator');
    expect(optionTexts(select)).not.toContain('Retired Summary');
  });

  test('reads the library through GET admin/ai-prompts, once', async () => {
    mockApi();
    render(<BuilderPage />);
    await promptSelect();

    const promptCalls = authFetch.mock.calls.filter(([url]) => String(url).includes('admin/ai-prompts'));
    expect(promptCalls).toHaveLength(1);
    expect(String(promptCalls[0][0])).toContain('admin/ai-prompts');
  });

  test('defaults to the game type’s own default rather than an id of its own', async () => {
    mockApi();
    render(<BuilderPage />);

    // After the library lands: a real choice existing must not select one.
    const select = await loadedPromptSelect();
    expect(select.value).toBe('');

    const [first] = within(select).getAllByRole('option');
    expect(first.value).toBe('');
    expect(first.textContent).toMatch(/use the default prompt for call & answer/i);
  });

  test('never renders one of the ten ids nothing mints', async () => {
    mockApi();
    render(<BuilderPage />);

    const select = await loadedPromptSelect();
    const values = optionValues(select);
    for (const dead of DEAD_IDS) {
      expect(values).not.toContain(dead);
    }
    // …and not anywhere else on the page either.
    expect(document.body.innerHTML).not.toMatch(/lessons-learned/);
  });

  test('saves with no promptId when none was chosen, rather than a dangling one', async () => {
    const uploads = [];
    mockApi({ uploads });
    render(<BuilderPage />);
    await promptSelect();

    fireEvent.change(screen.getByLabelText(/^Title/i), { target: { value: 'Retro' } });
    fireEvent.click(screen.getByRole('button', { name: /Add Question/i }));
    fireEvent.click(screen.getByRole('button', { name: /Save Question Set/i }));

    await waitFor(() => expect(uploads).toHaveLength(1));
    expect(uploads[0].promptId).toBe('');
  });

  test('sends the chosen prompt when the builder picks one', async () => {
    const uploads = [];
    mockApi({ uploads });
    render(<BuilderPage />);

    const select = await loadedPromptSelect();
    fireEvent.change(select, { target: { value: 'sum-1c8b44' } });

    fireEvent.change(screen.getByLabelText(/^Title/i), { target: { value: 'Retro' } });
    fireEvent.click(screen.getByRole('button', { name: /Add Question/i }));
    fireEvent.click(screen.getByRole('button', { name: /Save Question Set/i }));

    await waitFor(() => expect(uploads).toHaveLength(1));
    expect(uploads[0].promptId).toBe('sum-1c8b44');
  });

  test('a library that will not load leaves the page usable and sends nothing dead', async () => {
    const uploads = [];
    mockApi({ promptStatus: 500, uploads });
    render(<BuilderPage />);

    const select = await promptSelect();
    expect(optionValues(select)).toEqual(['']);

    fireEvent.change(screen.getByLabelText(/^Title/i), { target: { value: 'Retro' } });
    fireEvent.click(screen.getByRole('button', { name: /Add Question/i }));
    fireEvent.click(screen.getByRole('button', { name: /Save Question Set/i }));

    await waitFor(() => expect(uploads).toHaveLength(1));
    expect(uploads[0].promptId).toBe('');
  });
});
