/**
 * GET /events — the acting organisation's events, soonest first.
 * docs/design/agenda-redesign/01-events.html.
 *
 * One paged Query of one partition, `ORG#<org>#EVENTS`: another
 * organisation's list is a partition this request never names — the
 * isolation `get-games-list` gets the same way. Names and places are sealed
 * on the list row and decrypted here. ONE unreadable row does not empty the
 * list (the lesson get-question-sets.js records): it is returned with blank
 * words and `decryptFailed`, and logged.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const tenant = require('../tenant');
const { json, trace } = require('./event-http');
const S = require('./event-store');

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = () => process.env.TABLE_NAME;

exports.handler = async (request) => {
  trace('get-events', request);
  const refused = tenant.requireOrg(request);
  if (refused) return refused;
  const orgId = tenant.callerOrgId(request);
  try {
    // Strongly consistent: the console re-reads this list the moment a delete
    // succeeds, and an eventually consistent page can still carry the event
    // it just removed — which then opens as "No event has that code."
    const rows = await S.queryAll(db, TABLE(), tenant.eventsIndexPk(orgId), S.INDEX_PREFIX, { consistent: true });
    const events = [];
    for (const row of rows) {
      try {
        events.push(S.projectEvent(await S.decryptEvent(orgId, row)));
      } catch (error) {
        console.warn(`⚠️ get-events: could not decrypt ${row.SK} for ${orgId}: ${error && error.message}`);
        events.push({ ...S.projectEvent({ ...row, Title: '', Place: '' }), decryptFailed: true });
      }
    }
    events.sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt)) || a.code.localeCompare(b.code));
    return json(200, { events });
  } catch (error) {
    console.error('❌ get-events failed:', error && error.message);
    return json(500, { error: 'Could not load events. Try again.' });
  }
};
