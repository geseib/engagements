/**
 * THE AUTHOR'S GUIDANCE FOR ONE BATCH of questions being added to a set.
 *
 * The owner: *"I can imagine having a question set on historic figures and
 * wanting to add 'be sure to include George Washington in at least 1 question',
 * or 'make these more focused on recent historic figures'."*
 *
 * It arrives as its own request field, `batchGuidance`, and is kept apart from
 * `customPrompt` on purpose: that one is the set's standing brief, and this is
 * one run's instruction. It is not stored anywhere — not on the job row, not on
 * the set — and it is never logged; the generators read its length at most.
 *
 * Where it goes in the prompt is each generator's business (both put it ahead
 * of the topic, because first is what a model follows). What it says, and how
 * much of it is accepted, is decided once, here.
 */

const BATCH_GUIDANCE_MAX = 500;

/** Trimmed, capped at 500 characters, '' when absent, blank or not text. */
function readBatchGuidance(value) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, BATCH_GUIDANCE_MAX).trim();
}

/**
 * The labelled block, for a generator to place. '' when there is no guidance,
 * so a caller can test it and leave its prompt untouched.
 *
 * "Anything already generated for this batch counts" is there because every
 * pass of a chunked run gets this block: without it, "include George Washington
 * in at least one" reads as an order to every pass, and a 40-question batch
 * comes back with one Washington question per pass.
 */
function batchGuidanceBlock(guidance) {
  const text = readBatchGuidance(guidance);
  if (!text) return '';
  return "THE AUTHOR'S GUIDANCE FOR THIS BATCH — follow it. "
    + 'Where it names something to include, include it; anything ALREADY GENERATED for this batch counts toward that. '
    + 'Where it conflicts with the topic or the additional requirements, the guidance wins; '
    + 'the category and length rules still hold.\n'
    + text;
}

module.exports = { BATCH_GUIDANCE_MAX, readBatchGuidance, batchGuidanceBlock };
