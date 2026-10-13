/**
 * THE SITE SKIN'S CONTRACTS, READ AS TEXT (docs/design/themes/SPEC.md §5, §7).
 *
 *   1. The allowlist: lambda-functions/admin/shared/site-skin.js and its
 *      guarded copy lambda-functions/websocket/site-skin.js are byte-identical,
 *      and their SKINS equal the ids in src/src/config/skins.js, in order. Every
 *      id has its values file, src/src/styles/skins/<id>.css; Classic is first
 *      and the default everywhere.
 *   2. The staff routes: GET and POST /platform/settings/{name} on the platform
 *      function, each with CognitoAuthorizer; authorizer.js names the template
 *      and a concrete name ['admins']; the two old claude-models events are gone.
 *   3. The public read: GET /site on ResolveJoinCodeFunction with NO authorizer,
 *      and the authorizer is never consulted for it; the function stays read
 *      only (no write policy) and answers { skin, updatedAt } only.
 *   4. The budget: the skin's whole cost is one HttpApi event (one Lambda
 *      Permission) on an existing function, and the settings stay one pair.
 *      Held structurally; the delta against the start commit is printed.
 *
 * rejects: a third skin added in one list only; a values file missing; the
 * {name} routes opened; /site closed or given a write; a new function.
 */
const suiteFinished = require('./helpers/finish-guard');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');
const { routesFromTemplate, findRoute, assertScannerWorks, TEMPLATE } = require('./helpers/template-routes');

const REPO = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');
const BASE = 'c5f914da'; // the skins Phase 0d start (docs/design/themes/records/0d.md)

let pass = 0; let fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass += 1; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail += 1; }
}
const say = (s) => console.log(s);

/** The `  Name:\n    Type: …` block of one top-level resource. */
function resourceBlock(text, name) {
  const at = text.indexOf(`\n  ${name}:\n`);
  assert.ok(at >= 0, `${name} is not in the template`);
  const rest = text.slice(at + 1);
  const end = rest.slice(1).search(/\n {2}[A-Za-z0-9]+:\n/);
  return end < 0 ? rest : rest.slice(0, end + 1);
}
const counts = (text) => ({
  functions: (text.match(/^\s+Type: AWS::Serverless::Function\s*$/gm) || []).length,
  httpEvents: (text.match(/^\s+Type: HttpApi\s*$/gm) || []).length,
  resources: (() => {
    const s = text.indexOf('\nResources:\n'); const e = text.indexOf('\nOutputs:\n');
    return (text.slice(s, e > s ? e : undefined).match(/^ {2}[A-Za-z0-9]+:/gm) || []).length;
  })(),
});

(async () => {
  say('\n1. the allowlist, in three places');
  const ADMIN = 'lambda-functions/admin/shared/site-skin.js';
  const WS = 'lambda-functions/websocket/site-skin.js';
  await check('the backend copies are byte-identical', () => {
    assert.strictEqual(read(WS), read(ADMIN), `${WS} differs from ${ADMIN}: copy it verbatim`);
  });
  const backend = require(path.join(REPO, ADMIN));
  const frontendIds = [...read('src/src/config/skins.js').matchAll(/\bid:\s*'([a-z][a-z0-9-]{1,23})'/g)].map((m) => m[1]);
  await check('the backend SKINS equal config/skins.js ids, in order', () => {
    assert.ok(frontendIds.length >= 2, `found ${frontendIds.length} ids in config/skins.js: the scanner rotted`);
    assert.deepStrictEqual([...backend.SKINS], frontendIds);
  });
  await check('Classic is first and the default on both sides', () => {
    assert.strictEqual(backend.SKINS[0], 'classic');
    assert.strictEqual(backend.DEFAULT_SKIN, 'classic');
    assert.match(read('src/src/config/skins.js'), /export const DEFAULT_SKIN = 'classic';/);
  });
  await check('every registry id has its values file', () => {
    for (const id of frontendIds) {
      assert.ok(fs.existsSync(path.join(REPO, 'src/src/styles/skins', `${id}.css`)), `no styles/skins/${id}.css`);
    }
  });
  await check('an unknown or missing skin reads as Classic; the public view has two fields', () => {
    assert.strictEqual(backend.skinFromItem(null), 'classic');
    assert.strictEqual(backend.skinFromItem({ Skin: 'neon' }), 'classic');
    assert.strictEqual(backend.skinFromItem({ Skin: 'present' }), 'present');
    assert.deepStrictEqual(Object.keys(backend.publicView({ Skin: 'present', UpdatedAt: 'x', UpdatedBy: 'u', RecordType: 'r' })).sort(), ['skin', 'updatedAt']);
  });

  say('\n2. the staff routes');
  const routes = routesFromTemplate(TEMPLATE);
  assertScannerWorks(routes);
  const template = fs.readFileSync(TEMPLATE, 'utf8');
  const platformFn = resourceBlock(template, 'PlatformOrgsFunction');
  await check('GET and POST /platform/settings/{name} carry CognitoAuthorizer', () => {
    for (const m of ['GET', 'POST']) {
      const r = findRoute(routes, m, '/platform/settings/{name}');
      assert.ok(r, `${m} /platform/settings/{name} is not in the template`);
      assert.strictEqual(r.authorizer, 'CognitoAuthorizer', `${m} /platform/settings/{name} lost its authorizer`);
    }
    assert.ok(platformFn.includes('Path: /platform/settings/{name}'), 'the {name} route is not on PlatformOrgsFunction');
  });
  await check('the claude-models pair is replaced, not kept beside {name}', () => {
    assert.ok(!routes.some((r) => r.path === '/platform/settings/claude-models'));
    assert.ok(!/ClaudeModelsSetting:/.test(template));
  });
  await check('authorizer.js names the route template and a concrete name [admins]', () => {
    const authorizer = require(path.join(REPO, 'lambda-functions/auth/authorizer.js'));
    for (const m of ['GET', 'POST']) {
      for (const p of ['platform/settings/{name}', 'platform/settings/site-skin', 'platform/settings/claude-models']) {
        assert.deepStrictEqual(authorizer.requiredGroupsForRoute(m, p), ['admins'], `${m} ${p}`);
      }
    }
  });

  say('\n3. the public read');
  const resolveFn = resourceBlock(template, 'ResolveJoinCodeFunction');
  await check('GET /site is on ResolveJoinCodeFunction, with no authorizer', () => {
    const r = findRoute(routes, 'GET', '/site');
    assert.ok(r, 'GET /site is not in the template');
    assert.strictEqual(r.authorizer, null, 'GET /site gained an authorizer: signed-out visitors could not read the skin');
    assert.ok(/Path: \/site\n\s+Method: get/.test(resolveFn), 'GET /site is not on ResolveJoinCodeFunction');
    assert.ok(!/Path: \/site[\s\S]*?Auth:/.test(resolveFn.slice(resolveFn.indexOf('Path: /site'), resolveFn.indexOf('Policies:'))));
  });
  await check('the public function stays read-only', () => {
    assert.ok(/DynamoDBReadPolicy/.test(resolveFn));
    assert.ok(!/DynamoDBCrudPolicy|DynamoDBWritePolicy|dynamodb:PutItem|dynamodb:UpdateItem|dynamodb:DeleteItem/.test(resolveFn));
  });
  await check('resolve-code.js answers /site from the shared module, before the code parse', () => {
    const src = read('lambda-functions/websocket/events/resolve-code.js');
    assert.ok(src.includes("require('../site-skin')"));
    assert.ok(src.indexOf('if (isSiteRequest(request)) return siteSkin();') < src.indexOf('S.isCode(code)'));
    assert.ok(src.includes('SKIN.publicView('));
  });

  say('\n4. the budget');
  // Held STRUCTURALLY, so later work that adds its own routes does not break it:
  // the skin's whole cost is one event on an existing function, and the
  // settings pair stays a pair. The measured delta against the start commit is
  // printed for the record (docs/design/themes/records/0d.md), not asserted.
  await check('the skin costs one event on an existing function: ResolveJoinCode has two, the settings stay a pair', () => {
    assert.strictEqual((resolveFn.match(/^\s+Type: HttpApi\s*$/gm) || []).length, 2, 'ResolveJoinCodeFunction: /join/{code} and /site only');
    assert.strictEqual((platformFn.match(/Path: \/platform\/settings\//g) || []).length, 2, 'the settings routes are one GET and one POST');
    let before = null;
    try { before = execFileSync('git', ['show', `${BASE}:template-clean.yaml`], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] }); } catch { before = null; }
    if (before !== null) {
      const now = counts(template); const was = counts(before);
      console.log(`        vs ${BASE}: functions ${was.functions} -> ${now.functions}, HttpApi events ${was.httpEvents} -> ${now.httpEvents}, top-level resources ${was.resources} -> ${now.resources}`);
    }
  });

  say(`\n${pass} passed, ${fail} failed`);
  suiteFinished();
  process.exit(fail ? 1 : 0);
})();
