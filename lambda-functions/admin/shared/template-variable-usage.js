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

module.exports = {
  variablesToOffer,
  describeVariablesForPrompt,
  assertTemplateVariablesExist,
};
