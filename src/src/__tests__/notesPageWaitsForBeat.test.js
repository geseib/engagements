/**
 * THE READ'S FIRST PAGE WAITS FOR THE BEAT THAT OPENS IT.
 *
 * // rejects: dev QA 5 Nov — one "Failed to load resource: 409" early in a
 * // two-screen session. What we heard sent the beat (POST /stage-beat
 * // { beat: 'field-notes' }, fire and forget) and, a render later, the read's
 * // first page (POST /stage-beat { notesPage }) from useStageNotesSync. The
 * // two raced; a page that landed first was refused by stage-beat.js, "The
 * // room is not on What we heard" (409), and retried a second later.
 *
 * GameHostPage needs the whole auth tree to render, so the order is pinned on
 * its source (as stageGoalWiring.test.js does) and the server's refusal is
 * pinned on stage-beat.js, which must keep refusing a page for a read the
 * room is not on: the fix is the client's order, not a quieter server.
 */
const fs = require('fs');
const path = require('path');

const page = fs.readFileSync(path.join(__dirname, '..', 'GameHostPage.jsx'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'lambda-functions', 'game', 'stage-beat.js'), 'utf8');

const block = (start) => {
  const at = page.indexOf(start);
  expect(at).toBeGreaterThan(-1);
  return page.slice(at, page.indexOf('\n  };\n', at));
};

test('publishStageBeat keeps the beat it sent', () => {
  const b = block('const publishStageBeat = (beat) => {');
  expect(b).toMatch(/const sent = authFetch\(`\$\{API_BASE\}games\/\$\{gameId\}\/stage-beat`/);
  expect(b).toMatch(/beatPublishRef\.current = sent;/);
  expect(page).toMatch(/const beatPublishRef = useRef\(null\);/);
});

test('publishNotesPage waits for that beat before it sends the page', () => {
  const b = block('const publishNotesPage = async (body) => {');
  const wait = b.indexOf('await beatPublishRef.current');
  const post = b.indexOf('authFetch(');
  expect(wait).toBeGreaterThan(-1);
  expect(post).toBeGreaterThan(wait);
});

test('the order holds as promises: the page is sent only after the beat settles', async () => {
  const sent = [];
  let landBeat;
  const ref = { current: null };
  const authFetch = (url, opts) => {
    sent.push(JSON.parse(opts.body));
    if ('beat' in JSON.parse(opts.body)) return new Promise((r) => { landBeat = () => r({ ok: true }); });
    return Promise.resolve({ ok: true, json: async () => ({ rev: 1 }) });
  };
  // The two functions as GameHostPage has them, reduced to their order.
  const publishStageBeat = (beat) => { ref.current = authFetch('x', { body: JSON.stringify({ beat, questionNumber: 1 }) }); };
  const publishNotesPage = async (body) => {
    if (ref.current) await ref.current;
    return authFetch('x', { body: JSON.stringify(body) });
  };
  publishStageBeat('field-notes');
  const pagePost = publishNotesPage({ notesPage: 0, notesPages: 3, questionNumber: 1 });
  await Promise.resolve();
  expect(sent.map((b) => Object.keys(b)[0])).toEqual(['beat']);
  landBeat();
  await pagePost;
  expect(sent.map((b) => Object.keys(b)[0])).toEqual(['beat', 'notesPage']);
});

test('the server still refuses a page for a read the room is not on', () => {
  expect(server).toMatch(/if \(round\.StageBeat !== READ_BEAT\) \{\s*return respond\(409, \{ error: 'The room is not on What we heard' \}\);/);
});
