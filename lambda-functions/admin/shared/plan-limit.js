/**
 * WHO CAN FIX A PLAN-LIMIT REFUSAL — the `resolve` block on every 402.
 *
 * A refusal already says WHAT ran out (`limit`) and what the Team plan costs
 * (`upgrade`, pricing.js:upgradeRequired). It did not say what THIS person can
 * do about it, so every screen told everybody to "request the Team plan" —
 * which only an owner may do (plan-requests.js authorises that route 'owner').
 * This block is the rest of the answer, worked out here from the caller's role
 * so no screen has to guess a role from local state
 * (docs/design/tenancy-redesign/22-plan-limit-notice.html):
 *
 *   role            'owner' | 'admin' | 'member'
 *   canRequest      owner only
 *   canViewBilling  owner or admin (consoleSections.js gives members no Billing)
 *   org             { name, type }
 *   contacts        whom to ask: nobody for an owner; the owners for an admin;
 *                   owners then admins for a member — never other members,
 *                   never the caller. `{ name, email, role }`, the same people
 *                   and addresses list-members.js already shows any member.
 *   request         the Team-plan request waiting for Engage, if any:
 *                   `{ requestedAt, requestedBy }` (a name), else null
 *   resetsOn        'YYYY-MM-DD', the 1st of next month, when sessions start
 *                   again (sets do not reset — they are a level, not an event)
 *
 * CALLED ONLY ON THE REFUSAL PATH. It costs two queries, and a create that
 * succeeds must pay nothing for the wording of a refusal it never received.
 *
 * IT NEVER THROWS. This is the helpful half of a 402; if the member or request
 * lookup fails, the refusal still goes out with the role and without names.
 * Turning "not yet, and here is why" into a 500 would be strictly worse.
 *
 * DUPLICATED byte for byte at lambda-functions/admin/shared/plan-limit.js and
 * lambda-functions/websocket/plan-limit.js (CodeUri is per-directory and there
 * are no layers: websocket/ refuses sessions, admin/ refuses sets). Pinned by
 * tests/plan-limit-resolve.js.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { callerOrgRole, orgPk } = require('./tenant');

const defaultDb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const ROLE_ORDER = { owner: 0, admin: 1 };

/** The caller's user id, from the Lambda authorizer or a JWT claim. */
function callerSub(event) {
  const authorizer = (event && event.requestContext && event.requestContext.authorizer) || {};
  const lambda = authorizer.lambda || {};
  const claims = (authorizer.jwt && authorizer.jwt.claims) || authorizer.claims || {};
  return String(lambda.userId || claims.sub || '').trim();
}

/** `2026-09` -> `2026-10-01`. December rolls the year. */
function resetsOnFor(period) {
  const [y, m] = String(period || '').split('-').map(Number);
  const now = new Date();
  const year = Number.isFinite(y) ? y : now.getUTCFullYear();
  const month = Number.isFinite(m) ? m : now.getUTCMonth() + 1;
  return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
}

async function queryAll(db, tableName, pk, prefix) {
  const items = [];
  let ExclusiveStartKey;
  do {
    const page = await db.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': pk, ':sk': prefix },
      ExclusiveStartKey,
    }));
    items.push(...(page.Items || []));
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

/**
 * @param {object} event      the API Gateway event (for the caller's role and id)
 * @param {object} allowance  what usage.js:readAllowance returned — its `orgId`,
 *                            `period` and `org` (the METADATA row) are read here
 * @param {{db?: object, tableName?: string}} opts
 */
async function planLimitResolve(event, allowance, opts = {}) {
  const db = opts.db || defaultDb;
  const tableName = opts.tableName || process.env.TABLE_NAME;
  const a = allowance || {};
  const orgId = String(a.orgId || '').trim();
  const orgRow = a.org || {};
  const orgType = orgRow.type === 'personal' ? 'personal' : 'team';

  // A personal space has exactly one person in it, and it is theirs. A token
  // with no role there must not read as "member", which would tell the owner
  // to go and ask themselves.
  const role = callerOrgRole(event) || (orgType === 'personal' ? 'owner' : 'member');
  const me = callerSub(event);

  const out = {
    role,
    canRequest: role === 'owner',
    canViewBilling: role === 'owner' || role === 'admin',
    org: { name: String(orgRow.name || ''), type: orgType },
    contacts: [],
    request: null,
    resetsOn: resetsOnFor(a.period),
  };
  if (!orgId) return out;

  let members = [];
  try {
    members = await queryAll(db, tableName, orgPk(orgId), 'MEMBER#');
  } catch (error) {
    console.warn(`⚠️ plan-limit: could not read the members of ${orgId}; refusing without names:`, error && error.message);
  }
  const nameOf = (sub) => {
    const m = members.find((row) => String(row.userId || String(row.SK || '').replace(/^MEMBER#/, '')) === sub);
    return m ? String(m.displayName || m.email || '') : '';
  };

  if (role !== 'owner') {
    const wanted = role === 'admin' ? ['owner'] : ['owner', 'admin'];
    out.contacts = members
      .filter((row) => wanted.includes(row.role))
      .filter((row) => String(row.userId || String(row.SK || '').replace(/^MEMBER#/, '')) !== me)
      .sort((x, y) => (ROLE_ORDER[x.role] - ROLE_ORDER[y.role])
        || String(x.displayName || x.email).localeCompare(String(y.displayName || y.email)))
      .map((row) => ({ name: String(row.displayName || row.email || ''), email: String(row.email || ''), role: row.role }));
  }

  try {
    const waiting = (await queryAll(db, tableName, orgPk(orgId), 'PLANREQ#'))
      .filter((row) => row.status === 'requested')
      .sort((x, y) => String(y.requestedAt || '').localeCompare(String(x.requestedAt || '')))[0];
    if (waiting) {
      out.request = { requestedAt: String(waiting.requestedAt || ''), requestedBy: nameOf(String(waiting.requestedBy || '')) };
    }
  } catch (error) {
    console.warn(`⚠️ plan-limit: could not read the plan requests of ${orgId}:`, error && error.message);
  }

  return out;
}

module.exports = { planLimitResolve, resetsOnFor };
