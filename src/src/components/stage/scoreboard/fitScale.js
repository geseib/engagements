/**
 * ONE SCALE FOR EVERY PAGE, found on the tallest.
 *
 * The olympic and tote boards scale their type with one `--fit` per page size,
 * held across pages so the type does not jump when the page turns. Their row
 * lists clip what does not fit, so the scale has to be the one the TALLEST
 * page needs: fitted to page 1 alone, a later page carrying a long name that
 * wraps lost its last row. (The departure board already sizes its grid from
 * every page — departureEngine.js `fit`.)
 *
 * Overflow only grows with the scale, so one pass does it: paint each page in
 * turn and shrink until it fits; the pages before it fit all the better.
 *
 * @param {Array} pages                    the rows of each page
 * @param {{ paint: (page) => void,        draw one page
 *           overflows: () => boolean,     does what is drawn overflow?
 *           setFit: (f: number) => void,  apply a scale
 *           min?: number, step?: number }} opts
 * @returns {number} the scale every page fits at (or the floor)
 */
export function fitScale(pages, {
  paint, overflows, setFit, min = 0.5, step = 0.02,
}) {
  let f = 1;
  setFit(f);
  for (const page of pages) {
    paint(page);
    while (f > min + 1e-9 && overflows()) {
      f = Math.max(min, Math.round((f - step) * 100) / 100);
      setFit(f);
    }
  }
  return f;
}

/** The field cut into pages of `size`. */
export function pagesOf(rows, size) {
  const out = [];
  const n = Math.max(1, size || 10);
  for (let i = 0; i < (rows || []).length; i += n) out.push(rows.slice(i, i + n));
  return out.length ? out : [[]];
}
