/**
 * WHAT A WORKIE IS, FOR SOMEBODY WHO CANNOT READ THIS REPO.
 *
 * The prompt workbench (docs/superpowers/specs/2026-09-25-prompt-workbench-
 * design.md) lets an Engage admin download a Workie and hand it to an outside
 * agent. That agent has none of this code, so the file has to carry the facts
 * the save gate and the summary engine act on. This module is where the
 * server-side ones are gathered — quoted from the modules that enforce them,
 * never retyped:
 *
 *   rules      AUTHORING_RULES (template-variable-usage.js), the same list the
 *              advisor and the generator are given
 *   variables  variablesToOffer(gameType), the advisor's own catalogue, each
 *              with its meaning and example
 *   sections   prompt-shape.js's limits and its default triad
 *   layers     what get-ai-summary.js wraps a prompt in, in order
 *
 * The frontend adds what it owns (the parse contract, the model, the round
 * angles, the screens — src/src/utils/workieBundle.js) and composes the file.
 *
 * ASSEMBLY_LAYERS IS THE ONE PIECE OF PROSE HERE, and it is pinned: each
 * layer's `source` is the expression get-ai-summary.js interpolates, and
 * tests/prompt-workbench.js reads that file's assembly line and fails if the
 * order or the set differs. The advisor is told the same layers
 * (ai-prompt-advisor.js, describeTheSystem), so its advice stops asking a
 * prompt to do what the system already does — vary the opening, add the
 * host's instructions, pick an angle.
 */
const { AUTHORING_RULES, variablesToOffer } = require('./template-variable-usage');
const {
  DEFAULT_OUTPUT_SECTIONS, MAX_SECTIONS, MAX_HEADING_CHARS, MAX_GUIDANCE_CHARS,
} = require('./prompt-shape');

const ASSEMBLY_LAYERS = Object.freeze([
  Object.freeze({
    source: 'persona.voice',
    name: 'The voice',
    text: 'A persona chosen for the session (by the host, the question set, or the game type\'s default) '
      + 'opens the prompt and sets the tone. It is not part of this prompt.',
  }),
  Object.freeze({
    source: 'contextLayer',
    name: 'The session',
    text: 'What the host wrote about the session and any instructions they gave for the AI, the '
      + 'question set author\'s own context, and the question\'s Background (its author\'s notes for '
      + 'Workie), as a "SESSION CONTEXT" block — unless this prompt places {contextSections} itself, '
      + 'in which case all of it, the Background included, travels inside {contextSections} instead. '
      + 'When this prompt places {background}, the Background goes only there.',
  }),
  Object.freeze({
    source: 'templateBody',
    name: 'This prompt',
    text: 'The instructions half, a blank line, then the output-format half, with every {variable} '
      + 'replaced by this round\'s data.',
  }),
  Object.freeze({
    source: 'buildOutputContract',
    name: 'The format contract',
    text: 'Formatting and register rules, ONE opening move drawn at random each round so no two rounds '
      + 'start the same way, and the Output sections as the exact headings to use, in order. It '
      + 'overrides any formatting or structure instruction earlier in the prompt.',
  }),
  Object.freeze({
    source: 'angleLayer',
    name: 'This round\'s angle',
    text: 'Call & Answer only: each round is read from one angle — the question, the race, the event, or '
      + 'one well-known fact — drawn by the prompt\'s angle weights, never the same angle twice in a row.',
  }),
  Object.freeze({
    source: 'voiceLayer',
    name: 'The voice\'s required addition',
    text: 'If the voice requires something in every reply, it is restated here, with permission to use '
      + 'general knowledge of the world — never as something the room said.',
  }),
  Object.freeze({
    source: 'hostLayer',
    name: 'The host\'s instructions',
    text: 'The host\'s own instructions for the AI, restated after the contract so they win over the '
      + 'prompt\'s rules — but never over the headings.',
  }),
  Object.freeze({
    source: 'HONESTY_RULE',
    name: 'The honesty rule',
    text: 'On every prompt: facts come only from the material, from what the room said, or from general '
      + 'knowledge the model is certain of — never an invented number, name or quotation, nothing invented '
      + 'about the organisation or event — and a missing piece is worked around, never mentioned.',
  }),
  Object.freeze({
    source: 'briefingLayer',
    name: 'The briefing',
    text: 'Call & Answer only, when the host attached a document: its summary, last, as facts the reply '
      + 'may connect answers to — never as something a participant said.',
  }),
]);

/** The layers as a list for a model prompt. */
function describeAssemblyLayers() {
  return ASSEMBLY_LAYERS.map((layer, i) => `${i + 1}. ${layer.name} — ${layer.text}`).join('\n');
}

/**
 * Everything the server contributes to a Workie's export, for one canonical
 * game type. The caller validates the type first.
 */
function buildWorkieReference(gameType) {
  return {
    gameType,
    rules: AUTHORING_RULES.map((rule) => ({ id: rule.id, text: rule.text, enforcedOnSave: Boolean(rule.gate) })),
    variables: variablesToOffer(gameType).map((v) => ({
      name: v.name, category: v.category, description: v.description, example: v.example,
    })),
    sections: {
      maxSections: MAX_SECTIONS,
      maxHeadingChars: MAX_HEADING_CHARS,
      maxGuidanceChars: MAX_GUIDANCE_CHARS,
      default: DEFAULT_OUTPUT_SECTIONS,
    },
    layers: ASSEMBLY_LAYERS.map((layer) => ({ ...layer })),
  };
}

module.exports = { ASSEMBLY_LAYERS, describeAssemblyLayers, buildWorkieReference };
