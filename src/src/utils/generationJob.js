/**
 * What a generation job's poll response MEANS — one place, no React.
 *
 * WHY THIS EXISTS. A partial failure used to render as a success. The chain:
 *
 *   1. `failJob` (lambda-functions/admin/shared/generation-jobs.js:148-170)
 *      writes `status:'error'`, `errorMessage`, `phase:'Failed'` AND `items` +
 *      `completed` in one UpdateCommand. A failed job therefore carries real
 *      work — that is deliberate, and it is right.
 *   2. `pollGenerationJob` used to THROW on `status === 'error'`, hanging only
 *      `items` on the Error and discarding `completed`, `requested`,
 *      `warnings`, `phase` and `meta` in the act.
 *   3. Every builder then branched on `items.length > 0` — which is TRUE for a
 *      failed job with partials — and drew the review table with a live
 *      "Load into System" over a job that had failed. The error string went to
 *      the `length === 0` else-branch, where nobody ever saw it.
 *
 * So the rule this module enforces: **the branch is `outcome`, never
 * `items.length`**. `items.length > 0` is not a synonym for success and never
 * was.
 *
 * Modelled on `interpretVersionDelete` in utils/questionSetEditing.js, which
 * exists for exactly this reason: a server answer with several possible
 * meanings gets read once, in a pure function, with a test per meaning.
 *
 * THE WIRE, exactly. `jobToResponse()` (generation-jobs.js) returns twelve keys
 * and nothing else:
 *
 *   { jobId, status, phase, requested, completed, items, warnings, meta,
 *     error, createdSet, setCreationError, updatedAt }
 *
 * `status` ∈ queued | running | complete | error. Do not invent fields.
 *
 * `createdSet` IS THE ONE THAT DECIDES WHETHER THE CLIENT WRITES ANYTHING.
 * The worker now creates the question set itself, as an inactive draft, before
 * the job goes terminal — because "Close — this keeps running" used to be true
 * about the job and false about the outcome, and somebody who left came back to
 * nothing. `{ setId, setName }` means the set already exists and the client
 * must NOT post it a second time; `null` means it does not, and the manual
 * "Load into System" path is the right thing to offer. Never infer either from
 * items.length, and never from the outcome.
 */

/** Every outcome this module can return. Exhaustive — switch on it safely. */
export const GENERATION_OUTCOMES = ['running', 'complete', 'partial', 'empty-failure'];

/**
 * Read a poll response.
 *
 * outcome:
 *   'running'       queued / running / anything not yet terminal. Keep polling.
 *   'complete'      finished with at least one item. The only loadable state.
 *   'partial'       FAILED, but items were written before it died. Keep or drop
 *                   them — but it is a failure, and the screen must say so.
 *   'empty-failure' terminal with nothing to show. Two ways to reach it, and
 *                   they are the same thing to the operator:
 *                     - status 'error' with no items;
 *                     - status 'complete' with ZERO items, which is REAL:
 *                       generation-handler.js:156-159 breaks out of the loop
 *                       with `produced` still empty when the first pass returns
 *                       no items, and then calls completeJob([]). Rendering that
 *                       as a success with an empty review table is the same bug
 *                       in a different coat.
 *
 * An unrecognised status is treated as 'running' — the safe read, because it
 * keeps the client polling instead of declaring an outcome it cannot support.
 */
export function interpretGenerationJob(job) {
  const payload = job && typeof job === 'object' ? job : {};

  const items = Array.isArray(payload.items) ? payload.items : [];
  const warnings = Array.isArray(payload.warnings) ? payload.warnings.filter(Boolean) : [];
  const requested = toCount(payload.requested);
  // The worker writes `completed` and `items` in the SAME UpdateCommand, so
  // they agree. `completed` is still the one to show while running: the first
  // progress write sets completed:0 with no items at all.
  const completed = toCount(payload.completed);
  const status = typeof payload.status === 'string' ? payload.status : '';

  let outcome = 'running';
  if (status === 'error') outcome = items.length > 0 ? 'partial' : 'empty-failure';
  else if (status === 'complete') outcome = items.length > 0 ? 'complete' : 'empty-failure';

  return {
    outcome,
    status,
    jobId: payload.jobId || null,
    phase: payload.phase || '',
    items,
    // What the client actually holds, as opposed to what the worker last counted.
    landed: items.length,
    completed,
    requested,
    warnings,
    error: payload.error || null,
    meta: payload.meta || null,
    /**
     * The set the WORKER made, or null. Read defensively — a job started
     * before server-side creation shipped, or by a builder that does not
     * create sets at all, carries neither field — and a malformed value is
     * read as "no set", which routes the operator to the manual path rather
     * than to a link that goes nowhere.
     */
    createdSet: readCreatedSet(payload.createdSet),
    /** Why there is no set, when the worker tried and could not. */
    setCreationError: payload.setCreationError || null,
    updatedAt: payload.updatedAt || null,
    terminal: outcome !== 'running',
    /** Asked for 100, holding 84 → 16. Zero when nothing is missing. */
    shortfall: requested > items.length ? requested - items.length : 0,
  };
}

/** Tone for StatusMessage. A partial is a FAILURE — see the module header. */
export function generationJobTone(outcome) {
  if (outcome === 'complete') return 'success';
  if (outcome === 'running') return 'pending';
  return 'error';
}

/**
 * The one-line headline for a terminal job. `noun` is the builder's word for
 * its items ('questions', 'scenarios', 'poll questions').
 *
 * Deliberately counts `items.length`, not `completed`: on a terminal job the
 * only number the operator can act on is how many are in front of them.
 */
export function generationJobHeadline(interpreted, noun = 'items') {
  const { outcome, items, requested } = interpreted;
  const of = requested > 0 ? ` of ${requested}` : '';

  if (outcome === 'partial') return `Generation stopped at ${items.length}${of}`;
  if (outcome === 'empty-failure') return `Generation produced no ${noun}`;
  if (outcome === 'complete') return `${items.length} ${noun} generated`;
  return `Generating ${noun}…`;
}

/**
 * Whether the warning list can be trusted to be complete.
 *
 * `failJob` does NOT write `warnings` (generation-jobs.js:148-170) — only
 * `status`, `errorMessage`, `phase`, `items` and `completed`. So on a failure
 * the client sees only the warnings persisted by the last successful
 * `updateJobProgress`, and if the run died in pass 1 there are none at all.
 * Copy that promises a full list would be lying; this is what lets the panel
 * say so instead.
 */
export function warningsMayBeIncomplete(interpreted) {
  return interpreted.outcome === 'partial' || interpreted.outcome === 'empty-failure';
}

/** `{ setId, setName }` or null. A set with no id is not a set you can open. */
function readCreatedSet(value) {
  if (!value || typeof value !== 'object') return null;
  const setId = String(value.setId ?? '').trim();
  if (!setId) return null;
  return { setId, setName: String(value.setName ?? '').trim() || setId };
}

function toCount(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/* ------------------------------------------------------- job id storage --- */
//
// G5.1. The jobId used to live in a local `const` inside handleConfigSubmit, so
// closing the modal lost it forever — while the client's own timeout message
// advised you to "reopen the builder to check", which was impossible. The id
// goes to localStorage so a reload, a closed tab or a "Close — this keeps
// running" can pick the job back up.
//
// THE 3-DAY TTL IS REAL AND IS NEVER REFRESHED (generation-jobs.js:39, 77), so
// a stored id WILL eventually 404. A 404 means "that job is gone", not "an error
// occurred" — see resumeIsGone() and the builders' resume paths.

const STORAGE_PREFIX = 'engage.generationJob.';

/**
 * One slot per endpoint, so the trivia builder never resumes the poll
 * builder's job. Keyed by the endpoint's last path segment
 * (`admin/ai-generate-trivia` → `ai-generate-trivia`) rather than the full URL,
 * because the URL carries window.API_BASE and would change under the operator
 * on any environment switch.
 */
export function generationJobStorageKey(endpoint) {
  const path = String(endpoint || '').split('?')[0].replace(/\/+$/, '');
  const leaf = path.split('/').pop() || 'generation';
  return `${STORAGE_PREFIX}${leaf}`;
}

/** Never let a storage failure (Safari private mode, quota) break generation. */
function storage() {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch (error) {
    return null;
  }
}

export function rememberGenerationJob(endpoint, jobId, extra = {}) {
  if (!jobId) return;
  const store = storage();
  if (!store) return;
  try {
    store.setItem(generationJobStorageKey(endpoint), JSON.stringify({
      jobId,
      startedAt: Date.now(),
      ...extra,
    }));
  } catch (error) {
    /* a job that cannot be remembered still runs; it just cannot be resumed */
  }
}

/**
 * EVERY REMEMBERED JOB, so a LIST can show what is coming rather than only the
 * modal that started it.
 *
 * Reported: "the question set doesnt get generated in the list until i click AI
 * builder and see the status of the generation … it should still show up in the
 * list with a review button to take you to the output."
 *
 * That is right, and the memory to do it already existed — it was only ever
 * read by the builder that wrote it, to offer a resume. The slots are one per
 * endpoint under a shared prefix, so a list can read all of them without
 * knowing which builders exist.
 *
 * @returns {{key: string, jobId: string, startedAt: number}[]} newest first.
 */
export function recallAllGenerationJobs() {
  const store = storage();
  if (!store) return [];
  const found = [];
  try {
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (!key || !key.startsWith(STORAGE_PREFIX)) continue;
      try {
        const parsed = JSON.parse(store.getItem(key));
        // A slot with no jobId is a half-written or cleared one; the single-slot
        // reader treats it as absent and so does this.
        if (parsed && parsed.jobId) {
          found.push({ ...parsed, key: key.slice(STORAGE_PREFIX.length) });
        }
      } catch (error) { /* one malformed slot must not hide the others */ }
    }
  } catch (error) {
    return [];
  }
  return found.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
}

/** `{ jobId, startedAt, ... }` or null. Malformed JSON reads as null. */
export function recallGenerationJob(endpoint) {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(generationJobStorageKey(endpoint));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.jobId ? parsed : null;
  } catch (error) {
    return null;
  }
}

export function forgetGenerationJob(endpoint) {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(generationJobStorageKey(endpoint));
  } catch (error) {
    /* nothing to do */
  }
}

/**
 * Is this poll failure "the job is gone" rather than "something broke"?
 *
 * pollGenerationJob marks a 404 with `error.jobMissing`. A resumed id that
 * 404s is the ordinary end of the 3-day TTL and must return the operator to
 * configuration with a reason, not show them a red error they cannot act on.
 */
export function resumeIsGone(error) {
  return Boolean(error && error.jobMissing);
}
