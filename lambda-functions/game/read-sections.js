/**
 * THE READ'S SECTIONS AND POINTS (docs/design/followup-icons, option A).
 *
 * An ask names the part of Workie's read it came from as `{ section, point }`:
 * the heading exactly as the read printed it, and the 1-based number of the
 * list item under it. The server checks that against the stored read; the host
 * page finds the same item to put the ask's icon beside it. Both must count
 * the same way, so this file is copied identically to
 * src/src/config/readSections.js (tests/read-sections.js holds them equal).
 *
 * The rules are MarkdownRenderer's: any `#` heading starts a section; a line
 * that, trimmed, starts with `- `, `* `, `+ ` or `1. ` is a point of the
 * section above it. Points are numbered per section in order, from 1.
 */
// ---- shared body: keep identical to src/src/config/readSections.js ----
const POINT = /^(?:[-*+]|\d+\.)\s+/;
const HEADING = /^#{1,6}\s+(.*)$/;

function foldHeading(s) {
  return String(s || '').replace(/[*_`]/g, '').replace(/[\s:.]+$/, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function readSections(markdown) {
  const out = [];
  let current = null;
  for (const line of String(markdown || '').split('\n')) {
    const t = line.trim();
    const h = t.match(HEADING);
    if (h) {
      current = { heading: h[1].trim(), points: [] };
      out.push(current);
    } else if (current && POINT.test(t)) {
      current.points.push(t.replace(POINT, '').trim());
    }
  }
  return out;
}

function pointAt(markdown, anchor) {
  if (!anchor || typeof anchor !== 'object') return null;
  const want = foldHeading(anchor.section);
  const n = Number(anchor.point);
  if (!want || !Number.isInteger(n) || n < 1) return null;
  const section = readSections(markdown).find((s) => foldHeading(s.heading) === want);
  if (!section || n > section.points.length) return null;
  return { section: section.heading, point: n, text: section.points[n - 1] };
}
// ---- end shared body ----

module.exports = { readSections, pointAt, foldHeading };
