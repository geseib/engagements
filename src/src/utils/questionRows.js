/**
 * THE EDITOR'S WORKING COPY — one question, as a row.
 *
 * ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 *
 * There is no per-question write API and there must not be one (the plan's §0:
 * it would be a second writer racing the version system, and versions exist so
 * that a game already in progress keeps reading the rows it started on). The
 * only writer of question rows is `POST /admin/upload-questions`, which takes a
 * whole CSV and writes one new version.
 *
 * So editing a question is: read the set's questions, mutate an array in the
 * browser, and post the array back AS A CSV. This module is that array's
 * vocabulary and its serialiser.
 *
 * ── COMMONJS, DELIBERATELY ─────────────────────────────────────────────────
 *
 * Every other util in src/ is ESM. This one is `module.exports` so that
 * `tests/question-set-roundtrip.js` — which runs the REAL lambda handlers in
 * process — can require the very serialiser the browser ships, instead of a
 * second copy that agrees with it on the day it is written and drifts after.
 * `utils/adminEnvironment.js` and `config/templateVariables.js` are already CJS
 * for the same reason and are imported from JSX with a plain `import`.
 *
 * The round-kind vocabulary is duplicated instead (config/roundKinds.js has an
 * ESM mirror of the lambda module) because a lambda bundle cannot reach into
 * src/. Nothing here needs to run inside a bundle, so nothing here is copied.
 *
 * ── THE CONTRACT THIS FILE MUST NOT BREAK ──────────────────────────────────
 *
 * `rowsToCsv` emits **exactly what `download-question-set.js` emits** for the
 * same questions — same columns, same order, same conditional columns, same
 * quoting. Not "compatible with": identical, asserted byte for byte in
 * tests/question-set-roundtrip.js.
 *
 * That is not tidiness. `upload-questions.js`'s `getColumnIndex` is an exact
 * case-insensitive match with a fallback block covering nine columns and NO
 * option column of any kind, so a header this file invents is not "mostly
 * right", it is silently dropped — every option, every reveal, gone, with a 200
 * and a cheerful success message. That defect was live in the exporter until
 * Slice 1 and the round-trip suite exists because of it. A second writer of the
 * same CSV is a second chance to reintroduce it, so the second writer is held
 * to byte equality with the first.
 *
 * ── PROVENANCE, NEVER IDENTITY ─────────────────────────────────────────────
 *
 * A question copied out of another set becomes an independent row (decision 2).
 * `SourceSetId` / `SourceQuestionSk` record where it came from and are read by
 * NOTHING: no permission decision, no propagation, no lookup. They are stamped
 * write-once — a row that already carries an origin keeps it, because the older
 * stamp is the truer one.
 */

/* --------------------------------------------------------------- reading --- */

/** Read either spelling of an attribute. The table holds both. */
const pick = (item, ...names) => {
  for (const name of names) {
    const value = item ? item[name] : undefined;
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
};

const text = (value) => String(value ?? '').trim();

/** Tags arrive as an array from DynamoDB and as a pipe string from a CSV. */
function toTagList(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  const raw = text(value);
  if (!raw) return [];
  return raw.split(/[|,]/).map(text).filter(Boolean);
}

let uidCounter = 0;
/** Stable local key for React. Never written anywhere and never sent. */
const nextUid = () => `row-${(uidCounter += 1)}`;

/**
 * One question from `GET /question-sets/{setId}/questions` as an editable row.
 *
 * That endpoint maps some attributes to camelCase and passes the rest through
 * untouched, so both spellings have to be accepted for every field — reading
 * only one of them is how the exporter came to emit an empty Options column for
 * every poll set in the product.
 */
function toRow(question, extra = {}) {
  const q = question || {};
  return {
    uid: nextUid(),
    // Where this row came from, for the change summary and the row badges.
    origin: 'loaded',
    // A deletion the owner has not saved yet. Kept as a tombstone rather than
    // spliced out so it can be restored before Save — see the header of the
    // Questions panel in QuestionSetEditor.jsx.
    removed: false,
    edited: false,
    // The stored sort key suffix (`c001#001`), which is the set's real order.
    // `sortOrder` is read by the questions endpoint and written by nothing, so
    // sorting on it lists every set alphabetically instead of in set order.
    sk: text(pick(q, 'id', 'sk', 'SK')),
    category: text(pick(q, 'Category', 'category')),
    questionNumber: Number(pick(q, 'QuestionNumber', 'questionNumber')) || null,
    title: text(pick(q, 'Title', 'title')),
    detail: text(pick(q, 'Detail', 'questionDetail', 'detail', 'QuestionDetail')),
    school: text(pick(q, 'School', 'school')),
    customInstruction: text(pick(q, 'CustomInstructions', 'customInstructions', 'CustomInstruction')),
    answerDetails: text(pick(q, 'AnswerDetails', 'answerDetails')),
    image: text(pick(q, 'Image', 'image')),
    roundKind: text(pick(q, 'RoundKind', 'roundKind')),
    sourceAttribution: text(pick(q, 'SourceAttribution', 'sourceAttribution')),
    sourceSetId: text(pick(q, 'SourceSetId', 'sourceSetId')),
    sourceQuestionSk: text(pick(q, 'SourceQuestionSk', 'sourceQuestionSk')),
    tags: toTagList(pick(q, 'Tags', 'tags')),
    optionA: text(pick(q, 'optionA', 'OptionA')),
    optionB: text(pick(q, 'optionB', 'OptionB')),
    optionC: text(pick(q, 'optionC', 'OptionC')),
    optionD: text(pick(q, 'optionD', 'OptionD')),
    optionE: text(pick(q, 'optionE', 'OptionE')),
    optionF: text(pick(q, 'optionF', 'OptionF')),
    correctAnswer: text(pick(q, 'correctAnswer', 'CorrectAnswer')),
    difficulty: text(pick(q, 'difficulty', 'Difficulty')),
    options: toTagList(pick(q, 'options', 'Options')),
    allowMultiple: pick(q, 'allowMultiple', 'AllowMultiple') === true
      || text(pick(q, 'allowMultiple', 'AllowMultiple')).toLowerCase() === 'true',
    ...extra,
  };
}

/**
 * The whole working copy, in SET ORDER.
 *
 * The questions endpoint sorts by `sortOrder` and then title, and no writer has
 * ever set `sortOrder` — so it comes back alphabetical. The stored key
 * (`c001#001`) IS the set's order: the importer numbers categories in
 * first-appearance order and questions category-relatively, and the exporter
 * emits the partition in key order. Sorting on it is what makes a load → save
 * with no edits produce the exporter's own bytes.
 */
function editableRows(payload) {
  const list = Array.isArray(payload)
    ? payload
    : (payload && Array.isArray(payload.questions) ? payload.questions : []);
  return list
    .map((q) => toRow(q))
    .sort((a, b) => a.sk.localeCompare(b.sk));
}

/** A brand-new, empty question. Category and Title are what make it importable. */
function blankRow(overrides = {}) {
  return toRow({}, { origin: 'new', ...overrides });
}

/**
 * A question copied OUT of another set.
 *
 * The copy is independent — new keys, no link, no propagation (decision 2). The
 * origin is stamped WRITE-ONCE: a row that already carries one keeps it, so a
 * question that travelled A → B → C still records A, which is the answer to
 * "where did this actually come from".
 *
 * The IMAGE is deliberately carried across as-is and it does not fully travel:
 * the importer re-keys a bare filename to `sets/<targetSetId>/<file>`, and the
 * artwork itself lives under the SOURCE set's prefix. An absolute URL survives;
 * a set-scoped key points at a file the target set does not have. The copy
 * dialog says so rather than silently producing a broken image.
 */
function copiedRow(question, sourceSetId, sourceQuestionSk) {
  const row = toRow(question, { origin: 'copied' });
  return {
    ...row,
    sourceSetId: row.sourceSetId || text(sourceSetId),
    sourceQuestionSk: row.sourceQuestionSk || text(sourceQuestionSk) || row.sk,
    // The row is new HERE. Its old key would collide with this set's numbering.
    sk: '',
    questionNumber: null,
  };
}

/* ----------------------------------------------------------- validation --- */

/**
 * What would stop this row importing.
 *
 * The importer SKIPS a row with no Category or no Title — quietly, counted in
 * `skippedRowCount` that nobody reads carefully — so a half-filled row is not a
 * validation error at the server, it is a silently missing question. Refuse it
 * here, before the Save, where the owner still has the text in front of them.
 */
function rowProblems(row, engagementType) {
  const problems = [];
  if (!text(row.category)) problems.push('needs a category');
  if (!text(row.title)) problems.push('needs a title');
  if (engagementType === 'trivia') {
    const filled = ['optionA', 'optionB', 'optionC', 'optionD', 'optionE', 'optionF']
      .filter((k) => text(row[k]));
    if (filled.length < 2) problems.push('needs at least two options');
    const correct = text(row.correctAnswer);
    if (!correct) problems.push('needs a correct answer');
    else if (!text(row[`option${correct.replace(/^option/i, '')}`])) {
      problems.push(`marks ${correct} correct, but that option is empty`);
    }
  }
  if (engagementType === 'poll' && (row.options || []).length < 2) {
    problems.push('needs at least two options');
  }
  return problems;
}

/** Every problem in the working copy, keyed by row, ignoring tombstones. */
function workingCopyProblems(rows, engagementType) {
  return rows
    .filter((r) => !r.removed)
    .map((r) => ({ uid: r.uid, title: r.title, problems: rowProblems(r, engagementType) }))
    .filter((r) => r.problems.length > 0);
}

/* -------------------------------------------------------------- changes --- */

/**
 * What is unsaved, counted.
 *
 * Reordering counts: the set's order is what the room plays, and a save that
 * only moved two rows is still a new version and must not look like a no-op.
 */
function summarizeRowChanges(rows, baselineOrder = []) {
  const live = rows.filter((r) => !r.removed);
  const added = live.filter((r) => r.origin === 'new').length;
  const copied = live.filter((r) => r.origin === 'copied').length;
  const edited = live.filter((r) => r.origin === 'loaded' && r.edited).length;
  const removed = rows.filter((r) => r.removed && r.origin === 'loaded').length;
  const loadedOrder = live.filter((r) => r.origin === 'loaded').map((r) => r.uid);
  const survivingBaseline = baselineOrder.filter((uid) => loadedOrder.includes(uid));
  const reordered = loadedOrder.some((uid, i) => survivingBaseline[i] !== uid);
  return {
    added, copied, edited, removed, reordered,
    total: added + copied + edited + removed + (reordered ? 1 : 0),
    questionCount: live.length,
  };
}

/** Plain-English list of the unsaved changes, for the dirty bar. */
function describeRowChanges(summary) {
  const parts = [];
  if (summary.added) parts.push(`${summary.added} added`);
  if (summary.copied) parts.push(`${summary.copied} copied in`);
  if (summary.edited) parts.push(`${summary.edited} edited`);
  if (summary.removed) parts.push(`${summary.removed} removed`);
  if (summary.reordered) parts.push('reordered');
  return parts.join(', ');
}

/**
 * `versions[].note` — the field that already exists on every version entry and
 * that nothing has ever written, so every row of the version list reads
 * identically and a rollback is a guess. Say what happened.
 */
function versionNote(summary) {
  const described = describeRowChanges(summary);
  return described ? `Edited in the console: ${described}.` : 'Saved from the console with no changes.';
}

/** Move a row within the working copy. Tombstones keep their place. */
function moveRow(rows, uid, delta) {
  const index = rows.findIndex((r) => r.uid === uid);
  if (index < 0) return rows;
  const target = index + delta;
  if (target < 0 || target >= rows.length) return rows;
  const next = [...rows];
  const [row] = next.splice(index, 1);
  next.splice(target, 0, row);
  return next;
}

/* ------------------------------------------------------------------ CSV --- */

const esc = (v) => String(v ?? '').replace(/"/g, '""');
const quoted = (v) => `"${esc(v)}"`;

/**
 * Serialise the working copy as the CSV `upload-questions.js` reads.
 *
 * MIRRORS `download-question-set.js` EXACTLY — same fixed columns per type,
 * same conditional columns in the same order, same quoting, same defaults.
 * tests/question-set-roundtrip.js asserts the two files are byte-identical for
 * an untouched set; if you change one, change the other and watch that test.
 */
function rowsToCsv(rows, engagementType, options = {}) {
  const live = (rows || []).filter((r) => !r.removed);

  const carries = (key) => live.some((r) => text(r[key]) !== '');
  const carriesAnswerDetails = carries('answerDetails');
  const carriesImages = carries('image');
  const carriesRoundKind = carries('roundKind');
  const carriesAttribution = carries('sourceAttribution');
  const carriesSourceSet = carries('sourceSetId');
  const carriesSourceSk = carries('sourceQuestionSk');

  const optionalHeader = (carriesAnswerDetails ? ',AnswerDetails' : '')
    + (carriesImages ? ',Image' : '')
    + (carriesRoundKind ? ',RoundKind' : '')
    + (carriesAttribution ? ',SourceAttribution' : '')
    + (carriesSourceSet ? ',SourceSetId' : '')
    + (carriesSourceSk ? ',SourceQuestionSk' : '');

  const optionalCells = (r) =>
    (carriesAnswerDetails ? `,${quoted(r.answerDetails)}` : '')
    + (carriesImages ? `,${quoted(r.image)}` : '')
    + (carriesRoundKind ? `,${quoted(r.roundKind)}` : '')
    + (carriesAttribution ? `,${quoted(r.sourceAttribution)}` : '')
    + (carriesSourceSet ? `,${quoted(r.sourceSetId)}` : '')
    + (carriesSourceSk ? `,${quoted(r.sourceQuestionSk)}` : '');

  // Category-relative numbering.
  //
  // A row already in this set KEEPS its stored number, because the exporter
  // emits the stored number and byte-identity with the exporter is this file's
  // contract. A row that is new here (added or copied in) has none and takes
  // the category counter.
  //
  // `renumber` is the one case where the stored number is actively wrong: the
  // owner has REORDERED the set, so the stored numbers now contradict the order
  // the rows are in. Nothing in the game reads this attribute — the row's sort
  // key is the order everything actually plays — but a "Question 3" sitting
  // first in its category is a lie on the screen it is printed on.
  const counters = {};
  const numberOf = (r) => {
    counters[r.category] = (counters[r.category] || 0) + 1;
    const keepStored = !options.renumber && r.origin === 'loaded' && r.questionNumber;
    return keepStored ? r.questionNumber : counters[r.category];
  };

  const tagsOf = (r) => (r.tags || []).join('|');
  const common = (r) => `${quoted(r.category)},${numberOf(r)},`
    + `${quoted(r.title)},${quoted(r.detail)},`
    + `${quoted(r.school)},${quoted(r.customInstruction)}`;

  let header;
  let body;

  if (engagementType === 'trivia') {
    header = 'Category,Question#,Title,QuestionDetail,School,CustomInstruction,'
      + 'OptionA,OptionB,OptionC,OptionD,OptionE,OptionF,CorrectAnswer,Difficulty'
      + optionalHeader + ',Tags';
    body = live.map((r) => common(r)
      + ['A', 'B', 'C', 'D', 'E', 'F'].map((l) => `,${quoted(r[`option${l}`])}`).join('')
      + `,${quoted(r.correctAnswer)}`
      + `,${quoted(r.difficulty || 'medium')}`
      + optionalCells(r)
      + `,"${tagsOf(r)}"`);
  } else if (engagementType === 'poll') {
    header = 'Category,Question#,Title,Detail_lesson,School,CustomInstruction,Options,AllowMultiple'
      + optionalHeader + ',Tags';
    body = live.map((r) => common(r)
      + `,${quoted((r.options || []).join('|'))},"${r.allowMultiple === true}"`
      + optionalCells(r)
      + `,"${tagsOf(r)}"`);
  } else {
    // call-and-answer, and wavelength rides it — a wavelength question row
    // carries no type-specific attribute at all.
    header = 'Category,Question#,Title,Detail_lesson,School,CustomInstruction'
      + optionalHeader + ',Tags';
    body = live.map((r) => common(r) + optionalCells(r) + `,"${tagsOf(r)}"`);
  }

  return [header, ...body].join('\n') + '\n';
}

module.exports = {
  toRow,
  editableRows,
  blankRow,
  copiedRow,
  rowProblems,
  workingCopyProblems,
  summarizeRowChanges,
  describeRowChanges,
  versionNote,
  moveRow,
  rowsToCsv,
  toTagList,
};
