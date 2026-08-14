/**
 * FILL, REFINE, LOCK — the browser's half, tested without mounting anything.
 *
 * The owner: *"i do wish there was an AI helper that filled out the forms for
 * the user based on some prelim info they offered … or if the user filled those
 * in the ai would refine (unless locked, a small icon lock/unlock on cells."*
 *
 * `utils/fieldDrafting.js` is where a proposal becomes a form value, so it is
 * where the two guarantees live: a locked field is never written, and a
 * "refinement" that threw the operator's words away is held rather than applied.
 * Both are pure functions on purpose — the three AI builders are 800-1300 line
 * components and this repo's rule is that logic which matters lives somewhere a
 * test can call it directly.
 *
 * SECTION 5 IS THE DRIFT GUARD. The field list exists twice — CommonJS in the
 * lambda bundle, ESM in this build, because the two cannot import each other —
 * and jest runs in node, so it can load both and prove they still agree.
 */

import {
  applyFieldDraft,
  classifyField,
  distinctiveTokens,
  dropEditedSince,
  retention,
  isLocked,
  lockedKeys,
  hasSeedContent,
  hasUnlockedField,
  REFINE_RETENTION_MIN,
} from '../utils/fieldDrafting';
import { BUILDER_FORM_FIELDS, fieldLabel } from '../config/builderFormFields';

const FIELDS = BUILDER_FORM_FIELDS.scenario.fields;

/** The realistic case: only the description box filled in. */
const SEEDED = {
  customTitle: '',
  context: 'Support keeps escalating billing disputes to engineering because nobody owns refunds.',
  audience: '',
  mustHaveCategories: '',
  customPrompt: '',
};

const FULL_DRAFT = {
  customTitle: 'Owning The Refund Path',
  context: 'Support escalates billing disputes to engineering because refunds have no owner.',
  audience: 'Support leads and engineering managers',
  mustHaveCategories: 'Escalation, Ownership, Customer Trust',
  customPrompt: 'Write scenarios where the ownership gap is the real problem.',
};

const apply = (item, values, locked = []) =>
  applyFieldDraft(item, { fields: FIELDS, values, locked });

describe('1. the lock — refused on the way into the form', () => {
  test('a locked field is never written, even when the response carries one', () => {
    // rejects: trusting the server to have stripped it. The browser talks to
    // whatever Lambda is deployed, and a lock is the one promise in this feature
    // the operator relies on absolutely — it has to survive a stale backend, a
    // replayed job id and a hand-rolled response.
    const result = apply(FULL_DRAFT, { ...SEEDED, audience: 'Frontline support only' }, ['audience']);
    expect(result.patch.audience).toBeUndefined();
    expect(result.refined).not.toContain('audience');
    expect(result.held.audience).toBeUndefined();
  });

  test('a locked field that came back is REPORTED, not silently dropped', () => {
    // rejects: `continue` with no record. A locked key arriving at all means a
    // server-side guarantee failed; swallowing it hides the only evidence.
    const result = apply(FULL_DRAFT, SEEDED, ['audience']);
    expect(result.blocked).toEqual(['audience']);
  });

  test('nothing is reported as blocked when the server behaved', () => {
    // rejects: pushing every locked field into `blocked` regardless. The console
    // prints a "the AI returned a locked field" warning off this array, and one
    // that is always non-empty trains the operator to ignore it.
    const { audience, ...withoutAudience } = FULL_DRAFT;
    expect(apply(withoutAudience, SEEDED, ['audience']).blocked).toEqual([]);
  });

  test('locking an EMPTY field stops it being filled in', () => {
    // rejects: checking content before the lock — `if (empty) fill` written
    // ahead of `if (locked) skip`. "Do not invent an audience for me" is an
    // ordinary thing to want and is exactly what a content-first branch breaks.
    const result = apply(FULL_DRAFT, SEEDED, ['audience', 'customTitle']);
    expect(result.patch.audience).toBeUndefined();
    expect(result.patch.customTitle).toBeUndefined();
    expect(result.filled).toEqual(['mustHaveCategories', 'customPrompt']);
  });

  test('classifyField calls a locked field locked whether or not it has words', () => {
    // rejects: a classifier that returns 'refine' for a locked field with
    // content. The plan list in the panel is drawn from this, so it would
    // promise to refine a field the request will not even ask about.
    expect(classifyField({ audience: 'x' }, ['audience'], 'audience')).toBe('locked');
    expect(classifyField({ audience: '' }, ['audience'], 'audience')).toBe('locked');
    expect(classifyField({ audience: 'x' }, [], 'audience')).toBe('refine');
    expect(classifyField({ audience: '   ' }, [], 'audience')).toBe('fill');
  });

  test('a Set and an array of locked keys mean the same thing', () => {
    // rejects: `locked.includes(...)` alone. The components hold a Set and the
    // wire carries an array; a check that understands only one of them silently
    // locks nothing on whichever side it does not understand.
    expect(isLocked(new Set(['audience']), 'audience')).toBe(true);
    expect(isLocked(['audience'], 'audience')).toBe(true);
    expect(isLocked(new Set(['audience']), 'context')).toBe(false);
    expect(isLocked(null, 'context')).toBe(false);
  });

  test('lockedKeys sends only keys this form has, in the form\'s own order', () => {
    // rejects: forwarding the raw Set to the server. A stale key from another
    // builder would travel with the request; the server ignores it, but the
    // panel's own plan list would then disagree with what was sent.
    expect(lockedKeys(new Set(['audience', 'nonsense']), FIELDS)).toEqual(['audience']);
  });
});

describe('2. fill — an empty field', () => {
  test('a blank field takes the proposal outright', () => {
    // rejects: holding everything back for confirmation. There is nothing to
    // destroy in an empty box, and a helper that makes you approve four empty
    // fields one at a time is not the helper that was asked for.
    const result = apply(FULL_DRAFT, SEEDED);
    expect(result.patch.customTitle).toBe(FULL_DRAFT.customTitle);
    expect(result.filled).toEqual(['customTitle', 'audience', 'mustHaveCategories', 'customPrompt']);
  });

  test('a field the model said nothing about is left alone, not cleared', () => {
    // rejects: writing every key of the item, present or not. `undefined` and
    // `''` would both land in the form and wipe what the operator typed.
    const result = apply({ customTitle: 'A Title' }, { ...SEEDED, audience: 'Support leads' });
    expect(result.patch.audience).toBeUndefined();
    expect(Object.keys(result.patch)).toEqual(['customTitle']);
  });

  test('an empty-string proposal is not an instruction to clear the field', () => {
    // rejects: treating '' as a value. Nothing in this feature ever means
    // "delete what you wrote", and a model returning a blank string for a field
    // it had nothing to say about is ordinary.
    const result = apply({ audience: '   ' }, { ...SEEDED, audience: 'Support leads' });
    expect(result.patch.audience).toBeUndefined();
    expect(result.refined).toEqual([]);
  });

  test('whitespace in the form counts as empty, so it is filled not refined', () => {
    // rejects: `if (values[key])` on an untrimmed string. A stray space would
    // make an empty box look written, and the proposal would be measured for
    // retention against nothing.
    const result = apply(FULL_DRAFT, { ...SEEDED, audience: '   ' });
    expect(result.filled).toContain('audience');
    expect(result.refined).not.toContain('audience');
  });
});

describe('3. refine — a field the operator wrote', () => {
  const MINE = 'we want scenarios about billing disputes at BillingCo escalating to engineering';

  test('a genuine tightening keeps their words and is applied', () => {
    // rejects: holding every proposal for a written field. That is the
    // set-metadata drafter's behaviour and it is NOT what was asked for here —
    // the owner's word is "refine", and a refinement you have to approve one
    // field at a time is a proposal, not a refinement.
    const refined = 'Scenarios about billing disputes at BillingCo escalating to engineering when no one owns the refund.';
    const result = apply({ context: refined }, { ...SEEDED, context: MINE });
    expect(result.patch.context).toBe(refined);
    expect(result.refined).toEqual(['context']);
    expect(result.held.context).toBeUndefined();
  });

  test('a rewrite that threw their words away is HELD, not applied', () => {
    // rejects: applying whatever comes back for a written field. THIS IS THE
    // ONE THAT MATTERS. The prompt asks for their words improved; asking is not
    // enforcing, and a model that reached for its own vocabulary has replaced
    // the operator's paragraph with something else. Nothing here is saved yet,
    // but they would have no way back to their own sentence.
    const rewrite = 'Explore cross-functional friction through workplace vignettes.';
    const result = apply({ context: rewrite }, { ...SEEDED, context: MINE });
    expect(result.patch.context).toBeUndefined();
    expect(result.held.context).toBe(rewrite);
    expect(result.refined).toEqual([]);
  });

  test('an applied refinement records exactly what it replaced', () => {
    // rejects: applying without keeping the previous text. Undo is what makes
    // auto-applying a refinement defensible at all; re-deriving the old value
    // later is impossible once the input has been overwritten.
    const refined = `${MINE}, with the refund owner named in each one.`;
    const result = apply({ context: refined }, { ...SEEDED, context: MINE });
    expect(result.previous.context).toBe(MINE);
  });

  test('a proposal identical to theirs is UNCHANGED, not a refinement', () => {
    // rejects: counting an untouched field as refined. The prompt tells the
    // model to return the operator's text unchanged when it cannot improve it,
    // so this is the expected answer — and a screen claiming it refined a field
    // it did not touch is a lie the operator will act on.
    const result = apply({ context: `  ${MINE}  ` }, { ...SEEDED, context: MINE });
    expect(result.unchanged).toEqual(['context']);
    expect(result.refined).toEqual([]);
    expect(result.patch.context).toBeUndefined();
  });

  test('the retention threshold is the thing deciding it, at the boundary', () => {
    // rejects: quietly moving the threshold, or comparing with `>` instead of
    // `>=`. Four of the operator's eight distinctive words is exactly half —
    // the documented floor — and must still be treated as a refinement.
    const mine = 'alpha bravo charlie delta echo foxtrot golf hotel';
    const halfKept = 'alpha bravo charlie delta something entirely different words here';
    expect(retention(mine, halfKept)).toBeCloseTo(0.5);
    expect(REFINE_RETENTION_MIN).toBe(0.5);
    const result = apply({ context: halfKept }, { ...SEEDED, context: mine });
    expect(result.refined).toEqual(['context']);

    const belowFloor = 'alpha bravo charlie something entirely different words here';
    expect(retention(mine, belowFloor)).toBeLessThan(0.5);
    expect(apply({ context: belowFloor }, { ...SEEDED, context: mine }).held.context).toBe(belowFloor);
  });

  test('retention ignores case, punctuation and word order', () => {
    // rejects: comparing raw strings or substrings. Adding a comma or moving a
    // clause is precisely what refining IS; a comparison that calls that a
    // replacement holds back every real refinement.
    // "refunds" and "support" survive a case change, an em dash, a bang and a
    // reordering; only the inflected "owned"→"owns" is lost, which is the next
    // test's subject.
    expect(retention('Refunds owned by Support', 'Support — which owns the refunds!')).toBeCloseTo(2 / 3);
    expect(retention('Refunds owned by Support', 'support, which owned refunds')).toBe(1);
  });

  test('it does NOT stem, and the cost of that is bounded', () => {
    // Not a rejection so much as a limit, written down so the next reader does
    // not discover it by surprise: "owned" and "owns" are different tokens, so
    // an inflection change costs one token of retention. That is why the floor
    // is a half rather than something high — a handful of inflections must not
    // be able to push a genuine refinement under it.
    //
    // rejects: raising REFINE_RETENTION_MIN towards 1 without adding stemming.
    // The sentence below is an honest refinement and would start being held.
    const mine = 'the support team escalates billing disputes to engineering';
    const refined = 'The support team escalated billing disputes to engineering, and nobody owned the refund.';
    expect(retention(mine, refined)).toBeGreaterThanOrEqual(REFINE_RETENTION_MIN);
  });

  test('retention keeps short numeric tokens, which are what a rewrite loses', () => {
    // rejects: a blanket "drop tokens shorter than three characters". "40",
    // "3x" and "Q4" are exactly the specifics a replacement quietly drops, and
    // dropping them from the measurement makes the measurement blind to it.
    expect(distinctiveTokens('40 managers in Q4')).toContain('40');
    expect(retention('40 managers in Q4', 'several managers later in the year')).toBeLessThan(1);
  });

  test('an empty original scores 1 rather than dividing by zero', () => {
    // rejects: `kept / mine.size` with no guard. NaN compares false against the
    // threshold, so every fill would silently be held instead of applied.
    expect(retention('', 'anything at all')).toBe(1);
    expect(retention('   ', 'anything at all')).toBe(1);
  });
});

describe('3b. what the operator typed while the job ran', () => {
  test('a field edited since the request went out is dropped from the patch', () => {
    // rejects: merging the patch into the live state. Found by a test rather
    // than by reasoning: the job takes seconds and the operator keeps typing, so
    // a proposal for a field that was blank when the request left would land on
    // top of a sentence the model never saw. That is the same data-loss bug the
    // whole feature exists to avoid, one layer down.
    const snapshot = { audience: '', customTitle: '' };
    const latest = { audience: 'Only the support leads', customTitle: '' };
    const result = dropEditedSince(
      { audience: 'Support leads and engineering managers', customTitle: 'A Title' },
      { snapshot, latest },
    );
    expect(result.patch).toEqual({ customTitle: 'A Title' });
    expect(result.stale).toEqual(['audience']);
  });

  test('an untouched field is not called stale by a whitespace difference', () => {
    // rejects: comparing raw strings. A trailing newline from a textarea would
    // make every field look edited and the helper would apply nothing at all.
    const result = dropEditedSince({ audience: 'New' }, {
      snapshot: { audience: 'Old' }, latest: { audience: ' Old ' },
    });
    expect(result.patch).toEqual({ audience: 'New' });
    expect(result.stale).toEqual([]);
  });
});

describe('4. the preconditions the panel disables its button on', () => {
  test('an entirely empty form has nothing to work from', () => {
    // rejects: letting the model write the whole form from nothing. It invents a
    // session about a company that does not exist, and the operator cannot tell
    // an invention from a proposal.
    expect(hasSeedContent(FIELDS, {})).toBe(false);
    expect(hasSeedContent(FIELDS, { audience: '  ' })).toBe(false);
    expect(hasSeedContent(FIELDS, { context: 'something' })).toBe(true);
  });

  test('a form with every field locked has nothing to write into', () => {
    // rejects: spending a generation whose entire output is discarded on arrival
    // by design.
    expect(hasUnlockedField(FIELDS, new Set(FIELDS.map((f) => f.key)))).toBe(false);
    expect(hasUnlockedField(FIELDS, new Set(['audience']))).toBe(true);
  });
});

describe('5. the two copies of the field list still agree', () => {
  // The lambda bundle is CommonJS and unreachable from this ESM build, so the
  // field list is written twice. jest runs in node, which can load both.
  // eslint-disable-next-line global-require
  const server = require('../../../lambda-functions/admin/shared/builder-form-fields.js');
  const serverDrafting = require('../../../lambda-functions/admin/shared/field-drafting.js');

  test.each(Object.keys(BUILDER_FORM_FIELDS))('%s: the same keys, in the same order', (formId) => {
    // rejects: adding a field on one side only. The browser would draw a padlock
    // for a field the server never drafts, or the server would propose a value
    // for a field the browser has no input for and drop it on the floor.
    expect(server.FORMS[formId]).toBeDefined();
    expect(BUILDER_FORM_FIELDS[formId].fields.map((f) => f.key))
      .toEqual(server.FORMS[formId].fields.map((f) => f.key));
  });

  test.each(Object.keys(BUILDER_FORM_FIELDS))('%s: the same seed field', (formId) => {
    // rejects: the panel pointing the operator at one box while the server's
    // "type something first" refusal names another.
    expect(BUILDER_FORM_FIELDS[formId].seed).toBe(server.FORMS[formId].seed);
  });

  test('every form the server knows is offered by the console', () => {
    // rejects: shipping a fourth form server-side that nothing can reach.
    expect(Object.keys(BUILDER_FORM_FIELDS).sort()).toEqual(server.FORM_IDS.sort());
  });

  test('the two classifiers agree over every combination that matters', () => {
    // rejects: the halves drifting on the ONE decision they both make. If the
    // browser thinks a field will be refined and the server thinks it is locked,
    // the panel's plan list is a lie — and the reverse is worse.
    const specs = server.FORMS.scenario.fields;
    const cases = [
      [{}, []],
      [{ context: 'x' }, []],
      [{ context: 'x' }, ['context']],
      [{ context: '  ' }, ['context']],
      [{ context: 'x', audience: 'y' }, ['audience']],
      [{ customTitle: 'a', context: 'b', audience: 'c', mustHaveCategories: 'd', customPrompt: 'e' }, []],
      [{}, specs.map((s) => s.key)],
    ];
    for (const [values, locked] of cases) {
      for (const spec of specs) {
        expect([JSON.stringify([values, locked]), classifyField(values, locked, spec.key)])
          .toEqual([JSON.stringify([values, locked]), serverDrafting.classify(specs, values, locked, spec.key)]);
      }
    }
  });

  test('fieldLabel names a real field, and falls back rather than printing undefined', () => {
    // rejects: `form.fields.find(...).label` with no guard. The status line is
    // built from these, and one unknown key would throw inside a catch that
    // reports it as a network failure.
    expect(fieldLabel('scenario', 'context')).toBe('Context/Background');
    expect(fieldLabel('scenario', 'nope')).toBe('nope');
    expect(fieldLabel('nope', 'context')).toBe('context');
  });
});
