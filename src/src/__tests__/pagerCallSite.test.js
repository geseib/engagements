/**
 * THE CALL SITE, WHICH IS WHERE THIS KIND OF FEATURE ACTUALLY BREAKS.
 *
 * `GameHostPage` cannot mount in jsdom (seven precedents), so the wiring is read
 * from the source. That is crude and it is also the answer to this repo's
 * standing failure mode, recorded in RESUME.md: an extracted, tested rule that
 * the page then calls with an argument missing. `shortcutsSuppressed` is the
 * named example — deleting an argument at its call site reinstated the defect
 * with the whole suite green.
 *
 * Comments are stripped FIRST. A source assertion that passes on a comment is
 * one of the six tests-that-proved-nothing this repo caught in a week, and every
 * doc-block added by this change quotes the code it describes.
 */
const { readFileSync } = require('fs');
const { join } = require('path');

const SOURCE = readFileSync(join(__dirname, '..', 'GameHostPage.jsx'), 'utf8');
const CODE = SOURCE
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map((line) => line.replace(/(^|\s)\/\/.*$/, '$1'))
  .join('\n');

/** The JSX element starting at `<Name`, up to its closing bracket. */
function elementAt(source, name, from = 0) {
  const at = source.indexOf(`<${name}`, from);
  if (at === -1) return null;
  return source.slice(at, source.indexOf('/>', at) + 2);
}

describe('the stage pages its answer list, and the page keys obey the existing suppressor', () => {
  test('comments really were stripped', () => {
    // The guard on every other assertion in this file. `Pager` is named a dozen
    // times in the doc-blocks this change added.
    ['NOT A CAROUSEL AND NOT A CLIFF', 'RESULTS PAGES TOO'].forEach((phrase) => {
      expect(SOURCE).toContain(phrase);
      expect(CODE).not.toContain(phrase);
    });
  });

  test('the page keys are gated on the SAME value as the advance key', () => {
    // THE ONE THIS FILE EXISTS FOR. `enabled` is the pager's whole suppression
    // story, and passing a literal `true` — or forgetting the prop, which
    // defaults to true — is invisible in every component test.
    //
    // rejects: `enabled` hardcoded, omitted, or computed from a second,
    // parallel rule that then drifts from shortcutsSuppressed.
    const el = elementAt(CODE, 'Pager');
    expect(el).not.toBeNull();
    expect(el).toMatch(/enabled=\{!anyOverlayOpen\}/);

    // ...and `anyOverlayOpen` is still the existing mechanism, not a new
    // boolean that happens to share its name.
    expect(CODE).toMatch(/const anyOverlayOpen = shortcutsSuppressed\(\{/);
    const at = CODE.indexOf('shortcutsSuppressed({');
    const args = CODE.slice(at, CODE.indexOf('})', at));
    ['showConfirmModal', 'showExpandedQR', 'showReportsModal', 'lessonExpanded',
      'isLoadingData', 'qrMode'].forEach((arg) => {
      expect(args).toMatch(new RegExp(`\\b${arg}\\b`));
    });
  });

  test('both list states get one — VOTE and the open-answer RESULTS', () => {
    // rejects: paging VOTE and leaving RESULTS to be cut off. RESULTS is the
    // WORSE case: the meter is null there, so `.main` is solo from the start
    // and the fitter's cheapest lever — taking the meter's column — does not
    // exist. Everything it has left removes content.
    expect(CODE.match(/<Pager\b/g)).toHaveLength(2);
    const votePager = elementAt(CODE, 'Pager');
    const resultsPager = elementAt(CODE, 'Pager', CODE.indexOf('<Pager') + 1);

    // ...and RESULTS' one is guarded by the GAME TYPE, not by anything that
    // could quietly become false. Counting elements is not enough: wrapping the
    // second one in `{false && (` leaves the count at two and the state unpaged.
    // Trivia is at most six options with a column-count lever of its own and
    // wavelength is one drawing rather than a list, so those two — and only
    // those two — are excluded by construction.
    expect(CODE).toMatch(
      /\{currentGameType !== 'trivia' && currentGameType !== 'wavelength' && \(\s*<Pager/
    );

    [votePager, resultsPager].forEach((el) => {
      expect(el).toMatch(/total=\{answers\.length\}/);
      expect(el).toMatch(/page=\{answerPage\.page\}/);
      expect(el).toMatch(/pageSize=\{stagePageSize\}/);
      expect(el).toMatch(/onPage=\{setAnswerPage\}/);
    });
  });

  test('the page size comes from the display profile, not from a constant', () => {
    // rejects: `pageSize={3}`. The owner's report names the large displays
    // specifically, and TV's ladder is the one that holds least — a literal is
    // the version that keeps cutting TV off.
    expect(CODE).toMatch(/const stagePageSize = pageSizeFor\(profile\)/);
    expect(SOURCE).toMatch(/import \{ pageSizeFor, pageSlice \} from '\.\/config\/stagePaging'/);
  });

  test('every card is labelled by its ABSOLUTE index, on both states', () => {
    // THE POSITIONAL-LABEL TRAP. `displayLabelFor(answer, idx)` renders
    // `Response ${idx + 1}` and PlayerPage renders the same label from the same
    // index on every phone in the room. Mapping a page with a fresh counter
    // labels page two's first card "Response 1" on the projector while twelve
    // phones call it "Response 4".
    //
    // rejects: `answerPage.items.map((answer, idx) => ...)`, which is the
    // shortest edit that makes paging appear to work.
    const maps = CODE.match(/answerPage\.items\.map\(\([^)]*\)/g) || [];
    expect(maps).toHaveLength(2);
    maps.forEach((m) => expect(m).toMatch(/\(answer, i\)/));
    const offsets = CODE.match(/const idx = answerPage\.offset \+ i;/g) || [];
    expect(offsets).toHaveLength(2);
    // And the labels are still derived from that index rather than from the
    // page-local one.
    expect(CODE).toMatch(/displayLabelFor\(answer, idx\)/);
    expect(CODE).toMatch(/stageLabelFor\(answer, idx,/);
  });

  test('a page turn re-measures the stage', () => {
    // rejects: leaving the page out of fitKey. A turn replaces every card
    // without changing any of the other counts in that array, so the fitter
    // would keep the scale it found for the previous page — and a page of long
    // responses would be clipped by a scale chosen for a page of short ones.
    const at = CODE.indexOf('fitKey={[');
    expect(at).toBeGreaterThan(-1);
    const fitKey = CODE.slice(at, CODE.indexOf('].join', at));
    expect(fitKey).toMatch(/answerPage\.page/);
    expect(fitKey).toMatch(/stagePageSize/);
  });

  test('the page is scoped to the beat, with no reset effect', () => {
    // rejects: a bare `useState(0)` plus a `useEffect` that resets it. RESUME.md
    // records the `resultsBeat` reset effect as fragile ON PURPOSE and already
    // responsible for one live defect — an effect resets on dependency changes
    // nobody intended. A key comparison cannot: a new beat simply reads 0.
    //
    // Also rejects a key of `hostPhase` alone, which would hold a page across
    // rounds within one phase, so round 4's VOTE would open on page 3.
    expect(CODE).toMatch(/const pageKey = `\$\{hostPhase\}#\$\{lessonNumber\}`/);
    expect(CODE).toMatch(
      /stagePage && stagePage\.key === pageKey \? stagePage\.index : 0/
    );
    expect(CODE).toMatch(/setStagePage\(\{ key: pageKey, index \}\)/);
  });

  test('the answer list is sliced through the module, not by hand', () => {
    // rejects: `answers.slice(page * size, ...)` inline, which skips clampPage
    // — and a host parked past the end of a list that has shrunk gets a blank
    // projector, indistinguishable from a crash from twenty-five feet.
    expect(CODE).toMatch(/const answerPage = pageSlice\(\s*answers,/);
    expect(CODE).not.toMatch(/answers\.slice\(/);
  });
});

describe('the dock carries the count the fitter takes away', () => {
  test('the dock is handed the meter\'s own heading and body', () => {
    // rejects: building a second fraction for the dock. Two sources for one
    // number is how they drift, and this stage's whole binding constraint is
    // that a fact is stated exactly once.
    const at = CODE.indexOf('<Dock');
    expect(at).toBeGreaterThan(-1);
    const el = CODE.slice(at, CODE.indexOf('>', CODE.indexOf('complete={everybodyIn}', at)));
    expect(el).toMatch(/progress=\{meter \? \{ \.\.\.meter, complete: everybodyIn \} : null\}/);
  });

  test('the meter and the mirror are fed the same completion judgement', () => {
    // rejects: `complete` on one and not the other, which would leave the
    // largest profile — the one that loses the meter most often — with a count
    // that never turns over.
    const meterEl = elementAt(CODE, 'RoomMeter');
    expect(meterEl).toMatch(/complete=\{everybodyIn\}/);
    expect(CODE).toMatch(/const everybodyIn = roomIsComplete\(\{/);
  });
});
