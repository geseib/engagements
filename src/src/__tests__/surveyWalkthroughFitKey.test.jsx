/**
 * SurveyWalkthrough's fitKey — fix round 1, C1 (CRITICAL).
 *
 * GameHostPage.jsx's own fitKey carries the identical warning verbatim:
 * "without this a question arriving, an answer list growing or a reveal
 * flipping would re-render the stage and never re-measure it." Without a
 * fitKey that changes with the question and the text page, useStageFit.js's
 * effect (armed with `[profile, phase, fitKey]` inside Stage.jsx) never
 * re-runs when only local state inside SurveyWalkthrough changes — Q1's
 * `--fit` / `data-clamped` would sit on the box for every later, denser
 * question or text page.
 *
 * jsdom has no layout engine, so there is nothing to measure geometrically
 * (every box is 0x0, `over()` is always false, and the search always
 * converges at --fit 1 regardless of content — see stageShell.test.jsx's own
 * header for why this is the honest limit of what jsdom can prove). What CAN
 * be proven without restating SurveyWalkthrough's own implementation is that
 * the fitter is HANDED a different key when the question or text page
 * changes — Stage.jsx passes `fitKey` straight into `useStageFit`'s
 * dependency array, so mocking that hook and reading what it was called with
 * is a black-box observation of the real wiring, not a copy of it.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import useStageFit from '../hooks/useStageFit';
import SurveyWalkthrough from '../components/stage/SurveyWalkthrough';

// jest.mock calls are hoisted above these imports by babel-plugin-jest-hoist
// regardless of where they appear in the file, so the mock is in place before
// Stage.jsx (imported transitively through SurveyWalkthrough) ever resolves
// this module — the import order above is the natural one, not a hazard.
jest.mock('../hooks/useStageFit', () => ({ __esModule: true, default: jest.fn() }));

const q = (title, kind, extra = {}) => ({
  qid: title, n: 1, kind, title, result: { kind, n: 1 }, texts: [], ...extra,
});

const results = (questions) => ({ n: 1, finished: 1, names: 'anonymous', questions });

describe('SurveyWalkthrough hands the fitter a fresh key per question/page', () => {
  beforeEach(() => { useStageFit.mockClear(); });

  it('a different question re-arms the fit (fitKey changes)', () => {
    const short = q('Short question', 'choice', { options: ['A', 'B'], result: { kind: 'choice', n: 1, counts: [1, 0] } });
    const dense = q('Dense question', 'rank', {
      options: ['One', 'Two', 'Three'],
      result: { kind: 'rank', n: 1, avgPlace: [1, 2, 3], placeHist: [[1], [1], [1]], unplaced: [0, 0, 0] },
    });
    render(<SurveyWalkthrough results={results([short, dense])} />);
    expect(useStageFit).toHaveBeenCalled();
    const keyBefore = useStageFit.mock.calls[useStageFit.mock.calls.length - 1][1];

    fireEvent.click(screen.getByRole('button', { name: 'Next result' }));
    const keyAfter = useStageFit.mock.calls[useStageFit.mock.calls.length - 1][1];

    expect(keyAfter).not.toEqual(keyBefore);
  });

  it('turning a text question\'s page also re-arms the fit', () => {
    const textQ = {
      qid: 'q1', n: 1, kind: 'text', title: 'Open answers',
      result: { kind: 'text', n: 7 },
      texts: Array.from({ length: 7 }, (_, i) => ({ id: `t${i}`, text: `Answer ${i + 1}` })),
    };
    render(<SurveyWalkthrough results={results([textQ])} profile="room" />);
    const keyBefore = useStageFit.mock.calls[useStageFit.mock.calls.length - 1][1];

    // room pages 3 at a time — 7 answers is 3 pages, so Next pages within
    // the SAME question rather than moving to a next one.
    fireEvent.click(screen.getByRole('button', { name: 'Next result' }));
    const keyAfter = useStageFit.mock.calls[useStageFit.mock.calls.length - 1][1];

    expect(keyAfter).not.toEqual(keyBefore);
  });
});
