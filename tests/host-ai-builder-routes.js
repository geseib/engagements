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

console.log('\n4. and now MAY create one, but nothing wider');

// rejects: opening the whole prompt library to hosts by prefix rather than by
// exact pair — PUT and DELETE must stay Engage's until copy-on-write lands.
check('a host may CREATE a Workie', () =>
  assert.deepStrictEqual(requiredGroupsForRoute('POST', 'admin/ai-prompts').sort(),
    ['admins', 'hosts']));
check('…and may still read the library', () =>
  assert.deepStrictEqual(requiredGroupsForRoute('GET', 'admin/ai-prompts').sort(),
    ['admins', 'hosts']));
check('…but may NOT edit one yet', () =>
  assert.deepStrictEqual(requiredGroupsForRoute('PUT', 'admin/ai-prompts/{promptId}'),
    ['admins']));
check('…nor delete one', () =>
  assert.deepStrictEqual(requiredGroupsForRoute('DELETE', 'admin/ai-prompts/{promptId}'),
    ['admins']));
check('…nor reach the advisor or the prompt generator', () => {
  assert.deepStrictEqual(requiredGroupsForRoute('POST', 'admin/ai-prompt-advisor'), ['admins']);
  assert.deepStrictEqual(requiredGroupsForRoute('POST', 'admin/ai-generate-prompt'), ['admins']);
});

/*
  5. A HOST CAN READ THE PERSONA LIBRARY THEY ARE ALREADY ALLOWED TO CHOOSE FROM.

  `PUT /games/{gameId}/persona` is hosts+admins — a host may set the voice that
  narrates their own room. `GET /admin/personas` fell to the generic
  `path.startsWith('admin')` rule and was admins-only, so a host could set a
  persona and never see one.

  It failed silently, which is why it lasted. Both callers swallow the 403 into
  an empty list (GameHostPage.jsx, AdminPage.jsx), so a non-admin host saw only
  "Adapt to the session" and read it as the whole library — and a question set
  that HAS a persona rendered as "<id> (unknown — Workie will adapt instead)",
  which reads as a broken set rather than a missing permission.

  The read is safe to open for the reason the partition comment gives: personas
  are platform-global CONFIGURATION — id, name, tagline, icon, voice, gameTypes.
  No tenant content, nothing per-organisation, and it is a read.

  // rejects: opening the persona WRITE side, which there isn't one of, and must
  //          not be added here by reflex if one appears.
*/
console.log('\n5. a host can read the persona library');

check('GET admin/personas is open to hosts', () =>
  assert.deepStrictEqual(requiredGroupsForRoute('GET', 'admin/personas'), ['hosts', 'admins']));

check('a host who can SET a voice can also LIST the voices', () => {
  // The incoherence this closes, asserted as the pair it is.
  assert.deepStrictEqual(requiredGroupsForRoute('PUT', 'games/1234/persona'), ['hosts', 'admins']);
  assert.deepStrictEqual(requiredGroupsForRoute('GET', 'admin/personas'), ['hosts', 'admins']);
});

/* And the clincher: a host may already READ the AI PROMPT library
   (`GET admin/ai-prompts` is hosts+admins) — the thing that decides what the AI
   is told to do. Being trusted with that and refused the list of VOICES is not
   a policy, it is an oversight. Asserted as the pair so the argument survives in
   the suite rather than only in a commit message. */
check('hosts can already read the prompt library, which is the wider of the two', () =>
  assert.deepStrictEqual(requiredGroupsForRoute('GET', 'admin/ai-prompts'), ['hosts', 'admins']));

check('but WRITING what the AI does for everybody stays Engage\'s', () => {
  assert.deepStrictEqual(requiredGroupsForRoute('POST', 'admin/ai-prompt-advisor'), ['admins']);
  assert.deepStrictEqual(requiredGroupsForRoute('POST', 'admin/ai-generate-prompt'), ['admins']);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
