/**
 * A SESSION'S ID SECRET, for ids that must not be traceable to a name.
 *
 * An idea's id (the Ideas pick) and a late item's ref are derived from the
 * row's sort key, and that key ends in the player's name
 * (`FOLLOWUP#nnn#ASK#<id>#A#<player>`, `QUESTION#nnn#LATE#<player>`). A plain
 * hash of it is traceable: a host holding the roster hashes each name and
 * matches, which undoes a round that hid names (late items Task 3 review).
 * So the id is an HMAC-SHA256 under a per-session random secret, METADATA
 * `IdSecret` (32 random bytes, base64), created lazily with `if_not_exists`
 * the first time anything needs it, so two racing callers agree on one.
 *
 * NEVER SENT TO ANY CLIENT. No route returns METADATA wholesale; the routes
 * that read it pick fields (tests/late-review.js and the state suites assert
 * no reply carries it).
 *
 * NOT ENCRYPTED AT REST, deliberately: it protects the names in the sort
 * keys, which are themselves plaintext at rest. Anyone who can read the table
 * reads the names directly; sealing the secret would buy nothing.
 *
 * Ids made before this (plain sha256) no longer match: a pick made on a
 * session running across the deploy cannot be taken down by its old id.
 */
const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const crypto = require('crypto');

const isSecret = (s) => typeof s === 'string' && s.length >= 32;

/**
 * The session's secret: METADATA's if `meta` already carries it, otherwise
 * created (or, if another call won the race, read) with one conditional write.
 */
async function sessionIdSecret(db, gameId, meta = null) {
  if (meta && isSecret(meta.IdSecret)) return meta.IdSecret;
  const res = await db.send(new UpdateCommand({
    TableName: process.env.TABLE_NAME,
    Key: { PK: `GAME#${gameId}`, SK: 'METADATA' },
    UpdateExpression: 'SET #s = if_not_exists(#s, :s)',
    ConditionExpression: 'attribute_exists(SK)',
    ExpressionAttributeNames: { '#s': 'IdSecret' },
    ExpressionAttributeValues: { ':s': crypto.randomBytes(32).toString('base64') },
    ReturnValues: 'ALL_NEW',
  }));
  const secret = res && res.Attributes && res.Attributes.IdSecret;
  if (!isSecret(secret)) throw new Error('id-secret: no IdSecret on METADATA');
  return secret;
}

/** A 12-hex id for a sort key, keyed by the session's secret. */
function keyedId(secret, sk) {
  if (!isSecret(secret)) throw new Error('id-secret: a session secret is required');
  return crypto.createHmac('sha256', secret).update(String(sk)).digest('hex').slice(0, 12);
}

module.exports = { sessionIdSecret, keyedId };
