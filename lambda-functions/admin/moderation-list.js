/**
 * GET /admin/moderation — the pointer partition, oldest first (spec §6.1).
 *
 * Staff in platform mode only, and asked here as well as in the authorizer:
 * the group says WHO may look, the absence of an active organisation says they
 * are doing so AS Engage (tenant.js `canManageScope`, the same interlock that
 * gates writes to the shared library). A pointer row carries no question text
 * by design (§3.2), so this response never needs decrypting.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const tenant = require('./shared/tenant');
const { listQueue } = require('./shared/moderation-queue');

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = () => process.env.TABLE_NAME;
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Engage-Org', 'Access-Control-Allow-Methods': 'GET,OPTIONS', 'Content-Type': 'application/json' };
const json = (statusCode, body) => ({ statusCode, headers: cors, body: JSON.stringify(body) });

const project = (row) => ({
  sk: row.SK,
  orgId: row.orgId || '',
  orgName: row.orgName || '',
  setId: row.setId || '',
  title: row.title || '',
  version: row.version || 0,
  gameType: row.gameType || '',
  questionCount: row.questionCount || 0,
  reasons: Array.isArray(row.reasons) ? row.reasons : [],
  bands: row.bands && typeof row.bands === 'object' ? row.bands : {},
  uncertainQuestionIds: Array.isArray(row.uncertainQuestionIds) ? row.uncertainQuestionIds : [],
  // What a check escalation was for. An appeal carries none, and neither does a
  // row written before the check named them; the queue's words then read as before.
  checkReasons: Array.isArray(row.checkReasons) ? row.checkReasons : [],
  declaredNotice: Array.isArray(row.declaredNotice) ? row.declaredNotice : [],
  appealMessage: row.appealMessage || '',
  reports: row.reports && typeof row.reports === 'object' ? row.reports : null,
  waitingSince: row.waitingSince || null,
  latestAt: row.latestAt || null,
  publicSetId: row.publicSetId || '',
});

exports.handler = async (event) => {
  const method = event.requestContext?.http?.method || event.httpMethod;
  if (method === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (!tenant.canManageScope(event, tenant.PLATFORM, '')) {
    return json(403, { error: 'The moderation queue is for Engage staff acting as Engage.' });
  }
  try {
    const rows = await listQueue(db, TABLE());
    const items = rows.map(project);
    return json(200, { items, count: items.length, oldestWaitingSince: items.length ? items[0].waitingSince : null });
  } catch (error) {
    console.error('❌ moderation list failed:', error);
    return json(500, { error: `Could not read the queue: ${error.message}` });
  }
};
