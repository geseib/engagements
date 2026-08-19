// #9: a 403 used to render as "your session may have expired - please sign in
// again", sending a signed-in admin around a sign-in loop that cannot help.
// A 403 reaches a VALID session that lacks the group; only 401 is about the
// session itself. These tests fail against the old collapsed branch.

import { describeHttpError } from '../utils/aiBatchClient';

describe('describeHttpError', () => {
  test('401 says the session is the problem and to sign in again', () => {
    const msg = describeHttpError(401, null, 'Batch 1');
    expect(msg).toMatch(/sign in again/i);
    expect(msg).toContain('401');
  });

  test('403 says the account lacks permission, and does NOT say to sign in again', () => {
    const msg = describeHttpError(403, null, 'Batch 1');
    expect(msg).toMatch(/not permitted/i);
    expect(msg).toContain('403');
    expect(msg).not.toMatch(/sign in again/i);
    expect(msg).not.toMatch(/session may have expired/i);
  });

  test('server errors keep the lambda detail when there is one', () => {
    expect(describeHttpError(500, 'Bedrock is having a day', 'Batch 2'))
      .toContain('Bedrock is having a day');
  });
});
