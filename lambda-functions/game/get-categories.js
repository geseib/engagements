const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { resolvePartitionFromMeta, findSetMetadata, setRef } = require('./set-version');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

exports.handler = async (event) => {
  try {
    const { setId } = event.pathParameters || {};
    // Optional pin. A host previewing the categories of a specific version
    // passes ?version=2; everyone else gets the set's activeVersion, and an
    // unmigrated set falls through to its legacy partition.
    const requestedVersion = (event.queryStringParameters || {}).version;
    // WHICH LIBRARY. A setId is a slug and names one set PER SCOPE, so the
    // caller may say which one it means (`?scope=org`); when it does not, the
    // search below tries the caller's own org first, then platform, then public.
    const requestedScope = (event.queryStringParameters || {}).scope;

    if (!setId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Question set ID is required' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    console.log(`Getting categories for question set: ${setId}`);

    // Search only the scopes this caller may READ (tenant.readableScopes via
    // set-version.js). Another organisation's partition is never probed, so
    // their set is not forbidden here, it is absent — and this route answers
    // for it exactly as it answers for a set that was never created: an empty
    // category list. That is deliberate. A 403 would confirm the set exists,
    // and whether org B has a `teamretro` is not org A's business.
    //
    // An unfound set also keeps the pre-tenancy behaviour of this route, which
    // never 404'd either.
    const found = await findSetMetadata(
      db, process.env.TABLE_NAME, event, setId, requestedScope
    );
    const resolved = resolvePartitionFromMeta(
      found ? found.ref : setRef(setId),
      found ? found.item : undefined,
      requestedVersion
    );
    console.log(`📚 set ${resolved.scope}/${setId}: reading ${resolved.pk} (${resolved.source})`);

    // Query all categories in the resolved version of the set
    const result = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': resolved.pk,
        ':sk': 'CATEGORY#'
      }
    }));

    const categoryItems = result.Items || [];
    
    // Format categories as expected by frontend
    const categories = categoryItems.map(category => ({
      id: category.SK.replace('CATEGORY#', ''),
      name: category.Name,
      description: category.Description,
      active: true,
      questionCount: category.QuestionCount || 0
    }));

    console.log(`Found ${categories.length} categories for set ${setId}:`, categories);

    return {
      statusCode: 200,
      body: JSON.stringify({
        categories: categories,
        totalCategories: categories.length,
        // Which version answered, so a caller can tell "this set has no
        // categories" apart from "you asked for a version that is gone".
        version: resolved.version,
        versionSource: resolved.source,
        // Which library answered, so a client can round-trip the PAIR rather
        // than the id alone on the next call.
        scope: resolved.scope,
        orgId: resolved.orgId || null
      }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };

  } catch (error) {
    console.error('Get categories error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Failed to get categories: ${error.message}` }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};