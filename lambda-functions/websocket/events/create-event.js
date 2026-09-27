/**
 * POST /events — a new event, its code reserved, its agenda empty.
 * docs/design/agenda-redesign/05-new-event.html; roadmap M1.
 *
 * Refused, in this order:
 *   - while EVENTS_ENABLED is off on this tier (404, roadmap D6);
 *   - with no organisation to act for (403, tenant.requireOrg);
 *   - details that do not check out (400, agenda-rules.checkEventFields);
 *   - from an organisation on Free (402 plus the upgrade body session
 *     creation uses). Events are a paid feature: the Standard plan (a
 *     person's own space) or the Organisation plan (a team), and ANY member
 *     may create one there — a host as much as an admin (the owner, 27 Sep
 *     2026: "the host should be able to create events as well, if they are on
 *     a pay plan"). Each event costs $2.00, counted when it first goes live
 *     (run.js, usage.recordBillableEvent). An organisation whose plan cannot
 *     be read is NOT refused — `readAllowance` fails open for sessions and
 *     this follows it: a DynamoDB blip must not read as "you are on the wrong
 *     plan".
 *
 * The session create gate (mustUpgradeForSession) is not asked separately:
 * both paid plans meter and are never gated (pricing.js metersOverage), and
 * Free is refused above.
 *
 * WRITES, in order: the code (code-reservation.js, `Kind: "event"`), the
 * organisation's list row, the METADATA row. Title and Place are sealed on
 * both rows. All three carry the same `ttl` (agenda-rules.eventTtl). A failure
 * after the code is taken removes the list row and gives the code back, so a
 * failed create leaves nothing behind — the session manager's rule.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const tenant = require('../tenant');
const { encryptItem } = require('../tenant-crypto');
const { reserveCode, releaseCode, CodeSpaceExhausted } = require('../code-reservation');
const { readAllowance } = require('../usage');
const { upgradeRequired, UPGRADE_REQUIRED_STATUS } = require('../pricing');
const { planLimitResolve } = require('../plan-limit');
const rules = require('./agenda-rules');
const { json, readBody, trace, callerSub, eventsEnabled } = require('./event-http');
const { META_SK, indexSk, projectEvent } = require('./event-store');

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = () => process.env.TABLE_NAME;

exports.handler = async (request) => {
  trace('create-event', request);
  if (!eventsEnabled()) {
    return json(404, { error: 'Events are not switched on here yet.', code: 'events_disabled' });
  }
  const refused = tenant.requireOrg(request);
  if (refused) return refused;
  const orgId = tenant.callerOrgId(request);

  const body = readBody(request);
  if (!body) return json(400, { error: 'The request body is not valid JSON.' });
  const nowSeconds = Math.floor(Date.now() / 1000);
  const checked = rules.checkEventFields(body, { nowSeconds });
  if (checked.error) return json(400, { error: checked.error });
  const v = checked.value;

  try {
    const allowance = await readAllowance(orgId);
    if (allowance.allowsEvents === false) {
      return json(UPGRADE_REQUIRED_STATUS, {
        ...upgradeRequired('events', allowance),
        resolve: await planLimitResolve(request, allowance),
      });
    }

    const ttl = rules.eventTtl(v.startsAt, nowSeconds);
    let code;
    try {
      code = await reserveCode(db, { orgId, ttl, kind: 'event' });
    } catch (error) {
      if (error instanceof CodeSpaceExhausted) {
        return json(503, { error: 'Could not find a free event code. Try again in a moment.' });
      }
      throw error;
    }

    const now = new Date(nowSeconds * 1000).toISOString();
    const shared = {
      orgId,
      Title: v.title,
      Place: v.place,
      StartsAt: v.startsAt,
      TimeZone: v.timeZone,
      Access: v.access,
      State: 'SCHEDULED',
      ItemCount: 0,
      ttl,
    };
    const listRow = { PK: tenant.eventsIndexPk(orgId), SK: indexSk(code), ...shared };
    const metaRow = {
      PK: tenant.eventPk(code),
      SK: META_SK,
      ...shared,
      EngagementCount: 0,
      BreakCount: 0,
      AttendeeReports: v.attendeeReports,
      CreatedBy: callerSub(request),
      CreatedAt: now,
      UpdatedAt: now,
    };

    let listed = false;
    try {
      // No condition on the list row: the code is ours (the lock is held and
      // its EVENT# partition was empty), so a leftover list row for the same
      // code — possible only while DynamoDB is still reaping an old one — is
      // simply replaced.
      await db.send(new PutCommand({ TableName: TABLE(), Item: await encryptItem(orgId, 'event', listRow) }));
      listed = true;
      await db.send(new PutCommand({
        TableName: TABLE(),
        Item: await encryptItem(orgId, 'event', metaRow),
        ConditionExpression: 'attribute_not_exists(PK)',
      }));
    } catch (error) {
      console.error(`❌ create-event: writing event ${code} failed; releasing the code:`, error && error.message);
      try {
        if (listed) {
          await db.send(new DeleteCommand({ TableName: TABLE(), Key: { PK: listRow.PK, SK: listRow.SK } }));
        }
        await releaseCode(db, { code });
      } catch (releaseError) {
        console.error(`❌ create-event: could not release ${code}:`, releaseError && releaseError.message);
      }
      return json(500, { error: 'Could not create the event. Nothing was kept; try again.' });
    }

    return json(201, { event: projectEvent(metaRow) });
  } catch (error) {
    console.error('❌ create-event failed:', error && error.message);
    return json(500, { error: 'Could not create the event. Try again.' });
  }
};
