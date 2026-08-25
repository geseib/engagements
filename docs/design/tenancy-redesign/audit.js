/*
 * Clipping sweep for the tenancy mockups.
 *
 * Paste into the console on any page in this set, or run it from the harness.
 *
 * IT ASSERTS CLIPPING, NOT SCROLLING, and that distinction is the whole point.
 * `.tbl td` is `overflow:hidden; text-overflow:ellipsis` by design, so a cell
 * that is too narrow does not scroll and does not overflow — it silently drops
 * the end of its own text. The design rule this enforces is the hard-rules
 * one: "a reduction with no recovery is a deletion", and a truncated escalation
 * reason or invitation expiry is exactly that.
 *
 * Leaf nodes only: a container's scrollWidth is its content's, so testing
 * parents reports the same defect several times and hides which element owns it.
 */
(function () {
  var bad = [];
  document.querySelectorAll('main.work *').forEach(function (el) {
    if (el.children.length) return;                     // leaves only
    var t = (el.textContent || '').trim();
    if (!t) return;
    if (el.scrollWidth > el.clientWidth + 1) {
      bad.push({
        where: el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ').join('.') : ''),
        cut: t.slice(0, 70),
        px: el.scrollWidth - el.clientWidth
      });
    }
  });
  return { page: document.title, clipped: bad.length, detail: bad };
})();
