/**
 * A SET SITS ON ONE SHELF, AND MAY CARRY WORDS OF ITS OWN.
 *
 * The owner asked for this: *"i think we need topic tags for question sets and
 * req at least 1 pretty broad for public ones Science/Tech Health/Med Business
 * Politics History etc. think how a book store might classify sections."*
 *
 * ── WHY A FIXED SHELF AND NOT FREE TEXT ────────────────────────────────────
 *
 * Free text alone fragments: "history", "History", "hist" are three shelves in
 * a filter and one shelf to a reader. A browse and a filter need a closed list
 * or they cannot be built at all. So there are TWO things on a set and they do
 * different jobs:
 *
 *   topic   ONE id from a closed list of fifteen. This is the shelf.
 *   tags    any number of the author's own words. These are the specifics
 *           ("1980s", "onboarding") that no shelf would ever carry.
 *
 * ── THE THREE WORDS THIS PRODUCT ALREADY OVERLOADS ─────────────────────────
 *
 * CATEGORY is taken. It means the IN-SET grouping — c001…c005, categoryCount,
 * the CATEGORY# rows, the host bitmask. The shelf is NOT a category and these
 * tests never call it one.
 *
 * TAGS is half taken. `Tags` (capitalised, from the CSV column) is a QUESTION
 * row's own keywords — see tests/upload-questions-tags.js. `tags` (lower case)
 * on the metadata row is the SET's. The case difference is the repo's existing
 * convention: CSV-derived attributes are Capitalised, metadata attributes are
 * not. One of these tests pins that a set's tags never leak onto its questions.
 *
 * ── WHAT IS REFUSED, AND WHAT IS DELIBERATELY NOT ──────────────────────────
 *
 * A topic is REQUIRED on a set that is created live, required again before an
 * unfiled set is SWITCHED ON, and an unknown topic is refused wherever it is
 * offered. But the ~40 sets that predate this field are UNFILED, not broken:
 * they list, read and play exactly as they did, and a rename of one still
 * saves. Nothing retro-refuses a set somebody is in the middle of using.
 *
 * A set created ALREADY SWITCHED OFF — an AI draft, a legacy archive restore —
 * may arrive unfiled, because it is servable to nobody and refusing it would
 * throw away a generation run nobody can repeat. SWITCHING IT ON is where the
 * requirement lands (section 4), and that is the only thing that makes the
 * exemption honest: a save is not the gate, because edit-question-set.js only
 * validates a save that mentions the topic and switching a set on mentions
 * nothing at all.
 *
 * // rejects: a topic off the shelf being stored; a live set created with no
 * //          shelf at all; an unfiled set being switched on; an existing
 * //          unfiled set being refused a rename, a deactivation or a play;
 * //          set tags leaking onto question rows; the two copies of the shelf
 * //          drifting apart.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const h = require('./helpers/archive-harness');

const REPO = path.join(__dirname, '..');
const T = require(path.join(REPO, 'lambda-functions/admin/shared/set-topics.js'));
const { setMetadataKey } = require(path.join(REPO, 'lambda-functions/admin/shared/set-version.js'));
const snap = require(path.join(REPO, 'lambda-functions/admin/shared/archive-snapshot.js'));
const upload = require(path.join(REPO, 'lambda-functions/admin/upload-questions.js')).handler;
const editSet = require(path.join(REPO, 'lambda-functions/admin/edit-question-set.js')).handler;
const toggle = require(path.join(REPO, 'lambda-functions/admin/toggle-question-set.js')).handler;
const listSets = require(path.join(REPO, 'lambda-functions/admin/get-question-sets.js')).handler;
const pickerSets = require(path.join(REPO, 'lambda-functions/game/get-question-sets.js')).handler;

// The importer is very chatty, so the runner below writes to stdout directly
// rather than through the console it silences.
if (!process.env.DEBUG) { console.log = () => {}; console.warn = () => {}; }
const say = (...a) => process.stdout.write(`${a.join(' ')}\n`);
let passed = 0; let failed = 0;
async function check(label, fn) {
  try { await fn(); passed += 1; say(`  ok   - ${label}`); }
  catch (e) { failed += 1; say(`  FAIL - ${label}\n         ${e.message}`); }
}
function finish() {
  say(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
const body = (res) => JSON.parse(res.body || '{}');

const CSV = 'Category,Title,Detail\nWarmups,First,One\nWarmups,Second,Two';
const CSV_WITH_QUESTION_TAGS = [
  'Category,Title,Detail,Tags',
  '"Warmups","First","One","icebreaker|SHORT"',
].join('\n');

const HOUSE = (setId) => ({ scope: 'platform', orgId: '', setId });
const metaOf = (setId) => {
  const k = setMetadataKey(HOUSE(setId));
  return h.get(k.PK, k.SK);
};

const create = (extra = {}) => upload(h.adminEvent({
  fileName: 'warm.csv', fileContent: CSV, customTitle: 'Warm Ups', ...extra,
}));

const save = (setId, patch) => editSet({
  ...h.adminEvent({ name: 'Warm Ups', ...patch }),
  pathParameters: { setId },
});

(async () => {
  say('\n1. the shelf itself');

  // rejects: a shelf that grew or shrank without anybody deciding to. Fifteen
  // is the list the owner was shown and accepted.
  await check('the shelf is the fifteen that were agreed', () => {
    assert.strictEqual(T.SET_TOPIC_IDS.length, 15, `the shelf has ${T.SET_TOPIC_IDS.length} entries`);
    const labels = T.SET_TOPIC_IDS.map((id) => T.SET_TOPICS[id].label);
    assert.deepStrictEqual(labels, [
      'Arts & Culture', 'Business & Work', 'Everyday Life', 'Film & TV',
      'Food & Drink', 'Geography & Travel', 'Health & Medicine', 'History',
      'Language & Literature', 'Music', 'Nature & Environment',
      'Politics & Society', 'Science & Technology', 'Sport & Games',
      'General Knowledge',
    ]);
  });

  // rejects: "General Knowledge" shipping with no word about what it is for,
  // which is how a catch-all becomes the shelf everything lands on.
  await check('General Knowledge says what it is for', () => {
    const blurb = T.SET_TOPICS['general-knowledge'].blurb;
    assert.ok(blurb && blurb.length > 20, 'the catch-all carries no blurb at all');
  });

  // rejects: normalizeSetTopic becoming a pass-through, which is what turns a
  // typo into a sixteenth shelf that no filter and no browse knows about.
  await check('a topic off the shelf is not a topic', () => {
    assert.strictEqual(T.normalizeSetTopic('astrology'), null);
    assert.strictEqual(T.normalizeSetTopic('Science and Technology'), null,
      'different words are a different shelf, however close they read');
    assert.strictEqual(T.normalizeSetTopic(''), null);
    assert.strictEqual(T.normalizeSetTopic(null), null);
  });

  // rejects: spelling being the thing that decides. A person types a label; a
  // stored row carries an id; both name the same shelf.
  await check('case and punctuation do not make a second shelf', () => {
    assert.strictEqual(T.normalizeSetTopic('Science & Technology'), 'science-technology');
    assert.strictEqual(T.normalizeSetTopic('science-technology'), 'science-technology');
    assert.strictEqual(T.normalizeSetTopic('  HISTORY '), 'history');
    assert.strictEqual(T.normalizeSetTopic('Film & TV'), 'film-tv');
  });

  // rejects: a set on two shelves. A book sits on one, and an array that
  // stringifies to a known id ( ['history'] -> 'history' ) must not sneak past.
  await check('exactly one topic — a list is not a topic', () => {
    assert.strictEqual(T.normalizeSetTopic(['history']), null);
    assert.strictEqual(T.normalizeSetTopic(['history', 'music']), null);
    assert.strictEqual(T.normalizeSetTopic({ id: 'history' }), null);
  });

  // rejects: a reader policing a row. A reader's job is to render a set; only
  // the writers refuse, because a refusal there can still tell somebody.
  await check('a reader resolves anything unrecognised to Unfiled', () => {
    assert.strictEqual(T.resolveSetTopic('history'), 'history');
    assert.strictEqual(T.resolveSetTopic('astrology'), T.UNFILED);
    assert.strictEqual(T.resolveSetTopic(undefined), T.UNFILED);
    assert.strictEqual(T.setTopicLabel(undefined), 'Unfiled');
    assert.strictEqual(T.setTopicLabel('history'), 'History');
  });

  // rejects: a refusal that leaves the person guessing. Both refusals name the
  // shelf, because the shelf is the whole answer to "what should I have said".
  await check('every refusal names the shelf', () => {
    const missing = T.setTopicRefusal('');
    const unknown = T.setTopicRefusal('astrology');
    assert.ok(missing, 'a blank topic was not refused');
    assert.ok(unknown, 'an unknown topic was not refused');
    for (const message of [missing, unknown]) {
      assert.ok(message.includes('Science & Technology'), `the refusal does not name the shelf: ${message}`);
      assert.ok(message.includes('General Knowledge'), `the refusal stops short of the last shelf: ${message}`);
    }
    assert.ok(unknown.includes('astrology'), 'the refusal does not repeat what was offered');
    assert.strictEqual(T.setTopicRefusal('History'), null, 'a real shelf was refused');
  });

  say('\n2. a set\'s own tags');

  // rejects: a second tag vocabulary. There is one in this repo already
  // (shared/tags.js) and it normalises on write precisely so that a filter on
  // "star" matches a stored "STAR"; a set's tags use it unchanged.
  await check('tags are trimmed, folded and de-duplicated', () => {
    assert.deepStrictEqual(T.normalizeSetTags(['  1980s ', 'Onboarding', 'ONBOARDING']),
      ['1980s', 'onboarding']);
    assert.deepStrictEqual(T.normalizeSetTags('remote work, Remote Work'), ['remote-work']);
    assert.deepStrictEqual(T.normalizeSetTags(['  ', '---']), [], 'junk normalises away rather than being stored');
    assert.deepStrictEqual(T.normalizeSetTags(null), []);
  });

  // rejects: a paste turning one set into a hundred-tag row. The cap is a
  // guard against an accident, not a design limit on what an author may say.
  await check('tags are capped', () => {
    const many = Array.from({ length: T.MAX_SET_TAGS + 5 }, (_, i) => `tag-${i}`);
    assert.strictEqual(T.normalizeSetTags(many).length, T.MAX_SET_TAGS);
  });

  say('\n3. creating a set');

  // rejects: a shelf that is offered and then silently dropped at import.
  await check('a topic and tags are stored on the set', async () => {
    h.reset();
    const res = await create({ topic: 'Science & Technology', tags: ['Space', 'space', ' rockets '] });
    assert.strictEqual(res.statusCode, 200, res.body);
    const meta = metaOf('warmups');
    assert.strictEqual(meta.topic, 'science-technology', 'the label was stored instead of the id');
    assert.deepStrictEqual(meta.tags, ['space', 'rockets']);
  });

  // rejects: the requirement being for public sets only. It is for every set a
  // person creates, which is what makes the filter worth having at all.
  await check('a live set created with no topic is refused, and the refusal names the shelf', async () => {
    h.reset();
    const res = await create({});
    assert.strictEqual(res.statusCode, 400, `the set was created unfiled: ${res.body}`);
    assert.ok(body(res).error.includes('General Knowledge'), body(res).error);
    assert.strictEqual(metaOf('warmups'), undefined, 'a refused create left a row behind');
  });

  // rejects: a typo becoming a sixteenth shelf by way of the importer.
  await check('a topic off the shelf is refused at import', async () => {
    h.reset();
    const res = await create({ topic: 'astrology' });
    assert.strictEqual(res.statusCode, 400, res.body);
    assert.ok(body(res).error.includes('astrology'), body(res).error);
  });

  // rejects: throwing away a generation run because nobody had filed it yet.
  // A draft arrives switched off and is servable to nobody; SWITCHING IT ON is
  // where the requirement lands, and section 4 is that gate. Saying "the
  // reviewer's save" here would be describing a gate that does not exist:
  // edit-question-set.js only validates a save that MENTIONS the topic, and
  // switching a draft on mentions nothing.
  await check('a set created already switched off may arrive unfiled', async () => {
    h.reset();
    const res = await create({ isAIGenerated: true });
    assert.strictEqual(res.statusCode, 200, `a generated draft was refused: ${res.body}`);
    const meta = metaOf('warmups');
    assert.strictEqual(meta.active, false);
    assert.strictEqual('topic' in meta, false, 'an unfiled set stores no topic at all');
  });

  // rejects: an unknown topic being waved through merely because the set is a
  // draft. Off the shelf is off the shelf wherever it is offered.
  await check('a draft is still refused a topic off the shelf', async () => {
    h.reset();
    const res = await create({ isAIGenerated: true, topic: 'astrology' });
    assert.strictEqual(res.statusCode, 400, res.body);
  });

  // rejects: requiring a shelf from a REPLACE, which would refuse every edit to
  // the ~40 sets that predate the field. That is the retro-refusal this design
  // rules out; edit-question-set.js is the route that files a set.
  await check('replacing the questions of an unfiled set is not refused', async () => {
    h.reset();
    h.seedSet({ setId: 'legacy', meta: { name: 'Legacy', engagementType: 'call-and-answer', createdBy: 'staff-1' } });
    const res = await upload(h.adminEvent({ fileName: 'more.csv', fileContent: CSV, replaceSetId: 'legacy' }));
    assert.strictEqual(res.statusCode, 200, `an unfiled set was refused new questions: ${res.body}`);
    assert.strictEqual('topic' in metaOf('legacy'), false, 'the replace invented a topic');
  });

  // rejects: a replace quietly re-filing a set. It rewrites none of the set's
  // prose today, by design, and the shelf travels with the prose.
  await check('a replace leaves the shelf exactly as it was', async () => {
    h.reset();
    h.seedSet({ setId: 'filed', meta: { name: 'Filed', topic: 'history', engagementType: 'call-and-answer', createdBy: 'staff-1' } });
    const res = await upload(h.adminEvent({
      fileName: 'more.csv', fileContent: CSV, replaceSetId: 'filed', topic: 'Music',
    }));
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(metaOf('filed').topic, 'history');
  });

  // rejects: a typo surviving on a route that happens not to store it. Off the
  // shelf is off the shelf wherever it is offered.
  await check('a replace is still refused a topic off the shelf', async () => {
    h.reset();
    h.seedSet({ setId: 'filed', meta: { name: 'Filed', topic: 'history', engagementType: 'call-and-answer', createdBy: 'staff-1' } });
    const res = await upload(h.adminEvent({
      fileName: 'more.csv', fileContent: CSV, replaceSetId: 'filed', topic: 'astrology',
    }));
    assert.strictEqual(res.statusCode, 400, res.body);
  });

  // rejects: `tags` on the set being wired to `Tags` on its questions. They are
  // different words about different things and nothing may carry one to the other.
  await check("a set's tags never reach its question rows", async () => {
    h.reset();
    const res = await upload(h.adminEvent({
      fileName: 'warm.csv', fileContent: CSV_WITH_QUESTION_TAGS, customTitle: 'Warm Ups',
      topic: 'everyday-life', tags: ['team-offsite'],
    }));
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.deepStrictEqual(metaOf('warmups').tags, ['team-offsite']);
    const questions = h.rows('SET#warmups').filter((r) => String(r.SK).startsWith('QUESTION#'));
    assert.strictEqual(questions.length, 1);
    assert.deepStrictEqual(questions[0].Tags, ['icebreaker', 'short'],
      "the question kept its own keywords and did not inherit the set's");
  });

  say('\n4. switching a set on');
  /*
    THE GATE THE DRAFT EXEMPTION LEANS ON. Section 3 lets a set arrive unfiled
    when it arrives switched OFF — an AI draft, a legacy archive restore —
    because it is servable to nobody and refusing it would throw away a run
    nobody can repeat. That exemption is only honest if something asks later,
    and toggle-question-set.js is the only route that flips a set's `active`,
    so this is the whole of "later".

    A TRANSITION, NEVER A STATE. It bites on off → on and nowhere else:
    deactivating an unfiled set is not refused, an already-live unfiled set is
    not refused, and listing, renaming and playing one are untouched. A legacy
    row carries no `active` attribute at all and reads as live, so the ~40 sets
    predating the shelf never reach this gate — which is what keeps it from
    being the retro-refusal the design rules out.
  */

  /** A draft of Engage's own, switched off, filed or not. */
  const draft = (meta = {}) => h.seedSet({
    setId: 'draft',
    meta: {
      name: 'Draft', engagementType: 'call-and-answer', createdBy: 'staff-1',
      active: false, ...meta,
    },
  });
  const setActive = (setId, active) => toggle({
    ...h.adminEvent({ active }),
    pathParameters: { setId },
  });

  // rejects: the draft exemption having no downstream gate at all, which is
  // how a generated set goes live unfiled and is never asked again.
  await check('an unfiled draft cannot be switched on, and the refusal names the shelf', async () => {
    h.reset();
    draft();
    const res = await setActive('draft', true);
    assert.strictEqual(res.statusCode, 400, `an unfiled set went live: ${res.body}`);
    assert.ok(body(res).error.includes('General Knowledge'), body(res).error);
    assert.strictEqual(metaOf('draft').active, false, 'the set was switched on anyway');
  });

  // rejects: the gate reading a stored shelf as absent — the control, so the
  // refusal above is the shelf being read and not activation broken outright.
  await check('a filed draft switches on', async () => {
    h.reset();
    draft({ topic: 'history' });
    const res = await setActive('draft', true);
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.strictEqual(metaOf('draft').active, true);
  });

  // rejects: a gate on the STATE rather than the transition, which would trap
  // an unfiled set in the on position and make it unhideable.
  await check('an unfiled set can still be switched off', async () => {
    h.reset();
    draft({ active: true });
    const res = await setActive('draft', false);
    assert.strictEqual(res.statusCode, 200, `an unfiled set could not be hidden: ${res.body}`);
    assert.strictEqual(metaOf('draft').active, false);
  });

  // rejects: the same, from the other side. Re-asserting `active: true` on a
  // set that is already serving makes nothing newly servable, so there is
  // nothing to ask about.
  await check('an already-live unfiled set is not refused', async () => {
    h.reset();
    draft({ active: true });
    const res = await setActive('draft', true);
    assert.strictEqual(res.statusCode, 200, res.body);
  });

  // rejects: the ~40 sets predating the shelf being caught by this gate. They
  // carry no `active` attribute at all and every reader treats that as live,
  // so switching one on is not a transition and must not be a wall.
  await check('a legacy set with no active attribute is not refused', async () => {
    h.reset();
    h.seedSet({ setId: 'legacy', meta: { name: 'Legacy', engagementType: 'call-and-answer', createdBy: 'staff-1' } });
    const res = await setActive('legacy', true);
    assert.strictEqual(res.statusCode, 200, `a legacy set was retro-refused: ${res.body}`);
  });

  say('\n5. saving a set');

  // rejects: the editor offering a shelf the save then drops.
  await check('a save files a set', async () => {
    h.reset();
    h.seedSet({ setId: 'legacy', meta: { name: 'Legacy', engagementType: 'call-and-answer', createdBy: 'staff-1' } });
    const res = await save('legacy', { topic: 'History', tags: ['1980s', '1980s'] });
    assert.strictEqual(res.statusCode, 200, res.body);
    const meta = metaOf('legacy');
    assert.strictEqual(meta.topic, 'history');
    assert.deepStrictEqual(meta.tags, ['1980s']);
  });

  // rejects: a save quietly emptying the shelf. Clearing is the one way a
  // filed set could become unfiled again, and D2 does not allow it.
  await check('a save may not blank the topic', async () => {
    h.reset();
    h.seedSet({ setId: 'filed', meta: { name: 'Filed', topic: 'history', createdBy: 'staff-1' } });
    const res = await save('filed', { topic: '' });
    assert.strictEqual(res.statusCode, 400, res.body);
    assert.ok(body(res).error.includes('General Knowledge'), body(res).error);
    assert.strictEqual(metaOf('filed').topic, 'history', 'the refused save changed the row anyway');
  });

  await check('a save is refused a topic off the shelf', async () => {
    h.reset();
    h.seedSet({ setId: 'filed', meta: { name: 'Filed', topic: 'history', createdBy: 'staff-1' } });
    const res = await save('filed', { topic: 'astrology' });
    assert.strictEqual(res.statusCode, 400, res.body);
  });

  // rejects: retro-refusing one of the ~40 sets that predate the shelf. A
  // rename of an unfiled set is somebody in the middle of using it.
  await check('an unfiled set can still be renamed', async () => {
    h.reset();
    h.seedSet({ setId: 'legacy', meta: { name: 'Legacy', engagementType: 'call-and-answer', createdBy: 'staff-1' } });
    const res = await editSet({
      ...h.adminEvent({ name: 'Legacy renamed' }),
      pathParameters: { setId: 'legacy' },
    });
    assert.strictEqual(res.statusCode, 200, `an unfiled set was refused a rename: ${res.body}`);
    assert.strictEqual(metaOf('legacy').name, 'Legacy renamed');
    assert.strictEqual('topic' in metaOf('legacy'), false, 'the rename invented a topic');
  });

  // rejects: `tags: []` being read as "leave them alone", which would make a
  // tag unremovable once written.
  await check('a save can clear the tags without touching the topic', async () => {
    h.reset();
    h.seedSet({ setId: 'filed', meta: { name: 'Filed', topic: 'history', tags: ['1980s'], createdBy: 'staff-1' } });
    const res = await save('filed', { tags: [] });
    assert.strictEqual(res.statusCode, 200, res.body);
    assert.deepStrictEqual(metaOf('filed').tags, []);
    assert.strictEqual(metaOf('filed').topic, 'history');
  });

  say('\n6. what the readers say');

  // rejects: the shelf being stored and then never reaching a screen. Raw, not
  // resolved: the editor has to tell "chose General Knowledge" from "never
  // asked", because its save payload is a diff.
  await check('the admin list projects the topic raw, and unfiled reads as empty', async () => {
    h.reset();
    h.seedSet({ setId: 'filed', meta: { name: 'Filed', topic: 'history', tags: ['1980s'] } });
    h.seedSet({ setId: 'legacy', meta: { name: 'Legacy' } });
    const res = await listSets(h.adminEvent());
    assert.strictEqual(res.statusCode, 200, res.body);
    const byId = Object.fromEntries(body(res).questionSets.map((s) => [s.id, s]));
    assert.strictEqual(byId.filed.topic, 'history');
    assert.deepStrictEqual(byId.filed.tags, ['1980s']);
    assert.strictEqual(byId.legacy.topic, '', 'an unfiled set must project an empty topic, not undefined');
    assert.deepStrictEqual(byId.legacy.tags, []);
  });

  // rejects: an unfiled set vanishing from the picker, which is the reading of
  // "required" that would stop forty sets being played.
  await check('an unfiled set still plays', async () => {
    h.reset();
    h.seedSet({
      setId: 'legacy',
      meta: { name: 'Legacy', active: true, engagementType: 'call-and-answer', questionCount: 1 },
      rows: [{ SK: 'CATEGORY#c001', Name: 'Warmups', QuestionCount: 1 }],
    });
    const res = await pickerSets(h.adminEvent());
    assert.strictEqual(res.statusCode, 200, res.body);
    const sets = body(res).questionSets || body(res).sets || [];
    const legacy = sets.find((s) => s.id === 'legacy');
    assert.ok(legacy, `the unfiled set is gone from the picker: ${res.body}`);
    assert.strictEqual(legacy.topic, '');
    assert.deepStrictEqual(legacy.tags, []);
  });

  say('\n7. the shelf travels');

  // rejects: a restore that carries a snapshot's shelf and leaves the live
  // set's own behind — and, the other way round, one that takes a live set OFF
  // its shelf because the snapshot predates the field. The second is the sharp
  // edge: the restore REMOVES any listed attribute the snapshot has no value
  // for, so these two have to be listed AND exempted from that half. The
  // behaviour is drilled against the real restore in tests/archive-restore.js.
  await check('an archive restore carries the topic and the tags, and can never strip them', () => {
    assert.ok(snap.SET_SETTINGS.includes('topic'), 'a restore would leave the topic behind');
    assert.ok(snap.SET_SETTINGS.includes('tags'), 'a restore would leave the tags behind');
    assert.deepStrictEqual(
      [...snap.SET_SETTINGS_NEVER_REMOVED].sort(),
      ['tags', 'topic'],
      'a pre-feature backup would unfile a live set',
    );
  });

  /*
    rejects: editing one copy of the shelf and not the other. The two are
    duplicated because lambda bundles are per-directory, not because either is
    the truth.

    BOTH DIRECTIONS, WHICH IS THE WHOLE POINT. This walked the LAMBDA's fifteen
    and asked whether each appeared in the frontend file, so it caught a shelf
    the picker had lost — and could not catch a shelf the picker had GAINED,
    which is the failure its own comment described: a sixteenth id in
    `config/setTopics.js` would be offered by every picker and refused by
    `upload-questions.js` and `edit-question-set.js` with "Unknown topic", and
    the suite would stay green through the whole of it. A one-way guard on a
    mirrored pair checks the half that is already safe.

    So the frontend's own entries are PARSED out of the file — not merely
    searched for — and the two lists are compared as lists. That also fixes a
    second softness: `front.includes(label)` passed on a substring, so a
    frontend that renamed History to "History & Myth" satisfied it, and a
    label read off a picker is what a person uses to choose.

    ORDER IS PART OF IT. Both modules say the order is the order a picker
    renders them in, alphabetical with the catch-all last, so two copies that
    hold the same fifteen in different orders have still drifted.

    Parsed with a regex rather than imported because the frontend copy is ESM
    and this suite is CommonJS. Safe here, and checked: every label and blurb
    in both files is a plain single-quoted literal with no apostrophe in it —
    the entry count assertion below is what fails loudly if that ever stops
    being true, rather than the parse silently skipping an entry.
  */
  await check('the lambda copy and the frontend copy have not drifted, in either direction', () => {
    const front = fs.readFileSync(path.join(REPO, 'src/src/config/setTopics.js'), 'utf8');
    const parsed = [...front.matchAll(
      /\n\s+id: '([a-z0-9-]+)',\n\s+label: '([^']*)',\n\s+blurb: '([^']*)',\n/g
    )].map(([, id, label, blurb]) => ({ id, label, blurb }));

    // A parse that quietly found fewer entries than the file declares would
    // turn every assertion below into a tautology over a short list.
    assert.strictEqual(
      parsed.length,
      (front.match(/\n\s+id: '[a-z0-9-]+',\n/g) || []).length,
      'the frontend copy has entries this test could not parse — check for an apostrophe in a label or blurb',
    );

    assert.deepStrictEqual(
      parsed.map((entry) => entry.id),
      T.SET_TOPIC_IDS,
      'the two copies hold different shelves, or hold them in different orders — a picker that '
        + 'offers one the writers refuse answers "Unknown topic" on save',
    );

    for (const entry of parsed) {
      const topic = T.SET_TOPICS[entry.id];
      assert.strictEqual(entry.label, topic.label, `the two copies disagree about ${entry.id}'s label`);
      assert.strictEqual(entry.blurb, topic.blurb, `the two copies disagree about ${entry.id}'s blurb`);
    }

    assert.ok(front.includes(`MAX_SET_TAGS = ${T.MAX_SET_TAGS}`), 'the two copies disagree about the tag cap');
    assert.ok(front.includes(`UNFILED_LABEL = '${T.UNFILED_LABEL}'`), 'the two copies disagree about what unfiled is called');
  });

  finish();
})();
