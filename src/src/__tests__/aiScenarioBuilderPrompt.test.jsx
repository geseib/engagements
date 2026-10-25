/**
 * WHAT THE SCENARIO BUILDER SENDS, AND WHAT IT TELLS THE HOST
 * (docs/design/authoring-guidance/ b1–b3).
 *
 *   1. `prompt` is the card's base text, exactly; `customPrompt` is only what
 *      the host typed. The card's prompt used to be pre-filled into the
 *      editable box (so it reached the model twice), and for a built-in card
 *      the client composed context, audience and level into `prompt` while the
 *      server added them again.
 *   2. The base prompt is shown read-only; the additions box starts empty.
 *   3. The detail levels are labelled by what they produce; the values sent
 *      are unchanged.
 *   4. A status line says what is happening and what to do next.
 *   5. Export CSV carries the direction as a RoundKind column.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));

const { authFetch } = require('../auth/authFetch');
const AIScenarioBuilderModule = require('../components/AIScenarioBuilder');

const AIScenarioBuilder = AIScenarioBuilderModule.default;
const { withMissingTemplateLines, cardPrompt, DETAIL_LEVELS } = AIScenarioBuilderModule;

const jsonResponse = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

const items = (n) => Array.from({ length: n }, (_, i) => ({
  title: `Scenario ${i + 1}`, category: 'General', detail: `Detail ${i + 1}`, customInstructions: 'What could our team do?', tags: [],
}));
const completeJob = (n = 2, extra = {}) => ({
  jobId: 'job-1', status: 'complete', phase: 'Done', requested: n, completed: n, items: items(n), warnings: [], ...extra,
});

function mockApi({ prompts = [], job = completeJob() } = {}) {
  const posted = [];
  authFetch.mockImplementation(async (url, options = {}) => {
    const method = options.method || 'GET';
    if (method === 'GET' && url.includes('admin/ai-prompts')) return jsonResponse(200, { prompts });
    if (method === 'POST' && url.includes('admin/ai-generate-scenarios')) {
      posted.push(JSON.parse(options.body));
      return jsonResponse(202, { jobId: 'job-1', status: 'queued', requested: 2 });
    }
    if (method === 'GET' && url.includes('admin/ai-generate-scenarios/job-1')) return jsonResponse(200, job);
    throw new Error(`unexpected ${method} ${url}`);
  });
  return posted;
}

const DB_PROMPT = {
  SK: 'AIPROMPT#gen-ca-lessons', promptId: 'gen-ca-lessons', name: 'Lessons Learned Scenarios',
  description: 'db-tuned lessons template', basePrompt: 'DB LESSONS BASE PROMPT', scenarioType: 'lessons-learned',
  contextTemplate: '\n\nContext: {context}', audienceTemplate: '\nAudience: {audience}',
  gameType: 'call-and-answer', promptType: 'generation', status: 'active',
};

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

async function openOnStep2({ prompts = [], job, card = /Or just continue/ } = {}) {
  const posted = mockApi({ prompts, job });
  render(<AIScenarioBuilder onClose={() => {}} onScenariosGenerated={jest.fn()} engagementType="call-and-answer" />);
  await screen.findByText(/Or start from a saved template \(\d+\)/);
  if (card instanceof RegExp && String(card).includes('continue')) {
    fireEvent.click(screen.getByTestId('scenario-continue-blank'));
  } else {
    fireEvent.click(screen.getByTestId('template-disclosure'));
    fireEvent.click(screen.getByText(card));
  }
  await screen.findByTestId('asb-asked');
  return posted;
}

describe('1 · the card\'s prompt is sent once, as it is', () => {
  test('a stored card: prompt is its basePrompt, customPrompt starts and stays empty', async () => {
    const posted = await openOnStep2({ prompts: [DB_PROMPT], card: 'Lessons Learned Scenarios' });
    expect(document.getElementById('asb-additions')).toHaveValue('');
    fireEvent.change(screen.getByPlaceholderText(/Describe the context/), { target: { value: 'A hospital ward' } });
    fireEvent.click(screen.getByRole('button', { name: /Generate/i }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].prompt).toBe('DB LESSONS BASE PROMPT');
    expect(posted[0].customPrompt || '').not.toContain('DB LESSONS BASE PROMPT');
    expect(posted[0].context).toBe('A hospital ward');
  });

  test('a built-in card: prompt is its own text, with no context, audience or level folded in', async () => {
    const posted = await openOnStep2();
    fireEvent.change(screen.getByPlaceholderText(/Describe the context/), { target: { value: 'Night shift handovers' } });
    fireEvent.change(document.getElementById('asb-additions'), { target: { value: 'Use $& and $1 literally' } });
    fireEvent.click(screen.getByRole('button', { name: /Generate/i }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].prompt).toBe('Create scenarios based on the custom requirements provided');
    expect(posted[0].prompt).not.toMatch(/Context:|Audience:|Level of Detail|Additional Requirements/);
    expect(posted[0].context).toBe('Night shift handovers');
    // What the host typed travels untouched — no `.replace` pattern ate the $&.
    expect(posted[0].customPrompt).toBe('Use $& and $1 literally');
  });

  test('a stored card with its context template cleared still carries the context, after the additions', () => {
    const card = { source: 'database', dbPrompt: { basePrompt: 'B', contextTemplate: '', audienceTemplate: '\nAudience: {audience}' } };
    expect(withMissingTemplateLines('Mine', card, { context: 'Ward 9', audience: 'Nurses' })).toBe('Mine\n\nContext: Ward 9');
    expect(withMissingTemplateLines('', { source: 'hardcoded', prompt: 'P' }, { context: 'X' })).toBe('');
    expect(cardPrompt(card)).toBe('B');
  });
});

describe('2 · what the AI is asked, shown read-only', () => {
  test('the base prompt is displayed, marked by where it comes from, and is not an input', async () => {
    await openOnStep2({ prompts: [DB_PROMPT], card: 'Lessons Learned Scenarios' });
    const asked = screen.getByTestId('asb-asked');
    expect(within(asked).getByText('What the AI is asked')).toBeInTheDocument();
    expect(within(asked).getByText('DB LESSONS BASE PROMPT')).toBeInTheDocument();
    expect(within(asked).getByText('Tuned in your library')).toBeInTheDocument();
    expect(within(asked).queryByRole('textbox')).toBeNull();
  });

  test('a built-in card says so', async () => {
    await openOnStep2();
    expect(within(screen.getByTestId('asb-asked')).getByText('Built in')).toBeInTheDocument();
  });
});

describe('3 · detail levels say what they produce', () => {
  test('the labels name sentence counts; the values are the ones the server already reads', async () => {
    await openOnStep2();
    const select = screen.getByDisplayValue('Standard — 2 sentences');
    const options = within(select).getAllByRole('option').map((o) => [o.value, o.textContent]);
    expect(options).toEqual([
      ['brief', 'Brief — 1 sentence'],
      ['standard', 'Standard — 2 sentences'],
      ['comprehensive', 'Detailed — up to 3 sentences'],
    ]);
    expect(DETAIL_LEVELS.map((l) => l.value)).toEqual(['brief', 'standard', 'comprehensive']);
    expect(screen.queryByText(/Comprehensive/)).toBeNull();
  });
});

describe('4 · the host is told what is happening and what is next', () => {
  test('step 2 says what will be written and that nothing is saved until accepted', async () => {
    await openOnStep2();
    expect(screen.getByTestId('asb-ready')).toHaveTextContent(/Ready to write 6 scenarios in 3 categories, Standard detail\./);
    expect(screen.getByTestId('asb-ready')).toHaveTextContent(/Nothing is saved until you accept it/);
  });

  test('done in the builder: the next step, and the generator\'s own warnings quoted', async () => {
    await openOnStep2({ job: completeJob(2, { warnings: ['A generation pass produced only duplicates; stopping early.'] }) });
    fireEvent.click(screen.getByRole('button', { name: /Generate/i }));
    const done = await screen.findByTestId('asb-done', {}, { timeout: 4000 });
    expect(done).toHaveTextContent(/Check each scenario below, then press Load 2 into System/);
    expect(within(done).getByTestId('asb-warnings')).toHaveTextContent(/only duplicates/);
  });
});

describe('5 · Export CSV keeps the direction', () => {
  test('a RoundKind column, per row, with the kind chosen on step 1', async () => {
    let blobText = '';
    const RealBlob = global.Blob;
    global.Blob = class { constructor(parts) { blobText = parts.join(''); } };
    window.URL.createObjectURL = jest.fn(() => 'blob:x');
    window.URL.revokeObjectURL = jest.fn();
    try {
      await openOnStep2();
      fireEvent.click(screen.getByRole('button', { name: /Generate/i }));
      fireEvent.click(await screen.findByRole('button', { name: /Export CSV/i }, { timeout: 4000 }));
      const [header, first] = blobText.split('\n');
      expect(header).toBe('Category,Question#,Title,Detail_lesson,School,CustomInstruction,Tags,Background,RoundKind');
      expect(first).toMatch(/,"?produce"?$/);
    } finally {
      global.Blob = RealBlob;
    }
  });
});
