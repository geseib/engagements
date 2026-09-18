import { interpretCheckJob } from '../utils/checkJob';

describe('interpretCheckJob', () => {
  test('a running job is running whatever its items say', () => {
    expect(interpretCheckJob({ status: 'running', phase: 'Checking 4 of 30', completed: 4, requested: 30, items: [] }))
      .toMatchObject({ outcome: 'running', terminal: false, phase: 'Checking 4 of 30', completed: 4, requested: 30 });
  });
  test('a complete job reports the worker\'s outcome, not the item count', () => {
    expect(interpretCheckJob({ status: 'complete', items: [], meta: { outcome: 'passed', publicSetId: 'x-y', publicVersion: 1 } }))
      .toMatchObject({ outcome: 'passed', terminal: true, meta: { publicSetId: 'x-y' } });
    expect(interpretCheckJob({ status: 'complete', items: [{ questionId: 'q1' }], meta: { outcome: 'flagged' } }).outcome).toBe('flagged');
    expect(interpretCheckJob({ status: 'complete', items: [], meta: { outcome: 'escalated', reasons: ['declared'] } }).outcome).toBe('escalated');
  });
  test('an errored job is failed with its message', () => {
    expect(interpretCheckJob({ status: 'error', errorMessage: 'The check could not finish: boom' }))
      .toMatchObject({ outcome: 'failed', terminal: true, error: 'The check could not finish: boom' });
  });
  test('nothing at all is running', () => {
    expect(interpretCheckJob(null).outcome).toBe('running');
  });
});
