/**
 * GET /events/{code}/agenda — the agenda anyone with the code may read, before
 * the day, during it and after (p-05a, p-05, p-08; RATIONALE decision 11).
 *
 * PUBLIC, and so it says as little as an agenda needs: the event's name,
 * place and schedule, and per item its planned time, title, kind, who leads
 * it (events M1b — p-05's "Presentation · Dana Whitfield"), length,
 * description and state. Never an engagement's session options. Never the
 * organisation, the question set, who made it, the report default or the
 * counts. And no LINK into an item — its
 * session's code — until the host has started that item: "nothing is active
 * beforehand" (decision 11). Every item is `planned` in this release, so no
 * link is ever given yet; the rule is here so roadmap M3 cannot forget it.
 *
 * An item whose words cannot be decrypted keeps its place, kind and length and
 * simply has no words (event-store.openItemRow): the times after it still add
 * up, and one bad row does not turn the whole agenda into an error.
 *
 * Open events only. An invite-only event's agenda is shown only after a
 * passcode (PLAN Phase 3), which does not exist yet, so one answers 404 like
 * a code that names nothing. So does every event while EVENTS_ENABLED is off
 * (events M2: a switched-off tier answers as for an unknown code).
 *
 * A PRESENTATION'S SLIDES (27 Sep 2026, deck-store.js). The agenda says how
 * many a presentation has (`slides`); `view=now` says which one the stage is
 * on while the talk is live; and `view=deck&item=<itemId>` hands a phone a
 * signed read of the PDF — only once the host has started that talk (live,
 * paused or done, the states in which an item's session is linked too:
 * decision 11, "nothing is active beforehand"). Never the storage key in the
 * agenda, and never a deck of another event: the key must be this event's.
 *
 * THE ATTENDEE'S FUNCTION (events M2). This function also serves
 * POST /events/{code}/attendees and GET /events/{code}/me, in attendees.js:
 * the three public routes an attendee's page calls, on one function, because
 * the stack is near CloudFormation's 500-resource limit.
 */
const crypto = require('crypto');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');
const rules = require('./agenda-rules');
const { json, notFound, trace, methodOf, eventsEnabled } = require('./event-http');
const S = require('./event-store');
const { joinEvent, whoAmI } = require('./attendees');
const D = require('./deck-store');

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = () => process.env.TABLE_NAME;
/** The states in which an attendee may follow an item into its session. */
const LINKED_STATES = Object.freeze(['live', 'paused', 'done']);

/**
 * What changed since a phone last read the whole agenda: every run action adds
 * one to RunRev (run.js), an edit moves UpdatedAt or the item count. A phone
 * re-reads the agenda when this string differs. Hashed, so it says nothing
 * else — not when the host last edited, not how many items there are.
 */
const revOf = (meta) => crypto.createHash('sha256')
  .update([Number(meta.RunRev) || 0, Number(meta.ItemCount) || 0, meta.UpdatedAt || ''].join('.'))
  .digest('base64url')
  .slice(0, 16);

/** A live break's planned return, the only time an agenda row carries besides its plan. */
const endsAtOf = (row) => ((row.State === 'live' && row.EndsAt) ? { endsAt: row.EndsAt } : {});

/** A presentation's page count, when it has slides; nothing otherwise. */
const pagesOf = (row) => (rules.hasDeck(row.Type) && row.Deck ? Number(row.Deck.pages) || 0 : 0);

/**
 * GET /events/{code}/agenda?view=now — WHAT IS LIVE, AND NOTHING ELSE (events
 * M3/M4). The phone polls this every few seconds between items, so it is two
 * plain reads (METADATA, and the live item's row when there is one) and no
 * decryption: the live item's kind, state, session code and a break's return
 * time, the event's state, and `rev`. Never a title, never a description —
 * the phone has those from the whole agenda, which it re-reads when `rev`
 * moves. The same door as the agenda: switched off, unknown, invite-only or
 * malformed is the one 404.
 */
async function readNow(meta, code) {
  const liveItemId = typeof meta.LiveItem === 'string' ? meta.LiveItem : '';
  let live = null;
  if (liveItemId && S.isItemId(liveItemId)) {
    const res = await db.send(new GetCommand({ TableName: TABLE(), Key: { PK: meta.PK, SK: S.itemSk(liveItemId) } }));
    const row = res && res.Item;
    if (row) {
      const pages = pagesOf(row);
      live = {
        itemId: liveItemId,
        type: row.Type || '',
        state: row.State || 'planned',
        ...(row.GameId ? { gameId: String(row.GameId) } : {}),
        ...endsAtOf(row),
        // The slide the stage is on, for a phone following the talk.
        ...(pages ? { slides: { page: rules.clampPage(row.DeckPage, pages), pages } } : {}),
      };
    }
  }
  return json(200, {
    now: { code, state: meta.State || 'SCHEDULED', liveItemId, live, rev: revOf(meta) },
  });
}

/**
 * GET /events/{code}/agenda?view=deck&item=<itemId> — A TALK'S SLIDES, FOR A
 * PHONE THAT ASKED TO SEE THEM: a signed read of the PDF, once the host has
 * started the talk. A talk that has not started, an item with no slides and
 * an unknown item are one 404, as the rest of this route answers.
 */
async function readDeck(meta, code, itemId) {
  const none = () => json(404, { error: 'These slides are not open.', code: 'no_slides' });
  if (!S.isItemId(itemId)) return none();
  const res = await db.send(new GetCommand({ TableName: TABLE(), Key: { PK: meta.PK, SK: S.itemSk(itemId) } }));
  const row = res && res.Item;
  if (!row || !pagesOf(row) || !LINKED_STATES.includes(row.State || 'planned')) return none();
  if (!D.isDeckKeyFor(row.Deck.key, meta.orgId, code)) return none();
  const pages = pagesOf(row);
  return json(200, {
    deck: {
      id: D.deckIdOf(row.Deck.key),
      url: await D.presignRead(row.Deck.key),
      expiresIn: D.READ_TTL_SECONDS,
      pages,
      page: rules.clampPage(row.DeckPage, pages),
    },
  });
}

async function readAgenda(request) {
  trace('get-agenda', request);
  const code = String((request.pathParameters || {}).code || '');
  if (!eventsEnabled()) return notFound();
  try {
    const meta = await S.readMeta(db, TABLE(), code);
    if (!meta || !meta.orgId || (meta.Access || 'open') !== 'open') return notFound();
    const query = request.queryStringParameters || {};
    if (query.view === 'now') return await readNow(meta, code);
    if (query.view === 'deck') return await readDeck(meta, code, String(query.item || ''));
    const event = await S.decryptEvent(meta.orgId, meta);
    const rows = [];
    for (const row of await S.readItems(db, TABLE(), code)) rows.push(await S.openItemRow(meta.orgId, row, 'get-agenda'));
    const { rows: timed, endsAt } = rules.agendaTimes(meta.StartsAt, rows);
    return json(200, {
      event: {
        code,
        title: event.Title || '',
        place: event.Place || '',
        startsAt: meta.StartsAt || '',
        timeZone: meta.TimeZone || '',
        endsAt,
        state: meta.State || 'SCHEDULED',
        // The one live item (events M3), or '' while the agenda is up.
        liveItemId: typeof meta.LiveItem === 'string' ? meta.LiveItem : '',
        rev: revOf(meta),
      },
      items: timed.map((row) => {
        const state = row.State || 'planned';
        return {
          itemId: S.itemIdOf(row),
          type: row.Type || '',
          title: typeof row.Title === 'string' ? row.Title : '',
          description: typeof row.Description === 'string' ? row.Description : '',
          ledBy: typeof row.LedBy === 'string' ? row.LedBy : '',
          minutes: Number(row.Minutes) || 0,
          at: row.at,
          until: row.until,
          state,
          ...(row.decryptFailed ? { decryptFailed: true } : {}),
          ...(LINKED_STATES.includes(state) && row.GameId ? { gameId: String(row.GameId) } : {}),
          ...endsAtOf(row),
          ...(pagesOf(row) ? { slides: pagesOf(row) } : {}),
        };
      }),
    });
  } catch (error) {
    console.error('❌ get-agenda failed:', error && error.message);
    return json(500, { error: 'Could not load the agenda. Try again.' });
  }
}

/** Which of the function's three routes this is, by method and the path's last segment. */
function routeOf(request) {
  const path = String(((request && request.requestContext && request.requestContext.http) || {}).path || '');
  const method = methodOf(request);
  if (method === 'POST' && /\/attendees\/?$/.test(path)) return 'join';
  if (method === 'GET' && /\/me\/?$/.test(path)) return 'me';
  return 'agenda';
}

exports.handler = async (request) => {
  const route = routeOf(request);
  if (route === 'join') return joinEvent(db, TABLE(), request);
  if (route === 'me') return whoAmI(db, TABLE(), request);
  return readAgenda(request);
};
