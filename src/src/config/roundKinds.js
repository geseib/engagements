/**
 * ROUND KINDS — what the room is asked to DO, separated from what it is about.
 *
 * ESM MIRROR of `lambda-functions/admin/shared/round-kinds.js`. The lambda
 * bundle cannot import this module and this module cannot import the bundle —
 * bundles are per-directory (`shared/set-version.js:31-37` states the rule) —
 * so the vocabulary is duplicated deliberately, exactly as the game-type list
 * already is in `edit-question-set.js`. `tests/round-kind-steering.js` asserts
 * the two copies agree on the ids, the labels, the directions, the participant
 * instructions and the ceilings, so a drift is a red suite rather than a
 * generator that steers one way while the picker promises another.
 *
 * THE DEFECT THIS EXISTS FOR, in the owner's words: *"if someone is creating a
 * call and answer based on a improve idea, but currently the question set
 * generator prompt has direction like improve, you get a confusing question
 * set."*
 *
 * One control carried two questions. `scenarioType` — "Lessons Learned",
 * "Interview Prep", "Amazon Principles" — is a TOPIC, and all six built-in
 * topics are reflection-shaped. There was no vocabulary anywhere for *"here is
 * somebody else's material; land it here"*, so an operator who wanted that had
 * one lever and it steered the wrong axis.
 *
 * TOPIC stays where it is. DIRECTION is this file.
 *
 * Apply and Improve differ by OWNERSHIP, not mechanics: both hand the room a
 * passage, but foreign material has no author in the room to defend it, and our
 * own material usually does. That is the distinction the picker copy has to
 * carry, because it is the one a reader will otherwise miss.
 */

/** The closed enum. Order is the order the picker renders them in. */
export const ROUND_KIND_IDS = ['produce', 'apply', 'improve', 'judge', 'custom'];

/** Absent means this, at every reader. Nothing is backfilled onto stored sets. */
export const DEFAULT_ROUND_KIND = 'produce';

/** `roundKindBrief` ceiling, matching the backend's validation. */
export const MAX_ROUND_KIND_BRIEF = 500;

/**
 * The engagement types a round kind means anything for.
 *
 * Trivia has a correct answer, so "invention" and "verdict" are meaningless for
 * it; wavelength asks for word associations against a bare subject and hands
 * the room no material at all. Steering those with a direction written for
 * discussion rounds would be a new way to confuse a generator, which is the
 * defect this file repairs. The picker therefore renders for call-and-answer
 * and poll only, and the backend emits no direction block for anything else.
 */
export const ROUND_KIND_GAME_TYPES = ['call-and-answer', 'poll'];

/** The house `detail` ceiling per kind, in characters. See the backend copy. */
export const DETAIL_CEILINGS = {
  produce: 350,
  apply: 900,
  improve: 900,
  judge: 600,
  custom: 350,
};

/**
 * The four things everything else derives from, per kind.
 *
 * `blurb` / `handThem` / `theWork` / `pickWhen` are the PICKER copy and they
 * are load-bearing: someone who has never read this file has to pick the right
 * kind from them alone. Each states what you HAND the room as well as what the
 * room DOES, because the hand-them line is the only thing that separates Apply
 * from Improve at a glance.
 *
 * `participantInstruction` becomes the set's `customInstruction`, which the
 * importer stamps onto every question with none of its own and which the room
 * reads during ASK. This is the string the reported defect was about: it was
 * keyed on the TOPIC, falling back to "share your experiences and insights" for
 * every topic outside a hardcoded map of six — so an Apply round told the room
 * to draw on its own experience about a passage it had just been handed.
 */
export const ROUND_KINDS = {
  produce: {
    id: 'produce',
    label: 'Produce',
    icon: 'Lightbulb',
    blurb: 'You hand them a prompt and nothing else. The room is the source.',
    handThem: 'A prompt, and nothing else.',
    theWork: 'Invention. They answer out of their own experience.',
    pickWhen: 'Retrospectives, lessons learned, problem-solving, icebreakers — anything nobody has to have read something first to answer.',
    direction: [
      'ROUND KIND: PRODUCE. Each item hands the room a PROMPT AND NOTHING ELSE.',
      'The room itself is the source of the material.',
      '- Every question must be answerable from the participant\'s own experience.',
      '  Do not assume they have been handed a document, a passage or an artefact.',
      '- `detail` is FRAMING that sets the ask up. It is not source material, and it',
      '  must not smuggle in a text for them to react to.',
      '- Ask them to recall, invent or propose. Never to critique something supplied.',
    ].join('\n'),
    participantInstruction: 'Answer from your own experience. Be specific — one real example beats a general principle.',
  },

  apply: {
    id: 'apply',
    label: 'Apply',
    icon: 'Handshake',
    blurb: "You hand them somebody else's material and ask where it lands here.",
    handThem: "Somebody else's material — a passage, a practice, a case study.",
    theWork: 'Transfer. Where would it land here, and who would resist it?',
    pickWhen: 'You have material from outside the room — an article, a standard, another team\'s playbook. Nobody here wrote it, so nobody has to defend it.',
    direction: [
      "ROUND KIND: APPLY. Each item hands the room SOMEBODY ELSE'S material and asks",
      'where it lands in their own situation. The material is FOREIGN: nobody in this',
      'room wrote it, and nobody has to defend it.',
      '- `detail` MUST carry or faithfully summarise the material itself AND NAME ITS',
      '  ORIGIN (e.g. "from the WHO surgical safety checklist", "from a rival\'s',
      '  post-incident review"). A question that only gestures at the material is not',
      '  an Apply question — the room cannot apply what it has not been given.',
      '- The ask is the TRANSFER AND ITS FRICTION: what would have to change here for',
      '  this to work, and who or what would resist it. Not "what do you think of it".',
      '- Never ask the room to justify or defend the material. It is not theirs.',
      '- Keep the source and the room\'s own situation clearly apart in the wording.',
    ].join('\n'),
    participantInstruction: 'The material above is not ours. Say where it would land here, and who or what would resist it.',
  },

  improve: {
    id: 'improve',
    label: 'Improve',
    icon: 'NotePencil',
    blurb: 'You hand them our own material and ask for a better version.',
    handThem: 'Something we wrote — a policy, a runbook, a mission statement.',
    theWork: 'Revision. A better version, in actual words.',
    pickWhen: 'The thing being worked on is ours, and its author is probably sitting in the room.',
    direction: [
      'ROUND KIND: IMPROVE. Each item hands the room OUR OWN material and asks for a',
      'better version of it.',
      '- `detail` MUST contain the ACTUAL ARTEFACT being revised — the real wording,',
      '  verbatim, not a description of it. A round that describes the text instead of',
      '  quoting it collects opinions about a thing nobody can see.',
      '- The ask is a REWRITE: the words they would put in its place. Not a direction',
      '  of travel, not "consider whether", not a list of concerns.',
      '- Whoever wrote this material may well be in the room. Ask about the TEXT and',
      '  never about the author or the decision to write it.',
    ].join('\n'),
    participantInstruction: 'Rewrite it. Show the words you would use, not the direction you would go.',
  },

  judge: {
    id: 'judge',
    label: 'Judge',
    icon: 'Ruler',
    blurb: 'You hand them a thing and ask for a verdict, not a fix.',
    handThem: 'A thing, and the criterion to judge it against.',
    theWork: 'Evaluation. Call it, and say why.',
    pickWhen: 'You want the room\'s assessment on the record — ready or not ready, meets the bar or does not — before anybody starts repairing it.',
    direction: [
      'ROUND KIND: JUDGE. Each item hands the room a THING and asks for a VERDICT on',
      'it.',
      '- `detail` MUST contain the thing being judged AND state the CRITERION it is',
      '  judged against (e.g. "is this ready to ship", "does this meet the bar we set',
      '  in January"). A verdict with no stated criterion is a preference.',
      '- The ask is an evaluation with a reason behind it.',
      '- DO NOT ask "how would you improve this", "what would you change", or any',
      '  other repair question. A Judge round that collects fixes has collected the',
      '  wrong thing and the room will never state its verdict.',
    ].join('\n'),
    participantInstruction: 'Give a verdict and your reason. Do not fix it.',
  },

  custom: {
    id: 'custom',
    label: 'Something else',
    icon: 'MagicWand',
    blurb: 'Say what the round should do, in your own words.',
    handThem: 'Whatever you describe.',
    theWork: 'Whatever you describe.',
    pickWhen: 'None of the four fits. You write the direction and what the room is told.',
    direction: null,
    participantInstruction: null,
  },
};

/** The kinds in picker order, as an array. */
export const ROUND_KIND_LIST = ROUND_KIND_IDS.map((id) => ROUND_KINDS[id]);

/** Canonical id for any spelling, or null when the value is not a known kind. */
export function normalizeRoundKind(value) {
  const key = String(value ?? '').trim().toLowerCase();
  return ROUND_KIND_IDS.includes(key) ? key : null;
}

/** What a reader treats a stored value as. Absent/empty/unknown -> produce. */
export function resolveRoundKind(value) {
  return normalizeRoundKind(value) || DEFAULT_ROUND_KIND;
}

/** Does a round kind mean anything for this engagement type? */
export function roundKindApplies(engagementType) {
  return ROUND_KIND_GAME_TYPES.includes(String(engagementType ?? '').trim().toLowerCase());
}

/**
 * The participant instruction a set gets from its kind.
 *
 * THIS REPLACES `generateCustomInstructions()`'s map keyed on scenario TYPE.
 * For `custom` it returns the operator's own line and never invents a generic
 * one — inventing a generic one is exactly what produced *"Engage thoughtfully
 * with each scenario and share your experiences and insights"* on rounds that
 * had handed the room somebody else's material.
 */
export function roundKindParticipantInstruction(roundKind, operatorInstruction = '') {
  const kind = resolveRoundKind(roundKind);
  if (kind === 'custom') return String(operatorInstruction ?? '').trim();
  return ROUND_KINDS[kind].participantInstruction || '';
}

/** The `detail` character ceiling for a kind, honouring the engagement gate. */
export function roundKindDetailCeiling(engagementType, roundKind) {
  if (!roundKindApplies(engagementType)) return DETAIL_CEILINGS[DEFAULT_ROUND_KIND];
  return DETAIL_CEILINGS[resolveRoundKind(roundKind)];
}

/**
 * Is this configuration ready to generate with?
 *
 * `custom` is the only kind that can be incomplete: it carries no house
 * direction and no house participant instruction, so the operator must supply
 * both. Returning the missing field names rather than a boolean lets the form
 * say WHICH box is empty instead of disabling a button with no explanation.
 */
export function roundKindGaps(roundKind, { brief = '', instruction = '' } = {}) {
  if (resolveRoundKind(roundKind) !== 'custom') return [];
  const gaps = [];
  if (!String(brief ?? '').trim()) gaps.push('brief');
  if (!String(instruction ?? '').trim()) gaps.push('instruction');
  return gaps;
}
