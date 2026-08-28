/**
 * QUESTIONS THE HOST HAS SWITCHED OFF FOR THIS SESSION —
 * `GET`/`POST /games/{gameId}/exclusions`.
 *
 * The owner's fourth queue verb: "move up/move down/disable/move back out of
 * the immediate queue". "Move back out" already existed (removing from the
 * queue returns a question to the automatic walk); DISABLE did not — there was
 * no way to say "never ask this one" short of turning off its whole category.
 *
 * One row, PK=GAME#<id> / SK='EXCLUDED', holding canonical question keys. It
 * is honoured by UNION WITH THE ASKED SET — next-question.js and up-next.js
 * both fold these keys into the already-asked set they filter on — because
 * that is the one mechanism the serve and the preview already share, and a
 * second bespoke filter would be a second chance for the two to disagree
 * (the bug class this repo calls "a screen that lies").
 *
 * THE SAME OP DESIGN AS THE QUEUE, for the same two-surfaces reason
 * (question-queue.js's header carries the full argument): the client sends
 * `{ op, questionKey, expectedVersion }`, the op is replayed against the list
 * this handler just read, and a lost race re-reads and re-applies the OP,
 * never the array. expectedVersion is advisory, exactly as the queue's is.
 *
 * DISABLING A QUEUED QUESTION IS THE CLIENT'S TWO CALLS (queue remove, then
 * exclusion add), not a compound op here — each half is independently safe,
 * a half-done pair leaves the question visible in the auto plan for a second
 * press, and the drain defends anyway: an excluded key that somehow stays
 * queued is dropped at drain time like an already-asked one.
 *
 * NO CAP. The queue's 24 is a running order's size; this is a veto list, and
 * refusing the 25th veto would force a host to un-veto something to veto
 * another. Normalisation still dedupes and drops junk.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient, GetCommand, UpdateCommand,
} = require('@aws-sdk/lib-dynamodb');

const { normaliseQueue } = require('./queue-order');
const { callerMayDriveSession } = require('./tenant');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

// The session's own lifetime — the same 90 days the QUEUE row rides, for the
// same reason: a veto made while planning a session must survive to the day
// the session runs. tests/question-exclusions.js pins this against
// question-queue.js's copy.
const TTL_CREATION_PHASE = 90 * 24 * 60 * 60;

const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = Number(process.env.QUEUE_RETRY_BASE_MS || 100);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const respond = (statusCode, body) => ({
  statusCode,
  body: JSON.stringify(body),
  headers: { 'Access-Control-Allow-Origin': '*' },
});

const rowKey = (gameId) => ({ PK: `GAME#${gameId}`, SK: 'EXCLUDED' });

const project = (item) => ({
  excluded: normaliseQueue(item && item.Keys),
  version: Number(item && item.Version) || 0,
  updatedAt: (item && item.UpdatedAt) || null,
});

/** The two ops, closed exactly as QUEUE_OPS is and refused as loudly. */
const EXCLUSION_OPS = ['add', 'remove'];

/**
 * Pure, so tests/question-exclusions.js can drive it as arithmetic. Identity
 * contract matches queue-order.js: a no-op returns the array it was given.
 */
const applyExclusionOp = (keys, { op, questionKey }) => {
  const list = normaliseQueue(keys);
  const key = normaliseQueue([questionKey])[0];
  if (!key) return { keys: list, changed: false, refused: 'no-key' };

  if (op === 'add') {
    if (list.includes(key)) return { keys: list, changed: false, refused: 'duplicate' };
    return { keys: [...list, key], changed: true, refused: null };
  }
  if (op === 'remove') {
    const at = list.indexOf(key);
    if (at === -1) return { keys: list, changed: false, refused: 'not-excluded' };
    const next = list.slice();
    next.splice(at, 1);
    return { keys: next, changed: true, refused: null };
  }
  return { keys: list, changed: false, refused: 'unknown-op' };
};

exports.handler = async (event) => {
  const method = event.requestContext?.http?.method || event.httpMethod;
  if (method === 'OPTIONS') return respond(200, {});

  const { gameId } = event.pathParameters || {};
  if (!gameId) return respond(400, { error: 'gameId is required' });

  try {
    /*
      WHOSE ROOM IS THIS? Both events carry the Cognito authorizer, which says
      the caller is *a* host and not that they are THIS session's host — so the
      boundary was "any `hosts` account plus one of the 9,000 four-digit ids".

      Once, above the method split, exactly as in question-queue.js: the veto
      list names unasked questions on the way out, and adds to them on the way
      in. One GetItem; 404 rather than 403 — see tenant.callerMayDriveSession.
    */
    const ownerRead = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'METADATA' },
      ProjectionExpression: 'orgId'
    }));
    if (!callerMayDriveSession(event, ownerRead.Item || {})) {
      return respond(404, { error: 'Game not found' });
    }

    if (method === 'GET') {
      const current = await db.send(new GetCommand({
        TableName: process.env.TABLE_NAME, Key: rowKey(gameId),
      }));
      // No row is an empty veto list at version 0, never a 404 — the panel
      // renders before the host has disabled anything.
      return respond(200, { gameId, ...project(current.Item) });
    }

    if (method !== 'POST') return respond(405, { error: `${method} is not supported` });

    let body = {};
    try {
      body = JSON.parse(event.body || '{}') || {};
    } catch {
      return respond(400, { error: 'Body must be JSON' });
    }

    const { op, expectedVersion } = body;
    const key = body.questionKey ?? body.questionId ?? body.key;

    if (!EXCLUSION_OPS.includes(op)) {
      return respond(400, { error: `op must be one of: ${EXCLUSION_OPS.join(', ')}` });
    }
    if (!String(key ?? '').trim()) {
      return respond(400, { error: 'questionKey is required' });
    }

    let staleView = false;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const current = await db.send(new GetCommand({
        TableName: process.env.TABLE_NAME, Key: rowKey(gameId),
      }));

      const item = current.Item;
      const keys = normaliseQueue(item && item.Keys);
      const version = Number(item && item.Version) || 0;

      if (expectedVersion !== undefined && expectedVersion !== null
        && Number(expectedVersion) !== version) {
        staleView = true;
      }

      const result = applyExclusionOp(keys, { op, questionKey: key });

      if (!result.changed) {
        return respond(200, {
          gameId, ...project(item), changed: false, refused: result.refused, staleView,
        });
      }

      const now = new Date().toISOString();
      const nextVersion = version + 1;

      try {
        await db.send(new UpdateCommand({
          TableName: process.env.TABLE_NAME,
          Key: rowKey(gameId),
          UpdateExpression: 'SET #keys = :keys, #version = :next, #updatedAt = :now, #ttl = :ttl',
          ConditionExpression: 'attribute_not_exists(#version) OR #version = :expected',
          ExpressionAttributeNames: {
            '#keys': 'Keys', '#version': 'Version', '#updatedAt': 'UpdatedAt', '#ttl': 'ttl',
          },
          ExpressionAttributeValues: {
            ':keys': result.keys,
            ':next': nextVersion,
            ':expected': version,
            ':now': now,
            ':ttl': Math.floor(Date.now() / 1000) + TTL_CREATION_PHASE,
          },
        }));

        return respond(200, {
          gameId, excluded: result.keys, version: nextVersion, updatedAt: now,
          changed: true, refused: null, staleView,
        });
      } catch (error) {
        if (error.name !== 'ConditionalCheckFailedException') throw error;
        console.log(`🔁 EXCLUSIONS: version ${version} was taken for game ${gameId}; re-reading (attempt ${attempt}/${MAX_ATTEMPTS})`);
        if (attempt === MAX_ATTEMPTS) {
          return respond(409, {
            error: 'The disabled list was being changed elsewhere; try again',
            gameId, attempts: MAX_ATTEMPTS,
          });
        }
        await sleep(RETRY_BASE_MS * attempt);
      }
    }

    return respond(409, { error: 'The disabled list could not be updated', gameId });
  } catch (error) {
    console.error('❌ Question exclusions error:', error);
    return respond(500, { error: 'Failed to read or change the disabled questions' });
  }
};

// For the tests that drive the op as arithmetic and pin the TTL to the queue's.
exports.applyExclusionOp = applyExclusionOp;
exports.TTL_CREATION_PHASE = TTL_CREATION_PHASE;
