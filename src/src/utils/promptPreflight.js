/**
 * WHAT THIS PROMPT WILL DO WHEN IT IS ASSEMBLED, BEFORE IT IS SAVED.
 *
 * Sibling of utils/csvPreflight.js, same shape, same three-tier discipline, and
 * built for the same reason: a defect that is discoverable from the artefact
 * plus the catalogue should not be discovered by a room reading a projector.
 *
 * WHERE IT COMES FROM. A session authored one prompt with unusual care
 * (`sets/prompt-callandanswer-workie-advisor.json`), ran it end to end against
 * the real handlers, and still shipped six defects. Every one was findable from
 * the prompt text and `template-variables.js` alone. Nothing warned the author.
 * The two documents that establish that are
 * `docs/superpowers/reviews/2026-08-11-agentic-sdlc-dry-run-hypothesis.md`
 * (Part 2 "Defects the run exposed", Part 3B item 2) and
 * `…-agentic-sdlc-simulated-session.md` §4 and §5; every check below cites the
 * defect or friction item it comes from.
 *
 * WHAT ALREADY EXISTED, AND WHY IT WAS NOT ENOUGH. `assertTemplateVariablesExist`
 * (admin/shared/template-variable-usage.js) is the save gate, and
 * `debugInfo.unresolvedVariables` (get-ai-summary.js:2236) is the runtime one.
 * Both answer exactly one question: *is there a token nothing will substitute?*
 * The evaluator's verdict on that gate is the reason this file exists —
 * hypothesis H13 "PASS on its letter, and the letter is not enough… A prompt can
 * pass H13 with a third of its instruction text destroyed, which is what
 * happened here." A token with no key is caught. A token WITH a key, used as a
 * noun in a sentence, is not, and it is the more expensive of the two.
 *
 * THREE TIERS, AND THEY ARE NOT THE SAME KIND OF THING:
 *
 *   1. `blocking` — the prompt must not be saved. It will not run as written:
 *      the summary engine rejects the shape, or a token renders as literal
 *      braces on a projector, or the declared output shape is discarded.
 *   2. `silent`   — it saves, it runs, and it misbehaves without saying so.
 *      **This is the tier the module exists for.** Nothing downstream reports
 *      any of it: not the save gate, not `unresolvedVariables`, not the host.
 *   3. `advisory` — worth knowing before you commit to it. Trades and frictions,
 *      not defects.
 *
 * WHAT IT DOES NOT DO. It does not repair, exactly like csvPreflight — no
 * rewriting a rule to name a label instead of a token, no trimming a word cap.
 * It reports. It also cannot see runtime values: every character count below is
 * an ESTIMATE against a named room size, and the three that are measured say so
 * by name. See RENDERED_SIZE.
 *
 * THE CONTRACT, because a UI is being built against it concurrently:
 *
 *   preflightPrompt({ instructions, outputFormat, outputSections, template,
 *                     gameType, isDefault, targetModel })
 *     => { blocking: Finding[], silent: Finding[], advisory: Finding[],
 *          stats: { assembledChars, variablesUsed, inlinedChars,
 *                   duplicatedChars, estimatedWords },
 *          variables: VariableUse[] }        // additive, see below
 *
 *   Finding = { code, title, detail, evidence, fix }   all strings, always
 *             present, never null. `evidence` quotes the source it came from.
 *
 * `stats.variablesUsed` is a COUNT, to match its four scalar siblings. The
 * per-variable detail a panel would want — name, occurrences, estimated
 * rendered size, how many of those occurrences sit in prose — is the additive
 * `variables` array, which is not part of the fixed contract and can be ignored.
 */

import {
  extractVariableTokens,
  unknownVariableTokens,
  isKnownTemplateVariable,
  extractBracketDirections,
} from '../config/templateVariables';

/* --------------------------------------------------------------- sizing -- */

/**
 * How many characters each `{token}` becomes when get-ai-summary.js substitutes
 * it. The whole prose-inlining tier is built on this, so its honesty matters
 * more than its precision.
 *
 * THREE OF THESE ARE MEASURED, byte-exact, off the round-4 prompt of
 * `scripts/simulate-session.js` — 11 answers, 10 voters — and independently
 * re-measured by the evaluator (hypothesis Part 2, D2: *"`responsesText` is
 * 2,244 chars, `voteTally` 635, `votingBreakdown` 732"*). They are the anchor.
 *
 * EVERYTHING ELSE IS AN ESTIMATE at that same room size, read off the builder
 * that produces it in get-ai-summary.js — the per-answer lists around :1412,
 * the top-3 lists at :1587-1602, the one-liners at :1636-1658. A count renders
 * as two characters because a room of 11 does; a room of 120 does not.
 *
 * Consequences of being wrong, so nobody has to guess: too LOW understates a
 * duplication finding and can suppress it entirely (the 200-char threshold);
 * too HIGH invents a finding on a small variable. That asymmetry is why the
 * unlisted default is deliberately small — an unknown variable is treated as a
 * short one and says nothing, rather than crying wolf.
 */
const RENDERED_SIZE = {
  // MEASURED — round 4 of the simulated session, 11 answers / 10 voters.
  responsesText: 2244,
  voteTally: 635,
  votingBreakdown: 732,

  // ESTIMATED — one entry per answer, same room size (get-ai-summary.js:1396).
  playerAnswers: 1900,
  playerResponses: 1900,
  triviaResponses: 420,
  wavelengthWords: 520,
  uniqueAnswers: 400,

  // ESTIMATED — the top-3 and roster lists (:1291-1302, :1596-1633, :1671+).
  finalResults: 380,
  playerRankings: 220,
  leaderboard: 220,
  cumulativeScores: 200,
  scoreChanges: 200,
  roundScores: 130,
  topVotedAnswers: 120,
  commonWords: 120,
  playerNames: 90,
  topPerformers: 90,

  // ESTIMATED — one line or one sentence.
  answerDetails: 220,
  questionDetail: 160,
  wordAnalysis: 160,
  questionSetDescription: 120,
  triviaChoices: 110,
  pollOptions: 110,
  winnerInfo: 90,
  sessionContext: 70,
  resultsSummary: 60,
  questionTitle: 60,
  question: 60,
  scoringSystem: 50,
  answerCategories: 45,
  triviaCorrectness: 40,
  correctAnswer: 40,
  eventTitle: 30,
  questionSetName: 30,
  sessionDuration: 20,
  votingPattern: 20,
  consensusLevel: 20,
  gameType: 15,
  questionCategory: 12,
  difficulty: 6,
  averageScore: 5,
  gameId: 4,
  connectionScore: 3,

  // Counts, at an 11-person room.
  responseCount: 2,
  voteCount: 2,
  totalParticipants: 2,
  totalPlayers: 2,
  activeParticipants: 2,
  correctCount: 2,
  categoryCount: 2,
  totalQuestions: 2,
  questionNumber: 2,
  currentRound: 2,
  commonWordsCount: 2,
  totalUniqueWords: 2,
  teamScore: 2,

  // Resolve to the empty string ON PURPOSE (get-ai-summary.js:2110, :2124).
  votingParticipation: 0,
  participationRate: 0,
};

/** Anything uncatalogued here is assumed short, so it cannot invent a finding. */
const DEFAULT_RENDERED_SIZE = 40;

const sizeOf = (name) =>
  (Object.prototype.hasOwnProperty.call(RENDERED_SIZE, name)
    ? RENDERED_SIZE[name]
    : DEFAULT_RENDERED_SIZE);

/**
 * "Large" is 200 characters, and the number is not mine. Part 3B item 2(a) of
 * the hypothesis proposes the runtime version of this same check and specifies
 * the threshold: *"log a warning when any token resolves to more than ~200
 * characters and occurs more than once."* Using the same number means the
 * save-time check and the runtime check cannot disagree about a given prompt.
 */
const LARGE_VALUE_CHARS = 200;

/* ------------------------------------------------------- the assembly -- */

/**
 * What get-ai-summary.js:2181 actually builds:
 *
 *   `VOICE:\n${persona.voice}\n\n${templateBody}\n\n${buildOutputContract()}`
 *
 * `templateBody` is `template`, or `instructions + '\n\n' + outputFormat`
 * (:2162-2168). Both of the other two layers are outside the author's control
 * and neither is knowable at save time, so both are constants here:
 *
 *  - CONTRACT_FIXED_CHARS is measured: `buildOutputContract({}).length` minus
 *    its sections body is 1,411 with the default triad and 1,410 with the
 *    advisor's four sections. The one character is the count word ("three" vs
 *    "four"). 1,410 is used and the error is one character.
 *  - PERSONA_VOICE_ALLOWANCE is a stand-in. The persona is chosen per game, not
 *    per prompt, and the seed library runs from 273 characters (`coach`) to
 *    2,735 (`mtv-vjs`), with the advisor's own persona at 1,004. 500 is a
 *    middling seed. On an 18 KB prompt the choice moves the total by under 2%;
 *    on a 2 KB prompt it moves it by a quarter, which is worth knowing before
 *    quoting `assembledChars` at a small prompt.
 */
const CONTRACT_FIXED_CHARS = 1410;
const PERSONA_VOICE_ALLOWANCE = 500;
const VOICE_LABEL_CHARS = 'VOICE:\n'.length + '\n\n'.length + '\n\n'.length;

/**
 * Characters per word. Measured on this repo's own prompts rather than assumed:
 * the advisor's authored text is 6,025 characters over 977 whitespace-separated
 * tokens, or 6.17. Rounded to 6, which errs toward reporting slightly more
 * words than there are.
 */
const CHARS_PER_WORD = 6;

/* ------------------------------------------------------------- models -- */

/**
 * `max_tokens` is the only output constraint that is actually enforced, and it
 * is enforced by the API rather than by the prompt. Confirmed in the code as it
 * stands: get-ai-summary.js:2267-2276 — Haiku 4.5
 * (`us.anthropic.claude-haiku-4-5-20251001-v1:0`), `max_tokens: 1024`,
 * `temperature: 0.5`. There is no second model in the chain; a failure goes
 * straight to the static fallback (:2334).
 *
 * ~750 words for 1024 tokens is the hypothesis's own figure (§6 item 4:
 * *"max_tokens: 1024 is roughly 750 words, so the cap is not enforced by the
 * token limit — the model has to enforce it"*).
 */
const MODELS = {
  'haiku-4.5': { label: 'Claude Haiku 4.5', maxTokens: 1024, approxWords: 750 },
};
const PRODUCTION_MODEL = 'haiku-4.5';

const modelFor = (targetModel) => {
  const key = String(targetModel || '').toLowerCase();
  const hit = Object.keys(MODELS).find((k) => key === k || key.includes(k));
  return { ...MODELS[hit || PRODUCTION_MODEL], assumed: !hit };
};

/**
 * A prompt above this size is worth a word about placement, not about capacity.
 * Nothing here is near a context limit — the concern is the one the hypothesis
 * names in F8 and Part 3A item 3: *"on a small model, instruction adherence
 * decays with distance from the instruction, and every one of the 14 rules is
 * currently on the far side of the data."* 12,000 sits below the measured
 * 18,072 and above every other prompt shipped in `sets/`.
 */
const LARGE_PROMPT_CHARS = 12000;

/* ------------------------------------------- the tie-break for isDefault -- */

/**
 * Copied from get-ai-summary.js:331-337. It is the second half of what
 * `isDefault: true` means and the half nobody expects: when more than one
 * prompt claims the flag for a game type, `findDefaultPromptId` does not fail
 * and does not pick at random — it ranks by preferred category first, then
 * analysis-shape, then oldest, then promptId (:369-383).
 */
const PREFERRED_DEFAULT_CATEGORY = {
  'call-and-answer': 'lessons-learned',
  trivia: 'general',
  poll: 'general',
  wavelength: 'general',
  survey: 'general',
};

/* ------------------------------------------------- the unsafe variables -- */

/**
 * Five variables that resolve cleanly, are advertised on the chip palette, and
 * are wrong. EACH ONE WAS READ IN THE CODE BEFORE IT WAS WRITTEN DOWN HERE —
 * that is the whole discipline of this list. A preflight that cries wolf gets
 * switched off, and then it protects nothing.
 *
 * The shape they share is the shape of the two defects this repo has already
 * removed (`participationRate` in `78df15ca`, the consensus tautology): a number
 * or a label computed from mismatched quantities, interpolated straight into a
 * prompt, and read aloud to the people it is about.
 *
 * The prompt author who wrote the advisor excluded all five by instinct. The
 * instinct was right; nothing in the product carried it.
 */
const UNSAFE_VARIABLES = [
  {
    name: 'totalParticipants',
    title: '{totalParticipants} is this round\'s answer count, not the size of the room.',
    detail:
      'The catalogue advertises it as "Total number of players who joined the session". '
      + 'get-ai-summary.js:1286 assigns it `answers.length` — the number of people who answered '
      + 'THIS round. Nobody who joined and stayed quiet is in it, and the session roster is not '
      + 'in scope anywhere in that handler. The honest spelling of the same number is already '
      + 'advertised as {responseCount}.',
    fix:
      'Use {responseCount}, which says what it is. If the prompt needs the size of the room, '
      + 'no variable carries it — the roster lives in create-report.js, not in the summary path.',
    pairedWith: 'responseCount',
    pairedDetail:
      'This prompt uses {responseCount} as well, and both resolve to the same number. A model '
      + 'given "12 people joined" and "12 people answered" will report full participation, which '
      + 'is the claim `78df15ca` removed from this system — it was 100% by construction on every '
      + 'round ever summarised, and hosts read it aloud.',
  },
  {
    name: 'activeParticipants',
    title: '{activeParticipants} silently becomes the answer count when nobody voted.',
    detail:
      'get-ai-summary.js:1542 is `(votes && votes.length > 0) ? votes.length : answers.length`. '
      + 'On a round with votes it is the voter count, which is what the catalogue promises. On a '
      + 'round with none it is the number of answers, and the prompt cannot tell the two cases '
      + 'apart — "8 active voters" is emitted for a round where nobody voted at all.',
    fix:
      'Use {voteCount} (get-ai-summary.js:2106, `votes ? votes.length : 0`), which reports 0 when '
      + 'no vote was taken and lets the prompt say so.',
  },
  {
    name: 'topVotedAnswers',
    title: '{topVotedAnswers} carries no answer text on any round that is not trivia.',
    detail:
      'get-ai-summary.js:1596-1602 branches on game type. Trivia gets '
      + '`playerName: answer - score points`. Everything else gets `playerName: score vote points` '
      + '— the author\'s name and a number, and not one word of what they wrote. The catalogue\'s '
      + 'example ("Alice\'s response (13 points)") shows text that the non-trivia branch never '
      + 'produces. It is worse under anonymity: :1273-1281 replaces every author with the literal '
      + '"a participant", so the whole value degrades to "a participant: 13 vote points, '
      + 'a participant: 8 vote points, a participant: 4 vote points".',
    fix:
      'Use {voteTally}, built at :1591-1593 as `1. <answer text> (N vote points)`, which carries '
      + 'the words the room actually wrote.',
  },
  {
    name: 'votingPattern',
    title: '{votingPattern} compares vote points against a count of voters.',
    detail:
      'get-ai-summary.js:1579 sets "Clear consensus" when '
      + '`winners[0].score > (results.totalVotes * 2)`. `score` is vote POINTS (3/2/1 per ballot, '
      + ':1722); `totalVotes` is the number of PEOPLE who voted. The comparison has different '
      + 'units on each side, so the label it produces is not defensible in either direction — on '
      + 'the measured session it fires for round 3 (23 > 18) and round 5 (21 > 16) and not for '
      + 'round 1 (17 > 18), for no reason a reader could defend. Logged as D12 and still live in '
      + 'the hardcoded lessons-learned default prompt at :284.',
    fix:
      'Use {consensusLevel}, which is computed by game/consensus.js — a separate, tested module '
      + 'with real arithmetic and a zero-vote guard.',
  },
  {
    name: 'resultsSummary',
    title: '{resultsSummary} can print a percentage above 100.',
    detail:
      'The non-trivia branch at get-ai-summary.js:1653-1654 is '
      + '`Math.round((winners[0].score / (results.totalVotes * 3)) * 100)`, and the 3 is a '
      + 'literal. The points a first place is actually worth come from '
      + '`scoringConfig.firstPlacePoints`, which is read off the game\'s METADATA row '
      + '(schema-compliant-manager.js:94, `gameData.scoring?.firstPlacePoints || 3`) and rendered '
      + 'to the prompt as {scoringSystem}. Configure first place above 3 and the figure exceeds '
      + '100% of "possible vote points". It is wrong at the default too: a full 3/2/1 ballot '
      + 'awards 6 points per voter, not 3, so the share is roughly double the true one. Logged '
      + 'as D13.',
    fix:
      'Say the result in the prompt\'s own words from {winnerInfo} and {voteTally}. If a share is '
      + 'wanted, no variable computes a defensible one today.',
  },
];

/* --------------------------------------------------------------- text -- */

const asString = (v) => (typeof v === 'string' ? v : '');

/**
 * The fields a `{token}` can appear in, in the order the assembled prompt puts
 * them, with the field named so a finding can say where it looked.
 *
 * `template` wins outright when present: get-ai-summary.js:2162 takes it and
 * never reads `instructions` or `outputFormat`. Reporting on fields the engine
 * would ignore is how a preflight teaches an author something untrue.
 */
function promptSources(input) {
  const out = [];
  if (asString(input.template)) {
    out.push({ field: 'template', text: asString(input.template) });
  } else {
    if (asString(input.instructions)) out.push({ field: 'instructions', text: asString(input.instructions) });
    if (asString(input.outputFormat)) out.push({ field: 'outputFormat', text: asString(input.outputFormat) });
  }
  const sections = Array.isArray(input.outputSections) ? input.outputSections : [];
  sections.forEach((s, i) => {
    if (!s || typeof s !== 'object' || Array.isArray(s)) return;
    const label = asString(s.heading).trim() || `section ${i + 1}`;
    if (asString(s.heading)) out.push({ field: `outputSections[${i}].heading`, text: asString(s.heading), label });
    if (asString(s.guidance)) out.push({ field: `outputSections[${i}].guidance`, text: asString(s.guidance), label });
  });
  return out;
}

/** Every `{name}` position in one string. */
function occurrencesOf(name, text) {
  const token = `{${name}}`;
  const out = [];
  let at = text.indexOf(token);
  while (at !== -1) {
    out.push(at);
    at = text.indexOf(token, at + token.length);
  }
  return out;
}

/**
 * The sentence containing a position, trimmed to something quotable.
 *
 * Sentence boundaries are found by scanning rather than by a lookbehind regex —
 * this file ships in the webpack bundle and lookbehind is not universally
 * available in the browsers the build targets.
 */
function sentenceAround(text, index, max = 190) {
  const lineStart = text.lastIndexOf('\n', index) + 1;
  let lineEnd = text.indexOf('\n', index);
  if (lineEnd === -1) lineEnd = text.length;

  let start = lineStart;
  for (let i = index - 1; i > lineStart; i -= 1) {
    if ('.!?'.includes(text[i]) && /\s/.test(text[i + 1] || ' ')) { start = i + 1; break; }
  }
  let end = lineEnd;
  for (let i = index; i < lineEnd; i += 1) {
    if ('.!?'.includes(text[i]) && /\s/.test(text[i + 1] || ' ')) { end = i + 1; break; }
  }

  let out = text.slice(start, end).trim().replace(/\s+/g, ' ');
  if (out.length > max) out = `${out.slice(0, max - 1)}…`;
  return out;
}

/* -------------------------------------------------- prose vs field form -- */

/**
 * THE HARDEST CHECK IN THIS FILE, and the reason it exists. Defect D2.
 *
 * The substitution loop (get-ai-summary.js:2224-2227) is a global replace, per
 * token, over the whole assembled prompt. It has no idea whether a `{token}`
 * was written as a *field to be filled* or as the *name of a field* inside a
 * sentence. Both get the value.
 *
 * The advisor prompt does both, deliberately and in the same file. Its field
 * list is the good form:
 *
 *     - How many people answered: {responseCount}
 *
 * and its rules name the same fields as nouns:
 *
 *     10. … If {responseCount} is 0, write one plain line …
 *
 * which arrives at the model as *"If 11 is 0, write one plain line"*. Rule 4
 * arrives at 1,557 characters, of which 1,390 is inlined tally and breakdown.
 * The evaluator recovered rule 4's intent only by working out that *"ignore
 * <1,390 characters> which will still list answers sitting at zero points"*
 * must have been written as "ignore {voteTally} and {votingBreakdown}".
 *
 * TWO STEPS, kept apart on purpose so the false positives are traceable.
 *
 * STEP 1 — POSITION. A token is in FIELD form when it is the last thing on its
 * line and the text before it ends in a label separator (`:` or a dash).
 * Anything else is PROSE position. This is nearly free of judgement and gets
 * the right answer on every field list in `sets/`.
 *
 * STEP 2 — CUES. Prose position alone is not enough to report: `- The session:
 * {eventTitle}, set "{questionSetName}", round {currentRound}` puts two tokens
 * in prose position and renders perfectly. So a prose-position token is only
 * reported when one of five cues fires, and each cue is drawn from a real
 * sentence in the advisor prompt. They are listed in PROSE_CUES.
 *
 * WHAT THIS GETS WRONG, stated rather than discovered later:
 *  - FALSE POSITIVE: a short value that reads naturally after a preposition —
 *    "answer in {gameType} style" trips the preposition cue and is fine.
 *  - FALSE POSITIVE: a label line that happens to join two tokens — "Counts:
 *    {responseCount} and {voteCount}" trips the pairing cue and is fine.
 *  - FALSE NEGATIVE: a small value used as a noun with none of the five cues —
 *    "COMPLETE RESPONSE RANKING ({responseCount} total responses):" in the
 *    hardcoded default template is genuinely prose and is not reported,
 *    because reporting it would mean reporting every parenthetical.
 *  - FALSE NEGATIVE, and the structural one: this reads sentences, not meaning.
 *    A rule that refers to a field without naming its token — "read the count
 *    above" — is invisible here and is also the recommended fix, so that is the
 *    right way round.
 */
const LABEL_SEPARATOR = /[:\-–—]\s*$/;
const OPENERS = /["“'([]+\s*$/;
const CLOSERS_AND_STOPS = /^[\s"”')\].,;:!?]*$/;

function positionOf(text, index, name) {
  const lineStart = text.lastIndexOf('\n', index) + 1;
  let lineEnd = text.indexOf('\n', index);
  if (lineEnd === -1) lineEnd = text.length;

  const before = text.slice(lineStart, index);
  const after = text.slice(index + name.length + 2, lineEnd);

  const beforeTrimmed = before.replace(OPENERS, '');
  const tailIsClean = CLOSERS_AND_STOPS.test(after);
  const labelled = beforeTrimmed.trim() === '' || LABEL_SEPARATOR.test(beforeTrimmed);

  return tailIsClean && labelled ? 'field' : 'prose';
}

/**
 * The five cues, each with the sentence in
 * `sets/prompt-callandanswer-workie-advisor.json` that it was derived from.
 * `test` receives the token's own line split around it.
 */
const PROSE_CUES = [
  {
    id: 'compared-to-a-number',
    // rule 10: "If {responseCount} is 0, write one plain line…"
    test: ({ after }) => /^\s*(is|are|was|were|equals?|reaches|hits)\s+(\d|zero\b|one\b|none\b)/i.test(after),
    say: 'the sentence compares it against a number, so the value lands where the field\'s name was',
  },
  {
    id: 'reference-verb',
    // rule 4: "Read {voteCount} before you describe any result… ignore {voteTally}"
    test: ({ before }) => /\b(read|reads|ignore|ignores|check|checks|consult|quote|quotes|cite|copy|count|use|uses|see|mention|list|lists|shows?|contains?|includes?|state|states|name|names)\s+(the\s+)?$/i.test(before),
    say: 'a verb directly in front of it is addressing the field, not consuming its value',
  },
  {
    id: 'preposition',
    // rule 5: "Find two answers in {responsesText} that point in different directions"
    //
    // The trailing-text condition is not decoration; it was added after this
    // cue produced the one false positive in the whole corpus. The hardcoded
    // lessons-learned template (get-ai-summary.js:268) opens "…analyzing team
    // responses from {sessionContext}." — a preposition, a token, and a full
    // stop, which renders as "…from a Team Building session using Amazon
    // Leadership Principles." and is exactly right. A field being USED as the
    // object of a sentence ends the sentence; a field being POINTED AT has the
    // sentence carry on past it ("in {responsesText} that point in different
    // directions"). Requiring the clause to continue keeps the second and drops
    // the first, and costs nothing: rule 5's own catch survives on this cue and
    // would survive on the size cue regardless.
    test: ({ before, after }) =>
      /\b(in|from|within|inside|under|among|amongst|across|through|against|into|onto|beside|alongside|between)\s+(the\s+)?$/i.test(before)
      && !CLOSERS_AND_STOPS.test(after),
    say: 'a preposition in front of it, and a clause continuing past it, treat the field as a place to look',
  },
  {
    id: 'paired-with-another-token',
    // rule 2: "…are {responseCount} and {voteCount}."  rule 4: "ignore {voteTally} and {votingBreakdown}"
    test: ({ before, after }) =>
      /\{[A-Za-z_$][A-Za-z0-9_$]*\}\s*(,|and|or)\s*$/i.test(before)
      || /^\s*(,|and|or)\s*\{[A-Za-z_$][A-Za-z0-9_$]*\}/i.test(after),
    say: 'it is listed alongside another token, which is something you only do to field names',
  },
  {
    id: 'large-value',
    // rule 5's {responsesText}: 2,244 characters arriving mid-sentence.
    test: ({ size }) => size >= LARGE_VALUE_CHARS,
    say: 'the value is large enough that the sentence around it disappears',
  },
];

function cuesFor(text, index, name) {
  const lineStart = text.lastIndexOf('\n', index) + 1;
  let lineEnd = text.indexOf('\n', index);
  if (lineEnd === -1) lineEnd = text.length;
  const ctx = {
    before: text.slice(lineStart, index),
    after: text.slice(index + name.length + 2, lineEnd),
    size: sizeOf(name),
  };
  return PROSE_CUES.filter((c) => c.test(ctx));
}

/* ---------------------------------------------------------- the survey -- */

/**
 * Walk every source once and record, per variable: where it appears, in what
 * position, and which cues fired. Everything else in this file reads this.
 */
function surveyVariables(sources) {
  const byName = new Map();

  for (const source of sources) {
    for (const name of extractVariableTokens(source.text)) {
      if (!byName.has(name)) {
        byName.set(name, {
          name,
          size: sizeOf(name),
          known: isKnownTemplateVariable(name),
          occurrences: [],
        });
      }
      const entry = byName.get(name);
      for (const index of occurrencesOf(name, source.text)) {
        entry.occurrences.push({
          field: source.field,
          index,
          position: positionOf(source.text, index, name),
          cues: cuesFor(source.text, index, name),
          quote: sentenceAround(source.text, index),
        });
      }
    }
  }

  return [...byName.values()].map((v) => ({
    ...v,
    count: v.occurrences.length,
    proseUses: v.occurrences.filter((o) => o.position === 'prose' && o.cues.length > 0),
  }));
}

/* ---------------------------------------------------------- formatting -- */

const n = (value) => Number(value).toLocaleString('en-US');
const plural = (count, one, many) => `${n(count)} ${count === 1 ? one : many}`;

const finding = (code, title, detail, evidence, fix) => ({
  code: String(code),
  title: String(title),
  detail: String(detail),
  evidence: String(evidence),
  fix: String(fix),
});

/* ------------------------------------------------------- output shape -- */

/**
 * The rules of `normalizeOutputSections` (admin/shared/prompt-shape.js:127-159
 * and its byte-identical twin in game/), restated as reasons rather than as a
 * boolean.
 *
 * Restated, not imported: `src/` is a separate webpack build from
 * `lambda-functions/`, exactly as template-variables.js's header describes, and
 * there is no `src/src/config/` copy of prompt-shape.js to import. If one is
 * ever added, this function should read it instead. The one thing that must not
 * drift is the character class in the heading check, which is copied verbatim.
 *
 * Why these are BLOCKING rather than silent: a declaration that fails ANY of
 * these rules is discarded WHOLE (`return null` at every branch, deliberately —
 * "a half-applied shape is one nobody authored"), and the prompt is then run
 * against DEFAULT_OUTPUT_SECTIONS. The author gets Summary / Discussion
 * Questions / Next Steps, with no error anywhere, on a prompt whose entire
 * point was a different shape.
 */
function outputSectionDefects(raw) {
  const out = [];
  if (typeof raw === 'undefined' || raw === null) return out;
  if (!Array.isArray(raw)) {
    out.push({ why: 'outputSections is not an array', evidence: `outputSections: ${typeof raw}` });
    return out;
  }
  if (raw.length === 0) return out; // absent and empty are the same intent
  if (raw.length > 8) {
    out.push({
      why: `there are ${raw.length} sections and the limit is 8 (MAX_SECTIONS)`,
      evidence: raw.map((s) => (s && s.heading) || '?').join(' · '),
    });
  }

  const seen = new Set();
  raw.forEach((entry, i) => {
    const where = `outputSections[${i}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      out.push({ why: `${where} is not an object`, evidence: JSON.stringify(entry) });
      return;
    }
    const heading = typeof entry.heading === 'string' ? entry.heading.trim() : '';
    if (!heading) {
      out.push({ why: `${where} has no heading`, evidence: JSON.stringify(entry).slice(0, 120) });
      return;
    }
    if (heading.length > 60) {
      out.push({
        why: `${where}'s heading is ${heading.length} characters and the limit is 60`,
        evidence: heading,
      });
    }
    if (/[\r\n]/.test(heading)) {
      out.push({ why: `${where}'s heading spans more than one line`, evidence: heading.replace(/[\r\n]+/g, ' ⏎ ') });
    }
    if (/[#*_`>|[\]{}]/.test(heading)) {
      out.push({
        why: `${where}'s heading contains markdown or brace syntax, which is refused so a prompt `
          + 'cannot smuggle extra sections — or a leading H1 — into the parser\'s contract',
        evidence: heading,
      });
    }
    if (!/[A-Za-z]/.test(heading)) {
      out.push({ why: `${where}'s heading has no letters in it`, evidence: heading });
    }
    const key = heading.toLowerCase();
    if (seen.has(key)) {
      out.push({
        why: `${where}'s heading repeats an earlier one (headings are compared case-insensitively, `
          + 'because a response has to split unambiguously)',
        evidence: heading,
      });
    }
    seen.add(key);

    if (typeof entry.guidance !== 'undefined' && typeof entry.guidance !== 'string') {
      out.push({ why: `${where}'s guidance is not a string`, evidence: `guidance: ${typeof entry.guidance}` });
    } else if (typeof entry.guidance === 'string' && entry.guidance.trim().length > 600) {
      out.push({
        why: `${where}'s guidance is ${entry.guidance.trim().length} characters and the limit is 600`,
        evidence: `${entry.guidance.trim().slice(0, 120)}…`,
      });
    }
  });

  return out;
}

/**
 * The headings parseAIResponse recognises, copied from get-ai-summary.js:95-99.
 * A declared shape is free to use none of them — that is what `customShape`
 * exists for, and the whole reply becomes `summaryText`. But `discussionQuestions`
 * and `nextSteps` are filled ONLY by a synonym match (:162-163), and those two
 * fields drive the host remote (config/hostRemote.js:536) and the panel list at
 * GameHostPage.jsx:4792. A shape that matches neither leaves both empty.
 */
const SECTION_SYNONYMS = {
  summary: /^(summary|results?|overview|insights?|analysis|key\s*lessons?|key\s*takeaways?|takeaways?|themes?|common\s*themes?|dive\s*deep|game\s*status|challenge)\b/i,
  discussion: /^(discussion\s*(questions?|topics?|prompts?)|questions?\s*(to\s*discuss)?|talking\s*points?|prompts?)\b/i,
  nextSteps: /^(next\s*steps?|actions?|action\s*items?|recommendations?|strategic\s*recommendations?|implementation(\s*priority)?)\b/i,
};

/* --------------------------------------------------------- word budget -- */

/** The tightest word cap the prompt states, or null. */
function statedWordCap(text) {
  const caps = [];
  const patterns = [
    /\bunder\s+(\d{2,4})\s*words\b/gi,
    /\bno more than\s+(\d{2,4})\s*words\b/gi,
    /\bat most\s+(\d{2,4})\s*words\b/gi,
    /\bmaximum\s+(?:of\s+)?(\d{2,4})\s*words\b/gi,
    /\b(\d{2,4})\s*words\s+(?:or fewer|or less|max\b|maximum\b)/gi,
  ];
  for (const re of patterns) {
    let m = re.exec(text);
    while (m !== null) {
      caps.push({ words: Number(m[1]), quote: m[0] });
      m = re.exec(text);
    }
  }
  if (!caps.length) return null;
  return caps.reduce((a, b) => (b.words < a.words ? b : a));
}

/**
 * A section that cannot be written without quoting. Every phrase here appears
 * in the advisor's four sections, which is the case F6 is about: four sections
 * each requiring a 15–25 word verbatim quote, against a 400-word cap. Both
 * reports landed at 399 tokens after three trimming passes, and the thing that
 * got cut was evidence — despite the prompt saying "cut adjectives before you
 * cut evidence".
 */
const EVIDENCE_PHRASES = /\bquot(?:e|es|ed|ing)\b|\bverbatim\b|\bevidence\b|\bin full\b|\bown words\b|\bspecific answer\b|\btraces? to\b|\bword for word\b/i;

/** Words of prose per evidence-bearing section, below which the budget bites. */
const WORDS_PER_EVIDENCE_SECTION = 120;

/* --------------------------------------------------------------- emoji -- */

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F2FF}\u{2600}-\u{27BF}]/u;

/**
 * "no emoji" as a ban, but NOT `sets/prompt-poll-round.json`'s "no emoji-only
 * lines", which bans a layout and not the character. Getting this wrong would
 * fire the check on three shipped prompts that are behaving correctly.
 */
const EMOJI_BAN = /\b(?:no|never|avoid|not|without)\b[^.\n]{0,40}\bemoji\b(?!\s*-?\s*only)/i;

/**
 * The variables whose values carry medals. get-ai-summary.js:1418-1421 builds
 * `responsesText` with 🥇 1st Place / 🥈 / 🥉, and :1627-1632 does the same for
 * `finalResults`. Twelve emoji appeared in the two assembled prompts of the
 * measured session. Defect D5.
 */
const EMOJI_BEARING = {
  responsesText: 'get-ai-summary.js:1418-1421 — "🥇 1st Place" / "🥈 2nd Place" / "🥉 3rd Place"',
  finalResults: 'get-ai-summary.js:1627-1632 — "🥇", "🥈", "🥉" before each result',
};

/* --------------------------------------------------- back-references -- */

const BACKREF_BAN = /\b(?:never|do not|don't|avoid|no)\b[^.\n]{0,140}["“']?\bthe above\b["”']?/i;
const BACKREF_USE = /\b(?:named|listed|described|mentioned|stated|shown|given|quoted|identified)\s+above\b|\bthe above\b|\bas discussed\b/i;

/** Split into sentences without a lookbehind. See sentenceAround. */
function sentences(text) {
  const out = [];
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (('.!?'.includes(text[i]) && /\s/.test(text[i + 1] || ' ')) || text[i] === '\n') {
      const s = text.slice(start, i + 1).trim();
      if (s) out.push(s);
      start = i + 1;
    }
  }
  const tail = text.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

/* ================================================================ main == */

const EMPTY_STATS = {
  assembledChars: 0,
  variablesUsed: 0,
  inlinedChars: 0,
  duplicatedChars: 0,
  estimatedWords: 0,
};

/**
 * Everything the editor can know about a prompt without saving it.
 *
 * @param {object} input
 * @param {string} [input.instructions]     the analysis prompt's content framing
 * @param {string} [input.outputFormat]     its format block
 * @param {Array}  [input.outputSections]   its declared output shape
 * @param {string} [input.template]         a legacy single-field prompt; wins outright
 * @param {string} [input.gameType]         canonical dashed id
 * @param {boolean}[input.isDefault]        the flag, and its blast radius
 * @param {string} [input.targetModel]      defaults to production's Haiku 4.5
 * @param {string} [input.category]         optional, outside the fixed contract: when present it
 *                                          sharpens the isDefault finding, because the tie-break
 *                                          between two prompts claiming the flag is decided on it
 */
export function preflightPrompt(input = {}) {
  const blocking = [];
  const silent = [];
  const advisory = [];

  const sources = promptSources(input);
  const authoredText = sources.map((s) => s.text).join('\n\n');

  if (!authoredText.trim()) {
    return {
      blocking: [finding(
        'empty-prompt',
        'There is nothing here to check.',
        'A prompt needs either a template, or both instructions and an output format '
          + '(get-ai-summary.js:2162-2168). None of the three has any text in it.',
        'instructions: "" · outputFormat: "" · template: ""',
        'Write the instructions and the output format, then run this again.'
      )],
      silent: [],
      advisory: [],
      stats: { ...EMPTY_STATS },
      variables: [],
    };
  }

  const variables = surveyVariables(sources);
  const gameType = String(input.gameType || '');
  const model = modelFor(input.targetModel);

  /* ---------------------------------------------------------- BLOCKING --
     The prompt will not run as written.                                   */

  /*
    THE SHAPE GATE, and it is one line in get-ai-summary.js:2162-2168 — template,
    OR instructions AND outputFormat. It is worth stating what failing it costs,
    because the failure is not loud: resolvePromptTemplate returns nothing usable,
    the handler falls to buildFallback(), and the round makes NO Bedrock call at
    all. Canned text, no error, nothing in the logs. That is the same shape as
    RESUME.md's landmine about a pointer with no body.
  */
  const hasTemplate = Boolean(asString(input.template).trim());
  const hasInstructions = Boolean(asString(input.instructions).trim());
  const hasOutputFormat = Boolean(asString(input.outputFormat).trim());
  if (!hasTemplate && !(hasInstructions && hasOutputFormat)) {
    const missing = hasInstructions ? 'an output format' : 'instructions';
    blocking.push(finding(
      'unusable-shape',
      `The summary engine cannot run this prompt — it has no ${missing}.`,
      'get-ai-summary.js:2162-2168 accepts a `template`, or `instructions` AND `outputFormat` '
        + 'together, and nothing else. A prompt that satisfies neither does not fail loudly: '
        + 'the handler falls through to buildFallback(), the round makes no Bedrock call at all, '
        + 'and the room is shown canned text with no error anywhere.',
      `template: ${hasTemplate ? 'set' : 'empty'} · instructions: ${hasInstructions ? 'set' : 'empty'} `
        + `· outputFormat: ${hasOutputFormat ? 'set' : 'empty'}`,
      `Write ${missing}, or put the whole prompt in the single legacy template field.`
    ));
  }

  /*
    A SUMMARY PROMPT THAT NEVER RECEIVES THE ANSWERS.

    Reported live, from an Amazon Leadership Principles session: the AI replied

        "I notice you haven't provided the [Summary of the core idea/response
         being analyzed] yet. Please share the participant's actual response…"

    A player HAD answered — the worker logged
    `Found 1 answers, 1 votes` and `answer: 'Here is a simple test'`. The data
    was there. The PROMPT had no slot for it: its instructions carried the
    persona and its outputFormat carried a bracketed layout, and neither
    mentioned {responsesText}. So the model was handed a question, a format
    telling it to review "the response", and no response — and it did the only
    sensible thing, which was to ask for one.

    THIS IS THE WORST FAILURE MODE THIS FILE COVERS, because it is silent and
    plausible. Every other check here catches something that breaks; this one
    catches a prompt that RUNS, costs a Bedrock call, stores its output, and
    shows a room a message addressed to whoever wrote the prompt. Nothing logs
    an error. The round looks like it worked.

    Blocking rather than advisory: an analysis prompt with nothing to analyse
    has no correct output. The bracketed placeholders that make it read as
    "nearly right" — `[Summary of ...]` — are prose to the model, not slots the
    engine fills, and that distinction is exactly what the author missed.
  */
  /*
    WHICH VARIABLES ACTUALLY CARRY THE ROOM'S ANSWERS.

    This list decides whether a summary prompt is blocked, so a name that does
    not belong here is a false accusation and a name missing from it is a
    prompt that ships receiving nothing. Both errors were present.

    REMOVED — `answerCount`, `topAnswer`, `winningAnswer` are NOT VARIABLES.
    They appear in neither the catalogue nor get-ai-summary.js; nothing has
    ever substituted them. Three of the eight tokens that could clear this
    rule were names of nothing, so a prompt could satisfy "you receive the
    answers" with a token that renders as literal braces on a projector.

    ADDED — `playerResponses`, `playerAnswers` and `wavelengthWords` all
    resolve in the engine (:2102, :2103, :1927). Their absence blocked all
    nineteen shipped default prompts, which had been receiving their answers
    through `{playerResponses}` the whole time. The rule was right that the
    defaults were wrong-shaped; it was wrong about why.

    `uniqueAnswers` STAYS, but it is the weakest member and the catalogue now
    says so: :1645 truncates to five distinct answers and carries no counts.
    It clears this rule while handing a room of thirty five bare strings.
    Prefer `responsesText`.
  */
  const ANSWER_TOKENS = [
    'responsesText', 'triviaResponses', 'uniqueAnswers',
    'voteTally', 'votingBreakdown',
    'playerResponses', 'playerAnswers', 'wavelengthWords',
  ];
  const namesAnAnswer = variables.some((v) => ANSWER_TOKENS.includes(v.name));
  /*
    ONLY WHEN THE PROMPT SAYS IT IS AN ANALYSIS PROMPT, and the first version of
    this got that backwards — it treated a missing `promptType` as "analysis"
    and lit up every shipped default in default-ai-prompts.json. Those are
    question-GENERATION prompts: they carry no promptType, they use the legacy
    single `template` field, and they have no responses to receive because they
    run before anybody has answered anything. Ten of them went red at once,
    which is precisely the cries-wolf failure that gets a check deleted rather
    than heeded.

    So this fires on an explicit `analysis` only. Narrower than "anything not
    generation", and it still covers the reported case exactly: the prompt that
    produced the bad summary is stored with `promptType: analysis`.
  */
  if (!namesAnAnswer && String(input.promptType || '') === 'analysis') {
    blocking.push(finding(
      'no-answer-variable',
      'This prompt never receives the responses it is asked to review.',
      'None of the variables that carry what participants said appear anywhere in it '
        + `(${ANSWER_TOKENS.slice(0, 3).map((t) => `{${t}}`).join(', ')}, …). The engine substitutes `
        + 'only {braced} names; square-bracket text like "[Summary of the response]" is prose the '
        + 'model reads, not a slot anything fills. So the model is given a question, a layout that '
        + 'tells it to critique an answer, and no answer — and it replies by asking for one. That '
        + 'reply is then stored and shown to the room. Nothing errors and nothing is logged.',
      `variables found: ${variables.length ? variables.map((v) => `{${v.name}}`).join(' ') : '(none)'}`,
      'Add {responsesText} where the responses should appear — for trivia use {triviaResponses}, '
        + 'for a poll or survey {uniqueAnswers}.'
    ));
  }

  /*
    A TOKEN NOTHING SUBSTITUTES. The one check that already existed, kept here
    so a single report answers the whole question. `unknownVariableTokens` is
    the same primitive `assertTemplateVariablesExist` uses
    (admin/shared/template-variable-usage.js:76-91); that module cannot be
    imported from `src/` — separate bundle, same reason template-variables.js
    has three copies — but the catalogue underneath it is byte-identical, so
    the two cannot disagree. It is used rather than the throwing wrapper because
    a report wants one finding per token, not one exception for all of them.
  */
  for (const source of sources) {
    for (const name of unknownVariableTokens(source.text)) {
      if (blocking.some((b) => b.code === 'unknown-variable' && b.title.includes(`{${name}}`))) continue;
      const at = occurrencesOf(name, source.text)[0];
      blocking.push(finding(
        'unknown-variable',
        `{${name}} is not a variable — it will appear on the projector as literal braces.`,
        'Exactly one place substitutes tokens: the `templateVars` object in get-ai-summary.js. '
          + 'Anything not in it survives the substitution loop at :2224-2227 and is sent to the '
          + 'model, and then shown, as the four-or-more characters you typed. The save gate '
          + '(assertTemplateVariablesExist) refuses this, so the prompt cannot be written either.',
        `${source.field}: ${sentenceAround(source.text, at)}`,
        'Pick a variable from the editor\'s palette. If nothing there carries what you want, no '
          + 'variable does — a new one is a change to get-ai-summary.js and all three copies of '
          + 'template-variables.js.'
      ));
    }
  }

  /*
    A [SQUARE-BRACKET DIRECTION] — the other half of the LP failure, and the
    half that made it look nearly right. Brackets read like placeholders and
    are prose: the engine fills only {braced} names, so "[Summary of the
    response]" reaches the model verbatim, and the model answers it — on the
    reported round, by asking whoever wrote the prompt to paste the response
    in. Scoped to explicit analysis prompts exactly as no-answer-variable is,
    and for the same cried-wolf reason. The save gate
    (assertNoBracketDirections, admin/shared/template-variable-usage.js)
    refuses these, so this finding is the same wall as advice.
  */
  if (String(input.promptType || '') === 'analysis') {
    for (const source of sources) {
      for (const span of extractBracketDirections(source.text).slice(0, 3)) {
        blocking.push(finding(
          'bracket-direction',
          `"[${span.length > 60 ? `${span.slice(0, 59)}…` : span}]" is not a placeholder — the model receives it as text.`,
          'Nothing substitutes square brackets. The engine fills only {braced} variables, so a '
            + 'bracketed direction arrives at the model as literal prose — and the model answers '
            + 'it. This is the exact mechanism that put "the [Summary of the response] placeholder '
            + 'is empty" on a projector: the prompt shipped a fill-in-the-blank form, and the '
            + 'model asked who was supposed to fill it in. The save gate refuses this prompt.',
          `${source.field}: [${span}]`,
          'Where data should appear, use a {variable} from the palette. Where the bracket was an '
            + 'instruction ("[2-3 paragraphs]"), write it as a sentence — the model follows prose '
            + 'better than it follows a form.'
        ));
      }
    }
  }

  /* A DECLARED OUTPUT SHAPE THAT IS DISCARDED WHOLE. */
  for (const defect of outputSectionDefects(input.outputSections)) {
    blocking.push(finding(
      'output-shape-discarded',
      `The declared output shape will be thrown away: ${defect.why}.`,
      'normalizeOutputSections (prompt-shape.js:127-159) validates the whole declaration and '
        + 'returns null for ALL of it on any single failure — deliberately, because "a half-applied '
        + 'shape is one nobody authored and nobody can predict". The prompt then runs against the '
        + 'default Summary / Discussion Questions / Next Steps triad, with no error and no warning, '
        + 'which for a prompt whose point was a different shape is the whole prompt not working.',
      defect.evidence,
      'Fix the heading or the guidance named above. The rules exist to keep parseAIResponse honest: '
        + 'a heading has to be plain single-line text so `## <heading>` is markdown the parser will '
        + 'find, and it has to be unique so a response splits unambiguously.'
    ));
  }

  /* ------------------------------------------------------------ SILENT --
     It saves, it runs, and nothing says a word.                            */

  /*
    D2 — THE HEADLINE. A variable named in prose has its VALUE inlined.
  */
  for (const v of variables) {
    if (!v.known || v.proseUses.length === 0) continue;
    const chars = v.size * v.proseUses.length;
    const reasons = [...new Set(v.proseUses.flatMap((o) => o.cues.map((c) => c.say)))];
    const quotes = v.proseUses.slice(0, 3).map((o) => `${o.field}: ${o.quote}`).join('\n');

    silent.push(finding(
      'prose-inlined-variable',
      v.size >= LARGE_VALUE_CHARS
        ? `{${v.name}} is named inside a sentence, and about ${n(chars)} characters of data will `
          + 'be inlined into that sentence.'
        : `{${v.name}} is named inside a sentence, so the sentence arrives with its value in place `
          + 'of the field\'s name.',
      'The substitution loop at get-ai-summary.js:2224-2227 is a global replace, per token, over '
        + 'the whole assembled prompt. It cannot tell a field waiting to be filled from the name of '
        + 'a field inside a rule, so both get the value. In the measured session this destroyed '
        + 'three of fourteen rules: rule 10\'s "If {responseCount} is 0" arrived as "If 11 is 0", '
        + 'and rule 4 arrived at 1,557 characters of which 1,390 was inlined tally and breakdown. '
        + `Here: ${plural(v.proseUses.length, 'reference', 'references')} in prose position, `
        + `each inlining about ${n(v.size)} characters. Flagged because ${reasons.join('; and ')}.`,
      quotes,
      'Refer to the field by the English label you already print beside it in the field list, not '
        + 'by its token: "Read the count under \'How many people voted\'" rather than "Read '
        + `{${v.name}}". The label survives substitution; the token does not.`
    ));
  }

  /*
    THE SAME LARGE VALUE, TWICE. Independent of prose form — a field list that
    names {responsesText} and a rule that names it again inline the answers
    twice, and so does a field list that names it twice.
  */
  for (const v of variables) {
    if (!v.known || v.count < 2 || v.size < LARGE_VALUE_CHARS) continue;
    const duplicated = v.size * (v.count - 1);
    silent.push(finding(
      'duplicated-variable',
      `{${v.name}} appears ${plural(v.count, 'time', 'times')}, so about ${n(duplicated)} characters `
        + 'of the prompt will be a second copy of the first one.',
      'Each occurrence is substituted separately, so the value is inlined once per occurrence. In '
        + 'the measured round-4 prompt, responsesText (2,244), voteTally (635) and votingBreakdown '
        + '(732) each appeared exactly twice: 7,222 characters — 40% of an 18,072-character prompt '
        + '— of which 3,611 was pure duplication. Repeating the material does not reinforce it; on '
        + 'a small model it competes with the instructions for attention, and the second copy is '
        + 'indistinguishable from the first by position.',
      v.occurrences.map((o) => `${o.field}: ${o.quote}`).slice(0, 3).join('\n'),
      `Name {${v.name}} once, in the field list, and refer to it everywhere else by the label `
        + 'printed beside it there.'
    ));
  }

  /* THE FIVE THAT RESOLVE CLEANLY AND ARE WRONG. */
  const usedNames = new Set(variables.map((v) => v.name));
  for (const unsafe of UNSAFE_VARIABLES) {
    if (!usedNames.has(unsafe.name)) continue;
    const v = variables.find((x) => x.name === unsafe.name);
    const paired = unsafe.pairedWith && usedNames.has(unsafe.pairedWith);
    silent.push(finding(
      'unsafe-variable',
      unsafe.title,
      paired ? `${unsafe.detail}\n\n${unsafe.pairedDetail}` : unsafe.detail,
      v.occurrences.map((o) => `${o.field}: ${o.quote}`).slice(0, 2).join('\n'),
      unsafe.fix
    ));
  }

  /*
    A CUSTOM SHAPE THAT EMPTIES THE STRUCTURED FIELDS. Not a parse failure —
    parseAIResponse's customShape branch (:165-171) keeps the whole reply as
    summaryText and the markdown renders exactly as written. What goes empty is
    discussionQuestions and nextSteps, which are filled only by a SECTION_SYNONYMS
    match (:162-163) and which feed the host remote and the host panel.
  */
  const declared = Array.isArray(input.outputSections) ? input.outputSections : [];
  const headings = declared
    .filter((s) => s && typeof s === 'object' && typeof s.heading === 'string')
    .map((s) => s.heading.trim())
    .filter(Boolean);
  if (headings.length && outputSectionDefects(input.outputSections).length === 0) {
    const kinds = new Set();
    for (const h of headings) {
      for (const [kind, re] of Object.entries(SECTION_SYNONYMS)) {
        if (re.test(h)) kinds.add(kind);
      }
    }
    const emptied = ['discussion', 'nextSteps'].filter((k) => !kinds.has(k));
    if (emptied.length) {
      const labels = { discussion: 'discussionQuestions', nextSteps: 'nextSteps' };
      silent.push(finding(
        'structured-fields-empty',
        `${emptied.map((k) => labels[k]).join(' and ')} will come back empty on every round.`,
        'The declared headings are honoured and the markdown renders exactly as written — that part '
          + 'is fine. But parseAIResponse fills discussionQuestions and nextSteps only from a '
          + 'heading that matches SECTION_SYNONYMS (get-ai-summary.js:95-99, :162-163), and none of '
          + 'these headings does. Those two fields drive the phone remote '
          + '(config/hostRemote.js:536) and the list at GameHostPage.jsx:4792, so both go quiet '
          + 'while the projector looks correct.',
        headings.join(' · '),
        'If those surfaces matter, name a section so it matches — "Discussion topics" and "Next '
          + 'steps" both do. If they do not, this costs nothing and can be ignored.'
      ));
    }
  }

  /* ISDEFAULT — THE FLAG THAT IS NOT ABOUT THIS QUESTION SET. */
  if (input.isDefault === true) {
    const canonical = gameType || 'this game type';
    const preferred = PREFERRED_DEFAULT_CATEGORY[gameType];
    silent.push(finding(
      'default-blast-radius',
      `Saving this as the default replaces the summary for EVERY ${canonical} set in this tier.`,
      'isDefault is not scoped to a question set. findDefaultPromptId (get-ai-summary.js:340-390) '
        + 'scans the whole AIPROMPTS partition for `isDefault: true` and matches on game type '
        + 'alone, so every set of that type with no prompt of its own gets this one — including '
        + 'sets nobody has opened in months and sets somebody else owns.\n\n'
        + 'The second half matters more, because it is the half nobody expects: when MORE THAN ONE '
        + 'prompt claims the flag, nothing fails and nothing asks. The handler logs a warning and '
        + 'resolves deterministically, ranking by preferred category first, then analysis shape, '
        + 'then oldest createdAt, then promptId (:369-383). '
        + (preferred
          ? `For ${canonical} the preferred category is "${preferred}", so a prompt in that `
            + `category outranks one that is not, whatever its name or its age. `
            + (input.category && input.category !== preferred
              ? `This prompt is in "${input.category}", which loses that tie-break.`
              : '')
          : 'This game type has no entry in PREFERRED_DEFAULT_CATEGORY, so the tie falls through to '
            + 'createdAt.'),
      `isDefault: true · gameType: ${gameType ? `"${gameType}"` : '(not set)'}`
        + (input.category ? ` · category: "${input.category}"` : ''),
      'If this prompt is for one set, attach it to that set and leave isDefault off. If it really '
        + 'is the house default, run scripts/cull-ai-prompts.js afterwards to confirm exactly one '
        + 'prompt claims the flag for this game type.'
    ));
  }

  /* ---------------------------------------------------------- ADVISORY -- */

  /* SIZE, AND THE CAP NOBODY ENFORCES. */
  const tokenChars = variables.reduce((sum, v) => sum + (v.name.length + 2) * v.count, 0);
  const inlinedChars = variables.reduce((sum, v) => sum + v.size * v.count, 0);
  const duplicatedChars = variables.reduce((sum, v) => sum + v.size * Math.max(0, v.count - 1), 0);

  const contractBody = declared.length
    ? declared
      .filter((s) => s && typeof s === 'object')
      .map((s) => `## ${asString(s.heading)}${asString(s.guidance) ? `\n${asString(s.guidance)}` : ''}`)
      .join('\n\n').length
    : 324; // the default triad's body, measured
  const authoredChars = hasTemplate
    ? asString(input.template).length
    : asString(input.instructions).length + 2 + asString(input.outputFormat).length;

  const assembledChars = Math.max(
    0,
    VOICE_LABEL_CHARS + PERSONA_VOICE_ALLOWANCE + authoredChars
    + CONTRACT_FIXED_CHARS + contractBody - tokenChars + inlinedChars
  );
  const estimatedWords = Math.round(assembledChars / CHARS_PER_WORD);

  const cap = statedWordCap(authoredText);
  if (cap && cap.words < model.approxWords) {
    advisory.push(finding(
      'word-cap-not-enforced',
      `The ${n(cap.words)}-word cap is a request, not a limit — the model can write about `
        + `${n(model.approxWords)} words before anything stops it.`,
      `${model.label} runs with max_tokens: ${n(model.maxTokens)} (get-ai-summary.js:2271-2276), `
        + `which is roughly ${n(model.approxWords)} words. Nothing truncates below that, so the `
        + `${n(cap.words)}-word cap is enforced only by the model\'s own compliance, at `
        + 'temperature 0.5. The measured session needed three explicit trimming passes to land '
        + 'under 400 on Opus; §6 of the simulated-session document ranks the cap fourth most '
        + `likely to break on Haiku.${model.assumed ? ' No targetModel was given, so production\'s is assumed.' : ''}`,
      cap.quote,
      'Say the cap in a form the model can check — "four sections, at most three bullets each" is '
        + 'countable while "under 400 words" is not — or accept an overrun and cut it in the room.'
    ));
  }

  /* THE CAP AGAINST THE EVIDENCE IT DEMANDS. */
  const evidenceSections = declared.filter(
    (s) => s && typeof s === 'object' && EVIDENCE_PHRASES.test(asString(s.guidance))
  );
  if (cap && evidenceSections.length >= 2) {
    const perSection = Math.round(cap.words / evidenceSections.length);
    if (perSection < WORDS_PER_EVIDENCE_SECTION) {
      advisory.push(finding(
        'evidence-budget',
        `${plural(evidenceSections.length, 'section', 'sections')} require quoted evidence and the `
          + `cap leaves about ${n(perSection)} words for each.`,
        'A verbatim quote from a room runs 15–25 words, and a section that quotes also has to '
          + 'introduce the quote and say what it means. This is friction F6, observed rather than '
          + 'predicted: both reports in the measured session landed at exactly 399 tokens after '
          + 'three trimming passes, and what got cut was evidence — one lost "I do not spend '
          + 'writing anything" off the end of a quote — despite the prompt saying "cut adjectives '
          + 'before you cut evidence". The cap is enforced by cutting the one thing the prompt '
          + 'says to protect, every time, silently.',
        `${cap.quote} · sections requiring evidence: `
          + evidenceSections.map((s) => asString(s.heading)).join(' · '),
        'Raise the cap, or drop a section, or reduce what one section must quote. All three are '
          + 'trades about room airtime and none of them is free — this is a decision, not a defect.'
      ));
    }
  }

  /* PROMPT SIZE. */
  if (assembledChars >= LARGE_PROMPT_CHARS) {
    advisory.push(finding(
      'assembled-size',
      `This assembles to roughly ${n(assembledChars)} characters — about ${n(estimatedWords)} words `
        + `— of which about ${n(inlinedChars)} is substituted data.`,
      'Nowhere near a context limit; the concern is placement. Instruction adherence decays with '
        + 'distance from the instruction on a small model, and in the measured session all fourteen '
        + 'rules sat on the far side of ~9,000 characters of answers and tallies (F8). Nothing '
        + 'truncates the per-answer lists either, so this grows linearly with the room: 18 KB at '
        + '11 people, around 30 KB at 40. The numbers here assume an 11-person round and include a '
        + `${n(PERSONA_VOICE_ALLOWANCE)}-character allowance for the persona voice, which is chosen `
        + 'per game and is not knowable here.',
      `authored: ${n(authoredChars)} chars · substituted: ${n(inlinedChars)} chars · `
        + `format contract: ${n(CONTRACT_FIXED_CHARS + contractBody)} chars`,
      'Put the rules before the material. Both blocks live inside the same instructions string, so '
        + 'it is a cut and paste with no code change.'
    ));
  }

  /* EMOJI IN, EMOJI BANNED OUT. */
  if (EMOJI_BAN.test(authoredText)) {
    const banSentence = sentences(authoredText).find((s) => EMOJI_BAN.test(s)) || '';
    const bearers = Object.keys(EMOJI_BEARING).filter((name) => usedNames.has(name));
    const authorEmoji = EMOJI.test(authoredText);
    if (bearers.length || authorEmoji) {
      advisory.push(finding(
        'emoji-shown-and-banned',
        'This prompt bans emoji in the output and shows the model emoji in the material.',
        (bearers.length
          ? `${bearers.map((b) => `{${b}}`).join(' and ')} arrive with medals in them — `
            + `${bearers.map((b) => EMOJI_BEARING[b]).join('; ')}. Twelve emoji appeared in the two `
            + 'assembled prompts of the measured session. '
          : '')
          + (authorEmoji ? 'The prompt\'s own text also contains emoji. ' : '')
          + 'Defect D5. Opus had no difficulty obeying the ban; mirroring input tokens back out is '
          + 'a smaller-model behaviour and production is Haiku, so this is untested where it '
          + 'matters. It is advisory rather than silent because the failure is possible, not '
          + 'certain.',
        banSentence.slice(0, 190),
        'Either drop the ban, or say what to do with them: "the medals in the material are '
          + 'formatting, not content — do not repeat them."'
      ));
    }
  }

  /* A RULE THAT BANS THE BACK-REFERENCE ANOTHER RULE REQUIRES. */
  const allSentences = sources.flatMap((s) => sentences(s.text).map((text) => ({ field: s.field, text })));
  const ban = allSentences.find((s) => BACKREF_BAN.test(s.text));
  if (ban) {
    const use = allSentences.find((s) => s !== ban && !BACKREF_BAN.test(s.text) && BACKREF_USE.test(s.text));
    if (use) {
      advisory.push(finding(
        'back-reference-collision',
        'One instruction bans "the above" and another one asks for it.',
        'The model has to break one of the two. Friction F2, and it was not free: obeying the ban '
          + 'meant restating the whole split inside the discussion question, which cost about 25 '
          + 'words out of a 400-word budget — and those 25 words came out of evidence. Worth '
          + 'separating from a style question: section order IS guaranteed (buildOutputContract '
          + 'says "in this order"), so "above" is not ambiguous. It is the two instructions that '
          + 'are.',
        `bans — ${ban.field}: ${ban.text.slice(0, 150)}\nasks — ${use.field}: ${use.text.slice(0, 150)}`,
        'Point at the thing rather than at its position: "the split you named in the first '
          + 'section, restated here in full".'
      ));
    }
  }

  /*
    NOT CHECKED, AND THE OMISSION IS THE POINT: "this variable is not offered
    for this game type". It was built, it was run against the four prompts in
    `sets/`, and it cried wolf on two of them. `sets/prompt-poll-round.json` —
    the shipped poll default — uses {voteTally}, {topVotedAnswers},
    {votingBreakdown} and {consensusLevel}, all four of which the catalogue
    scopes to `['call-and-answer']`. A poll round votes (ASK → VOTE → RESULTS),
    those values are built by the same non-trivia branch, and they resolve
    correctly. The catalogue's scoping is wrong there, not the prompt, and a
    check that reports a correct prompt as suspect is a check people turn off.
    Reported as a catalogue question instead of shipped as a finding.
  */

  return {
    blocking,
    silent,
    advisory,
    stats: {
      assembledChars,
      variablesUsed: variables.length,
      inlinedChars,
      duplicatedChars,
      estimatedWords,
    },
    variables: variables.map((v) => ({
      name: v.name,
      known: v.known,
      count: v.count,
      renderedChars: v.size,
      proseUses: v.proseUses.length,
    })),
  };
}

/**
 * One line for the head of the report: what this prompt IS, before any verdict.
 * Same job as csvPreflight's describePreflight — the size and the shape first,
 * so the tiers below it have something to be about.
 */
export function describePreflight(report) {
  if (!report || !report.stats) return '';
  const { assembledChars, variablesUsed, inlinedChars } = report.stats;
  const counts = [
    report.blocking.length ? `${report.blocking.length} blocking` : '',
    report.silent.length ? `${report.silent.length} silent` : '',
    report.advisory.length ? `${report.advisory.length} advisory` : '',
  ].filter(Boolean);
  return [
    `~${n(assembledChars)} chars assembled`,
    `${plural(variablesUsed, 'variable', 'variables')}`,
    `${n(inlinedChars)} substituted`,
    counts.length ? counts.join(' · ') : 'nothing to report',
  ].join(' · ');
}

export default preflightPrompt;
