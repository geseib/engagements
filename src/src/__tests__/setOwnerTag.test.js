/**
 * WHOSE SET IS THIS — utils/setOwnerTag.js.
 *
 * Asked for as: *"if we create question sets they need to be tagged by the owner
 * the tag maybe 'yours' teams engage or public"*.
 *
 * The four cases are already in the payload — `scope` says which library and
 * `mine` says who made it — so the whole risk here is in the EDGES: an absent
 * scope, an absent `mine`, and the difference between "I made it" and "I am
 * allowed to change it", which are not the same question and have separate
 * fields for that reason.
 */
import {
  setOwnerTag, setOwnerLabel, setOwnerTitle, setOwnerIsOurs,
  YOURS, TEAM, ENGAGE, PUBLIC,
} from '../utils/setOwnerTag';

describe('the four cases', () => {
  test.each([
    ['my own set in my org', { scope: 'org', mine: true }, YOURS, 'Yours'],
    ['a colleague’s set in my org', { scope: 'org', mine: false }, TEAM, 'Team'],
    ['Engage’s shared library', { scope: 'platform' }, ENGAGE, 'Engage'],
    ['another org’s published set', { scope: 'public' }, PUBLIC, 'Public'],
  ])('%s', (_name, set, tag, label) => {
    expect(setOwnerTag(set)).toBe(tag);
    expect(setOwnerLabel(set)).toBe(label);
  });
});

describe('the edges, which is where this can be dangerous', () => {
  /*
    A ROW WITH NO SCOPE IS ENGAGE'S, NOT YOURS. Every set that predates tenancy
    has no scope, and it is what `create-game.js` already means by a payload
    that names none. Guessing "yours" would tell somebody they may edit the
    shared library — the one wrong answer here with a consequence.
  */
  // rejects: defaulting an unscoped row to the reader's own.
  test.each([
    ['no scope at all', {}],
    ['an empty scope', { scope: '' }],
    ['no scope but mine: true', { mine: true }],
    ['null', null],
    ['undefined', undefined],
  ])('%s reads as Engage', (_name, set) => {
    expect(setOwnerTag(set)).toBe(ENGAGE);
  });

  /*
    `mine` IS "I CREATED THIS", NOT "I MAY CHANGE THIS". An org admin passes
    `canManage` on a colleague's set and does NOT pass `mine` —
    admin/get-question-sets.js projects them separately and says so. Deriving
    the tag from `canManage` would label a colleague's set "Yours".
  */
  // rejects: reading canManage instead of mine.
  test('an admin’s power over a colleague’s set does not make it theirs', () => {
    expect(setOwnerTag({ scope: 'org', mine: false, canManage: true })).toBe(TEAM);
  });

  // rejects: an unknown scope falling through to an org answer.
  test('a scope nobody recognises is not treated as the reader’s own', () => {
    expect(setOwnerTag({ scope: 'wat', mine: true })).toBe(ENGAGE);
  });
});

describe('what the chip says on hover', () => {
  // rejects: a tooltip that restates the word. "Yours — this is yours" tells
  // nobody what to do; what they need is whether they can change it.
  test('every tag explains the consequence, not itself', () => {
    for (const set of [
      { scope: 'org', mine: true }, { scope: 'org' }, { scope: 'platform' }, { scope: 'public' },
    ]) {
      const title = setOwnerTitle(set);
      expect(title.length).toBeGreaterThan(20);
      expect(title.toLowerCase()).not.toBe(setOwnerLabel(set).toLowerCase());
    }
  });

  // rejects: the two that need copying failing to say so.
  test('the two you cannot edit both say to copy', () => {
    expect(setOwnerTitle({ scope: 'platform' })).toMatch(/copy/i);
    expect(setOwnerTitle({ scope: 'public' })).toMatch(/copy/i);
  });
});

describe('tone carries the only distinction that changes what you can do', () => {
  /*
    Two tones, not four. Four colours is a legend to memorise on a screen that
    is mostly a list; the word already says which of the four it is. The only
    thing colour needs to carry is editable-or-copy-first.
  */
  // rejects: colour-coding all four, which turns a provenance column into a
  // traffic-light system nobody asked for.
  test('ours vs somebody else’s', () => {
    expect(setOwnerIsOurs({ scope: 'org', mine: true })).toBe(true);
    expect(setOwnerIsOurs({ scope: 'org', mine: false })).toBe(true);
    expect(setOwnerIsOurs({ scope: 'platform' })).toBe(false);
    expect(setOwnerIsOurs({ scope: 'public' })).toBe(false);
  });
});
