/**
 * THE FOLLOW-UP ASKS SWITCH AND ITS WIRING (template-clean.yaml, the three
 * buildspecs, auth/authorizer.js), read as text.
 *
 *   - `FollowUpAsks` is a parameter, 'on' | 'off', default 'off';
 *   - dev's buildspec passes FollowUpAsks=on; test and prod never mention it;
 *   - exactly three functions read it as FOLLOWUP_ASKS_ENABLED: get-ai-summary
 *     (the suggestions), comments (the routes) and next-question (the close);
 *   - the routes are four events on the comments function — no new Lambda —
 *     the host family behind Cognito, the phones' family public; and the
 *     authorizer names the host family for hosts|admins;
 *   - next-question, which now seals a count, holds kms:Decrypt.
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const template = fs.readFileSync(path.join(REPO, 'template-clean.yaml'), 'utf8');
const spec = (tier) => fs.readFileSync(path.join(REPO, `buildspec-${tier}.yml`), 'utf8');
const { routesFromTemplate, findRoute } = require('./helpers/template-routes');

let pass = 0, fail = 0;
function check(label, fn) {
  try { fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

/** One resource's block: from its `  Name:` line to the next top-level resource. */
function block(name) {
  const start = template.indexOf(`\n  ${name}:\n`);
  assert.ok(start > -1, `no ${name} in the template`);
  const rest = template.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[A-Za-z][A-Za-z0-9]*:\n/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

console.log('\n1. the parameter and the tiers');
check("FollowUpAsks: 'on' | 'off', default 'off'", () => {
  const b = template.match(/\n {2}FollowUpAsks:\n((?: {4}.*\n)+)/);
  assert.ok(b, 'no FollowUpAsks parameter');
  assert.match(b[1], /AllowedValues: \['on', 'off'\]/);
  assert.match(b[1], /Default: 'off'/);
});
check('dev passes FollowUpAsks=on, before the deploy line', () => {
  const s = spec('dev');
  assert.match(s, /PARAM_OVERRIDES="\$PARAM_OVERRIDES FollowUpAsks=on"/);
  assert.ok(s.indexOf('FollowUpAsks=on') < s.indexOf('Deploying to AWS...'));
});
check('test and prod never mention it, and so take off', () => {
  for (const tier of ['test', 'prod']) assert.ok(!/FollowUpAsks|FOLLOWUP_ASKS/.test(spec(tier)), tier);
});

console.log('\n2. who reads it');
check('exactly three functions, each by !Ref FollowUpAsks', () => {
  assert.strictEqual(template.split('FOLLOWUP_ASKS_ENABLED: !Ref FollowUpAsks').length - 1, 3);
  for (const fn of ['GetAISummaryFunction', 'CommentsFunction', 'NextQuestionFunction']) {
    assert.ok(block(fn).includes('FOLLOWUP_ASKS_ENABLED: !Ref FollowUpAsks'), fn);
  }
  assert.ok(!/FOLLOWUP_ASKS_ENABLED: ['"]?on/.test(template), 'hard-coded on somewhere');
});
check('the code reads exactly that name, and only "on" is on', () => {
  const store = fs.readFileSync(path.join(REPO, 'lambda-functions/game/followup-store.js'), 'utf8');
  assert.match(store, /env\.FOLLOWUP_ASKS_ENABLED/);
  assert.match(store, /=== 'on'/);
});

console.log('\n3. the routes');
const routes = routesFromTemplate();
check('the host family: GET and POST, Cognito', () => {
  for (const m of ['GET', 'POST']) {
    const r = findRoute(routes, m, '/games/{gameId}/followups/{proxy+}');
    assert.ok(r, m);
    assert.strictEqual(r.authorizer, 'CognitoAuthorizer', m);
  }
});
check('the phones\' family: GET and POST, public', () => {
  for (const m of ['GET', 'POST']) {
    const r = findRoute(routes, m, '/games/{gameId}/followup-play/{proxy+}');
    assert.ok(r, m);
    assert.strictEqual(r.authorizer, null, m);
  }
});
check('all four are events of the comments function — no new Lambda', () => {
  const b = block('CommentsFunction');
  for (const e of ['FollowUpsHostGetEvent', 'FollowUpsHostPostEvent', 'FollowUpsPlayGetEvent', 'FollowUpsPlayPostEvent']) assert.ok(b.includes(`${e}:`), e);
  assert.ok(!/Handler: followups\.handler/.test(template));
  assert.ok(!/Handler: followup-/.test(template));
});
check('the authorizer names the host family for hosts|admins, template and concrete path', () => {
  const { requiredGroupsForRoute } = require(path.join(REPO, 'lambda-functions/auth/authorizer.js'));
  for (const m of ['GET', 'POST']) {
    assert.deepStrictEqual(requiredGroupsForRoute(m, 'games/{gameId}/followups/{proxy+}'), ['hosts', 'admins']);
    assert.deepStrictEqual(requiredGroupsForRoute(m, 'games/4821/followups/round/003'), ['hosts', 'admins']);
  }
});

console.log('\n4. grants');
check('next-question holds kms:Decrypt on the tenant key (it seals a closed count)', () => {
  const b = block('NextQuestionFunction');
  assert.match(b, /Action: \[ kms:Decrypt \]\n\s+Resource: !GetAtt TenantKey\.Arn/);
});
check('get-ai-summary already holds Sonnet 4.6 and the Anthropic sign-in for the asks call', () => {
  const b = block('GetAISummaryFunction');
  assert.ok(b.includes('inference-profile/us.anthropic.claude-sonnet-4-6'));
  assert.ok(b.includes('sts:GetWebIdentityToken'));
  assert.match(b, /Timeout: 300/);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
