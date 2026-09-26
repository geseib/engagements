/**
 * THE FOUR-DIGIT CODE, DRAWN AND LOCKED — for a session and for an event.
 *
 * A participant types four digits knowing nothing of any organisation, so the
 * code space is one global space (tenant.js, GAMES_RESERVATION_PK). A session
 * reserves its code there; since roadmap M1 an event does too, with the same
 * lock, so an event and a session can never hold the same number
 * (docs/design/agenda-redesign/40-data-model.html).
 *
 * ── THE LOCK ───────────────────────────────────────────────────────────────
 * `claimCode` is a conditional Put on `GAMES / GAME#<code>` under
 * `attribute_not_exists(PK)` (issue #26: a colliding draw once overwrote a
 * living session row by row). A collision throws
 * ConditionalCheckFailedException before anything else is written.
 *
 * NOTHING ELSE BELONGS ON THAT ROW. It once carried a whole session brief in a
 * partition every account could Query. A session's reservation is exactly
 * `{orgId, ttl}`: `orgId` says which org's index row to clean up when the code
 * is released. An event's adds `Kind: "event"` — routing, not content — so
 * `GET /join/{code}` can tell the two apart in one read. A session writes no
 * `Kind`; absent means a session, which is also what every row written before
 * events existed means.
 *
 * ── THE DRAW: A CODE WHOSE OLD ROWS REMAIN IS NOT FREE ────────────────────
 * The reservation expires with its session or event, but other rows outlive
 * it: a session's score rows, AI summaries and report live 30 days, and
 * DynamoDB deletes lazily (up to ~48h late). A code drawn again while those
 * rows are there would inherit them (bug sweep 2026-09-26, Task 2, which put
 * this check first as step 0 of schema-compliant-manager.js createGame; it
 * lives here now so that every draw — a session's, an event's, and roadmap
 * M3's item sessions' — asks it once, in one place). So a candidate is
 * skipped while its `GAME#<code>` partition holds ANY row — and while its
 * `EVENT#<code>` partition does: an expired event's agenda must never become
 * a new event's, nor a new session's code share a number with an event
 * somebody may still open.
 *
 *   - Each check is a strongly consistent Query with Limit 1.
 *   - A row past its `ttl` but not yet deleted still counts as taken. That is
 *     deliberate: "past its ttl" is not "gone".
 *   - ORDER: check the partitions, THEN take the lock. A second creator cannot
 *     write `GAME#` or `EVENT#` rows without first winning the same `GAMES`
 *     put, so nothing can appear in a checked partition between the check and
 *     a lock this draw wins. A race can only make the check too cautious,
 *     never too permissive.
 *   - No FilterExpression (a `ttl > :now` filter would make a row past its
 *     ttl look absent — the exact bug); tests/code-reuse-isolation.js asserts
 *     the Query's shape.
 *
 * Eight draws, then CodeSpaceExhausted, which the routes answer with an
 * honest 503: eight straight collisions means the space is effectively full,
 * and creating by luck past that point would be the same bug with better odds.
 */
const { QueryCommand, PutCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { GAMES_RESERVATION_PK, eventPk } = require('./tenant');

const MAX_CODE_ATTEMPTS = 8;
const CODE_KINDS = Object.freeze(['session', 'event']);

/** A random four-digit code, 1000–9999. */
const drawCode = () => Math.floor(1000 + Math.random() * 9000).toString();

class CodeSpaceExhausted extends Error {
  constructor(attempts) {
    super(`no free four-digit code after ${attempts} draws`);
    this.name = 'CodeSpaceExhausted';
    this.attempts = attempts;
  }
}

const reservationKey = (code) => ({ PK: GAMES_RESERVATION_PK, SK: `GAME#${code}` });

async function partitionHoldsRows(db, tableName, pk) {
  const res = await db.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: { ':pk': pk },
    Limit: 1,
    ConsistentRead: true,
  }));
  return Boolean(res && Array.isArray(res.Items) && res.Items.length);
}

/** Does anything — a session's rows or an event's — still live under this code? */
async function codeHasRows(db, tableName, code) {
  if (await partitionHoldsRows(db, tableName, `GAME#${code}`)) return true;
  return partitionHoldsRows(db, tableName, eventPk(code));
}

/**
 * THE LOCK. Throws ConditionalCheckFailedException when the code is held.
 * @param {{code: string, orgId?: string, ttl: number, kind?: 'session'|'event', tableName?: string}} spec
 */
async function claimCode(db, {
  code, orgId = '', ttl, kind = 'session', tableName = process.env.TABLE_NAME,
} = {}) {
  if (!CODE_KINDS.includes(kind)) throw new Error(`code-reservation: unknown kind ${JSON.stringify(kind)}`);
  if (!Number.isFinite(ttl)) throw new Error('code-reservation: a ttl (epoch seconds) is required');
  const org = typeof orgId === 'string' ? orgId.trim() : '';
  await db.send(new PutCommand({
    TableName: tableName,
    ConditionExpression: 'attribute_not_exists(PK)',
    Item: {
      ...reservationKey(code),
      ...(org ? { orgId: org } : {}),
      ...(kind === 'event' ? { Kind: 'event' } : {}),
      ttl,
    },
  }));
}

/** Give a code back. Only ever for a create that failed after its own claim. */
async function releaseCode(db, { code, tableName = process.env.TABLE_NAME } = {}) {
  await db.send(new DeleteCommand({ TableName: tableName, Key: reservationKey(code) }));
}

/**
 * Draw codes until one is free and claimed, and return it.
 *
 * `claim(code)` is what takes the lock. The default is `claimCode` with this
 * call's `orgId`, `ttl` and `kind` — what an event create uses. A session
 * create passes its own: `createGame(code, …)`, whose FIRST write is
 * `claimCode`, so the lock and the session's rows stay one operation with one
 * release path (schema-compliant-manager.js). Either way a
 * ConditionalCheckFailedException means "lost the race, draw again"; any
 * other error is not this loop's to swallow and propagates.
 *
 * @returns {Promise<string>} the code
 * @throws {CodeSpaceExhausted} after `attempts` draws found nothing free
 */
async function reserveCode(db, {
  orgId = '', ttl, kind = 'session', claim = null, draw = drawCode,
  attempts = MAX_CODE_ATTEMPTS, tableName = process.env.TABLE_NAME,
} = {}) {
  const take = claim || ((code) => claimCode(db, { code, orgId, ttl, kind, tableName }));
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const code = String(draw());
    if (await codeHasRows(db, tableName, code)) {
      console.warn(`⚠️ code ${code} still has rows — drawing again (${attempt}/${attempts})`);
      continue;
    }
    try {
      await take(code);
      return code;
    } catch (error) {
      if (error && error.name === 'ConditionalCheckFailedException') {
        console.warn(`⚠️ code ${code} is already reserved — drawing again (${attempt}/${attempts})`);
        continue;
      }
      throw error;
    }
  }
  throw new CodeSpaceExhausted(attempts);
}

module.exports = {
  MAX_CODE_ATTEMPTS, CODE_KINDS, CodeSpaceExhausted,
  drawCode, codeHasRows, claimCode, releaseCode, reserveCode,
};
