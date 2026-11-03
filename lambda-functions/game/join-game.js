const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, DeleteCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');

const { openSessionOr } = require('./session-gate');
const { nowSeconds, handoverOpenFor } = require('./handover');
const { attendeeForToken, seatName, MAX_SEATS } = require('./event-attendee');
const { recordParticipant } = require('./platform-metrics');
const { nameMovedFrame, nameMovedMessage, NAME_MOVED } = require('./name-holder');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);
const apigateway = new ApiGatewayManagementApiClient({
  endpoint: process.env.WEBSOCKET_API_ENDPOINT
});

/**
 * Is the second Chris the first Chris coming back, or a different person?
 *
 * Players are keyed `PLAYER#{playerName}`, and until this existed, a join that
 * found an existing key returned `isReconnection: true` unconditionally. In a
 * room with two Chrises the second one inherited the first one's answers and
 * score, and neither of them was told. The merge was silent by construction.
 *
 * The join request carried nothing that could tell those two cases apart —
 * no session id, no token, and no connection id (the player's WebSocket is
 * opened *after* the join succeeds, so at this point there is none). The name
 * was the whole identity. So the client now mints a random `clientId`, keeps
 * it in localStorage under the game, and sends it with every join; the server
 * stamps it on the player row the first time and requires it to match
 * thereafter.
 *
 * Four cases, and the two compatibility ones matter as much as the two new:
 *
 *   reconnect  stored id matches the one presented — the same browser. Today's
 *              behaviour, now actually verified.
 *   collision  the row is owned by a different id (or the caller presented
 *              none against an owned row) — refuse, and say so.
 *   legacy     neither side has an id. A player already in a live session when
 *              this shipped is served by the old bundle and sends no clientId;
 *              their row has none either. Refusing them would break the very
 *              reconnection this is meant to protect, so this case keeps the
 *              old behaviour exactly. It is no *worse* than today, and it
 *              disappears as soon as the row is claimed.
 *   unverified a claimed identity meeting an unowned row — a new bundle
 *              rejoining a row created by the old one. Indistinguishable from a
 *              genuine collision, so do not guess: refuse, and let the client
 *              ASK ("are you rejoining, or a different Chris?"). An explicit
 *              `claimExisting` turns it into an adoption.
 *   handover   an owned row that the HOST has unlocked for exactly one
 *              exchange. The fifth case, and the only one that lets a browser
 *              take a name a different browser provably holds — see below.
 *
 * ── THE FIFTH CASE ─────────────────────────────────────────────────────────
 *
 * `collision` is right and it is also a dead end: the person who genuinely
 * swapped laptops is locked out of a name that is provably theirs, and no
 * amount of evidence they can present changes that, because the whole premise
 * is that the request carries no evidence. The only party who can tell "Chris
 * on a new laptop" from "a second Chris" is the host, who can see the room.
 *
 * So the way out is a grant the host makes, and NOT anything the client can
 * assert: `claimExisting` alone still yields `collision` (asserted in
 * tests/join-name-collision.js, "claiming does not override an owned row"),
 * because a client-asserted claim is precisely the silent merge this function
 * exists to stop. `handoverOpen` comes from `handover.js` reading attributes
 * only `grant-handover.js` — a host-authenticated route — can write.
 *
 * BOTH TERMS ARE REQUIRED, and neither is redundant:
 *   `handoverOpen`  the host said yes.
 *   `claimExisting` the PERSON said yes. Without it, an unlocked name would be
 *                   taken by whoever typed it next, including the innocent
 *                   third Chris who has no idea a handover is in flight.
 *
 * `handoverOpen` is read from a Get and is therefore ADVISORY — the grant is
 * actually spent by a ConditionExpression on the write, exactly as `adopt` is.
 * See the branch below.
 *
 * Exported for tests: this is the whole of the decision and it should be
 * assertable without a DynamoDB fake.
 */
function classifyRejoin({ storedClientId, clientId, claimExisting, handoverOpen = false }) {
  if (storedClientId) {
    if (storedClientId === clientId) return 'reconnect';
    if (handoverOpen && clientId && claimExisting === true) return 'handover';
    return 'collision';
  }
  if (!clientId) return 'legacy';
  return claimExisting === true ? 'adopt' : 'unverified';
}

/**
 * The refusal. `code` is the machine-readable half — the client switches UI on
 * it — and `message` is the half a person reads.
 *
 * This discloses that one specific name is in use, to a caller who already
 * holds the game id, has passed the started check, and has passed the access
 * code check for a private game. That is the minimum a collision can be
 * reported with. It is deliberately NOT a roster: one submitted name in, one
 * yes/no out, no listing and no endpoint that answers without a join attempt.
 */
function nameConflictResponse(code, playerName, { handoverRefused = false, nameMoved = false, attendee = false } = {}) {
  const message = nameMoved
    ? nameMovedMessage(playerName)
    : attendee && !handoverRefused
    ? `Someone in this event is already answering as "${playerName}". If that is you on another device, you can move your name here. If not, join under your name with a number after it.`
    : handoverRefused
    ? `The host said not now. Add a last initial or pick another name so the host can tell you apart.`
    : code === 'NAME_UNVERIFIED'
    ? `Someone in this session is already answering as "${playerName}". If that was you on another device, rejoin to pick your answers and score back up. If not, choose a name the host can tell apart.`
    : `Someone in this session is already answering as "${playerName}". If that is you on another device, you can move your name here. If not, add a last initial so the host can tell you apart.`;

  return {
    statusCode: 409,
    body: JSON.stringify({
      error: 'Name already in use',
      code,
      playerName,
      message,
      // Only ever true for the device the host refused (join-game's collision
      // branch compares clientIds); anyone else gets the plain refusal.
      ...(handoverRefused ? { handoverRefused: true } : {}),
      // Only ever true for the browser that HELD this name until the host let
      // it move (`MovedFromClientId`, written by the handover branch). Its
      // page says "<name> is now on another device" instead of offering to
      // ask for the name it has just handed on.
      ...(nameMoved ? { nameMoved: true, reason: NAME_MOVED } : {}),
      // An event's item, joined by token: "I'm someone else" is a new seat
      // (`newSeat`), not a name form, so the phone needs to know which.
      ...(attendee ? { attendee: true } : {})
    }),
    headers: { 'Access-Control-Allow-Origin': '*' }
  };
}

const cors = { 'Access-Control-Allow-Origin': '*' };
const reply = (statusCode, body) => ({ statusCode, body: JSON.stringify(body), headers: { ...cors } });

/**
 * JOINING AN EVENT'S ITEM WITH THE ATTENDEE'S TOKEN (events M4).
 *
 * The session is one an event's host started (METADATA.EventRef,
 * websocket/events/run.js). The phone sends `attendeeToken` — the token the
 * attendee got when they joined the event once, by name — and no name: the
 * name is the attendee's own, read from the event (event-attendee.js). So a
 * whole day of sessions is joined without typing a code or a name again.
 *
 * ONE SEAT PER ATTENDEE PER SESSION. The seat is `PLAYER#<name>`, as every
 * player's is, and carries `AttendeeId`. Coming back — a reload, a phone that
 * slept, "Back to live" — finds the seat by that id and reconnects to it,
 * score and answers intact. Two attendees with one name get "Sam" and
 * "Sam 2", tried in order, so each always lands on the same one. A seat typed
 * by hand (no AttendeeId) is never taken over silently: it is somebody else's.
 *
 * A NEW DEVICE IS NOT SILENTLY "SAM 2" (experience plan 3e, audit C P5). A
 * phone that joined the event again by name is a second attendee, and used to
 * be seated as "Sam 2" without a word, its earlier answers and score left on
 * "Sam". Now, when the attendee's own name is held by someone else and this
 * attendee has no seat of their own yet, the join is refused NAME_TAKEN
 * (`attendee: true`), exactly as a typed name is, and the phone shows the
 * same screen (JoinNameCollision): "Use my name on this device" asks the
 * host, whose grant this route spends with `claimExisting` (the seat moves to
 * this attendee and this browser, and the old device is told); "I'm someone
 * else" sends `newSeat: true` and takes "Sam 2" as before.
 *
 * The session's own gate still runs first (openSessionOr): it must exist and
 * have started. The token is then the whole identity; a missing, forged,
 * expired or other-event token is 401 NOT_JOINED, and the phone goes back to
 * the event's name step.
 */
async function joinAsAttendee(gameId, token, clientId, { claimExisting = false, newSeat = false } = {}) {
  const TABLE = process.env.TABLE_NAME;
  const gate = await openSessionOr(db, TABLE, gameId, undefined);
  if (!gate.ok) return gate.response;
  const meta = gate.metadata || {};
  if (!meta.EventRef) {
    return reply(400, { error: 'This session is not part of an event. Join it with a name.', code: 'NOT_EVENT' });
  }
  const attendee = await attendeeForToken(db, TABLE, { eventRef: String(meta.EventRef), orgId: meta.orgId, token });
  if (!attendee) return reply(401, { error: 'You have not joined this event yet.', code: 'NOT_JOINED' });

  // Whether the attendee's OWN name (seat 1) is held by somebody else. Read
  // before a new seat is made: a returning "Sam 2" finds their own seat
  // further along and is never asked again.
  let ownNameHeld = null;
  for (let n = 1; n <= MAX_SEATS; n += 1) {
    const name = seatName(attendee.name, n);
    const key = { PK: `GAME#${gameId}`, SK: `PLAYER#${name}` };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const existing = await db.send(new GetCommand({ TableName: TABLE, Key: key, ConsistentRead: true }));
      const seat = existing && existing.Item;
      if (seat && seat.AttendeeId !== attendee.attendeeId) {
        if (n === 1) {
          // THE HOST LET THIS BROWSER HAVE THE NAME: spend the grant, as the
          // typed-name handover branch below does, in one conditional write.
          if (claimExisting === true && handoverOpenFor(seat, clientId)) {
            const previousClientId = seat.ClientId || null;
            try {
              await db.send(new UpdateCommand({
                TableName: TABLE,
                Key: key,
                UpdateExpression: `SET ClientId = :cid, AttendeeId = :aid${previousClientId ? ', MovedFromClientId = :prev' : ''} REMOVE HandoverExpiresAt, HandoverForClientId, HandoverRequestedBy, HandoverRequestedAt, HandoverRefusedFor, HandoverRefusedAt, RemovedAt`,
                ConditionExpression: 'attribute_exists(HandoverExpiresAt) AND HandoverExpiresAt > :now AND (attribute_not_exists(HandoverForClientId) OR HandoverForClientId = :cid)',
                ExpressionAttributeValues: {
                  ':cid': clientId,
                  ':aid': attendee.attendeeId,
                  ':now': nowSeconds(),
                  ...(previousClientId ? { ':prev': previousClientId } : {}),
                },
              }));
            } catch (error) {
              if (error && error.name === 'ConditionalCheckFailedException') {
                return nameConflictResponse('NAME_TAKEN', name, { attendee: true });
              }
              throw error;
            }
            await tellOldDeviceNameMoved(gameId, name);
            await notifyHostOfPlayerJoin(gameId, {
              playerId: name, playerName: name, totalScore: 0,
              joinedAt: seat.joinedAt || seat.JoinedAt, isReconnection: true,
            });
            return reply(200, {
              success: true, message: 'Reconnected to existing player', playerId: name, playerName: name,
              totalScore: 0, isReconnection: true, attendee: true, handedOver: true,
            });
          }
          ownNameHeld = { name, seat };
        }
        break; // somebody else's: try the next name
      }
      if (seat) {
        // THIS attendee's seat. A removal is undone, as any rejoin undoes it
        // (see the handler below); the browser becomes the seat's ClientId,
        // so a plain rejoin from it by name also works.
        const sets = [];
        const values = {};
        if (clientId && seat.ClientId !== clientId) { sets.push('ClientId = :cid'); values[':cid'] = clientId; }
        if (sets.length || seat.RemovedAt) {
          await db.send(new UpdateCommand({
            TableName: TABLE,
            Key: key,
            UpdateExpression: `${sets.length ? `SET ${sets.join(', ')} ` : ''}REMOVE RemovedAt`,
            ConditionExpression: 'AttendeeId = :aid',
            ExpressionAttributeValues: { ...values, ':aid': attendee.attendeeId },
          }));
        }
        await notifyHostOfPlayerJoin(gameId, {
          playerId: name, playerName: name, totalScore: 0,
          joinedAt: seat.joinedAt || seat.JoinedAt, isReconnection: true,
        });
        return reply(200, {
          success: true, message: 'Reconnected to existing player', playerId: name, playerName: name,
          totalScore: 0, isReconnection: true, attendee: true,
        });
      }
      // A NEW SEAT WHILE THE OWN NAME IS SOMEBODY ELSE'S: ask first, unless
      // the person has said "I'm someone else".
      if (ownNameHeld && newSeat !== true) {
        const held = ownNameHeld.seat;
        return nameConflictResponse('NAME_TAKEN', ownNameHeld.name, {
          attendee: true,
          handoverRefused: Boolean(clientId && held.HandoverRefusedFor === clientId),
          nameMoved: Boolean(clientId && held.MovedFromClientId === clientId),
        });
      }
      const now = new Date().toISOString();
      try {
        await db.send(new PutCommand({
          TableName: TABLE,
          Item: {
            ...key,
            playerId: name,
            PlayerName: name,
            playerName: name,
            AttendeeId: attendee.attendeeId,
            ...(clientId ? { ClientId: clientId } : {}),
            JoinedAt: now,
            joinedAt: now,
            isConnected: true,
            ttl: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60),
          },
          ConditionExpression: 'attribute_not_exists(SK)',
        }));
      } catch (error) {
        // Lost the seat to a join at the same moment — perhaps this attendee's
        // own second tab. Look again: it may now be ours to reconnect to.
        if (error && error.name === 'ConditionalCheckFailedException') continue;
        throw error;
      }
      // A NEW seat: one participant (usage stats, SPEC §5 E9). Never throws.
      await recordParticipant({ gameId, metadata: meta }, { db });
      await db.send(new PutCommand({
        TableName: TABLE,
        Item: {
          PK: `GAME#${gameId}`,
          SK: `PLAYER#${name}#SCORE`,
          PlayerName: name,
          score: 0,
          afterRound: '000',
          createdAt: now,
          updatedAt: now,
          ttl: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60),
        },
      }));
      console.log(`🎟️ An attendee of EVENT#${meta.EventRef} joined game ${gameId}`);
      await notifyHostOfPlayerJoin(gameId, {
        playerId: name, playerName: name, totalScore: 0, joinedAt: now, isReconnection: false,
      });
      return reply(200, {
        success: true, message: 'Successfully joined game', playerId: name, playerName: name,
        totalScore: 0, isReconnection: false, attendee: true,
      });
    }
  }
  return reply(409, {
    error: 'Name already in use',
    code: 'NAME_TAKEN',
    message: 'Too many people here share your name. Ask the host for help.',
  });
}

/*
  "STILL WAITING" IS AN ANSWER, NOT AN ERROR (dev QA 1 Nov). While a phone
  waits on the host it retries the join every few seconds with
  `claimExisting`, and until the host says yes every retry was a 409 — which
  the browser prints in red in the console, every four seconds, for an answer
  the page expected. A retry that sends `waitStatus: true` gets the same
  refusal body with 200 and `waiting: true` instead; the page reads it exactly
  as it read the 409 (PlayerPage performJoin). Only the two name refusals
  convert, and only for a claim: every other failure keeps its status, and a
  caller that does not ask gets the 409 it always got.
*/
const WAITING_CODES = new Set(['NAME_TAKEN', 'NAME_UNVERIFIED']);

exports.handler = async (event) => {
  const response = await joinHandler(event);
  let body = {};
  try { body = JSON.parse(event.body || '{}') || {}; } catch (_) { return response; }
  if (body.waitStatus !== true || body.claimExisting !== true) return response;
  if (!response || response.statusCode !== 409) return response;
  let payload;
  try { payload = JSON.parse(response.body || '{}'); } catch (_) { return response; }
  if (!payload || !WAITING_CODES.has(payload.code)) return response;
  return { ...response, statusCode: 200, body: JSON.stringify({ ...payload, waiting: true }) };
};

async function joinHandler(event) {
  try {
    const { gameId } = event.pathParameters || {};
    const body = JSON.parse(event.body || '{}');
    const { playerName, accessCode, claimExisting } = body;
    // Absent, empty, or non-string means "this caller has no identity" — never
    // a value that could accidentally match a stored one.
    const clientId = typeof body.clientId === 'string' && body.clientId.trim()
      ? body.clientId.trim()
      : null;

    // An event's attendee, by token and not by name (events M4).
    const attendeeToken = typeof body.attendeeToken === 'string' ? body.attendeeToken.trim() : '';
    if (gameId && attendeeToken) {
      return await joinAsAttendee(gameId, attendeeToken, clientId, {
        claimExisting: claimExisting === true,
        newSeat: body.newSeat === true,
      });
    }

    if (!gameId || !playerName) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Game ID and player name are required' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    console.log(`Player ${playerName} attempting to join game ${gameId}`);

    // Session exists, has started, and (if private) the code matches — in that
    // order, because the name-in-use signal must sit behind the code gate or
    // the refusal becomes a roster oracle. See session-gate.js.
    const gate = await openSessionOr(db, process.env.TABLE_NAME, gameId, accessCode);
    if (!gate.ok) return gate.response;

    // Use playerName directly as the player ID for simplicity
    const playerId = playerName;

    // Check if player already exists
    const existingPlayer = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { 
        PK: `GAME#${gameId}`, 
        SK: `PLAYER#${playerName}` 
      }
    }));

    if (existingPlayer.Item) {
      const verdict = classifyRejoin({
        storedClientId: existingPlayer.Item.ClientId || null,
        clientId,
        claimExisting,
        handoverOpen: handoverOpenFor(existingPlayer.Item, clientId)
      });

      if (verdict === 'collision' || verdict === 'unverified') {
        // No host notification and no write: nobody joined. The first Chris is
        // still the only Chris, and still has their answers.
        console.log(`⛔ Refusing join for ${playerName} in game ${gameId}: ${verdict}`);
        return nameConflictResponse(
          verdict === 'unverified' ? 'NAME_UNVERIFIED' : 'NAME_TAKEN',
          playerName,
          {
            handoverRefused: Boolean(
              clientId && existingPlayer.Item.HandoverRefusedFor === clientId
            ),
            nameMoved: Boolean(
              clientId && existingPlayer.Item.MovedFromClientId === clientId
            )
          }
        );
      }

      if (verdict === 'adopt') {
        // Stamp this browser onto a row that predates identities. The condition
        // is what stops two simultaneous claimants both "adopting": the loser
        // falls through to a collision rather than silently sharing the row.
        //
        // `REMOVE RemovedAt` for the reason spelled out at the top of the
        // reconnect branch below: a claim proves somebody is at the keyboard.
        try {
          await db.send(new UpdateCommand({
            TableName: process.env.TABLE_NAME,
            Key: { PK: `GAME#${gameId}`, SK: `PLAYER#${playerName}` },
            UpdateExpression: 'SET ClientId = :cid REMOVE RemovedAt',
            ConditionExpression: 'attribute_not_exists(ClientId)',
            ExpressionAttributeValues: { ':cid': clientId }
          }));
          console.log(`🔗 Claimed unowned player row ${playerName} for client ${clientId}`);
        } catch (error) {
          if (error.name === 'ConditionalCheckFailedException') {
            console.log(`⛔ Lost the race to claim ${playerName} in game ${gameId}`);
            return nameConflictResponse('NAME_TAKEN', playerName);
          }
          throw error;
        }
      }

      if (verdict === 'handover') {
        // SPENDING THE HOST'S GRANT, AND THE ONE-SHOT RULE IS THIS CONDITION.
        //
        // Owner's rule: *"the host can use the session players tab to unlock
        // for 1 exchange of players for that name … if they need to do again,
        // same routine."* So the grant must be consumed by the first successful
        // claim and be gone for the second.
        //
        // ONE ITEM, ONE CONDITIONAL WRITE. Every clause `handoverOpenFor` read
        // from the Get is re-checked here against the item as it is at write
        // time, and the same statement REMOVEs the grant. Two browsers racing a
        // single grant are serialised by DynamoDB: the first passes
        // `attribute_exists(HandoverExpiresAt)` and deletes it, the second
        // fails its condition and is told the name is taken. A read-then-write
        // — "handoverOpen was true a moment ago, so write" — would let both in,
        // which is why the grant lives on this row rather than one of its own
        // (handover.js's header argues that at length).
        //
        // The three clauses:
        //   attribute_exists   the grant has not already been spent
        //   > :now             it has not lapsed (five-minute window)
        //   ForClientId        a grant bound to the person who ASKED cannot be
        //                      stolen by whoever types the name next
        //
        // The first is REDUNDANT and kept deliberately — mutation testing says
        // so: deleting it changes no outcome, because a comparison against a
        // non-existent attribute is false in DynamoDB, so `> :now` already
        // implies existence. It stays because it is the clause that STATES the
        // one-shot rule, and the clause that keeps the rule if the expiry
        // window is ever widened, made optional, or moved. The other two are
        // load-bearing and are proven so by the two mid-flight races in
        // tests/name-handover.js §4 — which exist because dropping either one
        // left every other test in that file green.
        //
        // `RemovedAt` goes too: taking over a name is somebody arriving.
        //
        // `MovedFromClientId` records the browser the name moved AWAY from, so
        // that browser's next join is told "is now on another device" rather
        // than "that name is taken" (nameConflictResponse). Read from the Get,
        // so it is advisory; it is a clientId and therefore never published —
        // get-players.js is an allow-list.
        const previousClientId = existingPlayer.Item.ClientId || null;
        try {
          await db.send(new UpdateCommand({
            TableName: process.env.TABLE_NAME,
            Key: { PK: `GAME#${gameId}`, SK: `PLAYER#${playerName}` },
            UpdateExpression: `SET ClientId = :cid${previousClientId ? ', MovedFromClientId = :prev' : ''} REMOVE HandoverExpiresAt, HandoverForClientId, HandoverRequestedBy, HandoverRequestedAt, HandoverRefusedFor, HandoverRefusedAt, RemovedAt`,
            ConditionExpression: 'attribute_exists(HandoverExpiresAt) AND HandoverExpiresAt > :now AND (attribute_not_exists(HandoverForClientId) OR HandoverForClientId = :cid)',
            ExpressionAttributeValues: {
              ':cid': clientId,
              ':now': nowSeconds(),
              ...(previousClientId ? { ':prev': previousClientId } : {})
            }
          }));
          console.log(`🤝 Handover spent: ${playerName} in game ${gameId} moved to a new device`);
        } catch (error) {
          if (error.name === 'ConditionalCheckFailedException') {
            // Lapsed between the read and the write, or a second claimant got
            // there first. Either way there is no grant now, and the honest
            // answer is the one the caller would have got without one.
            console.log(`⛔ Handover for ${playerName} in game ${gameId} was already spent or has lapsed`);
            return nameConflictResponse('NAME_TAKEN', playerName);
          }
          throw error;
        }

        // TELL THE OLD DEVICE NOW (experience plan step 1f). Never throws.
        await tellOldDeviceNameMoved(gameId, playerName);
      }

      // A JOIN UNDOES A REMOVAL, and this is a decision rather than a
      // side-effect.
      //
      // The host removes people who have left. A removed row keeps its
      // `ClientId`, so nothing stops that browser coming back — and it is worth
      // being precise about what "coming back" costs here, because both answers
      // are defensible:
      //
      //   leave them removed   the person is sat in the room typing an answer
      //                        that no progress bar is waiting for. The host
      //                        sees "3 of 4 answered" while four people answer,
      //                        and NOTHING on any screen explains why. An
      //                        inconsistency nobody can see is the worse bug.
      //   un-remove them       the host's removal is undone by a browser. The
      //                        host sees them reappear in the roster and can
      //                        remove them again — one click, and the state on
      //                        screen matches the room.
      //
      // The second. It fails visibly and it fails towards the truth: a join is
      // an explicit act on this surface (the rejoin prompt is a tap; auto-join
      // needs a name in the URL on a fresh page load), so a phone in a pocket
      // does not quietly resurrect anybody.
      //
      // `adopt` and `handover` already cleared it inside their own conditional
      // writes, so this covers `reconnect` and `legacy` — and it is CONDITIONAL
      // on the attribute existing so that the overwhelmingly common reconnect
      // stays a read-only path with no write at all.
      if (existingPlayer.Item.RemovedAt && verdict !== 'adopt' && verdict !== 'handover') {
        try {
          await db.send(new UpdateCommand({
            TableName: process.env.TABLE_NAME,
            Key: { PK: `GAME#${gameId}`, SK: `PLAYER#${playerName}` },
            UpdateExpression: 'REMOVE RemovedAt',
            ConditionExpression: 'attribute_exists(RemovedAt)'
          }));
          console.log(`↩️ ${playerName} rejoined game ${gameId} after being removed — back in the counts`);
        } catch (error) {
          // Somebody else already un-removed them. That is the desired state.
          if (error.name !== 'ConditionalCheckFailedException') throw error;
        }
      }

      // Return existing player data
      // Notify host via WebSocket about player reconnection
      await notifyHostOfPlayerJoin(gameId, {
        playerId: playerName,
        playerName: playerName,
        totalScore: 0, // Always 0 for returning players - actual score is in SCORE record
        joinedAt: existingPlayer.Item.joinedAt || existingPlayer.Item.JoinedAt,
        isReconnection: true
      });
      
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          message: 'Reconnected to existing player',
          playerId: playerName,
          playerName: playerName,
          totalScore: 0, // Always 0 for returning players - actual score is in SCORE record
          isReconnection: true
        }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    // Create new player using playerName as both key and ID.
    //
    // The condition closes the window the Get above cannot: two Chrises whose
    // joins overlap both read "no such player" and both used to write, the
    // second overwriting the first. Now the loser is told.
    try {
      await db.send(new PutCommand({
        TableName: process.env.TABLE_NAME,
        Item: {
          PK: `GAME#${gameId}`,
          SK: `PLAYER#${playerName}`,
          playerId: playerName,
          PlayerName: playerName,
          playerName: playerName, // Support both formats
          ...(clientId ? { ClientId: clientId } : {}),
          JoinedAt: new Date().toISOString(),
          joinedAt: new Date().toISOString(),
          isConnected: true,
          ttl: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60) // 7 days TTL
          // Note: totalScore removed - use PLAYER#{playerName}#SCORE record as single source of truth
        },
        ConditionExpression: 'attribute_not_exists(SK)'
      }));
    } catch (error) {
      if (error.name === 'ConditionalCheckFailedException') {
        console.log(`⛔ Concurrent join lost the name ${playerName} in game ${gameId}`);
        return nameConflictResponse('NAME_TAKEN', playerName);
      }
      throw error;
    }

    // A NEW seat, written once: one participant (usage stats, SPEC §5 E9). A
    // reconnect, a refresh or a handover reuses the seat and never gets here.
    await recordParticipant({ gameId, metadata: gate.metadata }, { db });

    // Create initial consolidated score record using playerName (new players start with afterRound: "000")
    await db.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: {
        PK: `GAME#${gameId}`,
        SK: `PLAYER#${playerName}#SCORE`,
        PlayerName: playerName,
        score: 0,
        afterRound: "000", // "000" indicates player hasn't been scored yet
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ttl: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60) // 30 days TTL
      }
    }));

    console.log(`✅ Created score record for ${playerName} with afterRound: 000 (not scored yet)`);

    /*
      A JOIN IS NOT BILLED. It happens in every rehearsal and every QR test, so
      a session counts at the first answer to its second answered question
      instead — websocket/session-count.js, behind the answer write. 4b39c871
      billed here on the first join for one day; the owner moved the moment.
    */

    console.log(`Player ${playerName} successfully joined game ${gameId}`);

    // Notify host via WebSocket about new player
    await notifyHostOfPlayerJoin(gameId, {
      playerId: playerName,
      playerName: playerName,
      totalScore: 0,
      joinedAt: new Date().toISOString(),
      isReconnection: false
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        message: 'Successfully joined game',
        playerId: playerName,
        playerName: playerName,
        totalScore: 0,
        isReconnection: false
      }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };

  } catch (error) {
    console.error('Join game error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Failed to join game: ${error.message}` }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
}


/**
 * Notify host via WebSocket when a player joins or reconnects
 */
async function notifyHostOfPlayerJoin(gameId, playerData) {
  // Quiet by design. This used to log the whole API Gateway client config and a
  // dozen WEBSOCKET DEBUG lines on every join, and — with no host connected —
  // run a second Query over every connection row just to print it. What an
  // operator needs is below: that nobody was told, or why a send failed.
  try {
    const hostConnection = await getHostConnection(gameId);
    if (!hostConnection) {
      console.log(`⚠️ No host connection for game ${gameId}; playerJoined not delivered`);
      return;
    }
    await sendToConnection(hostConnection.ConnectionId, {
      type: 'playerJoined',
      gameId: gameId,
      player: playerData,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    // Don't throw - this shouldn't block player joining
    console.error(`❌ Error notifying host of player join in game ${gameId}:`, error.message);
  }
}

/**
 * "SAM IS NOW ON ANOTHER DEVICE", PUSHED THE MOMENT THE NAME MOVES (step 1f).
 *
 * WHY EVERY PLAYER SOCKET UNDER THIS NAME IS THE OLD DEVICE'S. Connection rows
 * carry `PlayerName` and no client id (connect.js stores what the handshake's
 * query string says; a player page's client id rides in that handshake only
 * to be compared with the name's holder, and is never stored or logged). That would be
 * too weak to aim at a device in general — but at THIS instant it is exact:
 * the new device has no socket yet. It opens one only after this join
 * answers, and this runs before the join answers. So every PLAYER row under
 * this name, here, now, belongs to the browser the name just left.
 *
 * Each is sent `nameMoved` and its row is deleted, so the room's broadcasts
 * stop reaching a page that has stopped. The page closes its socket and does
 * not reconnect (PlayerPage's `nameMoved` handler). A socket that is already
 * dead answers 410, which sendToConnection reaps as it always has.
 *
 * Viewer rows (the room's window, `Viewer: 'present'`) carry no name and are
 * never touched. Best effort: a failure here leaves the old device to learn on
 * its next answer, vote or reconnect (message.js / submit-vote.js), which is
 * what step 1d guarantees on its own.
 */
async function tellOldDeviceNameMoved(gameId, playerName) {
  try {
    const result = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      FilterExpression: 'ConnectionType = :type',
      ExpressionAttributeValues: {
        ':pk': `GAME#${gameId}`,
        ':sk': 'CONNECTION#',
        ':type': 'PLAYER'
      }
    }));
    const oldSockets = (result.Items || []).filter((row) => row.PlayerName === playerName && !row.Viewer);
    const frame = nameMovedFrame(gameId, playerName);
    await Promise.all(oldSockets.map(async (row) => {
      await sendToConnection(row.ConnectionId, frame);
      await db.send(new DeleteCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: row.PK, SK: row.SK }
      })).catch(() => {});
    }));
    if (oldSockets.length) {
      console.log(`📵 Told ${oldSockets.length} socket(s) in game ${gameId} that a name moved`);
    }
  } catch (error) {
    console.error(`❌ Could not tell the old device in game ${gameId} that a name moved:`, error.message);
  }
}

/**
 * Get host connection for a game
 */
async function getHostConnection(gameId) {
  try {
    const result = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      FilterExpression: 'ConnectionType = :type',
      ExpressionAttributeValues: {
        ':pk': `GAME#${gameId}`,
        ':sk': 'CONNECTION#',
        ':type': 'HOST'
      }
    }));
    
    return result.Items?.[0] || null;
  } catch (error) {
    console.error(`❌ Error getting host connection for game ${gameId}:`, error);
    return null;
  }
}

/**
 * Send message to specific WebSocket connection
 */
async function sendToConnection(connectionId, message) {
  try {
    await apigateway.send(new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: JSON.stringify(message)
    }));
    return { ok: true };

  } catch (error) {
    // 410 Gone == dead connection. Delete the stale row inline (message carries
    // gameId so the PK is known) and never re-throw.
    if (error.statusCode === 410 || error.name === 'GoneException' || error.$response?.statusCode === 410) {
      console.log(`🧹 Removing stale connection ${connectionId} (410 Gone)`);
      if (message.gameId) {
        await db.send(new DeleteCommand({
          TableName: process.env.TABLE_NAME,
          Key: { PK: `GAME#${message.gameId}`, SK: `CONNECTION#${connectionId}` }
        })).catch(() => {});
      }
      return { ok: false, stale: true };
    }
    console.error(`❌ Failed to send to connection ${connectionId}:`, error.message);
    return { ok: false, error };
  }
}

// Exported for tests — the collision decision should be assertable on its own.
exports.classifyRejoin = classifyRejoin;
