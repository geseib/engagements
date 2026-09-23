/**
 * WHY `POST /games/{id}/start` WAS REFUSED — in the server's own words.
 *
 * start-game.js answers a refusal with a sentence a host can act on: a
 * survey whose set is empty is a 409 reading "Nothing to ask yet: this
 * survey's question set has no questions in it…", a session already running
 * is a 400 naming its state. The host page used to throw that away and show
 * "Failed to start game: 409 Conflict" in alert(). This is the one place the
 * sentence is read, so every route to /start says the same thing.
 *
 * Nothing here throws: a body that will not parse falls back to the status.
 */

const said = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** `body.error`, else `body.message`, else a sentence carrying the status. */
export function describeStartRefusal(status, body) {
  return said(body && body.error)
    || said(body && body.message)
    || `The session did not start (${status}).`;
}

/** The same, read off a fetch Response. */
export async function readStartRefusal(response) {
  let body = null;
  try {
    body = await response.json();
  } catch {
    /* An unparseable body tells us nothing; the status still does. */
  }
  return describeStartRefusal(response.status, body);
}
