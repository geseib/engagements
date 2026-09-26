/**
 * THE HOST'S READS GO THROUGH THE HOST'S DOORS, WITH A TOKEN.
 *
 * Three public routes used to change what they returned for a query parameter
 * anyone can type, and one of them for leaving the player id off the path:
 *
 *   GET /games/{id}/state?includeHostData=true   the running order, the category
 *                                                counts and masks, who answered
 *   GET /games/{id}/answers?role=host            every answer, by name, any phase
 *   GET /games/{id}/votes?role=host              every ballot, by voter
 *   GET /games/{id}?role=host                    the host's category masks
 *
 * The server stopped honouring every one of them on 2026-09-26 and serves the
 * host's view only on authenticated siblings: `/host-state`, `/answers/host`,
 * `/votes/host` and `/host-details` (tests/get-game-host-state.js,
 * get-answers-host.js, get-votes-host.js, get-game-host-details.js). A caller
 * left on the old URL does not fail: it gets the player's payload with a 200 and
 * quietly shows nothing, the failure this repo records as "fetch hiding as a
 * value". So this pins every caller, including the two that build the URL into
 * a variable first, where a scan for `fetch(\`…route…\`)` sees nothing.
 *
 * SOURCE ASSERTIONS, comments stripped first, for the standing reason:
 * GameHostPage cannot be mounted in jsdom without mocking its whole world, and
 * a source assertion that matches its own explanatory comment proves nothing.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (rel) => readFileSync(join(__dirname, '..', rel), 'utf8');
const strip = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

const HOST = strip(read('GameHostPage.jsx'));
const REMOTE = strip(read('HostRemote.jsx'));
const PLAYER = strip(read('PlayerPage.jsx'));

/** The body of `const name = async (...) => { ... }`, up to the next `const`. */
const fn = (code, name) => {
  const at = code.indexOf(`const ${name} = `);
  if (at < 0) throw new Error(`${name} is not in the page any more`);
  const next = code.indexOf('\n  const ', at + 10);
  return code.slice(at, next < 0 ? undefined : next);
};

describe('the comment stripping this file depends on', () => {
  test('it removes comments and keeps code', () => {
    // rejects: a stripper that misses line comments, which would let every
    // assertion below pass against a page that only TALKS about the doors.
    const phrase = /The host's door onto the game state/;
    expect(read('GameHostPage.jsx')).toMatch(phrase); // a comment in the source...
    expect(HOST).not.toMatch(phrase); // ...that the stripper removed
    expect(HOST).not.toMatch(/^[ \t]*\/\//m);
    expect(HOST).toMatch(/const restoreGameState = async/);
  });
});

describe('no host caller is left on a claim the server ignores', () => {
  // rejects: any of the four old URLs surviving in code. Each would now 200
  // with the player's payload and render an empty panel with no error.
  test.each([
    ['GameHostPage.jsx', HOST],
    ['HostRemote.jsx', REMOTE],
  ])('%s', (_name, code) => {
    expect(code).not.toMatch(/includeHostData/);
    expect(code).not.toMatch(/\/answers\?role=host/);
    expect(code).not.toMatch(/\/votes\?role=host/);
    // The session brief with a role claim. `/question?role=host` is not this:
    // its extras are bookkeeping about the question already on the wall.
    expect(code).not.toMatch(/games\/\$\{\w+\}\?role=host/);
  });
});

describe('the stage reads the host\'s doors with authFetch', () => {
  test('restoreGameState: the game state and the vote-phase answers', () => {
    const body = fn(HOST, 'restoreGameState');
    expect(body).toMatch(/authFetch\(`\$\{API_BASE\}games\/\$\{gameId\}\/host-state`\)/);
    expect(body).toMatch(/authFetch\(`\$\{API_BASE\}games\/\$\{gameId\}\/answers\/host\?questionId=\$\{paddedQuestionNumber\}`\)/);
  });

  test('fetchAnswersForQuestion builds the answers door and sends it with a token', () => {
    // The URL is built into a variable and then fetched, which is exactly the
    // shape closedRoutesUseAuthFetch.test.js cannot see.
    const body = fn(HOST, 'fetchAnswersForQuestion');
    expect(body).toMatch(/const url = `\$\{API_BASE\}games\/\$\{gameId\}\/answers\/host\?questionId=\$\{paddedQuestionNumber\}`/);
    expect(body).toMatch(/await authFetch\(url\)/);
    expect(body).not.toMatch(/(?<![\w.])fetch\(/);
  });

  test('fetchVotesForQuestion builds the ballots door and sends it with a token', () => {
    const body = fn(HOST, 'fetchVotesForQuestion');
    expect(body).toMatch(/const url = `\$\{API_BASE\}games\/\$\{gameId\}\/votes\/host\?questionNumber=\$\{paddedQuestionNumber\}`/);
    expect(body).toMatch(/await authFetch\(url\)/);
    expect(body).not.toMatch(/(?<![\w.])fetch\(/);
  });

  test('loadCategoryCounts reads the counts and masks off the host-state door', () => {
    const body = fn(HOST, 'loadCategoryCounts');
    expect(body).toMatch(/authFetch\(`\$\{API_BASE\}games\/\$\{gameId\}\/host-state`\)/);
  });

  test('the category restore reads the masks off the host-details door', () => {
    const body = fn(HOST, 'fetchCategories');
    expect(body).toMatch(/authFetch\(`\$\{API_BASE\}games\/\$\{gameId\}\/host-details`\)/);
  });

  test('checkGameStatus reads `started` off the public brief, with no role claim', () => {
    // `started` is on the player view for everyone; asking for more would be a
    // claim the server now ignores.
    const body = fn(HOST, 'checkGameStatus');
    expect(body).toMatch(/fetch\(`\$\{API_BASE\}games\/\$\{gameId\}`\)/);
    expect(body).not.toMatch(/role=/);
  });
});

describe('the phone remote reads the same doors with authFetch', () => {
  test('the two-second poll is ONE authenticated read of host-state', () => {
    // rejects: polling the public /state beside it. The door carries the
    // public fields too, so a second read would double the requests per poll.
    const poll = fn(REMOTE, 'pollState');
    expect(poll).toMatch(/authFetch\(`\$\{apiBase\(\)\}games\/\$\{id\}\/host-state`\)/);
    expect(poll.match(/[Ff]etch\(/g)).toHaveLength(1);
    expect(REMOTE).not.toMatch(/games\/\$\{\w+\}\/state[`?]/);
  });

  test('the spotlight list reads the answers door', () => {
    expect(REMOTE).toMatch(/authFetch\(`\$\{apiBase\(\)\}games\/\$\{gameId\}\/answers\/host\?questionId=\$\{padded\}`\)/);
  });
});

describe('the player\'s reads did not move', () => {
  // rejects: "fixing" a player read onto a host door. A phone has no token,
  // so every one of these would 401 and the room would stop.
  test('PlayerPage still reads the public routes with plain fetch', () => {
    expect(PLAYER).toMatch(/fetch\(`\$\{API_BASE\}games\/\$\{currentGameId\}\/state`\)/);
    expect(PLAYER).toMatch(/fetch\(`\$\{API_BASE\}games\/\$\{gameId\}\/answers\?role=player&questionId=\$\{paddedQuestionNumber\}`\)/);
    expect(PLAYER).not.toMatch(/host-state|answers\/host|votes\/host|host-details/);
    expect(PLAYER).not.toMatch(/authFetch/);
  });
});
