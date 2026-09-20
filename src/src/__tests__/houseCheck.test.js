// src/src/__tests__/houseCheck.test.js
/**
 * THE CHECK ON ENGAGE'S OWN SET, FIRED FROM THE CONSOLE.
 *
 * The owner's trigger is the moment a platform set is SWITCHED ON, because that
 * is the moment it becomes servable to every organisation. The activation route
 * cannot dispatch the job itself — it holds no lambda:InvokeFunction, so an
 * invoke from inside it is an AccessDenied it would have to swallow — so it
 * answers `checkDue` and the console runs the check. These pin that the
 * activation has already finished by then, and that a check that will not start
 * says so rather than taking the screen down with it.
 */
jest.mock('../auth/authFetch', () => ({ __esModule: true, authFetch: (...args) => global.fetch(...args) }));
import { checkIsDue, startHouseCheck, houseCheckNotice } from '../utils/houseCheck';

const json = (status, body) => Promise.resolve({ ok: status < 400, status, json: async () => body });
beforeEach(() => { window.API_BASE = 'https://api.test/'; global.fetch = jest.fn(); });

describe('checkIsDue', () => {
  // rejects: reading the flag as "truthy", which would fire a check on every
  // answer that merely CARRIES the field — the route states it false as well as
  // true, on purpose, so a client never has to tell "not due" from "this build
  // does not say".
  test('only an activation that made an Engage set servable is due', () => {
    expect(checkIsDue({ active: true, scope: 'platform', checkDue: true })).toBe(true);
    expect(checkIsDue({ active: true, scope: 'platform', checkDue: false })).toBe(false);
    expect(checkIsDue({ active: false, scope: 'platform' })).toBe(false);
    expect(checkIsDue({ active: true, scope: 'org', orgId: 'org_acme' })).toBe(false);
    expect(checkIsDue(null)).toBe(false);
    expect(checkIsDue({ checkDue: 'true' })).toBe(false);
  });
});

describe('startHouseCheck', () => {
  test('posts the set\'s own check route with no organisation flag of any kind', async () => {
    global.fetch.mockReturnValueOnce(json(202, { jobId: 'j7', version: 1, status: 'queued', platform: true }));
    const out = await startHouseCheck('icebreakers');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.test/question-sets/icebreakers/check',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({}) }),
    );
    expect(out).toEqual({ ok: true, jobId: 'j7', version: 1 });
  });

  test('a version can be named, which is how one that is not active is looked at', async () => {
    global.fetch.mockReturnValueOnce(json(202, { jobId: 'j8', version: 3, status: 'queued' }));
    await startHouseCheck('icebreakers', { version: 3 });
    expect(global.fetch.mock.calls[0][1].body).toBe(JSON.stringify({ version: 3 }));
  });

  test('a set id with a slash or a space cannot reach a path it was not meant to', async () => {
    global.fetch.mockReturnValueOnce(json(202, {}));
    await startHouseCheck('ice breakers/../admin');
    expect(global.fetch.mock.calls[0][0]).toBe('https://api.test/question-sets/ice%20breakers%2F..%2Fadmin/check');
  });

  // rejects: throwing. This runs after an activation that has already
  // succeeded; an exception here would take down the screen that triggered it
  // over work nobody asked for out loud.
  test('a refusal and a dead network both come back as a sentence', async () => {
    global.fetch.mockReturnValueOnce(json(409, { error: 'A check is already running for this version.' }));
    expect(await startHouseCheck('icebreakers')).toEqual({ ok: false, error: 'A check is already running for this version.' });
    global.fetch.mockReturnValueOnce(json(500, {}));
    expect(await startHouseCheck('icebreakers')).toEqual({ ok: false, error: 'the server answered 500' });
    global.fetch.mockImplementationOnce(() => { throw new Error('Failed to fetch'); });
    expect(await startHouseCheck('icebreakers')).toEqual({ ok: false, error: 'Failed to fetch' });
  });
});

describe('houseCheckNotice', () => {
  // rejects: a failure sentence that says only "the check could not start",
  // leaving the reader to wonder whether their set went on at all. It did —
  // the activation finished before any of this ran.
  test('both outcomes say the set is live, because by then it is', () => {
    expect(houseCheckNotice({ ok: true }, 'Icebreakers')).toEqual({
      tone: 'success',
      text: expect.stringMatching(/live to every organisation, and the content check is running/i),
    });
    const bad = houseCheckNotice({ ok: false, error: 'the server answered 500' }, 'Icebreakers');
    expect(bad.tone).toBe('error');
    expect(bad.text).toMatch(/is live to every organisation, but the content check could not be started/i);
    expect(bad.text).toMatch(/the server answered 500/);
    // …and it says where to run it by hand, so the reader is not left with a
    // fact and no exit.
    expect(bad.text).toMatch(/Versions panel/i);
  });
  test('a set with no name still reads as a sentence', () => {
    expect(houseCheckNotice({ ok: true }, '').text).toMatch(/^the set is live/i);
  });
});
