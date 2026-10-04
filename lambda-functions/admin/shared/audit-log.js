/**
 * THE ORGANISATION'S AUDIT LOG — writing one entry (2026-10-04).
 *
 * The owner: a delete is "deletable by three types of people … and log the
 * user that deleted". This file is the minimal implementation of the shared
 * contract; the fuller module (the reader, platform-admin actions, the admin
 * page) replaces it. Three byte-identical copies — admin/shared/, game/,
 * websocket/ — like tenant.js (tests/audit-log.js holds them equal).
 *
 *   recordAudit(db, { orgId, action, actor: { sub, email, name, role },
 *                     target: { type, id, title }, reason, detail })
 *
 * Row: PK `ORG#<orgId>#AUDIT`, SK `<ISO timestamp>#<8 random hex>`, fields
 * At, OrgId, Action, Actor (map), Target (map: Type, Id), Title and Reason
 * sealed with the organisation's key as every tenant title is, Detail (ids and
 * counts only — never user-written text), and `ttl`: the owner kept the
 * log for ONE YEAR (2026-10-04), so every entry expires RETENTION_DAYS after
 * it was written, on the table's own TTL attribute.
 *
 * IT THROWS when the entry cannot be written, and every caller writes it
 * BEFORE deleting: no entry, no delete.
 */
const crypto = require('crypto');
const { PutCommand } = require('@aws-sdk/lib-dynamodb');
const { encryptValue } = require('./tenant-crypto');

const ROLES = Object.freeze(['host', 'org-owner', 'org-admin', 'platform-admin']);
/** How long an entry is kept: one year (the owner, 2026-10-04). */
const RETENTION_DAYS = 365;
const DAY_SECONDS = 24 * 60 * 60;
const ACTION = /^[a-z][a-z-]*(\.[a-z][a-z-]*)+$/;

const text = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

/** Detail: a small map of ids and counts. Anything else is dropped. */
function cleanDetail(detail) {
  const out = {};
  for (const [k, v] of Object.entries(detail || {}).slice(0, 20)) {
    if (!/^[A-Za-z][A-Za-z0-9]{0,39}$/.test(k)) continue;
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'string' && /^[A-Za-z0-9_#:.-]{0,80}$/.test(v)) out[k] = v;
  }
  return out;
}

async function recordAudit(db, {
  orgId, action, actor = {}, target = {}, reason, detail,
} = {}) {
  const org = text(orgId, 200);
  if (!org) throw new Error('audit-log: an entry needs an orgId');
  if (!ACTION.test(String(action || ''))) throw new Error(`audit-log: bad action ${JSON.stringify(action)}`);
  if (!ROLES.includes(actor.role)) throw new Error(`audit-log: bad role ${JSON.stringify(actor.role)}`);
  if (!text(actor.sub, 200)) throw new Error('audit-log: an entry needs the actor');
  if (!text(target.type, 60) || !text(target.id, 200)) throw new Error('audit-log: an entry needs its target');

  const at = new Date().toISOString();
  const title = text(target.title, 300);
  const why = text(reason, 2000);
  const item = {
    PK: `ORG#${org}#AUDIT`,
    SK: `${at}#${crypto.randomBytes(4).toString('hex')}`,
    At: at,
    OrgId: org,
    Action: action,
    Actor: {
      Sub: text(actor.sub, 200),
      Email: text(actor.email, 320),
      Name: text(actor.name, 200),
      Role: actor.role,
    },
    Target: { Type: text(target.type, 60), Id: text(target.id, 200) },
    ...(title ? { Title: await encryptValue(org, title) } : {}),
    ...(why ? { Reason: await encryptValue(org, why) } : {}),
    Detail: cleanDetail(detail),
    ttl: Math.floor(Date.parse(at) / 1000) + RETENTION_DAYS * DAY_SECONDS,
  };
  await db.send(new PutCommand({
    TableName: process.env.TABLE_NAME,
    Item: item,
    ConditionExpression: 'attribute_not_exists(PK)',
  }));
  return item;
}

module.exports = { recordAudit, AUDIT_ROLES: ROLES, RETENTION_DAYS };
