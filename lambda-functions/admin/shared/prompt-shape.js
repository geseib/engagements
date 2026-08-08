/**
 * What kind of prompt is this, and can the summary engine actually run it?
 *
 * ⚠️ DUPLICATED ON PURPOSE — same CodeUri-per-group reason as ./game-types.js.
 * Keep in lock-step:
 *   - lambda-functions/admin/shared/prompt-shape.js   (this file)
 *   - lambda-functions/game/prompt-shape.js
 *
 * Two prompt shapes exist in the table and they are NOT interchangeable:
 *
 *   analysis   (AIPromptManager)          template | instructions + outputFormat
 *   generation (AIGenerationPromptEditor) basePrompt + contextTemplate + outputFormat
 *
 * The summary engine (game/get-ai-summary.js) can only run the analysis shape.
 * Before this module existed, a generation-shaped prompt attached to a question
 * set failed the gate deep inside resolvePromptTemplate and silently fell back
 * to the game-type default — the "I added an Art prompt and nothing changed"
 * report. It still falls back (never dead-end a live game) but now it says so,
 * and the admin UI can grey the prompt out before anyone attaches it.
 */

/**
 * Can this prompt drive an AI summary?
 *
 * This is the single gate `get-ai-summary.js` applies. `basePrompt` alone is
 * NOT enough, no matter how good the text is.
 */
function isUsableSummaryPrompt(p) {
  return Boolean(p && (p.template || (p.instructions && p.outputFormat)));
}

/** Human-readable reason a prompt failed `isUsableSummaryPrompt`, or null. */
function summaryPromptDefect(p) {
  if (!p) return 'prompt record is missing';
  if (isUsableSummaryPrompt(p)) return null;
  if (p.basePrompt) {
    return 'generation-format prompt (basePrompt/contextTemplate) — the summary engine needs template, or instructions + outputFormat';
  }
  if (p.instructions && !p.outputFormat) return 'has instructions but no outputFormat';
  if (p.outputFormat && !p.instructions) return 'has outputFormat but no instructions';
  return 'has neither template nor instructions + outputFormat';
}

/**
 * Infer promptType from the record's shape.
 *
 * Prefer the stored attribute when present. Records written before the
 * AIPromptManager sent `promptType` are mislabeled `generation` even though
 * they carry `template`/`instructions`, so a stored value of `generation` on a
 * record that has no `basePrompt` is treated as the mislabel it is.
 */
function inferPromptType(p) {
  if (!p) return 'analysis';
  const hasGenerationShape = Boolean(p.basePrompt);
  const hasAnalysisShape = Boolean(p.template || p.instructions);

  if (hasGenerationShape && !hasAnalysisShape) return 'generation';
  if (hasAnalysisShape && !hasGenerationShape) return 'analysis';

  // Ambiguous or empty: fall back to what was stored, then to analysis.
  if (p.promptType === 'generation' || p.promptType === 'analysis') return p.promptType;
  return 'analysis';
}


/* ------------------------------------------------------------------------- *
 * Declared output shape
 *
 * Structure used to be system-owned and unconditional, for a good reason: it
 * had been tangled up in free-text templates, so the parser's contract
 * depended on whatever someone typed into a textarea. Making it system-owned
 * is what made personas safe to add freely.
 *
 * But "system-owned" was over-corrected into "one shape forever", and the
 * whole point of attaching a prompt to a question set is to get a *different,
 * fitting output*. An art round wants the winning title, a few entries worth
 * quoting, the real title of the work and a point of trivia — which
 * Summary / Discussion Questions / Next Steps cannot express at all.
 *
 * So structure is now prompt-owned but system-VALIDATED. A prompt may declare
 * `outputSections`; the declaration is normalised here before it can reach the
 * model, and a declaration that fails validation is discarded in favour of the
 * default triad. A prompt picks its shape; it still cannot emit arbitrary text
 * into the format block, invent heading syntax, or leave a response the parser
 * cannot split.
 * ------------------------------------------------------------------------- */

const DEFAULT_OUTPUT_SECTIONS = [
  {
    heading: 'Summary',
    guidance: 'Two to four sentences on what the group actually said and what stands out.',
  },
  {
    heading: 'Discussion Questions',
    guidance:
      'Two or three numbered questions the host can ask the room next. Make them specific to these ' +
      'responses — a question that would fit any session is a wasted one.',
  },
  {
    heading: 'Next Steps',
    guidance: 'Two to four numbered, concrete actions.',
  },
];

const MAX_SECTIONS = 8;
const MAX_HEADING_CHARS = 60;
const MAX_GUIDANCE_CHARS = 600;

/**
 * Validate a prompt's declared output shape.
 *
 * Returns a clean `[{ heading, guidance }]`, or `null` when the declaration is
 * absent, malformed or unsafe — callers then use DEFAULT_OUTPUT_SECTIONS. Null
 * is returned for the WHOLE declaration rather than dropping the offending
 * section, because a half-applied shape is one nobody authored and nobody can
 * predict.
 *
 * The rules exist to keep parseAIResponse() honest:
 *  - a heading must be plain single-line text, so `## <heading>` is well-formed
 *    markdown the parser's heading regex will find;
 *  - no markdown or heading syntax inside a heading, so a prompt cannot smuggle
 *    extra sections — or a leading H1, the exact thing that broke game 7971 —
 *    into the contract;
 *  - headings must be unique, so a response splits unambiguously;
 *  - guidance lines that look like headings are stripped, same reason.
 */
function normalizeOutputSections(raw) {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_SECTIONS) return null;

  const out = [];
  const seen = new Set();

  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;

    const heading = typeof entry.heading === 'string' ? entry.heading.trim() : '';
    if (!heading || heading.length > MAX_HEADING_CHARS) return null;
    if (/[\r\n]/.test(heading)) return null;
    if (/[#*_`>|[\]{}]/.test(heading)) return null;
    if (!/[A-Za-z]/.test(heading)) return null;

    const dedupeKey = heading.toLowerCase();
    if (seen.has(dedupeKey)) return null;
    seen.add(dedupeKey);

    if (typeof entry.guidance !== 'undefined' && typeof entry.guidance !== 'string') return null;
    let guidance = typeof entry.guidance === 'string' ? entry.guidance.trim() : '';
    if (guidance.length > MAX_GUIDANCE_CHARS) return null;
    guidance = guidance
      .split('\n')
      .filter((line) => !/^\s{0,3}#{1,6}\s/.test(line))
      .join('\n')
      .trim();

    out.push({ heading, guidance });
  }

  return out.length ? out : null;
}

/** The sections a prompt will actually be held to — declared, or the default. */
function resolveOutputSections(prompt) {
  return normalizeOutputSections(prompt && prompt.outputSections) || DEFAULT_OUTPUT_SECTIONS;
}

/**
 * Does this prompt supply its own shape? The parser needs to know: with a
 * custom shape none of the canonical Summary / Discussion Questions / Next
 * Steps headings are expected, so "no Summary heading" is normal rather than a
 * parse failure.
 */
function hasCustomOutputShape(prompt) {
  return normalizeOutputSections(prompt && prompt.outputSections) !== null;
}

/**
 * One-line description of a prompt's shape, for the admin picker. The owner's
 * complaint was that they could not tell which prompt produced which output;
 * showing the headings answers that without opening the prompt.
 */
function describeOutputShape(prompt) {
  return resolveOutputSections(prompt).map((s) => s.heading).join(' · ');
}

module.exports = {
  isUsableSummaryPrompt, summaryPromptDefect, inferPromptType,
  DEFAULT_OUTPUT_SECTIONS, normalizeOutputSections, resolveOutputSections,
  hasCustomOutputShape, describeOutputShape,
};
