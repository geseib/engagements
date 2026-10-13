/**
 * THE READ'S SECTIONS AND POINTS — the host page's copy of
 * lambda-functions/game/read-sections.js (tests/read-sections.js holds the
 * shared body equal). Where an ask's icon goes beside Workie's read.
 */
// ---- shared body: keep identical to src/src/config/readSections.js ----
const POINT = /^(?:[-*+]|\d+\.)\s+/;
const HEADING = /^#{1,6}\s+(.*)$/;

export function foldHeading(s) {
  return String(s || '').replace(/[*_`]/g, '').replace(/[\s:.]+$/, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function readSections(markdown) {
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

export function pointAt(markdown, anchor) {
  if (!anchor || typeof anchor !== 'object') return null;
  const want = foldHeading(anchor.section);
  const n = Number(anchor.point);
  if (!want || !Number.isInteger(n) || n < 1) return null;
  const section = readSections(markdown).find((s) => foldHeading(s.heading) === want);
  if (!section || n > section.points.length) return null;
  return { section: section.heading, point: n, text: section.points[n - 1] };
}
// ---- end shared body ----
