import React from 'react';

/**
 * THE REASON ENGAGE STAFF GIVE TO DELETE SOMEBODY ELSE'S ENGAGEMENT
 * (the owner, 2026-10-04).
 *
 * "it should be deletable by three types of people: the host that created it,
 * an admin for the org, and [an Engage platform admin] with a documented
 * reason (logged to the org's or user's admin page)". The server answers which
 * role a caller would delete in (`deleteAs`, tenant.deleteRole); when it is
 * 'platform-admin', the delete confirm the screen already has carries this
 * field, inline, and Delete waits for it. Owners, org admins and the host who
 * made it never see it.
 *
 * NO STYLESHEET OF ITS OWN: it borrows the field, label and input classes of
 * the screen it sits in (`scope`: `sp`, `evb`, `brm` …), as every screen's
 * fields already do, so it is that screen's field and not a second idiom.
 */
export const REASON_LABEL = 'Why are you deleting this?';
export const REASON_HINT = 'You are not its host or an admin of its team, so Engage staff give a reason. It is kept in the team’s audit log.';

/** Did the server refuse a delete for want of a reason? */
export function needsReason(error) {
  const body = (error && error.body) || {};
  return Boolean(error) && (body.code === 'reason_required' || error.code === 'reason_required');
}

export default function DeleteReasonField({
  id, value, onChange, scope = 'sp', labelClass, inputClass, hintClass,
}) {
  return (
    <div className={`${scope}-field`} data-testid="delete-reason">
      <label className={labelClass || `${scope}-label`} htmlFor={id}>{REASON_LABEL}</label>
      <textarea
        id={id}
        className={inputClass || `${scope}-input`}
        rows={2}
        maxLength={500}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="For example: the team owner asked by email."
      />
      <small className={hintClass || `${scope}-hint`}>{REASON_HINT}</small>
    </div>
  );
}
