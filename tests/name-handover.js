/**
 * ONE EXCHANGE OF A NAME, GRANTED BY THE HOST.
 *
 * `join-name-collision.js` proves the refusal. This file proves the way out of
 * it, and the way out is the only thing in the product that lets a browser take
 * a name a different browser provably holds — so every guard on it is asserted
 * here rather than assumed.
 *
 * The owner's design constraint is the last sentence of the request, and it is
 * why nothing here is automatic: *"they need the choice though because they may
 * have just mistakenly picked the same name."* A clash is as likely to be two
 * different people as one person on a new laptop, and only the host can see
 * which. So:
 *
 *   §1  the DECISION — a grant plus the person's own "yes" is required, and
 *       neither alone is enough. Asserted on `classifyRejoin` directly.
 *   §2  ASKING — unauthenticated by necessity, grants nothing, is not a roster
 *       probe, and cannot create a player row.
 *   §3  GRANTING — host-only in the template, bound or open, refuses to bind
 *       when nobody asked, never upserts.
 *   §4  SPENDING, AND THE ONE-SHOT RULE. Two claimants genuinely interleaved
 *       against a single grant; exactly one gets in. This is the assertion the
 *       whole design of the data model exists to make possible — see
 *       handover.js's header on why the grant lives on the player row.
 *   §5  the window closes on its own, so an unclaimed grant is not a permanent
 *       hole in the room's identity.
 *   §6  a handover carries the answers and the score across, which is the
 *       point of it ("useful if they change devices, or browsers").
 *   §7  the capability is not published. `HandoverRequestedBy` is a clientId,
 *       and a clientId is what get-answers.js accepts as proof of identity.
 */
const path = require('path');
const assert = require('assert');
const fs = require('fs');

const REPO = path.join(__dirname, '..');

const { createTable, installStubs } = require('./helpers/player-table');

const table = createTable();
const store = table.store;
const key = table.keyOf;
const sent = [];

installStubs({ table, sent });

process.env.TABLE_NAME = 'test-table';

const joinGame = require(path.join(REPO, 'lambda-functions/game/join-game.js'));
const { classifyRejoin } = joinGame;
const requestHandover = require(path.join(REPO, 'lambda-functions/game/request-handover.js'));
const grantHandover = require(path.join(REPO, 'lambda-functions/game/grant-handover.js'));
const getPlayers = require(path.join(REPO, 'lambda-functions/game/get-players.js'));
const { HANDOVER_WINDOW_SECONDS, handoverOpenFor, publicHandoverState } = require(
  path.join(REPO, 'lambda-functions/game/handover.js')
);

/* ---- Harness -------------------------------------------------------------- */

let pass = 0, fail = 0;
async function check(label, fn) {
  try { await fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const GAME = '4821';
const PK = `GAME#${GAME}`;

function reset({ visibility = 'public', accessCode = null } = {}) {
  table.clear();
  sent.length = 0;
  store.set(key(PK, 'METADATA'), {
    PK, SK: 'METADATA', Started: true, Visibility: visibility, AccessCode: accessCode,
  });
  store.set(key(PK, 'CONNECTION#host-1'), {
    PK, SK: 'CONNECTION#host-1', ConnectionId: 'host-1', ConnectionType: 'HOST',
  });
}

const join = (body) => joinGame.handler({
  pathParameters: { gameId: GAME }, body: JSON.stringify(body),
});
const ask = (playerName, body) => requestHandover.handler({
  pathParameters: { gameId: GAME, playerName }, body: JSON.stringify(body || {}),
});
const grant = (playerName, body) => grantHandover.handler({
  pathParameters: { gameId: GAME, playerName }, body: JSON.stringify(body || {}),
});
const roster = () => getPlayers.handler({ pathParameters: { gameId: GAME } });

const bodyOf = (res) => JSON.parse(res.body);
const playerRow = (name) => store.get(key(PK, `PLAYER#${name}`));

/* ---- Cases ---------------------------------------------------------------- */

(async () => {
  console.log('\nname handover');

  /* --- §1 the decision ----------------------------------------------------- */

  await check('§1 a grant alone does not move a name — the person must say yes too', () => {
    // Without this, an unlocked name is taken by whoever types it next,
    // including the innocent third Chris who knows nothing about a handover.
    assert.strictEqual(
      classifyRejoin({ storedClientId: 'a', clientId: 'b', claimExisting: false, handoverOpen: true }),
      'collision'
    );
  });

  await check('§1 a claim alone does not move a name — the host must grant it', () => {
    // This is the silent merge. If `claimExisting` were sufficient, every
    // guarantee join-name-collision.js makes would be one POST body away.
    assert.strictEqual(
      classifyRejoin({ storedClientId: 'a', clientId: 'b', claimExisting: true, handoverOpen: false }),
      'collision'
    );
  });

  await check('§1 grant plus claim is the handover, and nothing else is', () => {
    assert.strictEqual(
      classifyRejoin({ storedClientId: 'a', clientId: 'b', claimExisting: true, handoverOpen: true }),
      'handover'
    );
  });

  await check('§1 an anonymous claimant can never spend a grant', () => {
    // A row owned by nobody is the `unverified` state, not this feature; and a
    // handover whose end state is an unowned row would leave the name open to
    // the next person too.
    assert.strictEqual(
      classifyRejoin({ storedClientId: 'a', clientId: null, claimExisting: true, handoverOpen: true }),
      'collision'
    );
  });

  await check('§1 the owner reconnecting is still a reconnect, grant or no grant', () => {
    assert.strictEqual(
      classifyRejoin({ storedClientId: 'a', clientId: 'a', claimExisting: true, handoverOpen: true }),
      'reconnect'
    );
  });

  await check('§1 handoverOpenFor refuses a lapsed, a mismatched and an absent grant', () => {
    const future = Math.floor(Date.now() / 1000) + 60;
    const past = Math.floor(Date.now() / 1000) - 60;
    assert.strictEqual(handoverOpenFor({ HandoverExpiresAt: future }, 'b'), true);
    assert.strictEqual(handoverOpenFor({ HandoverExpiresAt: past }, 'b'), false, 'a lapsed grant was spendable');
    assert.strictEqual(handoverOpenFor({}, 'b'), false);
    assert.strictEqual(
      handoverOpenFor({ HandoverExpiresAt: future, HandoverForClientId: 'asker' }, 'someone-else'),
      false, 'a bound grant was spendable by a stranger'
    );
    assert.strictEqual(
      handoverOpenFor({ HandoverExpiresAt: future, HandoverForClientId: 'asker' }, 'asker'),
      true
    );
  });

  /* --- §2 asking ----------------------------------------------------------- */

  await check('§2 asking records the request and pings the host', async () => {
    reset();
    await join({ playerName: 'Chris', clientId: 'chris-old-laptop' });
    sent.length = 0;

    const res = await ask('Chris', { clientId: 'chris-new-laptop' });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(playerRow('Chris').HandoverRequestedBy, 'chris-new-laptop');
    assert.ok(playerRow('Chris').HandoverRequestedAt, 'no timestamp for the host to judge staleness by');

    const pings = sent.filter((m) => m.type === 'handoverRequested');
    assert.strictEqual(pings.length, 1, 'the host was not told');
    assert.strictEqual(pings[0].playerName, 'Chris');
  });

  await check('§2 asking grants nothing', async () => {
    reset();
    await join({ playerName: 'Chris', clientId: 'chris-old-laptop' });
    await ask('Chris', { clientId: 'chris-new-laptop' });

    // The whole asymmetry of the feature: the asker cannot open their own door.
    assert.strictEqual(playerRow('Chris').HandoverExpiresAt, undefined);
    const res = await join({ playerName: 'Chris', clientId: 'chris-new-laptop', claimExisting: true });
    assert.strictEqual(res.statusCode, 409, 'asking was enough to take the name');
    assert.strictEqual(bodyOf(res).code, 'NAME_TAKEN');
    assert.strictEqual(playerRow('Chris').ClientId, 'chris-old-laptop');
  });

  await check('§2 asking about a name nobody holds answers exactly as asking about one somebody does', async () => {
    reset();
    await join({ playerName: 'Chris', clientId: 'chris-old-laptop' });

    const held = await ask('Chris', { clientId: 'prober' });
    const absent = await ask('Priya', { clientId: 'prober' });

    // A distinct 404 here would be a name oracle: submit a name, learn whether
    // it is in the room, without ever attempting a join. nameConflictResponse's
    // header ("one submitted name in, one yes/no out") is the standard, and it
    // must not have a hole one path segment away.
    assert.strictEqual(held.statusCode, absent.statusCode);
    assert.strictEqual(absent.statusCode, 200);
    assert.strictEqual(bodyOf(held).success, bodyOf(absent).success);
  });

  await check('§2 asking never creates a player row', async () => {
    reset();
    await ask('Nobody', { clientId: 'prober' });
    // An UpdateCommand without `attribute_exists(SK)` upserts. A phantom row
    // would join the roster and the readiness denominator under a name nobody
    // is sat behind — the fake models the upsert faithfully so this can fail.
    assert.strictEqual(playerRow('Nobody'), undefined, 'a phantom player row was created');
    const list = bodyOf(await roster());
    assert.strictEqual(list.players.length, 0);
  });

  await check('§2 asking clears the same gates a join clears, in the same order', async () => {
    reset({ visibility: 'private', accessCode: 'summit' });
    await join({ playerName: 'Chris', clientId: 'chris-old-laptop', accessCode: 'summit' });

    const noCode = await ask('Chris', { clientId: 'prober' });
    assert.strictEqual(noCode.statusCode, 401, 'a private session discussed a name without the code');

    const wrongCode = await ask('Chris', { clientId: 'prober', accessCode: 'nope' });
    assert.strictEqual(wrongCode.statusCode, 403);

    // ...and nothing was recorded on the way past either refusal.
    assert.strictEqual(playerRow('Chris').HandoverRequestedBy, undefined);

    store.get(key(PK, 'METADATA')).Started = false;
    const unstarted = await ask('Chris', { clientId: 'prober', accessCode: 'summit' });
    assert.strictEqual(unstarted.statusCode, 403);
    assert.strictEqual(bodyOf(unstarted).error, 'Game not started');
  });

  await check('§2 an anonymous ask is refused rather than recorded unbindable', async () => {
    reset();
    await join({ playerName: 'Chris', clientId: 'chris-old-laptop' });
    const res = await ask('Chris', {});
    assert.strictEqual(res.statusCode, 400);
    assert.strictEqual(playerRow('Chris').HandoverRequestedBy, undefined);
  });

  /* --- §3 granting --------------------------------------------------------- */

  await check('§3 the grant route is host-gated and the ask route deliberately is not', () => {
    // A HIDDEN BUTTON IS NOT A PERMISSION. The gate is in the template, so it
    // is asserted against the template.
    const template = fs.readFileSync(path.join(REPO, 'template-clean.yaml'), 'utf8');

    const blockFor = (name) => {
      const start = template.indexOf(`  ${name}:`);
      assert.notStrictEqual(start, -1, `${name} is not in template-clean.yaml`);
      const rest = template.slice(start + 1);
      const end = rest.search(/\n {2}[A-Za-z]\w*(?:Function|Api|Table|Distribution):/);
      return rest.slice(0, end === -1 ? undefined : end);
    };

    assert.ok(
      /Authorizer:\s*CognitoAuthorizer/.test(blockFor('GrantHandoverFunction')),
      'anyone who knows the game id can unlock any name'
    );
    assert.ok(
      /Authorizer:\s*CognitoAuthorizer/.test(blockFor('RemovePlayerFunction')),
      'anyone who knows the game id can remove any player'
    );
    // The other half, and it fails just as loudly: a gated ask route means the
    // only people who can request a handover are the people who never need one.
    assert.ok(
      !/Authorizer:/.test(blockFor('RequestHandoverFunction')),
      'the player-facing ask was put behind auth, so no player can make it'
    );
  });

  await check('§3 granting opens the name and binds it to whoever asked', async () => {
    reset();
    await join({ playerName: 'Chris', clientId: 'chris-old-laptop' });
    await ask('Chris', { clientId: 'chris-new-laptop' });

    const res = await grant('Chris', { bindToRequester: true });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(bodyOf(res).bound, true);
    assert.strictEqual(playerRow('Chris').HandoverForClientId, 'chris-new-laptop');
    assert.ok(playerRow('Chris').HandoverExpiresAt > Math.floor(Date.now() / 1000));
  });

  await check('§3 a bound grant cannot be spent by anybody else', async () => {
    reset();
    await join({ playerName: 'Chris', clientId: 'chris-old-laptop' });
    await ask('Chris', { clientId: 'chris-new-laptop' });
    await grant('Chris', { bindToRequester: true });

    const thief = await join({ playerName: 'Chris', clientId: 'a-different-chris', claimExisting: true });
    assert.strictEqual(thief.statusCode, 409, 'a bound grant was stolen');
    assert.strictEqual(playerRow('Chris').ClientId, 'chris-old-laptop');
    // And the grant survives for the person it was meant for.
    const rightful = await join({ playerName: 'Chris', clientId: 'chris-new-laptop', claimExisting: true });
    assert.strictEqual(rightful.statusCode, 200);
  });

  await check('§3 an open grant is the host acting on what was said out loud', async () => {
    reset();
    await join({ playerName: 'Chris', clientId: 'chris-old-laptop' });

    // Nobody asked through the app. The owner's second entry point.
    const res = await grant('Chris', {});
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(bodyOf(res).bound, false);
    assert.strictEqual(playerRow('Chris').HandoverForClientId, undefined);

    const taken = await join({ playerName: 'Chris', clientId: 'chris-new-laptop', claimExisting: true });
    assert.strictEqual(taken.statusCode, 200);
    assert.strictEqual(playerRow('Chris').ClientId, 'chris-new-laptop');
  });

  await check('§3 binding when nobody asked is refused, not downgraded to open', async () => {
    reset();
    await join({ playerName: 'Chris', clientId: 'chris-old-laptop' });
    const res = await grant('Chris', { bindToRequester: true });
    assert.strictEqual(res.statusCode, 409);
    // Silently widening "let THEM take it" into "let ANYONE take it" is a
    // different grant with a different blast radius than the host pressed for.
    assert.strictEqual(playerRow('Chris').HandoverExpiresAt, undefined);
  });

  await check('§3 a row deleted mid-grant is not resurrected by the write', async () => {
    reset();
    await join({ playerName: 'Chris', clientId: 'chris-old-laptop' });

    // `admin/delete-game.js` batch-deletes a game's whole partition, PLAYER#
    // rows included, and the rows carry a 7-day TTL besides. An Update with no
    // condition UPSERTS, so without the guard this would put a player row back
    // into a session that no longer has one — a name nobody is sat behind,
    // which then joins the roster and the readiness counts.
    const latch = table.hold((command) => command.type === 'update'
      && command.input.Key?.SK === 'PLAYER#Chris');

    const pending = grant('Chris', {});
    await latch.reached;
    store.delete(key(PK, 'PLAYER#Chris'));
    latch.release();

    const res = await pending;
    assert.strictEqual(res.statusCode, 404, 'a vanished player was reported as unlocked');
    assert.strictEqual(playerRow('Chris'), undefined, 'the grant resurrected a deleted player row');
  });

  await check('§3 granting on a name that is not in the session creates nothing', async () => {
    reset();
    const res = await grant('Ghost', {});
    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(playerRow('Ghost'), undefined, 'a phantom player row was created');
  });

  await check('§3 re-granting replaces rather than stacks', async () => {
    reset();
    await join({ playerName: 'Chris', clientId: 'chris-old-laptop' });
    await ask('Chris', { clientId: 'chris-new-laptop' });
    await grant('Chris', { bindToRequester: true });
    // The owner's fallback: "if they need to do again, same routine." A second
    // grant must leave ONE grant behind, not two exchanges' worth.
    await grant('Chris', {});
    assert.strictEqual(playerRow('Chris').HandoverForClientId, undefined,
      're-granting open left the old binding in place');

    await join({ playerName: 'Chris', clientId: 'chris-new-laptop', claimExisting: true });
    const second = await join({ playerName: 'Chris', clientId: 'yet-another', claimExisting: true });
    assert.strictEqual(second.statusCode, 409, 'two grants were spendable after two grants were made');
  });

  /* --- §4 spending, and the one-shot rule ---------------------------------- */

  await check('§4 a spent grant is gone — the second attempt is refused', async () => {
    reset();
    await join({ playerName: 'Chris', clientId: 'chris-old-laptop' });
    await grant('Chris', {});

    const first = await join({ playerName: 'Chris', clientId: 'chris-new-laptop', claimExisting: true });
    assert.strictEqual(first.statusCode, 200);

    const second = await join({ playerName: 'Chris', clientId: 'chris-third-laptop', claimExisting: true });
    assert.strictEqual(second.statusCode, 409, 'the grant was spent twice');
    assert.strictEqual(playerRow('Chris').ClientId, 'chris-new-laptop');
  });

  await check('§4 spending a grant scrubs every trace of it from the row', async () => {
    reset();
    await join({ playerName: 'Chris', clientId: 'chris-old-laptop' });
    await ask('Chris', { clientId: 'chris-new-laptop' });
    await grant('Chris', { bindToRequester: true });
    await join({ playerName: 'Chris', clientId: 'chris-new-laptop', claimExisting: true });

    const row = playerRow('Chris');
    // A leftover attribute is a grant the next reader can misinterpret, and a
    // leftover request is a "somebody is asking" that never clears from the
    // host's panel.
    for (const attribute of [
      'HandoverExpiresAt', 'HandoverForClientId', 'HandoverRequestedBy', 'HandoverRequestedAt',
    ]) {
      assert.strictEqual(row[attribute], undefined, `${attribute} survived the handover`);
    }
  });

  await check('§4 TWO CLAIMANTS RACE ONE GRANT AND EXACTLY ONE GETS IN', async () => {
    reset();
    await join({ playerName: 'Chris', clientId: 'chris-old-laptop' });
    await grant('Chris', {});

    /*
      THE ASSERTION THE DATA MODEL EXISTS FOR.

      Both claimants read the row — both see an open grant — and only then does
      either write. That is the interleaving a read-then-write implementation
      ("handoverOpen was true a moment ago, so write") gets wrong, and it is why
      the grant lives ON the player row: one item, one conditional update, so
      DynamoDB serialises the two writers for us.

      The latch holds the FIRST claimant at its Update, by which point it has
      already classified `handover` off its Get. The second then runs end to end
      — Get (sees the grant, still there), Update (spends it). Releasing lets
      the first one's Update land against a row whose grant is now gone.
    */
    const latch = table.hold((command) => command.type === 'update'
      && command.input.Key?.SK === 'PLAYER#Chris');

    const racerA = join({ playerName: 'Chris', clientId: 'laptop-A', claimExisting: true });
    await latch.reached;
    const racerB = await join({ playerName: 'Chris', clientId: 'laptop-B', claimExisting: true });
    latch.release();
    const resultA = await racerA;

    const codes = [resultA.statusCode, racerB.statusCode].sort();
    assert.deepStrictEqual(codes, [200, 409], `both racers got ${JSON.stringify(codes)}`);
    assert.strictEqual(playerRow('Chris').ClientId, 'laptop-B', 'the winner was overwritten by the loser');
    assert.strictEqual(playerRow('Chris').HandoverExpiresAt, undefined, 'the grant survived being spent');
  });

  /*
    THE READ IS ADVISORY; THE CONDITION IS THE AUTHORITY.

    `handoverOpenFor` classifies off a Get, so every clause it checks is stale
    the instant it returns. The two cases below change the row BETWEEN that Get
    and the Update, which is the only window in which the ConditionExpression's
    own copies of those clauses can be observed at all — and mutation testing
    is how they were found: dropping the expiry clause and dropping the binding
    clause from the condition both left every other test in this file green.
  */

  await check('§4 a grant that lapses mid-claim is refused by the write, not just the read', async () => {
    reset();
    await join({ playerName: 'Chris', clientId: 'chris-old-laptop' });
    await grant('Chris', {});

    const latch = table.hold((command) => command.type === 'update'
      && command.input.Key?.SK === 'PLAYER#Chris');

    const claim = join({ playerName: 'Chris', clientId: 'chris-new-laptop', claimExisting: true });
    await latch.reached;
    // The five minutes run out while the request is in flight.
    playerRow('Chris').HandoverExpiresAt = Math.floor(Date.now() / 1000) - 1;
    latch.release();

    const res = await claim;
    assert.strictEqual(res.statusCode, 409, 'a grant that had already lapsed was still spent');
    assert.strictEqual(playerRow('Chris').ClientId, 'chris-old-laptop');
  });

  await check('§4 a grant bound mid-claim cannot be spent by the person it was taken from', async () => {
    reset();
    await join({ playerName: 'Chris', clientId: 'chris-old-laptop' });
    await ask('Chris', { clientId: 'chris-new-laptop' });
    // The host first unlocks it open, then thinks better of it and aims it at
    // the person who actually asked — while a stranger's claim is in flight.
    await grant('Chris', {});

    const latch = table.hold((command) => command.type === 'update'
      && command.input.Key?.SK === 'PLAYER#Chris');

    const thief = join({ playerName: 'Chris', clientId: 'a-different-chris', claimExisting: true });
    await latch.reached;
    await grant('Chris', { bindToRequester: true });
    latch.release();

    const res = await thief;
    assert.strictEqual(res.statusCode, 409, 'the stranger spent a grant aimed at somebody else');
    assert.strictEqual(playerRow('Chris').ClientId, 'chris-old-laptop');
    // ...and the grant is still there for the person it was meant for.
    const rightful = await join({ playerName: 'Chris', clientId: 'chris-new-laptop', claimExisting: true });
    assert.strictEqual(rightful.statusCode, 200, 'the loser\'s failed write consumed the grant');
  });

  /* --- §5 the window ------------------------------------------------------- */

  await check('§5 an unclaimed grant lapses instead of standing open for ever', async () => {
    reset();
    await join({ playerName: 'Chris', clientId: 'chris-old-laptop' });
    await grant('Chris', {});

    // Wind the clock past the window rather than waiting five minutes for it.
    playerRow('Chris').HandoverExpiresAt = Math.floor(Date.now() / 1000) - 1;

    const late = await join({ playerName: 'Chris', clientId: 'chris-new-laptop', claimExisting: true });
    assert.strictEqual(late.statusCode, 409, 'a lapsed grant was still spendable');
    assert.strictEqual(playerRow('Chris').ClientId, 'chris-old-laptop');
  });

  await check('§5 the window is a few minutes, not a session', () => {
    // Stated as a range rather than a number so the intent survives a tweak:
    // long enough for a sentence, far short of a session.
    assert.ok(HANDOVER_WINDOW_SECONDS >= 60, 'too short to say "go ahead" and tap');
    assert.ok(HANDOVER_WINDOW_SECONDS <= 15 * 60, 'a hole in the room identity for a quarter of an hour');
  });

  /* --- §6 what the handover is FOR ----------------------------------------- */

  await check('§6 the new device inherits the answers and the score', async () => {
    reset();
    await join({ playerName: 'Chris', clientId: 'chris-old-laptop' });
    store.set(key(PK, 'PLAYER#Chris#SCORE'), {
      PK, SK: 'PLAYER#Chris#SCORE', PlayerName: 'Chris', score: 7, afterRound: '002',
    });
    store.set(key(PK, 'QUESTION#001#ANSWER#Chris'), {
      PK, SK: 'QUESTION#001#ANSWER#Chris', PlayerName: 'Chris', Answer: 'intake forms',
    });

    await grant('Chris', {});
    const res = await join({ playerName: 'Chris', clientId: 'chris-new-laptop', claimExisting: true });

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(bodyOf(res).isReconnection, true);
    // The point of the whole feature: "useful if they change devices".
    assert.ok(store.get(key(PK, 'QUESTION#001#ANSWER#Chris')), 'the answer was lost in the handover');
    const list = bodyOf(await roster());
    assert.strictEqual(list.players.find((p) => p.playerName === 'Chris').totalScore, 7);
  });

  /* --- §7 the capability is not published ---------------------------------- */

  await check('§7 the roster reports handover state without leaking a client id', async () => {
    reset();
    await join({ playerName: 'Chris', clientId: 'chris-old-laptop' });
    await ask('Chris', { clientId: 'chris-new-laptop' });
    await grant('Chris', { bindToRequester: true });

    const res = await roster();
    const raw = res.body;
    // GET /games/{id}/players has NO authorizer. A clientId on it is a
    // capability handed to the room: get-answers.js:247 returns a player's own
    // answer text to whoever presents theirs.
    assert.ok(!raw.includes('chris-new-laptop'), "the requester's client id is public");
    assert.ok(!raw.includes('chris-old-laptop'), "the owner's client id is public");

    const chris = bodyOf(res).players.find((p) => p.playerName === 'Chris');
    assert.strictEqual(chris.handover.open, true);
    assert.strictEqual(chris.handover.requested, true);
    assert.ok(chris.handover.requestedAt, 'the host cannot tell how stale the ask is');
  });

  await check('§7 publicHandoverState is an allow-list, not a projection with holes', () => {
    const state = publicHandoverState({
      HandoverExpiresAt: Math.floor(Date.now() / 1000) + 60,
      HandoverForClientId: 'secret-a',
      HandoverRequestedBy: 'secret-b',
      HandoverRequestedAt: '2026-08-15T10:00:00.000Z',
    });
    assert.deepStrictEqual(
      Object.keys(state).sort(),
      ['expiresAt', 'open', 'requested', 'requestedAt'],
      'a new field reached the public shape without being considered'
    );
    assert.ok(!JSON.stringify(state).includes('secret'));
  });

  await check('§7 a lapsed grant reports nothing rather than reporting its past', () => {
    const state = publicHandoverState({ HandoverExpiresAt: Math.floor(Date.now() / 1000) - 1 });
    assert.strictEqual(state.open, false);
    assert.strictEqual(state.expiresAt, null, '"there was a grant once" reads as "there is a grant"');
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
