/*
 * A dev or test tab wears a "D" or "T" on the mountain, so the owner can tell
 * the tiers apart in a row of tabs. Prod keeps the plain mountain.
 *
 * Every tier serves the same build, so the tier is read at run time from
 * window.ENV, which each tier's config.js sets (written by its buildspec as
 * "development", "test" or "production"). Any other value, or none, changes
 * nothing: the plain mountain is the safe default.
 *
 * Loaded straight after /config.js in index.html. Pinned by
 * src/src/__tests__/tierFavicon.test.js.
 */
(function () {
  var badge = { development: 'dev', test: 'test' }[window.ENV];
  if (!badge) return;
  var links = document.querySelectorAll('link[rel="icon"]');
  for (var i = 0; i < links.length; i += 1) {
    links[i].href = links[i].type === 'image/svg+xml'
      ? '/favicon-' + badge + '.svg'
      : '/favicon-' + badge + '-32.png';
  }
}());
