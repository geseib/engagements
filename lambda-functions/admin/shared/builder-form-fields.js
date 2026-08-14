/**
 * WHICH FIELDS THE AI HELPER MAY PROPOSE, per builder form.
 *
 * Three builders share one endpoint because they share one problem: an operator
 * who typed a description and wants the rest of the form proposed. They do not
 * share a form, so the field list is data rather than code.
 *
 * ── WHAT IS DELIBERATELY ABSENT ────────────────────────────────────────────
 *
 * Every field here is PROSE the operator writes. None of the enums, counts or
 * pointers are drafted — `difficulty`, `count`, `numberOfCategories`,
 * `numChoices`, `numCorrect`, `roundKind`, `promptId`, `personaId`. That is the
 * same line `ai-draft-set-metadata.js` draws and for the same reason: a wrong
 * enum silently changes which phases a session runs and which prompt resolves,
 * so a model guessing at one is a different feature with a different failure
 * mode. `roundKind` in particular is the DIRECTION, chosen on the step before
 * this one, and it is what makes the questions and the on-screen instruction
 * agree with each other (config/roundKinds.js) — a model must not move it.
 *
 * `personaId` is absent for a further reason: personas are the summary VOICE
 * layer resolved at session time, with a documented precedence
 * (lambda-functions/game/personas.js — persona, then question-set context, then
 * game context, then inference). A drafter that wrote into that chain would be
 * fighting a resolution order it cannot see.
 *
 * ── `seed` ─────────────────────────────────────────────────────────────────
 *
 * The field the owner called "the description box": the one an operator
 * realistically fills in alone. It is not treated specially by the model — it
 * is refined like any other unlocked field — it is named so the console can
 * point at it when the form is too empty to draft from.
 *
 * Kept free of AWS imports on purpose: `src/src/__tests__/fieldDrafting.test.js`
 * requires this file directly from the frontend jest run to prove the browser's
 * copy of the field list has not drifted from the server's.
 */

const SCENARIO_FIELDS = [
  {
    key: 'customTitle',
    label: 'Question set title',
    limit: 80,
    guidance: 'What this set of scenarios is called. 2-6 words, no colon subtitle.',
  },
  {
    key: 'context',
    label: 'Context / background',
    limit: 600,
    guidance: 'The situation, industry or material the scenarios should come out of. This is what the generator is given, so it must be concrete: 2-5 sentences naming the domain, the setting and what makes it specific.',
  },
  {
    key: 'audience',
    label: 'Target audience',
    limit: 120,
    guidance: 'Who is in the room, as a short phrase — role and seniority, not a sentence.',
  },
  {
    key: 'mustHaveCategories',
    label: 'Must-have categories',
    limit: 200,
    guidance: 'A comma-separated list of category names the set must cover. Two or three words each, no numbering, no explanation.',
  },
  {
    key: 'customPrompt',
    label: 'Base prompt and additional requirements',
    limit: 1200,
    guidance: 'Extra instructions for the generator: themes to hit, constraints, things to avoid, the shape a good scenario takes here.',
  },
];

const TRIVIA_FIELDS = [
  {
    key: 'topic',
    label: 'Topic / subject',
    limit: 120,
    guidance: 'What the questions are about, as a short phrase. Specific enough to write forty questions against.',
  },
  {
    key: 'audience',
    label: 'Target audience',
    limit: 120,
    guidance: 'Who is answering, as a short phrase — this is what sets how much prior knowledge a question may assume.',
  },
  {
    key: 'mustHaveCategories',
    label: 'Must-have categories',
    limit: 200,
    guidance: 'A comma-separated list of category names the questions must cover. Two or three words each, no numbering.',
  },
  {
    key: 'customPrompt',
    label: 'Additional requirements',
    limit: 1200,
    guidance: 'Extra instructions for the generator: themes, constraints, the era or region to stay inside, what to avoid.',
  },
];

const POLL_FIELDS = [
  {
    key: 'topic',
    label: 'Topic / subject',
    limit: 120,
    guidance: 'What the room is being polled about, as a short phrase.',
  },
  {
    key: 'category',
    label: 'Category',
    limit: 60,
    guidance: 'One category name for these poll questions. Two or three words, no explanation.',
  },
  {
    key: 'audience',
    label: 'Target audience',
    limit: 120,
    guidance: 'Who is voting, as a short phrase — role and seniority, not a sentence.',
  },
  {
    key: 'customPrompt',
    label: 'Additional requirements',
    limit: 1200,
    guidance: 'Extra instructions for the generator: themes, constraints, how blunt the options should be, what to avoid.',
  },
];

const FORMS = {
  scenario: {
    id: 'scenario',
    label: 'AI Scenario Builder',
    intro: 'The form configures a generator that will write discussion scenarios for a facilitated session: each one is a situation a room reads and then responds to in their own words.',
    seed: 'context',
    fields: SCENARIO_FIELDS,
  },
  trivia: {
    id: 'trivia',
    label: 'AI Trivia Builder',
    intro: 'The form configures a generator that will write multiple-choice trivia questions, each with one or more correct answers and an explanation.',
    seed: 'topic',
    fields: TRIVIA_FIELDS,
  },
  poll: {
    id: 'poll',
    label: 'AI Poll Builder',
    intro: 'The form configures a generator that will write poll questions: a prompt and a set of options a room votes between. There is no correct answer.',
    seed: 'topic',
    fields: POLL_FIELDS,
  },
};

const FORM_IDS = Object.keys(FORMS);

/** null for an unknown id, so the caller answers 400 rather than crashing. */
const formSpec = (formId) => FORMS[String(formId ?? '').trim()] || null;

module.exports = { FORMS, FORM_IDS, formSpec };
