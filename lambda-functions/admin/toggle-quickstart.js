const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { requireSetManager, findSetForCaller, requestedScope } = require('./shared/question-set-access');
const { setMetadataKey } = require('./shared/set-version');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

/**
 * PUT A SET ON THE QUICKSTART SHELF — or take it off.
 *
 * The owner asked for this on the HOST's set list, not just the console's:
 * *"host question set lists, should allow quick starts easily marked by
 * clicking a tag on list just like the admin"*.
 *
 * ── WHY THIS ROUTE USED TO BE ADMINS-ONLY, AND WHAT CHANGED ────────────────
 *
 * `auth/authorizer.js` excluded it by name, and `tests/question-set-ownership.js`
 * asserted the exclusion, both giving the same reason: quickstart is GLOBAL
 * curation. `QuickstartMenu.jsx:46` filters on `set.quickstart && set.active`
 * and nothing else — no ownership term — so a flagged set appears on EVERY
 * host's quickstart menu, not only its creator's. That reason was correct and
 * it has not gone away.
 *
 * What defuses it is the row guard below, which did not exist when the route was
 * excluded. With `requireSetManager` in the path the question stops being "may
 * this person curate the library" and becomes "may this person put THEIR OWN set
 * on the shelf" — a host reaches the route, and then reaches exactly one row per
 * set they created. An admin still curates everything, because an admin manages
 * every set by rule.
 *
 * So the gate is opened and the row is closed, which is the same shape as edit
 * and delete. The residual product fact, stated plainly because it is a
 * consequence and not a bug: a host flagging their own set makes it visible to
 * other hosts. That is what the quickstart shelf IS.
 *
 * ── THE GET IS NOT OPTIONAL ────────────────────────────────────────────────
 *
 * `requireSetManager` needs the row to read `createdBy` off, so the metadata is
 * fetched before the write rather than folded into a conditional update. A
 * ConditionalExpression would collapse "not yours" and "not there" into one
 * opaque ConditionalCheckFailedException, and those are the two sentences a host
 * most needs told apart — the same reasoning edit-question-set.js:109-111
 * records for the same choice.
 *
 * ── `updatedAt`, LOWER CASE ────────────────────────────────────────────────
 *
 * This handler used to write `UpdatedAt`. Every other writer
 * (upload-questions.js, toggle-question-set.js, edit-question-set.js) writes
 * `updatedAt`, and get-question-sets.js:60 reads `item.updatedAt ||
 * item.UpdatedAt` — preferring the lower-case one. So on any set that had ever
 * been edited, flagging quickstart wrote a second attribute that the reader then
 * ignored in favour of the older value, and the list's Updated column did not
 * move. That is the identical defect edit-question-set.js:117-120 records
 * fixing; this was the last writer still on the wrong spelling, and it matters
 * more now that the set lists sort by modified date.
 */
exports.handler = async (event) => {
  try {
    const setId = event.pathParameters?.setId;
    const { quickstart } = JSON.parse(event.body || '{}');

    if (!setId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Question set ID is required' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    // Validated as a BOOLEAN, matching toggle-question-set.js. Without this a
    // body of `{}` writes `undefined` and a body of `{"quickstart":"false"}`
    // writes the truthy string "false" — both of which read back as flagged.
    if (typeof quickstart !== 'boolean') {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Quickstart status must be a boolean' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

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
        body: JSON.stringify({ error: 'Question set not found' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    const denied = requireSetManager(event, existing.Item, 'change the quickstart flag on');
    if (denied) return denied;

    console.log(`🚀 Toggling quickstart status for set ${setId} to: ${quickstart}`);

    await db.send(new UpdateCommand({
      TableName: process.env.TABLE_NAME,
      Key: setMetadataKey(found.ref),
      UpdateExpression: 'SET #quickstart = :quickstart, updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#quickstart': 'Quickstart'
      },
      ExpressionAttributeValues: {
        ':quickstart': quickstart,
        ':updatedAt': new Date().toISOString()
      }
    }));

    console.log(`✅ Question set ${setId} quickstart status updated to: ${quickstart}`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: `Question set quickstart status ${quickstart ? 'enabled' : 'disabled'} successfully`,
        setId: setId,
        quickstart: quickstart
      }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };

  } catch (error) {
    console.error('Toggle quickstart error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Failed to toggle quickstart status: ${error.message}` }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};
