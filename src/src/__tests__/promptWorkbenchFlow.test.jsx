/**
 * THE WORKBENCH, IN THE EDITOR — AIPromptManager.jsx's Improve view and
 * AIPromptAdvisor.jsx inside it.
 *
 * The owner, 2026-09-25: he ran Improve from the library row, applied its
 * fixes, opened the editor, and the editor showed a finding Improve had never
 * mentioned. "Fix the confusion, but think through the whole flow of this
 * improve and tweaking. Make this a simple but flexible tool." Spec:
 * docs/superpowers/specs/2026-09-25-prompt-workbench-design.md.
 *
 * What is pinned here:
 *   - Improve works on the DRAFT in the editor, unsaved text included — the
 *     request carries the halves on screen, the sections on screen and what
 *     the editor's checks found, and never `existingPromptId` (which made the
 *     server review the saved copy instead);
 *   - the code's findings are on screen BEFORE anything runs, one list with
 *     the AI's, each item saying where it gets fixed;
 *   - Apply sends the ticked items from both lists; the rewrite opens with the
 *     checks re-run on it and word counts; Use this puts it in the editor as
 *     unsaved work — no write happens until Save;
 *   - Simplify is one pass, shown the same way;
 *   - the library row's Improve opens this, on that prompt.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));
const { authFetch } = require('../auth/authFetch');

import AIPromptManager from '../components/AIPromptManager';

const ART_SECTIONS = [
  { heading: 'The Winning Title', guidance: 'Name the title the room voted for.' },
  { heading: 'The Reveal', guidance: 'The real title, and one fact.' },
  { heading: 'Keep Playing', guidance: 'One line into the next round.' },
];
const INSTRUCTIONS = 'You are Workie.\n\n**The titles:**\n{responsesText}\n\nFind two titles in {responsesText} that disagree.';
const OUTPUT_FORMAT = '## The Winning Title\nSay which won, warmly, in two sentences.';

const PROMPT = {
  promptId: 'art1',
  name: 'Art & Creative Titles',
  gameType: 'call-and-answer',
  category: 'art-titles',
  status: 'active',
  isDefault: false,
  promptType: 'analysis',
  promptContent: { instructions: INSTRUCTIONS, outputFormat: OUTPUT_FORMAT, outputSections: ART_SECTIONS },
};

const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const done = (analysisType, analysis) => reply(200, {
  jobId: `job-${analysisType}`, status: 'complete', phase: 'ready', error: null,
  result: { analysisType, analysis, metadata: { modelUsed: 'claude-sonnet-4-6' } },
});

function serve(jobs = {}) {
  const posts = [];
  const writes = [];
  authFetch.mockImplementation(async (url, init = {}) => {
    const method = init.method || 'GET';
    if (method === 'PUT' || (method === 'POST' && !/ai-prompt-advisor/.test(url))) {
      writes.push({ url, method, body: JSON.parse(init.body) });
      return reply(200, { promptId: 'art1' });
    }
    if (method === 'POST') {
      const body = JSON.parse(init.body);
      posts.push(body);
      return reply(202, { jobId: `job-${body.analysisType}`, status: 'queued', analysisType: body.analysisType });
    }
    const m = /ai-prompt-advisor\/job-(\w+)$/.exec(url);
    if (m) return jobs[m[1]];
    return reply(200, { prompts: [PROMPT] });
  });
  return { posts, writes };
}

const ADVICE = {
  overallScore: 6,
  summary: 'Warm, but every round will open the same way.',
  issues: [
    { id: 'i1', severity: 'high', half: 'outputFormat', issue: 'Two sentences every round reads as a formula.', fix: 'Vary the length.' },
    { id: 'i2', severity: 'medium', half: 'sections', issue: 'Keep Playing matches nothing the remote reads.', fix: 'Call it Next steps.' },
  ],
};
const REWRITE = {
  instructions: 'You are Workie.\n\n**The titles:**\n{responsesText}\n\nFind two titles above that disagree.',
  outputFormat: '## The Winning Title\nSay which won — a line or a paragraph, as the room earned.',
};

async function openEditor() {
  render(<AIPromptManager />);
  fireEvent.click(await screen.findByTitle('Edit this prompt'));
  return screen.findByTestId('prompt-input-textarea');
}
const openImprove = () => fireEvent.click(screen.getByTestId('pmgr-open-improve'));
const checksList = () => screen.getByTestId('pmgr-wb-checks');
const item = (key) => screen.getByTestId(`pmgr-wb-item-${key}`);
const run = () => fireEvent.click(screen.getByTestId('pmgr-wb-run'));
const lens = (name) => fireEvent.click(screen.getByRole('radio', { name: new RegExp(name) }));

beforeEach(() => authFetch.mockReset());

describe('Improve works on the draft in the editor', () => {
  test("the code's findings are on screen before anything runs, each saying where it gets fixed", async () => {
    const { posts } = serve();
    await openEditor();
    openImprove();

    const list = checksList();
    const empty = within(list).getByText(/discussionQuestions and nextSteps will come back empty/).closest('li');
    expect(empty).toHaveTextContent('Fix in the editor: Output sections');
    expect(within(empty).queryByRole('checkbox')).toBeNull();

    const twice = within(list).getByText(/\{responsesText\} appears 2 times/).closest('li');
    expect(twice).toHaveTextContent('Improve can fix this');
    expect(within(twice).getByRole('checkbox')).toBeChecked();

    expect(posts).toHaveLength(0);
  });

  test('a check is coloured by its tier, as the editor\'s panel colours it — silent is amber, not red', async () => {
    // rejects: painting every silent finding in the blocked-save red because
    // its severity maps to "high" for the rewrite. The two lists would then
    // disagree with the editor's own panel about what stops a save.
    serve();
    await openEditor();
    openImprove();
    const silent = within(checksList()).getByText(/discussionQuestions and nextSteps/).closest('li');
    expect(silent).toHaveClass('pmgr-advice-item--medium');
    expect(silent).not.toHaveClass('pmgr-advice-item--high');
  });

  test('the request carries the unsaved halves, the sections on screen and the findings — never the saved copy\'s id', async () => {
    const { posts } = serve({ improve: done('improve', ADVICE) });
    const given = await openEditor();
    fireEvent.change(given, { target: { value: `${INSTRUCTIONS}\n\nBe warm.` } });
    fireEvent.change(screen.getAllByRole('textbox', { name: /^Heading \d/ })[2], { target: { value: 'Next steps' } });
    openImprove();
    lens('Improve');
    run();
    await screen.findByTestId('pmgr-advice');

    expect(posts[0].analysisType).toBe('improve');
    expect(posts[0].instructions).toBe(`${INSTRUCTIONS}\n\nBe warm.`);
    expect(posts[0].outputFormat).toBe(OUTPUT_FORMAT);
    expect(posts[0].outputSections.map((s) => s.heading)).toEqual(['The Winning Title', 'The Reveal', 'Next steps']);
    expect(posts[0].checks.map((c) => c.code)).toContain('duplicated-variable');
    expect(posts[0]).not.toHaveProperty('existingPromptId');
    expect(posts[0].gameType).toBe('call-and-answer');
  });

  test("the AI's items join the list; one about a heading is the editor's and has no tick box", async () => {
    serve({ improve: done('improve', ADVICE) });
    await openEditor();
    openImprove();
    lens('Improve');
    run();
    await screen.findByTestId('pmgr-advice');

    expect(item('ai:i1')).toHaveTextContent('Improve can fix this');
    expect(within(item('ai:i1')).getByRole('checkbox')).toBeChecked();
    expect(item('ai:i2')).toHaveTextContent('Fix in the editor: Output sections');
    expect(within(item('ai:i2')).queryByRole('checkbox')).toBeNull();
    expect(screen.getByTestId('pmgr-advice-apply')).toHaveTextContent('Apply selected (3)');
  });
});

describe('apply, and the rewrite', () => {
  async function rewritten() {
    const handles = serve({ improve: done('improve', ADVICE), apply: done('apply', { ...REWRITE, applied: [] }) });
    await openEditor();
    openImprove();
    lens('Improve');
    run();
    await screen.findByTestId('pmgr-advice');
    fireEvent.click(screen.getByTestId('pmgr-advice-apply'));
    await screen.findByTestId('pmgr-rewrite');
    return handles;
  }

  test("Apply sends the ticked items from both lists — the code's and the AI's — and no heading item", async () => {
    const { posts } = await rewritten();
    const apply = posts.find((p) => p.analysisType === 'apply');
    const ids = apply.issues.map((i) => i.id);
    expect(ids).toContain('ai:i1');
    expect(ids).toContain('check:prose-inlined-variable:responsesText');
    expect(ids).not.toContain('ai:i2');
    // A check travels with its evidence, so the model can find the passage.
    const check = apply.issues.find((i) => i.id === 'check:duplicated-variable:responsesText');
    expect(check.issue).toMatch(/\{responsesText\} appears 2 times/);
    expect(check.issue).toMatch(/Where: instructions:/);
    expect(apply.instructions).toBe(INSTRUCTIONS);
    expect(apply).not.toHaveProperty('existingPromptId');
  });

  test('the rewrite opens with the checks re-run on it: what it fixed, and what is still there', async () => {
    await rewritten();
    const verdict = screen.getByTestId('pmgr-rewrite-checks');
    expect(within(verdict).getByTestId('pmgr-rewrite-fixed')).toHaveTextContent(/\{responsesText\} appears 2 times/);
    expect(within(verdict).getByTestId('pmgr-rewrite-remaining')).toHaveTextContent(/discussionQuestions and nextSteps/);
    // What is still there says where it gets fixed, as it did in the list.
    expect(within(verdict).getByTestId('pmgr-rewrite-remaining')).toHaveTextContent('Fix in the editor: Output sections');
    expect(within(verdict).queryByTestId('pmgr-rewrite-introduced')).toBeNull();
    // It comes before the halves: the verdict first, then the reading.
    const half = screen.getByTestId('pmgr-rewrite-instructions');
    // eslint-disable-next-line no-bitwise
    expect(verdict.compareDocumentPosition(half) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('each half shows its word count before and after', async () => {
    await rewritten();
    expect(screen.getByTestId('pmgr-rewrite-instructions')).toHaveTextContent(/\d+ → \d+ words/);
    expect(screen.getByTestId('pmgr-rewrite-outputFormat')).toHaveTextContent(/\d+ → \d+ words/);
  });

  test('Use this puts both halves in the editor as unsaved work, and nothing is written', async () => {
    const { writes } = await rewritten();
    fireEvent.click(screen.getByRole('button', { name: 'Use this' }));
    expect(await screen.findByTestId('prompt-input-textarea')).toHaveValue(REWRITE.instructions);
    expect(screen.getByTestId('prompt-output-textarea')).toHaveValue(REWRITE.outputFormat);
    expect(screen.getByTestId('prompt-input-textarea')).toBeVisible();
    expect(writes).toEqual([]);
    fireEvent.click(screen.getByTestId('pmgr-editor-cancel'));
    expect(await screen.findByTestId('pmgr-discard-confirm')).toBeInTheDocument();
  });
});

describe('Simplify', () => {
  test('one pass on the draft; the result is shown shorter, with every variable and heading kept', async () => {
    const SIMPLE = {
      instructions: 'You are Workie.\n\n**The titles:**\n{responsesText}',
      outputFormat: '## The Winning Title\nSay which won.',
    };
    const { posts, writes } = serve({ simplify: done('simplify', SIMPLE) });
    await openEditor();
    openImprove();
    lens('Simplify');
    run();
    await screen.findByTestId('pmgr-rewrite');

    expect(posts[0]).toMatchObject({ analysisType: 'simplify', instructions: INSTRUCTIONS, outputFormat: OUTPUT_FORMAT });
    expect(posts[0]).not.toHaveProperty('existingPromptId');
    expect(screen.getByTestId('pmgr-rewrite')).toHaveTextContent(/Every \{variable\} and heading is still there/);
    expect(screen.getByTestId('pmgr-rewrite-words')).toHaveTextContent(/shorter/i);

    fireEvent.click(screen.getByRole('button', { name: 'Use this' }));
    expect(await screen.findByTestId('prompt-input-textarea')).toHaveValue(SIMPLE.instructions);
    expect(writes).toEqual([]);
  });

  test("a refused simplification shows the server's sentence and changes nothing", async () => {
    serve({
      simplify: reply(200, {
        jobId: 'job-simplify', status: 'error', phase: 'Failed', result: null,
        error: 'The simplified version was refused: it dropped {responsesText}, which the prompt needs. Nothing was changed.',
      }),
    });
    const given = await openEditor();
    openImprove();
    lens('Simplify');
    run();
    await waitFor(() => expect(screen.getByTestId('pmgr-advisor-notice')).toHaveTextContent(/dropped \{responsesText\}/));
    expect(given).toHaveValue(INSTRUCTIONS);
  });
});

describe('getting there, and getting back', () => {
  test("the library row's Improve opens the editor on Improve, on that prompt", async () => {
    serve();
    render(<AIPromptManager />);
    fireEvent.click(await screen.findByTitle('Improve this prompt'));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAccessibleName(/Improve/);
    expect(checksList()).toHaveTextContent(/discussionQuestions and nextSteps/);
    fireEvent.click(screen.getByTestId('pmgr-advisor-back'));
    expect(screen.getByTestId('prompt-input-textarea')).toBeVisible();
    expect(screen.getByTestId('prompt-input-textarea')).toHaveValue(INSTRUCTIONS);
  });

  test('Back keeps the advice; when the draft has changed since, the advice says so', async () => {
    serve({ improve: done('improve', ADVICE) });
    const given = await openEditor();
    openImprove();
    lens('Improve');
    run();
    await screen.findByTestId('pmgr-advice');
    fireEvent.click(screen.getByTestId('pmgr-advisor-back'));
    fireEvent.change(given, { target: { value: `${INSTRUCTIONS}\nOne more line.` } });
    openImprove();
    expect(screen.getByTestId('pmgr-advice')).toHaveTextContent(ADVICE.summary);
    expect(screen.getByTestId('pmgr-advice-stale')).toHaveTextContent(/changed since/i);
  });

  test('the bottom Close leaves the whole dialog, asking first when there is unsaved work', async () => {
    serve();
    const given = await openEditor();
    fireEvent.change(given, { target: { value: `${INSTRUCTIONS}\nEdited.` } });
    openImprove();
    fireEvent.click(screen.getByTestId('pmgr-advisor-close'));
    expect(await screen.findByTestId('pmgr-discard-confirm')).toBeInTheDocument();
  });
});
