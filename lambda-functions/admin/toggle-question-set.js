const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { requireSetManager, findSetForCaller, requestedScope } = require('./shared/question-set-access');
const { setMetadataKey } = require('./shared/set-version');
const { PLATFORM } = require('./shared/tenant');
const { dispatchHouseCheck } = require('./shared/house-check');
const { resolveSetTopic, setTopicRefusal, UNFILED } = require('./shared/set-topics');

const dynamoClient = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(dynamoClient);

exports.handler = async (event) => {
  try {
    const setId = event.pathParameters?.setId;
    const { active } = JSON.parse(event.body || '{}');
    
    console.log(`Toggling question set ${setId} to active: ${active}`);
    
    if (!setId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Set ID is required' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }
    
    if (typeof active !== 'boolean') {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Active status must be a boolean' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }
    
    // WHICH SET, AND MAY THIS CALLER CHANGE IT.
    //
    // This route had NO ownership check and no existence check: `UpdateCommand`
    // is an upsert, so a PUT to /toggle-question-set/anything-at-all silently
    // CREATED a SETS row carrying nothing but `active` and a timestamp, which
    // then appeared in the admin list as an empty, unownable set. That was
    // survivable while the route was admins-only and there was one library. It
    // is not survivable with several: hiding or un-hiding another customer's set
    // from their own picker is a live change to their session, and a manufactured
    // row would land outside the ownership rule entirely.
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
    if (!found) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: `Question set "${setId}" was not found.` }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    const denied = requireSetManager(event, found.item, 'activate or deactivate');
    if (denied) return denied;

    /*
      A TRANSITION, not a state: switching on a set that was already serving
      makes nothing newly servable. A row written before `active` existed
      carries no attribute and IS active — the rule every reader applies
      (`item.active !== false`) — so it is not a transition either. Both things
      below turn on this distinction, which is why it is computed once.
    */
    const switchingOn = active === true && found.item.active === false;

    /*
      A SET MUST BE FILED BEFORE IT CAN SERVE ANYBODY.

      THIS IS THE GATE THE DRAFT EXEMPTION LEANS ON. upload-questions.js lets a
      set arrive unfiled when it arrives switched OFF — an AI draft, a legacy
      archive restore — because it is servable to nobody and refusing it would
      throw away a generation run nobody can repeat. That exemption is only
      honest if something asks later, and this route is the only one that flips
      a set's `active`, so this is the whole of "later". Before this existed a
      generated set went live unfiled and was never asked again: a save is not
      the gate, because edit-question-set.js validates only a save that MENTIONS
      the topic and switching a set on mentions nothing.

      EVERY LIBRARY, NOT JUST ENGAGE'S. `becameServable` below is deliberately
      narrower — the content check is about Engage's own shared content — but a
      customer's generated draft is exactly the set this is here to catch, and
      it is an ORG row.

      AND IT NEVER REACHES BACKWARDS. It bites on off → on and nowhere else, so
      the ~40 sets predating the shelf — which carry no `active` attribute and
      read as live — never meet it, an unfiled set can always still be switched
      OFF, and listing, renaming and playing one are untouched. The only person
      it asks is one deliberately making an unfiled set servable, and the
      message names all fifteen shelves so the answer comes with the question.

      READ STRAIGHT OFF THE ROW, and that is safe rather than sloppy:
      `findSetForCaller` does not decrypt, and `topic` is not in
      `ENCRYPTED_FIELDS.set` — it is a closed-list id, structural like
      `engagementType`, and tests/set-topic-carry.js pins that an org set's
      shelf is stored readable rather than sealed. Decrypting here purely to
      read it would add a KMS call to every activation; if that boundary ever
      moved, this refuses a FILED set loudly and that test fails first.

      400, like the two refusals above it, because that is this route's idiom
      for "this cannot be carried out as asked"; publish-question-set.js uses
      409 for the same rule because 409 is the idiom of ITS neighbours.
    */
    if (switchingOn && resolveSetTopic(found.item.topic) === UNFILED) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: setTopicRefusal(found.item.topic) }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    /*
      SWITCHING ON ONE OF ENGAGE'S OWN SETS IS THE MOMENT IT BECOMES SERVABLE
      TO EVERY ORGANISATION — the analogue of a customer sharing theirs, and the
      owner's chosen trigger for the content check (check-question-set.js,
      `checkPlatformSet`). This route starts it, below, once the row has moved;
      `shared/house-check.js` carries why that is here and not in the console.
    */
    const becameServable = switchingOn && found.ref.scope === PLATFORM;

    // Update the question set active status
    await db.send(new UpdateCommand({
      TableName: process.env.TABLE_NAME,
      Key: setMetadataKey(found.ref),
      UpdateExpression: 'SET active = :active, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':active': active,
        ':updatedAt': new Date().toISOString()
      }
    }));
    
    console.log(`✅ Successfully toggled question set ${setId} to active: ${active}`);

    // AFTER the write, and it cannot undo it: a dispatch that will not go is
    // logged inside and swallowed, and this activation still answers success.
    if (becameServable) await dispatchHouseCheck(event, setId);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: `Question set ${active ? 'activated' : 'deactivated'} successfully`,
        setId: setId,
        scope: found.ref.scope,
        orgId: found.ref.orgId || null,
        active: active,
        // Always present, so a client does not have to tell "not due" from
        // "this build does not say". It states what this activation MADE TRUE
        // — the check it asked for above may still have failed to start, which
        // is not something an activation reports on.
        checkDue: becameServable
      }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
    
  } catch (error) {
    console.error('Toggle question set error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Failed to toggle question set: ${error.message}` }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};