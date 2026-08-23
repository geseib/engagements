/**
 * Wavelength RESULTS on the stage — the vocabulary, not the geometry.
 *
 * jsdom has no layout engine, so nothing here asserts a size or a position
 * (the profile ladders and the fitter own those). What IS asserted is every
 * claim the wall makes, per the convergence spec
 * (docs/superpowers/specs/2026-08-09-wavelength-convergence-design.md):
 *
 *   - the landed words carry full weight; everything else is dim with a count
 *   - the one figure always has its denominator IN WORDS beside it
 *   - nothing landed → the near-miss tier is the headline, labelled honestly
 *   - clustering pending → a sentence, not a spinner (beat one)
 *   - clustering failed/legacy → "matched on exact wording only" is printed
 *   - no bare percentage appears anywhere
 *
 * Each test names the implementation it rejects: a component that prints
 * "92%", one that headlines an empty tier, one that renders raw frequency
 * (the pre-spec game), one whose beat one never resolves.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import fs from 'fs';
import path from 'path';
import WavelengthConvergence from '../components/stage/WavelengthConvergence';
import {
  normalizeWavelengthAnalysis,
  wavelengthHeadline,
  wavelengthMatchingNote,
  wavelengthTerms,
  WAVELENGTH_STAGE_TERM_CAP,
} from '../utils/wavelength';

const src = (...p) => path.join(__dirname, '..', ...p);

/** Source with every comment removed — a previous agent's test passed on one. */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/([^:'"`\\])\/\/.*$/gm, '$1');
}

const word = (w, count, members = [w]) => ({ word: w, count, members });

const landedRound = {
  submitterCount: 12,
  totalWordsSubmitted: 96,
  totalUniqueWords: 4,
  words: [word('trust', 12), word('candor', 12), word('speed', 7), word('scale', 1)],
  commonWords: [word('trust', 12), word('candor', 12)],
  nearMiss: [],
  matching: 'clustered',
  clustering: 'done',
};

const nothingLandedRound = {
  submitterCount: 9,
  totalWordsSubmitted: 41,
  totalUniqueWords: 3,
  words: [word('trust', 8), word('speed', 3), word('scale', 1)],
  commonWords: [],
  nearMiss: [word('trust', 8)],
  matching: 'clustered',
  clustering: 'done',
};

describe('the landed tier and its denominator', () => {
  test('the figure, the claim and the denominator in words are all on screen', () => {
    const { container } = render(<WavelengthConvergence analysis={landedRound} />);
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(container.textContent).toContain('words the whole room shared');
    expect(container.textContent).toContain('all 12 who answered');
  });

  test('landed words render at full weight; offered words are dim with counts', () => {
    const { container } = render(<WavelengthConvergence analysis={landedRound} />);
    const landed = container.querySelectorAll('.terms .t[data-tier="landed"]');
    // Equal counts order alphabetically — deterministic, so the same round
    // always prints the same wall.
    expect([...landed].map((el) => el.textContent)).toEqual(['candor12', 'trust12']);
    landed.forEach((el) => expect(el.className).toContain('w1'));
    landed.forEach((el) => expect(el.className).not.toContain('wl-dim'));

    const offered = container.querySelector('.terms .t[data-tier="offered"]');
    expect(offered.className).toContain('wl-dim');
    expect(offered.querySelector('sup').textContent).toBe('7');
  });

  test('no bare percentage anywhere — "92%" is a claim nobody can interpret', () => {
    const { container } = render(<WavelengthConvergence analysis={landedRound} />);
    expect(container.textContent).not.toMatch(/%/);
  });

  test('a merged cluster explains itself on demand', () => {
    const merged = {
      ...landedRound,
      words: [word('database', 12, ['database', 'databases', 'dbs']), word('scale', 1)],
      commonWords: [word('database', 12, ['database', 'databases', 'dbs'])],
    };
    const { container } = render(<WavelengthConvergence analysis={merged} />);
    expect(container.querySelector('.terms .t[data-tier="landed"]').title)
      .toBe('Counted together: database, databases, dbs');
  });
});

describe('nothing unanimous — the strongest non-empty tier is the headline', () => {
  test('the near-miss copy replaces the figure and stays honest about the gap', () => {
    const { container } = render(<WavelengthConvergence analysis={nothingLandedRound} />);
    expect(container.textContent).toContain('No word was on every list');
    expect(container.textContent).toContain('came closest');
    expect(container.textContent).toContain('said by 8 of all 9 who answered');
  });

  test('nothing shared at all is stated, not padded into a result', () => {
    const empty = {
      ...nothingLandedRound,
      words: [word('trust', 1), word('speed', 1)],
      nearMiss: [],
      totalUniqueWords: 2,
    };
    const { container } = render(<WavelengthConvergence analysis={empty} />);
    expect(container.textContent).toContain('No two lists shared a word');
  });
});

describe('the two beats', () => {
  test('beat one is a sentence about what is happening, with no terms yet', () => {
    const pending = { ...landedRound, matching: 'exact', clustering: 'pending' };
    const { container } = render(<WavelengthConvergence analysis={pending} />);
    expect(container.textContent).toContain('Matching the room');
    expect(container.querySelector('.terms')).toBeNull();
  });

  test('the watchdog resolves beat one to the exact result, announced as exact', () => {
    jest.useFakeTimers();
    try {
      const pending = { ...landedRound, matching: 'exact', clustering: 'pending' };
      const { container } = render(<WavelengthConvergence analysis={pending} />);
      expect(container.querySelector('.terms')).toBeNull();
      const { act } = require('@testing-library/react');
      act(() => { jest.advanceTimersByTime(21000); });
      expect(container.querySelector('.terms')).not.toBeNull();
      expect(container.textContent).toContain('Matched on exact wording only');
    } finally {
      jest.useRealTimers();
    }
  });

  test('a failed clustering run prints the exact-wording note immediately', () => {
    const failed = { ...landedRound, matching: 'exact', clustering: 'failed' };
    const { container } = render(<WavelengthConvergence analysis={failed} />);
    expect(container.querySelector('.terms')).not.toBeNull();
    expect(container.textContent).toContain('Matched on exact wording only');
  });

  test('a clustered result carries no degradation note', () => {
    const { container } = render(<WavelengthConvergence analysis={landedRound} />);
    expect(container.textContent).not.toContain('exact wording only');
  });
});

describe('normalisation — legacy stored rounds (7-day TTL) still render honestly', () => {
  test('a pre-spec round is re-read under the unanimity rule, never the count>1 claim', () => {
    const legacy = normalizeWavelengthAnalysis({
      totalAnswers: 3,
      totalWordsSubmitted: 7,
      totalUniqueWords: 3,
      commonWords: [{ word: 'summit', count: 2 }], // the old, wrong tier
      wordCounts: { summit: 2, ridge: 3, valley: 1 },
      connectionScore: 66,
    });
    // ridge was said by all 3 — it lands; summit (2 of 3) does not.
    expect(legacy.landed.map((w) => w.word)).toEqual(['ridge']);
    expect(legacy.clustering).toBe('legacy');
    expect(wavelengthMatchingNote(legacy)).toContain('exact wording only');
  });

  test('an unrecognisable payload renders nothing rather than something wrong', () => {
    const { container } = render(<WavelengthConvergence analysis={{ bogus: true }} />);
    expect(container.firstChild).toBeNull();
    expect(normalizeWavelengthAnalysis(null)).toBeNull();
  });
});

describe('the term cap states its own reduction', () => {
  test('a long tail is cut with the cut announced and the report named', () => {
    const many = {
      submitterCount: 6,
      totalWordsSubmitted: 120,
      totalUniqueWords: 40,
      words: Array.from({ length: 40 }, (_, i) => word(`idea${String(i).padStart(2, '0')}`, i < 2 ? 6 : 1)),
      commonWords: Array.from({ length: 2 }, (_, i) => word(`idea0${i}`, 6)),
      nearMiss: [],
      matching: 'clustered',
      clustering: 'done',
    };
    const { terms, reduction } = wavelengthTerms(normalizeWavelengthAnalysis(many));
    expect(terms).toHaveLength(WAVELENGTH_STAGE_TERM_CAP);
    expect(reduction).toContain('session report');
    // The landed words survive every cut.
    expect(terms.filter((t) => t.tier === 'landed')).toHaveLength(2);
  });

  test('a short list is shown whole with no reduction claimed', () => {
    expect(wavelengthTerms(normalizeWavelengthAnalysis(landedRound)).reduction).toBeNull();
  });
});

describe('the headline never claims without a denominator', () => {
  test.each([
    [landedRound],
    [nothingLandedRound],
  ])('every headline names who it counted', (analysis) => {
    const h = wavelengthHeadline(normalizeWavelengthAnalysis(analysis));
    expect(`${h.label} ${h.sub}`).toMatch(/all \d+ who answered/);
  });
});

describe('the call sites — GameHostPage actually wires all of this', () => {
  const host = stripComments(fs.readFileSync(src('GameHostPage.jsx'), 'utf8'));

  test('the stage renders WavelengthConvergence from wavelengthAnalysis, not the packed cloud', () => {
    expect(host).toMatch(/<WavelengthConvergence analysis=\{wavelengthAnalysis\}/);
    expect(host).not.toMatch(/<WavelengthWordCloud/);
  });

  test('beat two is subscribed AND unsubscribed — the registered/removed symmetry', () => {
    expect(host).toMatch(/onMessage\('wavelengthAnalysisReady'/);
    expect(host).toMatch(/offMessage\('wavelengthAnalysisReady'\)/);
  });

  test('the analysis is set from BOTH result paths (close-round and state restore)', () => {
    const sets = host.match(/setWavelengthAnalysis\(resultsData\.wordAnalysis \|\| null\)/g) || [];
    expect(sets.length).toBeGreaterThanOrEqual(2);
  });

  test('a new round clears the previous round\'s analysis', () => {
    expect(host).toMatch(/setAnswers\(\[\]\);\s*setWavelengthAnalysis\(null\)/);
  });
});

describe('ASK shows the term and NOTHING about it — the AI Jargon report', () => {
  // The owner, off the AI Jargon set: "we dont want to give them ideas of the
  // meaning, we are looking to them to share their meaning." A stored detail
  // sentence is a definition, so no wavelength ASK surface may render one —
  // whatever the set carries. Source-scanned because neither page mounts in
  // jsdom (auth provider), following this file's call-sites pattern.
  const host = stripComments(fs.readFileSync(src('GameHostPage.jsx'), 'utf8'));
  const player = stripComments(fs.readFileSync(src('PlayerPage.jsx'), 'utf8'));

  test('the host stage detail line is gated off wavelength', () => {
    expect(host).toMatch(/currentGameType !== 'wavelength'\s*&&\s*\(currentQuestion\.questionDetail/);
  });

  test('no screen renders the retired topic field', () => {
    // rejects: reintroducing `currentQuestion.topic` — it printed the
    // subject's framing on the projector and on phones.
    expect(host).not.toMatch(/\.topic\b/);
    expect(player).not.toMatch(/\.topic\b/);
  });

  test('the player detail chain resolves wavelength to null', () => {
    expect(player).toMatch(/gameType === 'wavelength'\s*\?\s*null/);
  });
});
