/**
 * ROUND KINDS — what the room is asked to DO, separated from what it is about.
 *
 * THE DEFECT THIS EXISTS FOR, in the owner's words: *"if someone is creating a
 * call and answer based on a improve idea, but currently the question set
 * generator prompt has direction like improve, you get a confusing question
 * set."*
 *
 * One control used to carry two different questions. `scenarioType` — "Lessons
 * Learned", "Interview Prep", "Amazon Principles" — is a TOPIC, and every one
 * of the six built-in topics happens to be reflection-shaped. There was no
 * vocabulary anywhere for *"here is somebody else's material; land it here"*,
 * so an operator who wanted that had exactly one lever (the topic) and it
 * steered the wrong axis. The generator answered the question it was asked.
 *
 * So: TOPIC stays where it is. DIRECTION is this file. Both feed the prompt,
 * and where they conflict the direction wins, because the direction is the one
 * that decides what a participant is actually holding when the round starts.
 *
 * THE FOUR KINDS, AND THE ONE DISTINCTION THAT IS EASY TO MISS.
 *
 *   produce  you hand them a prompt and nothing else — the room is the source
 *   apply    you hand them SOMEBODY ELSE'S material
 *   improve  you hand them OUR OWN material
 *   judge    you hand them a thing and ask for a verdict, not a fix
 *
 * **Apply and Improve differ by OWNERSHIP, not by mechanics.** Both hand the
 * room a passage and ask for work on it; the shape of the round looks
 * identical. What differs is who wrote it. Foreign material is safe — nobody in
 * the room authored it, so nobody has to defend it, and the interesting answer
 * is "that would never survive contact with our release process". Our own
 * material has an author who is usually sitting right there, and the
 * interesting answer is the replacement wording. A generator that cannot tell
 * the two apart writes the wrong questions for one of them, every time.
 *
 * `custom` IS AN ESCAPE HATCH, NOT A FIFTH KIND. The owner asked for a
 * "something else" free-text path. It is here, but the ENUM STAYS CLOSED:
 * `roundKind: 'custom'` plus a separate `roundKindBrief` string that is
 * rendered in the position the house direction would have occupied. Operator
 * text never becomes a key — every prompt branch, every filter and every test
 * switches on this enum exhaustively, and a free-text key makes all three
 * unwriteable.
 *
 * ABSENT MEANS `produce`, AND THERE IS NO MIGRATION. Every set in the library
 * today ("Lessons Learned", "Amazon Leadership Principles", "Organizational
 * Challenges") hands the room a prompt and the room supplies the material from
 * its own memory. That is Produce. It is a fact about what those sets ARE, not
 * a guess. Do NOT default to `improve` merely because the generator was
 * improve-shaped — the generator's defect was in its instructions, not in the
 * sets' structure.
 *
 * WHICH ENGAGEMENT TYPES THIS APPLIES TO, and why it is not all of them. A
 * round kind describes what a room does with material it is handed. Trivia has
 * a correct answer, so "invention" and "verdict" are meaningless for it;
 * wavelength asks for word associations against a bare subject and has no
 * material at all; survey is not generated through this path. Steering those
 * with a direction block written for discussion rounds would be a new way to
 * confuse a generator, which is the defect this file is repairing. So the
 * direction is emitted for call-and-answer and poll ONLY — see
 * `roundKindApplies`. This mirrors the two personas specified for the same
 * kinds (`game/personas.js`, `gameTypes: ['call-and-answer','poll']`).
 *
 * DUPLICATED ON PURPOSE. `src/src/config/roundKinds.js` is the byte-equivalent
 * ESM mirror of the data below. Lambda bundles are per-directory and cannot
 * import the frontend's ESM module — the same rule `shared/set-version.js:31-37`
 * states and `edit-question-set.js:8-14` follows for the game-type list. Keep
 * the two in sync; `tests/round-kind-steering.js` asserts that they are.
 */

/** The closed enum. Order is the order the picker renders them in. */
const ROUND_KIND_IDS = ['produce', 'apply', 'improve', 'judge', 'custom'];

/** Absent means this, at every reader. Do not backfill it onto stored rows. */
const DEFAULT_ROUND_KIND = 'produce';

/** `roundKindBrief` ceiling. Long enough for a real instruction, short enough
 *  that it cannot become a second prompt template smuggled in through a set. */
const MAX_ROUND_KIND_BRIEF = 500;

/**
 * The engagement types a round kind means anything for. See the header.
 * Anything else gets no direction block and the ordinary length limits.
 */
const ROUND_KIND_GAME_TYPES = ['call-and-answer', 'poll'];

/**
 * The house `detail` ceiling per kind, in characters.
 *
 * WHY THIS IS HERE AND NOT ONLY IN structured-generation.js. `lengthGuidance()`
 * told the model `detail: 2-4 sentences, 350 characters maximum` for every
 * non-wavelength type, and it is appended LAST — a model weights the most
 * recent formatting instruction most heavily (the same reasoning
 * `game/personas.js:290-311` gives for its own ordering). An Apply question has
 * to CARRY the foreign material, and the exemplar set's Detail_lesson fields
 * run 400-700 characters. Left alone the length rule would fight the Apply
 * direction and Apply would lose, silently, producing exactly the truncated
 * gesture-at-the-material that makes an Apply round unanswerable.
 *
 * Produce keeps 350: its `detail` is framing, not source material, and the
 * limit is what stopped "detailed" from producing 8,500-character scenarios.
 * Judge sits between: it must carry the thing being judged, but a verdict needs
 * the artefact and not its whole context. (The plan named a raised ceiling for
 * apply and improve only; judge is raised on the same reasoning and is flagged
 * in the handover.)
 */
const DETAIL_CEILINGS = {
  produce: 350,
  apply: 900,
  improve: 900,
  judge: 600,
  custom: 350,
};

/**
 * The four things everything else derives from, per kind.
 *
 * `blurb` / `handThem` / `theWork` / `pickWhen` are the PICKER copy, and they
 * are load-bearing: someone who has never read this file has to pick the right
 * kind from them alone. That is why each kind states what you HAND the room as
 * well as what the room DOES — the hand-them line is the only thing that
 * separates Apply from Improve at a glance.
 *
 * `direction` is what the generator reads. It is written as instructions to a
 * model, in the imperative, and it names what `detail` must CONTAIN — because
 * for three of the four kinds the material is the round, and a question that
 * only alludes to it is unanswerable.
 *
 * `participantInstruction` is the set-level `customInstruction`, which the
 * importer stamps onto every question that has none of its own
 * (upload-questions.js) and which is shown to the room during ASK. This is the
 * string the reported defect was about: it used to be keyed on the TOPIC, with
 * a fallback of "share your experiences and insights" for every topic not in a
 * hardcoded map of six — so an Apply round told the room to draw on its own
 * experience about a passage it had just been handed.
 */
const ROUND_KINDS = {
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
    // No house direction: `roundKindBrief` is rendered in its place, verbatim.
    direction: null,
    // No house instruction either. The operator supplies one; see
    // `roundKindParticipantInstruction`, which returns '' rather than inventing
    // a generic line. A generic line is what the defect was.
    participantInstruction: null,
  },
};

/** Canonical id for any spelling, or null when the value is not a known kind. */
function normalizeRoundKind(value) {
  const key = String(value ?? '').trim().toLowerCase();
  return ROUND_KIND_IDS.includes(key) ? key : null;
}

/**
 * What a READER should treat a stored value as.
 *
 * Absent, empty and unrecognised all resolve to `produce`. Unrecognised
 * resolves rather than throwing because a reader's job is to render a set, not
 * to police it — the WRITERS (`edit-question-set.js`, `upload-questions.js`)
 * are where an unknown value is refused with a 400, which is the only place
 * refusing it can still tell somebody.
 */
function resolveRoundKind(value) {
  return normalizeRoundKind(value) || DEFAULT_ROUND_KIND;
}

/** Does a round kind mean anything for this engagement type? See the header. */
function roundKindApplies(engagementType) {
  return ROUND_KIND_GAME_TYPES.includes(String(engagementType ?? '').trim().toLowerCase());
}

/**
 * The direction block to place IN FRONT OF the topic in a generation prompt,
 * or '' when this engagement type takes no direction.
 *
 * In front, because `buildPrompt` puts the topic's basePrompt first and first
 * is what the model follows — which is precisely why typing an Apply brief into
 * the "Additional Requirements" box never changed the shape of what came back.
 */
function roundKindDirection(engagementType, roundKind, roundKindBrief) {
  if (!roundKindApplies(engagementType)) return '';
  const kind = resolveRoundKind(roundKind);
  if (kind === 'custom') {
    const brief = String(roundKindBrief ?? '').trim().slice(0, MAX_ROUND_KIND_BRIEF);
    if (!brief) return '';
    // The operator's words, verbatim, in the position the house direction would
    // have occupied. Never interpolated into a sentence and never used as a key.
    return `ROUND KIND: as described here, and this governs the shape of every item.\n${brief}`;
  }
  return ROUND_KINDS[kind].direction;
}

/** The set-level participant instruction for a kind, or '' for custom. */
function roundKindParticipantInstruction(roundKind) {
  const kind = resolveRoundKind(roundKind);
  return ROUND_KINDS[kind].participantInstruction || '';
}

/** The `detail` character ceiling for a kind, honouring the engagement gate. */
function roundKindDetailCeiling(engagementType, roundKind) {
  if (!roundKindApplies(engagementType)) return DETAIL_CEILINGS[DEFAULT_ROUND_KIND];
  return DETAIL_CEILINGS[resolveRoundKind(roundKind)];
}

module.exports = {
  ROUND_KIND_IDS,
  ROUND_KINDS,
  ROUND_KIND_GAME_TYPES,
  DEFAULT_ROUND_KIND,
  MAX_ROUND_KIND_BRIEF,
  DETAIL_CEILINGS,
  normalizeRoundKind,
  resolveRoundKind,
  roundKindApplies,
  roundKindDirection,
  roundKindParticipantInstruction,
  roundKindDetailCeiling,
};
