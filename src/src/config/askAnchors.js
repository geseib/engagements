/**
 * WHERE EACH ASK SITS BESIDE WORKIE'S READ (docs/design/followup-icons, B2).
 *
 * The server checked every suggestion's anchor against the stored read
 * (followup-grounding.js); here the host page finds the same point so the
 * ask's icon can sit at the end of it. The read is paged on the laptop, so a
 * page may not hold its own heading: the point is matched by its TEXT, which
 * readSections() gives exactly as MarkdownRenderer draws it.
 */
import { pointAt } from './readSections';

/** A list item's text as the renderer receives it (the line, marker gone). */
export const pointKey = (text) => String(text || '').replace(/\s+/g, ' ').trim();

/**
 * @param {string}   markdown     the stored read
 * @param {object[]} suggestions  the round's checked suggestions (`asks`)
 * @returns {{ byPoint: Map<string, object[]>, after: object[] }}
 *   each entry: { index, ask, section, point } — `index` is the suggestion's
 *   position, which the send names so the server can tell suggested from edited.
 */
export function placeAsks(markdown, suggestions) {
  const byPoint = new Map();
  const after = [];
  (Array.isArray(suggestions) ? suggestions : []).forEach((ask, index) => {
    const at = ask && ask.anchor ? pointAt(markdown, ask.anchor) : null;
    if (!at) { after.push({ index, ask, section: null, point: null }); return; }
    const key = pointKey(at.text);
    const list = byPoint.get(key) || [];
    list.push({ index, ask, section: at.section, point: at.point });
    byPoint.set(key, list);
  });
  return { byPoint, after };
}

/** How many asks the host could send now. */
export const readyCount = (suggestions) => (Array.isArray(suggestions) ? suggestions.length : 0);
