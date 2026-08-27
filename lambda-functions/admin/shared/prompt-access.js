/**
 * WHOSE WORKIE IS THIS? — the prompt half of question-set-access.js.
 *
 * The owner asked for org-authored Workies, and for them to be shareable:
 * *"the checks will need to be on the prompts as well. they need to be made
 * public friendly."*
 *
 * Every rule here is deliberately the SAME SHAPE as the equivalent for sets,
 * because two libraries with two different permission models is how one of them
 * ends up wrong. Where a rule differs it says why.
 *
 * ── WHAT MOVES, AND WHAT DOES NOT ─────────────────────────────────────────
 *
 * The bare `AIPROMPTS` partition holds three row shapes. Only the first is
 * scoped:
 *
 *   AIPROMPT#<id>                   scoped — this module
 *   PERSONA#<id>                    platform-only (tenant.personasPk)
 *   GAMETYPE#<t>#CATEGORY#<c>       platform-only, the default pointer
 *
 * A persona is a voice Engage curates; nothing asked for a customer-authored
 * one. The default pointer answers "what does Engage use when a set names
 * nothing", which is a house decision by definition — an org's prompt is chosen
 * EXPLICITLY by a set or it is not used. That is what keeps
 * `create-ai-prompt.js`'s isDefault sweep and `get-ai-summary.js`'s Scan
 * working unchanged; a per-scope default would break both and buy nothing.
 *
 * ── AND THE BODY IS IN S3, WHICH THE PARTITION DOES NOT REACH ─────────────
 *
 * The prompt TEXT is not in the DynamoDB row — `create-ai-prompt.js` writes it
 * to `prompts/<gameType>/<promptId>/v<n>.json` and stores only `s3Key`. So
 * scoping the partition alone would leave two organisations with the same slug
 * overwriting each other's Workie text, and an org's text sitting in a shared
 * bucket in plaintext beside a row that is ciphertext.
 *
 * `promptBodyKey` below is the other half of the fix. Existing keys are the
 * platform form and are untouched, so this is zero migration in S3 as well.
 */
const tenant = require('./tenant');
const { callerGroups } = require('./require-admin');
const { callerUserId } = require('./question-set-access');

const clean = (v) => (typeof v === 'string' ? v.trim() : '');

/** `{scope, orgId, promptId}`, normalised, with platform as the default scope. */
function promptRef(ref) {
  if (typeof ref === 'string') return { scope: tenant.PLATFORM, orgId: '', promptId: ref };
  const scope = clean(ref && ref.scope) || tenant.PLATFORM;
  return {
    scope,
    orgId: scope === tenant.ORG ? clean(ref && ref.orgId) : '',
    promptId: clean(ref && ref.promptId),
  };
}

/** The DynamoDB key for one prompt in one library. */
function promptKey(ref) {
  const { scope, orgId, promptId } = promptRef(ref);
  return { PK: tenant.promptsMetadataPk(scope, orgId), SK: `AIPROMPT#${promptId}` };
}

/**
 * Where the prompt's TEXT lives in S3.
 *
 * Platform keeps the existing shape exactly — that is what makes this zero
 * migration — and the other two scopes gain a segment that cannot collide with
 * it or with each other.
 */
function promptBodyKey(ref, gameType, version) {
  const { scope, orgId, promptId } = promptRef(ref);
  const tail = `${gameType}/${promptId}/v${version}.json`;
  if (scope === tenant.ORG) return `prompts/org/${orgId}/${tail}`;
  if (scope === tenant.PUBLIC) return `prompts/public/${tail}`;
  return `prompts/${tail}`;
}

/**
 * Every library this caller may READ, most specific first.
 *
 * Org before platform before public, so a team's own Workie wins a name it
 * shares with Engage's — the same ordering `readableSetRefs` uses, and for the
 * same reason: your own content is what you meant.
 */
function readablePromptRefs(event, promptId) {
  const orgId = tenant.callerOrgId(event);
  return tenant.readableScopes(event)
    .slice()
    .sort((a, b) => {
      const rank = { [tenant.ORG]: 0, [tenant.PLATFORM]: 1, [tenant.PUBLIC]: 2 };
      return (rank[a] ?? 9) - (rank[b] ?? 9);
    })
    .map((scope) => promptRef({ scope, orgId: scope === tenant.ORG ? orgId : '', promptId }));
}

/**
 * The scope a NEW prompt is created in.
 *
 * Identical in shape to `createSetRef`, including the internal-invocation seam:
 * a caller with no groups AND no org is a script or a worker, and those wrote
 * platform content before any of this existed. A REAL host with no organisation
 * selected is refused rather than defaulted, because writing their Workie into
 * the library every customer reads is precisely the failure tenant.js exists to
 * prevent.
 */
function createPromptRef(event, promptId, requestedScope) {
  const wanted = clean(requestedScope);
  const orgId = tenant.callerOrgId(event);

  const internal = callerGroups(event).length === 0 && !orgId;
  if (internal && !wanted) return promptRef({ scope: tenant.PLATFORM, promptId });

  const candidates = wanted
    ? [{ scope: wanted, orgId: wanted === tenant.ORG ? orgId : '' }]
    : [{ scope: tenant.ORG, orgId }, { scope: tenant.PLATFORM, orgId: '' }];

  for (const c of candidates) {
    if (c.scope === tenant.ORG && !c.orgId) continue;
    if (tenant.canManageScope(event, c.scope, c.orgId)) return promptRef({ ...c, promptId });
  }
  return null;
}

/**
 * May this caller change this prompt?
 *
 * Two terms, like `canManageSet`: the SCOPE first, then who within it. Platform
 * passes on the scope alone because Engage staff collectively own the house
 * library and the existing rows have no recorded creator to test against.
 */
function canManagePrompt(event, item) {
  if (!item) return false;
  const orgId = clean(item.orgId);
  // An orgId with no scope is a half-stamped ORG row, not a legacy PLATFORM
  // one — nothing legacy ever recorded an orgId. Reading it as platform is a
  // fail-OPEN: it would let any Engage admin with no active org manage
  // another organisation's Workie. Same shape, same fix, as setScopeOf in
  // question-set-access.js.
  const scope = clean(item.scope) || (orgId ? tenant.ORG : tenant.PLATFORM);

  if (!tenant.canManageScope(event, scope, orgId)) return false;
  if (scope === tenant.PLATFORM) return true;

  const me = callerUserId(event);
  if (me && item.createdBy && me === item.createdBy) return true;
  return tenant.canManageScope(event, scope, orgId, 'admin');
}

/**
 * Find one prompt in the first readable library that has it.
 *
 * IT IS ALSO THE READ GUARD: a scope this caller cannot read is never probed,
 * so another organisation's Workie is not "forbidden" here, it is ABSENT —
 * exactly as `findSetForCaller` behaves, and for the same reason. Whether org B
 * has a Workie called `retro` is not org A's business.
 */
async function findPromptForCaller(db, tableName, event, promptId, requestedScope, GetCommand) {
  const wanted = clean(requestedScope);
  let refs = readablePromptRefs(event, promptId);
  if (wanted) refs = refs.filter((r) => r.scope === wanted);

  for (const ref of refs) {
    let key;
    try { key = promptKey(ref); } catch { continue; }   // eslint-disable-line no-empty
    // eslint-disable-next-line no-await-in-loop
    const res = await db.send(new GetCommand({ TableName: tableName, Key: key }));
    if (res && res.Item) return { ref, item: res.Item };
  }
  return null;
}

/** Scope, org and creator written together — the same rule `ownerStamp` follows. */
function promptOwnerStamp(event, ref) {
  const { scope, orgId } = promptRef(ref);
  const userId = callerUserId(event);
  // PLATFORM IS STAMPED AS AN ABSENCE, not `scope: 'platform'` — writing the
  // string would give new platform rows an attribute the existing ones don't
  // carry. Same rule as `ownerStamp` in question-set-access.js, same reason.
  const place = scope === tenant.PLATFORM ? {} : { scope, ...(orgId ? { orgId } : {}) };
  return {
    ...place,
    ...(userId ? { createdBy: userId } : {}),
  };
}

module.exports = {
  promptRef,
  promptKey,
  promptBodyKey,
  readablePromptRefs,
  createPromptRef,
  canManagePrompt,
  findPromptForCaller,
  promptOwnerStamp,
};
