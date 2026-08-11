/**
 * GameHostPage's half of the fix, checked at the source.
 *
 * This file reads GameHostPage.jsx as text — the same technique
 * gameSession.test.js uses, and for the same reason: the component cannot be
 * rendered in jsdom (it dies on the auth provider), so the alternative to
 * reading the source is not testing this at all. Each assertion below names a
 * specific regression, and each is a shape the shipped bug actually had.
 */
import fs from 'fs';
import path from 'path';

const source = fs.readFileSync(
  path.join(__dirname, '..', 'GameHostPage.jsx'), 'utf8'
);

/** The body of a top-level `const name = ...` arrow function, up to its `\n  };`. */
function functionBody(name) {
  const match = source.match(
    new RegExp(`const ${name} = (?:async )?\\(([^)]*)\\) => \\{([\\s\\S]*?)\\n {2}\\};`)
  );
  return match ? match[2] : null;
}

describe('the AI summary trigger', () => {
  // rejects: reinstating a second, hand-rolled trigger fetch. The shipped bug
  // WAS the second one — the results effect fired its own `generateNew=true`
  // with a `.catch` that logged and cleared the watchdog, so a throw left the
  // host with no request in flight, no notification coming, and no sign of it.
  it('is fired from exactly one place in the file', () => {
    const triggers = source.match(/generateNew=true/g) || [];
    expect(triggers).toHaveLength(1);
  });

  it('lives inside the function that also classifies its failure', () => {
    const body = functionBody('triggerAISummary');
    expect(body).not.toBeNull();
    expect(body).toContain('generateNew=true');
    // Both halves: a non-2xx answer and a throw. Losing either is the bug.
    expect(body).toMatch(/catch \(error\)[\s\S]*classifyAISummaryFailure\(\{ error/);
    expect(body).toMatch(/classifyAISummaryFailure\(\{ status: response\.status/);
  });

  // rejects: going back to console-only failure handling. `setLoadingAIInsights(false)`
  // alone is what produced the deceptive empty state — the spinner stopped and
  // the placeholder took over, which reads as "nothing to summarise yet".
  it('puts a failed trigger on the stage, not just in the console', () => {
    const body = functionBody('startAISummaryGeneration');
    expect(body).not.toBeNull();
    expect(body).toContain('setAiSummaryFailure(result.failure)');
  });

  // rejects: an unbounded or unconditional retry loop. The decision has to come
  // from shouldAutoRetry, which refuses 4xx and stops at the bound.
  it('gates its automatic retry on shouldAutoRetry', () => {
    const body = functionBody('startAISummaryGeneration');
    expect(body).toMatch(/if \(shouldAutoRetry\(result\.failure, attempt\)\)/);
    expect(body).toContain('autoRetryDelayMs(attempt)');
    expect(body).toMatch(/startAISummaryGeneration\(questionId, attempt \+ 1\)/);
  });
});

describe('the wait for the WebSocket notification', () => {
  // rejects: reverting the watchdog to its single silent re-fetch, which ended
  // in `.finally(() => setLoadingAIInsights(false))` — no polling, and no way
  // for the host to learn that nothing had been written.
  it('polls for the persisted summary when the push never lands', () => {
    const body = functionBody('startAIWatchdog');
    expect(body).not.toBeNull();
    expect(body).toContain('pollForAISummary(questionId, 0)');
    expect(body).toContain('AI_NOTIFICATION_TIMEOUT_MS');
  });

  // rejects: polling forever, or polling once and then falling silent.
  it('gives up after a bounded number of polls and says so', () => {
    const body = functionBody('pollForAISummary');
    expect(body).not.toBeNull();
    expect(body).toContain('AI_POLL_ATTEMPTS');
    expect(body).toMatch(/setAiSummaryFailure\(classifyAISummaryFailure\(\{ phase: 'notification'/);
  });
});

describe('the Field Notes surface', () => {
  // rejects: rendering the component but never wiring the failure into it —
  // a recovery surface that nothing can ever reach.
  it('receives the failure and a retry handler', () => {
    expect(source).toMatch(/<AISummaryStatus[\s\S]*?failure=\{aiSummaryFailure\}/);
    expect(source).toMatch(/<AISummaryStatus[\s\S]*?onRetry=\{handleRetryAISummary\}/);
  });

  // rejects: leaving the old inline three-state block behind alongside the
  // component, so the placeholder still renders under a failure.
  it('no longer inlines the placeholder it used to fall through to', () => {
    expect(source).not.toContain('Nothing to read back yet');
  });
});

describe('leaving a game', () => {
  // rejects: carrying a failure banner (or a pending retry timer) from one
  // game into the next. aiSummaryFailure is deliberately NOT on
  // config/gameSession.js's key list, so nothing else clears it.
  it('clears the AI failure and every AI timer', () => {
    const body = functionBody('leaveCurrentGame');
    expect(body).not.toBeNull();
    expect(body).toContain('clearAITimers()');
    expect(body).toContain('setAiSummaryFailure(null)');
  });
});
