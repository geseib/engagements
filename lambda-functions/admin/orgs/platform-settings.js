/**
 * GET / POST /platform/settings/claude-models — the Engage-wide switch between
 * the Anthropic API's 5.5 models (the default) and Bedrock's 4.x models.
 *
 * The owner, 2026-10-11: "I want 5.5 to be the default API call in the
 * session. I want the option to set these in the admin pages. … For now set
 * this at the Engage level for everyone." One setting, every team and Engage's
 * own calls alike. What it switches, and how a call falls back, is
 * shared/claude-route.js; this file only reads and writes the row.
 *
 *   PK PLATFORM#SETTINGS   SK CLAUDE_MODELS
 *   Anthropic55 (boolean)  UpdatedAt  UpdatedBy (the staff member's sub)
 *
 * NO ROW MEANS ON. The owner's default is the 5.5 models; the row exists only
 * once somebody has changed it.
 *
 * NOT CONNECTED MEANS BEDROCK, WHATEVER THE ROW SAYS. Where the tier has no
 * federation ids (prod, for now), every call stays on Bedrock; the GET says
 * `connected: false` and the POST refuses, so the page can say "Anthropic API
 * not connected on this tier" instead of showing a switch that does nothing.
 *
 * TWO CHECKS, as on every platform route: authorizer.js names the route
 * ['admins'], and this handler re-asks tenant.isPlatformAdmin.
 *
 * AUDITED FIRST (owner, 2026-10-04): a change writes `recordAudit` (action
 * `platform.claude-models`, role platform-admin, staff-only PLATFORM#AUDIT)
 * BEFORE the row is written, and is refused with 503 when the entry cannot be.
 *
 * A change reaches a warm function within a minute (claude-route.js caches the
 * row that long).
 */
const { GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const G = require('./shared/org-guards');
const tenant = require('../shared/tenant');
const { recordAudit, markAuditOutcome, actorFromEvent } = require('../shared/audit-log');
const { SETTING_KEY, SETTING_FIELD, SETTING_CACHE_MS, settingFromItem } = require('../shared/claude-route');
const { anthropicConnected } = require('../shared/anthropic-messages');

const ROUTE_RE = /\/platform\/settings\/claude-models$/;

/** What the page is told. Nothing secret: the ids themselves never leave. */
function view(item) {
  const connected = anthropicConnected();
  const anthropic55 = settingFromItem(item);
  return {
    setting: 'claude-models',
    anthropic55,
    isDefault: !item || typeof item[SETTING_FIELD] !== 'boolean',
    connected,
    // What a call does right now on this tier.
    effective: connected && anthropic55 ? 'anthropic-5-5' : 'bedrock-4',
    updatedAt: (item && item.UpdatedAt) || null,
    takesEffectWithinSeconds: Math.round(SETTING_CACHE_MS / 1000),
  };
}

async function readRow() {
  const res = await G.db.send(new GetCommand({ TableName: G.tableName(), Key: { ...SETTING_KEY } }));
  return (res && res.Item) || null;
}

async function getClaudeModels() {
  return G.json(200, view(await readRow()));
}

async function setClaudeModels(event) {
  const body = G.parseBody(event);
  if (body === null) return G.fail(400, 'The request body is not JSON.');
  if (typeof body.anthropic55 !== 'boolean') return G.fail(400, 'anthropic55 must be true or false.');
  if (!anthropicConnected()) {
    return G.fail(409, 'Anthropic API not connected on this tier, so every call stays on Bedrock. Nothing was changed.');
  }

  const before = await readRow();
  const from = settingFromItem(before);
  const to = body.anthropic55;
  const actor = actorFromEvent(event, 'platform-admin');

  let auditRef;
  try {
    auditRef = await recordAudit(G.db, {
      orgId: '',
      action: 'platform.claude-models',
      actor,
      target: { type: 'setting', id: 'claude-models', title: 'Claude models' },
      reason: G.clean(body.reason).slice(0, 600),
      detail: { from: from ? 'anthropic-5-5' : 'bedrock-4', to: to ? 'anthropic-5-5' : 'bedrock-4' },
    });
  } catch (e) {
    console.error('platform: claude-models change refused, the audit entry could not be written:', e && e.name);
    return G.fail(503, 'Nothing was changed: the change could not be recorded in the audit log. Try again.');
  }

  const item = {
    ...SETTING_KEY,
    RecordType: 'PLATFORM_SETTING',
    [SETTING_FIELD]: to,
    UpdatedAt: new Date().toISOString(),
    UpdatedBy: actor.sub,
  };
  try {
    await G.db.send(new PutCommand({ TableName: G.tableName(), Item: item }));
  } catch (e) {
    await markAuditOutcome(G.db, auditRef, 'failed');
    throw e;
  }
  return G.json(200, view(item));
}

/** Dispatched from platform-orgs.js. Returns null when the route is not this one. */
async function platformSettings(event) {
  const method = event?.requestContext?.http?.method;
  if (!ROUTE_RE.test(String(event?.rawPath || event?.routeKey || ''))) return null;
  if (!tenant.isPlatformAdmin(event)) return G.fail(403, 'This is an Engage staff screen.');
  if (method === 'GET') return getClaudeModels();
  if (method === 'POST') return setClaudeModels(event);
  return G.fail(405, 'GET or POST.');
}

module.exports = { platformSettings, view, ROUTE_RE };
