/**
 * WHAT THE TWO "HOW MANY?" FIELDS ADD UP TO — utils/categorySpread.js.
 *
 * The builders ask for a count and a category count as two independent fields,
 * and they are not independent: the pair decides whether the generated set is
 * playable. Twenty questions across twelve categories is under two each, and a
 * host who switches a category on mid-round exhausts it immediately. Fewer
 * questions than categories is worse — some come back empty, and the bill for
 * the generation has already been paid.
 *
 * These assertions are about the sentence, because the sentence is the whole
 * feature. Nothing here measures anything.
 */
import { categorySpread } from '../utils/categorySpread';

describe('the ordinary case', () => {
  // rejects: rounding a ratio to something that reads as a promise the model
  // will not keep — "3 each" when 20/6 is 3.33.
  it('gives a range when the division is not clean', () => {
    expect(categorySpread(20, 6)).toBe('20 questions across 6 categories — about 3–4 each.');
  });

  it('gives one number when it divides evenly', () => {
    expect(categorySpread(20, 5)).toBe('20 questions across 5 categories — about 4 each.');
  });

  it('says "one each" rather than "about 1 each"', () => {
    expect(categorySpread(6, 6)).toBe('6 questions across 6 categories — one each.');
  });
});

describe('the cases worth warning about', () => {
  /*
    THE ONE THAT COSTS MONEY. Asking for more categories than items means the
    model is being told to fill buckets it has nothing for, and what comes back
    is empty categories or categories invented to pad the count. Nothing in the
    interface said so before the generation was paid for.
  */
  // rejects: the warning being softened into the ordinary "about N each" line.
  it('says plainly when there are more categories than items', () => {
    expect(categorySpread(4, 6)).toBe(
      '4 questions across 6 categories — more categories than questions, so some will come back empty.',
    );
  });

  it('says what one category means instead of dividing by it', () => {
    expect(categorySpread(10, 1)).toBe('10 questions across 1 category — all of them together.');
  });
});

describe('the noun follows the engagement type', () => {
  // rejects: a wavelength builder telling a host about "questions".
  it('takes the caller’s noun', () => {
    expect(categorySpread(10, 5, 'prompts')).toContain('10 prompts across 5 categories');
    expect(categorySpread(9, 3, 'scenarios')).toContain('9 scenarios across 3 categories');
  });

  it('singularises for one item', () => {
    expect(categorySpread(1, 1, 'polls')).toBe('1 poll across 1 category — all of them together.');
  });
});

describe('it never throws and never says nonsense', () => {
  // rejects: an empty mid-edit field rendering "NaN questions across …".
  it.each([
    ['', 6],
    [10, ''],
    [undefined, undefined],
    [0, 5],
    [null, 3],
  ])('says nothing at all for (%s, %s)', (items, categories) => {
    expect(categorySpread(items, categories)).toBe('');
  });

  it('floors a fractional count rather than reporting it', () => {
    expect(categorySpread(10.7, 5)).toBe('10 questions across 5 categories — about 2 each.');
  });
});
