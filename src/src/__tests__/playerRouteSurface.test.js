/**
 * WHAT AN UNAUTHENTICATED PARTICIPANT IS ALLOWED TO ASK THE API FOR.
 *
 * ── THE DEFECT THIS WAS WRITTEN FOR ────────────────────────────────────────
 *
 * `PlayerPage` fetched the WHOLE of `GET /question-sets` — every question set
 * in the environment, each with its name, description, categories, question
 * count, engagement type and persona id — on every round, in order to read two
 * strings about the one set its own game was playing:
 *
 *     const data = await response.json();
 *     const questionSet = data.sets?.find((set) => set.id === setId);
 *     return { customInstruction: ..., roundNoun: ... };
 *
 * The route carries no authorizer, so this reached every anonymous participant
 * in every session. Nobody had to sign in, guess an id, or do anything but join
 * a game with a four-digit code.
 *
 * A previous pass on this exact code reduced the NUMBER of those downloads
 * (memoising one per set instead of one per question) and left the contents
 * alone. Caching a leak makes it quieter, not smaller — which is why this test
 * asserts the SHAPE of what may be requested rather than how often.
 *
 * The fix was not to close the route. It could not be closed while a player
 * needed it: attaching the authorizer would have 401'd every participant out of
 * the round. `game/get-question.js` now projects `setCustomInstruction` and
 * `setRoundNoun` from the SETS row it was ALREADY reading to resolve the
 * partition, so the player gets the two values with no extra request and no
 * knowledge of any other set — and the route becomes closeable.
 *
 * ── WHY A SOURCE SCAN AND NOT A MOUNTED TEST ───────────────────────────────
 *
 * A mounted test proves what the code did on the paths the test drove. This
 * class of defect is a request on a path nobody thought about — a retry, a
 * reconnect, a results rebuild. Reading every request target out of the file is
 * the only way to cover all of them at once.
 *
 * rejects: any request from a participant surface that is not scoped to that
 * participant's own game — `question-sets`, `admin/*`, a games LIST, or a new
 * catalogue endpoint invented later.
 */
const fs = require('fs');
const path = require('path');

const PLAYER_PAGE = path.join(__dirname, '..', 'PlayerPage.jsx');

/**
 * Comments stripped before scanning. This repo's comments are long and quote
 * the very endpoints being banned — including the one directly above the fix
 * in PlayerPage.jsx, which names `GET /question-sets` in order to explain why
 * it is gone. Scanning raw text would fail on the explanation of the fix.
 * Same reason, same technique as __tests__/undeclaredSetters.test.js.
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

/** Every `fetch(...)` / `authFetch(...)` target literal in the file. */
function requestTargets(source) {
  const targets = [];
  const call = /\b(?:auth)?[Ff]etch\(\s*`([^`]*)`/g;
  let m;
  while ((m = call.exec(source)) !== null) targets.push(m[1]);
  return targets;
}

/**
 * A target is participant-safe when it addresses ONE game.
 *
 * `games/get-results` is the documented exception: it is a POST whose body
 * carries the gameId, and it is the public read half of the handler whose other
 * route (`close-round`) is authorized. See template-clean.yaml's note that
 * "HTTP API authorizers are per-route and not optional, so 'public to read,
 * authenticated to write' cannot be expressed on one route."
 */
const GAME_SCOPED = /^\$\{API_BASE\}games\/\$\{[^}]+\}(\?|\/|$)/;
const ALLOWED_UNSCOPED = new Set(['${API_BASE}games/get-results']);

function isParticipantSafe(target) {
  if (ALLOWED_UNSCOPED.has(target)) return true;
  return GAME_SCOPED.test(target);
}

describe('participant request surface', () => {
  const source = stripComments(fs.readFileSync(PLAYER_PAGE, 'utf8'));
  const targets = requestTargets(source);

  it('finds the request sites at all (guards the scanner itself)', () => {
    // A scanner that matches nothing passes every assertion below
    // unconditionally. PlayerPage makes many requests; if this ever drops to
    // zero the regex has rotted, not the code.
    expect(targets.length).toBeGreaterThan(5);
  });

  it('asks for nothing that is not scoped to this participant\'s own game', () => {
    const offenders = targets.filter((t) => !isParticipantSafe(t));
    expect(offenders).toEqual([]);
  });

  it('never requests the question-set catalogue', () => {
    // Named separately from the rule above so the failure message says what
    // actually went wrong rather than "some target is unscoped".
    const catalogue = targets.filter((t) => /question-sets/.test(t));
    expect(catalogue).toEqual([]);
  });

  it('never reaches an admin route', () => {
    expect(targets.filter((t) => /\/admin\/|\}admin\//.test(t))).toEqual([]);
  });

  it('reads the set instruction from the question payload instead', () => {
    // The other half of the fix. Without this, "no catalogue fetch" could be
    // satisfied by simply deleting the feature.
    expect(source).toMatch(/setCustomInstruction/);
    expect(source).toMatch(/setRoundNoun/);
  });
});
