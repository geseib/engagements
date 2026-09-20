const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { requireSetManager, findSetForCaller, requestedScope } = require('./shared/question-set-access');
const { setMetadataKey } = require('./shared/set-version');
const {
  ROUND_KIND_IDS, MAX_ROUND_KIND_BRIEF, normalizeRoundKind,
} = require('./shared/round-kinds');
const {
  normalizeSetTopic, normalizeSetTags, setTopicRefusal,
} = require('./shared/set-topics');
const { ORG } = require('./shared/tenant');
const { ENCRYPTED_FIELDS, encryptValue } = require('./shared/tenant-crypto');
const { resolvePromptRef, resolvePersonaRef, refusal } = require('./shared/workie-refs');

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

/**
 * ONE SPELLING OF "WHAT THIS FIELD IS WORTH", because there used to be two.
 *
 * An optional field arrives as a string, as `null` (the editor's way of saying
 * "blank this"), or as nothing at all, and every use of it wants the same
 * answer: the trimmed string, with an absent value reading as ''. That rule was
 * written out twice below — once by `changed()`, deciding whether a value needs
 * validating, and once by the write loop, deciding what to store — and a third
 * time, slightly differently, for the value already on the row.
 *
 * Three copies of one rule is a defect waiting for someone to fix a trimming
 * bug in the copy they happened to be reading. Drift between the first two is
 * the expensive kind: `changed()` would clear a reference the write then stored
 * anyway, or refuse a save over a value nobody altered. They agree because they
 * are now the same function, not because they were kept in step.
 */
const normalizeOptional = (value) => (
  value === null || value === undefined ? '' : String(value).trim()
);

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

    // ── WORKIE'S TWO SETTINGS, CHECKED BEFORE THEY ARE STORED ────────────────
    //
    // `promptId` and `personaId` are the only two OPTIONAL_FIELDS that are
    // REFERENCES rather than prose, and both degrade silently at run time: a
    // prompt that resolves to nothing falls back to the game-type default, a
    // voice that resolves to nothing falls through to the next rung. The person
    // who chose the value was never told, because this route accepted any
    // string at all. See shared/workie-refs.js.
    //
    // THE LIBRARY IS THE SET'S, NOT THE CALLER'S — `cryptoOrgId` is derived
    // from `found.ref`, the row that was actually read, for the same reason the
    // encryption above uses it: an Engage admin editing a platform set must not
    // be able to point it at their own org's Workie, which no other
    // organisation could then read.
    //
    // A CLEAR IS NOT A DANGLING ID. `resolve*Ref` answers ok for '' and null,
    // so blanking either field stays possible — which it must, since detaching
    // is the only cure for a value whose target has already been deleted.
    //
    // ── AND ONLY A CHANGED VALUE IS ARGUED WITH ──────────────────────────────
    //
    // Sets ALREADY carry ids that resolve to nothing: BuilderPage.jsx offers
    // seven the seeder never mints, and this route's sibling used to stamp
    // `lessons-learned` on every set regardless of engagement type. The editor
    // sends the whole set back on every save, so checking the stored value too
    // would refuse a RENAME over a field the person never opened — turning one
    // silent defect into a wall in front of an unrelated edit.
    //
    // So the comparison is against the row that was already read for the
    // ownership check; there is no second Get. Untouched passes through exactly
    // as stored. Changing to a different broken id is still refused, because
    // that is a choice, and clearing is still allowed, because that is the cure.
    //
    // THIS IS NOT WHERE THE DANGLING ID GETS FIXED, and the branch must not be
    // "tidied up" into a plain check on that reasoning: the editor shows a
    // stored id that is absent from the fetched list as unavailable, with a
    // one-click clear (Ruling W4), so a builder meets it before saving instead
    // of in a refusal afterwards. That is what makes this converge.
    const changed = (field) => {
      if (!(field in body) || body[field] === undefined) return false;
      return normalizeOptional(body[field]) !== normalizeOptional(existing.Item[field]);
    };

    if (changed('promptId')) {
      const promptCheck = await resolvePromptRef(
        db, process.env.TABLE_NAME, body.promptId, { orgId: cryptoOrgId }
      );
      if (!promptCheck.ok) return refusal('promptId', promptCheck.reason);
    }

    if (changed('personaId')) {
      const personaCheck = await resolvePersonaRef(db, process.env.TABLE_NAME, body.personaId);
      if (!personaCheck.ok) return refusal('personaId', personaCheck.reason);
    }

    const applied = {};
    for (const field of OPTIONAL_FIELDS) {
      if (!(field in body) || body[field] === undefined) continue;
      const value = normalizeOptional(body[field]);
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

    /*
      THE SHELF — validated like engagementType and roundKind, and for the same
      reason: the filter, the browse and every facet downstream read a closed
      list, so a typo must not become a sixteenth shelf none of them knows about.

      CLEAR-VS-SKIP IS NOT THE RULE HERE, and that is the one difference from
      every other optional field above. A save that MENTIONS the topic must name
      a real shelf — '' and null are refused, not stored — because a set is
      required to have one and blanking it would be the single way a filed set
      could quietly become unfiled again.

      A save that does NOT mention it leaves the row exactly as it was. That is
      what keeps the ~40 sets predating this field usable: renaming one, or
      re-pointing its Workie, is somebody in the middle of using it, and a
      requirement that reaches backwards into those saves would be a wall in
      front of an unrelated edit.
    */
    if ('topic' in body && body.topic !== undefined) {
      const topic = normalizeSetTopic(body.topic);
      if (!topic) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: setTopicRefusal(body.topic) }),
          headers: { 'Access-Control-Allow-Origin': '*' }
        };
      }
      updateParams.UpdateExpression += ', #topic = :topic';
      updateParams.ExpressionAttributeNames['#topic'] = 'topic';
      // Through `store` even though `ENCRYPTED_FIELDS.set` does not name this
      // field. Writing the value straight in would be a local restatement of
      // the boundary by omission — exactly the drift this handler's own note
      // above warns about — and the way that drift presents is a field silently
      // shipping in the wrong form with every test still green.
      updateParams.ExpressionAttributeValues[':topic'] = await store('topic', topic);
      applied.topic = topic;
    }

    /*
      THE SET'S OWN TAGS. A list, not a string, so it cannot ride in
      OPTIONAL_FIELDS — `normalizeOptional` would stringify it.

      `[]` IS A REAL VALUE HERE: it clears the tags. That is the opposite
      choice from the topic immediately above and the right one — a tag is the
      author's own word and must be removable, whereas the shelf is required.
      Omitting the key still leaves the stored list alone.

      Never confused with a QUESTION's `Tags`: this writes the metadata row's
      lower-case `tags` and touches no question row at all.
    */
    if ('tags' in body && body.tags !== undefined) {
      const tags = normalizeSetTags(body.tags);
      updateParams.UpdateExpression += ', #tags = :tags';
      updateParams.ExpressionAttributeNames['#tags'] = 'tags';
      updateParams.ExpressionAttributeValues[':tags'] = await store('tags', tags);
      applied.tags = tags;
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
