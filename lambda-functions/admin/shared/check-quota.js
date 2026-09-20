/**
 * SUBMITS ARE A COST THE ORG CONTROLS AND ENGAGE PAYS — spec §4.2.
 *
 * One row per org per UTC day beside the usage ledger (`shared/usage.js` keys
 * the monthly ledger under the same ORG#<id> partition): `submits` is raised
 * by a CONDITIONAL add, so the cap is enforced by DynamoDB and not by a read
 * that two requests can both pass; `units` counts guardrail calls for the
 * ledger. UTC, for the reason usage.js gives: the answer must not depend on
 * which region a Lambda ran in.
 */
const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { orgPk } = require('./tenant');

const DEFAULT_DAILY_CAP = 20;
const dayOf = (now) => now.toISOString().slice(0, 10);
const key = (orgId, now) => ({ PK: orgPk(orgId), SK: `CHECKS#${dayOf(now)}` });

async function reserveSubmit(db, tableName, orgId, { cap = DEFAULT_DAILY_CAP, now = new Date() } = {}) {
  try {
    const res = await db.send(new UpdateCommand({
      TableName: tableName,
      Key: key(orgId, now),
      // `day` is a DynamoDB reserved word; alias it or the write is refused live
      // while a stub that ignores names passes it.
      UpdateExpression: 'ADD submits :one SET orgId = :org, #day = :day',
      ConditionExpression: 'attribute_not_exists(submits) OR submits < :cap',
      ExpressionAttributeNames: { '#day': 'day' },
      ExpressionAttributeValues: { ':one': 1, ':cap': cap, ':org': orgId, ':day': dayOf(now) },
      ReturnValues: 'ALL_NEW',
    }));
    return { ok: true, submits: Number((res && res.Attributes && res.Attributes.submits) || 0) };
  } catch (e) {
    if (e && e.name === 'ConditionalCheckFailedException') return { ok: false, cap };
    throw e;
  }
}
/**
 * `field` is which counter the calls land on. Engage staff re-running the check
 * on a version the public library already serves spend real guardrail calls, and
 * the spend must be recorded — but not on the organisation's own ledger, which
 * would bill them for work they never asked for and cannot see. `staffUnits`
 * keeps the record beside theirs instead of inside it. The CAP (`submits`) is
 * not touched by such a run at all: `reserveSubmit` is simply not called.
 */
const UNIT_FIELDS = Object.freeze(['units', 'staffUnits']);
async function recordUnits(db, tableName, orgId, units, { now = new Date(), field = 'units' } = {}) {
  const n = Math.max(0, Math.trunc(Number(units) || 0));
  if (!n) return;
  if (!UNIT_FIELDS.includes(field)) throw new Error(`check-quota: refusing to count units on ${JSON.stringify(field)}`);
  await db.send(new UpdateCommand({
    TableName: tableName,
    Key: key(orgId, now),
    // The counter is NAMED, not interpolated into the expression: an attribute
    // that comes from a variable can never collide with a reserved word this
    // way, which is the same trap `#day` above is dodging.
    UpdateExpression: 'ADD #counter :n',
    ExpressionAttributeNames: { '#counter': field },
    ExpressionAttributeValues: { ':n': n },
  }));
}
module.exports = { DEFAULT_DAILY_CAP, UNIT_FIELDS, reserveSubmit, recordUnits };
