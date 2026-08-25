/**
 * interpretGenerationJob — the reading of a poll response that G1 turns on.
 *
 * THE DEFECT THESE TESTS EXIST FOR. `failJob` writes `status:'error'` AND
 * `items` + `completed` in one UpdateCommand (lambda-functions/admin/shared/
 * generation-jobs.js:148-170), so a failed job carries real work. Every builder
 * branched on `items.length > 0` — which is TRUE for that job — and drew the
 * review table with a live "Load into System" over a failure. `items.length` is
 * not a synonym for success and these tests are what stops it becoming one
 * again.
 *
 * FIXTURES ARE COPIED FROM jobToResponse() (generation-jobs.js:178-192), which
 * returns exactly ten keys:
 *
 *   { jobId, status, phase, requested, completed, items, warnings, meta,
 *     error, updatedAt }
 *
 * Nothing here invents a field. The repo's sharpest own-goal was eighteen green
 * tests written against an event shape the system never generates
 * (docs/handoff/RESUME.md, Landmines).
 */
import {
  interpretGenerationJob,
  generationJobTone,
  generationJobHeadline,
  warningsMayBeIncomplete,
  generationJobStorageKey,
  recallAllGenerationJobs,
  rememberGenerationJob,
  recallGenerationJob,
  forgetGenerationJob,
  resumeIsGone,
} from '../utils/generationJob';

/** jobToResponse()'s exact shape. Override only what a case is about. */
const jobResponse = (overrides = {}) => ({
  jobId: 'm4k2p9x7bq1a',
  status: 'running',
  phase: '',
  requested: 0,
  completed: 0,
  items: [],
  warnings: [],
  meta: null,
  error: null,
  updatedAt: '2026-08-11T14:22:06.000Z',
  ...overrides,
});

const questions = (n) => Array.from({ length: n }, (_, i) => ({
  title: `Question ${i + 1}`,
  category: 'Engineering',
  difficulty: 'medium',
}));

/** What failJob(…, { items: produced }) actually leaves in the row. */
const partialFailure = jobResponse({
  status: 'error',
  phase: 'Failed',
  requested: 100,
  completed: 41,
  items: questions(41),
  warnings: ['A pass of 19 exceeded the output budget; continuing in smaller passes.'],
  error: 'rate limited by the AI service (HTTP 429)',
});

describe('the outcome, which is never items.length', () => {
  test('a failed job carrying 41 of 100 is partial, and never complete', () => {
    // rejects: any re-derivation of the branch from items.length — the exact
    // shape of the shipped bug, where 41 items over a dead job rendered the
    // success UI. Also rejects pollGenerationJob going back to throwing, which
    // is what discarded `completed`, `requested`, `warnings` and `phase`.
    const read = interpretGenerationJob(partialFailure);

    expect(read.outcome).toBe('partial');
    expect(read.outcome).not.toBe('complete');
    expect(read.terminal).toBe(true);
    // Everything the old Error dropped on the floor:
    expect(read.completed).toBe(41);
    expect(read.requested).toBe(100);
    expect(read.items).toHaveLength(41);
    expect(read.warnings).toEqual(partialFailure.warnings);
    expect(read.error).toBe('rate limited by the AI service (HTTP 429)');
    expect(read.shortfall).toBe(59);
  });

  test('a failure with nothing written is an empty failure, not a partial', () => {
    // rejects: collapsing the two failure shapes into one. They need different
    // screens — one offers "keep the 41", the other has nothing to keep.
    const read = interpretGenerationJob(jobResponse({
      status: 'error',
      phase: 'Failed',
      requested: 20,
      items: [],
      error: 'Bedrock is having a day',
    }));

    expect(read.outcome).toBe('empty-failure');
    expect(read.shortfall).toBe(20);
  });

  test('a completed job with items is the only loadable outcome', () => {
    const read = interpretGenerationJob(jobResponse({
      status: 'complete',
      phase: 'Generated 84 of 84',
      requested: 100,
      completed: 84,
      items: questions(84),
    }));

    expect(read.outcome).toBe('complete');
    expect(read.shortfall).toBe(16);
  });

  test('a COMPLETED job with zero items is a failure, not a success', () => {
    // rejects: `outcome = status === 'complete' ? 'complete' : …`.
    //
    // This job is real. generation-handler.js:156-159 breaks out of the pass
    // loop with `produced` still empty when the first model call returns no
    // items, then calls completeJob([]) — status 'complete', items [], and a
    // warning. Reading that as success draws an empty review table with a live
    // Load button over a run that produced nothing.
    const read = interpretGenerationJob(jobResponse({
      status: 'complete',
      phase: 'Generated 0 of 0',
      requested: 20,
      completed: 0,
      items: [],
      warnings: ['A generation pass returned no items; stopping early.'],
    }));

    expect(read.outcome).toBe('empty-failure');
    expect(read.terminal).toBe(true);
  });

  test('queued, running and an unrecognised status all keep polling', () => {
    // rejects: treating an unknown status as terminal, which would strand the
    // operator on a screen with no poller and no answer.
    for (const status of ['queued', 'running', 'weather', '']) {
      const read = interpretGenerationJob(jobResponse({ status, items: questions(3) }));
      expect(read.outcome).toBe('running');
      expect(read.terminal).toBe(false);
    }
  });

  test('no job at all reads as running rather than throwing', () => {
    // rejects: destructuring `job.items` before the first poll lands, which is
    // exactly when the builders render this.
    expect(interpretGenerationJob(null).outcome).toBe('running');
    expect(interpretGenerationJob(undefined).items).toEqual([]);
    expect(interpretGenerationJob({}).warnings).toEqual([]);
  });

  test('a garbled row does not produce negative or fractional counts', () => {
    // rejects: passing `requested` straight through. The shortfall arithmetic
    // and the progress percentage both divide by it.
    const read = interpretGenerationJob(jobResponse({
      status: 'complete',
      requested: -5,
      completed: 'lots',
      items: questions(2),
    }));

    expect(read.requested).toBe(0);
    expect(read.completed).toBe(0);
    expect(read.shortfall).toBe(0);
  });
});

describe('what the reading is allowed to say', () => {
  test('a partial failure is toned as a failure', () => {
    // rejects: tone driven by "there are items, so it went well". The panel and
    // any StatusMessage take their colour from this.
    expect(generationJobTone('partial')).toBe('error');
    expect(generationJobTone('empty-failure')).toBe('error');
    expect(generationJobTone('complete')).toBe('success');
    expect(generationJobTone('running')).toBe('pending');
  });

  test('the headline counts what is in front of you', () => {
    // rejects: headlining `completed` instead of items.length. They agree on
    // every row the worker writes, but only items.length is evidence.
    expect(generationJobHeadline(interpretGenerationJob(partialFailure), 'questions'))
      .toBe('Generation stopped at 41 of 100');
  });

  test('the warning list is only trustworthy when the job did not fail', () => {
    // rejects: copy that promises a complete warning list on a failure.
    // failJob does not write `warnings` at all (generation-jobs.js:148-170), so
    // a failed job shows only what the last progress write persisted — and a
    // run that died in pass 1 shows none.
    expect(warningsMayBeIncomplete(interpretGenerationJob(partialFailure))).toBe(true);
    expect(warningsMayBeIncomplete(interpretGenerationJob(jobResponse({
      status: 'error', items: [],
    })))).toBe(true);
    expect(warningsMayBeIncomplete(interpretGenerationJob(jobResponse({
      status: 'complete', items: questions(3),
    })))).toBe(false);
  });
});

describe('remembering the job id, so leaving is survivable', () => {
  beforeEach(() => window.localStorage.clear());

  test('each endpoint gets its own slot, keyed by its leaf', () => {
    // rejects: one shared key (the trivia builder would resume the poll
    // builder's job), and keying on the full URL — which carries
    // window.API_BASE and changes under the operator on an environment switch.
    const trivia = generationJobStorageKey('https://api.dev.example.com/admin/ai-generate-trivia');
    const polls = generationJobStorageKey('https://api.dev.example.com/admin/ai-generate-polls');
    const other = generationJobStorageKey('https://api.test.example.com/admin/ai-generate-trivia');

    expect(trivia).not.toBe(polls);
    expect(trivia).toBe(other);
  });

  test('a remembered id comes back, and a forgotten one does not', () => {
    // rejects: dropping the persistence — the whole of G5.1, and what makes the
    // client's own "reopen the builder to check" message true for the first time.
    rememberGenerationJob('/admin/ai-generate-trivia', 'm4k2p9x7bq1a', { topic: 'Merger' });

    expect(recallGenerationJob('/admin/ai-generate-trivia')).toMatchObject({
      jobId: 'm4k2p9x7bq1a',
      topic: 'Merger',
    });

    forgetGenerationJob('/admin/ai-generate-trivia');
    expect(recallGenerationJob('/admin/ai-generate-trivia')).toBeNull();
  });

  test('junk in storage reads as nothing, not as a crash', () => {
    // rejects: a bare JSON.parse. This value survives releases; a half-written
    // or older-shaped entry must not stop the builder opening.
    window.localStorage.setItem(generationJobStorageKey('/admin/ai-generate-polls'), '{not json');
    expect(recallGenerationJob('/admin/ai-generate-polls')).toBeNull();

    window.localStorage.setItem(generationJobStorageKey('/admin/ai-generate-polls'), '{"startedAt":1}');
    expect(recallGenerationJob('/admin/ai-generate-polls')).toBeNull();
  });

  test('an empty job id is never stored', () => {
    // rejects: storing undefined, which would make every later open try to
    // resume a job called "undefined" and 404.
    rememberGenerationJob('/admin/ai-generate-trivia', undefined);
    expect(recallGenerationJob('/admin/ai-generate-trivia')).toBeNull();
  });

  test('only a 404 counts as "that job is gone"', () => {
    // rejects: treating every poll failure as an expiry, which would silently
    // forget the id of a job that is still running — the one thing that makes
    // reconnecting possible.
    const gone = Object.assign(new Error('job not found or expired'), { jobMissing: true });
    expect(resumeIsGone(gone)).toBe(true);
    expect(resumeIsGone(new Error('lost contact with the job'))).toBe(false);
    expect(resumeIsGone(null)).toBe(false);
  });
});

/**
 * WHAT A LIST CAN SEE.
 *
 * Reported: "the question set doesnt get generated in the list until i click AI
 * builder and see the status of the generation … it should still show up in the
 * list with a review button." The memory to do that already existed — one slot
 * per endpoint under a shared prefix — but only the builder that wrote a slot
 * ever read it, to offer itself a resume. A list needs all of them.
 */
describe('recallAllGenerationJobs', () => {
  const key = (leaf) => `engage.generationJob.${leaf}`;
  beforeEach(() => window.localStorage.clear());

  test('finds every remembered job, whichever builder wrote it', () => {
    window.localStorage.setItem(key('ai-generate-trivia'), JSON.stringify({ jobId: 't1', startedAt: 10 }));
    window.localStorage.setItem(key('ai-generate-scenarios'), JSON.stringify({ jobId: 's1', startedAt: 20 }));
    expect(recallAllGenerationJobs().map((j) => j.jobId)).toEqual(['s1', 't1']);
  });

  // rejects: a list ordered by whatever order localStorage happens to enumerate,
  // which puts the job the person just started anywhere.
  test('newest first', () => {
    window.localStorage.setItem(key('a'), JSON.stringify({ jobId: 'old', startedAt: 1 }));
    window.localStorage.setItem(key('b'), JSON.stringify({ jobId: 'new', startedAt: 999 }));
    expect(recallAllGenerationJobs()[0].jobId).toBe('new');
  });

  // rejects: reading unrelated keys. This runs against the same localStorage as
  // every other feature in the app.
  test('reads nothing that is not a generation slot', () => {
    window.localStorage.setItem('engage.somethingElse', JSON.stringify({ jobId: 'no' }));
    window.localStorage.setItem('game_1234_title', 'Retro');
    expect(recallAllGenerationJobs()).toEqual([]);
  });

  // rejects: one bad slot taking the others down with it — the single-slot
  // reader already survives this and a list must not be more fragile.
  test('one malformed slot does not hide the rest', () => {
    window.localStorage.setItem(key('broken'), '{not json');
    window.localStorage.setItem(key('ok'), JSON.stringify({ jobId: 'fine', startedAt: 5 }));
    expect(recallAllGenerationJobs().map((j) => j.jobId)).toEqual(['fine']);
  });

  // rejects: a cleared-but-present slot showing as a running generation.
  test('a slot with no jobId is absent, as it is for the single-slot reader', () => {
    window.localStorage.setItem(key('empty'), JSON.stringify({ startedAt: 5 }));
    expect(recallAllGenerationJobs()).toEqual([]);
  });

  // rejects: the caller having to know which builders exist to interpret it.
  test('says which builder wrote each slot', () => {
    window.localStorage.setItem(key('ai-generate-polls'), JSON.stringify({ jobId: 'p1', startedAt: 3 }));
    expect(recallAllGenerationJobs()[0].key).toBe('ai-generate-polls');
  });
});
