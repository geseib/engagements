/**
 * POST /events/{code}/run — THE HOST RUNS THE DAY (events M3).
 *
 *   { action: 'prepare',   itemId }  an engagement's session, made but NOT
 *                                    opened, so the host can preview its
 *                                    stage; the item stays planned and the
 *                                    phones stay where they are
 *   { action: 'start',     itemId }  planned → live ("Go live"); paused → live
 *   { action: 'resume',    itemId }  paused → live (the same as start)
 *   { action: 'pause',     itemId }  live → paused. A break is never paused;
 *                                    it ends. Going back to the agenda is the
 *                                    host looking, not a pause (27 Sep 2026).
 *   { action: 'end',       itemId }  live | paused → done
 *   { action: 'extend',    itemId }  a live break: back five minutes later
 *   { action: 'end-event' }          every live or paused item ends, and the
 *                                    event is over
 *
 * A ROUTE OF THE ITEMS FUNCTION (items.js hands it over), not a function of
 * its own: the stack is near CloudFormation's 500-resource limit. One route
 * for every action, so the whole of running a day costs one route and one
 * permission. The host's door is the builder's (event-store.openEvent):
 * another organisation's event is the unknown code's 404.
 *
 * ── THE MODEL (roadmap §3, with D1–D5 as recommended) ───────────────────
 *   planned ──start──▶ live ──pause──▶ paused ──resume──▶ live
 *                       │                  │
 *                       └──────end─────────┴──▶ done
 * One item is live at a time; any number may be paused. METADATA.LiveItem
 * names the live one, or is absent while the agenda is up. Starting an item
 * while another is live pauses that one (a break: ends it) IN THE SAME
 * TRANSACTION, every row conditioned on the state this request read — so two
 * host screens pressing Start at the same second leave exactly one item live,
 * and the loser is told, with nothing of its start kept: a session it made is
 * discarded (child-session.js).
 *
 * ── AN ENGAGEMENT'S SESSION ──────────────────────────────────────────────
 * Its first start makes the session and opens it (child-session.js), so
 * phones can join its lobby at once. Pausing sets the session's pause flag
 * and leaves its round exactly where it was; resuming clears it. Ending ends
 * the session with the same helper the host's own End uses
 * (session-end.js). A SURVEY is the exception: its results are frozen when it
 * closes (game/survey-host.js), which only the stage can do, so an open
 * survey refuses to end here and says so. A closed one is ended.
 *
 * ── WHAT THE ROOM IS TOLD ────────────────────────────────────────────────
 * Every socket in an affected session gets a frame after the rows are
 * written: eventItemPaused, eventItemResumed, eventItemStarted (sent into
 * the item that was live, naming the new one), eventItemEnded, eventEnded.
 * Phones between items poll the agenda's `now` view instead (get-agenda.js).
 *
 * Every answer is the host's view of the event (event-store.hostView), so the
 * stage, the remote and the builder redraw from what the server holds.
 */
const { GetCommand, TransactWriteCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const tenant = require('../tenant');
const { endSession } = require('../session-end');
const { recordBillableEvent } = require('../usage');
const rules = require('./agenda-rules');
const { json, readBody } = require('./event-http');
const S = require('./event-store');
const C = require('./child-session');

const ACTIONS = Object.freeze(['prepare', 'start', 'resume', 'pause', 'end', 'extend', 'end-event']);
const EXTEND_MINUTES = 5;
const MINUTE_MS = 60 * 1000;

const RACED = 'Another screen changed the event at the same moment. Nothing was changed here; look again.';
const raced = () => json(409, { error: RACED, code: 'run_changed' });
const itemGone = () => json(404, { error: 'That item is no longer on the agenda.', code: 'item_gone' });
const refuse = (error, code) => json(409, { error, code });

const itemKey = (code, itemId) => ({ PK: tenant.eventPk(code), SK: S.itemSk(itemId) });
const metaKey = (code) => ({ PK: tenant.eventPk(code), SK: S.META_SK });
const stateOf = (row) => (row && row.State) || 'planned';

async function readItem(db, tableName, code, itemId) {
  if (!S.isItemId(itemId)) return null;
  const res = await db.send(new GetCommand({ TableName: tableName, Key: itemKey(code, itemId), ConsistentRead: true }));
  return (res && res.Item) || null;
}

async function readSessionState(db, tableName, gameId) {
  const res = await db.send(new GetCommand({
    TableName: tableName, Key: { PK: `GAME#${gameId}`, SK: 'STATE' }, ConsistentRead: true,
  }));
  return (res && res.Item) || null;
}

/** A break's planned return: when it started plus its length. */
const breakEndsAt = (row, nowMs) => new Date(nowMs + (Number(row.Minutes) || 0) * MINUTE_MS).toISOString();

/**
 * The update that takes the item that WAS live out of the way of a new one:
 * a break ends (it is never paused, decision 7), and so does an engagement
 * whose session has already ENDED (all its rounds played, or the host ended
 * it on its stage) — there is nothing left in it to resume. Anything else
 * pauses.
 */
function stepAside(code, prev, now, { finished = false } = {}) {
  const ends = prev.Type === rules.BREAK || finished;
  return {
    Update: {
      Key: itemKey(code, S.itemIdOf(prev)),
      UpdateExpression: ends ? 'SET #s = :done, EndedAt = :now' : 'SET #s = :paused, PausedAt = :now',
      ConditionExpression: '#s = :live',
      ExpressionAttributeNames: { '#s': 'State' },
      ExpressionAttributeValues: { ':live': 'live', ':now': now, ...(ends ? { ':done': 'done' } : { ':paused': 'paused' }) },
    },
  };
}

/**
 * An engagement item as its session will be made from it, or a refusal:
 * RATIONALE (agenda-rules.sessionFormOf) — a row whose words could not be
 * opened carries blank settings that look like none at all. Never guess.
 */
async function playableItem(meta, row) {
  const item = S.projectItem(await S.openItemRow(meta.orgId, row, 'run'));
  if (item.decryptFailed) {
    return { refusal: refuse('This item could not be read, so it cannot start. Remove it and add it again.', 'item_unreadable') };
  }
  if (!item.setRef || !item.setRef.setId) {
    return { refusal: refuse('This engagement has no question set to play.', 'item_no_set') };
  }
  return { item };
}

/**
 * PREVIEW — the host opens an engagement's own stage without taking it live
 * (the owner, 27 Sep 2026: "a host may bring up the agenda and switch to the
 * second agenda item but that doesn't open it for the players ... That way
 * host can rehearse, preview etc."). The item's session is made now, but not
 * opened: it is CREATED, so nobody can join it (session-gate.js), the agenda
 * never links it (get-agenda.js links live, paused and done items only), and
 * the phones stay wherever the event is. The item stays `planned`. Going live
 * later opens this same session (start, below) rather than making another.
 *
 * An item that already has a session answers with it, whatever its state:
 * opening a live, paused or finished engagement's stage is just looking.
 * Two screens previewing at once: the second's session is discarded and both
 * get the one that landed.
 */
async function prepare(db, tableName, { meta, code, row, itemId }) {
  if (!rules.isEngagement(row.Type)) {
    return { refusal: refuse('Only an engagement has a stage of its own. Open this one on the agenda.', 'not_an_engagement') };
  }
  if (row.GameId) return { gameId: String(row.GameId) };
  if (stateOf(row) !== 'planned') return { refusal: raced() };
  const { item, refusal } = await playableItem(meta, row);
  if (refusal) return { refusal };
  const gameId = await C.createChildSession(db, tableName, { item, orgId: meta.orgId, code, itemId, open: false });
  try {
    await db.send(new UpdateCommand({
      TableName: tableName,
      Key: itemKey(code, itemId),
      UpdateExpression: 'SET GameId = :gid, PreparedAt = :now',
      ConditionExpression: 'attribute_exists(SK) AND attribute_not_exists(GameId) AND (attribute_not_exists(#s) OR #s = :planned)',
      ExpressionAttributeNames: { '#s': 'State' },
      ExpressionAttributeValues: { ':gid': gameId, ':now': new Date().toISOString(), ':planned': 'planned' },
    }));
  } catch (error) {
    await C.discardChildSession(db, tableName, gameId, meta.orgId);
    if (!(error && error.name === 'ConditionalCheckFailedException')) throw error;
    const again = await readItem(db, tableName, code, itemId);
    if (again && again.GameId) return { gameId: String(again.GameId) };
    return { refusal: raced() };
  }
  console.log(`👁️ run: EVENT#${code} ${itemId} prepared for preview as ${gameId}`);
  return { gameId };
}

/** start and resume. */
async function start(db, tableName, { meta, code, row, itemId }) {
  const was = stateOf(row);
  if (was === 'live') return { gameId: row.GameId || null };
  if (was === 'done') return { refusal: refuse('This item has ended. Its report is in the session history.', 'item_done') };

  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const prevId = typeof meta.LiveItem === 'string' && meta.LiveItem && meta.LiveItem !== itemId ? meta.LiveItem : null;
  const prev = prevId ? await readItem(db, tableName, code, prevId) : null;

  let gameId = row.GameId ? String(row.GameId) : null;
  let created = false;
  if (was === 'planned' && rules.isEngagement(row.Type)) {
    if (gameId) {
      // PREVIEWED (prepare, above): its session exists, CREATED. Open it now,
      // the same session the host has been looking at.
      await C.openChildSession(db, tableName, { gameId, orgId: meta.orgId, type: row.Type, now });
    } else {
      const { item, refusal } = await playableItem(meta, row);
      if (refusal) return { refusal };
      gameId = await C.createChildSession(db, tableName, { item, orgId: meta.orgId, code, itemId, now });
      created = true;
    }
  }
  // Is the item that was live an engagement whose session has finished? Then
  // it ends rather than pauses (stepAside).
  const prevFinished = Boolean(prev && prev.GameId
    && ((await readSessionState(db, tableName, String(prev.GameId))) || {}).State === 'ENDED');

  const itemSets = ['#s = :live'];
  const values = { ':live': 'live', ':was': was };
  if (was === 'planned') { itemSets.push('StartedAt = :now'); values[':now'] = now; }
  if (created) { itemSets.push('GameId = :gid'); values[':gid'] = gameId; }
  if (row.Type === rules.BREAK) { itemSets.push('EndsAt = :ends'); values[':ends'] = breakEndsAt(row, nowMs); }
  const tx = [{
    Update: {
      Key: itemKey(code, itemId),
      UpdateExpression: `SET ${itemSets.join(', ')}`,
      ConditionExpression: was === 'planned' ? '(attribute_not_exists(#s) OR #s = :was)' : '#s = :was',
      ExpressionAttributeNames: { '#s': 'State' },
      ExpressionAttributeValues: values,
    },
  }, {
    Update: {
      Key: metaKey(code),
      UpdateExpression: 'SET LiveItem = :item, #st = :running, LiveAt = :now',
      ConditionExpression: `${prevId ? 'LiveItem = :prev' : 'attribute_not_exists(LiveItem)'} AND (attribute_not_exists(#st) OR #st <> :ended)`,
      ExpressionAttributeNames: { '#st': 'State' },
      ExpressionAttributeValues: {
        ':item': itemId, ':running': 'LIVE', ':ended': 'ENDED', ':now': now, ...(prevId ? { ':prev': prevId } : {}),
      },
    },
  }];
  if (prev) tx.push(stepAside(code, prev, now, { finished: prevFinished }));

  try {
    await db.send(new TransactWriteCommand({ TransactItems: tx.map((t) => ({ Update: { TableName: tableName, ...t.Update } })) }));
  } catch (error) {
    if (created) await C.discardChildSession(db, tableName, gameId, meta.orgId);
    if (S.isCancelled(error)) return { refusal: raced() };
    throw error;
  }

  if (meta.State !== 'LIVE') {
    await markList(db, tableName, meta, code, 'LIVE');
    // THE EVENT'S $2.00, counted once, the first time it goes live (the owner,
    // 27 Sep 2026: "all events cost money" — calculated, not charged). A
    // preview (Open) never gets here, so an agenda drafted and never run costs
    // nothing. It never throws: a meter must not stop a room.
    await recordBillableEvent(meta.orgId, code, { db, tableName });
  }

  // The rows are written; now the rooms. The item that was live hears that
  // it paused AND what started, so its phones can follow at once.
  if (prev && prev.GameId) {
    if (prevFinished) {
      await C.toSession(db, tableName, prev.GameId, { type: 'eventItemEnded', event: code, itemId: prevId });
    } else {
      await C.setPaused(db, tableName, prev.GameId, true);
      await C.toSession(db, tableName, prev.GameId, { type: 'eventItemPaused', event: code, itemId: prevId });
    }
    await C.toSession(db, tableName, prev.GameId, {
      type: 'eventItemStarted', event: code, itemId, itemType: row.Type || '', ...(gameId ? { gameId } : {}),
    });
  }
  if (was === 'paused' && gameId) {
    await C.setPaused(db, tableName, gameId, false);
    await C.toSession(db, tableName, gameId, { type: 'eventItemResumed', event: code, itemId, gameId });
  }
  console.log(`▶️ run: EVENT#${code} ${itemId} ${was} → live${gameId ? ` (${gameId}${created ? ', new' : ''})` : ''}${prevId ? `; ${prevId} stepped aside` : ''}`);
  return { gameId };
}

async function pause(db, tableName, { meta, code, row, itemId }) {
  const was = stateOf(row);
  if (was === 'paused') return {};
  if (was !== 'live') return { refusal: refuse('Only a live item can be paused.', 'item_not_live') };
  // A break is never paused (decision 7): going back to the agenda ends it.
  if (row.Type === rules.BREAK) return end(db, tableName, { meta, code, row, itemId });
  const now = new Date().toISOString();
  try {
    await db.send(new TransactWriteCommand({
      TransactItems: [{
        Update: {
          TableName: tableName,
          Key: itemKey(code, itemId),
          UpdateExpression: 'SET #s = :paused, PausedAt = :now',
          ConditionExpression: '#s = :live',
          ExpressionAttributeNames: { '#s': 'State' },
          ExpressionAttributeValues: { ':paused': 'paused', ':live': 'live', ':now': now },
        },
      }, {
        Update: {
          TableName: tableName,
          Key: metaKey(code),
          UpdateExpression: 'REMOVE LiveItem',
          ConditionExpression: 'LiveItem = :item',
          ExpressionAttributeValues: { ':item': itemId },
        },
      }],
    }));
  } catch (error) {
    if (S.isCancelled(error)) return { refusal: raced() };
    throw error;
  }
  if (row.GameId) {
    await C.setPaused(db, tableName, row.GameId, true);
    await C.toSession(db, tableName, row.GameId, { type: 'eventItemPaused', event: code, itemId });
  }
  console.log(`⏸️ run: EVENT#${code} ${itemId} live → paused`);
  return {};
}

/**
 * End an engagement's session, or say why not. `null` when it is ended (or
 * already was); a refusal otherwise.
 */
async function endChild(db, tableName, gameId) {
  const state = await readSessionState(db, tableName, gameId);
  const current = state && state.State;
  if (!state || current === 'ENDED') return null;
  const broadcastToGame = (id, message) => C.toSession(db, tableName, id, message);
  if (current === C.SURVEY_OPEN) {
    return refuse('The survey is still collecting. Close it on the stage, then end the item.', 'survey_open');
  }
  if (current === 'SURVEY#CLOSED') {
    // Closed means frozen (game/survey-host.js close); ending is survey-host's
    // own CLOSED → ENDED step, conditioned the same way.
    const now = new Date().toISOString();
    try {
      await db.send(new UpdateCommand({
        TableName: tableName,
        Key: { PK: `GAME#${gameId}`, SK: 'STATE' },
        UpdateExpression: 'SET #state = :ended, #endedAt = :at, #updatedAt = :at REMOVE EventPaused',
        ConditionExpression: '#state = :closed',
        ExpressionAttributeNames: { '#state': 'State', '#endedAt': 'EndedAt', '#updatedAt': 'UpdatedAt' },
        ExpressionAttributeValues: { ':ended': 'ENDED', ':closed': 'SURVEY#CLOSED', ':at': now },
      }));
      await broadcastToGame(gameId, { type: 'gameEnded', gameId, state: 'ENDED' });
    } catch (error) {
      if (!(error && error.name === 'ConditionalCheckFailedException')) throw error;
    }
    return null;
  }
  await endSession(db, tableName, gameId, { currentState: current, broadcastToGame });
  if (state.EventPaused) await C.setPaused(db, tableName, gameId, false);
  return null;
}

async function end(db, tableName, { meta, code, row, itemId }) {
  const was = stateOf(row);
  if (was === 'done') return {};
  if (was === 'planned') return { refusal: refuse('This item has not started, so there is nothing to end.', 'item_not_started') };
  if (row.GameId) {
    const refusal = await endChild(db, tableName, String(row.GameId));
    if (refusal) return { refusal };
  }
  const now = new Date().toISOString();
  const tx = [{
    Update: {
      TableName: tableName,
      Key: itemKey(code, itemId),
      UpdateExpression: 'SET #s = :done, EndedAt = :now',
      ConditionExpression: '#s = :was',
      ExpressionAttributeNames: { '#s': 'State' },
      ExpressionAttributeValues: { ':done': 'done', ':was': was, ':now': now },
    },
  }];
  if (meta.LiveItem === itemId) {
    tx.push({
      Update: {
        TableName: tableName,
        Key: metaKey(code),
        UpdateExpression: 'REMOVE LiveItem',
        ConditionExpression: 'LiveItem = :item',
        ExpressionAttributeValues: { ':item': itemId },
      },
    });
  }
  try {
    await db.send(new TransactWriteCommand({ TransactItems: tx }));
  } catch (error) {
    if (S.isCancelled(error)) return { refusal: raced() };
    throw error;
  }
  if (row.GameId) await C.toSession(db, tableName, row.GameId, { type: 'eventItemEnded', event: code, itemId });
  console.log(`⏹️ run: EVENT#${code} ${itemId} ${was} → done`);
  return {};
}

async function extend(db, tableName, { code, row, itemId }) {
  if (row.Type !== rules.BREAK || stateOf(row) !== 'live') {
    return { refusal: refuse('Only a break that is running can be made longer.', 'not_a_live_break') };
  }
  const from = Math.max(Date.parse(row.EndsAt || '') || 0, Date.now());
  try {
    await db.send(new UpdateCommand({
      TableName: tableName,
      Key: itemKey(code, itemId),
      UpdateExpression: 'SET EndsAt = :ends',
      ConditionExpression: '#s = :live',
      ExpressionAttributeNames: { '#s': 'State' },
      ExpressionAttributeValues: { ':ends': new Date(from + EXTEND_MINUTES * MINUTE_MS).toISOString(), ':live': 'live' },
    }));
  } catch (error) {
    if (error && error.name === 'ConditionalCheckFailedException') return { refusal: raced() };
    throw error;
  }
  return {};
}

/**
 * THE DAY IS OVER. Every live or paused item ends first — an open survey
 * refuses the whole step, naming itself, so the host can close it — then
 * METADATA says ENDED and the agenda has nothing live. Planned items stay
 * planned: they simply did not happen. Joining is refused from here on
 * (attendees.js); the agenda stays readable.
 */
async function endEvent(db, tableName, { meta, code }) {
  if (meta.State === 'ENDED') return {};
  const rows = await S.readItems(db, tableName, code);
  let current = meta;
  for (const row of rows) {
    const was = stateOf(row);
    if (was !== 'live' && was !== 'paused') continue;
    const itemId = S.itemIdOf(row);
    const { refusal } = await end(db, tableName, { meta: current, code, row, itemId });
    if (refusal) return { refusal };
    // end() took LiveItem off METADATA with the live item; the next end must
    // not condition on it again.
    if (current.LiveItem === itemId) current = { ...current, LiveItem: undefined };
  }
  const now = new Date().toISOString();
  try {
    await db.send(new UpdateCommand({
      TableName: tableName,
      Key: metaKey(code),
      UpdateExpression: 'SET #st = :ended, EndedAt = :now REMOVE LiveItem',
      ConditionExpression: 'attribute_exists(PK)',
      ExpressionAttributeNames: { '#st': 'State' },
      ExpressionAttributeValues: { ':ended': 'ENDED', ':now': now },
    }));
  } catch (error) {
    if (error && error.name === 'ConditionalCheckFailedException') return { refusal: raced() };
    throw error;
  }
  await markList(db, tableName, meta, code, 'ENDED');
  for (const row of rows) {
    if (!row.GameId) continue;
    if (stateOf(row) === 'planned') {
      await letPreviewGo(db, tableName, meta, code, row);
    } else {
      await C.toSession(db, tableName, row.GameId, { type: 'eventEnded', event: code });
    }
  }
  console.log(`🏁 run: EVENT#${code} ended`);
  return {};
}

/**
 * A PREVIEW NOBODY TOOK LIVE, at the end of the day (prepare): its session
 * was never opened and now never will be, so it goes — and its code with it,
 * rather than being held for the unstarted TTL's ninety days — and the item
 * forgets it, so the host's board cannot open a session that is gone. Both
 * best effort: discardChildSession never throws, and a pointer left behind
 * costs one "not found" on a board whose day is over.
 */
async function letPreviewGo(db, tableName, meta, code, row) {
  const gameId = String(row.GameId);
  await C.discardChildSession(db, tableName, gameId, meta.orgId);
  try {
    await db.send(new UpdateCommand({
      TableName: tableName,
      Key: itemKey(code, S.itemIdOf(row)),
      UpdateExpression: 'REMOVE GameId, PreparedAt',
      ConditionExpression: 'GameId = :gid AND (attribute_not_exists(#s) OR #s = :planned)',
      ExpressionAttributeNames: { '#s': 'State' },
      ExpressionAttributeValues: { ':gid': gameId, ':planned': 'planned' },
    }));
  } catch (error) {
    console.warn(`⚠️ run: EVENT#${code} kept a pointer to its discarded preview ${gameId}: ${error && error.name}`);
  }
}

/**
 * THE EVENTS LIST SAYS IT TOO: Running, then Ended, on the organisation's list
 * row, which the console's list reads without opening every event. Best
 * effort, after the event's own rows: a miss costs the list a word.
 */
async function markList(db, tableName, meta, code, state) {
  if (!meta.orgId) return;
  try {
    await db.send(new UpdateCommand({
      TableName: tableName,
      Key: { PK: tenant.eventsIndexPk(meta.orgId), SK: S.indexSk(code) },
      UpdateExpression: 'SET #st = :st',
      ConditionExpression: 'attribute_exists(PK)',
      ExpressionAttributeNames: { '#st': 'State' },
      ExpressionAttributeValues: { ':st': state },
    }));
  } catch (error) {
    console.warn(`⚠️ run: the list row of EVENT#${code} did not take ${state}: ${error && error.name}`);
  }
}

/**
 * ONE MORE ON RunRev — how a phone polling the agenda's `now` view learns that
 * something it shows changed (get-agenda.js revOf), a paused item ending
 * included, which touches no other METADATA field. Best effort: a miss costs
 * a phone one slower refresh, never a write.
 */
async function bumpRev(db, tableName, code) {
  try {
    await db.send(new UpdateCommand({
      TableName: tableName,
      Key: metaKey(code),
      UpdateExpression: 'ADD RunRev :one',
      ConditionExpression: 'attribute_exists(PK)',
      ExpressionAttributeValues: { ':one': 1 },
    }));
  } catch (error) {
    console.warn(`⚠️ run: EVENT#${code} RunRev did not move: ${error && error.name}`);
  }
}

/** POST /events/{code}/run, past the host's door. */
async function runEvent(db, tableName, request, meta, code) {
  const body = readBody(request);
  if (!body) return json(400, { error: 'The request body is not valid JSON.' });
  const action = String(body.action || '');
  if (!ACTIONS.includes(action)) return json(400, { error: `Say what to do: ${ACTIONS.join(', ')}.` });

  let outcome;
  if (action === 'end-event') {
    outcome = await endEvent(db, tableName, { meta, code });
  } else {
    if (meta.State === 'ENDED') return refuse('This event has ended.', 'event_ended');
    const itemId = String(body.itemId || '');
    const row = await readItem(db, tableName, code, itemId);
    if (!row) return itemGone();
    const ctx = { meta, code, row, itemId };
    if (action === 'prepare') {
      outcome = await prepare(db, tableName, ctx);
    } else if (action === 'start' || action === 'resume') {
      if (action === 'resume' && stateOf(row) !== 'paused' && stateOf(row) !== 'live') {
        return refuse('Only a paused item can be resumed.', 'item_not_paused');
      }
      outcome = await start(db, tableName, ctx);
    } else if (action === 'pause') {
      outcome = await pause(db, tableName, ctx);
    } else if (action === 'end') {
      outcome = await end(db, tableName, ctx);
    } else {
      outcome = await extend(db, tableName, ctx);
    }
  }
  if (outcome && outcome.refusal) return outcome.refusal;
  await bumpRev(db, tableName, code);
  const fresh = await S.readMeta(db, tableName, code);
  const view = await S.hostView(db, tableName, fresh || meta, code, 'run');
  return json(200, { ...view, ...(outcome && outcome.gameId ? { gameId: outcome.gameId } : {}) });
}

module.exports = { ACTIONS, EXTEND_MINUTES, RACED, runEvent };
