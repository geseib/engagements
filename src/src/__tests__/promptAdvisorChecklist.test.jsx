/**
 * TICK THE ADVICE, APPLY THE TICKED — components/AIPromptAdvisor.jsx, and the
 * one line of AIPromptManager.jsx that receives the result.
 *
 * The owner, 2026-09-24: "It gave good advice on validate quality, but you cant
 * action that advice". The dialog showed a score, strengths and general
 * recommendations; Validate's `issues[]` — severity, where, the fix — were
 * never drawn, Optimize drew nothing, and "Apply to Prompt" pasted one
 * rewritten string into Output Format and left the old Instructions in place.
 *
 * Now both lenses return one checklist (lambda-functions/admin/ai-prompt-advisor.js):
 *   issues: [{ id, severity: high|medium|low, half: instructions|outputFormat|both, issue, fix }]
 * and the dialog lists it grouped by half, a checkbox per item with high
 * severity pre-ticked; "Apply selected (N)" runs an `apply` job sent ONLY the
 * ticked fixes; the rewrite is shown half by half, before and after, with the
 * editor's own preflight run on it; and "Use this" hands BOTH halves back.
 *
 * rejects: a checklist that is not grouped by half; nothing pre-ticked, or
 *          everything; an apply sent fixes nobody ticked; one string for both
 *          halves; a rewrite shown without the checks the editor would run on
 *          it; "Use this" filling one half; Optimize still offered.
 *
 * One mocked module — `../auth/authFetch` — as promptAdvisorJob.test.jsx. The
 * poll interval is a prop, so nothing waits on the real three seconds.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));
const { authFetch } = require('../auth/authFetch');

import AIPromptManager, { AIPromptAdvisor } from '../components/AIPromptManager';

const INSTRUCTIONS = 'You are Workie. Read what the room said.\n\n**The Responses:**\n{responsesText}';
const OUTPUT_FORMAT = '## What we heard\nTwo or three sentences.';

const PROMPT = {
  promptId: 'p1',
  name: 'Lessons Learned',
  gameType: 'call-and-answer',
  category: 'lessons-learned',
  status: 'active',
  isDefault: false,
  instructions: INSTRUCTIONS,
  outputFormat: OUTPUT_FORMAT,
  template: '',
};

const CHECKLIST = {
  overallScore: 7,
  summary: 'A clear prompt with one gap.',
  issues: [
    { id: 'r1', severity: 'high', half: 'instructions', issue: 'It never says what to do with a single answer.', fix: 'Add a sentence for the one-answer case.' },
    { id: 'r2', severity: 'medium', half: 'outputFormat', issue: 'The heading promises themes but allows one sentence.', fix: 'Ask for two or three themes.' },
    { id: 'r3', severity: 'low', half: 'both', issue: 'The tone words differ between the halves.', fix: 'Use "warm" in both.' },
    { id: 'r4', severity: 'high', half: 'outputFormat', issue: 'Nothing limits the length on a projector.', fix: 'Cap it at 150 words.' },
  ],
};

const REWRITE = {
  instructions: `${INSTRUCTIONS}\n\nIf only one person answered, say so and quote them.`,
  outputFormat: '## What we heard\nTwo or three warm sentences, under 150 words.',
  applied: ['r1', 'r4'],
};

const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const done = (analysisType, analysis) => reply(200, {
  jobId: `job-${analysisType}`, status: 'complete', phase: 'ready', error: null,
  result: { analysisType, analysis, metadata: { modelUsed: 'claude-sonnet-4-6' } },
});

/**
 * Route by method and by the analysisType in the POST: each POST starts a job
 * whose poll answers with `jobs[analysisType]`. Every POST body is recorded.
 */
function serve(jobs, { list = [PROMPT] } = {}) {
  const posts = [];
  authFetch.mockImplementation(async (url, init = {}) => {
    const method = init.method || 'GET';
    if (method === 'POST') {
      const body = JSON.parse(init.body);
      posts.push(body);
      const answer = jobs[`start:${body.analysisType}`];
      if (answer) return answer;
      return reply(202, { jobId: `job-${body.analysisType}`, status: 'queued', analysisType: body.analysisType });
    }
    const m = /ai-prompt-advisor\/job-(\w+)$/.exec(url);
    if (m) return jobs[m[1]];
    // The library list, for the AIPromptManager test at the end.
    return reply(200, { prompts: list.map((p) => ({ ...p, promptContent: { instructions: p.instructions, outputFormat: p.outputFormat } })) });
  });
  return posts;
}

function renderAdvisor(props = {}) {
  const onApplyImprovedPrompt = jest.fn();
  const onClose = jest.fn();
  render(
    <AIPromptAdvisor
      prompt={PROMPT}
      onClose={onClose}
      onApplyImprovedPrompt={onApplyImprovedPrompt}
      pollIntervalMs={5}
      giveUpMs={5000}
      {...props}
    />,
  );
  return { onApplyImprovedPrompt, onClose };
}

const run = () => fireEvent.click(screen.getByRole('button', { name: /Run analysis/i }));
const tick = (id) => screen.getByTestId(`pmgr-advice-tick-${id}`);
const applyButton = () => screen.getByTestId('pmgr-advice-apply');

async function reviewed(props) {
  const posts = serve({ review: done('review', CHECKLIST), apply: done('apply', REWRITE) });
  const handles = renderAdvisor(props);
  run();
  await screen.findByTestId('pmgr-advice');
  return { posts, ...handles };
}

beforeEach(() => {
  authFetch.mockReset();
});

describe('two lenses, one checklist', () => {
  test('Review and Improve are offered; Optimize is gone', () => {
    serve({});
    renderAdvisor();
    expect(screen.getByRole('radio', { name: /Review/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Improve/ })).not.toBeChecked();
    expect(screen.queryByRole('radio', { name: /Optimi[sz]e|Validate/ })).not.toBeInTheDocument();
  });

  test('the analysis request sends the two halves separately', async () => {
    const { posts } = await reviewed();
    expect(posts[0]).toMatchObject({
      analysisType: 'review', existingPromptId: 'p1', instructions: INSTRUCTIONS, outputFormat: OUTPUT_FORMAT,
    });
    expect(JSON.stringify(posts[0])).not.toContain(`${INSTRUCTIONS}\n\n${OUTPUT_FORMAT}`);
  });

  test('Improve runs the improve lens and draws the same checklist', async () => {
    const posts = serve({ improve: done('improve', CHECKLIST) });
    renderAdvisor();
    fireEvent.click(screen.getByRole('radio', { name: /Improve/ }));
    run();
    await screen.findByTestId('pmgr-advice');
    expect(posts[0].analysisType).toBe('improve');
    expect(screen.getAllByRole('checkbox')).toHaveLength(4);
  });
});

describe('the checklist', () => {
  test('lists every item, grouped by the half it changes', async () => {
    await reviewed();
    const given = screen.getByTestId('pmgr-advice-group-instructions');
    const writes = screen.getByTestId('pmgr-advice-group-outputFormat');
    const both = screen.getByTestId('pmgr-advice-group-both');
    expect(within(given).getByText(CHECKLIST.issues[0].issue)).toBeInTheDocument();
    expect(within(writes).getByText(CHECKLIST.issues[1].issue)).toBeInTheDocument();
    expect(within(writes).getByText(CHECKLIST.issues[3].issue)).toBeInTheDocument();
    expect(within(both).getByText(CHECKLIST.issues[2].issue)).toBeInTheDocument();
    // The groups are named in the words the editor uses for its two halves.
    expect(within(given).getByText(/What the AI is given/)).toBeInTheDocument();
    expect(within(writes).getByText(/What the AI writes/)).toBeInTheDocument();
  });

  test('each item reads as sentences — the issue and the fix — with its checkbox named by them', async () => {
    await reviewed();
    expect(screen.getByText(/Add a sentence for the one-answer case\./)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /never says what to do with a single answer/ })).toBe(tick('r1'));
    // rejects: the severity as a tiny uppercase tag. It is a word in a sentence.
    const item = tick('r1').closest('li');
    expect(item).toHaveTextContent(/High priority/);
    expect(item.innerHTML).not.toMatch(/text-transform|HIGH/);
  });

  test('high severity starts ticked, and nothing else does', async () => {
    await reviewed();
    expect(tick('r1')).toBeChecked();
    expect(tick('r4')).toBeChecked();
    expect(tick('r2')).not.toBeChecked();
    expect(tick('r3')).not.toBeChecked();
    expect(applyButton()).toHaveTextContent('Apply selected (2)');
  });

  test('the count follows the ticks, and nothing ticked means nothing to apply', async () => {
    await reviewed();
    fireEvent.click(tick('r3'));
    expect(applyButton()).toHaveTextContent('Apply selected (3)');
    fireEvent.click(tick('r1'));
    fireEvent.click(tick('r3'));
    fireEvent.click(tick('r4'));
    expect(applyButton()).toHaveTextContent('Apply selected (0)');
    expect(applyButton()).toBeDisabled();
  });

  test('an empty checklist says there is nothing to change and offers no apply', async () => {
    serve({ review: done('review', { overallScore: 9, summary: 'Solid.', issues: [] }) });
    renderAdvisor();
    run();
    expect(await screen.findByText(/nothing to change/i)).toBeInTheDocument();
    expect(screen.queryByTestId('pmgr-advice-apply')).not.toBeInTheDocument();
  });

  test('the score and the summary line are shown', async () => {
    await reviewed();
    expect(screen.getByText('A clear prompt with one gap.')).toBeInTheDocument();
    expect(screen.getByText(/7\/10/)).toBeInTheDocument();
  });
});

describe('apply selected', () => {
  test('sends only the ticked fixes, with the two halves separately', async () => {
    const { posts } = await reviewed();
    fireEvent.click(tick('r3'));
    fireEvent.click(tick('r4'));
    fireEvent.click(applyButton());
    await screen.findByTestId('pmgr-rewrite');

    const apply = posts.find((p) => p.analysisType === 'apply');
    expect(apply.issues.map((i) => i.id)).toEqual(['r1', 'r3']);
    expect(apply.issues[0]).toEqual(CHECKLIST.issues[0]);
    expect(apply).toMatchObject({ existingPromptId: 'p1', instructions: INSTRUCTIONS, outputFormat: OUTPUT_FORMAT });
  });

  test('shows each half before and after', async () => {
    await reviewed();
    fireEvent.click(applyButton());
    await screen.findByTestId('pmgr-rewrite');

    expect(screen.getByTestId('pmgr-rewrite-instructions-before').textContent).toBe(INSTRUCTIONS);
    expect(screen.getByTestId('pmgr-rewrite-instructions-after').textContent).toBe(REWRITE.instructions);
    expect(screen.getByTestId('pmgr-rewrite-outputFormat-before').textContent).toBe(OUTPUT_FORMAT);
    expect(screen.getByTestId('pmgr-rewrite-outputFormat-after').textContent).toBe(REWRITE.outputFormat);
    expect(screen.getByTestId('pmgr-rewrite')).toHaveTextContent(/2 of 2 ticked fixes/);
  });

  test('says which ticked fixes the advisor did not apply', async () => {
    const posts = serve({ review: done('review', CHECKLIST), apply: done('apply', { ...REWRITE, applied: ['r1'] }) });
    renderAdvisor();
    run();
    await screen.findByTestId('pmgr-advice');
    fireEvent.click(applyButton());
    const rewrite = await screen.findByTestId('pmgr-rewrite');
    expect(posts.length).toBe(2);
    expect(rewrite).toHaveTextContent(/1 of 2 ticked fixes/);
    expect(rewrite).toHaveTextContent(CHECKLIST.issues[3].issue);
  });

  test("runs the editor's preflight on the rewrite and shows what it finds", async () => {
    serve({
      review: done('review', CHECKLIST),
      apply: done('apply', { ...REWRITE, outputFormat: '## What we heard\n[Summary of the response]' }),
    });
    renderAdvisor();
    run();
    await screen.findByTestId('pmgr-advice');
    fireEvent.click(applyButton());
    await screen.findByTestId('pmgr-rewrite');
    const blocking = await screen.findByTestId('ppf-tier-blocking');
    expect(blocking).toHaveTextContent(/Summary of the response/);
  });

  test('"Use this" hands back BOTH halves and closes', async () => {
    const { onApplyImprovedPrompt, onClose } = await reviewed();
    fireEvent.click(applyButton());
    await screen.findByTestId('pmgr-rewrite');
    fireEvent.click(screen.getByRole('button', { name: 'Use this' }));
    expect(onApplyImprovedPrompt).toHaveBeenCalledWith({
      instructions: REWRITE.instructions, outputFormat: REWRITE.outputFormat,
    });
    expect(onClose).toHaveBeenCalled();
  });

  test('"Choose different fixes" goes back to the checklist with the ticks kept', async () => {
    await reviewed();
    fireEvent.click(tick('r2'));
    fireEvent.click(applyButton());
    await screen.findByTestId('pmgr-rewrite');
    fireEvent.click(screen.getByRole('button', { name: /Choose different fixes/ }));
    expect(screen.queryByTestId('pmgr-rewrite')).not.toBeInTheDocument();
    expect(tick('r2')).toBeChecked();
    expect(applyButton()).toHaveTextContent('Apply selected (3)');
  });

  test("a failed apply shows the server's sentence and keeps the checklist", async () => {
    serve({
      review: done('review', CHECKLIST),
      apply: reply(200, { jobId: 'job-apply', status: 'error', phase: 'Failed', result: null,
        error: 'The advisor replied, but not in the format it was asked for — the two rewritten halves were not in it.' }),
    });
    renderAdvisor();
    run();
    await screen.findByTestId('pmgr-advice');
    fireEvent.click(applyButton());
    await waitFor(() => expect(screen.getByTestId('pmgr-advisor-notice'))
      .toHaveTextContent(/the two rewritten halves were not in it/));
    expect(screen.getByTestId('pmgr-advice')).toBeInTheDocument();
    expect(tick('r1')).toBeChecked();
  });

  test('a refused apply start shows the body the server sent', async () => {
    serve({
      review: done('review', CHECKLIST),
      'start:apply': reply(400, { error: 'This prompt is one piece of text, not two halves' }),
    });
    renderAdvisor();
    run();
    await screen.findByTestId('pmgr-advice');
    fireEvent.click(applyButton());
    await waitFor(() => expect(screen.getByTestId('pmgr-advisor-notice'))
      .toHaveTextContent(/not two halves \(HTTP 400\)/));
  });
});

describe('the editor receives both halves', () => {
  test('"Use this" opens the editor with the instructions AND the output format rewritten', async () => {
    serve({ review: done('review', CHECKLIST), apply: done('apply', REWRITE) });
    render(<AIPromptManager />);
    fireEvent.click(await screen.findByTitle('Ask the AI advisor about this prompt'));
    run();
    await screen.findByTestId('pmgr-advice', {}, { timeout: 8000 });
    fireEvent.click(applyButton());
    await screen.findByTestId('pmgr-rewrite', {}, { timeout: 8000 });
    fireEvent.click(screen.getByRole('button', { name: 'Use this' }));

    expect(await screen.findByTestId('prompt-input-textarea')).toHaveValue(REWRITE.instructions);
    expect(screen.getByTestId('prompt-output-textarea')).toHaveValue(REWRITE.outputFormat);
    expect(screen.queryByTestId('pmgr-advisor-body')).not.toBeInTheDocument();
  }, 20000);
});
