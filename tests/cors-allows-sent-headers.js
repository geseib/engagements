/**
 * EVERY HEADER THE CLIENT SENDS IS A HEADER CORS ALLOWS.
 *
 * ── THE OUTAGE THIS EXISTS FOR ─────────────────────────────────────────────
 *
 * Tenancy added one header. `authFetch` attaches `X-Engage-Org` to every
 * authenticated request so the authorizer knows which organisation the caller
 * is acting as. The HTTP API's `AllowHeaders` was left at
 * `["Content-Type", "Authorization"]`.
 *
 * The consequence is total and it is invisible to every check that is not a
 * browser:
 *
 *   - A custom header makes the request non-simple, so the browser sends a
 *     CORS PREFLIGHT first.
 *   - API Gateway answers that preflight `204` — a success status — but with NO
 *     `access-control-allow-*` headers at all, because the requested header is
 *     not on the allow-list.
 *   - The browser then blocks the real request and reports it to the page as a
 *     NETWORK ERROR. Not 403, not CORS-shaped: a network error.
 *
 * So the API is healthy, the logs are empty (the request never arrives), every
 * curl-based smoke check passes, and the product is broken in the browser for
 * every signed-in caller — but only AFTER an organisation has been stored,
 * because until then `authFetch` sends no org header. That intermittency is
 * what made it read as "the admin menu is broken" rather than "nothing works".
 *
 * Reported from dev as "i cant get AI to assist with the AI Builder 'fill in
 * the rest' i get a network error", which was the first call that happened to
 * be made after the org had been stored.
 *
 * ── WHY IT IS A SOURCE SCAN ────────────────────────────────────────────────
 *
 * The two facts live in different languages in different files — a JS string in
 * `src/src/auth/authFetch.js` and a YAML list in `template-clean.yaml` — and
 * nothing connects them. This reads both and requires that they agree.
 *
 * // rejects: adding a header to a request without adding it to AllowHeaders,
 * //          in either order.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const template = fs.readFileSync(path.join(REPO, 'template-clean.yaml'), 'utf8');

let pass = 0; let fail = 0;
const check = (label, fn) => {
  try { fn(); console.log(`  ok - ${label}`); pass += 1; } catch (e) {
    console.log(`  FAIL - ${label}\n         ${e.message}`); fail += 1;
  }
};

/**
 * The HTTP API's AllowHeaders list, lower-cased.
 *
 * Matched on its own line rather than by walking down from `CorsConfiguration:`
 * — the first cut used a bounded `[\s\S]{0,400}?` window from that key and
 * broke the moment a comment was added above the list, reporting "no
 * AllowHeaders found" for a file that plainly has one. `AllowHeaders` appears
 * exactly once; the S3 bucket's spelling is `AllowedHeaders`, which this does
 * not match.
 */
function allowedHeaders() {
  const m = /^\s*AllowHeaders:\s*\[([^\]]*)\]/m.exec(template);
  assert.ok(m, 'no AllowHeaders found on the HttpApi CorsConfiguration');
  return m[1]
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, '').toLowerCase())
    .filter(Boolean);
}

/**
 * Every header name the browser client attaches.
 *
 * Read out of authFetch.js rather than listed here, so a THIRD header added
 * later is caught by this test rather than needing it updated. `Authorization`
 * is assigned as a property (`headers.Authorization`) rather than through the
 * constant, so both spellings are collected.
 */
function headersTheClientSends() {
  const src = fs.readFileSync(path.join(REPO, 'src/src/auth/authFetch.js'), 'utf8');
  const names = new Set(['content-type']); // every JSON POST in the app sets it
  for (const m of src.matchAll(/ORG_HEADER\s*=\s*['"]([^'"]+)['"]/g)) {
    names.add(m[1].toLowerCase());
  }
  for (const m of src.matchAll(/headers\.([A-Za-z-]+)\s*=/g)) {
    names.add(m[1].toLowerCase());
  }
  return [...names];
}

console.log('1. the client and the API agree on what may be sent');
{
  const allowed = allowedHeaders();
  const sent = headersTheClientSends();

  check('authFetch is actually being read (the scan can find something)', () => {
    assert.ok(sent.includes('x-engage-org'),
      `the org header was not found in authFetch.js; the scan is looking at the wrong thing (found: ${sent.join(', ')})`);
    assert.ok(sent.includes('authorization'), 'the bearer header was not found either');
  });

  for (const header of headersTheClientSends()) {
    check(`AllowHeaders permits ${header}`, () => {
      assert.ok(allowed.includes(header),
        `the client sends "${header}" and the API's CorsConfiguration does not allow it. `
        + `A browser will preflight, get a 204 with no CORS headers, and report a NETWORK ERROR `
        + `to the page. AllowHeaders is currently: ${allowed.join(', ')}`);
    });
  }
}

console.log('\n2. the per-handler headers say the same thing');
{
  /*
    Handlers that build their own CORS headers must agree with the API's, or a
    preflight passes and the real response is then rejected. Only the handlers
    that name Authorization are checked: one that allows Content-Type alone is
    a public route and has no org header to carry.
  */
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        walk(full);
      } else if (entry.name.endsWith('.js')) files.push(full);
    }
  };
  walk(path.join(REPO, 'lambda-functions'));

  const offenders = [];
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/['"]Access-Control-Allow-Headers['"]\s*:\s*['"]([^'"]*)['"]/g)) {
      const value = m[1].toLowerCase();
      if (value.includes('authorization') && !value.includes('x-engage-org')) {
        offenders.push(`${path.relative(REPO, file)}: ${m[1]}`);
      }
    }
  }
  check('no handler allows Authorization but not the org header', () => {
    assert.deepStrictEqual(offenders, [], `these would reject a request the API let through:\n         ${offenders.join('\n         ')}`);
  });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
