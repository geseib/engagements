/**
 * GET /events/{code} — one event and its agenda, for the builder.
 * docs/design/agenda-redesign/02-builder.html.
 *
 * The host's read: Cognito, then tenant.callerMayManageEvent; anything else
 * — another organisation's event, an unknown code, a malformed one — is the
 * same 404. Items come back in agenda order, decrypted, and each engagement
 * carries what the builder's row says about its set (event-store.describeSet):
 * its name, its question count, the version it would play today — which is
 * how the builder knows to offer "Use v3" — or that it is gone.
 *
 * An item whose words cannot be decrypted comes back in its place with blank
 * words and `decryptFailed: true` (event-store.openItemRow), and is logged:
 * one bad row must not stop a host opening the whole agenda, nor removing
 * that row from it.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const { json, notFound, trace } = require('./event-http');
const S = require('./event-store');

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = () => process.env.TABLE_NAME;

exports.handler = async (request) => {
  trace('get-event', request);
  const code = String((request.pathParameters || {}).code || '');
  try {
    const meta = await S.openEvent(db, TABLE(), request, code);
    if (!meta) return notFound();
    return json(200, await S.hostView(db, TABLE(), meta, code, 'get-event'));
  } catch (error) {
    console.error('❌ get-event failed:', error && error.message);
    return json(500, { error: 'Could not load the event. Try again.' });
  }
};
