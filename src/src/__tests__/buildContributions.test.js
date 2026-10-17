/**
 * WHAT THE ROOM GAVE, AND WHAT REACHED CLAUDE (docs/design/parity/PLAN.md §2.8,
 * H2): `contributionsOf` and `askOutcome` in buildroom/buildScreens.js.
 *
 * Owner, 16 Oct 2026: "history needs to include user contributions that are
 * used. same for any asks. we need to mark them if we send some version to
 * claude." Rulings: an idea only put on the wall is not "used" (Q13); any
 * change to the words is "reworded" (Q14); no names on History (Q15).
 *
 * Every fixture goes through the REAL server's `roomFromRows` and `hostView`,
 * so these read exactly the shape GET build/state answers with.
 */
import { contributionsOf, askOutcome } from '../buildroom/buildScreens';

const S = require('../../../lambda-functions/game/build-store');

const at = (n) => new Date(Date.UTC(2026, 9, 16, 10, n)).toISOString();

function room({ asks = [], resps = [], answers = [], logs = [], ideas = [], state = 'STARTED' } = {}) {
  const rows = [
    { SK: 'BUILD#STATE', Rev: 1, Phase: 'building' },
    ...asks.map((a) => ({ SK: `BUILD#ASK#${a.AskId}`, Source: 'host', CreatedAt: at(1), Options: [], ...a })),
    ...resps.map((r) => ({ SK: `BUILD#RESP#${r.AskId}#${r.RespId}`, Source: 'player', CreatedAt: at(2), ...r })),
    ...answers.map((a) => ({ SK: `BUILD#ANS#${a.AskId}#${a.PlayerName}`, CreatedAt: at(3), ...a })),
    ...logs.map((l, i) => ({ SK: `BUILD#LOG#${String(i).padStart(13, '0')}#x${i}`, LogId: `${i}-x${i}`, By: 'host', CreatedAt: at(10 + i), ...l })),
    ...ideas.map((d, i) => ({ SK: `BUILD#IDEA#${String(i).padStart(13, '0')}#i${i}`, IdeaId: d.IdeaId || `${i}-i${i}`, Status: 'new', PlayerName: 'Priya', CreatedAt: at(5 + i), ...d })),
  ];
  return S.hostView({ gameId: '4821', meta: { Title: 'Sign-up' }, sessionState: state, room: S.roomFromRows(rows), players: ['Priya', 'Marcus'], now: at(30) });
}

const one = (r, ideaId) => contributionsOf(r).find((c) => c.ideaId === ideaId);

describe('contributionsOf: an idea sent to Claude', () => {
  test('sent as written: stamped by the server (H1)', () => {
    const r = room({
      ideas: [{ IdeaId: 'i1', Text: 'Add a map of the parking', Status: 'promoted', PromotedVia: 'claude' }],
      logs: [{ Kind: 'idea', Text: 'Add a map of the parking', By: 'room', ForAgent: true, ForAgentAs: 'do-now', IdeaId: 'i1', AsWritten: true }],
    });
    expect(one(r, 'i1')).toEqual({
      ideaId: 'i1', text: 'Add a map of the parking', from: 'room', at: at(5),
      mark: 'sent', chosen: null, asWritten: true, askId: null, logId: '0-x0', alsoIn: [],
    });
  });

  test('saved for later: held, nothing sent', () => {
    const r = room({
      ideas: [{ IdeaId: 'i1', Text: 'Sign up as a pair', Status: 'promoted', PromotedVia: 'claude' }],
      logs: [{ Kind: 'idea', Text: 'Sign up as a pair', By: 'room', ForAgentAs: 'later', IdeaId: 'i1', AsWritten: true }],
    });
    expect(one(r, 'i1').mark).toBe('later');
  });

  test('an older session (no stamps): "sent", never claimed as written', () => {
    const r = room({
      ideas: [{ IdeaId: 'i1', Text: 'Bigger buttons', Status: 'promoted', PromotedVia: 'claude' }],
      logs: [{ Kind: 'idea', Text: 'Bigger buttons', By: 'room', ForAgent: true, ForAgentAs: 'do-now' }],
    });
    const c = one(r, 'i1');
    expect([c.mark, c.asWritten, c.logId]).toEqual(['sent', null, '0-x0']);
  });

  test('a direction the host wrote from it in other words: reworded', () => {
    const r = room({
      ideas: [{ IdeaId: 'i1', Text: 'Show the shifts as a calendar' }],
      logs: [{ Kind: 'direction', Text: 'Show the shifts as a weekly calendar', ForAgent: true, ForAgentAs: 'do-now', From: { AskIds: [], IdeaIds: ['i1'] }, AsWritten: false }],
    });
    const c = one(r, 'i1');
    expect([c.mark, c.asWritten, c.logId]).toEqual(['reworded', false, '0-x0']);
  });

  test('a direction in the idea\'s own words: sent as written', () => {
    const r = room({
      ideas: [{ IdeaId: 'i1', Text: 'Show the shifts as a calendar' }],
      logs: [{ Kind: 'direction', Text: 'Show the shifts as a calendar', ForAgent: true, ForAgentAs: 'do-now', From: { AskIds: [], IdeaIds: ['i1'] }, AsWritten: true }],
    });
    expect([one(r, 'i1').mark, one(r, 'i1').asWritten]).toEqual(['sent', true]);
  });
});

describe('contributionsOf: an idea put to the room', () => {
  const VOTE = {
    AskId: '002', Kind: 'choice', Prompt: 'Which should Claude build next?', Status: 'decided', DecidedAt: at(20),
    FromIdeas: ['i1', 'i2'],
    Options: [{ label: 'A', title: 'Text a reminder', ideaId: 'i1' }, { label: 'B', title: 'A map at the top', ideaId: 'i2' }],
  };
  const voted = (decision, ask = VOTE) => room({
    asks: [{ ...ask, Decision: decision }],
    answers: [{ AskId: '002', PlayerName: 'Priya', Choice: ['B'] }, { AskId: '002', PlayerName: 'Marcus', Choice: ['B'] }],
    ideas: [
      { IdeaId: 'i1', Text: 'Text a reminder', Status: 'promoted', PromotedTo: '002' },
      { IdeaId: 'i2', Text: 'A map at the top', Status: 'promoted', PromotedTo: '002' },
    ],
  });

  test('the winner, sent in its default words: chosen, sent; the loser: not chosen', () => {
    const r = voted({ direction: 'Which should Claude build next: A map at the top', chosen: ['B'], sendToAgent: true, method: 'vote', reworded: false });
    expect([one(r, 'i2').mark, one(r, 'i2').chosen, one(r, 'i2').askId]).toEqual(['sent', true, '002']);
    expect([one(r, 'i1').mark, one(r, 'i1').chosen]).toEqual(['not-chosen', false]);
  });

  test('the winner, reworded by the host', () => {
    const r = voted({ direction: 'A big map, top right', chosen: ['B'], sendToAgent: true, method: 'vote', reworded: true });
    expect([one(r, 'i2').mark, one(r, 'i2').chosen]).toEqual(['reworded', true]);
  });

  test('the winner, recorded only: not sent', () => {
    const r = voted({ direction: 'Which should Claude build next: A map at the top', chosen: ['B'], sendToAgent: false, method: 'vote' });
    expect(one(r, 'i2').mark).toBe('not-sent');
  });

  test('the winner, held for later', () => {
    const r = voted({ direction: 'x', chosen: ['B'], sendToAgent: true, method: 'vote', as: 'later', heldForLater: true });
    expect(one(r, 'i2').mark).toBe('later');
  });

  test('the vote still open: in a vote, no verdict yet', () => {
    const r = voted(undefined, { ...VOTE, Status: 'live', DecidedAt: undefined });
    expect([one(r, 'i1').mark, one(r, 'i1').chosen]).toEqual(['pending', null]);
  });

  test('a vote still waiting to open (mockups first): the room has not seen it, so it is not on History yet', () => {
    const r = voted(undefined, { ...VOTE, Status: 'proposed', DecidedAt: undefined, AskForMockups: true });
    expect(contributionsOf(r)).toEqual([]);
  });

  test('an older vote (options carry no idea id): matched by the order the ideas went in', () => {
    const old = { ...VOTE, Options: VOTE.Options.map(({ ideaId, ...o }) => o) };
    const r = voted({ direction: 'Which should Claude build next: A map at the top', chosen: ['B'], sendToAgent: true, method: 'vote' }, old);
    expect([one(r, 'i2').chosen, one(r, 'i2').mark, one(r, 'i2').asWritten]).toEqual([true, 'sent', null]);
    expect(one(r, 'i1').chosen).toBe(false);
  });

  test('an idea added to an Ideas ask that won, through its suggestion', () => {
    const r = room({
      asks: [{ AskId: '003', Kind: 'suggest', Prompt: 'What goes first?', Status: 'decided', DecidedAt: at(20), Decision: { direction: 'What goes first: The address', chosen: ['r9'], sendToAgent: true, method: 'vote', reworded: false } }],
      resps: [{ AskId: '003', RespId: 'r9', Text: 'The address', Source: 'idea', IdeaId: 'i1', PlayerName: 'Priya' }, { AskId: '003', RespId: 'r2', Text: 'The date', PlayerName: 'Marcus' }],
      ideas: [{ IdeaId: 'i1', Text: 'The address', Status: 'promoted', PromotedVia: 'ideas' }],
    });
    expect([one(r, 'i1').mark, one(r, 'i1').chosen, one(r, 'i1').askId]).toEqual(['sent', true, '003']);
  });

  test('a decision recorded only, then combined into a direction: a version went, reworded', () => {
    const r = room({
      asks: [{ ...VOTE, Decision: { direction: 'Which should Claude build next: A map at the top', chosen: ['B'], sendToAgent: false, method: 'vote' } }],
      answers: [{ AskId: '002', PlayerName: 'Priya', Choice: ['B'] }],
      ideas: [{ IdeaId: 'i2', Text: 'A map at the top', Status: 'promoted', PromotedTo: '002' }],
      logs: [{ Kind: 'direction', Text: 'Which should Claude build next? A map at the top\nAnd keep it simple', ForAgent: true, ForAgentAs: 'do-now', From: { AskIds: ['002'], IdeaIds: [] }, AsWritten: false }],
    });
    expect([one(r, 'i2').mark, one(r, 'i2').alsoIn]).toEqual(['reworded', ['0-x0']]);
  });

  test('a decision sent, then combined again: stays sent, and says where else it went', () => {
    const r = room({
      asks: [{ ...VOTE, Decision: { direction: 'Which should Claude build next: A map at the top', chosen: ['B'], sendToAgent: true, method: 'vote', reworded: false } }],
      answers: [{ AskId: '002', PlayerName: 'Priya', Choice: ['B'] }],
      ideas: [{ IdeaId: 'i2', Text: 'A map at the top', Status: 'promoted', PromotedTo: '002' }],
      logs: [{ Kind: 'direction', Text: 'Combined', ForAgent: true, ForAgentAs: 'do-now', From: { AskIds: ['002'], IdeaIds: [] }, AsWritten: false }],
    });
    expect([one(r, 'i2').mark, one(r, 'i2').alsoIn]).toEqual(['sent', ['0-x0']]);
  });
});

describe('contributionsOf: what is not a contribution', () => {
  test('new, later, dismissed, acknowledged and put-on-the-wall ideas are not "used" (Q13)', () => {
    const r = room({
      ideas: [
        { IdeaId: 'a', Text: 'new one' },
        { IdeaId: 'b', Text: 'set aside', Status: 'later' },
        { IdeaId: 'c', Text: 'no', Status: 'dismissed' },
        { IdeaId: 'd', Text: 'nice buttons', Status: 'acknowledged', WalledAt: at(9) },
      ],
    });
    expect(contributionsOf(r)).toEqual([]);
  });

  test('never a name, in any field', () => {
    const r = room({
      ideas: [{ IdeaId: 'i1', Text: 'Add a map', Status: 'promoted', PromotedVia: 'claude', PlayerName: 'Priya' }],
      logs: [{ Kind: 'idea', Text: 'Add a map', Detail: 'from Priya', By: 'room', ForAgent: true, IdeaId: 'i1', AsWritten: true }],
    });
    expect(JSON.stringify(contributionsOf(r))).not.toMatch(/Priya/);
  });

  test('the host\'s own queued idea says so', () => {
    const r = room({
      ideas: [{ IdeaId: 'h1', Text: 'Check it on a phone', Status: 'promoted', PromotedVia: 'claude', Source: 'host' }],
      logs: [{ Kind: 'idea', Text: 'Check it on a phone', ForAgent: true, IdeaId: 'h1', AsWritten: true }],
    });
    expect(one(r, 'h1').from).toBe('host');
  });

  test('oldest first; an empty room gives nothing', () => {
    expect(contributionsOf(null)).toEqual([]);
    const r = room({
      ideas: [
        { IdeaId: 'late', Text: 'second', Status: 'promoted', PromotedVia: 'claude', CreatedAt: at(8) },
        { IdeaId: 'early', Text: 'first', Status: 'promoted', PromotedVia: 'claude', CreatedAt: at(6) },
      ],
    });
    expect(contributionsOf(r).map((c) => c.ideaId)).toEqual(['early', 'late']);
  });
});

describe('askOutcome: every ask that went to the room', () => {
  const ASK = { AskId: '005', Kind: 'choice', Prompt: 'Which colour?', Options: [{ label: 'A', title: 'Green' }, { label: 'B', title: 'Blue' }] };
  const outcome = (ask, extra = {}) => {
    const r = room({ asks: [{ ...ASK, ...ask }], ...extra });
    return askOutcome(r.asks[0], r);
  };

  test('decided and sent in its words; reworded; recorded only; held', () => {
    expect(outcome({ Status: 'decided', Decision: { direction: 'Which colour: Green', chosen: ['A'], sendToAgent: true, reworded: false } })).toEqual({ mark: 'sent', reworded: false, alsoIn: [] });
    expect(outcome({ Status: 'decided', Decision: { direction: 'Greenish', chosen: ['A'], sendToAgent: true, reworded: true } }).mark).toBe('reworded');
    expect(outcome({ Status: 'decided', Decision: { direction: 'x', chosen: ['A'], sendToAgent: false } }).mark).toBe('not-sent');
    expect(outcome({ Status: 'decided', Decision: { direction: 'x', chosen: ['A'], sendToAgent: true, heldForLater: true } }).mark).toBe('later');
  });

  test('an older decision with no stamp is "sent", reworded unknown', () => {
    expect(outcome({ Status: 'decided', Decision: { direction: 'Which colour: Green', chosen: ['A'], sendToAgent: true } })).toEqual({ mark: 'sent', reworded: null, alsoIn: [] });
  });

  test('still with the room: pending; closed with no decision once the session ended: not sent', () => {
    expect(outcome({ Status: 'live' }).mark).toBe('pending');
    expect(outcome({ Status: 'results' }).mark).toBe('pending');
    const r = room({ asks: [{ ...ASK, Status: 'results' }], state: 'ENDED' });
    expect(askOutcome(r.asks[0], r).mark).toBe('not-sent');
  });

  test('cancelled after it was opened: not sent; never opened (proposed): not an ask the room saw', () => {
    expect(outcome({ Status: 'discarded', OpenedAt: at(4) }).mark).toBe('not-sent');
    expect(outcome({ Status: 'proposed' })).toBeNull();
    expect(outcome({ Status: 'discarded' })).toBeNull();
  });

  test('recorded only, then combined into a direction: reworded, and where it went', () => {
    const o = outcome(
      { Status: 'decided', Decision: { direction: 'x', chosen: ['A'], sendToAgent: false } },
      { logs: [{ Kind: 'direction', Text: 'Combined', ForAgent: true, From: { AskIds: ['005'], IdeaIds: [] }, AsWritten: false }] },
    );
    expect(o).toEqual({ mark: 'reworded', reworded: true, alsoIn: ['0-x0'] });
  });
});
