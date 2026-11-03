/**
 * WHEN THE ACCOUNT, OR THE ORGANISATION IT IS ACTING FOR, IS SUSPENDED (#40).
 *
 * The server enforces it in one place, the authorizer (auth/standing.js), and
 * its refusal is API Gateway's bare `403 {"message":"Forbidden"}` — an HTTP
 * API simple-response authorizer cannot put a reason on it. So the console
 * learns WHY from the one route the authorizer still admits a suspended caller
 * to, `GET /orgs`:
 *
 *   403 { code: 'ACCOUNT_SUSPENDED', error }            the account
 *   200 { ..., suspension: { code: 'ORG_SUSPENDED',
 *                            orgId, orgName, message } } the org acted for
 *
 * This module is the one place that knows. It mirrors sessionExpiry.js: any
 * screen (AdminPage on load, authFetch after a bare refusal) reports here,
 * and ProtectedRoute swaps the page for SuspendedScreen. One screen, not a
 * page of failed requests.
 *
 * It imports nothing from authFetch.js on purpose: dozens of tests mock that
 * module with `authFetch` alone, and a component importing this must not
 * reach into a mock.
 */
import { useEffect, useState } from 'react';

export const ACCOUNT_SUSPENDED = 'ACCOUNT_SUSPENDED';
export const ORG_SUSPENDED = 'ORG_SUSPENDED';

const listeners = new Set();
let current = null;

export function getSuspension() {
  return current;
}

/** Subscribe. Returns the unsubscribe. */
export function onSuspension(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Report a suspension. Idempotent for the same code and org. */
export function notifySuspended(info) {
  if (!info || !info.code) return;
  if (current && current.code === info.code && current.orgId === info.orgId) return;
  current = info;
  listeners.forEach((fn) => {
    try { fn(current); } catch (err) { console.error('suspension listener failed:', err); }
  });
}

/** Back in good standing (signed out, switched organisation). */
export function clearSuspension() {
  if (!current) return;
  current = null;
  listeners.forEach((fn) => {
    try { fn(null); } catch (err) { console.error('suspension listener failed:', err); }
  });
}

/**
 * Read GET /orgs' answer. Returns the suspension it describes, or null.
 * `orgs` rides along on an organisation suspension so the screen can offer
 * the caller's other places (a personal space, another team).
 */
export function standingFromOrgs(status, data) {
  const body = data || {};
  if (status === 403 && body.code === ACCOUNT_SUSPENDED) {
    return { code: ACCOUNT_SUSPENDED, orgId: '', message: body.error || '' };
  }
  const s = body.suspension;
  if (status === 200 && s && s.code === ORG_SUSPENDED) {
    const elsewhere = (Array.isArray(body.orgs) ? body.orgs : [])
      .filter((o) => o && o.orgId && o.orgId !== s.orgId && o.status !== 'suspended')
      .map((o) => ({ orgId: o.orgId, name: o.name || '', type: o.type || '' }));
    return { code: ORG_SUSPENDED, orgId: s.orgId || '', orgName: s.orgName || '', message: s.message || '', elsewhere };
  }
  return null;
}

/**
 * Was this response the AUTHORIZER's refusal, rather than a handler's?
 * Handlers answer `{ error: ... }`; API Gateway answers exactly
 * `{"message":"Forbidden"}`. Reads a clone, so the caller's body is intact.
 */
export async function isAuthorizerRefusal(response) {
  if (!response || response.status !== 403 || typeof response.clone !== 'function') return false;
  try {
    const body = await response.clone().json();
    return Boolean(body) && body.message === 'Forbidden' && Object.keys(body).length === 1;
  } catch (_) {
    return false;
  }
}

let probing = null;

/**
 * After a bare refusal: ask GET /orgs why, once at a time, and report it.
 * `ask` performs the request (authFetch passes a plain fetch carrying the same
 * token and org). Never throws.
 */
export function probeStanding(ask) {
  if (probing) return probing;
  probing = (async () => {
    try {
      const res = await ask();
      if (!res) return null;
      const data = await res.json().catch(() => ({}));
      const found = standingFromOrgs(res.status, data);
      if (found) notifySuspended(found);
      return found;
    } catch (_) {
      return null;
    } finally {
      probing = null;
    }
  })();
  return probing;
}

/** React: the current suspension, kept live. */
export function useSuspension() {
  const [value, setValue] = useState(current);
  useEffect(() => {
    setValue(current);
    return onSuspension(setValue);
  }, []);
  return value;
}
