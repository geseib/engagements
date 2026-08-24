const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { requireSetManager, findSetForCaller, requestedScope } = require('./shared/question-set-access');
const { setMetadataKey } = require('./shared/set-version');
const {
  ROUND_KIND_IDS, MAX_ROUND_KIND_BRIEF, normalizeRoundKind,
} = require('./shared/round-kinds');
const { ORG } = require('./shared/tenant');
const { ENCRYPTED_FIELDS, encryptValue } = require('./shared/tenant-crypto');

const dynamoClient = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(dynamoClient);

/**
 * Canonical engagement type ids, mirroring src/src/config/gameTypes.js.
 *
 * The lambda bundle cannot import the frontend ESM module, so the list is
 * duplicated here deliberately. Keep the two in sync.
 */
const GAME_TYPE_IDS = ['call-and-answer', 'trivia', 'poll', 'wavelength', 'survey'];
const GAME_TYPE_ALIASES = {
  callandanswer: 'call-and-answer',
  call_and_answer: 'call-and-answer',
  calland: 'call-and-answer',
  quiz: 'trivia',
  polls: 'poll'
};

/** Canonical id for any spelling, or null when the value is not a known type. */
function normalizeGameType(value) {
  const key = String(value ?? '').trim().toLowerCase();
  if (GAME_TYPE_IDS.includes(key)) return key;
  if (GAME_TYPE_ALIASES[key]) return GAME_TYPE_ALIASES[key];
  return null;
}

/**
 * Every optional attribute the editor can write.
 *
 * All of them are aliased through ExpressionAttributeNames — `name` is a
 * DynamoDB reserved word and the rest cost nothing to alias, so there is one
 * rule instead of a per-field judgement call.
 */
const OPTIONAL_FIELDS = [
  'description',
  'customInstruction',
  'aiContextInstruction',
  'promptId',
  'roundNoun',
  'personaId',
  // The operator's own direction, used ONLY when roundKind === 'custom'. It is
  // free text and belongs here rather than beside the validated enum for
  // exactly that reason: the KEY stays closed, the prose does not become one.
  // It inherits the clear-vs-skip semantics documented below for free.
  'roundKindBrief'
];

exports.handler = async (event) => {
  try {
    const setId = event.pathParameters?.setId;
    const body = JSON.parse(event.body || '{}');
    const { name } = body;

    console.log(`Editing question set ${setId}`);

    if (!setId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Set ID is required' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    if (!name || !name.trim()) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Name is required' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    // WHO OWNS THIS SET — read before anything is written.
    //
    // Two things depend on this read, and both were missing:
    //
    // 1. OWNERSHIP. Hosts reach this route now (auth/authorizer.js's
    //    HOST_ADMIN_ROUTES), so "signed in" no longer implies "allowed". A host
    //    may rename only a set they created; an admin may rename any. The rule
    //    and the reasoning live in shared/question-set-access.js.
    //
    // 2. EXISTENCE. `UpdateCommand` is an UPSERT. Without this read a PUT to
    //    /admin/edit-question-set/anything-at-all silently CREATED a SETS row
    //    carrying nothing but a name and a timestamp — no engagementType, no
    //    questions, no owner — which then appeared in the admin list as an
    //    unownable empty set. That was survivable while only admins could call
    //    it. It is not survivable now: it would be a way to manufacture rows
    //    outside the ownership rule entirely.
    // WHICH LIBRARY, THEN WHO. `findSetForCaller` searches only the scopes this
    // caller may READ — their own org, then platform, then public — so a set in
    // another organisation is ABSENT rather than forbidden and this route 404s
    // on it exactly as it would on a set that never existed. Whether org B has a
    // `teamretro` is not a fact org A gets to establish from a status code.
    //
    // The row that comes back carries its own scope, and `requireSetManager`
    // reads it: platform sets are Engage staff's, org sets are that org's, and
    // being an Engage administrator grants nothing inside an org. See
    // shared/question-set-access.js.
    const found = await findSetForCaller(
      db, process.env.TABLE_NAME, event, setId, requestedScope(event)
    );
    const existing = { Item: found && found.item };

    if (!existing.Item) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: `Question set "${setId}" was not found.` }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    // 403 before any write. Checked here rather than as a ConditionExpression so
    // "not yours" and "not there" stay distinguishable — a conditional write
    // collapses both into one opaque ConditionalCheckFailedException, and the
    // host surface needs to tell those two apart to say anything useful.
    const denied = requireSetManager(event, existing.Item, 'edit');
    if (denied) return denied;

    // Update the question set metadata.
    //
    // `updatedAt` is lower-case to match every other writer (upload-questions.js,
    // toggle-question-set.js) and the reader in get-question-sets.js. This used
    // to write `UpdatedAt`, so an edit never moved the timestamp the list shows
    // and the owner got no feedback that a save had landed.
    // ── WHAT GETS WRITTEN AS CIPHERTEXT ──────────────────────────────────────
    //
    // The editor writes the set's prose one attribute at a time, so encryption
    // happens per VALUE here rather than per item: `encryptItem` takes a whole
    // row and there is no row in an UpdateExpression.
    //
    // The field list is READ FROM tenant-crypto, never restated. A local copy
    // would drift the moment a field is added to the boundary, and the way that
    // drift presents is a new prose field shipping in plaintext with every test
    // still green — which is exactly why ENCRYPTED_FIELDS is data.
    //
    // ONLY ORG SCOPE, for the same reason upload-questions.js gives: platform
    // and public sets are the libraries every organisation reads, and there is
    // no org whose key they could be written under. `found.ref` is the row that
    // was actually read, so this cannot be argued about from the request.
    //
    // A CLEAR STAYS A CLEAR. `encryptValue` skips '' (and null/undefined), so
    // blanking a field writes a real empty string rather than 60 bytes of noise
    // that every `x || fallback` reader would treat as present.
    const cryptoOrgId = found.ref && found.ref.scope === ORG ? String(found.ref.orgId || '') : '';
    const encryptedSetFields = new Set(ENCRYPTED_FIELDS.set);
    const store = async (field, value) => (
      cryptoOrgId && encryptedSetFields.has(field) ? encryptValue(cryptoOrgId, value) : value
    );

    const updateParams = {
      TableName: process.env.TABLE_NAME,
      // The row that was READ, not a rebuilt platform key — an org's set is
      // updated in its own partition or the upsert would manufacture a second,
      // empty, platform-scoped set with the same slug.
      Key: setMetadataKey(found.ref),
      UpdateExpression: 'SET #name = :name, updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#name': 'name'
      },
      ExpressionAttributeValues: {
        ':name': await store('name', name.trim()),
        ':updatedAt': new Date().toISOString()
      }
    };

    // Clear-vs-skip semantics.
    //
    // The guard is `!== undefined`, NOT `!== null`. A key the caller omitted is
    // left untouched; a key present with '' (or null) is deliberately cleared and
    // written as an empty string. The old `!== null` guard made "blank this
    // field" a silent no-op — the old value simply reappeared on refresh — and
    // made it impossible to detach a promptId through the UI at all.
    //
    // null is coerced to '' rather than skipped: a caller that sends an explicit
    // null means "no value", which is exactly what an empty string records.
    // Downstream readers (get-ai-summary.js:800-841) test truthiness, so '' and
    // "attribute absent" behave identically at runtime.
    // The brief is free text, so it gets a length ceiling rather than a value
    // check. 500 characters is enough for a real instruction and short enough
    // that a set cannot smuggle a second prompt template into the generator.
    if (typeof body.roundKindBrief === 'string' && body.roundKindBrief.trim().length > MAX_ROUND_KIND_BRIEF) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: `The round direction is ${body.roundKindBrief.trim().length} characters; the limit is ${MAX_ROUND_KIND_BRIEF}.`
        }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    const applied = {};
    for (const field of OPTIONAL_FIELDS) {
      if (!(field in body) || body[field] === undefined) continue;
      const value = body[field] === null ? '' : String(body[field]).trim();
      updateParams.UpdateExpression += `, #${field} = :${field}`;
      updateParams.ExpressionAttributeNames[`#${field}`] = field;
      updateParams.ExpressionAttributeValues[`:${field}`] = await store(field, value);
      // `applied` is echoed to the console so it can state exactly what landed.
      // It carries the PLAINTEXT deliberately: the caller just sent these
      // strings, and handing back an envelope would turn a "saved" confirmation
      // into `{v:1,iv:…}` on screen.
      applied[field] = value;
    }

    // engagementType is validated rather than free-form: a typo here silently
    // changes which phases the game runs and which default prompt resolves.
    if ('engagementType' in body && body.engagementType !== undefined && body.engagementType !== null) {
      const normalized = normalizeGameType(body.engagementType);
      if (!normalized) {
        return {
          statusCode: 400,
          body: JSON.stringify({
            error: `Unknown engagement type "${body.engagementType}". Expected one of: ${GAME_TYPE_IDS.join(', ')}`
          }),
          headers: { 'Access-Control-Allow-Origin': '*' }
        };
      }
      updateParams.UpdateExpression += ', #engagementType = :engagementType';
      updateParams.ExpressionAttributeNames['#engagementType'] = 'engagementType';
      updateParams.ExpressionAttributeValues[':engagementType'] = normalized;
      applied.engagementType = normalized;
    }

    // roundKind is validated exactly like engagementType and for the same
    // reason: every generator branch, every future library facet and every test
    // switches on it exhaustively, so a typo must not silently become a new
    // kind. The enum is closed; `custom` plus the free-text roundKindBrief
    // above is the escape hatch, which is what keeps it closed.
    //
    // '' is allowed through as a deliberate CLEAR — it restores the reader
    // default (produce) without inventing a stored value for the ~41 sets that
    // predate this field.
    if ('roundKind' in body && body.roundKind !== undefined) {
      const raw = body.roundKind === null ? '' : String(body.roundKind).trim();
      const normalized = raw === '' ? '' : normalizeRoundKind(raw);
      if (normalized === null) {
        return {
          statusCode: 400,
          body: JSON.stringify({
            error: `Unknown round kind "${body.roundKind}". Expected one of: ${ROUND_KIND_IDS.join(', ')}`
          }),
          headers: { 'Access-Control-Allow-Origin': '*' }
        };
      }
      updateParams.UpdateExpression += ', #roundKind = :roundKind';
      updateParams.ExpressionAttributeNames['#roundKind'] = 'roundKind';
      updateParams.ExpressionAttributeValues[':roundKind'] = normalized;
      applied.roundKind = normalized;
    }

    await db.send(new UpdateCommand(updateParams));

    console.log(`✏️ Updated question set "${setId}" with name: ${name}`, applied);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: `Question set "${name}" updated successfully`,
        setId: setId,
        scope: found.ref.scope,
        orgId: found.ref.orgId || null,
        name: name,
        // Echoed back so the UI can state exactly what landed instead of
        // showing a generic "saved" that looks identical to a failed save.
        updated: applied
      }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };

  } catch (error) {
    console.error('Edit question set error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Failed to edit question set: ${error.message}` }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};
