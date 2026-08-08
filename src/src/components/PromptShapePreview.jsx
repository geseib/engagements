import React from 'react';

/*
 * The headings a prompt will actually produce.
 *
 * Mirrors lambda-functions/game/prompt-shape.js: a prompt that declares
 * `outputSections` gets that shape, and everything else gets the default triad.
 * Picking a prompt is how you choose the SHAPE of Workie's output, not just its
 * wording — an art round wants the winning title and the real title, not "Next
 * Steps" for a painting — and until this was shown there was no way to tell from
 * the picker which prompt produced which output.
 *
 * Lifted out of AdminPage unchanged so the upload form and the extracted set
 * editor can both use it.
 */
export const DEFAULT_OUTPUT_HEADINGS = ['Summary', 'Discussion Questions', 'Next Steps'];

export function promptOutputHeadings(prompt) {
  const declared = prompt && prompt.outputSections;
  if (!Array.isArray(declared) || declared.length === 0) return DEFAULT_OUTPUT_HEADINGS;
  const headings = declared
    .map((s) => (s && typeof s.heading === 'string' ? s.heading.trim() : ''))
    .filter(Boolean);
  return headings.length ? headings : DEFAULT_OUTPUT_HEADINGS;
}

/** Renders the shape of whichever prompt is currently selected, or of the default. */
export default function PromptShapePreview({ promptId, prompts = [] }) {
  const prompt = prompts.find((p) => p.promptId === promptId);
  const headings = promptOutputHeadings(prompt);
  const isCustom = !!(prompt && Array.isArray(prompt.outputSections) && prompt.outputSections.length);
  return (
    <small className="help-text prompt-shape-preview">
      <strong>Output shape:</strong> {headings.map((h) => `## ${h}`).join('  ')}
      {promptId
        ? (isCustom ? ' — declared by this prompt' : ' — this prompt uses the standard shape')
        : ' — the standard shape'}
    </small>
  );
}
