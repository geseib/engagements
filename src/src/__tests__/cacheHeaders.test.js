/**
 * A DEPLOY MUST REACH A BROWSER THAT LOADED THE SITE BEFORE IT.
 *
 * On 2026-10-07 dev served an unversioned /bundle.js with an ETag and no
 * Cache-Control. A browser that had loaded the page earlier kept running the
 * old bundle after a deploy: `fetch('/bundle.js')` and
 * `fetch('/bundle.js', {cache: 'no-store'})` returned different lengths until
 * the cache was forced. CloudFront's default behaviour is CachingDisabled and
 * every deploy invalidates `/*`, so the stale copy was the browser's own.
 *
 * The fix has two halves, and either one alone is not enough:
 *   1. webpack names every script under static/js/ by its content hash, so a
 *      new build is a new URL (webpack.config.js);
 *   2. each buildspec uploads static/ as immutable and everything else
 *      (index.html above all) as no-cache, so the browser revalidates the page
 *      that names the bundle.
 *
 * This file reads the config and the buildspecs as text. It proves the
 * mechanism is still written down, not that a tier was deployed with it:
 * `curl -sI https://engage.dev.seibtribe.us/` shows that.
 */
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..', '..');
const read = (...p) => fs.readFileSync(path.join(REPO, ...p), 'utf8');

const BUILDSPECS = {
  dev: read('buildspec-dev.yml'),
  test: read('buildspec-test.yml'),
  prod: read('buildspec-prod.yml'),
};

/** Every `aws s3 …` command line in a buildspec, comments stripped. */
function s3Lines(spec) {
  return spec
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => !line.startsWith('#'))
    .filter((line) => /aws\s+s3\s+(cp|sync)\b/.test(line));
}

describe('production scripts are named by their content', () => {
  const makeConfig = require('../../webpack.config.js');
  const prod = makeConfig({}, { mode: 'production' }).output;

  test('the entry and every lazy chunk carry a content hash under static/js/', () => {
    expect(prod.filename).toMatch(/^static\/js\/.*\[contenthash(:\d+)?\].*\.js$/);
    expect(prod.chunkFilename).toMatch(/^static\/js\/.*\[contenthash(:\d+)?\].*\.js$/);
  });
});

describe.each(Object.keys(BUILDSPECS))('%s uploads with cache headers', (tier) => {
  const lines = s3Lines(BUILDSPECS[tier]);
  const staticUpload = lines.findIndex((l) => /dist\/static\//.test(l));
  const pageUpload = lines.findIndex((l) => /\bcp dist\/ /.test(l));

  test('static/ is immutable', () => {
    expect(staticUpload).toBeGreaterThanOrEqual(0);
    expect(lines[staticUpload]).toMatch(/--cache-control "public, max-age=31536000, immutable"/);
  });

  test('everything outside static/ (index.html, config.js, tier-favicon.js) is no-cache', () => {
    expect(pageUpload).toBeGreaterThanOrEqual(0);
    expect(lines[pageUpload]).toMatch(/--recursive/);
    expect(lines[pageUpload]).toMatch(/--exclude "static\/\*"/);
    expect(lines[pageUpload]).toMatch(/--cache-control "no-cache"/);
  });

  test('static/ goes up before the index.html that names it', () => {
    expect(staticUpload).toBeLessThan(pageUpload);
  });

  test('no upload line leaves its objects without a Cache-Control', () => {
    for (const line of lines.filter((l) => !l.includes('--delete'))) {
      expect(line).toMatch(/--cache-control/);
    }
  });

  test('the --delete pass never prunes static/, so open tabs keep their chunks', () => {
    const deleting = lines.filter((l) => l.includes('--delete'));
    expect(deleting.length).toBe(1);
    expect(deleting[0]).toMatch(/--exclude "static\/\*"/);
  });
});
