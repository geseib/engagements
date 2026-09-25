/**
 * GUIDANCE FOR ONE BATCH OF ADDED QUESTIONS — the builder half.
 *
 * The owner: *"When adding questions to a question set: optional guidance. I can
 * imagine having a question set on historic figures and wanting to add 'be sure
 * to include George Washington in at least 1 question', or 'make these more
 * focused on recent historic figures'."*
 *
 * What this pins, for the two builders the Add questions dialog opens (trivia,
 * and the call-and-answer builder):
 *   - the box exists ONLY when adding to a set, with its exact label and a
 *     500-character limit — making a new set is unchanged;
 *   - what is typed travels as its own `batchGuidance` field, never folded into
 *     `customPrompt` (the set's standing brief), and is not sent when blank;
 *   - the review step says what guidance the batch was made with, so the author
 *     can check it was followed before adding anything.
 *
 * Rendered, with only `../auth/authFetch` mocked — the recipe
 * generationJobResume.test.jsx and generatedSetHandoff.test.jsx use.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));

const { authFetch } = require('../auth/authFetch');
const TriviaAIBuilder = require('../components/TriviaAIBuilder').default;
const AIScenarioBuilder = require('../components/AIScenarioBuilder').default;
const GeneratedItemsTable = require('../components/GeneratedItemsTable').default;

const LABEL = 'Guidance for these questions (optional)';
const GW = 'Include George Washington in at least one question';

const jsonResponse = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

const triviaItems = (n) => Array.from({ length: n }, (_, i) => ({
  title: `Question ${i + 1}`, questionDetail: `Detail ${i + 1}`, category: 'Presidents', difficulty: 'medium',
  optionA: 'A', optionB: 'B', optionC: 'C', optionD: 'D', correctAnswer: 'OptionA', tags: [],
}));
const scenarioItems = (n) => Array.from({ length: n }, (_, i) => ({
  title: `Scenario ${i + 1}`, category: 'Presidents', detail: `Detail ${i + 1}`, customInstructions: '', tags: [],
}));

/** Route every call; record each POST body. A request nobody expected throws. */
function mockApi(endpoint, items) {
  const posted = [];
  authFetch.mockImplementation(async (url, options = {}) => {
    const method = options.method || 'GET';
    if (method === 'GET' && url.includes('admin/ai-prompts')) return jsonResponse(200, { prompts: [] });
    if (method === 'POST' && url.includes(endpoint)) {
      posted.push(JSON.parse(options.body));
      return jsonResponse(202, { jobId: 'job-g', status: 'queued', requested: items.length });
    }
    if (method === 'GET' && url.includes(`${endpoint}/job-g`)) {
      return jsonResponse(200, {
        jobId: 'job-g', status: 'complete', phase: '', requested: items.length, completed: items.length,
        items, warnings: [], meta: null, error: null, createdSet: null, setCreationError: null,
        updatedAt: '2026-09-25T10:00:00.000Z',
      });
    }
    throw new Error(`unexpected ${method} ${url}`);
  });
  return posted;
}

/** Adding to a set, WITHOUT autoStart, so the form is where the test lands. */
const appendTo = (overrides = {}) => ({
  setName: 'Historic Figures',
  mode: 'existing',
  categories: ['Presidents', 'Generals'],
  brief: { topic: 'Historic figures', audience: 'Adults', difficulty: 'medium', context: 'Historic figures', roundKind: 'produce' },
  existingTotal: 10,
  onModeChange: () => {},
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('the trivia builder', () => {
  test('making a new set shows no guidance box', () => {
    mockApi('admin/ai-generate-trivia', []);
    render(<TriviaAIBuilder onClose={() => {}} onTriviaGenerated={() => {}} />);
    expect(screen.getByText('Configure Your Trivia Questions')).toBeInTheDocument();
    expect(screen.queryByLabelText(LABEL)).toBeNull();
  });

  test('adding to a set shows it at the top of the form, labelled, capped at 500', () => {
    mockApi('admin/ai-generate-trivia', []);
    render(<TriviaAIBuilder onClose={() => {}} onTriviaGenerated={() => {}} appendTo={appendTo()} />);
    const box = screen.getByLabelText(LABEL);
    expect(box.tagName).toBe('TEXTAREA');
    expect(box).toHaveAttribute('maxLength', '500');
    expect(box.getAttribute('placeholder')).toMatch(/George Washington/);
    expect(box.getAttribute('placeholder')).toMatch(/more recent historic figures/);
    expect(screen.getByText('Applies to this batch only.')).toBeInTheDocument();
    // First in the form: ahead of the topic field.
    const topic = screen.getByPlaceholderText(/American History/i);
    expect(box.compareDocumentPosition(topic) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('what is typed is sent as batchGuidance, trimmed, and kept out of customPrompt', async () => {
    const posted = mockApi('admin/ai-generate-trivia', triviaItems(2));
    render(<TriviaAIBuilder onClose={() => {}} onTriviaGenerated={() => {}} appendTo={appendTo()} />);
    fireEvent.change(screen.getByLabelText(LABEL), { target: { value: `  ${GW}  ` } });
    fireEvent.click(screen.getByRole('button', { name: /Generate Trivia Questions/ }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].batchGuidance).toBe(GW);
    expect(posted[0].customPrompt).not.toContain('Washington');
  });

  test('a blank box sends no batchGuidance at all', async () => {
    const posted = mockApi('admin/ai-generate-trivia', triviaItems(2));
    render(<TriviaAIBuilder onClose={() => {}} onTriviaGenerated={() => {}} appendTo={appendTo()} />);
    fireEvent.change(screen.getByLabelText(LABEL), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: /Generate Trivia Questions/ }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).not.toHaveProperty('batchGuidance');
  });

  test('the review step shows the guidance the batch was made with', async () => {
    mockApi('admin/ai-generate-trivia', triviaItems(2));
    render(<TriviaAIBuilder onClose={() => {}} onTriviaGenerated={() => {}} appendTo={appendTo()} />);
    fireEvent.change(screen.getByLabelText(LABEL), { target: { value: GW } });
    fireEvent.click(screen.getByRole('button', { name: /Generate Trivia Questions/ }));
    const note = await screen.findByTestId('git-guidance');
    expect(note).toHaveTextContent(`Your guidance: “${GW}”`);
    await screen.findByRole('button', { name: /Add 2 to “Historic Figures”/ });
  });

  test('guidance handed over with appendTo is sent on the auto-start', async () => {
    const posted = mockApi('admin/ai-generate-trivia', triviaItems(3));
    render(
      <TriviaAIBuilder
        onClose={() => {}}
        onTriviaGenerated={() => {}}
        appendTo={appendTo({ autoStart: true, count: 3, numberOfCategories: 2, batchGuidance: GW })}
      />
    );
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].batchGuidance).toBe(GW);
    expect(await screen.findByTestId('git-guidance')).toHaveTextContent(GW);
  });
});

describe('the call-and-answer builder', () => {
  /** Step 1 → the bare custom canvas → the step-2 form. */
  async function openForm(props) {
    render(<AIScenarioBuilder onClose={() => {}} onScenariosGenerated={() => {}} engagementType="call-and-answer" {...props} />);
    await waitFor(() => expect(authFetch).toHaveBeenCalled());
    fireEvent.click(await screen.findByTestId('scenario-continue-blank'));
    return screen.getByRole('button', { name: /Generate Scenarios/ });
  }

  test('making a new set shows no guidance box', async () => {
    mockApi('admin/ai-generate-scenarios', []);
    await openForm({});
    expect(screen.queryByLabelText(LABEL)).toBeNull();
  });

  test('adding to a set shows it at the top of the form, labelled, capped at 500', async () => {
    mockApi('admin/ai-generate-scenarios', []);
    await openForm({ appendTo: appendTo() });
    const box = screen.getByLabelText(LABEL);
    expect(box).toHaveAttribute('maxLength', '500');
    expect(screen.getByText('Applies to this batch only.')).toBeInTheDocument();
    const context = screen.getByText('Context/Background');
    expect(box.compareDocumentPosition(context) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('it is sent as batchGuidance, and the review step shows it', async () => {
    const posted = mockApi('admin/ai-generate-scenarios', scenarioItems(2));
    const generate = await openForm({ appendTo: appendTo() });
    fireEvent.change(screen.getByLabelText(LABEL), { target: { value: `${GW}\n` } });
    fireEvent.click(generate);
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].batchGuidance).toBe(GW);
    expect(posted[0].customPrompt || '').not.toContain('Washington');
    const note = await screen.findByTestId('git-guidance');
    expect(note).toHaveTextContent(`Your guidance: “${GW}”`);
  });

  test('guidance handed over with appendTo is sent on the auto-start', async () => {
    const posted = mockApi('admin/ai-generate-scenarios', scenarioItems(2));
    render(
      <AIScenarioBuilder
        onClose={() => {}}
        onScenariosGenerated={() => {}}
        engagementType="call-and-answer"
        appendTo={appendTo({ autoStart: true, count: 2, batchGuidance: GW })}
      />
    );
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0].batchGuidance).toBe(GW);
    expect(await screen.findByTestId('git-guidance')).toHaveTextContent(GW);
  });

  test('a blank box sends no batchGuidance, and the review shows no guidance line', async () => {
    const posted = mockApi('admin/ai-generate-scenarios', scenarioItems(2));
    const generate = await openForm({ appendTo: appendTo() });
    fireEvent.click(generate);
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).not.toHaveProperty('batchGuidance');
    await screen.findByRole('table');
    expect(screen.queryByTestId('git-guidance')).toBeNull();
  });
});

describe('the two stylesheets, measured on the white builder modal', () => {
  const fs = require('fs');
  const path = require('path');
  const read = (file) => fs.readFileSync(path.join(__dirname, '..', 'components', file), 'utf8');
  const lin = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const lum = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const token = (css, name) => new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css)[1];

  test('the hint clears AA on white, and outranks the modal\'s `.modal-content p`', () => {
    const css = read('BatchGuidanceField.css');
    expect(ratio(token(css, '--bgf-muted'), '#ffffff')).toBeGreaterThanOrEqual(4.5);
    // `.modal-content p` (styles.css) is one class and one element; a lone
    // `.bgf-hint` loses to it and the hint renders #666 with a 25px margin.
    expect(css).toMatch(/^\.bgf \.bgf-hint \{[^}]*color: var\(--bgf-muted\)/m);
    expect(css).not.toMatch(/^\.bgf-hint \{/m);
  });

  test('the guidance note clears AA and outranks `.modal-content p` too', () => {
    const css = read('GeneratedItemsTable.css');
    expect(ratio(token(css, '--git-text'), token(css, '--git-chip-bg'))).toBeGreaterThanOrEqual(4.5);
    expect(css).toMatch(/^\.git \.git-guidance \{[^}]*color: var\(--git-text\)/m);
  });
});

describe('the review table', () => {
  test('states the guidance above the list, and says nothing when there was none', () => {
    const { rerender } = render(<GeneratedItemsTable items={scenarioItems(1)} noun="scenarios" guidance={GW} />);
    const note = screen.getByTestId('git-guidance');
    expect(note).toHaveTextContent(`Your guidance: “${GW}”`);
    const table = screen.getByRole('table');
    expect(note.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    rerender(<GeneratedItemsTable items={scenarioItems(1)} noun="scenarios" />);
    expect(screen.queryByTestId('git-guidance')).toBeNull();
    expect(within(document.body).queryByText(/Your guidance/)).toBeNull();
  });
});
