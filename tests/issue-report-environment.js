/**
 * AN ISSUE REPORT NAMES THE TIER IT CAME FROM (#43).
 *
 * create-github-issue.js labelled Production only for `eng.seibtribe.us`, the
 * retired twin's hostname, so real prod reports (engage.seibtribe.us) arrived
 * as environment "unknown" with no label. It now takes the tier from its own
 * stack (`ENVIRONMENT`, the template's `Environment` parameter).
 *
 * rejects: a hard-coded production hostname; prod reports reading "unknown";
 * the template forgetting to pass ENVIRONMENT; a page on localhost being
 * called by the API's tier.
 */
const suiteFinished = require('./helpers/finish-guard');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const SRC = 'lambda-functions/admin/create-github-issue.js';
const { reportEnvironment } = require(path.join(REPO, SRC));

let pass = 0, fail = 0;
function check(label, fn) {
  try { fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

console.log('\n1. per tier, from the stack');
const cases = [
  ['prod', 'engage.seibtribe.us', 'https://engage.seibtribe.us/?gameId=5479', 'Production', 'prod-environment'],
  ['test', 'engage.test.seibtribe.us', 'https://engage.test.seibtribe.us/admin', 'Test', 'test-environment'],
  ['dev', 'engage.dev.seibtribe.us', 'https://engage.dev.seibtribe.us/play', 'Development', 'dev-environment'],
];
for (const [tier, domain, url, env, label] of cases) {
  const r = reportEnvironment(url, { tier, domainName: domain });
  check(`${tier}: ${env}, labelled ${label}, site ${domain}`, () => {
    assert.strictEqual(r.environment, env);
    assert.strictEqual(r.environmentLabel, label);
    assert.strictEqual(r.siteName, domain);
  });
}
check('prod via the secondary domain is still Production', () =>
  assert.strictEqual(reportEnvironment('https://www.example.org/', { tier: 'prod' }).environment, 'Production'));
check('no URL sent: the site is the tier\'s own domain', () =>
  assert.strictEqual(reportEnvironment('', { tier: 'prod', domainName: 'engage.seibtribe.us' }).siteName, 'engage.seibtribe.us'));
check('a page on localhost is Local Development whatever API it hit', () =>
  assert.strictEqual(reportEnvironment('http://localhost:3000/', { tier: 'dev' }).environment, 'Local Development'));

console.log('\n2. without ENVIRONMENT (an older stack)');
check('.dev. still reads Development', () =>
  assert.strictEqual(reportEnvironment('https://engage.dev.seibtribe.us/', {}).environment, 'Development'));
check('anything else is "unknown", never guessed as Production', () => {
  const r = reportEnvironment('https://engage.seibtribe.us/', {});
  assert.strictEqual(r.environment, 'unknown'); assert.strictEqual(r.environmentLabel, null);
});

console.log('\n3. no hard-coded hostname; the template passes the tier');
const src = fs.readFileSync(path.join(REPO, SRC), 'utf8').replace(/^\s*(\*|\/\/).*$/gm, '');
check('no seibtribe.us hostname in the code', () => assert.ok(!/seibtribe\.us/.test(src)));
check('reads process.env.ENVIRONMENT', () => assert.match(src, /process\.env\.ENVIRONMENT/));
const template = fs.readFileSync(path.join(REPO, 'template-clean.yaml'), 'utf8');
const fn = template.slice(template.indexOf('AdminCreateGitHubIssueFunction:'), template.indexOf('AdminParseDocumentFunction:'));
check('the function is given ENVIRONMENT: !Ref Environment', () => assert.match(fn, /ENVIRONMENT:\s*!Ref Environment/));

console.log(`\n${pass} passed, ${fail} failed`);
suiteFinished();
process.exit(fail ? 1 : 0);
