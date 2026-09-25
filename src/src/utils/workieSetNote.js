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

const clean = (v) => (typeof v === 'string' ? v.trim() : '');

export function buildWorkieSetNote({ subject, audience, difficulty, brief } = {}) {
  const parts = [];
  if (clean(subject)) parts.push(`This set is about ${clean(subject)}.`);
  if (clean(audience)) parts.push(`Audience: ${clean(audience)}.`);
  if (clean(difficulty)) parts.push(`Level: ${clean(difficulty)}.`);
  const head = parts.join(' ');
  const room = SET_NOTE_MAX - SET_NOTE_FIXED_LINE.length - head.length - 22;
  let text = clean(brief);
  if (text.length > room) text = `${text.slice(0, Math.max(0, room - 1)).trimEnd()}…`;
  const briefLine = text ? `The author's brief: ${text}` : '';
  return [head, briefLine, SET_NOTE_FIXED_LINE].filter(Boolean).join('\n');
}
