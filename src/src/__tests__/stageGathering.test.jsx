/**
 * "GATHERING RESPONSES…", NEVER "[object Object]" (owner, 2026-10-11):
 * "When pulling data on the host screen, at least when showing responses, if
 * the data hasn't been sent yet, it says [object 1] [Object 1] or such, and
 * then the data arrives and replaces it. I think it should say gathering
 * responses… in an active way, so it looks like it's doing something and not
 * an error."
 *
 * The root cause was the server: start-vote.js and reveal-authors.js built
 * their ballots from the raw Query, so on an org session every `answer` was an
 * encryption envelope, and the stage's `“${answer.answer}”` printed it as
 * "[object Object]" beside "Response 1" until get-answers' decrypted refetch
 * replaced it (tests/tenant-crypto-wiring.js pins that half). This file pins
 * the page's half: response text is read through `answerText`, which never
 * stringifies an object, and the wait is a calm, labelled "Gathering…" with a
 * failure that does not spin forever.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { readFileSync } from 'fs';
import { join } from 'path';
import StageGathering from '../components/stage/StageGathering';
import {
  answerText, stageAnswersStatus, stageGatheringNoun,
} from '../config/stageAnswers';

const ENVELOPE = { v: 1, iv: 'h7Wwgo+d', tag: 'F7Md0sXS', ct: '5WjOVKPV' };

describe('answerText: what a response card may print', () => {
  test('a sentence is the sentence', () => {
    expect(answerText('We never wrote the runbook down.')).toBe('We never wrote the runbook down.');
  });
  // rejects: “${answer.answer}” on an envelope — the owner's "[object 1]".
  test('an object (an envelope, a placeholder) prints nothing, never "[object Object]"', () => {
    expect(answerText(ENVELOPE)).toBe('');
    expect(answerText({})).toBe('');
    expect(answerText(['a', 'b'])).toBe('');
    expect(`“${answerText(ENVELOPE)}”`).not.toMatch(/\[object/i);
  });
  test('nothing loaded yet prints nothing, never "undefined" or "null"', () => {
    expect(answerText(undefined)).toBe('');
    expect(answerText(null)).toBe('');
  });
  test('a trivia letter or a number survives', () => {
    expect(answerText('B')).toBe('B');
    expect(answerText(7)).toBe('7');
  });
});

describe('stageAnswersStatus: three states, not two', () => {
  test('VOTE before its own rows have landed is gathering', () => {
    expect(stageAnswersStatus('VOTE#003', 'ASK#003', null)).toBe('gathering');
    expect(stageAnswersStatus('RESULTS#003', 'VOTE#003', null)).toBe('gathering');
  });
  test('once its own rows land, ready — whether or not there are any', () => {
    expect(stageAnswersStatus('VOTE#003', 'VOTE#003', null)).toBe('ready');
  });
  // rejects: a load that fails sitting on "Gathering…" forever.
  test('a load that failed for THIS round-phase is failed', () => {
    expect(stageAnswersStatus('VOTE#003', 'ASK#003', 'VOTE#003')).toBe('failed');
    expect(stageAnswersStatus('RESULTS#3', null, 'RESULTS#003')).toBe('failed');
  });
  test('a failure for another round-phase does not leak into this one', () => {
    expect(stageAnswersStatus('VOTE#004', null, 'VOTE#003')).toBe('gathering');
  });
  test('ASK and the lobby never wait', () => {
    expect(stageAnswersStatus('ASK#003', null, 'ASK#003')).toBe('ready');
    expect(stageAnswersStatus('STARTED', null, null)).toBe('ready');
  });
  test('the noun follows the phase', () => {
    expect(stageGatheringNoun('VOTE#003')).toBe('responses');
    expect(stageGatheringNoun('RESULTS#003')).toBe('results');
  });
});

describe('<StageGathering>', () => {
  test('gathering: the words, as a polite live status, with a decorative indicator', () => {
    const { container } = render(<StageGathering status="gathering" noun="responses" />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent('Gathering responses…');
    const dots = container.querySelector('.gathering__dots');
    expect(dots).not.toBeNull();
    expect(dots).toHaveAttribute('aria-hidden', 'true');
    // rejects: the wait reading as an error.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(container.textContent).not.toMatch(/\[object|error|fail/i);
  });

  test('the noun is the view’s', () => {
    render(<StageGathering status="gathering" noun="results" />);
    expect(screen.getByRole('status')).toHaveTextContent('Gathering results…');
  });

  test('ready draws nothing — the caller draws the cards or the none line', () => {
    const { container } = render(<StageGathering status="ready" noun="responses" />);
    expect(container).toBeEmptyDOMElement();
  });

  test('failed: says so plainly, offers a retry, and stops gathering', () => {
    const retry = jest.fn();
    render(<StageGathering status="failed" noun="responses" onRetry={retry} />);
    expect(screen.queryByText(/Gathering/)).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('The responses did not load.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  test('failed with no retry handler renders no dead button', () => {
    render(<StageGathering status="failed" noun="results" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent('The results did not load.');
  });
});

describe('stage.css: the indicator', () => {
  const CSS = readFileSync(join(__dirname, '..', 'styles', 'stage.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (sel) => {
    const at = CSS.indexOf(`${sel}{`);
    expect(at).toBeGreaterThan(-1);
    return CSS.slice(at, CSS.indexOf('}', at));
  };

  test('the dots animate, in muted grey — never the primary orange', () => {
    const dots = rule('.gathering__dots i');
    expect(dots).toMatch(/animation:\s*gather\b/);
    expect(dots).toMatch(/background:\s*var\(--muted\)/);
    expect(dots).not.toMatch(/--primary|#F6A94C/i);
  });

  // rejects: motion for a viewer who asked for none. The words stay.
  test('reduced motion stops the dots and keeps the words', () => {
    const m = CSS.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*\.gathering__dots i\{([^}]*)\}/);
    expect(m).not.toBeNull();
    expect(m[1]).toMatch(/animation:\s*none/);
    expect(CSS).not.toMatch(/prefers-reduced-motion[^{]*\{[^}]*\.gathering\{[^}]*display:\s*none/);
  });

  test('the words sit on the stage type ladder, never below its floor', () => {
    expect(rule('.gathering')).toMatch(/font-size:\s*var\(--t-body\)/);
  });
});

describe('GameHostPage reads response text through answerText', () => {
  const src = readFileSync(join(__dirname, '..', 'GameHostPage.jsx'), 'utf8');
  // rejects: “${answer.answer}” — the template string that printed the envelope.
  test('no response card interpolates the raw value', () => {
    expect(src).not.toMatch(/“\$\{answer\.answer\}”/);
    expect((src.match(/answerText\(answer\.answer\)/g) || []).length).toBeGreaterThanOrEqual(2);
  });
  test('the VOTE and RESULTS stages show the gathering state while they wait', () => {
    expect(src).toMatch(/stageAnswersStatus\(gameState, answersFor, answersFailedFor\)/);
    expect((src.match(/<StageGathering\b/g) || []).length).toBeGreaterThanOrEqual(2);
  });
  test('a failed VOTE or RESULTS load is recorded, so the stage stops gathering', () => {
    expect((src.match(/markAnswersFailed\(currentState\)/g) || []).length).toBeGreaterThanOrEqual(2);
  });
});
