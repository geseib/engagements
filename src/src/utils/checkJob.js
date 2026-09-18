/**
 * THE CHECK JOB, READ. `interpretGenerationJob` decides "complete vs empty
 * failure" from `items.length`, which is right for a generator and wrong here:
 * a clean pass has ZERO items. The worker writes its verdict to `meta.outcome`
 * (lambda-functions/admin/shared/set-check-worker.js) and that is what this reads.
 */
export function interpretCheckJob(job) {
  const j = job && typeof job === 'object' ? job : {};
  const status = typeof j.status === 'string' ? j.status : '';
  const meta = j.meta && typeof j.meta === 'object' ? j.meta : {};
  let outcome = 'running';
  if (status === 'error') outcome = 'failed';
  else if (status === 'complete') outcome = ['passed', 'flagged', 'escalated'].includes(meta.outcome) ? meta.outcome : 'failed';
  return {
    outcome,
    terminal: outcome !== 'running',
    phase: j.phase || '',
    completed: Number(j.completed) || 0,
    requested: Number(j.requested) || 0,
    items: Array.isArray(j.items) ? j.items : [],
    meta,
    error: j.errorMessage || j.error || null,
    jobId: j.jobId || null,
  };
}
