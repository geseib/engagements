/**
 * THE ANCHOR VOCABULARY — what a comment is attached to.
 *
 * The owner named three things a participant may comment on: *"the summary, the
 * results, a specific user response"*. This suite pins that closed set and, more
 * importantly, pins the two decisions that are easy to get silently wrong:
 *
 *   1. A RESPONSE ANCHOR IS A POSITION, NEVER A RANK. `create-report.js` gives
 *      tied scores equal ranks — 1, 1, 3 — so two rows can both print "1".
 *      `PastRound.jsx` already closes its spotlight handler over the row's own
 *      position for exactly this reason, with a comment saying so. Every tie
 *      fixture below exists to fail an implementation that reads `answer.rank`.
 *
 *   2. A COMMENT CARRIES ITS OWN CONTEXT. The label and the excerpt are stored
 *      on the row at write time, so nothing at read time re-resolves an index
 *      into a response. That is what makes a comment readable in the session
 *      report, where the round it belongs to is not on screen beside it.
 */
import {
  ANCHOR_KINDS,
  MAX_COMMENT,
  MAX_EXCERPT,
  isAnchorKind,
  normalizeAnchorRef,
  anchorLabelFor,
  excerptOf,
} from '../config/comments';

describe('the closed set of anchor kinds', () => {
  test('is exactly the three the owner named', () => {
    expect(ANCHOR_KINDS).toEqual(['summary', 'results', 'response']);
  });

  test('accepts each of them', () => {
    expect(isAnchorKind('summary')).toBe(true);
    expect(isAnchorKind('results')).toBe(true);
    expect(isAnchorKind('response')).toBe(true);
  });

  /*
    The question is deliberately NOT commentable — it is the prompt the room was
    given, not something the room heard. If somebody adds it later it must be a
    deliberate change here, not a value that leaks through because the check was
    a truthiness test.
  */
  test('refuses the question, and every other spelling', () => {
    expect(isAnchorKind('question')).toBe(false);
    expect(isAnchorKind('Summary')).toBe(false);
    expect(isAnchorKind('')).toBe(false);
    expect(isAnchorKind(null)).toBe(false);
    expect(isAnchorKind(undefined)).toBe(false);
    expect(isAnchorKind('response#0')).toBe(false);
  });
});

describe('normalizeAnchorRef', () => {
  test('summary and results carry no ref', () => {
    expect(normalizeAnchorRef('summary', undefined)).toBe('');
    expect(normalizeAnchorRef('results', '4')).toBe('');
  });

  test('a response ref is its decimal position', () => {
    expect(normalizeAnchorRef('response', 0)).toBe('0');
    expect(normalizeAnchorRef('response', '12')).toBe('12');
  });

  /*
    The ref becomes a segment of the sort key. Anything that is not a plain
    non-negative integer is refused rather than coerced: '' would pass a bare
    presence check and a '#' would silently split the key into a shape nothing
    ever queries again. Same guard, same reasoning, as stage-beat.js:147.
  */
  test('refuses anything that would corrupt the sort key', () => {
    expect(normalizeAnchorRef('response', '')).toBe(null);
    expect(normalizeAnchorRef('response', '1#2')).toBe(null);
    expect(normalizeAnchorRef('response', -1)).toBe(null);
    expect(normalizeAnchorRef('response', 1.5)).toBe(null);
    expect(normalizeAnchorRef('response', 'two')).toBe(null);
    expect(normalizeAnchorRef('response', null)).toBe(null);
  });

  test('refuses a kind that is not in the set', () => {
    expect(normalizeAnchorRef('question', '0')).toBe(null);
  });
});

describe('anchorLabelFor', () => {
  test('names the summary and the results plainly', () => {
    expect(anchorLabelFor({ anchorKind: 'summary', anchorRef: '' }, { answers: [] }))
      .toBe('AI summary');
    expect(anchorLabelFor({ anchorKind: 'results', anchorRef: '' }, { answers: [] }))
      .toBe('Results');
  });

  /*
    THE TIE FIXTURE. Both rows carry rank 1, so a label derived from rank reads
    "Response 1" for both and every comment on the second one is filed against
    the first. Position is the only thing that separates them.
  */
  test('labels a response by position, not by rank, when ranks tie', () => {
    const answers = [
      { rank: 1, playerName: 'Dana Whitfield' },
      { rank: 1, playerName: 'Sam Ortiz' },
      { rank: 3, playerName: 'Lee Chen' },
    ];
    expect(anchorLabelFor({ anchorKind: 'response', anchorRef: '0' }, { answers }))
      .toBe('Response 1 — Dana Whitfield');
    expect(anchorLabelFor({ anchorKind: 'response', anchorRef: '1' }, { answers }))
      .toBe('Response 2 — Sam Ortiz');
    expect(anchorLabelFor({ anchorKind: 'response', anchorRef: '2' }, { answers }))
      .toBe('Response 3 — Lee Chen');
  });

  /*
    `playerName` is ABSENT, never null, on a round the server redacted
    (create-report.js:344-354). The label must then name the position alone —
    and must not print "undefined" or an em dash with nothing after it.
  */
  test('names no one when the row carries no author', () => {
    expect(anchorLabelFor({ anchorKind: 'response', anchorRef: '0' }, { answers: [{ rank: 1 }] }))
      .toBe('Response 1');
  });

  test('still yields a readable label when the answers are not to hand', () => {
    expect(anchorLabelFor({ anchorKind: 'response', anchorRef: '9' }, { answers: [] }))
      .toBe('Response 10');
    expect(anchorLabelFor({ anchorKind: 'response', anchorRef: '0' }, {}))
      .toBe('Response 1');
  });
});

describe('excerptOf', () => {
  test('keeps a short passage whole', () => {
    expect(excerptOf('Freeze all discretionary discounting.')).toBe('Freeze all discretionary discounting.');
  });

  /*
    A reduction with no recovery is a deletion (engage-design hard rule 7), and
    the recovery here is the anchor itself — the reader can always open the
    round. So the excerpt may truncate, but it must SAY that it did.
  */
  test('truncates with an ellipsis so the cut is visible', () => {
    const long = 'x'.repeat(MAX_EXCERPT + 50);
    const out = excerptOf(long);
    expect(out.length).toBe(MAX_EXCERPT + 1);
    expect(out.endsWith('…')).toBe(true);
  });

  test('collapses whitespace, so a pasted paragraph does not become a wall', () => {
    expect(excerptOf('one\n\n  two   three')).toBe('one two three');
  });

  test('survives nothing at all', () => {
    expect(excerptOf(undefined)).toBe('');
    expect(excerptOf(null)).toBe('');
    expect(excerptOf('   ')).toBe('');
  });
});

describe('the ceilings', () => {
  /*
    Long enough for a real remark, short enough that a comment cannot become a
    second response smuggled into a round that has already been scored.
  */
  test('a comment is capped at 1000 characters and an excerpt at 140', () => {
    expect(MAX_COMMENT).toBe(1000);
    expect(MAX_EXCERPT).toBe(140);
  });
});
