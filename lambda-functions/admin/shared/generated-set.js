/**
 * THE SET A GENERATION JOB LEAVES BEHIND.
 *
 * THE DEFECT THIS EXISTS FOR, in the owner's words: they ran the scenario
 * builder for a set called "World Leaders", were told *"Close — this keeps
 * running"*, left, came back, and there was no set. Nothing crashed. The panel
 * was telling the truth about the JOB and a lie about the OUTCOME: the worker
 * writes ITEMS into the job record, and the SET was only ever created
 * client-side, when a human returned and pressed "Load N into System"
 * (AIScenarioBuilder.handleLoadIntoSystem -> AdminPage -> POST
 * /admin/upload-questions). Leaving produced nothing.
 *
 * So the worker creates the set itself now, as a DRAFT, before the job goes
 * terminal. Leaving genuinely produces something.
 *
 * ── FIVE THINGS THIS MODULE IS CAREFUL ABOUT ──────────────────────────────
 *
 * 1. IT DOES NOT FORK THE IMPORTER. `upload-questions.js` is invoked in
 *    process, with a synthetic event, and it does all the parsing, all the
 *    validation, the ownership stamp, the AI-inactive rule and the rollback.
 *    A second writer of that CSV would be a second chance to reintroduce the
 *    silent-data-loss defect tests/question-set-roundtrip.js exists for. Only
 *    the CSV is built here, through shared/csv.js, which is the byte-equivalent
 *    of the writer the browser uses.
 *
 * 2. THE SET IS A DRAFT, and nothing here decides that. `isAIGenerated: true`
 *    is passed and upload-questions.js:702 does the rest —
 *    `active: isAIGenerated ? false : true` on the set and :800 on every
 *    question row. An inactive AI-flagged set lands in QuestionSetEditor's
 *    "AI-Generated Content - Review Required" banner, which already tells the
 *    person to review it and then switch it on. That is the intended landing;
 *    do not add a second inactivity rule here.
 *
 * 3. IT IS OWNED BY THE PERSON WHO ASKED, NOT BY THE LAMBDA ROLE. The worker
 *    is invoked with `InvocationType: 'Event'` and carries NO authorizer
 *    context, so identity has to have been captured at POST time and carried.
 *    It rides on the JOB RECORD (`callerUserId` / `callerUsername`) and is
 *    replayed into the synthetic event at
 *    `requestContext.authorizer.lambda`, which is the shape this API's custom
 *    Lambda authorizer really produces — see require-admin.js's header — so
 *    upload-questions.js's own `ownerStamp(event)` writes `createdBy`.
 *    Without it the set would be unowned, and question-set-access.js reads an
 *    unowned set as admins-only house content: the host who asked for it could
 *    not edit it.
 *
 * 4. IT CANNOT MINT TWO SETS. A Lambda `Event` invoke is retried by the
 *    platform on failure, and a duplicate dispatch is always possible, so
 *    creation is CLAIMED first with a conditional update on the job row
 *    (`attribute_not_exists(setCreationClaimedAt)`). Losing that race means
 *    doing nothing at all. The importer's own refusal to overwrite an existing
 *    `SET#<slug>` is the second line of defence, not the first.
 *
 * 5. IT NEVER FAILS THE JOB. Everything below is wrapped: a set that could not
 *    be created is recorded on the job as `setCreationError` and the client
 *    falls back to loading the items by hand, which is exactly what it did
 *    before this existed. Generation succeeding and set creation failing is a
 *    partial success, and reporting it as a failed generation would throw away
 *    the items.
 *
 * ── WHY OPT-IN PER HANDLER ────────────────────────────────────────────────
 *
 * `makeGenerationHandler` is shared by six handlers and only THREE of them
 * generate a whole set. `ai-generate-questions` adds ONE question to a set that
 * already exists and `ai-draft-set-metadata` writes four metadata fields;
 * either of them minting a set would be a new defect, not a feature. So the
 * capability is a config key a handler must supply — absent means structurally
 * incapable, not merely switched off. `ai-generate-survey` is also absent, and
 * deliberately: survey is not a playable type and upload-questions.js rejects
 * it outright (SurveyAIBuilder exports JSON instead of loading).
 */

const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { jobKey } = require('./generation-jobs');
const { csvRow, buildCsv, optionsToCsvCell, allowMultipleToCsvCell, tagsToCsvCell } = require('./csv');
const { normalizeRoundKind } = require('./round-kinds');

/** How long a set title may be before the slug stops being a slug. */
const MAX_TITLE = 200;

/**
 * The set-level copy, as the BUILDER computed it.
 *
 * Sent on the generate request as `setMetadata` rather than re-derived here,
 * and that is the whole point: the browser holds things this Lambda never sees
 * — the operator's own participant instruction for a `custom` round kind, the
 * chosen topic card's title, the STAR addendum — and a server-side second
 * implementation of `generateCustomInstructions()` would drift from the
 * client's on the first change to either. One author, two consumers.
 */
function readSetMetadata(payload) {
  const meta = payload && typeof payload.setMetadata === 'object' && payload.setMetadata
    ? payload.setMetadata
    : {};
  const str = (value) => String(value ?? '').trim();
  return {
    title: str(meta.title || payload?.customTitle).slice(0, MAX_TITLE),
    description: str(meta.description),
    customInstructions: str(meta.customInstructions),
    aiContextInstructions: str(meta.aiContextInstructions),
  };
}

/**
 * Claim the right to create this job's set. Returns true exactly once per job.
 *
 * A conditional update, not a read-then-write: two concurrent invocations of
 * the same job would both read "no set yet" and both create one. The condition
 * is evaluated by DynamoDB, so the loser is told it lost.
 *
 * A worker that claims and then dies leaves a job with no set and no second
 * attempt. That is the deliberate direction to fail in — the client's manual
 * "Load into System" is still there — because a duplicate set is silent and a
 * missing one is visible.
 */
async function claimSetCreation(dynamodb, tableName, jobId) {
  try {
    await dynamodb.send(new UpdateCommand({
      TableName: tableName,
      Key: jobKey(jobId),
      UpdateExpression: 'SET setCreationClaimedAt = :now',
      ConditionExpression: 'attribute_not_exists(setCreationClaimedAt)',
      ExpressionAttributeValues: { ':now': new Date().toISOString() },
    }));
    return true;
  } catch (error) {
    if (error?.name === 'ConditionalCheckFailedException') {
      console.log(`↩︎ Job ${jobId} already claimed set creation; this invocation creates nothing`);
      return false;
    }
    throw error;
  }
}

/** Record the set on the job, so the client can point at it instead of making one. */
async function recordCreatedSet(dynamodb, tableName, jobId, { setId, setName }) {
  await dynamodb.send(new UpdateCommand({
    TableName: tableName,
    Key: jobKey(jobId),
    UpdateExpression: 'SET createdSetId = :id, createdSetName = :name',
    ExpressionAttributeValues: { ':id': setId, ':name': setName },
  }));
}

/** Record why there is no set, so the client can offer the manual path honestly. */
async function recordSetCreationError(dynamodb, tableName, jobId, message) {
  await dynamodb.send(new UpdateCommand({
    TableName: tableName,
    Key: jobKey(jobId),
    UpdateExpression: 'SET setCreationError = :error',
    ExpressionAttributeValues: { ':error': String(message || 'The set could not be created.') },
  }));
}

/**
 * The synthetic event `upload-questions.js` is invoked with.
 *
 * `requestContext.authorizer.lambda` is not a guess and not a JWT: this API's
 * `CognitoAuthorizer` is a CUSTOM LAMBDA authorizer despite the name (payload
 * 2.0, simple responses), and its context reaches a handler at exactly this
 * path as `{ userId, username, email, groups, status, role }`. Read
 * require-admin.js's header before changing this shape — eighteen tests once
 * passed against `.jwt.claims`, which this API has never produced.
 *
 * GROUPS ARE DELIBERATELY ABSENT. The create branch of upload-questions.js
 * needs no group: it refuses to write over any set that already exists, so it
 * can only ever add a new row, and `requireSetManager` guards the replace
 * branch alone. Handing the worker a fabricated 'admins' would be inventing an
 * authority the caller may not have.
 *
 * THE ORGANISATION IS NOT ABSENT, AND MUST NOT BE. `createSetRef` reads
 * no-groups-AND-no-org as an internal invocation and sends it to the platform
 * library — correct for the seed scripts and the archive importer, and a
 * tenancy leak here: it put every customer's generated set into the shared
 * library that every other customer reads, badged "Engage" and unmanageable by
 * the person who asked for it.
 *
 * An org WITH no role is worse than neither, so both travel or neither does:
 * tenant.canManageScope requires a role of at least `member`, so an orgId alone
 * resolves to no writable scope at all and the importer refuses the set — a set
 * that vanishes instead of a set in the wrong place.
 *
 * Both are read off the JOB ROW, like the identity above and for the same
 * reason: the worker's invocation path has no authorizer, so anything not
 * captured by the authorised POST is gone.
 */
function syntheticUploadEvent({ caller, body }) {
  const lambdaContext = {};
  if (caller?.userId) lambdaContext.userId = caller.userId;
  if (caller?.username) lambdaContext.username = caller.username;
  if (caller?.orgId && caller?.orgRole) {
    lambdaContext.orgId = caller.orgId;
    lambdaContext.orgRole = caller.orgRole;
    // `orgIds` is what membership checks read; the acting org is by definition
    // one the caller belongs to, and the authorizer comma-joins this field.
    lambdaContext.orgIds = caller.orgId;
  }
  return {
    requestContext: { authorizer: { lambda: lambdaContext } },
    body: JSON.stringify(body),
  };
}

/**
 * Create the draft set for a finished (or partly finished) generation job.
 *
 * Returns `{ setId, setName }` when a set was created, and `null` in every
 * other case — no spec, no items, no title, already claimed, or refused by the
 * importer. It NEVER throws: see note 5 in the header.
 *
 * @param {object}   args.spec      the handler's opt-in. `{ engagementType, toCsv }`,
 *                                  optionally `roundKindFrom(payload)`.
 * @param {object[]} args.items     what the worker actually produced. A partial
 *                                  run still makes a set — see the call site.
 * @param {object}   args.caller    `{ userId, username, orgId, orgRole }` read
 *                                  off the job row.
 */
async function createSetForJob({
  dynamodb, tableName, jobId, spec, payload, items, caller,
}) {
  if (!spec || typeof spec.toCsv !== 'function') return null;
  if (!Array.isArray(items) || items.length === 0) return null;

  try {
    const metadata = readSetMetadata(payload);
    if (!metadata.title) {
      await recordSetCreationError(dynamodb, tableName, jobId,
        'No title was given for the set, so nothing could be created automatically. '
        + 'Review these and load them by hand.');
      return null;
    }

    if (!(await claimSetCreation(dynamodb, tableName, jobId))) return null;

    const engagementType = typeof spec.engagementType === 'function'
      ? spec.engagementType(payload)
      : spec.engagementType;

    // THE DIRECTION HAS TO TRAVEL. A round kind that steers the generation and
    // is then dropped at the moment the set is created leaves the library, the
    // editor and every later regeneration believing the set was Produce —
    // exactly what AIScenarioBuilder's own comment warns about on the client
    // path. `null` from normalizeRoundKind means "not one of the five"; it is
    // omitted rather than guessed, because upload-questions.js 400s on an
    // unknown kind and a failed create is worse than an absent direction.
    const direction = typeof spec.roundKindFrom === 'function' ? spec.roundKindFrom(payload) : {};
    const roundKind = normalizeRoundKind(direction?.roundKind);
    const roundKindBrief = String(direction?.roundKindBrief ?? '').trim();

    const body = {
      fileName: `${metadata.title.replace(/[^a-zA-Z0-9]/g, '_')}-${Date.now()}.csv`,
      fileContent: spec.toCsv(items, payload),
      customTitle: metadata.title,
      customDescription: metadata.description,
      customInstructions: metadata.customInstructions,
      aiContextInstructions: metadata.aiContextInstructions,
      engagementType,
      ...(roundKind ? { roundKind } : {}),
      ...(roundKindBrief ? { roundKindBrief } : {}),
      // The one flag that makes this a DRAFT. upload-questions.js turns it into
      // `active: false` on the set and on every question row.
      isAIGenerated: true,
    };

    // Required late so a handler that never creates a set never loads the
    // importer or its DynamoDB client. Same bundle — every admin function is
    // built from `CodeUri: lambda-functions/admin/`.
    // eslint-disable-next-line global-require
    const { handler: uploadQuestions } = require('../upload-questions');
    const response = await uploadQuestions(syntheticUploadEvent({ caller, body }));

    let parsed = {};
    try { parsed = JSON.parse(response?.body || '{}'); } catch (e) { parsed = {}; }

    if (response?.statusCode !== 200) {
      const why = parsed.error || `The importer returned ${response?.statusCode}.`;
      console.error(`❌ Job ${jobId} could not create its set: ${why}`);
      await recordSetCreationError(dynamodb, tableName, jobId, why);
      return null;
    }

    const created = { setId: parsed.setId, setName: parsed.setName || metadata.title };
    await recordCreatedSet(dynamodb, tableName, jobId, created);
    console.log(`✅ Job ${jobId} created draft set "${created.setName}" (${created.setId})`);
    return created;
  } catch (error) {
    console.error(`❌ Job ${jobId} set creation threw:`, error);
    try {
      await recordSetCreationError(dynamodb, tableName, jobId,
        `The set could not be created: ${error.message}`);
    } catch (e) {
      console.error(`❌ Job ${jobId} could not even record the failure:`, e);
    }
    return null;
  }
}

// ---------------------------------------------------------------- CSV shapes
//
// One builder per whole-set generator, each the byte-equivalent of the writer
// the browser uses on the manual "Load into System" path — AdminPage.jsx's
// generateScenariosCSV / generateTriviaCSV / generatePollCSV. They have to
// agree: the manual path is still the fallback when creation could not happen,
// and two shapes for one set would be two sets that differ by which path made
// them.

/** Group by category, preserving first-seen category order, like the client. */
function byCategory(items, fallbackCategory) {
  const groups = {};
  for (const item of items) {
    const category = item.category || fallbackCategory;
    if (!groups[category]) groups[category] = [];
    groups[category].push(item);
  }
  return groups;
}

/** call-and-answer / wavelength. Mirrors AdminPage.generateScenariosCSV. */
function scenariosToCsv(items) {
  const headers = 'Category,Question#,Title,Detail_lesson,School,CustomInstruction,Tags';
  const groups = byCategory(items, 'AI Generated');
  const rows = [];
  for (const category of Object.keys(groups)) {
    groups[category].forEach((scenario, index) => {
      rows.push(csvRow([
        category,
        index + 1,
        scenario.title,
        scenario.detail,
        scenario.school || 'Professional Development',
        scenario.customInstructions || '',
        tagsToCsvCell(scenario.tags),
      ]));
    });
  }
  return buildCsv(headers, rows);
}

/** trivia. Mirrors AdminPage.generateTriviaCSV. */
function triviaToCsv(items) {
  const headers = 'Category,Question#,Title,QuestionDetail,AnswerDetails,School,'
    + 'OptionA,OptionB,OptionC,OptionD,OptionE,OptionF,CorrectAnswer,Difficulty,Tags';
  const groups = byCategory(items, 'General');
  const rows = [];
  for (const category of Object.keys(groups)) {
    groups[category].forEach((trivia, index) => {
      // A multi-answer question keeps every id, comma-joined, exactly as the
      // client emits it. Joining is the client's shape and the importer stores
      // the cell verbatim, so changing it here would change what plays.
      const correctAnswer = Array.isArray(trivia.correctAnswer)
        ? trivia.correctAnswer.join(',')
        : trivia.correctAnswer;
      rows.push(csvRow([
        category,
        index + 1,
        trivia.title,
        trivia.questionDetail || trivia.detail || '',
        trivia.answerDetails || '',
        trivia.school || 'General',
        trivia.optionA || '',
        trivia.optionB || '',
        trivia.optionC || '',
        trivia.optionD || '',
        trivia.optionE || '',
        trivia.optionF || '',
        correctAnswer,
        trivia.difficulty,
        tagsToCsvCell(trivia.tags),
      ]));
    });
  }
  return buildCsv(headers, rows);
}

/** poll. Mirrors AdminPage.generatePollCSV — ONE pipe-separated `Options`. */
function pollsToCsv(items) {
  const headers = 'Category,Question#,Title,Detail_lesson,School,CustomInstruction,'
    + 'Options,AllowMultiple,Tags';
  const groups = byCategory(items, 'General');
  const rows = [];
  for (const category of Object.keys(groups)) {
    groups[category].forEach((poll, index) => {
      rows.push(csvRow([
        category,
        index + 1,
        poll.title,
        poll.detail || '',
        poll.school || 'General',
        poll.customInstructions || '',
        optionsToCsvCell(poll.options),
        allowMultipleToCsvCell(poll.allowMultiple),
        tagsToCsvCell(poll.tags),
      ]));
    });
  }
  return buildCsv(headers, rows);
}

module.exports = {
  createSetForJob,
  claimSetCreation,
  readSetMetadata,
  syntheticUploadEvent,
  scenariosToCsv,
  triviaToCsv,
  pollsToCsv,
};
