/**
 * ENDED, wavelength: the session vocabulary that stands where the podium would.
 *
 * Per docs/superpowers/reviews/2026-08-09-ended-screen-review.md §1.4 —
 * wavelength writes no scores and no Winners, so its ENDED bottom third is the
 * words the room shared across the whole session, combined from each round's
 * STORED analysis. These tests pin the aggregation's claims and the band's
 * honesty rules; nothing geometric is asserted (jsdom has no layout engine).
 *
 * Each test names what it rejects.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import WavelengthSessionVocabulary from '../components/stage/WavelengthSessionVocabulary';
import { aggregateWavelengthSession } from '../utils/wavelength';

/** A round as roundsFrom() delivers it: only wordAnalysis matters here. */
const round = (analysis) => ({ number: '001', wordAnalysis: analysis });

/** A stored analysis in the shape get-results writes. */
const analysis = ({ words, common = [], submitters = 3 }) => ({
  submitterCount: submitters,
  totalWordsSubmitted: words.reduce((s, w) => s + w.count, 0),
  totalUniqueWords: words.length,
  words,
  commonWords: common,
  nearMiss: [],
  matching: 'clustered',
  clustering: 'done',
});

const w = (word, count, members = [word]) => ({ word, count, members });

describe('aggregateWavelengthSession', () => {
  test('a word that landed in any round is unison for the session', () => {
    // rejects: requiring unanimity across ROUNDS — a word everyone said in
    // round one is part of the shared vocabulary even if round two never
    // offered it.
    const landed = w('speed', 3);
    const out = aggregateWavelengthSession([
      round(analysis({ words: [landed, w('cost', 2)], common: [landed] })),
      round(analysis({ words: [w('cloud', 3)], common: [] })),
    ]);
    expect(out.figure).toBe(1);
    expect(out.unison.map((e) => e.word)).toEqual(['speed']);
    expect(out.roundsCounted).toBe(2);
  });

  test('the same idea in two rounds is one entry, counts summed', () => {
    // rejects: keying on the raw label — "Data-Base" in round one and
    // "database" in round two are the idea the server's matchKey already
    // treats as one, and the session view must not re-split it.
    const out = aggregateWavelengthSession([
      round(analysis({ words: [w('Data-Base', 3)], common: [w('Data-Base', 3)] })),
      round(analysis({ words: [w('database', 2)], common: [] })),
    ]);
    expect(out.unison).toHaveLength(1);
    expect(out.unison[0].total).toBe(5);
    expect(out.unison[0].landedIn).toBe(1);
  });

  test('never-landed words said by more than one person are the near tier; loners vanish', () => {
    // rejects: printing every stray word one person typed once — that is the
    // report's job, not the wall's.
    const out = aggregateWavelengthSession([
      round(analysis({ words: [w('cost', 2), w('yak', 1)], common: [] })),
    ]);
    expect(out.figure).toBe(0);
    expect(out.nearMiss.map((e) => e.word)).toEqual(['cost']);
  });

  test('rounds with no analysis are skipped, not counted', () => {
    const out = aggregateWavelengthSession([
      { number: '001', wordAnalysis: null },
      round(analysis({ words: [w('speed', 3)], common: [w('speed', 3)] })),
    ]);
    expect(out.roundsCounted).toBe(1);
  });

  test('unison ranks by rounds landed, then total — deterministically', () => {
    // rejects: whatever-order-the-map-iterates. The wall must be the same
    // wall on every refresh.
    const speedA = w('speed', 3); const trustA = w('trust', 3);
    const speedB = w('speed', 2);
    const out = aggregateWavelengthSession([
      round(analysis({ words: [speedA, trustA], common: [speedA, trustA] })),
      round(analysis({ words: [speedB], common: [speedB], submitters: 2 })),
    ]);
    expect(out.unison.map((e) => e.word)).toEqual(['speed', 'trust']);
    expect(out.unison[0].landedIn).toBe(2);
  });
});

describe('the ENDED band', () => {
  test('unison carries full weight, near-misses are dim with their count', () => {
    const landed = w('speed', 3);
    render(<WavelengthSessionVocabulary rounds={[
      round(analysis({ words: [landed, w('cost', 2)], common: [landed] })),
    ]} />);

    const band = screen.getByTestId('wl-session-vocab');
    expect(band.textContent).toMatch(/1 word the whole room shared/);
    const unisonTerm = screen.getByText('speed').closest('.t');
    expect(unisonTerm.className).toContain('w1');
    expect(unisonTerm.className).not.toContain('wl-dim');
    const nearTerm = screen.getByText('cost').closest('.t');
    expect(nearTerm.className).toContain('wl-dim');
    expect(nearTerm.textContent).toContain('2');
  });

  test('nothing landed → the near tier is the headline, labelled honestly', () => {
    // rejects: an empty band claiming zero under a triumphant heading, and
    // rejects any bare percentage.
    render(<WavelengthSessionVocabulary rounds={[
      round(analysis({ words: [w('cost', 2)], common: [] })),
    ]} />);
    const band = screen.getByTestId('wl-session-vocab');
    expect(band.textContent).toMatch(/No word was on every list/);
    expect(band.textContent).toMatch(/came closest/);
    expect(band.textContent).not.toMatch(/%/);
  });

  test('a session with no analysed round renders nothing at all', () => {
    // rejects: an empty state that lies — a band with no data has no claim
    // to make, and the Podium precedent for wavelength is silence.
    const { container } = render(<WavelengthSessionVocabulary rounds={[]} />);
    expect(container.firstChild).toBeNull();
  });

  test('while the report is loading it says so in a sentence, not a spinner', () => {
    render(<WavelengthSessionVocabulary rounds={[]} loading />);
    expect(screen.getByText(/Reading the rounds back/)).toBeInTheDocument();
  });

  test('the audit trail rides on the term', () => {
    // rejects: dropping the merged members — a disputed merge is settled by
    // looking, and the tooltip is where looking happens (spec §3).
    const landed = w('database', 3, ['database', 'databases', 'dbs']);
    render(<WavelengthSessionVocabulary rounds={[
      round(analysis({ words: [landed], common: [landed] })),
    ]} />);
    expect(screen.getByText('database').closest('.t'))
      .toHaveAttribute('title', 'Counted together: database, databases, dbs');
  });
});
