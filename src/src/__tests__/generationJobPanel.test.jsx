/**
 * GenerationJobPanel — the running screen, the failed screen, and the partial.
 *
 * Pure-props component, so this file contains ZERO jest.mock calls: the recipe
 * from Podium / WelcomeScreen / AdminShell. No geometric assertions either —
 * jsdom has no layout engine and every one of those passes unconditionally.
 *
 * The fixtures are jobToResponse()'s ten keys, read through
 * interpretGenerationJob, because that is what the builders hand this component.
 */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import GenerationJobPanel from '../components/GenerationJobPanel';
import { interpretGenerationJob } from '../utils/generationJob';

const jobResponse = (overrides = {}) => ({
  jobId: 'm4k2p9x7bq1a',
  status: 'running',
  phase: '',
  requested: 0,
  completed: 0,
  items: [],
  warnings: [],
  meta: null,
  error: null,
  updatedAt: '2026-08-11T14:22:06.000Z',
  ...overrides,
});

const questions = (n) => Array.from({ length: n }, (_, i) => ({ title: `Question ${i + 1}` }));

const mount = (job, props = {}) => render(
  <GenerationJobPanel job={interpretGenerationJob(job)} noun="questions" jobId="m4k2p9x7bq1a" {...props} />
);

/** Every button on screen, by its visible label. */
const buttonNames = () => screen.getAllByRole('button').map((b) => b.textContent.trim());

describe('while it is running', () => {
  const running = jobResponse({
    status: 'running',
    phase: 'Generated 34 of 100...',
    requested: 100,
    completed: 34,
    items: questions(34),
  });

  test('the two numbers on the wire reach the screen', () => {
    // rejects: dropping `completed`/`requested`, which are in every poll
    // response today and were read nowhere in src/. Without them the entire
    // in-progress state was a spinner and one line of text.
    const { container } = mount(running);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '34');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    // Both numbers, together, in the one place the eye goes first.
    expect(container.querySelector('.gjp-bignum').textContent.replace(/\s/g, '')).toBe('34/100');
    // The fill is the REAL fraction — 34 of 100 — not an animation standing in
    // for one. rejects: a determinate bar driven by elapsed time.
    expect(container.querySelector('.gjp-fill')).toHaveStyle({ width: '34%' });
  });

  test('there is no Cancel control anywhere, and the screen says why', () => {
    // rejects: adding a Cancel button. There is no cancel route in
    // template-clean.yaml, and the worker never re-reads its job row between
    // passes — it checks only getRemainingTimeInMillis() — so even a flag
    // written by a new endpoint would be invisible to it. A Cancel button would
    // stop you watching while the model calls and their cost continued.
    mount(running, { onKeepRunning: jest.fn() });

    for (const name of buttonNames()) {
      expect(name).not.toMatch(/\b(cancel|stop|abort|kill)\b/i);
    }
    expect(screen.getByText(/It cannot be stopped\./)).toBeInTheDocument();
    expect(screen.getByText(/no cancel endpoint/i)).toBeInTheDocument();
  });

  test('leaving is the primary action, not an escape hatch', () => {
    // rejects: demoting or removing "Close — this keeps running". The job is a
    // server-side worker and this window is only watching it; the previous
    // design's only exit unmounted the component while the polling loop carried
    // on writing into it.
    const onKeepRunning = jest.fn();
    mount(running, { onKeepRunning });

    const close = screen.getByRole('button', { name: /Close — this keeps running/ });
    expect(close).toHaveClass('btn-primary');
    fireEvent.click(close);
    expect(onKeepRunning).toHaveBeenCalled();
  });

  test('it says the progress jumps, because it does', () => {
    // rejects: replacing the honest note with a smooth animation and no
    // explanation. updateJobProgress fires once per completed model call and
    // one call fits 17-67 items, so most requests produce exactly one update.
    mount(running);
    expect(screen.getByText(/one pass at a time, not one question at a time/i)).toBeInTheDocument();
  });

  test('no review or load action is offered while it is still running', () => {
    // rejects: rendering the terminal actions on a live job.
    mount(running, { onKeepRunning: jest.fn(), onReview: jest.fn(), onRetryRemaining: jest.fn() });
    for (const name of buttonNames()) {
      expect(name).not.toMatch(/load into system|review the/i);
    }
  });
});

describe('when it failed with work already written', () => {
  // What failJob(…, { items: produced }) actually leaves in the row.
  const partial = jobResponse({
    status: 'error',
    phase: 'Failed',
    requested: 100,
    completed: 41,
    items: questions(41),
    warnings: [
      'A pass of 19 exceeded the output budget; continuing in smaller passes.',
      'A generation pass produced only duplicates; stopping early.',
    ],
    error: 'rate limited by the AI service (HTTP 429)',
  });

  const terminalProps = {
    onReview: jest.fn(),
    onRetryRemaining: jest.fn(),
    onDiscard: jest.fn(),
    onBackToConfig: jest.fn(),
  };

  test('the primary action is NOT "Load into System"', () => {
    // rejects: THE BUG. Every builder used to render the review table and a
    // live "Load into System" over a failed job, because the branch was
    // `items.length > 0` and a partial failure has items.
    mount(partial, terminalProps);
    for (const name of buttonNames()) {
      expect(name).not.toMatch(/load into system/i);
    }
    expect(screen.getByRole('button', { name: /Review the 41 and make a set/ })).toHaveClass('btn-primary');
  });

  test('it says it stopped, and at what count', () => {
    // rejects: a headline that reads as success. "Generated 41 questions" over
    // a dead job is the sentence this whole slice exists to delete.
    mount(partial, terminalProps);
    expect(screen.getByRole('heading', { name: /Generation stopped at 41 of 100/ })).toBeInTheDocument();
    expect(screen.getByText(/partial result, not a finished set/i)).toBeInTheDocument();
  });

  test('the error string is on screen', () => {
    // rejects: the shipped behaviour, where `Generation failed: …` was written
    // into the branch that only renders when items.length === 0 — i.e. never,
    // for a partial failure.
    mount(partial, terminalProps);
    expect(screen.getByText('rate limited by the AI service (HTTP 429)')).toBeInTheDocument();
  });

  test('the warnings are listed, and the list is not claimed to be complete', () => {
    // rejects: displaying warnings as a full account of what went wrong.
    // failJob does not write `warnings`, so a failed job carries only what the
    // last successful updateJobProgress persisted.
    mount(partial, terminalProps);
    const listed = screen.getAllByRole('listitem').map((li) => li.textContent.trim());
    for (const warning of partial.warnings) {
      expect(screen.getByText(warning)).toBeInTheDocument();
      expect(listed).toContain(warning);
    }
    expect(screen.getByText(/does not record warnings of its own/i)).toBeInTheDocument();
  });

  test('retry asks for the remainder and refuses to call it a resume', () => {
    // rejects: a "Resume" button. The job row is terminal; a resume would have
    // to start a fresh job that does not know what the first one wrote, and
    // would produce duplicates.
    const onRetryRemaining = jest.fn();
    mount(partial, { ...terminalProps, onRetryRemaining });

    fireEvent.click(screen.getByRole('button', { name: /Try again for the remaining 59/ }));
    expect(onRetryRemaining).toHaveBeenCalledWith(59);

    for (const name of buttonNames()) expect(name).not.toMatch(/resume/i);
    expect(screen.getByText(/It cannot resume this one/)).toBeInTheDocument();
  });

  test('all three outcomes are offered: keep, ask again, discard', () => {
    // rejects: returning to "← Back to Configuration" as the only control in
    // any failure branch, which is what shipped.
    mount(partial, terminalProps);
    expect(screen.getByRole('button', { name: /Review the 41/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try again for the remaining 59/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Discard all 41/ })).toBeInTheDocument();
  });
});

describe('when it produced nothing', () => {
  test('a completed job with zero items still reads as a failure', () => {
    // rejects: rendering the success path for completeJob([]) — a real row,
    // written when the first model pass returns no items
    // (generation-handler.js:156-159).
    mount(jobResponse({
      status: 'complete',
      requested: 20,
      completed: 0,
      items: [],
      warnings: ['A generation pass returned no items; stopping early.'],
    }), { onRetryRemaining: jest.fn(), onBackToConfig: jest.fn() });

    expect(screen.getByRole('heading', { name: /produced no questions/i })).toBeInTheDocument();
    expect(screen.getByText('A generation pass returned no items; stopping early.')).toBeInTheDocument();
    for (const name of buttonNames()) expect(name).not.toMatch(/review the|load into system/i);
  });

  test('a failure with no warnings admits it recorded none', () => {
    // rejects: an empty <ul> where an explanation should be. A run that dies in
    // pass 1 has no warnings at all, and silence there reads as "nothing went
    // wrong".
    mount(jobResponse({ status: 'error', requested: 20, items: [], error: 'Bedrock is having a day' }),
      { onRetryRemaining: jest.fn(), onBackToConfig: jest.fn() });

    expect(screen.getByText('None were recorded.')).toBeInTheDocument();
    expect(screen.getByText(/does not record warnings of its own/i)).toBeInTheDocument();
  });
});

describe('when this window lost the job but the job did not stop', () => {
  test('it does not claim the generation ended', () => {
    // rejects: rendering a timeout as a failed job. The client used to give up
    // at ten minutes on a worker allowed fifteen, and a lost connection says
    // nothing at all about the worker.
    const onReconnect = jest.fn();
    render(
      <GenerationJobPanel
        job={interpretGenerationJob(null)}
        noun="questions"
        jobId="m4k2p9x7bq1a"
        transportError="Generation: timed out after 16 minutes. The job may still finish - reopen the builder to check."
        onReconnect={onReconnect}
        onBackToConfig={jest.fn()}
      />
    );

    expect(screen.getByRole('heading', { name: /Lost contact with the job/ })).toBeInTheDocument();
    expect(screen.getByText(/That is not the same as the job\s+stopping/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Try to reconnect/ }));
    expect(onReconnect).toHaveBeenCalled();
  });
});

describe('the noun travels', () => {
  test('a scenario job never calls its items questions', () => {
    // rejects: hardcoding "questions" in the shared panel, which four builders
    // with four different nouns all mount.
    const { container } = render(
      <GenerationJobPanel
        job={interpretGenerationJob(jobResponse({ status: 'error', requested: 10, items: [] }))}
        noun="scenarios"
        onRetryRemaining={jest.fn()}
        onBackToConfig={jest.fn()}
      />
    );
    expect(within(container).getByRole('heading', { name: /produced no scenarios/i })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\bquestions\b/);
  });
});
