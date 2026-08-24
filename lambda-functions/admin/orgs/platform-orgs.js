/**
 * THE PLATFORM'S VIEW OF EVERY ORGANISATION — and the only powers Engage staff
 * have over one.
 *
 * ── WHAT THIS DELIBERATELY CANNOT DO ───────────────────────────────────────
 *
 * It lists organisations. It cannot read one's question sets, sessions,
 * answers or reports, and there is no route from here that can. That absence is
 * the isolation guarantee expressed as an API rather than as a promise: after
 * the split, `tenant.canManageScope` gives a platform admin no scope inside any
 * organisation, so there is nothing for a "view their content" link to call.
 *
 * What staff CAN do is administrative and lands on the org's own index row:
 * approve one that is waiting, suspend one that is abusing the service, and
 * lift that suspension. Each is a change to `status` and nothing else.
 *
 * ── WHY IT READS THE INDEX AND NOT THE ORGANISATIONS ───────────────────────
 *
 * `ORGS / ORG#{orgId}` denormalises name, plan, type, status and createdAt for
 * exactly this screen. Opening each `ORG#{id}/METADATA` instead would be a
 * fan-out on the staff console's landing page, and would give staff a habit of
 * reaching into tenant partitions for something a summary already answers.
 *
 * Member counts ARE a query per organisation, and that is a real cost this
 * accepts: the count is the number people actually want ("is this a team or one
 * person?"), it cannot be kept accurate on a denormalised counter without a
 * transaction on every join and leave, and this list is read by a handful of
 * staff rather than by every host on every page. If it ever becomes slow, the
 * fix is a counter maintained by the same stream consumer that keeps usage —
 * not a scan.
 */
const { QueryCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const G = require('./shared/org-guards');
const tenant = require('../shared/tenant');

/** The statuses an organisation can be in, and who may move it between them. */
const STATUSES = ['pending', 'active', 'suspended'];

/**
 * Engage staff, and nothing less.
 *
 * Note this is the PLATFORM group, never an org role: being the owner of one
 * organisation must not let you list or suspend anybody else's. That is the
 * distinction `isPlatformAdmin` exists for, and the reason `isAdminCaller` was
 * split in two.
 */
function requirePlatformAdmin(event) {
  if (!tenant.isPlatformAdmin(event)) {
    return G.fail(403, 'This is an Engage staff screen.');
  }
  return null;
}

async function memberCount(orgId) {
  const res = await G.db.send(new QueryCommand({
    TableName: G.tableName(),
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: { ':pk': tenant.orgPk(orgId), ':sk': 'MEMBER#' },
    Select: 'COUNT',
  }));
  return res.Count || 0;
}

async function listOrgs(event) {
  const refusal = requirePlatformAdmin(event);
  if (refusal) return refusal;

  const res = await G.db.send(new QueryCommand({
    TableName: G.tableName(),
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: { ':pk': tenant.ORGS_INDEX_PK },
  }));

  const rows = (res && res.Items) || [];
  const orgs = await Promise.all(rows.map(async (row) => {
    const orgId = G.clean(row.orgId) || G.clean(row.SK).replace(/^ORG#/, '');
    return {
      orgId,
      name: G.clean(row.name),
      plan: G.clean(row.plan) || 'free',
      type: G.clean(row.type) || 'team',
      status: G.clean(row.status) || 'active',
      createdAt: row.createdAt || null,
      members: await memberCount(orgId),
    };
  }));

  /* Teams before personal spaces, then newest first. A staff list dominated by
     one-person homes buries the customers, and the homes are the majority by
     construction — every account has one. */
  orgs.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'team' ? -1 : 1;
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  });

  return G.json(200, {
    orgs,
    counts: {
      teams: orgs.filter((o) => o.type === 'team').length,
      personal: orgs.filter((o) => o.type === 'personal').length,
      suspended: orgs.filter((o) => o.status === 'suspended').length,
      pending: orgs.filter((o) => o.status === 'pending').length,
    },
  });
}

async function setStatus(event) {
  const refusal = requirePlatformAdmin(event);
  if (refusal) return refusal;

  const orgId = G.clean(event?.pathParameters?.orgId);
  if (!G.isOrgId(orgId)) return G.fail(400, 'That is not an organisation id.');

  /* `parseBody` returns the OBJECT, or null when the body is not JSON — it does
     not return a {value, error} pair, and reading `.value` off it made every
     well-formed request look like it carried no status at all. */
  const body = G.parseBody(event);
  if (body === null) return G.fail(400, 'That request body is not JSON.');
  const status = G.clean(body.status).toLowerCase();
  if (!STATUSES.includes(status)) {
    return G.fail(400, `Status must be one of: ${STATUSES.join(', ')}.`);
  }

  /*
    A PERSONAL SPACE CANNOT BE SUSPENDED FROM HERE.

    Suspending somebody's own home is not an account action, it is an account
    DELETION with a friendlier name: the home cannot be left, cannot be deleted
    by its owner, and holds everything they have ever made. If an individual has
    to be stopped, the lever is their Cognito account on the Accounts screen,
    which is reversible, visible to them, and already exists.
  */
  const meta = await G.getOrgMetadata(orgId);
  if (!meta) return G.fail(404, 'No such organisation.');
  if (G.isPersonalOrg(meta) && status === 'suspended') {
    return G.fail(409, "A personal space cannot be suspended. Disable the account instead.");
  }

  const now = new Date().toISOString();
  const actor = G.callerSub(event);

  /* Written to BOTH rows: METADATA is what every org-scoped guard reads, and
     the index row is what this screen reads. One without the other is an
     organisation that looks suspended to staff and works fine for its members,
     or the reverse — both are worse than either state alone. */
  for (const Key of [
    { PK: tenant.orgPk(orgId), SK: 'METADATA' },
    { PK: tenant.ORGS_INDEX_PK, SK: tenant.orgPk(orgId) },
  ]) {
    await G.db.send(new UpdateCommand({
      TableName: G.tableName(),
      Key,
      UpdateExpression: 'SET #s = :s, statusChangedAt = :t, statusChangedBy = :a',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: { ':s': status, ':t': now, ':a': actor },
    }));
  }

  console.log(`platform: ${actor} set ${orgId} to ${status}`);
  return G.json(200, { orgId, status, changedAt: now });
}

exports.handler = async (event) => {
  const method = event?.requestContext?.http?.method;
  if (method === 'OPTIONS') return G.handlePreflight();
  if (method === 'GET') return listOrgs(event);
  if (method === 'POST') return setStatus(event);
  return G.fail(404, 'Endpoint not found');
};

exports.STATUSES = STATUSES;
