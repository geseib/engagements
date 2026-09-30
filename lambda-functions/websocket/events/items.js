/**
 * AN EVENT'S AGENDA ITEMS. docs/design/agenda-redesign/02, 02b, 03.
 *
 *   POST   /events/{code}/items            add one, at a position
 *   DELETE /events/{code}/items/{itemId}   remove one that has not started
 *   PUT    /events/{code}/items            reorder: { order: [itemId, …] }
 *   PUT    /events/{code}/items/{itemId}   edit: title, description, minutes,
 *                                          who leads it, and "Use vN" for an
 *                                          engagement; a presentation's slides
 *   POST   /events/{code}/deck             sign one upload of a PDF (slides)
 *   GET    /events/{code}/items/{itemId}/deck   a presentation's slides, to
 *                                          show on the stage (a signed read)
 *
 * THE KINDS (events M1b): five engagements (survey included), a presentation
 * (with its slides as one PDF, if the host adds them — deck-store.js), an
 * activity (`custom`) and a break. Every kind but a break may name who leads it — `ledBy`, stored as
 * `LedBy` and sealed with the item's words. An engagement also carries its
 * session options — the create dialog's own, checked by item-settings.js and
 * sealed whole as `Settings` — which roadmap M3 feeds into the item's
 * session (agenda-rules.sessionFormOf).
 *
 * Every route opens the event through event-store.openEvent: another
 * organisation's event, an unknown code and a malformed one are the same 404.
 *
 * ── THE CAPS ARE HELD BY THE WRITE, NOT BY A READ ─────────────────────────
 * 16 items, 8 of them engagements, breaks uncounted (agenda-rules.js). The
 * builder disables what cannot be added and says why, and this route checks
 * METADATA's counts first so a refusal carries the builder's own sentence.
 * Neither can stop two hosts adding the ninth engagement at the same moment
 * (02-builder: "so two hosts editing at once cannot slip past it"). So the
 * item's Put rides in ONE transaction with the METADATA counters' update,
 * conditioned `ItemCount < 16` (and `EngagementCount < 8` for an engagement),
 * and the loser's whole transaction is cancelled: none of it lands.
 *
 * ── ORDER IS A FIELD ──────────────────────────────────────────────────────
 * RATIONALE §c: "a reorder rewrites numbers, never keys". Every row carries
 * `Order`, 1..n. A MID-LIST insert renumbers the rows after it in the same
 * transaction as the Put, each update conditioned on the number it read, so a
 * concurrent change cancels the lot rather than leaving two rows with one
 * number. An APPEND renumbers no existing row at all — there is nothing after
 * it — so that alone cannot stop two concurrent appends computing the same
 * `Order` from the same `rows.length` and both landing. What stops them is
 * the same guard the cap race already needs: the METADATA counters' Update
 * (below) is conditioned on `ItemCount`/`EngagementCount`/`BreakCount`
 * matching what THIS request read, so the loser's counters move out from
 * under it and its whole transaction — Put included — cancels. See
 * tests/event-caps.js §8 for two concurrent appends proven to land at
 * different Orders, never the same one.
 *
 * ── ONLY A PLANNED ITEM CHANGES ───────────────────────────────────────────
 * An item is born `planned` (decision 11: nothing is active before the host
 * starts it on the day). Starting, pausing and ending belong to roadmap M3,
 * and none of them is here. Every edit and removal here is conditioned on
 * `State = planned`, so an item that has started cannot be changed under the
 * room.
 *
 * ── A RACE AGAINST update-event.js's DATE MOVE ────────────────────────────
 * update-event.js rewrites every row's `ttl` in one transaction when an
 * event's date changes, built from a read of the agenda taken before that
 * transaction commits. An item added here between that read and that commit
 * would otherwise carry the ttl this route read at ITS OWN start — stale the
 * instant the date move lands. So the add's transaction carries the item's
 * Put ALONGSIDE the METADATA counters' Update, and it is that counters'
 * Update alone — never the Put — that also carries a `ttl = :ttlWas`
 * condition, `:ttlWas` the event's ttl as this request read it: if a date
 * move commits first, that condition fails, the whole add cancels (Put
 * included, since the transaction is all-or-nothing), and the caller sees the
 * same AGENDA_CHANGED 409 a lost cap or Order race gets. The opposite
 * ordering — an add landing between update-event's read of the items and ITS
 * commit — is update-event's own condition to hold (its METADATA Update, when
 * the date moves, also checks ItemCount/EngagementCount/BreakCount against
 * what it read at its own start); together the two conditions mean a date
 * move and an add can never both land with one row on the old clock. See
 * tests/event-caps.js §7 for both orderings driven end to end.
 */
const crypto = require('crypto');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, TransactWriteCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const tenant = require('../tenant');
const { encryptItem, encryptValue } = require('../tenant-crypto');
const { getSetMetadata, knownVersions, toVersion } = require('../set-version');
const rules = require('./agenda-rules');
const { json, notFound, readBody, trace, methodOf } = require('./event-http');
const S = require('./event-store');
const { checkItemSettings } = require('./item-settings');
const { questionCountAt } = require('../session-goal');
const { runEvent } = require('./run');
const { discardChildSession } = require('./child-session');
const D = require('./deck-store');

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = () => process.env.TABLE_NAME;
const PLANNED = 'planned';
const NOT_PLANNED = 'This item has started, so it cannot be changed here.';

/**
 * AN ITEM THAT IS GONE SAYS SO (final review M2). Every route here has
 * already passed the event's door (openEvent), so the caller may see this
 * event: telling them one of its items was removed — by a co-host, or in
 * another tab — leaks nothing. The door's own "No event has that code." above
 * an event that is plainly open would be false. The console reloads the
 * agenda on this 404, as it does on a 409.
 */
const itemGone = () => json(404, { error: 'That item is no longer on the agenda.', code: 'item_gone' });

const countsOf = (meta) => ({
  items: Number(meta.ItemCount) || 0,
  engagements: Number(meta.EngagementCount) || 0,
  breaks: Number(meta.BreakCount) || 0,
});
const newItemId = () => `it_${crypto.randomBytes(4).toString('hex')}`;

/**
 * Where a new item goes: its 0-based index in the whole agenda, breaks
 * included. Only a genuine integer counts as a request for a particular
 * place; anything else — no `position` at all, `null`, `''`, `false`, a
 * float, a string — means "append at the end". Checked by `typeof` rather
 * than coerced with `Number()`, because `Number(null)` and `Number('')` are
 * both `0` in JavaScript: coercing first would silently turn "no position
 * given" into "prepend", which is not what an omitted field means anywhere
 * else in this route.
 */
function clampPosition(value, length) {
  if (typeof value !== 'number' || !Number.isInteger(value)) return length;
  return Math.max(0, Math.min(length, value));
}

/**
 * THE COUNTERS, moved in the same transaction as the row they count. With
 * `capFor`, the update also carries the cap that `type` must still be under,
 * so a race lost between this route's read and its write cancels the write.
 *
 * `wasCounts` (add only) — `{items, engagements, breaks}`, this request's own
 * `countsOf(meta)` — ties the whole Update to the counts as THIS request read
 * them: `ItemCount = :icWas AND EngagementCount = :ecWas AND BreakCount =
 * :bcWas`, alongside (never instead of) the cap conditions above. This is
 * what stops two concurrent APPENDS landing at the same `Order`: an append
 * renumbers no existing row (see the file header's "ORDER IS A FIELD"), so
 * without this the second add's transaction has nothing in it that the
 * first add's transaction also touches, and both commit. With it, the first
 * add's counters move and the second add's equality check fails the moment
 * it tries to commit, cancelling its Put along with everything else in its
 * transaction.
 *
 * `ttlWas`, given only when adding, ties the same Update to the event's ttl
 * as this request read it — see the file header's note on the date-move race.
 * A removal touches no row that carries a fresh ttl or depends on a read of
 * `rows.length`, so it passes neither `wasCounts` nor `ttlWas`.
 */
function counterUpdate(code, delta, now, capFor, ttlWas, wasCounts) {
  const conditions = ['attribute_exists(PK)'];
  const names = { '#ua': 'UpdatedAt', '#ic': 'ItemCount', '#ec': 'EngagementCount', '#bc': 'BreakCount' };
  const values = { ':di': delta.items, ':de': delta.engagements, ':db': delta.breaks, ':now': now };
  if (capFor === rules.BREAK) {
    conditions.push('#bc < :maxB');
    values[':maxB'] = rules.MAX_BREAKS;
  } else if (capFor) {
    conditions.push('#ic < :maxI');
    values[':maxI'] = rules.MAX_ITEMS;
    if (rules.isEngagement(capFor)) {
      conditions.push('#ec < :maxE');
      values[':maxE'] = rules.MAX_ENGAGEMENTS;
    }
  }
  if (wasCounts) {
    conditions.push('#ic = :icWas', '#ec = :ecWas', '#bc = :bcWas');
    values[':icWas'] = wasCounts.items;
    values[':ecWas'] = wasCounts.engagements;
    values[':bcWas'] = wasCounts.breaks;
  }
  if (ttlWas !== undefined) {
    conditions.push('#ttl = :ttlWas');
    names['#ttl'] = 'ttl';
    values[':ttlWas'] = ttlWas;
  }
  return {
    TableName: TABLE(),
    Key: { PK: tenant.eventPk(code), SK: S.META_SK },
    UpdateExpression: 'SET #ua = :now ADD #ic :di, #ec :de, #bc :db',
    ConditionExpression: conditions.join(' AND '),
    ExpressionAttributeNames: names,
    ExpressionAttributeValues: values,
  };
}

/** The organisation's list shows each event's count of items; breaks are not items. */
function listCountUpdate(orgId, code, delta) {
  return {
    TableName: TABLE(),
    Key: { PK: tenant.eventsIndexPk(orgId), SK: S.indexSk(code) },
    UpdateExpression: 'ADD #ic :d',
    ConditionExpression: 'attribute_exists(PK)',
    ExpressionAttributeNames: { '#ic': 'ItemCount' },
    ExpressionAttributeValues: { ':d': delta },
  };
}

/** Give one row a new place, only if it still holds the place this route read. */
function orderUpdate(row, order, now) {
  return {
    TableName: TABLE(),
    Key: { PK: row.PK, SK: row.SK },
    UpdateExpression: 'SET #o = :n, #ua = :now',
    ConditionExpression: 'attribute_exists(SK) AND #o = :was',
    ExpressionAttributeNames: { '#o': 'Order', '#ua': 'UpdatedAt' },
    ExpressionAttributeValues: { ':n': order, ':was': Number(row.Order) || 0, ':now': now },
  };
}

/**
 * PIN THE SET an engagement plays: `{scope, orgId, setId, version}`.
 *
 * An ORG set is always the EVENT's organisation's. The `orgId` a browser
 * sends is never read, so no request can point an agenda at another team's
 * library — the set is looked for in exactly one partition and is absent,
 * not forbidden, anywhere else. The version is the one asked for if the set
 * has it, else the set's current one: pinned when added, and changed later
 * only by an explicit "Use vN" (PUT), never silently (RATIONALE §c).
 *
 * The set's row comes back too (`setRow`), so a goal can be checked against
 * the size of the version pinned.
 */
async function pinSet(meta, type, requested) {
  const scope = String((requested && requested.scope) || '').trim();
  const setId = String((requested && requested.setId) || '').trim();
  if (!setId || !tenant.SCOPES.includes(scope)) return { error: 'Choose a question set for this item.' };
  const ref = { scope, orgId: scope === tenant.ORG ? meta.orgId : '', setId };
  const row = await getSetMetadata(db, TABLE(), ref);
  if (!row) return { error: 'That question set is not in a library this event can use.' };
  if (row.active === false) return { error: 'That question set is switched off. Switch it on in Question sets first.' };
  const setType = rules.canonicalSetType(row.engagementType);
  if (setType !== type) {
    return { error: `That is a ${rules.TYPE_LABELS[setType] || 'different kind of'} set, and this item is ${rules.TYPE_LABELS[type]}.` };
  }
  const active = toVersion(row.activeVersion);
  let version = active;
  if (requested && requested.version !== undefined && requested.version !== null) {
    version = toVersion(requested.version);
    if (version === null || !(knownVersions(row).includes(version) || version === active)) {
      return { error: 'That version of the question set does not exist.' };
    }
  }
  return { setRef: { scope, orgId: ref.orgId, setId, version }, setRow: row };
}

async function readItem(code, itemId) {
  if (!S.isItemId(itemId)) return null;
  const res = await db.send(new GetCommand({
    TableName: TABLE(),
    Key: { PK: tenant.eventPk(code), SK: S.itemSk(itemId) },
    ConsistentRead: true,
  }));
  return (res && res.Item) || null;
}

// ── POST: add ───────────────────────────────────────────────────────────────
async function addItem(request, meta, code) {
  const body = readBody(request);
  if (!body) return json(400, { error: 'The request body is not valid JSON.' });
  const type = String(body.type || '').trim();
  if (!rules.ITEM_TYPES.includes(type)) return json(400, { error: 'That is not a kind of agenda item.' });
  const fields = rules.checkItemFields(body, type);
  if (fields.error) return json(400, { error: fields.error });
  const leader = rules.checkLedBy(body.ledBy, type);
  if (leader.error) return json(400, { error: leader.error });

  const wasCounts = countsOf(meta);
  const capped = rules.capRefusal(wasCounts, type);
  if (capped) return json(409, { error: capped.message, cap: capped.cap });

  let setRef = null;
  let settings = null;
  if (rules.isEngagement(type)) {
    const pinned = await pinSet(meta, type, body.setRef);
    if (pinned.error) return json(400, { error: pinned.error });
    setRef = pinned.setRef;
    // The session options (events M1b), checked by create's rules; a goal
    // against the size of the version just pinned.
    const checked = checkItemSettings(type, body.settings, {
      questionCount: questionCountAt(pinned.setRow, setRef.version),
    });
    if (checked.error) return json(400, { error: checked.error });
    settings = checked.value;
  } else if (body.settings !== undefined && body.settings !== null) {
    return json(400, { error: 'Only an engagement has session options.' });
  }

  // A PRESENTATION'S SLIDES (deck-store.js): an upload this event signed,
  // proven a PDF and attached before the row is written — and let go again
  // if the row then loses a race, so no deck outlives a refused add.
  let deck = null;
  if (body.deck !== undefined && body.deck !== null) {
    if (!rules.hasDeck(type)) return json(400, { error: 'Only a presentation has slides.' });
    const attached = await D.attachDeck(body.deck, { orgId: meta.orgId, code });
    if (attached.error) return json(400, { error: attached.error });
    deck = attached.value;
  }

  const rows = await S.readItems(db, TABLE(), code);
  const position = clampPosition(body.position, rows.length);
  const now = new Date().toISOString();
  const itemId = newItemId();
  const plain = {
    PK: tenant.eventPk(code),
    SK: S.itemSk(itemId),
    Type: type,
    Order: position + 1,
    Minutes: fields.value.minutes,
    Title: fields.value.title,
    Description: fields.value.description,
    // Who leads it (sealed below with Title and Description); a break has none.
    ...(rules.hasLeader(type) ? { LedBy: leader.value } : {}),
    State: PLANNED,
    ...(setRef ? { SetRef: setRef } : {}),
    // Sealed whole with the item's words (tenant-crypto `item`).
    ...(settings ? { Settings: settings } : {}),
    // The slides: where they are, their size and pages, the page the stage
    // is on; the file's name is sealed with the words.
    ...(deck ? { Deck: deck.Deck, DeckName: deck.DeckName, DeckPage: 1 } : {}),
    CreatedAt: now,
    UpdatedAt: now,
    ttl: meta.ttl,
  };
  const counted = rules.isCounted(type);
  const delta = { items: counted ? 1 : 0, engagements: rules.isEngagement(type) ? 1 : 0, breaks: counted ? 0 : 1 };
  const tx = [
    { Put: { TableName: TABLE(), Item: await encryptItem(meta.orgId, 'item', plain), ConditionExpression: 'attribute_not_exists(SK)' } },
    { Update: counterUpdate(code, delta, now, type, meta.ttl, wasCounts) },
  ];
  if (counted) tx.push({ Update: listCountUpdate(meta.orgId, code, 1) });
  [...rows.slice(0, position), null, ...rows.slice(position)].forEach((row, i) => {
    if (row && Number(row.Order) !== i + 1) tx.push({ Update: orderUpdate(row, i + 1, now) });
  });

  try {
    await db.send(new TransactWriteCommand({ TransactItems: tx }));
  } catch (error) {
    if (deck) await D.removeObject(deck.Deck.key);
    if (!S.isCancelled(error)) throw error;
    // Lost a race. If it was the cap, say the cap's sentence — that is what
    // the other host's add has just made true. Otherwise it was the ttl
    // guard, or the counts guard (another add or remove landed, including a
    // concurrent append that would otherwise have shared this one's Order):
    // the generic "reload and try again" sentence.
    const fresh = await S.readMeta(db, TABLE(), code);
    if (!fresh) return notFound();
    const capNow = rules.capRefusal(countsOf(fresh), type);
    if (capNow) return json(409, { error: capNow.message, cap: capNow.cap });
    return json(409, { error: S.AGENDA_CHANGED, code: 'agenda_changed' });
  }
  return json(201, { item: S.projectItem(plain) });
}

// ── DELETE: remove ──────────────────────────────────────────────────────────
async function removeItem(meta, code, itemId) {
  const row = await readItem(code, itemId);
  if (!row) return itemGone();
  if (row.State !== PLANNED) return json(409, { error: NOT_PLANNED, code: 'not_planned' });
  const counted = rules.isCounted(row.Type);
  const delta = { items: counted ? -1 : 0, engagements: rules.isEngagement(row.Type) ? -1 : 0, breaks: counted ? 0 : -1 };
  const now = new Date().toISOString();
  const tx = [
    {
      Delete: {
        TableName: TABLE(),
        Key: { PK: row.PK, SK: row.SK },
        ConditionExpression: 'attribute_exists(SK) AND #st = :planned',
        ExpressionAttributeNames: { '#st': 'State' },
        ExpressionAttributeValues: { ':planned': PLANNED },
      },
    },
    { Update: counterUpdate(code, delta, now, null) },
  ];
  if (counted) tx.push({ Update: listCountUpdate(meta.orgId, code, -1) });
  try {
    await db.send(new TransactWriteCommand({ TransactItems: tx }));
  } catch (error) {
    if (!S.isCancelled(error)) throw error;
    return json(409, { error: S.AGENDA_CHANGED, code: 'agenda_changed' });
  }
  // A previewed item's unopened session goes with it (run.js `prepare`).
  if (row.GameId) await discardChildSession(db, TABLE(), String(row.GameId), meta.orgId);
  // And a presentation's slides: nothing else points at them.
  if (row.Deck && row.Deck.key) await D.removeObject(row.Deck.key);
  return json(200, { removed: itemId });
}

// ── PUT /items/{itemId}: edit ───────────────────────────────────────────────
/*
  DID THIS EDIT CHANGE WHAT A PREPARED SESSION WAS MADE FROM? The set (id,
  scope, version) or the session options. `settings` is undefined when the
  request left them alone; when it carries them, they are compared with the
  stored ones as settingsFor normalises both, key order aside, so a builder
  that re-sends unchanged options on every save does not count as a change.
*/
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((out, k) => { out[k] = canonical(value[k]); return out; }, {});
  }
  return value === undefined ? null : value;
}
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

function sessionInputsChanged(row, current, setRef, settings) {
  if (!same(row.SetRef || null, setRef || null)) return true;
  if (settings === undefined) return false;
  return !same(rules.settingsFor(row.Type, current.Settings), rules.settingsFor(row.Type, settings));
}

/*
  A NEW TITLE ON A PREPARED SESSION. The title is the session's name on the
  stage, so it is copied on rather than left stale — as ciphertext, on both
  rows that carry it (METADATA and the org's GAMES index row; see
  schema-compliant-manager.js and game/update-game.js's MIRROR, which do the
  same for a session renamed from the console).

  If the prepared session is already gone, the item's pointer to it is removed
  so the next preview or go-live makes a fresh one instead of reaching for a
  code that no longer exists. Best effort otherwise: a failed index-row write
  only leaves a session list showing the old name.
*/
async function renamePrepared(row, gameId, title, orgId) {
  const sealed = orgId ? await encryptValue(orgId, title) : title;
  try {
    await db.send(new UpdateCommand({
      TableName: TABLE(),
      Key: { PK: `GAME#${gameId}`, SK: 'METADATA' },
      UpdateExpression: 'SET #t = :t',
      ConditionExpression: 'attribute_exists(PK)',
      ExpressionAttributeNames: { '#t': 'Title' },
      ExpressionAttributeValues: { ':t': sealed },
    }));
  } catch (error) {
    if (!(error && error.name === 'ConditionalCheckFailedException')) throw error;
    await db.send(new UpdateCommand({
      TableName: TABLE(),
      Key: { PK: row.PK, SK: row.SK },
      UpdateExpression: 'REMOVE GameId, PreparedAt',
      ConditionExpression: 'GameId = :g',
      ExpressionAttributeValues: { ':g': gameId },
    })).catch((e) => console.warn('rename: could not clear a stale prepared pointer', e && e.message));
    return;
  }
  if (!orgId) return;
  await db.send(new UpdateCommand({
    TableName: TABLE(),
    Key: { PK: tenant.gamesIndexPk(orgId), SK: `GAME#${gameId}` },
    UpdateExpression: 'SET #t = :t',
    ConditionExpression: 'attribute_exists(PK)',
    ExpressionAttributeNames: { '#t': 'Title' },
    ExpressionAttributeValues: { ':t': sealed },
  })).catch((e) => console.warn('rename: the session list keeps the old title', e && e.message));
}

async function editItem(request, meta, code, itemId) {
  const body = readBody(request);
  if (!body) return json(400, { error: 'The request body is not valid JSON.' });
  const row = await readItem(code, itemId);
  if (!row) return itemGone();
  if (row.State !== PLANNED) return json(409, { error: NOT_PLANNED, code: 'not_planned' });

  const current = await S.decryptItemRow(meta.orgId, row);
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
  const leads = rules.hasLeader(row.Type);
  const fields = rules.checkItemFields({
    title: has('title') ? body.title : current.Title,
    description: has('description') ? body.description : current.Description,
    minutes: has('minutes') ? body.minutes : current.Minutes,
  }, row.Type);
  if (fields.error) return json(400, { error: fields.error });
  const leader = rules.checkLedBy(has('ledBy') ? body.ledBy : current.LedBy, row.Type);
  if (leader.error) return json(400, { error: leader.error });

  let setRef = row.SetRef || null;
  let setRow = null;
  const versionAsked = has('version');
  if (versionAsked) {
    if (!rules.isEngagement(row.Type) || !setRef) return json(400, { error: 'Only an engagement plays a version of a set.' });
    // fix round 1 nit: refuse a null version in plain words BEFORE pinSet —
    // pinSet's own null-handling means "keep the active version" (right for
    // an add's setRef, where no version at all means the same thing), but
    // "Use vN" is an explicit gesture and a null N is not a version. Left
    // unchecked, a set with no active version of its own would resolve to
    // `version: null`, and the goal-over sentence below would print "vnull".
    if (body.version === null) return json(400, { error: 'Choose a version to use.' });
    const pinned = await pinSet(meta, row.Type, { ...setRef, version: body.version });
    if (pinned.error) return json(400, { error: pinned.error });
    setRef = pinned.setRef;
    setRow = pinned.setRow;
  }

  /*
    THE SESSION OPTIONS (events M1b). `settings` replaces the whole map,
    checked by create's rules (item-settings.js). "Use vN" alone keeps the map
    but re-checks it against the version it moves to: a goal the new version
    cannot meet is refused in words, and a narrowed category list is reset to
    every category (a newer version may not have the same ones), which the
    reply says (`categoriesReset`) so the builder can. `undefined` below
    leaves the stored map alone — an item added before M1b keeps none.
  */
  // `settings: null` on a non-engagement is accepted as "none" — the same
  // rule addItem already holds for its own `else if` (fix round 1); only a
  // REAL settings object is a 400 here, matched by `has()` alone before.
  if (has('settings') && body.settings !== null && !rules.isEngagement(row.Type)) {
    return json(400, { error: 'Only an engagement has session options.' });
  }
  let settings;
  let categoriesReset = false;
  if (rules.isEngagement(row.Type) && (has('settings') || versionAsked)) {
    if (!setRow && setRef) {
      setRow = await getSetMetadata(db, TABLE(), {
        scope: setRef.scope, orgId: setRef.scope === tenant.ORG ? meta.orgId : '', setId: setRef.setId,
      });
    }
    const questionCount = questionCountAt(setRow, setRef && setRef.version);
    if (has('settings')) {
      const checked = checkItemSettings(row.Type, body.settings, { questionCount });
      if (checked.error) return json(400, { error: checked.error });
      settings = checked.value;
    } else {
      const kept = rules.settingsFor(row.Type, current.Settings);
      if (kept.target && questionCount && kept.target > questionCount) {
        return json(400, {
          error: `Your goal of ${kept.target} is more than v${setRef.version}’s ${questionCount} questions. Lower the goal, then use v${setRef.version}.`,
          code: 'goal_over',
        });
      }
      const moved = !row.SetRef || row.SetRef.version !== setRef.version;
      if (moved && kept.categoryIds && kept.categoryIds.length) {
        kept.categoryIds = [];
        categoriesReset = true;
      }
      settings = kept;
    }
  }

  /*
    A PRESENTATION'S SLIDES (deck-store.js). `deck: null` takes them off;
    `deck: { key, name, pages }` puts a new upload on, in place of any before.
    Checked LAST, after every other refusal this edit can meet, because
    attaching copies the file into place: a refused edit must not leave a
    deck behind. The old file goes once the row no longer points at it; the
    new one goes again if the write loses its race.
  */
  if (has('deck') && body.deck !== null && !rules.hasDeck(row.Type)) {
    return json(400, { error: 'Only a presentation has slides.' });
  }
  let deckChange;
  if (has('deck') && rules.hasDeck(row.Type)) {
    if (body.deck === null) {
      if (row.Deck) deckChange = null;
    } else {
      const attached = await D.attachDeck(body.deck, { orgId: meta.orgId, code });
      if (attached.error) return json(400, { error: attached.error });
      deckChange = attached.value;
    }
  }

  const now = new Date().toISOString();
  const words = {
    Title: fields.value.title,
    Description: fields.value.description,
    ...(leads ? { LedBy: leader.value } : {}),
  };
  const sealed = await encryptItem(meta.orgId, 'item', {
    ...words,
    ...(settings !== undefined ? { Settings: settings } : {}),
    ...(deckChange ? { DeckName: deckChange.DeckName } : {}),
  });
  const names = { '#t': 'Title', '#d': 'Description', '#m': 'Minutes', '#ua': 'UpdatedAt', '#st': 'State' };
  const values = { ':t': sealed.Title, ':d': sealed.Description, ':m': fields.value.minutes, ':now': now, ':planned': PLANNED };
  let expression = 'SET #t = :t, #d = :d, #m = :m, #ua = :now';
  /*
    A PREVIEWED ITEM (run.js `prepare`) has an unopened session made from what
    it said before this edit, and the host may have set things up inside it —
    above all a running order (Session → Questions → Queue).

    It is let go ONLY when the edit changes what the session was built from:
    the set or its version, or the session options (childGameData in
    child-session.js reads nothing else but the title). Then the pointer is
    removed and the session discarded (below, after the write lands), so the
    next preview or go-live makes one from what the item says now.

    Until 30 Sep 2026 every saved edit did that — a new description or a
    longer planned length silently threw away a queued running order (QA drive
    2026-09-29, found by fix workstream D). Description, length and leader
    never reach the session, so they now leave it alone; a new title is copied
    onto it (renamePrepared, below) rather than rebuilding it.
  */
  const prepared = row.GameId ? String(row.GameId) : '';
  const rebuild = Boolean(prepared) && sessionInputsChanged(row, current, setRef, settings);
  const retitle = Boolean(prepared) && !rebuild && fields.value.title !== (current.Title || '');
  /*
    THE ROW AS THIS REQUEST READ IT (fix round 1). Without this, a plain edit
    still writes back the `SetRef` and the `Settings` it read at the top of
    this function, even though neither changed — so two edits that overlap
    can each pass its OWN check against what it read and still leave the row
    in a state neither ever checked: "Use v1" lands, a concurrent settings
    edit (checked against the OLD v2) writes v2's SetRef back over it, and a
    THIRD edit that read the row as v1 lands last, carrying the second edit's
    now-too-large goal onto the version that cannot hold it. Conditioning on
    `UpdatedAt` (as update-event.js's own METADATA write already does) closes
    all of it in one guard: any write that landed since this request's own
    read moves `UpdatedAt`, so this one fails with the same AGENDA_CHANGED 409
    every other lost race here gets, rather than silently overwriting it.
  */
  const conditions = ['attribute_exists(SK)', '#st = :planned'];
  if (row.UpdatedAt === undefined) {
    conditions.push('attribute_not_exists(#ua)');
  } else {
    conditions.push('#ua = :uaWas');
    values[':uaWas'] = row.UpdatedAt;
  }
  if (leads) {
    expression += ', #lb = :lb';
    names['#lb'] = 'LedBy';
    values[':lb'] = sealed.LedBy;
  }
  if (setRef) {
    expression += ', #sr = :sr';
    names['#sr'] = 'SetRef';
    values[':sr'] = setRef;
  }
  if (settings !== undefined) {
    expression += ', #sx = :sx';
    names['#sx'] = 'Settings';
    values[':sx'] = sealed.Settings;
  }
  const removes = rebuild ? ['GameId', 'PreparedAt'] : [];
  if (deckChange) {
    expression += ', #dk = :dk, #dn = :dn, #dp = :dp';
    Object.assign(names, { '#dk': 'Deck', '#dn': 'DeckName', '#dp': 'DeckPage' });
    Object.assign(values, { ':dk': deckChange.Deck, ':dn': sealed.DeckName, ':dp': 1 });
  } else if (deckChange === null) {
    removes.push('Deck', 'DeckName', 'DeckPage');
  }
  try {
    await db.send(new UpdateCommand({
      TableName: TABLE(),
      Key: { PK: row.PK, SK: row.SK },
      UpdateExpression: removes.length ? `${expression} REMOVE ${removes.join(', ')}` : expression,
      ConditionExpression: conditions.join(' AND '),
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }));
  } catch (error) {
    if (deckChange) await D.removeObject(deckChange.Deck.key);
    if (error && error.name === 'ConditionalCheckFailedException') {
      return json(409, { error: S.AGENDA_CHANGED, code: 'agenda_changed' });
    }
    throw error;
  }
  if (rebuild) await discardChildSession(db, TABLE(), prepared, meta.orgId);
  if (retitle) await renamePrepared(row, prepared, fields.value.title, meta.orgId);
  if (deckChange !== undefined && row.Deck && row.Deck.key) await D.removeObject(row.Deck.key);
  // Projected from the DECRYPTED row, so nothing sealed reaches the response.
  return json(200, {
    item: S.projectItem({
      ...current, ...words, Minutes: fields.value.minutes,
      ...(setRef ? { SetRef: setRef } : {}),
      ...(settings !== undefined ? { Settings: settings } : {}),
      ...(deckChange ? { Deck: deckChange.Deck, DeckName: deckChange.DeckName, DeckPage: 1 } : {}),
      ...(deckChange === null ? { Deck: undefined, DeckName: undefined, DeckPage: undefined } : {}),
    }),
    ...(categoriesReset ? { categoriesReset: true } : {}),
  });
}

// ── PUT /items: reorder ─────────────────────────────────────────────────────
/**
 * Task 7 review, carried into this task's notes: conditioning each row's
 * write on the `Order` it read (below) catches a concurrent MID-LIST insert
 * or remove that touches one of the rows THIS reorder also repositions — that
 * shifts the row's `Order` out from under the condition. It does NOT catch a
 * concurrent APPEND: an append renumbers no existing row (items.js's own file
 * header, "ORDER IS A FIELD"), so a reorder that happens to leave every row it
 * touches at the `Order` it read would commit right over it, silently
 * stranding the appended item outside the order the host just saved. So this
 * transaction also carries the METADATA counters' Update, conditioned on
 * `ItemCount`/`EngagementCount`/`BreakCount` matching what THIS request read
 * — the same guard addItem's own counters' Update uses for the same reason
 * (counterUpdate's `wasCounts`). A concurrent add or remove always moves one
 * of those three, so it always fails this condition even when it never
 * touches a row's `Order` at all. See tests/event-item-edit.js, "a reorder is
 * refused, not silently missing a concurrent append".
 */
async function reorderItems(request, meta, code) {
  const body = readBody(request);
  if (!body) return json(400, { error: 'The request body is not valid JSON.' });
  const order = Array.isArray(body.order) ? body.order.map(String) : null;
  if (!order) return json(400, { error: 'Send the whole agenda\'s order: { order: [itemId, …] }.' });

  const rows = await S.readItems(db, TABLE(), code);
  const byId = new Map(rows.map((row) => [S.itemIdOf(row), row]));
  // The whole agenda, each item once — anything else was read from an agenda
  // that has since changed, and applying it would lose or duplicate a place.
  const whole = order.length === rows.length && new Set(order).size === order.length && order.every((id) => byId.has(id));
  if (!whole) return json(409, { error: S.AGENDA_CHANGED, code: 'agenda_changed' });

  const now = new Date().toISOString();
  const tx = [];
  order.forEach((id, i) => {
    const row = byId.get(id);
    if (Number(row.Order) !== i + 1) tx.push({ Update: orderUpdate(row, i + 1, now) });
  });
  if (tx.length) {
    const zero = { items: 0, engagements: 0, breaks: 0 };
    tx.push({ Update: counterUpdate(code, zero, now, null, undefined, countsOf(meta)) });
    try {
      await db.send(new TransactWriteCommand({ TransactItems: tx }));
    } catch (error) {
      if (!S.isCancelled(error)) throw error;
      return json(409, { error: S.AGENDA_CHANGED, code: 'agenda_changed' });
    }
  }
  return json(200, { order });
}

// ── The slides' own two routes (deck-store.js) ─────────────────────────────
/**
 * POST /events/{code}/deck — ONE SIGNED UPLOAD of a PDF for this event's
 * slides: `{ name, size, type }` in, `{ upload: { key, url, contentType,
 * expiresIn, maxBytes } }` out. The browser PUTs the file to `url` itself
 * (with that exact Content-Type), then names `key` in the item's `deck` on
 * add or edit, which is where the file is proven a PDF and kept. An upload
 * nobody attaches is gone within a day. Past the same door as every route
 * here: another organisation's event is the unknown code's 404.
 */
async function signDeckUpload(request, meta, code) {
  const body = readBody(request);
  if (!body) return json(400, { error: 'The request body is not valid JSON.' });
  if (!process.env.MEDIA_BUCKET) return json(500, { error: 'Slides cannot be stored in this environment.' });
  const file = rules.checkDeckFile(body);
  if (file.error) return json(400, { error: file.error });
  const upload = await D.presignUpload(meta.orgId, code);
  return json(200, { upload: { ...upload, name: file.value.name } });
}

/**
 * GET /events/{code}/items/{itemId}/deck — A PRESENTATION'S SLIDES FOR THE
 * STAGE: a signed read of the PDF, its page count, and the page the stage was
 * on (the host's, whatever the item's state — previewing is looking).
 */
async function readDeck(meta, code, itemId) {
  const row = await readItem(code, itemId);
  if (!row) return itemGone();
  const key = row.Deck && row.Deck.key;
  if (!rules.hasDeck(row.Type) || !D.isDeckKeyFor(key, meta.orgId, code)) {
    return json(404, { error: 'This item has no slides.', code: 'no_slides' });
  }
  const pages = Number(row.Deck.pages) || 0;
  return json(200, {
    deck: {
      id: D.deckIdOf(key),
      url: await D.presignRead(key),
      expiresIn: D.READ_TTL_SECONDS,
      pages,
      bytes: Number(row.Deck.bytes) || 0,
      page: rules.clampPage(row.DeckPage, pages),
    },
  });
}

/** The path's last segment is `deck`. */
function isDeckPath(request) {
  const http = (request && request.requestContext && request.requestContext.http) || {};
  const path = String(http.path || request.rawPath || '');
  return /\/deck\/?$/.test(path) || String(request.routeKey || '').endsWith('/deck');
}

/** POST /events/{code}/run — by the path's last segment, as get-agenda.js tells its routes apart. */
function isRunPath(request) {
  const http = (request && request.requestContext && request.requestContext.http) || {};
  const path = String(http.path || request.rawPath || '');
  return /\/run\/?$/.test(path) || String(request.routeKey || '').endsWith('/run');
}

exports.handler = async (request) => {
  trace('event-items', request);
  const params = request.pathParameters || {};
  const code = String(params.code || '');
  const itemId = params.itemId === undefined ? null : String(params.itemId);
  const method = methodOf(request);
  try {
    const meta = await S.openEvent(db, TABLE(), request, code);
    if (!meta) return notFound();
    // POST /events/{code}/run (events M3): running the day rides on this
    // function rather than a new one — run.js.
    if (method === 'POST' && isRunPath(request)) return await runEvent(db, TABLE(), request, meta, code);
    if (isDeckPath(request)) {
      if (method === 'POST' && itemId === null) return await signDeckUpload(request, meta, code);
      if (method === 'GET' && itemId !== null) return await readDeck(meta, code, itemId);
      return json(404, { error: 'Endpoint not found' });
    }
    if (method === 'POST' && itemId === null) return await addItem(request, meta, code);
    if (method === 'DELETE' && itemId !== null) return await removeItem(meta, code, itemId);
    if (method === 'PUT' && itemId === null) return await reorderItems(request, meta, code);
    if (method === 'PUT' && itemId !== null) return await editItem(request, meta, code, itemId);
    return json(404, { error: 'Endpoint not found' });
  } catch (error) {
    console.error('❌ event-items failed:', error && error.message);
    return json(500, { error: 'Could not change the agenda. Nothing was changed; try again.' });
  }
};
