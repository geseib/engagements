/**
 * THE SET'S NOTE TO WORKIE, BUILT FROM WHAT THE ADMIN TYPED — nothing else.
 *
 * question-background spec §2. The builders used to write boilerplate here
 * ("…Provide constructive feedback and encourage specific, detailed responses")
 * and throw away the free-text brief, so Workie was told nothing true about the set.
 * No model writes this: every word is the admin's, or the one fixed line below.
 */
export const SET_NOTE_MAX = 1000;
export const SET_NOTE_FIXED_LINE = 'Each question carries Background notes from the set\'s author. '
  + 'Draw facts from those notes and from what the room says.';

const BRIEF_PREFIX = "The author's brief: ";
const BRIEF_PREFIX_LEN = BRIEF_PREFIX.length; // 20

const clean = (v) => (typeof v === 'string' ? v.trim() : '');

const truncate = (text, maxLen) => {
  if (text.length <= maxLen) return text;
  return text.slice(0, Math.max(0, maxLen - 1)).trimEnd() + '…';
};

/**
 * `backgroundLine` (default true) appends SET_NOTE_FIXED_LINE. Pass false for a
 * set whose questions carry NO Background — Wavelength, where the players supply
 * the meaning and the generator writes none (structured-generation.js). There the
 * fixed line would be a false statement to Workie, which is exactly the invented
 * text this note exists to keep out. The limit and the no-invented-text rule hold
 * either way; the space the line would have used goes to the admin's own words.
 */
export function buildWorkieSetNote({ subject, audience, difficulty, brief } = {}, { backgroundLine = true } = {}) {
  const fixedLine = backgroundLine ? SET_NOTE_FIXED_LINE : '';

  // Build head from non-empty fields
  const parts = [];
  if (clean(subject)) parts.push(`This set is about ${clean(subject)}.`);
  if (clean(audience)) parts.push(`Audience: ${clean(audience)}.`);
  if (clean(difficulty)) parts.push(`Level: ${clean(difficulty)}.`);
  let head = parts.join(' ');

  // Clean and check brief
  const cleanBrief = clean(brief);

  // One newline between each pair of the parts that are present. The head is
  // counted as present here even when empty: an empty head is filtered out
  // below, which only ever makes the note shorter than this budget.
  const lineCount = 1 + (cleanBrief ? 1 : 0) + (fixedLine ? 1 : 0);
  const separatorCount = lineCount - 1;

  // Build briefLine only if brief is non-empty
  let briefLine = '';
  if (cleanBrief) {
    // Available space = SET_NOTE_MAX - separators - fixed line - BRIEF_PREFIX
    const availableForHeadAndText = SET_NOTE_MAX - separatorCount - fixedLine.length - BRIEF_PREFIX_LEN;

    // Allocate space fairly: head gets up to half, brief gets the rest
    const headAllocation = Math.floor(availableForHeadAndText / 2);
    const textAllocation = availableForHeadAndText - Math.min(head.length, headAllocation);

    head = truncate(head, headAllocation);
    const trimmedText = truncate(cleanBrief, textAllocation);
    briefLine = `${BRIEF_PREFIX}${trimmedText}`;
  } else {
    head = truncate(head, SET_NOTE_MAX - separatorCount - fixedLine.length);
  }

  return [head, briefLine, fixedLine].filter(Boolean).join('\n');
}
