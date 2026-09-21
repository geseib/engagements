/**
 * What the report control should say about WHERE the reporter was.
 *
 * The control is mounted once, by the router (App.jsx), so that every working
 * screen carries it. That put it outside the stage, which is the only thing
 * that knows which session is running: GameHostPage holds its game id in state.
 * So the stage publishes it here and the control reads it at the moment a
 * report is opened — a value, not a subscription, because nothing needs to
 * re-render when it changes.
 *
 * The player page needs none of this: its session code is in the address
 * (`/play?gameId=4821`), and the address is read the same way.
 */
let gameId = null;

export function setIssueGameId(id) {
  gameId = id ? String(id) : null;
}

export function getIssueGameId(location = window.location) {
  if (gameId) return gameId;
  try {
    const fromUrl = new URLSearchParams(location.search || '').get('gameId');
    return fromUrl && /^\d{4}$/.test(fromUrl) ? fromUrl : null;
  } catch (_) {
    return null;
  }
}
