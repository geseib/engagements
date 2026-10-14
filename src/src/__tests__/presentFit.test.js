import { sentencesOf, splitEven, minimalK, partText } from '../present/presentFit';

const LONG = 'Design our incident runbooks for the day monitoring can fix the top ten alerts. '
  + 'Scope it to a written spec, not a new platform. '
  + 'Ask on-call to log six weeks of manual fixes. '
  + 'Then test whether they are truly identical! Is that enough? We think so.';

describe('sentencesOf', () => {
  it('splits on sentence ends and keeps every character', () => {
    const s = sentencesOf(LONG);
    expect(s).toHaveLength(6);
    expect(s.join('')).toBe(LONG);
  });
  it('a text with no sentence end is one sentence', () => {
    expect(sentencesOf('just a fragment')).toEqual(['just a fragment']);
    expect(sentencesOf('')).toEqual([]);
  });
});

describe('splitEven', () => {
  it('k=1 is the whole text', () => expect(splitEven(sentencesOf(LONG), 1)).toEqual([LONG.trim()]));
  it('keeps order, loses nothing, and gives exactly k parts when it can', () => {
    for (const k of [2, 3, 4]) {
      const parts = splitEven(sentencesOf(LONG), k);
      expect(parts).toHaveLength(k);
      expect(parts.join(' ').replace(/\s+/g, ' ')).toBe(LONG.trim().replace(/\s+/g, ' '));
    }
  });
  it('is balanced: no part is more than twice another for k=2 on even sentences', () => {
    const even = Array.from({ length: 8 }, (_, i) => `Sentence number ${i} is here. `);
    const [a, b] = splitEven(even, 2);
    expect(a.length / b.length).toBeGreaterThan(0.5);
    expect(a.length / b.length).toBeLessThan(2);
  });
  it('is deterministic', () => {
    expect(splitEven(sentencesOf(LONG), 3)).toEqual(splitEven(sentencesOf(LONG), 3));
  });
  it('never makes more parts than sentences', () => {
    expect(splitEven(['One. ', 'Two.'], 5)).toHaveLength(2);
  });
});

describe('minimalK', () => {
  it('returns the smallest k whose every part fits', () => {
    const fits = (part) => part.length <= 120;
    const k = minimalK(LONG, fits);
    const parts = splitEven(sentencesOf(LONG), k);
    expect(parts.every(fits)).toBe(true);
    if (k > 1) expect(splitEven(sentencesOf(LONG), k - 1).every(fits)).toBe(false);
  });
  it('1 when it fits whole; maxK when nothing fits', () => {
    expect(minimalK(LONG, () => true)).toBe(1);
    expect(minimalK(LONG, () => false, 4)).toBe(4);
    expect(minimalK('One. Two.', () => false, 9)).toBe(2);
  });
});

describe('partText', () => {
  it('slices by the published count and clamps the part', () => {
    expect(partText(LONG, 0, 1)).toBe(LONG.trim());
    expect(partText(LONG, 1, 2)).toBe(splitEven(sentencesOf(LONG), 2)[1]);
    expect(partText(LONG, 9, 2)).toBe(splitEven(sentencesOf(LONG), 2)[1]);
  });
});
