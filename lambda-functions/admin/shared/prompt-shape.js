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

module.exports = { isUsableSummaryPrompt, summaryPromptDefect, inferPromptType };
