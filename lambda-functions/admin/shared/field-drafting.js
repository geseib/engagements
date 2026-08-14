/**
 * FILL, REFINE, LOCK — the three behaviours, decided in one place.
 *
 * The owner: *"i do wish there was an AI helper that filled out the forms for
 * the user based on some prelim info they offered. So say they only filled on
 * the description box of what they wanted. the AI could come up with a title,
 * categories, Instructions etc. or if the user filled those in the ai would
 * refine (unless locked, a small icon lock/unlock on cells."*
 *
 * Three behaviours are named there and they are not variations on one thing:
 *
 *   FILL   — the field is empty. Write it from what the operator DID type.
 *   REFINE — the field already holds the operator's words. Improve them. Not
 *            "write a better one"; improve THEIRS. See buildFieldPrompt.
 *   LOCK   — the operator has said hands off. Never touched, on any pass.
 *
 * ── WHY THE LOCK IS ENFORCED HERE AND NOT IN THE COMPONENT ──────────────────
 *
 * A lock that is only a UI state is a promise the UI makes on behalf of a model
 * it does not control. This module makes it structural instead, twice over:
 *
 *   1. `buildFieldSchema` OMITS a locked field from the tool schema entirely.
 *      The model is never asked for it, so there is nothing to ignore.
 *   2. `enforceLocks` REMOVES a locked key from whatever came back anyway — a
 *      model that emits an unrequested key, a replayed job payload, a caller
 *      that lied about which fields it wanted. It rebuilds the object from the
 *      spec rather than deleting from the model's, so an unknown key cannot
 *      survive by being spelled differently.
 *
 * Both run inside the Lambda worker, before the draft is ever written to the
 * job record. `src/src/utils/fieldDrafting.js` refuses locked keys a third
 * time on the way into the form, because the browser must not depend on the
 * server having been deployed recently. `src/src/__tests__/fieldDrafting.test.js`
 * loads BOTH modules and asserts they classify identically, which is the guard
 * against the two halves drifting apart.
 *
 * This module knows nothing about AWS, question sets or React. It is required
 * by the endpoint and by two test suites.
 */

const text = (value) => String(value ?? '').trim();

const clip = (value, max) => {
  const v = text(value);
  return v.length > max ? `${v.slice(0, max - 1)}…` : v;
};

/**
 * How a field the model was asked about is classified.
 *
 * `locked` is deliberately in the same enum as the other two rather than being
 * a separate boolean: every consumer has to handle all three, and a boolean
 * beside an enum is how a third case gets forgotten.
 */
const FILL = 'fill';
const REFINE = 'refine';
const LOCKED = 'locked';

/** Only keys this form actually has. A caller cannot lock its way into a typo. */
function normalizeLocked(raw, specs) {
  const known = new Set(specs.map((s) => s.key));
  const out = [];
  for (const entry of Array.isArray(raw) ? raw : []) {
    const key = text(entry);
    if (known.has(key) && !out.includes(key)) out.push(key);
  }
  return out;
}

/**
 * THE DECISION, and the only place it is made on this side.
 *
 * Locked wins over everything — a locked field is not classified by whether it
 * has content, because "locked but empty" is a perfectly ordinary thing for an
 * operator to want ("do not invent an audience for me").
 */
function planFields(specs, current, locked) {
  const lockedSet = new Set(normalizeLocked(locked, specs));
  const plan = { fill: [], refine: [], locked: [] };
  for (const spec of specs) {
    if (lockedSet.has(spec.key)) plan.locked.push(spec.key);
    else if (text(current?.[spec.key])) plan.refine.push(spec.key);
    else plan.fill.push(spec.key);
  }
  return plan;
}

/** The fields the model is actually asked for: everything not locked. */
const draftTargets = (plan) => [...plan.fill, ...plan.refine];

/** Classification for one key, for callers that want it a field at a time. */
function classify(specs, current, locked, key) {
  const plan = planFields(specs, current, locked);
  if (plan.locked.includes(key)) return LOCKED;
  if (plan.refine.includes(key)) return REFINE;
  if (plan.fill.includes(key)) return FILL;
  return null;
}

/**
 * The tool schema, built from the plan rather than from the spec list.
 *
 * A locked field is absent from `properties` AND from `required`. That is
 * enforcement point 1: the model cannot return what it was not offered a slot
 * for, and a model that invents the key anyway is handled by enforceLocks.
 */
function buildFieldSchema(specs, plan) {
  const targets = new Set(draftTargets(plan));
  const properties = {};
  const required = [];
  for (const spec of specs) {
    if (!targets.has(spec.key)) continue;
    properties[spec.key] = {
      type: 'string',
      description: `${spec.guidance} ${spec.limit} characters maximum.`,
    };
    required.push(spec.key);
  }
  return { properties, required };
}

/**
 * ENFORCEMENT POINT 2. Rebuild the item from the spec, dropping locked keys,
 * unknown keys and blanks, and clipping what survives to the field's ceiling.
 *
 * A blank is dropped rather than kept as an empty string because the consumer
 * treats "absent" as "no proposal for this field" — an empty string would read
 * as "the model wants this cleared", which nothing here ever means.
 */
function enforceLocks(item, specs, locked) {
  const lockedSet = new Set(normalizeLocked(locked, specs));
  const out = {};
  for (const spec of specs) {
    if (lockedSet.has(spec.key)) continue;
    const value = clip(item?.[spec.key], spec.limit);
    if (value) out[spec.key] = value;
  }
  return out;
}

/**
 * The prompt sections that make FILL and REFINE different instructions.
 *
 * WHAT STOPS "REFINE" BECOMING "REPLACE". Three things, in descending order of
 * how much I trust them:
 *
 *   1. The operator's exact text is quoted back per field, under a heading that
 *      names it as theirs, with the standing instruction to keep their nouns,
 *      their specifics and their voice and to return their words unchanged if
 *      they cannot be improved. A model that has been handed a sentence and
 *      told to improve it behaves very differently from one handed a blank.
 *   2. The blank fields are labelled separately, so "write this from scratch"
 *      is never the instruction attached to a field that already has words.
 *   3. Neither of the above is a guarantee, which is why the browser measures
 *      how much of the operator's wording survived and HOLDS a proposal that
 *      reads as a replacement instead of applying it
 *      (`src/src/utils/fieldDrafting.js`). The prompt aims; the retention check
 *      is what actually refuses.
 */
function buildFieldPrompt({ form, specs, current, plan, extras = [] }) {
  const byKey = new Map(specs.map((s) => [s.key, s]));
  let p = `You are helping an operator finish a form. ${form.intro}\n\n`;

  p += 'WHAT THE OPERATOR HAS TYPED SO FAR — this is everything you have to work'
    + ' from, and everything you write has to be consistent with it:\n';
  let anything = false;
  for (const spec of specs) {
    const value = text(current?.[spec.key]);
    if (!value) continue;
    anything = true;
    p += `- ${spec.label}: ${value}\n`;
  }
  if (!anything) p += '- (nothing yet)\n';

  for (const extra of extras) {
    if (text(extra)) p += `- ${text(extra)}\n`;
  }

  if (plan.fill.length > 0) {
    p += '\nFIELDS TO WRITE — these are EMPTY. Propose each one from what the'
      + ' operator typed above. Do not contradict anything they wrote:\n';
    for (const key of plan.fill) {
      const spec = byKey.get(key);
      p += `- ${spec.label}: ${spec.guidance} ${spec.limit} characters maximum.\n`;
    }
  }

  if (plan.refine.length > 0) {
    p += '\nFIELDS TO REFINE — the operator ALREADY WROTE these. Your job is to'
      + ' improve THEIR text, not to write your own version of the field:\n';
    for (const key of plan.refine) {
      const spec = byKey.get(key);
      p += `- ${spec.label}\n`;
      p += `  What they wrote: ${text(current?.[key])}\n`;
      p += `  What the field is for: ${spec.guidance} ${spec.limit} characters maximum.\n`;
    }
    p += `
HOW TO REFINE, and this is the part that matters most:
- KEEP their subject, their specifics, their proper nouns and their terminology. If they named a company, a team, a framework or a number, it must still be there.
- Tighten wording, fix grammar, fill in what is obviously missing, make it concrete. That is the whole job.
- Do NOT swap their example for a better example. Do NOT generalise a specific statement of theirs. Do NOT change what the field is about.
- If their text is already good, RETURN IT UNCHANGED. An unchanged field is a correct answer, not a failure.
`;
  }

  if (plan.locked.length > 0) {
    // Named rather than silently omitted. The model can then write the other
    // fields so they AGREE with the locked ones instead of drifting from them.
    p += '\nLOCKED — the operator has locked these and you are not proposing them.'
      + ' They are shown so the fields you do write agree with them:\n';
    for (const key of plan.locked) {
      const spec = byKey.get(key);
      p += `- ${spec.label}: ${text(current?.[key]) || '(empty, and locked empty)'}\n`;
    }
  }

  p += '\nWrite only what the content needs; do not pad to reach a limit.'
    + ' Return exactly ONE item by calling the emit_items tool. Do not write prose.';

  return p;
}

module.exports = {
  FILL,
  REFINE,
  LOCKED,
  normalizeLocked,
  planFields,
  draftTargets,
  classify,
  buildFieldSchema,
  enforceLocks,
  buildFieldPrompt,
  text,
  clip,
};
