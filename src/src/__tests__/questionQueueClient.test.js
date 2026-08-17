/**
 * THE WIRE HALF OF THE QUEUE — utils/questionQueueClient.js.
 *
 * Called directly with a stub `fetchFn`, never mounted. The thing under test is
 * exactly the thing `utils/nextQuestion.js` was extracted to make testable: what
 * a host is TOLD when a press does not land, and — the harder half — when a
 * press DID land but the answer was unreadable.
 *
 * The distinction these tests exist to protect: a 200 carrying
 * `changed: false` is the SERVER BEING EXPLICIT, not the server failing.
 * Collapsing it into the error path puts a banner in front of a host who
 * pressed ↑ on the first row; collapsing it the other way hides a 403.
 */
import { fetchQueue, postQueueOp, refusalMessage } from '../utils/questionQueueClient';

const ok = (body) => ({
  ok: true,
  status: 200,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const bad = (status, body) => ({
  ok: false,
  status,
  json: async () => body,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

/** A 200 whose body will not parse — a truncated response, a proxy rewrite. */
const unreadable = () => ({
  ok: true,
  status: 200,
  json: async () => { throw new SyntaxError('Unexpected end of JSON input'); },
  text: async () => 'not json',
});

describe('reading the running order', () => {
  test('a good read returns the queue and its version', async () => {
    const fetchFn = jest.fn().mockResolvedValue(ok({ queue: ['c1#1', 'c1#2'], version: 7 }));
    const result = await fetchQueue({ fetchFn, apiBase: 'https://api/', gameId: '1234' });

    expect(fetchFn).toHaveBeenCalledWith('https://api/games/1234/queue', { method: 'GET' });
    expect(result).toMatchObject({ ok: true, queue: ['c1#1', 'c1#2'], version: 7 });
  });

  test('the stored list is normalised on the way in', async () => {
    // rejects: trusting the stored array. An older client's write can leave a
    // duplicate or a blank, and a row keyed on '' collides with every other
    // blank in React's reconciler — two rows, one key, one of them unclickable.
    const fetchFn = jest.fn().mockResolvedValue(
      ok({ queue: ['c1#1', 'QUESTION#c1#1', '', null, 'c1#2'], version: 2 }),
    );
    const { queue } = await fetchQueue({ fetchFn, apiBase: 'https://api/', gameId: '1234' });
    expect(queue).toEqual(['c1#1', 'c1#2']);
  });

  test('a failed read does not throw, and does not claim the queue is empty', async () => {
    // rejects: `ok: true` with `queue: []` on a 500. The caller keeps what it
    // has precisely because this says the read failed rather than reporting an
    // empty running order as fact.
    const fetchFn = jest.fn().mockResolvedValue(bad(500, { error: 'boom' }));
    const result = await fetchQueue({ fetchFn, apiBase: 'https://api/', gameId: '1234' });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/boom/);
  });

  test('a network failure is reported, not thrown', async () => {
    const fetchFn = jest.fn().mockRejectedValue(new Error('Failed to fetch'));
    const result = await fetchQueue({ fetchFn, apiBase: 'https://api/', gameId: '1234' });
    expect(result).toMatchObject({ ok: false, error: 'Failed to fetch' });
  });

  test('the game id is encoded', async () => {
    // rejects: string interpolation straight into the path.
    const fetchFn = jest.fn().mockResolvedValue(ok({ queue: [], version: 0 }));
    await fetchQueue({ fetchFn, apiBase: 'https://api/', gameId: 'a b/c' });
    expect(fetchFn.mock.calls[0][0]).toBe('https://api/games/a%20b%2Fc/queue');
  });
});

describe('changing the running order', () => {
  test('one op is sent, with the version we last saw', async () => {
    // rejects: posting the whole array. Two host surfaces are live and the
    // phone is stale by construction — a snapshot write silently discards the
    // other surface's edit. `expectedVersion` is what reports the disagreement.
    const fetchFn = jest.fn().mockResolvedValue(ok({ queue: ['c1#2', 'c1#1'], version: 8, changed: true }));
    await postQueueOp({
      fetchFn, apiBase: 'https://api/', gameId: '1234',
      op: 'earlier', questionKey: 'c1#2', expectedVersion: 7,
    });

    const [, init] = fetchFn.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ op: 'earlier', questionKey: 'c1#2', expectedVersion: 7 });
  });

  test('a refusal is a SUCCESS carrying its reason', async () => {
    // rejects: mapping `changed: false` onto `ok: false`. The host pressed ↑ on
    // the first row; the list in front of them already shows why nothing moved.
    const fetchFn = jest.fn().mockResolvedValue(
      ok({ queue: ['c1#1'], version: 3, changed: false, refused: 'at-edge' }),
    );
    const result = await postQueueOp({
      fetchFn, apiBase: 'https://api/', gameId: '1234', op: 'earlier', questionKey: 'c1#1',
    });

    expect(result.ok).toBe(true);
    expect(result.changed).toBe(false);
    expect(result.refused).toBe('at-edge');
    // And nothing to say out loud: the cause is visible on screen.
    expect(result.message).toBeNull();
  });

  test('only a full queue is worth interrupting the host for', () => {
    // rejects: a message for every refusal, which trains a host to dismiss
    // them — including the one that matters. `full` is the only refusal whose
    // cause is not already on the surface that produced the press.
    expect(refusalMessage('full')).toMatch(/24/);
    expect(refusalMessage('at-edge')).toBeNull();
    expect(refusalMessage('duplicate')).toBeNull();
    expect(refusalMessage('not-queued')).toBeNull();
    expect(refusalMessage(null)).toBeNull();
  });

  test('changed: false survives the projection', async () => {
    // rejects: `body.changed || null`, which turns a real `false` into null and
    // makes a refusal indistinguishable from a server that did not say.
    const fetchFn = jest.fn().mockResolvedValue(
      ok({ queue: [], version: 0, changed: false, refused: 'not-queued' }),
    );
    const result = await postQueueOp({
      fetchFn, apiBase: 'https://api/', gameId: '1234', op: 'remove', questionKey: 'c1#9',
    });
    expect(result.changed).toBe(false);
    expect(result.changed).not.toBeNull();
  });

  test('a stale view is reported without failing the op', async () => {
    const fetchFn = jest.fn().mockResolvedValue(
      ok({ queue: ['c1#1'], version: 9, changed: true, staleView: true }),
    );
    const result = await postQueueOp({
      fetchFn, apiBase: 'https://api/', gameId: '1234', op: 'add', questionKey: 'c1#1', expectedVersion: 2,
    });
    expect(result.ok).toBe(true);
    expect(result.staleView).toBe(true);
    expect(result.queue).toEqual(['c1#1']);
  });

  test('a refused POST reports the error and NO queue', async () => {
    // `queue: null` rather than `[]` — the caller rolls back to what it had,
    // and an empty array here would roll it back to nothing.
    const fetchFn = jest.fn().mockResolvedValue(bad(403, { error: 'Forbidden' }));
    const result = await postQueueOp({
      fetchFn, apiBase: 'https://api/', gameId: '1234', op: 'add', questionKey: 'c1#1',
    });

    expect(result.ok).toBe(false);
    expect(result.queue).toBeNull();
    expect(result.error).toMatch(/Forbidden/);
  });

  test('a 200 with an unreadable body is a LANDED write', async () => {
    // rejects: treating an unparseable 200 as a failure. The handler ran and
    // the write landed; telling the host it failed invites a second press, and
    // a second `earlier` moves the row twice while a second `add` duplicates.
    const fetchFn = jest.fn().mockResolvedValue(unreadable());
    const result = await postQueueOp({
      fetchFn, apiBase: 'https://api/', gameId: '1234', op: 'earlier', questionKey: 'c1#1',
    });

    expect(result.ok).toBe(true);
    expect(result.error).toBeNull();
    // …but we cannot say what the list looks like now, so we say that instead
    // of guessing. The caller re-reads.
    expect(result.queue).toBeNull();
    expect(result.stale).toBe(true);
  });

  test('an unreadable body on a READ is a failure, not an empty queue', async () => {
    // The asymmetry with the case above is the point: a POST that 200s has
    // changed something; a GET that 200s unreadably has told us nothing.
    const fetchFn = jest.fn().mockResolvedValue(unreadable());
    const result = await fetchQueue({ fetchFn, apiBase: 'https://api/', gameId: '1234' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/could not be read/i);
  });
});
