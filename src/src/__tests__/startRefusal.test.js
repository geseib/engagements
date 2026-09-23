/**
 * A REFUSED START SAYS WHY, IN THE PRODUCT — never in alert().
 *
 * `POST /games/{id}/start` refuses with a sentence a host can act on —
 * start-game.js's 409 for a survey whose set is empty reads "Nothing to ask
 * yet: this survey's question set has no questions in it…" — and the page
 * threw it away: `startSession` turned every refusal into
 * "Failed to start game: 409 Conflict" and showed THAT in a browser alert(),
 * which blocks the page and is the one surface the product never designs.
 *
 * Now the server's own words (`error`, else `message`) go where the host is
 * looking: the dock line the survey acts already use (surveyActionError) for
 * the lobby's "Open the survey", and the sessions list — where a refused
 * create-and-open lands the host — for the create dialog's "Open the survey"
 * and the list's own Start.
 *
 * GameHostPage cannot be mounted in jsdom, so the helper is called here and
 * the page's wiring is held by source assertions, the way surveyStage.test.jsx
 * holds the rest of it.
 */
import fs from 'fs';
import path from 'path';
import { describeStartRefusal, readStartRefusal } from '../utils/startRefusal';

const NOTHING = "Nothing to ask yet: this survey's question set has no questions in it. Add some, then open it.";

describe('describeStartRefusal — the server\'s own sentence first', () => {
  test('error, then message, then a sentence with the status', () => {
    expect(describeStartRefusal(409, { error: NOTHING, message: NOTHING, nothingToAsk: true })).toBe(NOTHING);
    expect(describeStartRefusal(400, { message: "Game is in state 'ENDED'." })).toBe("Game is in state 'ENDED'.");
    expect(describeStartRefusal(502, null)).toBe('The session did not start (502).');
  });

  test('a blank error is not a reason', () => {
    expect(describeStartRefusal(409, { error: '   ', message: NOTHING })).toBe(NOTHING);
    expect(describeStartRefusal(409, { error: '' })).toBe('The session did not start (409).');
  });

  test('readStartRefusal reads the body off a response, and survives one that will not parse', async () => {
    const ok = { status: 409, json: async () => ({ error: NOTHING }) };
    expect(await readStartRefusal(ok)).toBe(NOTHING);
    const garbled = { status: 500, json: async () => { throw new Error('not json'); } };
    expect(await readStartRefusal(garbled)).toBe('The session did not start (500).');
  });
});

describe('GameHostPage says it where the host is looking', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'GameHostPage.jsx'), 'utf8');
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((line) => !/^\s*(\/\/|\*)/.test(line)).join('\n');
  const bodyOf = (name) => {
    const start = code.indexOf(`const ${name} = `);
    expect(start).toBeGreaterThan(-1);
    return code.slice(start, code.indexOf('\n  };', start));
  };

  test('startSession reads the refusal from the body and never calls alert()', () => {
    const start = bodyOf('startSession');
    expect(start).toMatch(/readStartRefusal\(response\)/);
    expect(start).not.toMatch(/alert\(/);
    expect(start).toMatch(/return \{ ok: false, error/);
  });

  test('the lobby\'s "Open the survey" puts the reason in the dock', () => {
    const at = code.indexOf('case HOST_INTENTS.OPEN_SURVEY:');
    const branch = code.slice(at, code.indexOf('break;', at));
    expect(branch).toMatch(/startSession\(/);
    expect(branch).toMatch(/setSurveyActionError\(/);
    expect(branch).toMatch(/\.error/);
  });

  test('the create dialog\'s "Open the survey" carries the reason to the sessions list it falls back to', () => {
    const open = bodyOf('openNewSurvey');
    expect(open).toMatch(/setHistoryNotice\(/);
    expect(open).toMatch(/\.error/);
    expect(open).toMatch(/setShowReportsModal\(true\)/);
  });

  test('the sessions list\'s Start says its refusal on the list', () => {
    const fromHistory = bodyOf('startGameFromHistory');
    expect(fromHistory).toMatch(/setHistoryNotice\(/);
    expect(code).toMatch(/<SessionHistoryPanel[\s\S]*?notice=\{historyNotice\}/);
  });
});
