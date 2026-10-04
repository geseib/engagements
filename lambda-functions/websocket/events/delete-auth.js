/**
 * WHO MAY DELETE AN EVENT OR ONE OF ITS ITEMS, AND THE ENTRY THAT SAYS SO
 * (the owner, 2026-10-04).
 *
 * "it should be deletable by three types of people: the host that created it,
 * an admin for the org, and [an Engage platform admin] with a documented
 * reason (logged to the org's or user's admin page), and log the user that
 * deleted." tenant.deleteRole decides the role; this file applies it to an
 * event (whose METADATA has always recorded `CreatedBy`) and writes the audit
 * entry (audit-log.js) BEFORE anything is deleted.
 *
 *   openForDelete   the event's METADATA when this caller may even ask: a
 *                   member of its organisation, or Engage staff; else null —
 *                   which the routes answer with the unknown code's 404, as
 *                   every event route answers a rival.
 *   deleteGate      `{ role, reason, refused }` — refused is `{status, code,
 *                   error}` for a member with no role (403) or staff with no
 *                   reason (400 reason_required).
 *   auditDelete     writes the entry; throws when it cannot (no entry, no
 *                   delete).
 *
 * An item has no creator of its own: it belongs to its event, so the event's
 * creator is its host.
 */
const {
  callerMayManageEvent, isPlatformAdmin, deleteRole, deleteRefusal, cleanDeleteReason, deleteActor,
} = require('../tenant');
const { recordAudit } = require('../audit-log');
const { callerSub, readBody } = require('./event-http');
const S = require('./event-store');

async function openForDelete(db, tableName, request, code) {
  if (!callerSub(request)) return null;
  const meta = await S.readMeta(db, tableName, code);
  if (!meta) return null;
  return callerMayManageEvent(request, meta) || isPlatformAdmin(request) ? meta : null;
}

function deleteGate(request, meta) {
  const body = readBody(request) || {};
  const reason = cleanDeleteReason(body.reason);
  const role = deleteRole(request, { orgId: meta && meta.orgId, createdBy: meta && meta.CreatedBy });
  return { role, reason, refused: deleteRefusal(role, reason) };
}

async function auditDelete(db, request, gate, { orgId, action, target, detail }) {
  return recordAudit(db, {
    orgId,
    action,
    actor: deleteActor(request, gate.role),
    target,
    reason: gate.role === 'platform-admin' ? gate.reason : '',
    detail,
  });
}

/** The entry could not be written, so nothing was deleted. */
const AUDIT_FAILED = 'Could not record who is deleting this, so nothing was deleted. Try again.';

module.exports = {
  openForDelete, deleteGate, auditDelete, AUDIT_FAILED,
};
