const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');
const {
  queryPartition,
  toVersion,
  versionList,
} = require('./shared/set-version');
const { findSetForCaller, requestedScope } = require('./shared/question-set-access');
const tenant = require('./shared/tenant');

const dynamoClient = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(dynamoClient);

/**
 * GET /admin/question-sets/{setId}/versions
 *
 * Response body is a bare ARRAY, per the agreed contract in
 * docs/superpowers/specs/2026-08-08-question-set-versioning-design.md:
 *
 *   [{ version, createdAt, questionCount, categoryCount, sourceFile,
 *      isActive, pinnedByGames: [gameId] }]
 *
 * A set that has never been versioned returns `[]` — its content still lives in
 * the legacy `SET#<id>` partition, there is genuinely no version to list, and
 * the resolver serves it from there until a replace or the migration creates
 * one. An empty array therefore means "not versioned yet", NOT "broken".
 *
 * `pinnedByGames` lists only games that have NOT ended. An ended game never
 * reads its set again, so warning about it would be noise; the point of the
 * field is to tell the operator which live sessions a delete would strand.
 */
exports.handler = async (event) => {
  const headers = { 'Access-Control-Allow-Origin': '*' };
  const tableName = process.env.TABLE_NAME;
  const setId = event.pathParameters?.setId;

  try {
    if (!setId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Set ID is required' }), headers };
    }

    // A READ, so the guard is READABILITY: `findSetForCaller` probes only the
    // caller's own org, platform and public, so another organisation's set is
    // absent and this 404s on it. requireSetManager would be the WRONG guard
    // here — no org user may manage a platform set, and every org is meant to
    // be able to read the shared library.
    const found = await findSetForCaller(db, tableName, event, setId, requestedScope(event));
    const meta = found && found.item;
    if (!meta) {
      return { statusCode: 404, body: JSON.stringify({ error: 'Question set not found' }), headers };
    }

    const activeVersion = toVersion(meta.activeVersion);
    const entries = versionList(meta)
      .map((v) => ({ ...v, version: toVersion(v && v.version) }))
      .filter((v) => v.version !== null)
      .sort((a, b) => a.version - b.version);

    if (entries.length === 0) {
      return { statusCode: 200, body: JSON.stringify([]), headers };
    }

    // One paginated Query of the GAMES index partition serves every version, so
    // the cost does not multiply by version count.
    // An org's sessions are indexed in that org's own partition; the global
    // GAMES partition is the pre-tenancy index (and now the 4-digit code
    // reservation registry, which carries no set id and matches nothing).
    const gamesIndexPk = found.ref.orgId
      ? tenant.gamesIndexPk(found.ref.orgId)
      : tenant.GAMES_RESERVATION_PK;
    const { items: gameRows } = await queryPartition(db, tableName, gamesIndexPk, 'GAME#');
    // Matched on the PAIR: a session records QuestionSetScope beside
    // QuestionSetId since tenancy, and an absent scope means platform.
    const pinnedBySet = gameRows.filter((g) => g.QuestionSetId === setId
      && (String(g.QuestionSetScope || '').trim() || tenant.PLATFORM) === found.ref.scope
      && toVersion(g.QuestionSetVersion));

    // Only the pinned games need a state lookup, and each is looked up once
    // even when several versions are listed.
    const endedByGameId = new Map();
    for (const g of pinnedBySet) {
      const gameId = String(g.SK).replace('GAME#', '');
      if (endedByGameId.has(gameId)) continue;
      let state = 'EXPIRED';
      try {
        const res = await db.send(new GetCommand({
          TableName: tableName,
          Key: { PK: `GAME#${gameId}`, SK: 'STATE' }
        }));
        state = (res && res.Item && res.Item.State) || 'EXPIRED';
      } catch (e) {
        console.error(`⚠️ Could not read state for game ${gameId}: ${e.message}`);
      }
      endedByGameId.set(gameId, state === 'ENDED' || state === 'EXPIRED');
    }

    const versions = entries.map((entry) => ({
      version: entry.version,
      createdAt: entry.createdAt || null,
      questionCount: entry.questionCount || 0,
      categoryCount: entry.categoryCount || 0,
      sourceFile: entry.sourceFile || '',
      note: entry.note || '',
      isActive: entry.version === activeVersion,
      pinnedByGames: pinnedBySet
        .filter((g) => toVersion(g.QuestionSetVersion) === entry.version)
        .map((g) => String(g.SK).replace('GAME#', ''))
        .filter((gameId) => endedByGameId.get(gameId) === false)
    }));

    console.log(`📚 ${setId}: ${versions.length} version(s), active v${activeVersion ?? '-'}`);

    return { statusCode: 200, body: JSON.stringify(versions), headers };

  } catch (error) {
    console.error('Get set versions error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Failed to list versions: ${error.message}` }),
      headers
    };
  }
};
