/**
 * ORG-AUTHORED WORKIES — admin/shared/prompt-access.js
 *
 * Until now every prompt lived in one global partition and only Engage could
 * write one. The owner asked for org-authored Workies that can be shared, so
 * prompts get the three scopes sets already have.
 *
 * The assertions that matter are the ones about what does NOT move, and about
 * the two places scoping a DynamoDB partition does not reach:
 *
 *   - personas and the default-pointer rows share the bare partition and stay
 *     platform-only ON PURPOSE;
 *   - the prompt's TEXT is in S3, and the partition does not reach it.
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const P = require(path.join(REPO, 'lambda-functions/admin/shared/prompt-access.js'));
const tenant = require(path.join(REPO, 'lambda-functions/admin/shared/tenant.js'));

let pass = 0; let fail = 0;
const say = console.log;
function check(name, fn) {
  try { fn(); say(`  PASS  ${name}`); pass += 1; } catch (e) {
    say(`  FAIL  ${name}\n        ${e.message}`); fail += 1;
  }
}
async function checkAsync(name, fn) {
  try { await fn(); say(`  PASS  ${name}`); pass += 1; } catch (e) {
    say(`  FAIL  ${name}\n        ${e.message}`); fail += 1;
  }
}

const ORG = 'org_acme';
const host = (over = {}) => ({
  requestContext: {
    authorizer: {
      lambda: {
        username: 'amara', userId: 'sub-amara', groups: 'hosts', status: 'enabled',
        orgId: ORG, orgRole: 'owner', orgIds: ORG, ...over,
      },
    },
  },
});
const staff = () => ({
  requestContext: {
    authorizer: { lambda: { username: 'g', userId: 'sub-g', groups: 'admins', status: 'enabled' } },
  },
});
/** No groups and no org: a script, the seed, the suite's own direct calls. */
const internal = () => ({ requestContext: { authorizer: { lambda: {} } } });

(async () => {
  say('\nprompt scoping\n');

  say('1. zero migration, which is the whole trick');
  // rejects: renaming the partition, which would strand every prompt that
  // exists — the platform prefix is '' and the bare key IS the platform one.
  check('a platform prompt keeps the key it already has', () => {
    assert.strictEqual(P.promptKey({ scope: 'platform', promptId: 'p1' }).PK, 'AIPROMPTS');
    assert.strictEqual(P.promptKey('p1').PK, 'AIPROMPTS', 'a bare id is a platform prompt');
  });
  check('an org prompt lands in its own partition', () => {
    assert.strictEqual(P.promptKey({ scope: 'org', orgId: ORG, promptId: 'p1' }).PK,
      `ORG#${ORG}#AIPROMPTS`);
  });
  // rejects: two orgs' same-named Workies colliding, which is the whole reason
  // for the partition.
  check('two orgs with one slug do not collide', () => {
    assert.notStrictEqual(
      P.promptKey({ scope: 'org', orgId: 'org_a', promptId: 'retro' }).PK,
      P.promptKey({ scope: 'org', orgId: 'org_b', promptId: 'retro' }).PK,
    );
  });

  say('\n2. what deliberately does NOT move');
  /*
    The bare partition also holds PERSONA# rows and the GAMETYPE# default
    pointer. Scoping those would break create-ai-prompt.js's isDefault sweep and
    get-ai-summary.js's Scan — both of which query `PK = 'AIPROMPTS'` — and buy
    nothing, because an org's prompt is chosen explicitly by a set.
  */
  // rejects: a per-scope persona or default, which is a second feature nobody
  // asked for and two live regressions.
  check('personas stay platform-only whatever they are asked', () => {
    assert.strictEqual(tenant.personasPk(), 'AIPROMPTS');
    assert.strictEqual(tenant.personasPk('org', ORG), 'AIPROMPTS',
      'a scope argument moved the persona partition');
  });

  say('\n3. the S3 body, which the partition does not reach');
  /*
    The prompt TEXT is not in the row. Scoping the partition alone leaves two
    orgs overwriting each other's body, and an org's text in a shared bucket
    beside a row that is ciphertext.
  */
  // rejects: changing the platform key, which would orphan every stored body.
  check('a platform body keeps its existing path', () => {
    assert.strictEqual(P.promptBodyKey({ scope: 'platform', promptId: 'p1' }, 'trivia', 2),
      'prompts/trivia/p1/v2.json');
  });
  // rejects: THE COLLISION. Two orgs, one slug, one object.
  check('two orgs write to different objects', () => {
    const a = P.promptBodyKey({ scope: 'org', orgId: 'org_a', promptId: 'retro' }, 'poll', 1);
    const b = P.promptBodyKey({ scope: 'org', orgId: 'org_b', promptId: 'retro' }, 'poll', 1);
    assert.notStrictEqual(a, b);
    assert.ok(a.includes('org_a'), a);
  });
  check('and neither can collide with a platform prompt of that name', () => {
    assert.notStrictEqual(
      P.promptBodyKey({ scope: 'org', orgId: 'org_a', promptId: 'retro' }, 'poll', 1),
      P.promptBodyKey({ scope: 'platform', promptId: 'retro' }, 'poll', 1),
    );
  });

  say('\n4. where a new Workie goes');
  // rejects: a host's Workie landing in the library every customer reads.
  check('a host in an org creates an ORG prompt', () => {
    const ref = P.createPromptRef(host(), 'retro');
    assert.strictEqual(ref.scope, 'org');
    assert.strictEqual(ref.orgId, ORG);
  });
  // rejects: Engage staff losing the ability to author house content.
  check('staff with no org create a PLATFORM prompt', () => {
    assert.strictEqual(P.createPromptRef(staff(), 'retro').scope, 'platform');
  });
  /*
    A REAL host with no organisation is REFUSED rather than defaulted. This is
    the branch that, on the sets side, silently published every customer's
    generated content to the shared library for weeks.
  */
  // rejects: defaulting an orgless host to platform.
  check('a host with no organisation is refused, not defaulted', () => {
    assert.strictEqual(P.createPromptRef(host({ orgId: '', orgIds: '' }), 'retro'), null);
  });
  // rejects: closing the seam the seed scripts and workers come through.
  check('an internal caller still writes platform', () => {
    assert.strictEqual(P.createPromptRef(internal(), 'retro').scope, 'platform');
  });
  // rejects: `?scope=platform` from an org host being an escalation.
  check('asking for a scope you cannot manage is a refusal', () => {
    assert.strictEqual(P.createPromptRef(host(), 'retro', 'platform'), null);
  });

  say('\n5. who may change one');
  check('the creator may change their own', () => {
    assert.strictEqual(
      P.canManagePrompt(host(), { scope: 'org', orgId: ORG, createdBy: 'sub-amara' }), true);
  });
  // rejects: one org editing another's Workie by naming its id.
  check('another organisation may not', () => {
    assert.strictEqual(
      P.canManagePrompt(host({ orgId: 'org_globex', orgIds: 'org_globex' }),
        { scope: 'org', orgId: ORG, createdBy: 'sub-amara' }), false);
  });
  /*
    THE INTERLOCK, copied from canManageScope deliberately: staff standing
    inside a customer's org may not edit the house library from there. Being in
    `admins` says WHO may; having no active org says they are doing it
    DELIBERATELY.
  */
  // rejects: an Engage admin acting as a customer editing house content by
  // accident — the exact incident that produced the rule for sets.
  check('staff inside an org cannot edit the house library from there', () => {
    const inside = staff();
    inside.requestContext.authorizer.lambda.orgId = ORG;
    inside.requestContext.authorizer.lambda.orgRole = 'member';
    assert.strictEqual(P.canManagePrompt(inside, { scope: 'platform' }), false);
  });
  check('staff with no org can', () => {
    assert.strictEqual(P.canManagePrompt(staff(), { scope: 'platform' }), true);
  });
  // rejects: a public row being editable in place. A public Workie is a COPY;
  // it is changed by changing the org row it came from.
  check('nobody edits a public prompt directly', () => {
    assert.strictEqual(P.canManagePrompt(staff(), { scope: 'public' }), false);
    assert.strictEqual(P.canManagePrompt(host(), { scope: 'public' }), false);
  });
  /*
    A row with an orgId but no scope is not one of the ~41 legacy platform
    rows — nothing legacy ever recorded an orgId. It is a half-stamped ORG
    row, the shape question-set-access.js's setScopeOf calls out by name, and
    reading it as platform would let staff with no active org manage another
    organisation's Workie just because it was never finished being written.
  */
  // rejects: reverting Fix 1, which would read this row as platform and
  // return true.
  check('an orgId with no scope is read as org, not platform', () => {
    assert.strictEqual(P.canManagePrompt(staff(), { orgId: 'org_X' }), false);
  });
  // rejects: a Fix 1 that fell back to ORG unconditionally, which would break
  // every one of the ~41 rows that have neither scope nor orgId.
  check('neither scope nor orgId is still a legacy platform row', () => {
    assert.strictEqual(P.canManagePrompt(staff(), {}), true);
  });

  say('\n6. finding one, and not finding another org\'s');
  class GetCommand { constructor(i) { this.input = i; } }
  const rows = new Map();
  const db = { send: async (c) => ({ Item: rows.get(`${c.input.Key.PK}|${c.input.Key.SK}`) }) };

  // rejects: platform winning a name the caller's own org also uses.
  await checkAsync('your own org wins a shared name', async () => {
    rows.clear();
    rows.set(`AIPROMPTS|AIPROMPT#retro`, { name: 'Engage retro', scope: 'platform' });
    rows.set(`ORG#${ORG}#AIPROMPTS|AIPROMPT#retro`, { name: 'Our retro', scope: 'org' });
    const found = await P.findPromptForCaller(db, 't', host(), 'retro', '', GetCommand);
    assert.strictEqual(found.item.name, 'Our retro');
  });
  // rejects: probing a partition the caller cannot read, which would turn
  // "absent" into "forbidden" and confirm another org's Workie exists.
  await checkAsync('another org\'s prompt is ABSENT, not forbidden', async () => {
    rows.clear();
    rows.set(`ORG#org_globex#AIPROMPTS|AIPROMPT#secret`, { name: 'Theirs' });
    const found = await P.findPromptForCaller(db, 't', host(), 'secret', '', GetCommand);
    assert.strictEqual(found, null);
  });
  await checkAsync('an explicit scope probes only that one', async () => {
    rows.clear();
    rows.set(`ORG#${ORG}#AIPROMPTS|AIPROMPT#retro`, { name: 'Ours' });
    const found = await P.findPromptForCaller(db, 't', host(), 'retro', 'platform', GetCommand);
    assert.strictEqual(found, null, 'it fell through to a scope it was not asked for');
  });

  say('\n7. the owner stamp: platform is an absence');
  /*
    ownerStamp in question-set-access.js writes PLATFORM as an absence rather
    than `scope: 'platform'`, so a freshly stamped platform row stays
    shape-identical to the rows that predate scoping. promptOwnerStamp follows
    the same rule.
  */
  // rejects: reverting Fix 2, which would put `scope: 'platform'` on every
  // new platform row.
  check('a platform stamp carries no scope key', () => {
    const stamp = P.promptOwnerStamp(staff(), { scope: 'platform', promptId: 'p1' });
    assert.strictEqual('scope' in stamp, false);
  });
  // rejects: a Fix 2 that dropped the attribute for every scope instead of
  // just platform.
  check('an org stamp still carries its scope and org', () => {
    const stamp = P.promptOwnerStamp(host(), { scope: 'org', orgId: ORG, promptId: 'p1' });
    assert.strictEqual(stamp.scope, 'org');
    assert.strictEqual(stamp.orgId, ORG);
  });

  say(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
