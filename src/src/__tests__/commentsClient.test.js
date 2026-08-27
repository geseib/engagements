/**
 * THE THREE CALLS A FEEDBACK ROUND MAKES.
 *
 * The rule this file exists to hold: NOTHING HERE THROWS. A rejected promise on
 * the participant's surface is a blank screen mid-session, and `postComment` is
 * holding prose that exists nowhere else — its caller has to be able to keep the
 * words and show the reason, which it cannot do from inside a catch it did not
 * write.
 */
import { postComment, fetchFeedbackRound, fetchComments } from '../utils/commentsClient';

const API = 'https://api.test/dev/';

const ok = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

describe('postComment', () => {
  test('posts the anchor exactly as the section supplied it', async () => {
    const fetchFn = jest.fn().mockResolvedValue(ok({ comment: { commentId: 'c1' } }, 201));
    await postComment({
      fetchFn, apiBase: API, gameId: '4821',
      questionNumber: '003', playerName: 'Ada',
      anchorKind: 'response', anchorRef: '1',
      anchorLabel: 'Response 2 — Sam', anchorExcerpt: 'Re-price the package',
      text: 'Only this one touches the customer.',
    });

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.test/dev/games/4821/comments');
    expect(init.method).toBe('POST');
    // The body is compared against an object built here, field by field —
    // not against anything read back out of the call.
    expect(JSON.parse(init.body)).toEqual({
      questionNumber: '003',
      playerName: 'Ada',
      anchorKind: 'response',
      anchorRef: '1',
      anchorLabel: 'Response 2 — Sam',
      anchorExcerpt: 'Re-price the package',
      text: 'Only this one touches the customer.',
    });
  });

  test('a public route, so it must not carry an Authorization header', async () => {
    /*
      `authFetch` would 401 every phone in the room: participants hold no
      Cognito identity, which is why this route is public in the first place.
      What IS closed is opening the round — POST /stage-beat, from the host.
    */
    const fetchFn = jest.fn().mockResolvedValue(ok({}, 201));
    await postComment({ fetchFn, apiBase: API, gameId: '4821', text: 'x' });
    const [, init] = fetchFn.mock.calls[0];
    expect(Object.keys(init.headers)).toEqual(['Content-Type']);
  });

  test('a network failure resolves rather than rejecting', async () => {
    const fetchFn = jest.fn().mockRejectedValue(new Error('offline'));
    await expect(postComment({ fetchFn, apiBase: API, gameId: '4821', text: 'x' }))
      .resolves.toEqual(expect.objectContaining({ ok: false }));
  });

  test('the server’s own reason is preferred over a generic one', async () => {
    const fetchFn = jest.fn().mockResolvedValue(
      ok({ error: 'the host has not opened a feedback round' }, 409),
    );
    const res = await postComment({ fetchFn, apiBase: API, gameId: '4821', text: 'x' });
    expect(res).toEqual(expect.objectContaining({
      ok: false, error: 'the host has not opened a feedback round',
    }));
  });

  test('a 409 with no readable body still reads as a closed round', async () => {
    const fetchFn = jest.fn().mockResolvedValue({
      ok: false, status: 409, json: async () => { throw new Error('nope'); },
    });
    const res = await postComment({ fetchFn, apiBase: API, gameId: '4821', text: 'x' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/closed this round/i);
  });

  test('a 201 whose body will not parse still counts as posted', async () => {
    // Reporting a failure here would invite the participant to post it twice.
    const fetchFn = jest.fn().mockResolvedValue({
      ok: true, status: 201, json: async () => { throw new Error('nope'); },
    });
    expect(await postComment({ fetchFn, apiBase: API, gameId: '4821', text: 'x' }))
      .toEqual(expect.objectContaining({ ok: true }));
  });
});

describe('fetchFeedbackRound', () => {
  test('returns the one round the host opened', async () => {
    const fetchFn = jest.fn().mockResolvedValue(ok({
      questionNumber: '003', round: { questionNumber: '003', comments: [] },
    }));
    const res = await fetchFeedbackRound({ fetchFn, apiBase: API, gameId: '4821' });
    expect(fetchFn.mock.calls[0][0]).toBe('https://api.test/dev/games/4821/feedback-round');
    expect(res.ok).toBe(true);
    expect(res.questionNumber).toBe('003');
    expect(res.notOpen).toBe(false);
  });

  test('a 409 is the ordinary "no feedback round open", not an error', async () => {
    /*
      This is the common case — most of a session is not a feedback round — and
      treating it as a failure would put an error on forty phones for the
      majority of the time they are on this page.
    */
    const fetchFn = jest.fn().mockResolvedValue(ok({ error: 'not open' }, 409));
    const res = await fetchFeedbackRound({ fetchFn, apiBase: API, gameId: '4821' });
    expect(res).toEqual(expect.objectContaining({
      ok: true, round: null, notOpen: true, error: null,
    }));
  });

  test('a real failure says so and returns no round', async () => {
    const fetchFn = jest.fn().mockResolvedValue(ok({}, 500));
    const res = await fetchFeedbackRound({ fetchFn, apiBase: API, gameId: '4821' });
    expect(res.ok).toBe(false);
    expect(res.round).toBeNull();
  });
});

describe('fetchComments', () => {
  test('scopes to one round when given one', async () => {
    const fetchFn = jest.fn().mockResolvedValue(ok({ comments: [{ commentId: 'c1' }] }));
    const res = await fetchComments({
      fetchFn, apiBase: API, gameId: '4821', questionNumber: '003',
    });
    expect(fetchFn.mock.calls[0][0]).toBe('https://api.test/dev/games/4821/comments?questionNumber=003');
    expect(res.comments).toHaveLength(1);
  });

  test('reads the session when given no round', async () => {
    const fetchFn = jest.fn().mockResolvedValue(ok({ comments: [] }));
    await fetchComments({ fetchFn, apiBase: API, gameId: '4821' });
    expect(fetchFn.mock.calls[0][0]).toBe('https://api.test/dev/games/4821/comments');
  });

  test('a failure reports itself rather than an empty list', async () => {
    /*
      The distinction the caller needs: "there are no comments" and "I could not
      read the comments" look identical if both return `[]`, and the second one
      must not wipe what is already on screen. A room's comments vanishing on
      one flaky GET is worse than comments that are a few seconds stale.
    */
    const fetchFn = jest.fn().mockResolvedValue(ok({}, 500));
    const res = await fetchComments({ fetchFn, apiBase: API, gameId: '4821' });
    expect(res.ok).toBe(false);
    expect(res.comments).toEqual([]);
  });
});
