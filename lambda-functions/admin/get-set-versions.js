const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');
const {
  queryPartition,
  toVersion,
  versionList,
} = require('./shared/set-version');
const { findSetForCaller, requestedScope } = require('./shared/question-set-access');
const tenant = require('./shared/tenant');
const { readReviews, publishedKey, isUnfinished } = require('./shared/set-review');
const { measurementOf } = require('./shared/review-card');

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

    /*
      THE REVIEW STATE, PER VERSION. Read from its own row rather than from the
      entry, because the entry lives in an array that `delete-set-version.js`
      rewrites wholesale — see admin/shared/set-review.js for why that is not a
      safe home for an approval.

      A version with no row reads as `unreviewed`, which is what a version
      nobody has checked is. `readReviews` answers for every version asked
      about, so there is no gap for the projection below to defend against.
    */
    const reviews = await readReviews(db, tableName, found.ref, entries.map((e) => e.version));

    /*
      MAY THIS CALLER SEE WHAT THE CHECK MEASURED?

      A status and a decision note are what every reader of a set gets, and that
      is unchanged. The MEASUREMENT — the per-category tally, and every band the
      check saw named by the question it saw it on — is the author's own account
      of their own content, and it goes to the library the row is really in:

        org        this organisation's members. `findSetForCaller` only ever
                   probes the CALLER's org partition, so another organisation's
                   set was already absent rather than forbidden; asking the
                   scope again is the second lock, and the one that survives a
                   later change to how a set is found.
        platform   Engage acting as Engage — the authors of the shared library.
                   `canManageScope` requires the `admins` group AND no active
                   organisation, so staff standing inside a customer get exactly
                   what that customer gets and nothing more.
        public     nobody. A public copy is somebody's published set; the staff
                   score card is where its measurement is read.

      A reader outside that gets no field AT ALL rather than an empty one: an
      absent tally means "not measured", and handing a reader who may not see it
      the same answer would quietly teach them to read "nothing was found".
    */
    const mayReadMeasurement = tenant.canManageScope(event, found.ref.scope, found.ref.orgId);

    // WHERE EACH VERSION WENT. One GetItem per version: this is the editor's
    // Versions panel, not the list, and a set has a handful of versions.
    const published = new Map();
    for (const e of entries) {
      const res = await db.send(new GetCommand({ TableName: tableName, Key: publishedKey(found.ref, e.version) })); // eslint-disable-line no-await-in-loop
      published.set(e.version, res && res.Item
        ? { publicSetId: res.Item.publicSetId, publicVersion: res.Item.publicVersion, at: res.Item.at }
        : null);
    }

    const versions = entries.map((entry) => {
      const review = reviews.get(entry.version) || {};
      const measured = mayReadMeasurement ? measurementOf(review) : null;
      return {
        version: entry.version,
        createdAt: entry.createdAt || null,
        questionCount: entry.questionCount || 0,
        categoryCount: entry.categoryCount || 0,
        sourceFile: entry.sourceFile || '',
        note: entry.note || '',
        isActive: entry.version === activeVersion,
        /*
          PROJECTED EXPLICITLY, like every other field here. This map is a
          whitelist: a field not named on it does not reach the client however
          faithfully it is stored, which is why adding the row was only half the
          work.
        */
        review: review.status || 'unreviewed',
        reviewFindings: review.findings || [],
        checkedAt: review.checkedAt || null,
        reasons: review.reasons || [],
        reviewNote: review.note || '',
        /*
          WHAT THE CHECK MEASURED — the same projection the staff score card
          reads (shared/review-card.js measurementOf), and NOTHING ELSE OFF
          THAT ROW. The REVIEW item also carries the reviewer, when they ruled,
          the notices they attached and the snapshot key; all four are staff's,
          and none of them is named here or anywhere else in this map.

          No question TEXT beside the ids, unlike the card. The card names each
          observation because staff cannot decrypt an organisation's rows, so it
          reads the public copy instead; this function has no kms:Decrypt grant
          (and tests/kms-grants-match-code.js is what would tell you, loudly, if
          it ever reached tenant-crypto). It does not need one: the surface that
          renders this is the set editor, which is already holding the plaintext
          questions these ids name.
        */
        ...(measured ? { reviewTally: measured.tally, reviewObserved: measured.observed } : {}),
        unfinished: isUnfinished(review),
        published: published.get(entry.version) || null,
        pinnedByGames: pinnedBySet
          .filter((g) => toVersion(g.QuestionSetVersion) === entry.version)
          .map((g) => String(g.SK).replace('GAME#', ''))
          .filter((gameId) => endedByGameId.get(gameId) === false)
      };
    });

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
