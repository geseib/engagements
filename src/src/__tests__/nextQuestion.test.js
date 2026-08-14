/**
 * "Failed to start next question" — and then the next question appeared.
 *
 * Reported from a live session on a 100-question set. Both halves were true:
 * the round advanced and the message said it had not. These tests pin the two
 * faults that produced it, in a module rather than in the component, because
 * GameHostPage.jsx cannot be mounted in jsdom — its suite is one of the five
 * that have never run, so nothing in the component could have caught this.
 */
import { describeFailure, requestNextQuestion } from '../utils/nextQuestion';

/** A response whose body reads as whatever it was given. */
const res = (status, body, { throwOnText = false } = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => {
    if (throwOnText) throw new Error('body unreadable');
    return body;
  },
  json: async () => JSON.parse(body),
});

describe('reading a failure without becoming one', () => {
  // rejects: THE REPORTED BUG. The old code read the error body with
  //          `await res.json()`, so a gateway timeout — which returns HTML, not
  //          this API's error shape — threw, and the throw was caught by the
  //          handler's outer catch, which blamed the advance. The one case with
  //          something useful to say was the case that said nothing.
  test('an HTML gateway error is described, not thrown', async () => {
    const html = '<html><body><h1>504 Gateway Timeout</h1>Endpoint request timed out</body></html>';
    await expect(describeFailure(res(504, html))).resolves.toMatch(/timed out/i);
    await expect(describeFailure(res(504, html))).resolves.toMatch(/HTTP 504/);
  });

  // rejects: losing the server's own words when it DID speak this API's format.
  test("the API's own error message is preferred", async () => {
    const out = await describeFailure(res(409, JSON.stringify({ error: 'No questions remain' })));
    expect(out).toMatch(/No questions remain/);
    expect(out).toMatch(/HTTP 409/);
  });

  // rejects: returning an empty string for an empty 502, which reaches the host
  //          as "Failed: " with nothing after it.
  test('an empty body still names the status', async () => {
    await expect(describeFailure(res(502, ''))).resolves.toBe('HTTP 502');
  });

  // rejects: a reader that throws on a body it cannot read at all — the same
  //          class of fault as the original, one layer down.
  test('a body that cannot be read does not throw', async () => {
    await expect(describeFailure(res(500, '', { throwOnText: true }))).resolves.toBe('HTTP 500');
  });

  // rejects: pasting an entire HTML error page into an alert in front of a room.
  test('a long body is flattened and clipped', async () => {
    const out = await describeFailure(res(500, `${'x'.repeat(500)}\n\n   y`));
    expect(out.length).toBeLessThan(260);
    expect(out).not.toMatch(/\n/);
  });
});

describe('what the host is told about the round', () => {
  const ok = (data) => ({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) });

  // rejects: reporting a successful advance as anything else.
  test('a good response advances', async () => {
    const out = await requestNextQuestion({
      fetchFn: async () => ok({ questionId: 'q2', lessonNumber: 2, state: 'ASK#002' }),
      apiBase: '/api/', gameId: 'ABCD',
    });
    expect(out.advanced).toBe(true);
    expect(out.data.state).toBe('ASK#002');
    expect(out.error).toBeNull();
  });

  // rejects: telling the host to retry a round that already moved. THIS IS THE
  //          HARM. A 2xx means the handler ran and the backend has broadcast the
  //          new question; pressing Next again skips one, live, in front of a
  //          room. An unreadable body is worth reporting and is not worth
  //          re-pressing, so it stays `advanced: true` with the reason attached.
  test('a 2xx with an unreadable body still counts as advanced', async () => {
    const out = await requestNextQuestion({
      fetchFn: async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } }),
      apiBase: '/api/', gameId: 'ABCD',
    });
    expect(out.advanced).toBe(true);
    expect(out.error).toMatch(/advanced/i);
  });

  // rejects: swallowing a real failure as success. A non-OK response means the
  //          round did NOT move, and the host does need to press again.
  test('a non-OK response did not advance, and carries the reason', async () => {
    const out = await requestNextQuestion({
      fetchFn: async () => res(504, '<html>Endpoint request timed out</html>'),
      apiBase: '/api/', gameId: 'ABCD',
    });
    expect(out.advanced).toBe(false);
    expect(out.error).toMatch(/timed out/i);
  });

  // rejects: a network failure escaping as an exception, which is what the
  //          component's outer catch used to turn into a generic message.
  test('a request that never lands is a clean did-not-advance', async () => {
    const out = await requestNextQuestion({
      fetchFn: async () => { throw new Error('NetworkError: connection lost'); },
      apiBase: '/api/', gameId: 'ABCD',
    });
    expect(out.advanced).toBe(false);
    expect(out.error).toMatch(/connection lost/);
  });
});
