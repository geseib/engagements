/**
 * Rendering the variable catalogue into something a model can act on.
 *
 * Both AI helpers used to be given either nothing (the advisor) or a bare
 * comma-separated list of names that was frequently empty (the generator).
 * Names alone still leave a model guessing what `{voteTally}` contains versus
 * `{votingBreakdown}`, and guessing is one step from inventing. So each line
 * carries its description, grouped under the palette's own headers.
 *
 * Lives in admin/ because only admin handlers build prompts ABOUT prompts.
 * The catalogue it reads is the byte-identical copy in this directory — see the
 * header of shared/template-variables.js for why there are three copies.
 */
const {
  TEMPLATE_VARIABLES,
  VARIABLE_CATEGORY_ORDER,
  variablesForGameType,
  unknownVariableTokens,
  extractVariableTokens,
  extractBracketDirections,
} = require('./template-variables');

/**
 * The variables to offer for a canonical game-type id.
 *
 * `null`/unknown deliberately yields EVERYTHING rather than nothing: an advisor
 * asked to "validate variable usage" with no list is the bug this exists to
 * fix, and a caller that omitted the type should still get useful advice.
 * Callers that must not proceed on an unknown type (the generator) validate
 * before they get here.
 */
function variablesToOffer(canonicalGameType) {
  if (!canonicalGameType) return TEMPLATE_VARIABLES;
  const scoped = variablesForGameType(canonicalGameType);
  return scoped.length > 0 ? scoped : TEMPLATE_VARIABLES;
}

/**
 * A grouped, described block for embedding in a prompt:
 *
 *   Set Info
 *   - {questionSetName} — Name of the question set being used
 *   ...
 */
function describeVariablesForPrompt(canonicalGameType) {
  const variables = variablesToOffer(canonicalGameType);
  return VARIABLE_CATEGORY_ORDER
    .map((category) => {
      const inCategory = variables.filter((v) => v.category === category);
      if (inCategory.length === 0) return null;
      return [
        category,
        ...inCategory.map((v) => `- {${v.name}} — ${v.description}`),
      ].join('\n');
    })
    .filter(Boolean)
    .join('\n\n');
}

/**
 * THE gate. Throws if any analysis field contains a `{token}` nothing will
 * substitute, naming every offender.
 *
 * This is the one that matters, because both AI helpers write through it: the
 * wand hands its output to the editor and the advisor's "apply" does the same,
 * so an invented variable can only reach the table by passing here.
 *
 * Scope is deliberate:
 *
 *  - ANALYSIS FIELDS ONLY (template / instructions / outputFormat). Generation
 *    prompts use a completely different vocabulary — {context}, {audience} —
 *    and validating them against this catalogue would reject every one.
 *  - INTERNAL variables count as known. Live prompts use {totalPlayers}; a gate
 *    built off the advertised list alone would reject working prompts.
 *  - A braced JSON example is not a token (see extractVariableTokens), so a
 *    prompt that shows the model an output shape still saves.
 */
function assertTemplateVariablesExist(fields) {
  const unknown = [];
  for (const value of Object.values(fields || {})) {
    for (const name of unknownVariableTokens(value)) {
      if (!unknown.includes(name)) unknown.push(name);
    }
  }
  if (unknown.length === 0) return;

  const list = unknown.map((n) => `{${n}}`).join(', ');
  throw new Error(
    `Unknown template variable${unknown.length > 1 ? 's' : ''}: ${list}. ` +
    'Nothing substitutes these, so they would appear as literal braces on screen. ' +
    'Use only the variables offered in the editor\'s variable panel.'
  );
}

/*
 * THE TWO GUARDS FROM THE LEADERSHIP PRINCIPLES FAILURE (game 4856). That
 * prompt saved cleanly, attached cleanly, ran cleanly — and put "I don't see
 * the actual response in your setup... the [Summary of the core idea/response
 * being analyzed] placeholder is empty" on a projector. Two defects, neither
 * of which anything refused:
 *
 *   1. Its outputFormat was written with [square-bracket placeholders], which
 *      LOOK like variables and are prose — nothing substitutes them, so the
 *      model receives a fill-in-the-blank form and answers it.
 *   2. Nothing in it named a response-bearing variable, so the model was asked
 *      to review answers it was never shown.
 *
 * An audit found 26 more stored prompts carrying the same defects across the
 * three tiers, so this is a class, not an incident. These assertions are the
 * wall; utils/promptPreflight.js is the same rules as advice in the editor.
 */

/**
 * The variables that carry what the room actually said or did this round.
 *
 * COPIED FROM src/src/utils/promptPreflight.js's ANSWER_TOKENS, deliberately,
 * because that list has already paid for its lessons: an earlier version
 * listed three names that were variables of nothing (`answerCount`,
 * `topAnswer`, `winningAnswer`) and omitted the three the shipped defaults
 * actually use — which blocked all nineteen of them at once. Change one copy
 * and change the other; a prompt the editor calls clean must not be refused
 * here, and vice versa.
 */
const ANSWER_TOKENS = [
  'responsesText', 'triviaResponses', 'uniqueAnswers',
  'voteTally', 'votingBreakdown',
  'playerResponses', 'playerAnswers', 'wavelengthWords',
];

/**
 * Throws when any analysis field carries a [square-bracket direction].
 *
 * Brackets read like placeholders and are prose: the substitution loop fills
 * only {braced} names, so bracketed text reaches the model verbatim — and the
 * model does the only sensible thing, which is to answer it. Markdown links
 * are already excluded by extractBracketDirections.
 */
function assertNoBracketDirections(fields) {
  const found = [];
  for (const [field, value] of Object.entries(fields || {})) {
    for (const span of extractBracketDirections(value)) {
      found.push({ field, span });
      if (found.length >= 3) break;
    }
    if (found.length >= 3) break;
  }
  if (found.length === 0) return;

  const shown = found.map(({ field, span }) => `${field}: [${span}]`).join(' · ');
  throw new Error(
    'Square-bracket placeholders are prose, not variables — nothing fills them, so the model '
    + 'receives them as literal text and replies to them, which is exactly what put '
    + '"the [Summary of the response] placeholder is empty" on a projector. '
    + `Found: ${shown}. `
    + 'Use a {variable} from the editor\'s palette where data should appear, or write the words out.'
  );
}

/**
 * Throws when an analysis prompt names no response-bearing variable anywhere —
 * a prompt asked to review answers it will never be shown. `texts` is every
 * piece of the prompt a token can live in (template, instructions,
 * outputFormat, and any declared section guidance), already merged by the
 * caller so a partial update is judged on what the prompt will BE, not on the
 * delta.
 */
function assertReceivesResponses(texts) {
  const names = new Set();
  for (const value of Object.values(texts || {})) {
    for (const name of extractVariableTokens(value)) names.add(name);
  }
  if (ANSWER_TOKENS.some((t) => names.has(t))) return;

  throw new Error(
    'This analysis prompt never receives the responses it is asked to review — none of the '
    + `variables that carry what participants said appear anywhere in it (${ANSWER_TOKENS
      .slice(0, 3).map((t) => `{${t}}`).join(', ')}, …). It would run, cost a Bedrock call, and `
    + 'show the room a reply addressed to whoever wrote the prompt. Add {responsesText} where '
    + 'the responses should appear — {triviaResponses} for trivia, {uniqueAnswers} for a poll.'
  );
}

module.exports = {
  variablesToOffer,
  describeVariablesForPrompt,
  assertTemplateVariablesExist,
  ANSWER_TOKENS,
  assertNoBracketDirections,
  assertReceivesResponses,
};
