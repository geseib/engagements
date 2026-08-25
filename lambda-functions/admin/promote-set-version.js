const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const {
  knownVersions,
  setPartition,
  toVersion,
  setMetadataKey,
} = require('./shared/set-version');
const { requireSetManager, findSetForCaller, requestedScope } = require('./shared/question-set-access');

const dynamoClient = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(dynamoClient);

/**
 * POST /admin/question-sets/{setId}/versions/{version}/promote
 *
 * Sets `activeVersion`. This is the rollback: every version stays on disk, so
 * undoing a bad replace is one attribute write rather than a restore.
 *
 * Games already in progress are NOT affected — they carry their own pin
 * (QuestionSetVersion on GAME#<id>/METADATA, SetVersion on each round's REF
 * row), and the resolver puts the pin ahead of activeVersion for exactly this
 * reason. Promoting changes what the NEXT game created from this set will play.
 *
 * The target partition is checked for content before the flip. Promoting to a
 * version whose rows are gone would leave every new game with an empty set that
 * ends itself on the first "next question", and the failure would look like a
 * question-selection bug rather than a bad promote.
 */
exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*' };
  const tableName = process.env.TABLE_NAME;
  const setId = event.pathParameters?.setId;
  const requested = event.pathParameters?.version;

  try {
    if (!setId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Set ID is required' }), headers };
    }

    const version = toVersion(requested);
    if (version === null) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: `"${requested}" is not a version number.` }),
        headers
      };
    }

    // WHICH LIBRARY, THEN WHO. `findSetForCaller` searches only the scopes this
    // caller may READ, so another organisation's set is ABSENT rather than
    // forbidden and this 404s on it. The row it returns carries its own scope
    // and `requireSetManager` reads it — platform sets are Engage staff's, org
    // sets are that org's, and being an Engage administrator grants nothing
    // inside an org. See shared/question-set-access.js.
    const found = await findSetForCaller(db, tableName, event, setId, requestedScope(event));
    const meta = found && found.item;
    if (!meta) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Question set not found' }), headers };
    }

    // 403 BEFORE anything is written. A version promote flips which questions
    // every future session of this set plays, and a version delete removes rows;
    // both are management of the set, gated by the same rule as editing it.
    const denied = requireSetManager(event, meta, 'promote a version of');
    if (denied) return denied;

    const known = knownVersions(meta);
    if (!known.includes(version)) {
      return {
        statusCode: 404,
        body: JSON.stringify({
          error: `Question set "${setId}" has no version ${version}.`,
          availableVersions: known,
          activeVersion: toVersion(meta.activeVersion)
        }),
        headers
      };
    }

    if (toVersion(meta.activeVersion) === version) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          promoted: false,
          setId,
          activeVersion: version,
          message: `Version ${version} is already active.`
        }),
        headers
      };
    }

    // Refuse to activate an empty partition.
    const probe = await db.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': setPartition(found.ref, version), ':sk': 'QUESTION#' },
      Limit: 1
    }));

    if (!probe.Items || probe.Items.length === 0) {
      return {
        statusCode: 409,
        body: JSON.stringify({
          error: `Version ${version} of "${setId}" has no question rows, so promoting it would produce an unplayable set.`,
          activeVersion: toVersion(meta.activeVersion)
        }),
        headers
      };
    }

    // Recorded counts follow the pointer so the admin list stops describing the
    // version that is no longer active.
    const entry = (Array.isArray(meta.versions) ? meta.versions : [])
      .find((v) => toVersion(v && v.version) === version) || {};

    await db.send(new UpdateCommand({
      TableName: tableName,
      Key: setMetadataKey(found.ref),
      // Aliased throughout — see the note in upload-questions.js.
      UpdateExpression: 'SET #activeVersion = :v, #questionCount = :qc, #categoryCount = :cc, '
        + '#sourceFile = :src, #updatedAt = :now',
      ExpressionAttributeNames: {
        '#activeVersion': 'activeVersion',
        '#questionCount': 'questionCount',
        '#categoryCount': 'categoryCount',
        '#sourceFile': 'sourceFile',
        '#updatedAt': 'updatedAt'
      },
      ExpressionAttributeValues: {
        ':v': version,
        ':qc': entry.questionCount || 0,
        ':cc': entry.categoryCount || 0,
        ':src': entry.sourceFile || meta.sourceFile || '',
        ':now': new Date().toISOString()
      }
    }));

    console.log(`⬆️ Promoted "${setId}" to v${version} (was v${toVersion(meta.activeVersion) ?? 'legacy'})`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        promoted: true,
        setId,
        activeVersion: version,
        previousVersion: toVersion(meta.activeVersion),
        message: `Version ${version} is now active for "${meta.name || setId}".`
      }),
      headers
    };

  } catch (error) {
    console.error('Promote set version error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Failed to promote version: ${error.message}` }),
      headers
    };
  }
};
