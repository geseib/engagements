const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { requireSetManager, findSetForCaller, requestedScope } = require('./shared/question-set-access');
const { setMetadataKey } = require('./shared/set-version');

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
    
    return {
      statusCode: 200,
      body: JSON.stringify({ 
        message: `Question set ${active ? 'activated' : 'deactivated'} successfully`,
        setId: setId,
        scope: found.ref.scope,
        orgId: found.ref.orgId || null,
        active: active
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