// TENANCY: a host acts FOR an organisation, and content belongs to it. Without
// an org in the context a host can create nothing — "Choose an organisation" —
// which is the scheme working, not a fixture detail.
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

// ── TENANT CRYPTO ──────────────────────────────────────────────────────────
// The handlers this suite drives now encrypt org content, and tenant-crypto
// THROWS on an org with no data key rather than quietly writing plaintext. The
// shared stub refuses a Decrypt with a missing or mismatched encryption context,
// exactly as the key policy will, so this does not weaken anything here.
const { makeKmsStub, installTestKeyLoader, plainRow } = require('./helpers/tenant-crypto-stub');
const kmsStub = makeKmsStub();
stub('@aws-sdk/client-kms', kmsStub.exports);
// Every org gets a deterministic data key, no ORG#<id>/METADATA row needed —
// otherwise every reset() in this file would have to re-seed one.
installTestKeyLoader();
stub('@aws-sdk/client-dynamodb', { DynamoDBClient: class {} });
stub('@aws-sdk/lib-dynamodb', {
  DynamoDBDocumentClient: { from: () => fakeDoc },
  GetCommand, PutCommand, DeleteCommand, QueryCommand,
  ScanCommand, UpdateCommand, BatchWriteCommand,
});

process.env.TABLE_NAME = TABLE;

const upload = require(path.join(REPO, 'lambda-functions', 'admin', 'upload-questions.js')).handler;
const download = require(path.join(REPO, 'lambda-functions', 'admin', 'download-question-set.js')).handler;
// The read the CONSOLE EDITOR loads its working copy from. Unauthenticated by
// design (template-clean.yaml has no Auth block on it and two callers use bare
// fetch), so the editor and the copy-from-another-set picker both use it.
const getQuestions = require(path.join(REPO, 'lambda-functions', 'admin', 'get-question-set-questions.js')).handler;

/**
 * THE EDITOR'S SERIALISER — the real one, not a copy of it.
 *
 * `src/src/utils/questionRows.js` is CommonJS precisely so this file can
 * require the module the browser ships. Slice 4 adds a SECOND writer of this
 * CSV (the console's Save, alongside download-question-set.js), and a second
 * writer is a second chance to reintroduce the defect this whole file exists
 * for. So it is held to the same contract, in process, against the real
 * handlers — not reviewed by eye.
 */
const {
  editableRows, rowsToCsv, blankRow, copiedRow, moveRow,
  summarizeRowChanges, versionNote, rowProblems,
} = require(path.join(REPO, 'src', 'src', 'utils', 'questionRows.js'));

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
    authorizer: { lambda: { username: 'ada', userId: 'sub-ada', groups: 'admins', status: 'enabled', orgId: 'org_nw', orgRole: 'admin' } },
  },
});

// DECRYPTED. Org question rows are envelopes at rest since tenancy, and an
// envelope never equals the string a round-trip assertion expects — worse, two
// encryptions of the SAME text differ, because the IV is random, so a
// field-for-field comparison of raw rows fails even when the round trip is
// perfect. Unwrapping here keeps every assertion below about the CONTENT, which
// is what this file is for.
const rowsIn = (pk) =>
  [...store.values()].filter((i) => i.PK === pk && String(i.SK).startsWith('QUESTION#'))
    .sort((a, b) => String(a.SK).localeCompare(String(b.SK)))
    .map((i) => plainRow('org_nw', i));

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
  const before = rowsIn(`ORG#org_nw#SET#${setId}`);

  // The download needs the caller too. The set is created by adminContext(),
  // which since tenancy belongs to an ORGANISATION — so an anonymous export is
  // a 404, not a leak of somebody's content.
  const exported = await download({
    ...adminContext(), pathParameters: { setId }, queryStringParameters: {},
  });
  assert.strictEqual(exported.statusCode, 200, `download failed: ${exported.body}`);
  const exportedCsv = parse(exported).content;

  // The exporter's EXACT bytes go back in. No editing, no fixing up.
  const replaced = await upload({
    ...adminContext(),
    body: JSON.stringify({ fileName: 'roundtrip.csv', fileContent: exportedCsv, replaceSetId: setId }),
  });
  assert.strictEqual(replaced.statusCode, 200, `replace failed: ${replaced.body}`);
  const version = parse(replaced).version;
  const after = rowsIn(`ORG#org_nw#SET#${setId}#v${version}`);

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

/**
 * Call-and-answer carrying the two columns Slice 2 added: the per-question
 * RoundKind override and, for Apply rounds, whose material the question holds.
 *
 * These are here for exactly the reason the file exists. A column the importer
 * reads and the exporter does not emit is destroyed by the next replace, in
 * total silence, with a 200 — that is what happened to trivia options, the
 * trivia reveal and every poll option. Adding two columns without adding two
 * fixtures would have reproduced the same defect on a fourth and fifth column
 * a week after fixing it on three.
 *
 * The set deliberately MIXES kinds: the owner named the mixed case directly
 * (open Produce to warm the room, move to Improve once people are talking), and
 * a fixture where every row carries the same value cannot catch a round trip
 * that collapses them all onto the first one.
 */
const ROUND_KIND_CSV = [
  'Category,Question#,Title,Detail_lesson,School,CustomInstruction,RoundKind,SourceAttribution,Tags',
  '"Opening",1,"WHAT WENT WRONG LAST QUARTER","Think of one incident you were in the room for.",'
    + '"Business School","Answer from your own experience.","produce","","retro|opening"',
  '"Transfer",1,"THE PRE-MORTEM RULE","Before starting, the team writes the failure report as if it had already happened, then works backwards from it.",'
    + '"Business School","Say where it would land here.","apply","Gary Klein, Performing a Project Premortem","planning|foreign"',
  '"Our Words",1,"THE ON-CALL PARAGRAPH","\'The on-call engineer is expected to respond promptly to pages during their rotation.\'",'
    + '"Business School","Rewrite it.","improve","","runbook|ours"',
  '"Verdict",1,"IS THE RELEASE NOTE READY","Judge it against the bar we set in January: could a customer act on it without asking us anything?",'
    + '"Business School","Give a verdict.","judge","","release|verdict"',
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

  // ==== call-and-answer, carrying the round-kind columns ===================
  say('\n  -- call-and-answer (round kind: RoundKind + SourceAttribution) --');
  resetDb();
  {
    const t = await roundTrip('Roundtrip Kinds', 'call-and-answer', ROUND_KIND_CSV);

    // rejects: a vacuous fixture, and an importer change that stops writing the
    // override at all — either would make every deepStrictEqual below green
    // while the column was being destroyed.
    check('the seeded set really carries a per-question RoundKind', () =>
      assertCarries(t.before, ['RoundKind']));

    // rejects: emitting RoundKind under any header the importer's exact-ish
    // matcher cannot claim, which is the WrongAnswer* defect on a new column.
    check('the exported header names RoundKind and SourceAttribution', () => {
      const cols = t.header.split(',');
      assert.ok(cols.includes('RoundKind'), t.header);
      assert.ok(cols.includes('SourceAttribution'), t.header);
    });

    check('every question survives the round trip field for field', () =>
      assertSameQuestions(t.before, t.after));

    // rejects: collapsing a mixed set onto one kind, or dropping the override
    // and silently inheriting the set's direction — a question would then carry
    // a direction its author explicitly changed away from.
    check('the four kinds come back distinct and in order', () =>
      assert.deepStrictEqual(t.after.map((r) => r.RoundKind),
        ['produce', 'apply', 'improve', 'judge']));

    // rejects: dropping SourceAttribution, which is the only record of WHOSE
    // material an Apply question carries. Without it an Apply round cannot tell
    // the room the passage is not theirs, which is the whole distinction.
    check('the Apply row keeps its attribution and the others stay empty', () => {
      const byTitle = Object.fromEntries(t.after.map((r) => [r.Title, r.SourceAttribution]));
      assert.strictEqual(byTitle['THE PRE-MORTEM RULE'], 'Gary Klein, Performing a Project Premortem');
      assert.strictEqual(byTitle['WHAT WENT WRONG LAST QUARTER'], undefined);
    });

    // rejects: the exporter drifting on trip two — an alphabetically-sorted
    // partition plus two new conditional columns is exactly the shape that
    // renumbers or re-orders once and then looks stable.
    const again = await download({ ...adminContext(), pathParameters: { setId: t.setId }, queryStringParameters: {} });
    check('a second export of the kinded set is byte-identical', () =>
      assert.strictEqual(parse(again).content, t.csv));
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
      assert.strictEqual(plainRow('org_nw', store.get(`ORG#org_nw#SETS|SET#${t.setId}`)).engagementType, 'wavelength'));
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
    const again = await download({ ...adminContext(), pathParameters: { setId: first.setId }, queryStringParameters: {} });
    const secondCsv = parse(again).content;
    check('exporting the re-imported set yields byte-identical CSV', () =>
      assert.strictEqual(secondCsv, first.csv));
  }

  // ==== the console editor's working copy ==================================
  //
  // Slice 4: add, edit, delete, reorder and copy-from-another-set, all against
  // a working copy in the browser, saved as ONE replace. The working copy is
  // loaded from get-question-set-questions.js and serialised by
  // src/src/utils/questionRows.js — so the loop under test here is
  //
  //     importer -> questions endpoint -> editableRows -> rowsToCsv -> importer
  //
  // with every handler being the real one. A question the editor did not touch
  // must come out the far end field for field identical, or "I fixed one typo"
  // is once again "I lost every answer in the set".
  say('\n  -- the console editor: working copy -> CSV -> replace --');

  /** The editor's load: the real endpoint, then the real row mapper. */
  async function workingCopy(setId) {
    const res = await getQuestions({ ...adminContext(), pathParameters: { setId }, queryStringParameters: {} });
    assert.strictEqual(res.statusCode, 200, `questions read failed: ${res.body}`);
    return editableRows(JSON.parse(res.body));
  }

  /** The editor's Save: one replace, one version, carrying the version note. */
  async function saveWorkingCopy(setId, rows, engagementType, baselineOrder, extra = {}) {
    const summary = summarizeRowChanges(rows, baselineOrder);
    const res = await upload({
      ...adminContext(),
      body: JSON.stringify({
        replaceSetId: setId,
        fileName: 'console-edit.csv',
        fileContent: rowsToCsv(rows, engagementType, { renumber: summary.reordered }),
        engagementType,
        versionNote: versionNote(summary),
        ...extra,
      }),
    });
    assert.strictEqual(res.statusCode, 200, `console save failed: ${res.body}`);
    const version = parse(res).version;
    return { version, rows: rowsIn(`ORG#org_nw#SET#${setId}#v${version}`), summary };
  }

  resetDb();
  {
    const t = await roundTrip('Console Trivia', 'trivia', TRIVIA_CSV);
    const rows = await workingCopy(t.setId);

    // rejects: a working copy sorted the way the endpoint returns it. That
    // endpoint sorts on `sortOrder`, which NO writer sets, so every set comes
    // back alphabetically by title — WHICH ALBUM before WHO SANG IT. Saving
    // that order would silently reorder somebody's set on a save that was only
    // meant to fix a typo.
    check('the working copy is in set order, not the endpoint\'s alphabetical order', () =>
      assert.deepStrictEqual(rows.map((r) => r.title),
        ['WHO SANG IT', 'WHICH ALBUM', 'WHICH DIRECTOR']));

    // rejects: ANY divergence between the console's serialiser and the
    // exporter — a renamed column, a dropped conditional column, different
    // quoting, a different default for Difficulty. The importer matches column
    // names EXACTLY and has no fallback for an option column, so a serialiser
    // that is merely "close" destroys answers in silence. This is the single
    // assertion that keeps the second writer honest.
    check('the console serialises byte-identically to download-question-set.js', () =>
      assert.strictEqual(rowsToCsv(rows, 'trivia'), t.csv));

    // rejects: a save that sends the whole form, or one that renumbers, or one
    // that drops a field the editor does not render. An untouched Save is a new
    // version of exactly the same questions.
    const untouched = await saveWorkingCopy(t.setId, rows, 'trivia', rows.map((r) => r.uid));
    check('saving an untouched working copy changes no question at all', () =>
      assertSameQuestions(t.after, untouched.rows));

    // rejects: `versions[].note` staying '' on every entry, which is what made
    // the version list four identical rows and a rollback a guess.
    check('the version records what the save actually did', () => {
      const meta = plainRow('org_nw', store.get(`ORG#org_nw#SETS|SET#${t.setId}`));
      const entry = meta.versions[meta.versions.length - 1];
      assert.strictEqual(entry.version, untouched.version);
      assert.match(entry.note, /no changes/i);
    });
  }

  resetDb();
  {
    const t = await roundTrip('Console Edits', 'trivia', TRIVIA_CSV);
    const rows = await workingCopy(t.setId);
    const baseline = rows.map((r) => r.uid);

    // Delete one, edit one, add one — the three operations, in one Save.
    let next = rows.map((r) => (r.title === 'WHICH ALBUM' ? { ...r, removed: true } : r));
    next = next.map((r) => (r.title === 'WHO SANG IT'
      ? { ...r, title: 'WHO REALLY SANG IT', edited: true }
      : r));
    next = [...next, {
      ...blankRow(),
      category: 'Film',
      title: 'WHICH SCORE',
      detail: 'Synths, mostly.',
      optionA: 'Vangelis', optionB: 'Zimmer', optionC: 'Williams', optionD: 'Elfman',
      correctAnswer: 'OptionA', difficulty: 'hard', tags: ['80s', 'score'],
    }];

    const saved = await saveWorkingCopy(t.setId, next, 'trivia', baseline);

    // rejects: a Save that fires one request per edit. Three operations, one
    // version — that is decision 3's whole point, and it is what makes the
    // version list readable instead of a per-keystroke log.
    check('add + edit + delete land as ONE new version', () => {
      const meta = plainRow('org_nw', store.get(`ORG#org_nw#SETS|SET#${t.setId}`));
      assert.strictEqual(saved.version, 3, `expected v3, got v${saved.version}`);
      assert.strictEqual(meta.activeVersion, 3);
      assert.strictEqual(meta.versions.length, 3);
    });

    // rejects: a serialiser that writes the tombstoned rows out anyway. The
    // panel keeps a removed question on screen so it can be restored, and a
    // writer that does not filter them turns every delete into a no-op.
    check('the deleted question is gone and the other two survive', () => {
      const titles = saved.rows.map((r) => r.Title).sort();
      assert.deepStrictEqual(titles, ['WHICH DIRECTOR', 'WHICH SCORE', 'WHO REALLY SANG IT']);
    });

    // rejects: an edit that writes the title and quietly drops everything the
    // editor does not render — options E and F, the reveal, the tags. The row
    // the editor holds is the WHOLE question, not the fields on screen.
    check('the edited question keeps every field the form never showed', () => {
      const edited = saved.rows.find((r) => r.Title === 'WHO REALLY SANG IT');
      const before = t.after.find((r) => r.Title === 'WHO SANG IT');
      const { Title, PK, ...rest } = edited;
      const { Title: _t, PK: _p, ...restBefore } = before;
      assert.deepStrictEqual(rest, restBefore);
    });

    // rejects: a new question serialised into columns the importer does not
    // read — the WrongAnswer* defect, reintroduced by the second writer.
    check('the added question arrives complete', () => {
      const added = saved.rows.find((r) => r.Title === 'WHICH SCORE');
      assert.strictEqual(added.optionA, 'Vangelis');
      assert.strictEqual(added.correctAnswer, 'OptionA');
      assert.strictEqual(added.difficulty, 'hard');
      assert.deepStrictEqual(added.Tags, ['80s', 'score']);
    });

    // rejects: a note that says something happened without saying what. Four
    // versions that all read "edited" are four versions you cannot choose
    // between when you need to roll one back.
    check('the version note says what changed', () => {
      const meta = plainRow('org_nw', store.get(`ORG#org_nw#SETS|SET#${t.setId}`));
      const note = meta.versions[meta.versions.length - 1].note;
      assert.match(note, /1 added/);
      assert.match(note, /1 edited/);
      assert.match(note, /1 removed/);
    });

    // rejects: a validation gate that only checks the server's answer. The
    // importer SKIPS a row with no Category or Title — 200, cheerful message,
    // silently one question short — so the editor has to refuse it first.
    check('a half-filled row is refused before it can be silently skipped', () => {
      const problems = rowProblems({ ...blankRow(), title: 'NO CATEGORY' }, 'trivia');
      assert.ok(problems.some((p) => /category/i.test(p)), problems.join('; '));
    });
  }

  // ==== reordering =========================================================
  resetDb();
  {
    const t = await roundTrip('Console Order', 'call-and-answer', ROUND_KIND_CSV);
    const rows = await workingCopy(t.setId);
    const baseline = rows.map((r) => r.uid);

    // Two questions in one category, so a move is visible in the stored keys.
    const twoInOne = rows.map((r) => ({ ...r, category: 'Opening' }));
    const moved = moveRow(twoInOne, twoInOne[3].uid, -3);
    const saved = await saveWorkingCopy(t.setId, moved, 'call-and-answer', baseline);

    // rejects: dropping `reordered` from the change summary, which would leave
    // Save disabled after a move — the owner drags a row, nothing happens, and
    // the move is lost on close.
    check('a reorder counts as an unsaved change', () =>
      assert.strictEqual(summarizeRowChanges(moved, baseline).reordered, true));

    // rejects: a save that keeps the load order regardless of the moves — the
    // reorder would appear to work on screen and be gone on reload.
    check('the new order is the stored order', () =>
      assert.deepStrictEqual(saved.rows.map((r) => r.Title),
        ['IS THE RELEASE NOTE READY', 'WHAT WENT WRONG LAST QUARTER',
          'THE PRE-MORTEM RULE', 'THE ON-CALL PARAGRAPH']));

    // rejects: emitting the STORED Question# after a reorder. The numbers would
    // then read 4,1,2,3 down a list the owner just put in order — the attribute
    // is only ever a label, and a label that contradicts the order it labels is
    // worse than no label.
    check('question numbers are rewritten to match the new order', () =>
      assert.deepStrictEqual(saved.rows.map((r) => r.QuestionNumber), [1, 2, 3, 4]));
  }

  // ==== copying a question out of another set ==============================
  //
  // The owner's idea: the add-question button offers to pull from another set.
  // A pulled question is a COPY (decision 2) — new keys, no link, no
  // propagation — carrying provenance that is read by nothing.
  say('\n  -- pulling a question from another set --');
  resetDb();
  {
    const target = await roundTrip('Console Target', 'call-and-answer', ART_CSV);
    const source = await roundTrip('Console Source', 'call-and-answer', ROUND_KIND_CSV);

    const targetRows = await workingCopy(target.setId);
    const baseline = targetRows.map((r) => r.uid);
    const sourceRows = await workingCopy(source.setId);
    const pulled = sourceRows.filter((r) => r.title === 'THE PRE-MORTEM RULE')
      .map((r) => copiedRow(r, source.setId, r.sk));

    const saved = await saveWorkingCopy(target.setId, [...targetRows, ...pulled], 'call-and-answer', baseline);
    const landed = saved.rows.find((r) => r.Title === 'THE PRE-MORTEM RULE');

    // rejects: a copy that carries the title and loses the material. An Apply
    // question IS its detail and its attribution; a copy without them is a
    // prompt about nothing.
    check('the pulled question arrives with its material, direction and attribution', () => {
      assert.ok(landed, `not copied: ${saved.rows.map((r) => r.Title).join(', ')}`);
      assert.match(landed.Detail, /writes the failure report/);
      assert.strictEqual(landed.RoundKind, 'apply');
      assert.strictEqual(landed.SourceAttribution, 'Gary Klein, Performing a Project Premortem');
      assert.deepStrictEqual(landed.Tags, ['planning', 'foreign']);
    });

    // rejects: reusing the source's identity. A shared key would put the copy
    // in the source set's partition — or, worse, make an edit here rewrite what
    // a game pinned to the source set is already playing.
    check('the copy has its own key in the target set, not the source\'s', () => {
      // Org-scoped since tenancy: the copy lands in the TARGET set's partition
      // inside the copying organisation, which is what stops a "copy into
      // another set" ever reaching across a tenant boundary.
      assert.strictEqual(landed.PK, `ORG#org_nw#SET#${target.setId}#v${saved.version}`);
      assert.notStrictEqual(landed.SK, 'QUESTION#c002#001');
    });

    // rejects: provenance columns the importer does not read — which is the
    // WrongAnswer* defect on a sixth and seventh column. Stamped once, then
    // destroyed by the next replace, is worse than never stamped.
    check('provenance is stamped, and it names the source set and row', () => {
      assert.strictEqual(landed.SourceSetId, source.setId);
      assert.strictEqual(landed.SourceQuestionSk, 'c002#001');
    });

    const again = await download({ ...adminContext(), pathParameters: { setId: target.setId }, queryStringParameters: {} });
    const rebounced = await upload({
      ...adminContext(),
      body: JSON.stringify({ replaceSetId: target.setId, fileName: 'again.csv', fileContent: parse(again).content }),
    });
    // rejects: an exporter that does not emit the two provenance columns. The
    // stamp would survive exactly one replace and then vanish, which is worse
    // than never stamping it.
    check('provenance survives a further export and re-import', () => {
      assert.strictEqual(rebounced.statusCode, 200, rebounced.body);
      const after = rowsIn(`ORG#org_nw#SET#${target.setId}#v${parse(rebounced).version}`);
      const still = after.find((r) => r.Title === 'THE PRE-MORTEM RULE');
      assert.strictEqual(still.SourceSetId, source.setId);
      assert.strictEqual(still.SourceQuestionSk, 'c002#001');
    });

    // rejects: propagation of any kind. The whole cost of decision 2 is that a
    // question living in two sets is fixed twice; the whole benefit is that
    // nothing an editor does here can reach into a set it does not own.
    check('the source set is untouched by the copy', () => {
      const sourceMeta = plainRow('org_nw', store.get(`ORG#org_nw#SETS|SET#${source.setId}`));
      assert.strictEqual(sourceMeta.activeVersion, 2);
      assert.strictEqual(sourceMeta.versions.length, 2);
      assert.strictEqual(rowsIn(`ORG#org_nw#SET#${source.setId}#v2`).length, 4);
    });
  }

  // ==== forking: saving a set you do not own ===============================
  //
  // The owner's ruling: editing a set you do not own is allowed, and on SAVE it
  // becomes YOUR copy. The client chooses WHICH set to write; it does not get
  // to relax WHO may write where. So the fork is a plain create — the same code
  // path as building a subset out of pulled questions — and a host who
  // hand-crafts a replace against somebody else's set is still refused.
  say('\n  -- fork on save, and the refusal that makes it necessary --');
  resetDb();
  {
    const hostContext = (sub) => ({
      requestContext: {
        authorizer: { lambda: { username: `host-${sub}`, userId: sub, groups: 'hosts', status: 'enabled', orgId: 'org_nw', orgRole: 'member' } },
      },
    });

    // An admin's set. Every set that predates ownership reads as admin-owned,
    // so this is also the shape of all ~41 existing ones.
    const original = await roundTrip('House Set', 'call-and-answer', ROUND_KIND_CSV);
    const rows = await workingCopy(original.setId);

    // rejects: moving the ownership decision into the console. A hidden button
    // is not a permission; the handler is. If this ever returns 200 the fork is
    // decoration and a host can add a version to a set they cannot manage.
    const refused = await upload({
      ...hostContext('sub-bo'),
      body: JSON.stringify({
        replaceSetId: original.setId,
        fileName: 'sneaky.csv',
        fileContent: rowsToCsv(rows, 'call-and-answer'),
      }),
    });
    check('a host replacing a set they do not own is still refused', () => {
      assert.strictEqual(refused.statusCode, 403, refused.body);
      assert.match(parse(refused).error, /belongs to someone else/i);
    });

    // The fork: one create, seeded from the same working copy. No replaceSetId,
    // so nothing about the original is read for writing and nothing is flipped.
    const forked = await upload({
      ...hostContext('sub-bo'),
      body: JSON.stringify({
        fileName: 'fork.csv',
        fileContent: rowsToCsv(rows.map((r) => ({
          ...r, sourceSetId: original.setId, sourceQuestionSk: r.sk,
        })), 'call-and-answer'),
        customTitle: 'House Set, adapted by Bo',
        customDescription: 'Adapted from "House Set".',
        sourceSetId: original.setId,
        engagementType: 'call-and-answer',
      }),
    });
    // rejects: a fork that lands unowned. An unowned set is admin-only by rule
    // (question-set-access.js), so the host would create a copy and instantly
    // be unable to edit it — the exact trap the fork exists to avoid.
    check('the fork creates a new set owned by the person who forked it', () => {
      assert.strictEqual(forked.statusCode, 200, forked.body);
      const meta = plainRow('org_nw', store.get(`ORG#org_nw#SETS|SET#${parse(forked).setId}`));
      assert.strictEqual(meta.createdBy, 'sub-bo');
      assert.strictEqual(meta.sourceSetId, original.setId);
      assert.strictEqual(meta.questionCount, 4);
    });

    // rejects: a fork that writes anything at all into the original — a
    // version, a flip, a row. "Not touched at all" is the promise.
    check('the original set is byte-for-byte what it was', () => {
      const meta = plainRow('org_nw', store.get(`ORG#org_nw#SETS|SET#${original.setId}`));
      assert.strictEqual(meta.activeVersion, 2);
      assert.strictEqual(meta.versions.length, 2);
      assert.strictEqual(meta.createdBy, 'sub-ada');
      assertSameQuestions(original.after, rowsIn(`ORG#org_nw#SET#${original.setId}#v2`));
    });

    // rejects: a fork whose questions came out different from the original's.
    // It is the same working copy through the same serialiser, so the rows must
    // match field for field apart from the provenance stamp.
    check('the forked set carries the same questions, with provenance', () => {
      const forkedRows = rowsIn(`ORG#org_nw#SET#${parse(forked).setId}`);
      assert.deepStrictEqual(forkedRows.map((r) => r.Title), original.after.map((r) => r.Title));
      assert.ok(forkedRows.every((r) => r.SourceSetId === original.setId),
        'a forked row lost its provenance');
    });
  }

  // ==== the WORKER'S CSV, held to the same contract ========================
  //
  // A THIRD WRITER of this CSV, and the reason this block exists. The
  // generation workers now create the question set themselves — the owner ran
  // the scenario builder for "World Leaders", was told "Close — this keeps
  // running", left, and came back to nothing, because the set was only ever
  // created client-side. `lambda-functions/admin/shared/generated-set.js`
  // builds the CSV the worker hands to upload-questions.js, and a second (now
  // third) writer of that CSV is a second chance to reintroduce exactly the
  // defect this file exists for.
  //
  // So its bytes go through the same loop as everything above: real importer,
  // real exporter, real re-import. Nothing is reviewed by eye.
  say('\n  -- the generation worker\'s CSV --');
  const { scenariosToCsv, triviaToCsv, pollsToCsv } = require(
    path.join(REPO, 'lambda-functions', 'admin', 'shared', 'generated-set.js'));

  resetDb();
  {
    // The item shape ai-generate-scenarios.js's normalizeItem really produces.
    const t = await roundTrip('Worker Scenarios', 'call-and-answer', scenariosToCsv([
      { title: 'THE "RIGHT" CALL', category: 'Judgement', detail: 'A hard one, with a comma, too.',
        customInstructions: 'Discuss with your team.', tags: ['judgement', 'Remote Work'] },
      { title: 'Escalating a security incident', category: 'Incidents', detail: 'Somebody else\'s runbook.',
        customInstructions: 'Say where it lands here.', tags: ['incidents'] },
    ]));

    check('the worker\'s scenario CSV is not vacuous', () =>
      assertCarries(t.before, ['Title', 'Detail', 'Category', 'CustomInstructions', 'Tags']));
    // rejects: a hand-rolled `"${value}"` in the worker's writer. THE "RIGHT"
    // CALL interpolates to three fields and shifts every column after it —
    // silent corruption, with a 200.
    check('a quoted title survives the worker\'s CSV and the round trip', () =>
      assert.strictEqual(t.before[0].Title, 'THE "RIGHT" CALL'));
    check('every worker-built scenario survives the round trip field for field', () =>
      assertSameQuestions(t.before, t.after));
    // rejects: emitting raw tags instead of normalised ones. The browser's
    // writer is `normalizeTags(tags).join('|')`, so a server CSV that skipped
    // the normalisation would produce a different set from the same items
    // depending on which path made it.
    check('tags are normalised the way the browser\'s writer normalises them', () =>
      assert.deepStrictEqual(t.before[0].Tags, ['judgement', 'remote-work']));
  }

  resetDb();
  {
    const t = await roundTrip('Worker Trivia', 'trivia', triviaToCsv([
      { title: 'WHO SANG IT', questionDetail: 'Released in 1984.', answerDetails: 'Written in one night.',
        category: 'Music', school: 'Pop School', optionA: 'Prince', optionB: 'Madonna', optionC: 'Sting',
        optionD: 'Cyndi Lauper', optionE: '', optionF: '', correctAnswer: 'OptionA',
        difficulty: 'easy', tags: ['music'] },
    ]));

    check('the worker\'s trivia CSV really carries options and a reveal', () =>
      assertCarries(t.before, ['optionA', 'optionD', 'correctAnswer', 'AnswerDetails', 'difficulty']));
    // rejects: the worker emitting WrongAnswer1/2/3 or Option1..5. The importer
    // reads OptionA..OptionF by exact name and has NO fallback, so those
    // columns lose every answer silently — the original defect of this file.
    check('every worker-built trivia question survives the round trip field for field', () =>
      assertSameQuestions(t.before, t.after));
  }

  resetDb();
  {
    const t = await roundTrip('Worker Polls', 'poll', pollsToCsv([
      { title: 'Which release cadence', category: 'Delivery', detail: 'Pick one.',
        school: 'Delivery', customInstructions: 'Choose.',
        options: ['Weekly', 'Fort|nightly', 'Monthly'], allowMultiple: true, tags: ['delivery'] },
    ]));

    check('the worker\'s poll CSV really carries options', () =>
      assertCarries(t.before, ['options']));
    // rejects: restoring Option1..Option5 in the worker's writer, which is how
    // every AI-generated poll set once imported with zero options.
    check('every worker-built poll question survives the round trip field for field', () =>
      assertSameQuestions(t.before, t.after));
    // rejects: passing a literal `|` through. The importer splits on it with no
    // escape, so an unfolded pipe silently becomes two options.
    check('a pipe inside an option is folded, not allowed to split the option', () =>
      assert.deepStrictEqual(t.before[0].options, ['Weekly', 'Fort/nightly', 'Monthly']));
    check('allowMultiple survives', () =>
      assert.strictEqual(t.before[0].allowMultiple, true));
  }

  say(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { process.stdout.write(`harness error: ${e && e.stack}\n`); process.exit(1); });
