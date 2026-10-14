/**
 * WORKIE'S PAGE — the frontend mirror of lambda-functions/game/stage-notes.js
 * (two-surface PLAN 1.8). The shared block below is identical to the server's,
 * word for word (tests/stage-notes-page.js §5), so a surface can predict what
 * the server will store before it asks.
 */
// ── shared:stage-notes BEGIN (identical in lambda-functions/game/stage-notes.js and src/src/config/stageNotes.js; tests/stage-notes-page.js §5)
const MAX_PLAN_ENTRIES = 12;
const MAX_PAGES_PER_SECTION = 9;
const MAX_PAGES = 99;
const PLAN_KEY = /^[A-Za-z0-9:_-]{1,64}$/;

const isCount = (v) => Number.isInteger(v) && v >= 1 && v <= MAX_PAGES;
const isIndex = (v) => Number.isInteger(v) && v >= 0;
const clampPage = (page, pages) => (pages ? Math.min(Math.max(0, page), pages - 1) : Math.max(0, page));
const refuse = (status, error) => ({ ok: false, status, error });

/**
 * What a turn of Workie's read does to the stored page.
 *
 * `record` is what the round already holds: { page, pages, plan, planKey }
 * (any of them missing or junk). `body` is ONE of three shapes:
 *   { notesPage, notesPages? }  an absolute page (the host page's turn)
 *   { step: 'next' | 'prev' }   relative to the stored page (the Remote)
 *   { notesPlan, planKey }      a measured plan: pages per section (Phase 2)
 *
 * Returns { ok: true, page, pages, plan, planKey } — integers, an integer
 * list, null, or the validated key; never text — or { ok: false, status,
 * error }. A step with no known page count is 409: the page is never guessed.
 */
function applyNotes(record, body) {
  const stored = record && typeof record === 'object' ? record : {};
  const storedPages = isCount(stored.pages) ? stored.pages : null;
  const storedPage = isIndex(stored.page) ? clampPage(stored.page, storedPages) : 0;
  const storedPlan = Array.isArray(stored.plan) && stored.plan.every(Number.isInteger) ? stored.plan : null;
  const storedKey = typeof stored.planKey === 'string' && PLAN_KEY.test(stored.planKey) ? stored.planKey : null;

  if (!body || typeof body !== 'object' || Array.isArray(body)) return refuse(400, 'A page, a step or a plan is required');
  const shapes = ['notesPage' in body, 'step' in body, 'notesPlan' in body].filter(Boolean).length;
  if (shapes !== 1) return refuse(400, 'Send one of: a page, a step or a plan');

  if ('step' in body) {
    if (body.step !== 'next' && body.step !== 'prev') return refuse(400, "step must be 'next' or 'prev'");
    if (!storedPages) return refuse(409, 'The number of pages is not known yet');
    const page = clampPage(storedPage + (body.step === 'next' ? 1 : -1), storedPages);
    return { ok: true, page, pages: storedPages, plan: storedPlan, planKey: storedKey };
  }

  if ('notesPlan' in body) {
    const plan = body.notesPlan;
    if (!Array.isArray(plan) || plan.length < 1 || plan.length > MAX_PLAN_ENTRIES) {
      return refuse(400, `notesPlan must list 1 to ${MAX_PLAN_ENTRIES} sections`);
    }
    if (!plan.every((k) => Number.isInteger(k) && k >= 1 && k <= MAX_PAGES_PER_SECTION)) {
      return refuse(400, `each section is 1 to ${MAX_PAGES_PER_SECTION} pages`);
    }
    if (typeof body.planKey !== 'string' || !PLAN_KEY.test(body.planKey)) return refuse(400, 'a planKey is required');
    const pages = plan.reduce((sum, k) => sum + k, 0);
    return { ok: true, page: clampPage(storedPage, pages), pages, plan: plan.slice(), planKey: body.planKey };
  }

  if (!isIndex(body.notesPage)) return refuse(400, 'notesPage must be a non-negative integer');
  if ('notesPages' in body && !isCount(body.notesPages)) return refuse(400, `notesPages must be 1 to ${MAX_PAGES}`);
  const pages = 'notesPages' in body ? body.notesPages : storedPages;
  // A count that disagrees with a measured plan retires the plan: the two
  // would otherwise describe different documents.
  const planStands = storedPlan && pages === storedPages;
  return {
    ok: true,
    page: clampPage(body.notesPage, pages),
    pages,
    plan: planStands ? storedPlan : null,
    planKey: planStands ? storedKey : null,
  };
}
// ── shared:stage-notes END

export { applyNotes, MAX_PLAN_ENTRIES, MAX_PAGES_PER_SECTION, MAX_PAGES, PLAN_KEY };
