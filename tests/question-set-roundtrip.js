/**
 * CSV ROUND-TRIP regression — admin/download-question-set.js -> admin/upload-questions.js
 *
 * THE CONTRACT: a set exported and re-imported UNCHANGED must produce the same
 * questions. Same options, same correct answer, same difficulty, same reveal,
 * same image, same category, same order. Nothing silently dropped.
 *
 * THE DEFECT this file exists to keep fixed. The two handlers disagreed about
 * the CSV, in three ways, and every one of them was silent:
 *
 *   trivia options  download emitted WrongAnswer1/2/3 filled from
 *                   q.optionA/B/C (optionD/E/F dropped before that even
 *                   mattered); the importer reads OptionA..OptionF by exact
 *                   name and knows no WrongAnswer column and has NO fallback
 *                   for one (getColumnIndex is an exact case-insensitive
 *                   match, and the generic fallback block covers nine columns,
 *                   none of them an option column). Result: every option lost.
 *   trivia reveal   download never emitted AnswerDetails at all. Result: every
 *                   reveal lost — and 100 rows in engagedev carry one.
 *   poll options    download read `q.Options` (capitalised) but the importer
 *                   writes the attribute as lower-case `options`
 *                   (upload-questions.js, the poll branch of the item build).
 *                   It read a field that does not exist, so the column was
 *                   emitted EMPTY and every option was lost.
 *
 * So: download a trivia or poll set, fix one typo, upload it back as a new
 * version, and every question loses all of its answers. Silently, with a 200
 * and a cheerful "Replaced question set" message.
 *
 * WHICH SIDE WAS WRONG, AND WHY THE FIX IS IN THE EXPORTER. The importer's
 * format is the contract: every hand-authored CSV in sets/, every template
 * download-template.js emits, and every AI builder header in the frontend
 * (AdminPage.jsx, TriviaAIBuilder.jsx, PollAIBuilder.jsx) already speak
 * OptionA..F / Options. The only artefact in the whole repo carrying
 * WrongAnswer* columns is sets/trivia-80s_music_trivia-1752970198947.csv —
 * itself the output of this broken exporter. Changing the importer's column
 * names would break every one of those files to accommodate one wrong writer.
 *
 * This is the same class of defect as the Option1..5 poll bug, which was also
 * fixed in the EMITTER (AdminPage.jsx carries the "Do not restore the numbered
 * columns" warning), and the same class as the archive export dropping Image —
 * see tests/archive-export-image-roundtrip.js.
 *
 * HOW IT IS PROVED. Not by reading: the REAL handlers run in-process against an
 * in-memory table, exactly as tests/set-versioning-flow.js drives them. A set
 * is created through the real importer, exported through the real exporter, and
 * the exporter's exact bytes are fed back to the real importer as a replace.
 * The question rows of the two versions are then compared field for field.
 *
 * Stubbing follows tests/set-versioning-flow.js: hook Module._load BY MODULE
 * NAME, because several @aws-sdk packages exist only in the deployed bundle and
 * cannot be resolved from the repo root at all.
 *
 * The stored shapes asserted here were confirmed against real rows in the
 * engagedev table, not invented: trivia rows carry lower-case optionA..optionF,
 * correctAnswer, difficulty and points, alongside capitalised Title/Detail/
 * Category/School/Tags/AnswerDetails/Image; wavelength rows carry no
 * type-specific attribute at all and so ride the call-and-answer branch.
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');

// ---- Stub the AWS SDK before any handler loads -----------------------------
const Module = require('module');
const stubs = new Map();
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (stubs.has(request)) return stubs.get(request);
  return realLoad.call(this, request, parent, isMain);
};
function stub(name, exports) { stubs.set(name, exports); }

class GetCommand { constructor(i) { this.input = i; this.type = 'get'; } }
class PutCommand { constructor(i) { this.input = i; this.type = 'put'; } }
class DeleteCommand { constructor(i) { this.input = i; this.type = 'delete'; } }
class QueryCommand { constructor(i) { this.input = i; this.type = 'query'; } }
class ScanCommand { constructor(i) { this.input = i; this.type = 'scan'; } }
class UpdateCommand { constructor(i) { this.input = i; this.type = 'update'; } }
class BatchWriteCommand { constructor(i) { this.input = i; this.type = 'batchWrite'; } }

const TABLE = 'test-table';
const store = new Map();          // "PK|SK" -> Item
const k = (item) => `${item.PK}|${item.SK}`;
function resetDb() { store.clear(); }

/** Only the UpdateExpression shapes upload-questions.js's activeVersion flip issues. */
function applyUpdate(inp) {
  const key = `${inp.Key.PK}|${inp.Key.SK}`;
  const item = { ...(store.get(key) || { PK: inp.Key.PK, SK: inp.Key.SK }) };
  const names = inp.ExpressionAttributeNames || {};
  const values = inp.ExpressionAttributeValues || {};
  const body = String(inp.UpdateExpression).replace(/^\s*SET\s+/i, '');
  for (const clause of body.split(/,(?![^(]*\))/)) {
    const [lhsRaw, rhsRaw] = clause.split('=');
    if (!rhsRaw) continue;
    const attr = names[lhsRaw.trim()] || lhsRaw.trim();
    const rhs = rhsRaw.trim();
    const listAppend = rhs.match(/^list_append\(\s*if_not_exists\(([^,]+),\s*([^)]+)\)\s*,\s*(\S+)\s*\)$/);
    if (listAppend) {
      const existing = item[names[listAppend[1].trim()] || listAppend[1].trim()];
      const seed = values[listAppend[2].trim()];
      const entry = values[listAppend[3].trim()];
      item[attr] = [...(Array.isArray(existing) ? existing : seed), ...entry];
      continue;
    }
    item[attr] = values[rhs];
  }
  store.set(key, item);
  return { Attributes: item };
}

const fakeDoc = {
  send: async (cmd) => {
    const inp = cmd.input || {};
    if (cmd.type === 'get') return { Item: store.get(`${inp.Key.PK}|${inp.Key.SK}`) };
    if (cmd.type === 'put') { store.set(k(inp.Item), inp.Item); return {}; }
    if (cmd.type === 'delete') { store.delete(`${inp.Key.PK}|${inp.Key.SK}`); return {}; }
    if (cmd.type === 'update') return applyUpdate(inp);
    if (cmd.type === 'batchWrite') {
      const reqs = inp.RequestItems[TABLE] || [];
      if (reqs.length > 25) throw new Error(`BatchWrite over the 25-item limit: ${reqs.length}`);
      for (const r of reqs) {
        if (r.PutRequest) store.set(k(r.PutRequest.Item), r.PutRequest.Item);
        else if (r.DeleteRequest) store.delete(`${r.DeleteRequest.Key.PK}|${r.DeleteRequest.Key.SK}`);
      }
      return { UnprocessedItems: {} };
    }
    if (cmd.type === 'query') {
      const v = inp.ExpressionAttributeValues || {};
      const pk = v[':pk'] ?? v[':setpk'];
      const prefix = v[':sk'] ?? v[':questionPrefix'];
      let items = [...store.values()].filter((i) => i.PK === pk);
      if (prefix) items = items.filter((i) => String(i.SK).startsWith(prefix));
      items.sort((a, b) => String(a.SK).localeCompare(String(b.SK)));
      return { Items: items, Count: items.length };
    }
    return { Items: [], Count: 0 };
  },
};

stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  GetCommand, PutCommand, DeleteCommand, QueryCommand,
  ScanCommand, UpdateCommand, BatchWriteCommand,
});

process.env.TABLE_NAME = TABLE;

const upload = require(path.join(REPO, 'lambda-functions', 'admin', 'upload-questions.js')).handler;
const download = require(path.join(REPO, 'lambda-functions', 'admin', 'download-question-set.js')).handler;

if (!process.env.DEBUG) console.log = () => {};
const say = (...a) => process.stdout.write(a.join(' ') + '\n');

let pass = 0, fail = 0;
function check(label, fn) {
  try { fn(); say(`  PASS  ${label}`); pass++; }
  catch (e) { say(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

const parse = (res) => JSON.parse(res.body);

/** An ADMIN caller in this API's real event shape — see set-versioning-flow.js. */
const adminContext = () => ({
  requestContext: {
    authorizer: { lambda: { username: 'ada', userId: 'sub-ada', groups: 'admins', status: 'enabled' } },
  },
});

const rowsIn = (pk) =>
  [...store.values()].filter((i) => i.PK === pk && String(i.SK).startsWith('QUESTION#'))
    .sort((a, b) => String(a.SK).localeCompare(String(b.SK)));

/**
 * Create -> export -> re-import as a replace, all through the real handlers.
 *
 * A plain create lands in the legacy `SET#<id>` partition; the replace
 * snapshots that to v1 and writes v2. So `before` is the legacy partition and
 * `after` is v2 — the same rows a game would be served, on both sides.
 */
async function roundTrip(title, engagementType, csv) {
  const created = await upload({
    ...adminContext(),
    body: JSON.stringify({ fileName: `${title}.csv`, fileContent: csv, customTitle: title, engagementType }),
  });
  assert.strictEqual(created.statusCode, 200, `create failed: ${created.body}`);
  const setId = parse(created).setId;
  const before = rowsIn(`SET#${setId}`);

  const exported = await download({ pathParameters: { setId }, queryStringParameters: {} });
  assert.strictEqual(exported.statusCode, 200, `download failed: ${exported.body}`);
  const exportedCsv = parse(exported).content;

  // The exporter's EXACT bytes go back in. No editing, no fixing up.
  const replaced = await upload({
    ...adminContext(),
    body: JSON.stringify({ fileName: 'roundtrip.csv', fileContent: exportedCsv, replaceSetId: setId }),
  });
  assert.strictEqual(replaced.statusCode, 200, `replace failed: ${replaced.body}`);
  const version = parse(replaced).version;
  const after = rowsIn(`SET#${setId}#v${version}`);

  return { setId, before, after, csv: exportedCsv, header: exportedCsv.split('\n')[0] };
}

/** Compare question rows field for field. PK differs by design (legacy vs #v2). */
function assertSameQuestions(before, after) {
  assert.strictEqual(after.length, before.length,
    `question count changed: ${before.length} -> ${after.length}`);
  const strip = (r) => { const { PK, ...rest } = r; return rest; };
  for (let i = 0; i < before.length; i++) {
    assert.deepStrictEqual(strip(after[i]), strip(before[i]),
      `question ${i + 1} (${before[i].SK}) changed across the round trip`);
  }
}

/**
 * Guard against a vacuous pass. deepStrictEqual over two rows that are equally
 * EMPTY would be green while every answer was destroyed, so the fields the
 * defect eats are asserted present on the `before` side first.
 */
function assertCarries(rows, fields) {
  for (const f of fields) {
    const populated = rows.filter((r) => {
      const v = r[f];
      return Array.isArray(v) ? v.length > 0 : String(v ?? '').trim() !== '';
    });
    assert.ok(populated.length === rows.length,
      `fixture is vacuous: only ${populated.length}/${rows.length} rows carry a non-empty ${f}`);
  }
}

// ---- fixtures, in the importer's contract (the shape sets/ and the AI builders emit) ----

const TRIVIA_CSV = [
  'Category,Question#,Title,QuestionDetail,AnswerDetails,School,CustomInstruction,'
    + 'OptionA,OptionB,OptionC,OptionD,OptionE,OptionF,CorrectAnswer,Difficulty,Tags',
  '"Music",1,"WHO SANG IT","Released in 1984.","Prince wrote it in a single night.","Pop School",'
    + '"No conferring.","Prince","Madonna","Sting","Bowie","Cher","Wham","OptionA","easy","80s|pop"',
  '"Music",2,"WHICH ALBUM","The best seller of the decade.","Forty million copies and counting.","Pop School",'
    + '"No conferring.","Thriller","Purple Rain","Like a Virgin","Born in the USA","Faith","Hysteria","OptionB","hard","80s|albums"',
  '"Film",1,"WHICH DIRECTOR","Two sequels followed.","Shot in ten weeks on a small budget.","Film School",'
    + '"No conferring.","Spielberg","Lucas","Zemeckis","Scott","Cameron","Hughes","OptionC","medium","80s|film"',
].join('\n');

const POLL_CSV = [
  'Category,Question#,Title,Detail_lesson,School,CustomInstruction,Options,AllowMultiple,Tags',
  '"Workplace",1,"WHERE DO YOU WORK BEST","Environment shapes output.","Business School",'
    + '"Pick one.","Office|Remote|Hybrid|Co-working","false","remote-work|workplace"',
  '"Workplace",2,"WHICH TOOLS","Tool choice varies by team.","Business School",'
    + '"Pick as many as apply.","Email|Slack|Teams|Phone|Video","true","tools"',
  '"Culture",1,"WHAT DO WE REWARD","Incentives beat intentions.","Business School",'
    + '"Pick one.","Speed|Quality|Novelty","false","culture"',
].join('\n');

const ART_CSV = [
  'Category,Question#,Title,Detail_lesson,School,CustomInstruction,AnswerDetails,Image,Tags',
  '"Renaissance",1,"THE ENIGMATIC SMILE","","Leonardo da Vinci","Invent a title.",'
    + '"Real title: Mona Lisa. Stolen from the Louvre in 1911.","smile.jpg","renaissance|portrait"',
  '"Renaissance",2,"A SWIRLING NIGHT SKY","","Vincent van Gogh","Invent a title.",'
    + '"Real title: The Starry Night. Painted from an asylum window.","night.jpg","post-impressionism"',
  '"Ukiyo-e",1,"THE TOWERING SEA","","Katsushika Hokusai","Invent a title.",'
    + '"Real title: The Great Wave off Kanagawa. A woodblock print, not a painting.","wave.jpg","ukiyo-e"',
].join('\n');

const WAVELENGTH_CSV = [
  'Category,Question#,Title,Detail_lesson,School,CustomInstruction,Tags',
  '"Technology",1,"Agentic AI","Your PM wants it on the dashboard by Friday.","Business School",'
    + '"Ten words that come to mind.","ai|buzzwords"',
  '"Technology",2,"Servant Leadership","The CEO named it at the retreat.","Business School",'
    + '"Ten words that come to mind.","leadership"',
  '"Culture",1,"Psychological Safety","Nobody spoke up in the post-mortem.","Business School",'
    + '"Ten words that come to mind.","culture|teams"',
].join('\n');

(async () => {
  say('question-set CSV round trip\n');

  // ==== trivia =============================================================
  say('  -- trivia --');
  resetDb();
  {
    const t = await roundTrip('Roundtrip Trivia', 'trivia', TRIVIA_CSV);

    // rejects: a fixture whose options are already empty, which would make
    // every deepStrictEqual below pass vacuously.
    check('the seeded trivia set really carries six options, a correct answer, a reveal and a difficulty', () =>
      assertCarries(t.before, ['optionA', 'optionB', 'optionC', 'optionD', 'optionE', 'optionF',
        'correctAnswer', 'difficulty', 'AnswerDetails']));

    // rejects: re-emitting WrongAnswer1/2/3, or any header the importer's
    // getColumnIndex cannot match, for the trivia options.
    check('the exported trivia header names OptionA..OptionF, never WrongAnswer*', () => {
      for (const col of ['OptionA', 'OptionB', 'OptionC', 'OptionD', 'OptionE', 'OptionF']) {
        assert.ok(t.header.split(',').includes(col), `header is missing ${col}: ${t.header}`);
      }
      assert.ok(!/wronganswer/i.test(t.header), `header still carries WrongAnswer columns: ${t.header}`);
    });

    // rejects: dropping AnswerDetails from the trivia branch again — the reveal
    // is read only by game/get-ai-summary.js at RESULTS, so nothing else notices.
    check('the exported trivia header carries the AnswerDetails reveal', () =>
      assert.ok(t.header.split(',').includes('AnswerDetails'), t.header));

    // rejects: ANY field-level loss across the round trip — options, correct
    // answer, difficulty, reveal, tags, category, order, question numbering.
    check('every trivia question survives the round trip field for field', () =>
      assertSameQuestions(t.before, t.after));

    // Named individually so a failure says WHICH promise broke, not just "rows differ".
    check('optionD, optionE and optionF are not truncated away (the old exporter emitted three)', () => {
      assert.deepStrictEqual(t.after.map((r) => r.optionD), t.before.map((r) => r.optionD));
      assert.deepStrictEqual(t.after.map((r) => r.optionE), t.before.map((r) => r.optionE));
      assert.deepStrictEqual(t.after.map((r) => r.optionF), t.before.map((r) => r.optionF));
    });
    check('the correct answer still points at the same option id', () =>
      assert.deepStrictEqual(t.after.map((r) => r.correctAnswer), ['OptionA', 'OptionB', 'OptionC']));
    check('difficulty is preserved, not reset to medium', () =>
      assert.deepStrictEqual(t.after.map((r) => r.difficulty), ['easy', 'hard', 'medium']));
    check('the reveal survives', () =>
      assert.deepStrictEqual(t.after.map((r) => r.AnswerDetails), t.before.map((r) => r.AnswerDetails)));

    // rejects: renumbering Question# globally on export, which silently rewrites
    // category-relative numbering on the next import (1,2,1 -> 1,2,3).
    check('category-relative Question# numbering is not rewritten', () =>
      assert.deepStrictEqual(t.after.map((r) => r.QuestionNumber), [1, 2, 1]));
  }

  // ==== poll ===============================================================
  say('\n  -- poll --');
  resetDb();
  {
    const t = await roundTrip('Roundtrip Poll', 'poll', POLL_CSV);

    // rejects: a vacuous fixture, and a change to the importer that stopped
    // writing poll options at all.
    check('the seeded poll set really carries options', () =>
      assertCarries(t.before, ['options']));

    // rejects: reading the capitalised `q.Options`, which the importer never
    // writes — the attribute is lower-case `options`. That read produced a
    // present-but-EMPTY column, which is why nothing looked wrong.
    check('the exported Options column is populated, not an empty cell', () => {
      const rows = t.csv.trim().split('\n').slice(1);
      const idx = t.header.split(',').indexOf('Options');
      assert.ok(idx >= 0, `no Options column: ${t.header}`);
      for (const row of rows) {
        assert.ok(/"Office\|Remote\|Hybrid\|Co-working"|"Email\|Slack\|Teams\|Phone\|Video"|"Speed\|Quality\|Novelty"/.test(row),
          `a poll row exported with no options: ${row}`);
      }
    });

    check('every poll question survives the round trip field for field', () =>
      assertSameQuestions(t.before, t.after));
    check('poll options come back as the same arrays', () =>
      assert.deepStrictEqual(t.after.map((r) => r.options), [
        ['Office', 'Remote', 'Hybrid', 'Co-working'],
        ['Email', 'Slack', 'Teams', 'Phone', 'Video'],
        ['Speed', 'Quality', 'Novelty'],
      ]));
    check('allowMultiple is preserved per question', () =>
      assert.deepStrictEqual(t.after.map((r) => r.allowMultiple), [false, true, false]));
  }

  // ==== call-and-answer, carrying the art-title columns ====================
  say('\n  -- call-and-answer (art title: Image + AnswerDetails) --');
  resetDb();
  {
    const t = await roundTrip('Roundtrip Art', 'call-and-answer', ART_CSV);

    check('the seeded art set really carries an image and a reveal', () =>
      assertCarries(t.before, ['Image', 'AnswerDetails']));
    check('every call-and-answer question survives the round trip field for field', () =>
      assertSameQuestions(t.before, t.after));
    // rejects: losing toMediaKey's idempotency, which would grow the stored key
    // to sets/x/sets/x/smile.jpg on the second trip.
    check('the media key does not grow a second prefix', () =>
      assert.deepStrictEqual(t.after.map((r) => r.Image),
        ['sets/roundtripart/smile.jpg', 'sets/roundtripart/night.jpg', 'sets/roundtripart/wave.jpg']));
    check('category-relative Question# numbering is not rewritten', () =>
      assert.deepStrictEqual(t.after.map((r) => r.QuestionNumber), [1, 2, 1]));
  }

  // ==== wavelength =========================================================
  //
  // Wavelength has no branch of its own in either handler: it rides the
  // call-and-answer default. Confirmed against engagedev — a wavelength question
  // row carries no type-specific attribute whatsoever, only the shared
  // Title/Detail/Category/School/CustomInstructions set. So the round trip must
  // be lossless for it too, and the reason it is must not be an accident.
  say('\n  -- wavelength --');
  resetDb();
  {
    const t = await roundTrip('Roundtrip Wavelength', 'wavelength', WAVELENGTH_CSV);

    check('every wavelength question survives the round trip field for field', () =>
      assertSameQuestions(t.before, t.after));
    // rejects: a future wavelength-specific export branch that emits columns the
    // importer does not read, repeating the trivia defect on a third type.
    check('the replace keeps the set on the wavelength engagement type', () =>
      assert.strictEqual(store.get(`SETS|SET#${t.setId}`).engagementType, 'wavelength'));
    check('the spectrum prompt (Detail) and the per-question instruction survive', () => {
      assert.deepStrictEqual(t.after.map((r) => r.Detail), t.before.map((r) => r.Detail));
      assert.deepStrictEqual(t.after.map((r) => r.CustomInstructions), t.before.map((r) => r.CustomInstructions));
    });
  }

  // ==== a second trip changes nothing further ==============================
  //
  // Once is not enough: an exporter can be lossless-on-average and still drift
  // (renumbering, re-prefixing a media key) in a way that only shows on trip two.
  say('\n  -- idempotence --');
  resetDb();
  {
    const first = await roundTrip('Roundtrip Twice', 'trivia', TRIVIA_CSV);
    const again = await download({ pathParameters: { setId: first.setId }, queryStringParameters: {} });
    const secondCsv = parse(again).content;
    check('exporting the re-imported set yields byte-identical CSV', () =>
      assert.strictEqual(secondCsv, first.csv));
  }

  say(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { process.stdout.write(`harness error: ${e && e.stack}\n`); process.exit(1); });
