/**
 * HOSTS GET THE AI BUILDERS.
 *
 * ── WHY THEY DID NOT ───────────────────────────────────────────────────────
 *
 * The generation routes were admins-only for one reason and it was a good one:
 * Bedrock costs money, and before tenancy there was no way to say WHOSE. Every
 * generation was an unattributable charge against the platform, so the only
 * safe answer was "staff".
 *
 * That reason expired with tenancy. A generation now happens inside an
 * organisation: the caller carries an `orgId`, the org carries a plan, and the
 * metering ledger exists to attribute usage to it. The owner's call — "now that
 * we have teams with purchase and tracking capabilities coming in, it is ok to
 * let it have the full AI Builder experience in the host create question set."
 *
 * // rejects: opening the START of a job without its POLL, which spends the
 * //          money and then refuses to hand over the answer; and opening the
 * //          prompt LIBRARY, which shapes what the AI does for everybody.
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const { requiredGroupsForRoute } = require(path.join(REPO, 'lambda-functions/auth/authorizer.js'));

let pass = 0; let fail = 0;
const check = (label, fn) => {
  try { fn(); console.log(`  ok   - ${label}`); pass += 1; } catch (e) {
    console.log(`  FAIL - ${label}\n         ${e.message}`); fail += 1;
  }
};
const groups = (m, p) => requiredGroupsForRoute(m, p);
const openToHosts = (m, p) => assert.deepStrictEqual(groups(m, p), ['hosts', 'admins'],
  `${m} ${p} is ${JSON.stringify(groups(m, p))}`);
const staffOnly = (m, p) => assert.deepStrictEqual(groups(m, p), ['admins'],
  `${m} ${p} is ${JSON.stringify(groups(m, p))}`);

console.log('1. a host can start a generation AND collect it');

/*
  BOTH HALVES OR NEITHER. These are async jobs: a POST starts one and a GET
  polls it. Opening only the POST spends the money and then refuses to hand
  over the result — strictly worse than not opening it at all.
*/
for (const kind of ['trivia', 'scenarios', 'polls', 'survey', 'questions']) {
  check(`ai-generate-${kind}: start and poll`, () => {
    openToHosts('POST', `admin/ai-generate-${kind}`);
    openToHosts('GET', `admin/ai-generate-${kind}/{jobId}`);
  });
}

check('the builder-form helper ("fill in the rest"): start and poll', () => {
  openToHosts('POST', 'admin/ai-draft-builder-form');
  openToHosts('GET', 'admin/ai-draft-builder-form/{jobId}');
});

check('the set name/description draft: start and poll', () => {
  openToHosts('POST', 'admin/ai-draft-set-metadata');
  openToHosts('GET', 'admin/ai-draft-set-metadata/{jobId}');
});

// The builders offer a summary prompt to choose from and cannot without this.
check('a host may READ the prompt library', () => openToHosts('GET', 'admin/ai-prompts'));

console.log('\n2. and still cannot change what the AI does for everybody');

/*
  The prompt library shapes every generation in the product, for every
  organisation. Reading it is picking from a menu; writing it is editing the
  menu.
*/
for (const [m, p] of [
  ['POST', 'admin/ai-prompts/save'],
  ['PUT', 'admin/ai-prompts/{promptId}'],
  ['DELETE', 'admin/ai-prompts/{promptId}'],
  ['POST', 'admin/ai-prompt-advisor'],
  ['POST', 'admin/ai-generate-prompt'],
]) {
  check(`${m} ${p} stays Engage's`, () => staffOnly(m, p));
}

console.log('\n3. the concrete jobId form the rawPath fallback produces');

// `requiredGroupsForRoute` normally receives the route TEMPLATE, and falls back
// to `event.rawPath` — which carries a real job id.
check('a real job id polls the same as the template', () =>
  openToHosts('GET', 'admin/ai-generate-trivia/mt5t6yreeiwar2rt'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
