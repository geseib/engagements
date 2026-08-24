/**
 * WHICH ORGANISATION IS THIS REQUEST ACTING FOR?
 *
 * One request, one org. A caller may belong to several, so something has to
 * choose, and this is the only place that chooses. Kept as a pure function —
 * no AWS, no event, no env — because the interesting cases here are all about
 * what happens when the inputs DISAGREE, and those are miserable to provoke
 * through a live authorizer and trivial to enumerate in a test file.
 *
 * ── THE RULES, IN ORDER ────────────────────────────────────────────────────
 *
 *   1. the requested org, if the caller is a member of it
 *   2. otherwise the single membership, when there is exactly one
 *   3. otherwise the caller's defaultOrgId, if they are a member of it
 *   4. otherwise nothing
 *
 * ── WHY A REQUESTED-BUT-NOT-A-MEMBER ORG MUST BE `null`, NOT A FALLBACK ────
 *
 * This is the whole reason the function exists as its own module.
 *
 * The request said `x-engage-org: org_acme`. If the caller is not in org_acme
 * and we quietly fall through to rule 2 or 3, the request still succeeds — but
 * it succeeds AGAINST A DIFFERENT TENANT THAN THE ONE THE CALLER NAMED. The
 * frontend believes it is looking at Acme; the backend stamps
 * `ORG#org_northwind#SETS`. Nothing errors. The set they thought they were
 * publishing to a partner org lands in their own, or — with the org picker
 * showing Acme — they delete rows out of Northwind believing they are Acme's.
 * A 403 is a bug report. A silent tenant swap is a data-integrity incident
 * nobody discovers for a month.
 *
 * So the ask is honoured or refused. It is never reinterpreted.
 *
 * Note that "not a member" and "no such org" are the same answer on purpose.
 * Distinguishing them would let a caller enumerate which org ids exist by
 * watching the response change, and the caller has no legitimate use for the
 * difference.
 *
 * ── WHY NULL IS NOT A DENIAL ───────────────────────────────────────────────
 *
 * `null` here means "this request has no organisation", which is an ordinary,
 * expected state: a freshly approved host who has not joined a team yet. They
 * can still read PLATFORM and PUBLIC content — `tenant.js:readableScopes`
 * grants both without an org — and they simply own nothing. The caller of this
 * function turns `null` into a blank orgId, NOT into a rejected request.
 */

/** Trim, and treat anything that is not a string as absent. Mirrors tenant.js. */
function clean(v) {
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * Normalise whatever the membership query returned into `{orgId, role}` rows.
 *
 * Rows arrive straight out of DynamoDB, so a row missing `orgId` is possible
 * (a half-written membership, a hand-edited item). Such a row is DROPPED
 * rather than kept with a blank id: keeping it would let rule 2 "find exactly
 * one membership" whose org is `''`, and `tenant.js:gamesIndexPk('')` throws
 * on a blank id — a 500 in a handler instead of a clean no-org read here.
 */
function normalise(memberships) {
  if (!Array.isArray(memberships)) return [];
  return memberships
    .map((m) => ({ orgId: clean(m && m.orgId), role: clean(m && m.role).toLowerCase() }))
    .filter((m) => m.orgId);
}

/**
 * @param {Array<{orgId: string, role: string}>} memberships every org the caller belongs to
 * @param {string} requestedOrgId  the `x-engage-org` header, or ''
 * @param {string} defaultOrgId    the caller's PROFILE row's defaultOrgId, or ''
 * @returns {{orgId: string, role: string}|null}
 */
function pickActiveOrg(memberships, requestedOrgId, defaultOrgId) {
  const rows = normalise(memberships);
  if (rows.length === 0) return null;

  // 1. The request asked for one. Honour it, or refuse — never substitute.
  const requested = clean(requestedOrgId);
  if (requested) {
    return rows.find((m) => m.orgId === requested) || null;
  }

  // 2. Exactly one membership: there is nothing to choose between.
  if (rows.length === 1) return rows[0];

  // 3. Several. The caller's own stated default breaks the tie — but only if
  //    they are still a member of it. A default left behind by an org they
  //    were removed from must not resurrect access to it.
  const preferred = clean(defaultOrgId);
  if (preferred) {
    const hit = rows.find((m) => m.orgId === preferred);
    if (hit) return hit;
  }

  // 4. Several memberships and no way to choose. Picking `rows[0]` here would
  //    be a coin toss decided by DynamoDB's sort order — the caller would act
  //    for whichever org sorts first and would not be told. Return nothing and
  //    let the UI make them choose.
  return null;
}

module.exports = { pickActiveOrg };
