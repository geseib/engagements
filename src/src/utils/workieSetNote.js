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

export function buildWorkieSetNote({ subject, audience, difficulty, brief } = {}) {
  // Build head from non-empty fields
  const parts = [];
  if (clean(subject)) parts.push(`This set is about ${clean(subject)}.`);
  if (clean(audience)) parts.push(`Audience: ${clean(audience)}.`);
  if (clean(difficulty)) parts.push(`Level: ${clean(difficulty)}.`);
  let head = parts.join(' ');

  // Clean and check brief
  const cleanBrief = clean(brief);

  // Build briefLine only if brief is non-empty
  let briefLine = '';
  if (cleanBrief) {
    // Brief exists: allocate space for head + '\n' + briefLine + '\n' + FIXED_LINE
    // Available space = SET_NOTE_MAX - separators - FIXED_LINE - BRIEF_PREFIX
    const fixedLineLen = SET_NOTE_FIXED_LINE.length;
    const separatorCount = 2; // two newlines between three parts
    const availableForHeadAndText = SET_NOTE_MAX - separatorCount - fixedLineLen - BRIEF_PREFIX_LEN;

    // Allocate space fairly: head gets up to half, brief gets the rest
    const headAllocation = Math.floor(availableForHeadAndText / 2);
    const textAllocation = availableForHeadAndText - Math.min(head.length, headAllocation);

    head = truncate(head, headAllocation);
    const trimmedText = truncate(cleanBrief, textAllocation);
    briefLine = `${BRIEF_PREFIX}${trimmedText}`;
  } else {
    // No brief: allocate space for head + '\n' + FIXED_LINE
    const fixedLineLen = SET_NOTE_FIXED_LINE.length;
    const separatorCount = 1; // one newline between two parts
    const maxHeadLen = SET_NOTE_MAX - separatorCount - fixedLineLen;
    head = truncate(head, maxHeadLen);
  }

  return [head, briefLine, SET_NOTE_FIXED_LINE].filter(Boolean).join('\n');
}
