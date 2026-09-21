// src/src/__tests__/houseCheck.test.js
/**
 * WHAT THE CONSOLE STILL OWNS OF THE CHECK ON ENGAGE'S OWN SET.
 *
 * The owner's trigger is the moment what every organisation plays changes — an
 * activation, a replace while the set is on, a promote while it is on — and
 * each of those routes now starts the check ITSELF (admin/shared/house-check.js).
 * The console used to, off `checkDue`, and a tab closed between the write and
 * the post left a set live and unchecked.
 *
 * Two things are left here, and these pin both: reading the fact the routes
 * still answer, so the person is told a check is running; and the ON-DEMAND
 * control in the Versions panel, which is a deliberate press rather than a
 * trigger and must not be able to take that panel down when it is refused.
 */
jest.mock('../auth/authFetch', () => ({ __esModule: true, authFetch: (...args) => global.fetch(...args) }));
import fs from 'fs';
import path from 'path';
import { checkIsDue, startHouseCheck, houseCheckNotice } from '../utils/houseCheck';

const source = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const json = (status, body) => Promise.resolve({ ok: status < 400, status, json: async () => body });
beforeEach(() => { window.API_BASE = 'https://api.test/'; global.fetch = jest.fn(); });

describe('checkIsDue', () => {
  // rejects: reading the flag as "truthy", which would claim a check on every
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

  // The same field comes back from all three routes that change what every
  // organisation plays, so one reader serves all three.
  test('a save and a promote answer it the same way an activation does', () => {
    expect(checkIsDue({ replaced: true, version: 3, checkDue: true })).toBe(true);
    expect(checkIsDue({ replaced: false, version: null, checkDue: false })).toBe(false);
    expect(checkIsDue({ promoted: true, activeVersion: 1, checkDue: true })).toBe(true);
    expect(checkIsDue({ promoted: false, activeVersion: 1, checkDue: false })).toBe(false);
  });
});

/*
  ── THERE IS EXACTLY ONE TRIGGER, AND IT IS THE SERVER ────────────────────

  The activation, the save and the promote each dispatch the check themselves
  (admin/shared/house-check.js). A console that ALSO posted one would send two
  requests at the same version: they race for the same lock and one of them is
  answered 409, which reads to the person as "a check is already running" on a
  set nobody had checked a second earlier.

  Asserted on the source because the bug is an IMPORT coming back — the call
  sites are two lines in two files that three branches touch at once, and a
  mounted test of either would have to reach the Active toggle through the whole
  console to see it.
*/
describe('who starts a check', () => {
  // rejects: the toggle and the save firing their own, which is what this
  // change removed.
  test('neither the console nor the questions panel posts one', () => {
    for (const file of ['AdminPage.jsx', 'components/QuestionsPanel.jsx']) {
      expect(source(file)).not.toMatch(/startHouseCheck/);
    }
  });

  // rejects: losing the deliberate control along with the triggers. It is the
  // only way to check a set that was already on when checking arrived, or one
  // whose dispatch never went.
  test('the Versions panel keeps its on-demand one', () => {
    expect(source('components/QuestionSetEditor.jsx')).toMatch(/startHouseCheck\(setId/);
  });
});

describe('startHouseCheck — the on-demand control', () => {
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

  // rejects: throwing. An exception here would take down the Versions panel
  // the press came from, over a check that can simply be asked for again.
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
  // rejects: a sentence that leads with the check and leaves the reader to
  // wonder whether their set went on at all. It did — the activation finished
  // before this was written, and the check is its consequence.
  test('it leads with the set being live, and names the check as what follows', () => {
    expect(houseCheckNotice('Icebreakers')).toEqual({
      tone: 'success',
      text: expect.stringMatching(/live to every organisation, and the content check is running/i),
    });
    // …and it says where the answer will appear, so the reader is not left
    // with a fact and no exit.
    expect(houseCheckNotice('Icebreakers').text).toMatch(/versions/i);
  });
  test('a set with no name still reads as a sentence', () => {
    expect(houseCheckNotice('').text).toMatch(/^the set is live/i);
  });
});
