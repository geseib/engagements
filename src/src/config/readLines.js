/**
 * THE READ AS LINES THE HOST CAN BORROW (session flow v3 §4.1; owner, 15 Oct,
 * Q6: "make it easy to grab text blocks from workie ... without having to
 * right click and copy/paste"). Workie's markdown, one entry per list point or
 * paragraph, as plain words: headings, rules and table rows are left out, and
 * markdown symbols are read as words (config/comments.js plainOf).
 */
import { plainOf } from './comments';

export function readLinesOf(markdown, max = 60) {
  const out = [];
  String(markdown || '').split(/\r?\n/).forEach((raw) => {
    const line = raw.trim();
    if (!line) return;
    if (/^#{1,6}\s/.test(line)) return; // a heading names a section, it is not a line to ask about
    if (/^(?:[-*_]\s*){3,}$/.test(line)) return; // a rule
    if (/^\|/.test(line)) return; // a table row
    if (/^```/.test(line)) return;
    const text = plainOf(line).replace(/\s+/g, ' ').trim();
    if (text.length > 3 && !out.includes(text)) out.push(text);
  });
  return out.slice(0, max);
}

export default readLinesOf;
