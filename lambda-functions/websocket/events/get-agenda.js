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
 * a code that names nothing.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const rules = require('./agenda-rules');
const { json, notFound, trace } = require('./event-http');
const S = require('./event-store');

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = () => process.env.TABLE_NAME;
/** The states in which an attendee may follow an item into its session. */
const LINKED_STATES = Object.freeze(['live', 'paused', 'done']);

exports.handler = async (request) => {
  trace('get-agenda', request);
  const code = String((request.pathParameters || {}).code || '');
  try {
    const meta = await S.readMeta(db, TABLE(), code);
    if (!meta || !meta.orgId || (meta.Access || 'open') !== 'open') return notFound();
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
        };
      }),
    });
  } catch (error) {
    console.error('❌ get-agenda failed:', error && error.message);
    return json(500, { error: 'Could not load the agenda. Try again.' });
  }
};
