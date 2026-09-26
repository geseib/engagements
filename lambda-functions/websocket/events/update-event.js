/**
 * PUT /events/{code} — change an event's details: name, date, start, time
 * zone, place, the report default. "Edit details" in the builder's facts
 * strip (02-builder.html) opens the new-event dialog (05) filled in.
 *
 * Any field the body leaves out keeps its value; the result is checked as a
 * whole by agenda-rules.checkEventFields, exactly as a create is. Access stays
 * `open` until invitations exist (PLAN Phase 3).
 *
 * ── A NEW DATE MOVES EVERY ROW'S EXPIRY, IN ONE WRITE ─────────────────────
 * An event's rows are kept until 90 days after its day (agenda-rules.eventTtl).
 * When the date changes, the code's reservation, the list row, METADATA and
 * every item row get the new `ttl` in ONE transaction: an event moved to next
 * month must not lose its agenda on the old date's clock, and no row may be
 * left on the other. The reservation is conditioned on `Kind = event`, so
 * this route can never touch a session's code. At most 16 + 16 items plus
 * three rows: inside DynamoDB's 100.
 *
 * ── A RACE AGAINST items.js's ADD (OR REMOVE) ─────────────────────────────
 * The per-item updates above are built from ONE read of the agenda
 * (`S.readItems`), taken before this transaction commits. An item added by
 * items.js between that read and this commit would be invisible to this
 * list — it would keep the ttl it was written with and never receive the new
 * date's, while every row this route did see moves on. So, whenever the date
 * actually moves, METADATA's own Update also checks
 * ItemCount/EngagementCount/BreakCount against the values this route read at
 * its own start: an add (or a remove) landing in that window changes at
 * least one of them, the condition fails, and the whole date move cancels
 * with the same AGENDA_CHANGED 409 a lost cap race gets — the host retries
 * and this time reads the agenda whole. items.js carries the matching half:
 * its own item Put rides beside a METADATA Update conditioned on `ttl`
 * matching what IT read, so a date move that commits first is the one that
 * makes an in-flight add lose instead. See tests/event-caps.js §6 for both
 * orderings driven end to end.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const tenant = require('../tenant');
const { encryptItem } = require('../tenant-crypto');
const rules = require('./agenda-rules');
const { json, notFound, readBody, trace } = require('./event-http');
const S = require('./event-store');

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = () => process.env.TABLE_NAME;
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

exports.handler = async (request) => {
  trace('update-event', request);
  const code = String((request.pathParameters || {}).code || '');
  try {
    const meta = await S.openEvent(db, TABLE(), request, code);
    if (!meta) return notFound();
    const body = readBody(request);
    if (!body) return json(400, { error: 'The request body is not valid JSON.' });

    const current = await S.decryptEvent(meta.orgId, meta);
    const merged = {
      title: has(body, 'title') ? body.title : current.Title,
      place: has(body, 'place') ? body.place : current.Place,
      startsAt: has(body, 'startsAt') ? body.startsAt : current.StartsAt,
      timeZone: has(body, 'timeZone') ? body.timeZone : current.TimeZone,
      access: has(body, 'access') ? body.access : current.Access,
      attendeeReports: has(body, 'attendeeReports') ? body.attendeeReports : current.AttendeeReports,
    };
    const nowSeconds = Math.floor(Date.now() / 1000);
    const checked = rules.checkEventFields(merged, { nowSeconds });
    if (checked.error) return json(400, { error: checked.error });
    const v = checked.value;

    const now = new Date(nowSeconds * 1000).toISOString();
    const sealed = await encryptItem(meta.orgId, 'event', { Title: v.title, Place: v.place });
    const moved = v.startsAt !== meta.StartsAt;
    const ttl = moved ? rules.eventTtl(v.startsAt, nowSeconds) : meta.ttl;

    const names = {
      '#t': 'Title', '#pl': 'Place', '#sa': 'StartsAt', '#tz': 'TimeZone', '#ac': 'Access', '#ttl': 'ttl',
    };
    const values = {
      ':t': sealed.Title, ':pl': sealed.Place, ':sa': v.startsAt, ':tz': v.timeZone, ':ac': v.access, ':ttl': ttl,
    };
    // When the date moves, this Update's own condition also pins down the
    // agenda's shape as this route read it — see the file header's note on
    // the race with items.js's add/remove. A rename with no date change
    // touches no item row, so it carries no such condition.
    const metaConditions = ['attribute_exists(PK)'];
    const metaNames = { ...names, '#ar': 'AttendeeReports', '#ua': 'UpdatedAt' };
    const metaValues = { ...values, ':ar': v.attendeeReports, ':now': now };
    if (moved) {
      metaConditions.push('#ic = :icWas', '#ec = :ecWas', '#bc = :bcWas');
      Object.assign(metaNames, { '#ic': 'ItemCount', '#ec': 'EngagementCount', '#bc': 'BreakCount' });
      Object.assign(metaValues, {
        ':icWas': Number(meta.ItemCount) || 0,
        ':ecWas': Number(meta.EngagementCount) || 0,
        ':bcWas': Number(meta.BreakCount) || 0,
      });
    }
    const tx = [
      {
        Update: {
          TableName: TABLE(),
          Key: { PK: tenant.eventPk(code), SK: S.META_SK },
          UpdateExpression: 'SET #t = :t, #pl = :pl, #sa = :sa, #tz = :tz, #ac = :ac, #ttl = :ttl, #ar = :ar, #ua = :now',
          ConditionExpression: metaConditions.join(' AND '),
          ExpressionAttributeNames: metaNames,
          ExpressionAttributeValues: metaValues,
        },
      },
      {
        Update: {
          TableName: TABLE(),
          Key: { PK: tenant.eventsIndexPk(meta.orgId), SK: S.indexSk(code) },
          UpdateExpression: 'SET #t = :t, #pl = :pl, #sa = :sa, #tz = :tz, #ac = :ac, #ttl = :ttl',
          ConditionExpression: 'attribute_exists(PK)',
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
        },
      },
    ];
    if (moved) {
      tx.push({
        Update: {
          TableName: TABLE(),
          Key: { PK: tenant.GAMES_RESERVATION_PK, SK: `GAME#${code}` },
          UpdateExpression: 'SET #ttl = :ttl',
          ConditionExpression: 'attribute_exists(PK) AND #k = :event',
          ExpressionAttributeNames: { '#ttl': 'ttl', '#k': 'Kind' },
          ExpressionAttributeValues: { ':ttl': ttl, ':event': 'event' },
        },
      });
      for (const row of await S.readItems(db, TABLE(), code)) {
        tx.push({
          Update: {
            TableName: TABLE(),
            Key: { PK: row.PK, SK: row.SK },
            UpdateExpression: 'SET #ttl = :ttl',
            ConditionExpression: 'attribute_exists(SK)',
            ExpressionAttributeNames: { '#ttl': 'ttl' },
            ExpressionAttributeValues: { ':ttl': ttl },
          },
        });
      }
    }

    try {
      await db.send(new TransactWriteCommand({ TransactItems: tx }));
    } catch (error) {
      if (!S.isCancelled(error)) throw error;
      return json(409, { error: S.AGENDA_CHANGED, code: 'agenda_changed' });
    }

    return json(200, {
      event: S.projectEvent({
        ...meta,
        Title: v.title, Place: v.place, StartsAt: v.startsAt, TimeZone: v.timeZone,
        Access: v.access, AttendeeReports: v.attendeeReports, UpdatedAt: now, ttl,
      }),
    });
  } catch (error) {
    console.error('❌ update-event failed:', error && error.message);
    return json(500, { error: 'Could not save the event. Nothing was changed; try again.' });
  }
};
