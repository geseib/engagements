/**
 * THE SURVEY CONTRACT, SERVER HALF — lambda-functions/admin/shared/survey-kinds.js
 *
 * docs/design/survey-redesign/IMPLEMENTATION-phase-0-1.md, "THE CONTRACT", is
 * binding word for word: two browser implementers are building the other half
 * (utils/questionRows.js's rowProblems / rowsToCsv, and csvPreflight.js) from
 * the same text at the same time. So this suite pins the TEXT — every
 * validation message, every default, every column name in order — rather than
 * merely "a message" or "some default". A reworded message here is a preflight
 * that says one thing and an importer that skips for another.
 *
 * rejects: a kind the contract does not name slipping through; a legacy
 * spelling (multiple_choice, text_entry, nps…) that the builder's old export
 * uses failing to map; a default drifting from the table; an irrelevant field
 * reaching the DynamoDB item; a cell that is not double-quoted, or a boolean
 * written as anything but "true"/"false"; the column order changing.
 */
const path = require('path');
const assert = require('assert');

const REPO = path.join(__dirname, '..');
const K = require(path.join(REPO, 'lambda-functions/admin/shared/survey-kinds.js'));

let pass = 0; let fail = 0;
function check(label, fn) {
  try { fn(); console.log(`  PASS  ${label}`); pass++; }
  catch (e) { console.log(`  FAIL  ${label}\n        ${e.message}`); fail++; }
}

/** A `get(column)` over a plain object of cells, the way the importer calls it. */
const cells = (obj) => (column) => (obj[column] ?? '');

/** The contract's header, copied from the plan, character for character. */
const CONTRACT_HEADER = 'Category,Question#,Title,Detail_lesson,School,CustomInstruction,Kind,Required,Options,AllowMultiple,MaxPicks,AllowOther,Shuffle,Scale,LowLabel,HighLabel,YesLabel,NoLabel,Unsure,FollowUpWhen,FollowUpPrompt,RankTop,TextLength,MaxLength,Placeholder,Themes';

console.log('\n1. the vocabulary');

check('KINDS are the five, in the Add-menu order', () =>
  assert.deepStrictEqual([...K.KINDS], ['rating', 'choice', 'yesno', 'rank', 'text']));
check('SURVEY_CATEGORY is "Survey"', () => assert.strictEqual(K.SURVEY_CATEGORY, 'Survey'));
check('SURVEY_CSV_COLUMNS are the twenty columns from Kind to Themes, in order', () => {
  assert.strictEqual(K.SURVEY_CSV_COLUMNS.length, 20);
  assert.strictEqual(
    ['Category', 'Question#', 'Title', 'Detail_lesson', 'School', 'CustomInstruction', ...K.SURVEY_CSV_COLUMNS].join(','),
    CONTRACT_HEADER);
});

console.log('\n2. kinds, and the legacy spellings accepted on import');

for (const kind of ['rating', 'choice', 'yesno', 'rank', 'text']) {
  check(`'${kind}' is itself`, () => assert.deepStrictEqual(K.normalizeKind(kind), { kind }));
}
for (const [legacy, kind] of [
  ['multiple_choice', 'choice'], ['text_entry', 'text'], ['yes_no', 'yesno'],
  ['yes-no', 'yesno'], ['yesno', 'yesno'], ['ranking', 'rank'],
]) {
  check(`'${legacy}' maps to '${kind}'`, () => assert.deepStrictEqual(K.normalizeKind(legacy), { kind }));
}
check("'nps' maps to a rating on the 0–10 scale", () =>
  assert.deepStrictEqual(K.normalizeKind('nps'), { kind: 'rating', scale: '0-10' }));
check('case and surrounding space do not matter', () => {
  assert.deepStrictEqual(K.normalizeKind('  Rating '), { kind: 'rating' });
  assert.deepStrictEqual(K.normalizeKind('Multiple_Choice'), { kind: 'choice' });
});
check("no kind → 'needs a kind'", () => {
  assert.deepStrictEqual(K.normalizeKind(''), { error: 'needs a kind' });
  assert.deepStrictEqual(K.normalizeKind(undefined), { error: 'needs a kind' });
});
check("an unknown kind is named, as typed → unknown kind '<x>'", () =>
  assert.deepStrictEqual(K.normalizeKind('Slider'), { error: "unknown kind 'Slider'" }));

console.log('\n3. every default in the table, and the empty value of everything else');

const EMPTIES = {
  required: false, options: [], allowMultiple: false, maxPicks: null, allowOther: false,
  shuffle: false, scale: '', lowLabel: '', highLabel: '', yesLabel: '', noLabel: '',
  unsure: false, followUpWhen: '', followUpPrompt: '', rankTop: null, textLength: '',
  maxLength: null, placeholder: '', themes: false,
};
const expectFull = (kind, overrides) => ({ ...EMPTIES, kind, ...overrides });

check('a bare rating: 1–5, no labels, not required', () =>
  assert.deepStrictEqual(K.surveyFieldsFromCells(cells({ Kind: 'rating' })),
    expectFull('rating', { scale: '1-5' })));
check('a bare choice: no options, one pick, no write-in, no shuffle', () =>
  assert.deepStrictEqual(K.surveyFieldsFromCells(cells({ Kind: 'choice' })), expectFull('choice', {})));
check('a bare yes/no: default labels, no Not sure, no follow-up', () =>
  assert.deepStrictEqual(K.surveyFieldsFromCells(cells({ Kind: 'yesno' })), expectFull('yesno', {})));
check('a bare ranking: no items, rank all (null)', () =>
  assert.deepStrictEqual(K.surveyFieldsFromCells(cells({ Kind: 'rank' })), expectFull('rank', {})));
check('a bare open answer: long, 500 characters, no placeholder, themes ON', () =>
  assert.deepStrictEqual(K.surveyFieldsFromCells(cells({ Kind: 'text' })),
    expectFull('text', { textLength: 'long', maxLength: 500, themes: true })));
check('a short open answer defaults to 280 characters', () =>
  assert.strictEqual(K.surveyFieldsFromCells(cells({ Kind: 'text', TextLength: 'short' })).maxLength, 280));
check("kind 'nps' reads as a 0–10 rating", () => {
  const f = K.surveyFieldsFromCells(cells({ Kind: 'nps', LowLabel: 'Not likely' }));
  assert.strictEqual(f.kind, 'rating');
  assert.strictEqual(f.scale, '0-10');
  assert.strictEqual(f.lowLabel, 'Not likely');
});
check('a field not relevant to the kind reads as its empty value even when a cell is filled', () => {
  const f = K.surveyFieldsFromCells(cells({ Kind: 'rating', Options: 'a|b', Themes: 'true', MaxLength: '300' }));
  assert.deepStrictEqual(f.options, []);
  assert.strictEqual(f.themes, false);
  assert.strictEqual(f.maxLength, null);
});
check('MaxPicks is only relevant when several may be picked', () => {
  assert.strictEqual(K.surveyFieldsFromCells(cells({ Kind: 'choice', Options: 'a|b|c', MaxPicks: '2' })).maxPicks, null);
  assert.strictEqual(K.surveyFieldsFromCells(cells({ Kind: 'choice', Options: 'a|b|c', AllowMultiple: 'true', MaxPicks: '2' })).maxPicks, 2);
});
check('FollowUpPrompt is only relevant when there is a follow-up', () => {
  assert.strictEqual(K.surveyFieldsFromCells(cells({ Kind: 'yesno', FollowUpPrompt: 'Why?' })).followUpPrompt, '');
  assert.strictEqual(K.surveyFieldsFromCells(cells({ Kind: 'yesno', FollowUpWhen: 'no', FollowUpPrompt: 'Why?' })).followUpPrompt, 'Why?');
});
check('Options split on | and blanks drop out', () =>
  assert.deepStrictEqual(K.surveyFieldsFromCells(cells({ Kind: 'choice', Options: ' A | B ||C|' })).options, ['A', 'B', 'C']));
check('booleans read "true"/"false" in any case (a spreadsheet writes TRUE)', () => {
  const f = K.surveyFieldsFromCells(cells({ Kind: 'choice', Required: 'TRUE', AllowOther: 'True', Shuffle: 'false' }));
  assert.strictEqual(f.required, true);
  assert.strictEqual(f.allowOther, true);
  assert.strictEqual(f.shuffle, false);
});
check('an explicit "false" turns themes off', () =>
  assert.strictEqual(K.surveyFieldsFromCells(cells({ Kind: 'text', Themes: 'false' })).themes, false));
check('enum cells fold case (Stars, Long, No)', () => {
  assert.strictEqual(K.surveyFieldsFromCells(cells({ Kind: 'rating', Scale: 'Stars' })).scale, 'stars');
  assert.strictEqual(K.surveyFieldsFromCells(cells({ Kind: 'text', TextLength: 'Long' })).textLength, 'long');
  assert.strictEqual(K.surveyFieldsFromCells(cells({ Kind: 'yesno', FollowUpWhen: 'No', FollowUpPrompt: 'Why?' })).followUpWhen, 'no');
});

console.log('\n4. validation — the contract\'s wording, exactly');

const problemsOf = (obj) => K.validateSurvey(K.surveyFieldsFromCells(cells(obj)));

check("no kind → 'needs a kind'", () => assert.deepStrictEqual(problemsOf({}), ['needs a kind']));
check("unknown kind → unknown kind '<x>'", () =>
  assert.deepStrictEqual(problemsOf({ Kind: 'slider' }), ["unknown kind 'slider'"]));
check('choice: one option → needs at least two options', () =>
  assert.deepStrictEqual(problemsOf({ Kind: 'choice', Options: 'only' }), ['needs at least two options']));
check('choice: nine options → has more than eight options', () =>
  assert.deepStrictEqual(problemsOf({ Kind: 'choice', Options: '1|2|3|4|5|6|7|8|9' }), ['has more than eight options']));
check('choice: eight options is fine', () =>
  assert.deepStrictEqual(problemsOf({ Kind: 'choice', Options: '1|2|3|4|5|6|7|8' }), []));
check("choice: maxPicks outside 2..options → can't allow <n> picks from <m> options", () => {
  assert.deepStrictEqual(problemsOf({ Kind: 'choice', Options: 'a|b|c', AllowMultiple: 'true', MaxPicks: '4' }),
    ["can't allow 4 picks from 3 options"]);
  assert.deepStrictEqual(problemsOf({ Kind: 'choice', Options: 'a|b|c', AllowMultiple: 'true', MaxPicks: '1' }),
    ["can't allow 1 picks from 3 options"]);
  assert.deepStrictEqual(problemsOf({ Kind: 'choice', Options: 'a|b|c', AllowMultiple: 'true', MaxPicks: '3' }), []);
});
check('rank: two items → needs at least three items', () =>
  assert.deepStrictEqual(problemsOf({ Kind: 'rank', Options: 'a|b' }), ['needs at least three items']));
check('rank: eight items → has more than seven items', () =>
  assert.deepStrictEqual(problemsOf({ Kind: 'rank', Options: '1|2|3|4|5|6|7|8' }), ['has more than seven items']));
check("rank: rankTop outside 1..items-1 → can't rank the top <n> of <m>", () => {
  assert.deepStrictEqual(problemsOf({ Kind: 'rank', Options: 'a|b|c|d', RankTop: '4' }), ["can't rank the top 4 of 4"]);
  assert.deepStrictEqual(problemsOf({ Kind: 'rank', Options: 'a|b|c|d', RankTop: '0' }), ["can't rank the top 0 of 4"]);
  assert.deepStrictEqual(problemsOf({ Kind: 'rank', Options: 'a|b|c|d', RankTop: '3' }), []);
});
check("rating: an unknown scale → unknown scale '<x>'", () =>
  assert.deepStrictEqual(problemsOf({ Kind: 'rating', Scale: '1-7' }), ["unknown scale '1-7'"]));
check('rating: all four scales pass', () => {
  for (const s of ['1-5', '1-10', '0-10', 'stars']) assert.deepStrictEqual(problemsOf({ Kind: 'rating', Scale: s }), [], s);
});
check("yesno: an unknown follow-up → unknown follow-up '<x>'", () =>
  assert.deepStrictEqual(problemsOf({ Kind: 'yesno', FollowUpWhen: 'maybe', FollowUpPrompt: 'Why?' }), ["unknown follow-up 'maybe'"]));
check('yesno: a follow-up with no question → needs the follow-up question', () =>
  assert.deepStrictEqual(problemsOf({ Kind: 'yesno', FollowUpWhen: 'any' }), ['needs the follow-up question']));
check("text: an unknown length → unknown length '<x>'", () =>
  assert.deepStrictEqual(problemsOf({ Kind: 'text', TextLength: 'medium' }), ["unknown length 'medium'"]));
check('text: a limit outside 20..2000 → answer limit must be 20–2000 characters', () => {
  assert.deepStrictEqual(problemsOf({ Kind: 'text', MaxLength: '19' }), ['answer limit must be 20–2000 characters']);
  assert.deepStrictEqual(problemsOf({ Kind: 'text', MaxLength: '2001' }), ['answer limit must be 20–2000 characters']);
  assert.deepStrictEqual(problemsOf({ Kind: 'text', MaxLength: 'lots' }), ['answer limit must be 20–2000 characters']);
  assert.deepStrictEqual(problemsOf({ Kind: 'text', MaxLength: '2000' }), []);
});
check('the dash in "20–2000" is an en dash, as the contract writes it', () =>
  assert.ok(problemsOf({ Kind: 'text', MaxLength: '1' })[0].includes('20–2000')));
check('several problems on one row are all reported, in contract order', () =>
  assert.deepStrictEqual(problemsOf({ Kind: 'choice', Options: 'a', AllowMultiple: 'true', MaxPicks: '2' }),
    ['needs at least two options', "can't allow 2 picks from 1 options"]));

console.log('\n5. the DynamoDB item carries only what is relevant');

const item = (obj) => K.itemFields(K.surveyFieldsFromCells(cells(obj)));

check('a rating item: kind, required, scale and its labels — nothing else', () =>
  assert.deepStrictEqual(item({ Kind: 'rating', Required: 'true', Scale: '0-10', LowLabel: 'Never', HighLabel: 'Always', Options: 'x|y' }),
    { kind: 'rating', required: true, scale: '0-10', lowLabel: 'Never', highLabel: 'Always' }));
check('a single-pick choice item has no maxPicks attribute at all', () =>
  assert.deepStrictEqual(item({ Kind: 'choice', Options: 'a|b' }),
    { kind: 'choice', required: false, options: ['a', 'b'], allowMultiple: false, allowOther: false, shuffle: false }));
check('a several-pick choice carries maxPicks when one was set', () =>
  assert.strictEqual(item({ Kind: 'choice', Options: 'a|b|c', AllowMultiple: 'true', MaxPicks: '2' }).maxPicks, 2));
check('…and stores nothing (not null) when none was', () =>
  assert.ok(!('maxPicks' in item({ Kind: 'choice', Options: 'a|b|c', AllowMultiple: 'true' }))));
check('a yes/no with no follow-up stores no followUpPrompt', () =>
  assert.deepStrictEqual(item({ Kind: 'yesno', Unsure: 'true' }),
    { kind: 'yesno', required: false, yesLabel: '', noLabel: '', unsure: true, followUpWhen: '' }));
check('a yes/no with a follow-up stores it', () =>
  assert.strictEqual(item({ Kind: 'yesno', FollowUpWhen: 'no', FollowUpPrompt: 'What would you change?' }).followUpPrompt,
    'What would you change?'));
check('a rank-all item stores no rankTop', () =>
  assert.deepStrictEqual(item({ Kind: 'rank', Options: 'a|b|c' }), { kind: 'rank', required: false, options: ['a', 'b', 'c'] }));
check('an open-answer item stores its four fields', () =>
  assert.deepStrictEqual(item({ Kind: 'text', TextLength: 'short', Placeholder: 'One line' }),
    { kind: 'text', required: false, textLength: 'short', maxLength: 280, placeholder: 'One line', themes: true }));

console.log('\n6. the twenty cells the exporter writes');

check('every cell is double-quoted; booleans are "true"/"false"; integers digits or ""', () => {
  const out = K.surveyCsvCells({
    kind: 'choice', required: true, options: ['One', 'Two "quoted"', 'Three'],
    allowMultiple: true, maxPicks: 2, allowOther: false, shuffle: true,
  });
  assert.strictEqual(out.length, 20);
  assert.deepStrictEqual(out, [
    '"choice"', '"true"', '"One|Two ""quoted""|Three"', '"true"', '"2"', '"false"', '"true"',
    '""', '""', '""', '""', '""', '"false"', '""', '""', '""', '""', '""', '""', '"false"',
  ]);
});
check('fields not relevant to the kind are blank / "false" even if something is stored', () => {
  const out = K.surveyCsvCells({ kind: 'text', textLength: 'long', maxLength: 500, placeholder: 'Say more', themes: true, scale: '1-10', options: ['stray'] });
  assert.deepStrictEqual(out, [
    '"text"', '"false"', '""', '"false"', '""', '"false"', '"false"', '""', '""', '""', '""', '""',
    '"false"', '""', '""', '""', '"long"', '"500"', '"Say more"', '"true"',
  ]);
});
check('maxPicks is blank when only one may be picked', () =>
  assert.strictEqual(K.surveyCsvCells({ kind: 'choice', options: ['a', 'b'], allowMultiple: false, maxPicks: 2 })[4], '""'));
check('rankTop blank when null (rank all), digits when set', () => {
  assert.strictEqual(K.surveyCsvCells({ kind: 'rank', options: ['a', 'b', 'c'] })[15], '""');
  assert.strictEqual(K.surveyCsvCells({ kind: 'rank', options: ['a', 'b', 'c'], rankTop: 2 })[15], '"2"');
});
check('tolerant of capitalised attributes', () => {
  const out = K.surveyCsvCells({ Kind: 'rating', Required: true, Scale: '1-10', LowLabel: 'Low', HighLabel: 'High' });
  assert.deepStrictEqual(out.slice(0, 2), ['"rating"', '"true"']);
  assert.deepStrictEqual(out.slice(7, 10), ['"1-10"', '"Low"', '"High"']);
});

console.log('\n7. a whole survey CSV from contract-shaped items');

const ITEMS = [
  { kind: 'rating', title: 'How useful was it?', detail: '', required: true, scale: '1-5', lowLabel: 'Not useful', highLabel: 'Very useful', tags: ['Feedback'] },
  { kind: 'text', title: 'Anything else?', required: false, tags: [] },
];
check('the header is the contract header, then ,Tags', () =>
  assert.strictEqual(K.itemsToSurveyCsv(ITEMS).split('\n')[0], `${CONTRACT_HEADER},Tags`));
check('rows are numbered 1..n under Survey, every cell quoted, Question# bare', () => {
  const lines = K.itemsToSurveyCsv(ITEMS).split('\n');
  assert.ok(lines[1].startsWith('"Survey",1,"How useful was it?","","","","rating","true",'), lines[1]);
  assert.ok(lines[2].startsWith('"Survey",2,"Anything else?","","","","text","false",'), lines[2]);
  assert.ok(lines[1].endsWith(',"feedback"'), `tags are normalised: ${lines[1]}`);
});
check('a text item with no themes attribute gets the default (true), not "false"', () => {
  const line = K.itemsToSurveyCsv([{ kind: 'text', title: 'Why?' }]).split('\n')[1];
  assert.ok(line.includes(',"long","500","","true",'), line);
});
check('the category can be given', () =>
  assert.ok(K.itemsToSurveyCsv(ITEMS, { category: 'Other' }).split('\n')[1].startsWith('"Other",1,')));

console.log('\n8. the survey builder\'s old JSON export');

const LEGACY = JSON.stringify({
  title: 'Sample Survey Template',
  description: 'The download-template JSON and the SurveyAIBuilder export share this shape',
  questions: [
    { id: 1, question: 'How satisfied are you?', type: 'rating', scale: { type: '1-10', lowLabel: 'Very Dissatisfied', highLabel: 'Very Satisfied' }, required: true },
    { id: 2, question: 'Which features do you use?', type: 'multiple_choice', options: ['A', 'B', 'C'], allowMultiple: true, required: true, tags: ['features'] },
    { id: 3, question: 'Your email?', type: 'text_entry', textType: 'email', placeholder: 'you@example.com', required: false },
    { id: 4, question: 'What would you improve?', type: 'text_entry', textType: 'long', required: false },
  ],
});

const legacyRows = () => {
  const lines = K.legacySurveyJsonToCsv(LEGACY).trim().split('\n');
  // The cells here contain no commas or quotes, so a naive split is exact.
  const header = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const values = line.split(',').map((v) => v.replace(/^"|"$/g, ''));
    return Object.fromEntries(header.map((h, i) => [h, values[i]]));
  });
};

check('it becomes the contract CSV', () =>
  assert.strictEqual(K.legacySurveyJsonToCsv(LEGACY).split('\n')[0], `${CONTRACT_HEADER},Tags`));
check("rating keeps its '1-10' scale and both labels", () => {
  const r = legacyRows()[0];
  assert.strictEqual(r.Kind, 'rating');
  assert.strictEqual(r.Scale, '1-10');
  assert.strictEqual(r.LowLabel, 'Very Dissatisfied');
  assert.strictEqual(r.HighLabel, 'Very Satisfied');
  assert.strictEqual(r.Required, 'true');
  assert.strictEqual(r.Category, 'Survey');
  assert.strictEqual(r.Title, 'How satisfied are you?');
});
check("'multiple_choice' becomes a choice with its options and several picks", () => {
  const r = legacyRows()[1];
  assert.strictEqual(r.Kind, 'choice');
  assert.strictEqual(r.Options, 'A|B|C');
  assert.strictEqual(r.AllowMultiple, 'true');
  assert.strictEqual(r.Tags, 'features');
});
check("'text_entry' with textType 'email' becomes a SHORT open answer", () => {
  const r = legacyRows()[2];
  assert.strictEqual(r.Kind, 'text');
  assert.strictEqual(r.TextLength, 'short');
  assert.strictEqual(r.MaxLength, '280');
  assert.strictEqual(r.Placeholder, 'you@example.com');
});
check("'text_entry' with textType 'long' stays long", () =>
  assert.strictEqual(legacyRows()[3].TextLength, 'long'));
check('not JSON throws a readable message', () =>
  assert.throws(() => K.legacySurveyJsonToCsv('{ nope'), /not valid JSON/));
check('JSON without a questions list throws a readable message', () =>
  assert.throws(() => K.legacySurveyJsonToCsv('{"title":"x"}'), /questions/));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
