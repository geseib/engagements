/**
 * DOES THIS DEVICE STILL HOLD THE NAME? — one rule, written once.
 *
 * Experience plan §4.4 and step 1d (owner, 1 Nov 2026). When the host lets a
 * name move to a new device, `join-game.js`'s handover branch rewrites the
 * player row's `ClientId` to the new browser. Until this file nothing else
 * looked at `ClientId` after the join: the websocket answer path and the vote
 * route took any frame that named the player, so the old phone kept playing
 * as "Sam" and raced the new one, answer for answer.
 *
 * Now both paths ask this one question of the PLAYER# row, and a device that
 * no longer holds the name is refused with `NAME_MOVED`, which the page reads
 * to say "Sam is now on another device".
 *
 * WHAT IS REFUSED, EXACTLY. Only a device that presents a client id that is
 * not the row's. Every other shape is let through, deliberately:
 *
 *   no row             nothing to judge against (the paths that wrote answers
 *                      for a missing row keep doing so; not this rule's call)
 *   row has no ClientId a session from before identities, or a browser with no
 *                      storage (joinResult.js getClientId returns null)
 *   frame has no id    a page loaded before this shipped, still open in the
 *                      room; refusing it would stop every phone mid-session
 *                      on the day of the deploy
 *   an event seat      (`AttendeeId`) belongs to the attendee's TOKEN, not to
 *                      a browser: joinAsAttendee re-stamps ClientId each time
 *                      the attendee opens an item, so a laptop and a phone
 *                      are both the attendee and neither has "moved"
 *
 * So this is a guard against the race, not an authentication: a page that
 * withholds its id is not stopped. That is the same trust the join has always
 * placed in the client id (joinResult.js header): it answers "is this the
 * same browser?", it proves nothing about a person.
 *
 * Copied verbatim into lambda-functions/websocket/name-holder.js — the two
 * packages cannot import each other. tests/name-moved.js holds the two
 * identical.
 */

const NAME_MOVED = 'NAME_MOVED';

/** The client id as a frame or body carries it, normalised as join-game.js does. */
function presentedClientId(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * True when the row says another browser holds this name and this caller has
 * presented a different id. See the header for every shape that is false.
 */
function heldByAnotherDevice(row, clientId) {
  if (!row) return false;
  if (row.AttendeeId) return false;
  const stored = presentedClientId(row.ClientId);
  const presented = presentedClientId(clientId);
  if (!stored || !presented) return false;
  return stored !== presented;
}

/** The sentence the old device shows. Plain words; the name, never an id. */
function nameMovedMessage(playerName) {
  return `${playerName} is now on another device. This page has stopped.`;
}

/**
 * The frame the old device's socket is sent: once at the moment the name
 * moves (join-game.js, step 1f), and again whenever it next answers or checks
 * in. Carries the name and a code, never a client id.
 */
function nameMovedFrame(gameId, playerName) {
  return {
    type: 'nameMoved',
    gameId,
    playerName,
    code: NAME_MOVED,
    message: nameMovedMessage(playerName),
  };
}

module.exports = {
  NAME_MOVED,
  presentedClientId,
  heldByAnotherDevice,
  nameMovedMessage,
  nameMovedFrame,
};
