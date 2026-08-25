const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, UpdateCommand, QueryCommand, PutCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');
const { resolveSetPartition } = require('./set-version');
const { normaliseQueue, queueDrop } = require('./queue-order');
const { callerMayDriveSession } = require('./tenant');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);
const apigateway = new ApiGatewayManagementApiClient({
  endpoint: process.env.WEBSOCKET_API_ENDPOINT
});

// Helper function to check if a bit is set in a bitmask
const isBitSet = (mask, position) => {
  const pos = position - 1; // Convert to 0-based index
  return mask[pos] === '1';
};

// Helper function to set a bit to 0 in a bitmask
const setBitToZero = (mask, position) => {
  const pos = position - 1; // Convert to 0-based index
  return mask.substring(0, pos) + '0' + mask.substring(pos + 1);
};

// Is this category switched ON by the host? The three eight-bit masks, read the
// way every other caller in this file reads them.
const isHostEnabled = (categoryState, position) => {
  if (position <= 8) return isBitSet(categoryState['HostMask1-8'], position);
  if (position <= 16) return isBitSet(categoryState['HostMask9-16'], position - 8);
  return isBitSet(categoryState['HostMask17-24'], position - 16);
};

/**
 * A category NAME to its id and 1-based position in the set.
 *
 * Position is the category's index in the set partition, which is what the
 * host masks and the counts arrays are keyed by. Extracted because the specific
 * branch and the queue drain need exactly the same answer, and two copies of
 * this loop is two chances to be off by one against the masks — the seam that
 * silently toggles the neighbouring category.
 */
const locateCategory = async (setPk, categoryName) => {
  const categoriesQuery = await db.send(new QueryCommand({
    TableName: process.env.TABLE_NAME,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: { ':pk': setPk, ':sk': 'CATEGORY#' }
  }));

  const allCategories = categoriesQuery.Items || [];
  for (let i = 0; i < allCategories.length; i++) {
    const category = allCategories[i];
    if ((category.Name || category.name) === categoryName) {
      return { categoryId: category.SK.replace('CATEGORY#', ''), categoryPosition: i + 1 };
    }
  }
  return null;
};

/**
 * Every question this game can no longer serve, by source id: the ones already
 * put on screen (QUESTION#nnn#REF rows) UNION the ones the host has DISABLED
 * for this session (the EXCLUDED row, written by question-exclusions.js).
 *
 * One set on purpose. The exclusions are honoured by the same mechanism the
 * asked-skip uses — everywhere this set flows (the queue drain, the cursor
 * walk, and up-next.js's twin of this function) a disabled question behaves
 * exactly like one the room has already seen, so the serve and the preview
 * cannot disagree about it.
 */
const askedSourceQuestionIds = async (gameId) => {
  const [res, excludedRes] = await Promise.all([
    db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': `GAME#${gameId}`, ':sk': 'QUESTION#' }
    })),
    db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'EXCLUDED' }
    })),
  ]);

  const asked = new Set();
  for (const item of res.Items || []) {
    // Only the #REF rows say "this was asked". The sibling ANSWER#/VOTE#/
    // RESULTS rows share the prefix and carry no SourceQuestionId.
    if (String(item.SK).endsWith('#REF') && item.SourceQuestionId) {
      asked.add(item.SourceQuestionId);
    }
  }
  for (const key of normaliseQueue(excludedRes.Item && excludedRes.Item.Keys)) {
    asked.add(`QUESTION#${key}`);
  }
  return asked;
};

/**
 * WALK THE CATEGORY'S CURSOR PAST ANYTHING THE ROOM HAS ALREADY SEEN.
 *
 * Reported: *"items you queue up and ask, dont seem to get removed from the
 * question pool and get asked again."* Exactly right, and the mechanism is a
 * seam between this file's two ways of choosing a question.
 *
 * The automatic path does not track WHICH questions were asked. It walks a
 * per-category cursor — `CATEGORY#<id>#ACTIVE`.ActiveIndex indexing into
 * `#ORDER`.QuestionOrder — and advances it by one each round. That is a
 * complete record only while every round comes from the cursor.
 *
 * A queued pick and an "Ask next" pick do NOT come from the cursor. They name a
 * question directly, and they deliberately leave ActiveIndex alone: the long
 * comment on `isSpecific` further down records what happened when they did not,
 * which was that one specific pick reset the cursor to 1 and zeroed the
 * category's AvailMask bit, costing a host the other 39 questions in a
 * 40-question category. So the cursor is untouched, correctly — and nothing
 * else remembered, which is the other half of the same fault. The cursor
 * eventually walks onto the very question the host queued and serves it again.
 *
 * The fix is to consult the record that already exists. `askedSourceQuestionIds`
 * reads the QUESTION#nnn#REF rows, which are written for EVERY round however it
 * was chosen, and the queue drain has been using it to discard spent entries
 * since the queue shipped. This is the same set, applied to the other path.
 *
 * RETURNS THE INDEX IT LANDED ON, not the one it started from. The caller
 * writes `activeIndex + 1` back to ActiveIndex, so returning the original would
 * re-walk the same run of asked questions every subsequent round — and the
 * cursor would never get past them.
 *
 * Both callers pass the same three things and there is exactly one rule, so
 * this is a function rather than a fourth copy of a loop: the two selection
 * paths below were already near-identical, and a rule enforced in one of two
 * near-identical blocks is a rule that holds half the time.
 */
const advancePastAsked = ({ questionOrder, activeIndex, questionCount, categoryId, asked }) => {
  let index = activeIndex;

  while (index < questionCount) {
    const questionNumber = (questionOrder && questionOrder.length > index)
      ? questionOrder[index]
      : index + 1;
    const questionId = `QUESTION#${categoryId}#${String(questionNumber).padStart(3, '0')}`;

    if (!asked.has(questionId)) {
      return { index, questionNumber, questionId };
    }

    console.log(`⏭️ ${questionId} was already asked — skipping it`);
    index += 1;
  }

  // Every remaining question in this category has been asked. Exhausted — the
  // same answer the cursor's own bounds check gives, and handled identically.
  return null;
};

const { pickIndex, seedFor } = require('./question-plan');

const QUEUE_DRAIN_ATTEMPTS = 3;

/**
 * SERVE THE HEAD OF THE HOST'S QUEUE, AND POP IT IN THE SAME BREATH.
 *
 * The owner's request: *"queue up multiple questions but they are not triggered
 * until the end of the round is selected by the host"*. This is the trigger.
 * `question-queue.js` is the only thing that BUILDS the list; this is the only
 * thing that consumes it.
 *
 * THE POP HAPPENS BEFORE THE QUESTION IS SERVED, conditional on the version the
 * list was just read at. If the write loses to a host editing the queue at the
 * same moment, nothing is served from it on that attempt — the alternative is
 * asking a question that the other surface has just removed, and then failing
 * to remove it because it is already gone. Serving is the irreversible half, so
 * the reversible half goes first.
 *
 * THE WAYS A QUEUED QUESTION CAN BE UNSERVABLE, and they do NOT get the
 * same treatment, because only one of them is spent:
 *
 *   ALREADY ASKED (a `QUESTION#<nnn>#REF` row names it), OR DISABLED by the
 *   host (the EXCLUDED row) — DROPPED. Neither can ever be served, so leaving
 *   either in the list means the host watches a row that will silently be
 *   skipped forever.
 *
 *   NOT IN THE SET, OR IN NO CATEGORY — SKIPPED AND LEFT. A set replaced
 *   underneath a session is recoverable by putting the set back; a queue
 *   quietly emptied by that replacement is not.
 *
 *   ITS CATEGORY BEING SWITCHED OFF IS NOT ONE OF THEM ANY MORE. The first
 *   version skipped-and-left those, and the owner overruled it: "it should
 *   not skip it. assume its a 1 off that the host wants to add from that
 *   category." Queueing a question is the host reaching PAST the category
 *   toggles by name — the toggles govern the automatic walk, and an explicit
 *   pick outranks them. The panel still labels the row "Category off" so the
 *   host can see it is a one-off; it is served like any other queued entry.
 *
 * EVERYTHING BLOCKED IS NOT THE END OF THE GAME. The caller falls through to
 * the ordinary automatic selection, which is exactly what would have happened
 * if the host had never queued anything. Ending the session because the queue
 * happened to be full of switched-off categories would be a queue that can
 * close a room down.
 *
 * @returns null                      nothing queued — caller proceeds as before
 *          { staleSet: true }        built against another version of the set
 *          { served: null, ... }     nothing servable; caller auto-selects
 *          { served: {...}, queue, version }
 */
const drainQueuedQuestion = async ({ gameId, setPk, resolvedSet, categoryState }) => {
  for (let attempt = 1; attempt <= QUEUE_DRAIN_ATTEMPTS; attempt++) {
    const queueRead = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'QUEUE' }
    }));

    const item = queueRead.Item;
    const queue = normaliseQueue(item && item.Queue);
    // No queue is the overwhelmingly common case and must cost nothing but this
    // one read: every session that has never used the feature comes through
    // here on every round.
    if (queue.length === 0) return null;

    /*
      A QUEUE BUILT AGAINST A DIFFERENT VERSION OF THE SET IS NOT A QUEUE.

      Question ids are per-version — `SET#<id>#v<n>` partitions hold their own
      QUESTION# rows — so after a replace the same key names a different
      question, or none at all. Serving from it would put an unrelated question
      on the projector under the host's chosen title. Refused wholesale rather
      than filtered item by item, because "some of your running order still
      works" is not a thing a facilitator can act on mid-session.
    */
    const builtFor = item.SetVersion === undefined ? null : item.SetVersion;
    const playing = resolvedSet.version === undefined ? null : resolvedSet.version;
    if (builtFor !== playing) {
      console.log(`⚠️ QUEUE: built for set version ${builtFor}, game is playing ${playing} — serving nothing from it`);
      return { staleSet: true };
    }

    const asked = await askedSourceQuestionIds(gameId);

    const spent = [];
    let candidate = null;

    for (const key of queue) {
      const sourceQuestionId = `QUESTION#${key}`;

      if (asked.has(sourceQuestionId)) {
        console.log(`🧹 QUEUE: ${key} has already been asked — dropping it`);
        spent.push(key);
        continue;
      }

      const questionRow = await db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: setPk, SK: sourceQuestionId }
      }));

      if (!questionRow.Item) {
        console.log(`⚠️ QUEUE: ${key} is not in ${setPk} — skipping, leaving it queued`);
        continue;
      }

      const categoryName = questionRow.Item.category || questionRow.Item.Category;
      if (!categoryName) {
        console.log(`⚠️ QUEUE: ${key} has no category — skipping, leaving it queued`);
        continue;
      }

      const located = await locateCategory(setPk, categoryName);
      if (!located) {
        console.log(`⚠️ QUEUE: category '${categoryName}' is not in ${setPk} — skipping, leaving it queued`);
        continue;
      }

      // A switched-off category does NOT block a queued entry — see the header.
      // The host named this question; the toggles govern only the automatic walk.
      if (!isHostEnabled(categoryState, located.categoryPosition)) {
        console.log(`ℹ️ QUEUE: ${key} is a one-off from switched-off category '${categoryName}' — serving it anyway`);
      }

      candidate = { questionKey: key, questionId: sourceQuestionId, ...located };
      break;
    }

    const removals = candidate ? [...spent, candidate.questionKey] : spent;
    // Nothing to serve AND nothing to tidy: leave the row untouched so its
    // version does not move under a host who is mid-edit on the other surface.
    if (removals.length === 0) return { served: null };

    const version = Number(item.Version) || 0;
    const next = queueDrop(queue, removals);

    try {
      await db.send(new UpdateCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: `GAME#${gameId}`, SK: 'QUEUE' },
        UpdateExpression: 'SET #queue = :queue, #version = :next, #updatedAt = :now',
        ConditionExpression: '#version = :expected',
        ExpressionAttributeNames: {
          '#queue': 'Queue', '#version': 'Version', '#updatedAt': 'UpdatedAt'
        },
        ExpressionAttributeValues: {
          ':queue': next.queue,
          ':next': version + 1,
          ':expected': version,
          ':now': new Date().toISOString()
        }
      }));
    } catch (error) {
      if (error.name !== 'ConditionalCheckFailedException') throw error;
      // A host edited the queue between our read and our write. Go round again
      // and re-pick — the head may be a different question now.
      console.log(`🔁 QUEUE: the list moved while draining (attempt ${attempt}/${QUEUE_DRAIN_ATTEMPTS})`);
      continue;
    }

    return { served: candidate, queue: next.queue, version: version + 1 };
  }

  // Lost the race three times. Fall through to automatic selection rather than
  // serving anything: the host still gets a question, which is what pressing
  // the button asked for.
  console.log('⚠️ QUEUE: could not drain after repeated contention — selecting automatically');
  return { served: null };
};

// Helper function to select next question from enhanced counts (array-based)
//
// `setPk` is the RESOLVED question-set partition — `SET#<id>#v<n>` for a
// versioned set, `SET#<id>` for a legacy one. It is resolved once in the
// handler (game pin -> activeVersion -> legacy) and threaded through, so a game
// cannot read its categories from one version and its questions from another.
/*
  `asked` is threaded in rather than queried here: `selectNextQuestion` is the
  only entry point and already has it, and re-querying per call would read the
  same QUESTION# rows twice for one round.
*/
const selectNextQuestionFromCounts = async (gameId, countsState, setPk, isRandomized = true, asked = new Set(), seed = '', roundNumber = 1) => {
  const counts1_8 = countsState['1-8'] || [];
  const counts9_16 = countsState['9-16'] || [];
  const counts17_24 = countsState['17-24'] || [];
  
  // Get current category state for bitmask comparison (to see what's enabled)
  const categoryState = await db.send(new GetCommand({
    TableName: process.env.TABLE_NAME,
    Key: { PK: `GAME#${gameId}`, SK: 'STATE#CATS' }
  }));

  if (!categoryState.Item) {
    console.log(`❌ Category state not found for bitmask comparison`);
    return null;
  }

  const hostMask1_8 = categoryState.Item['HostMask1-8'];
  const hostMask9_16 = categoryState.Item['HostMask9-16'];
  const hostMask17_24 = categoryState.Item['HostMask17-24'];
  
  // Find categories that are enabled AND have questions remaining
  const availableCategories = [];
  
  // Check 1-8 range
  for (let i = 0; i < 8; i++) {
    const position = i + 1;
    const enabled = isBitSet(hostMask1_8, position);
    const remaining = counts1_8[i] || 0;
    
    if (enabled && remaining > 0) {
      availableCategories.push({
        position,
        remaining,
        group: '1-8',
        index: i
      });
    }
  }
  
  // Check 9-16 range
  for (let i = 0; i < 8; i++) {
    const position = i + 9;
    const enabled = isBitSet(hostMask9_16, i + 1);
    const remaining = counts9_16[i] || 0;
    
    if (enabled && remaining > 0) {
      availableCategories.push({
        position,
        remaining,
        group: '9-16',
        index: i
      });
    }
  }
  
  // Check 17-24 range
  for (let i = 0; i < 8; i++) {
    const position = i + 17;
    const enabled = isBitSet(hostMask17_24, i + 1);
    const remaining = counts17_24[i] || 0;
    
    if (enabled && remaining > 0) {
      availableCategories.push({
        position,
        remaining,
        group: '17-24',
        index: i
      });
    }
  }
  
  console.log(`🎯 Available categories from array counts:`, availableCategories.map(c => `Position ${c.position} (${c.remaining} left)`));

  if (availableCategories.length === 0) {
    console.log(`❌ No available categories with remaining questions`);
    return null;
  }

  // Get all categories from question set for position to categoryId mapping
  const categoriesQuery = await db.send(new QueryCommand({
    TableName: process.env.TABLE_NAME,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: {
      ':pk': setPk,
      ':sk': 'CATEGORY#'
    }
  }));

  const allCategories = categoriesQuery.Items || [];

  /*
    ONLY A CATEGORY THAT CAN ACTUALLY SERVE A QUESTION MAY BE PICKED.

    The old shape picked a category first — by counts and mask alone — and
    only then walked its cursor; a category whose remaining questions were all
    spent (asked out of order, or DISABLED via the EXCLUDED row) walked to
    nothing, this returned null, and the handler read null as THE WHOLE GAME
    ENDING — with live questions still sitting in every other category. It
    also made the preview diverge: question-plan.js's planAhead filters its
    pool by "has a next question" before picking, so the two chose from
    different lists and the seeded index landed differently.

    So the walk happens for every candidate BEFORE the pick, exactly as the
    planner simulates it, and the pick chooses among categories proven live.
  */
  const liveCategories = [];
  for (const candidate of availableCategories) {
    const categoryInfo = allCategories[candidate.position - 1];
    if (!categoryInfo) continue;
    const categoryId = categoryInfo.SK.replace('CATEGORY#', '');

    const [categoryOrderQuery, categoryActiveQuery] = await Promise.all([
      db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: `GAME#${gameId}`, SK: `CATEGORY#${categoryId}#ORDER` }
      })),
      db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: `GAME#${gameId}`, SK: `CATEGORY#${categoryId}#ACTIVE` }
      })),
    ]);

    if (!categoryOrderQuery.Item || !categoryActiveQuery.Item) continue;

    const storedIndex = categoryActiveQuery.Item.ActiveIndex || 0;
    const questionCount = categoryActiveQuery.Item.QuestionCount || 0;
    if (storedIndex >= questionCount) continue;

    // Skip anything the room has already seen or the host has disabled — see
    // advancePastAsked. Without this the cursor eventually walks onto a
    // question the host queued or picked by hand and serves it a second time.
    const landed = advancePastAsked({
      questionOrder: categoryOrderQuery.Item.QuestionOrder,
      activeIndex: storedIndex, questionCount, categoryId, asked
    });
    if (!landed) continue;

    liveCategories.push({ ...candidate, categoryId, questionCount, landed });
  }

  if (liveCategories.length === 0) {
    console.log(`❌ No category can serve an unasked, enabled question`);
    return null;
  }

  // Select category based on randomization setting
  let selectedCategory;
  if (isRandomized) {
    /*
      SEEDED, NOT `Math.random()`. The same arithmetic question-plan.js uses, so
      the "Up Next" a host is shown is the order that actually arrives — see
      that file's header. With Math.random() a preview could only ever be a
      guess, and a screen that guesses and calls it a plan is the failure this
      repo already treats as a bug class.
    */
    selectedCategory = liveCategories[pickIndex(seed, roundNumber, liveCategories.length)];
    console.log(`🎲 Selected category at position ${selectedCategory.position} (${selectedCategory.remaining} remaining) - SEEDED`);
  } else {
    // Select the first available category (lowest position number)
    selectedCategory = liveCategories.sort((a, b) => a.position - b.position)[0];
    console.log(`📋 Selected category at position ${selectedCategory.position} (${selectedCategory.remaining} remaining) - IN ORDER`);
  }

  const { index: activeIndex, questionNumber, questionId } = selectedCategory.landed;

  console.log(`🎯 Selected question: ${questionId}`);

  return {
    questionId,
    categoryId: selectedCategory.categoryId,
    categoryPosition: selectedCategory.position,
    activeIndex,
    questionCount: selectedCategory.questionCount,
    questionNumber
  };
};

// Helper function to select next question based on bitmasks
const selectNextQuestion = async (gameId, categoryState, setPk, isRandomized = true, asked = new Set(), seed = '', roundNumber = 1) => {
  console.log(`🎯 Selecting next question for game ${gameId}`);
  
  // Check if we have enhanced category counts (new feature)
  const countsResult = await db.send(new GetCommand({
    TableName: process.env.TABLE_NAME,
    Key: { PK: `GAME#${gameId}`, SK: 'STATE#CATS#COUNTS' }
  }));
  
  if (countsResult.Item && (countsResult.Item['1-8'] || countsResult.Item['9-16'] || countsResult.Item['17-24'])) {
    // Use enhanced category management
    console.log(`📊 Using enhanced array-based category counts for selection`);
    return selectNextQuestionFromCounts(gameId, countsResult.Item, setPk, isRandomized, asked, seed, roundNumber);
  }
  
  // Fallback to bitmask-based selection
  console.log(`🔢 Using legacy bitmask selection`);
  
  const hostMask1_8 = categoryState['HostMask1-8'];
  const hostMask9_16 = categoryState['HostMask9-16'];
  const hostMask17_24 = categoryState['HostMask17-24'];
  const availMask1_8 = categoryState['AvailMask1-8'];
  const availMask9_16 = categoryState['AvailMask9-16'];
  const availMask17_24 = categoryState['AvailMask17-24'];

  console.log(`🔢 Host masks: ${hostMask1_8} ${hostMask9_16} ${hostMask17_24}`);
  console.log(`🔢 Avail masks: ${availMask1_8} ${availMask9_16} ${availMask17_24}`);

  // Get all categories from question set
  const categoriesQuery = await db.send(new QueryCommand({
    TableName: process.env.TABLE_NAME,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: {
      ':pk': setPk,
      ':sk': 'CATEGORY#'
    }
  }));

  const allCategories = categoriesQuery.Items || [];
  console.log(`📋 Found ${allCategories.length} categories in question set`);

  // Find available categories (both host enabled AND questions available)
  const availableCategories = [];
  
  for (let i = 0; i < allCategories.length && i < 24; i++) {
    const position = i + 1;
    let hostEnabled = false;
    let questionsAvailable = false;

    // Check host mask
    if (position <= 8) {
      hostEnabled = isBitSet(hostMask1_8, position);
      questionsAvailable = isBitSet(availMask1_8, position);
    } else if (position <= 16) {
      hostEnabled = isBitSet(hostMask9_16, position - 8);
      questionsAvailable = isBitSet(availMask9_16, position - 8);
    } else {
      hostEnabled = isBitSet(hostMask17_24, position - 16);
      questionsAvailable = isBitSet(availMask17_24, position - 16);
    }

    if (hostEnabled && questionsAvailable) {
      const category = allCategories[i];
      const categoryId = category.SK.replace('CATEGORY#', '');
      availableCategories.push({
        categoryId,
        position,
        name: category.Name
      });
    }
  }

  console.log(`🎯 Available categories:`, availableCategories.map(c => `${c.name} (${c.categoryId})`));

  if (availableCategories.length === 0) {
    console.log(`❌ No available categories found`);
    return null;
  }

  // Select category based on randomization setting
  let selectedCategory;
  if (isRandomized) {
    // The same seeded pick as the counts path above, through the same function.
    selectedCategory = availableCategories[pickIndex(seed, roundNumber, availableCategories.length)];
    console.log(`🎲 Selected category: ${selectedCategory.name} (${selectedCategory.categoryId}) - SEEDED`);
  } else {
    // Select the first available category (lowest position number)
    selectedCategory = availableCategories.sort((a, b) => a.position - b.position)[0];
    console.log(`📋 Selected category: ${selectedCategory.name} (${selectedCategory.categoryId}) - IN ORDER`);
  }

  // Get the next question from this category
  const categoryOrderQuery = await db.send(new GetCommand({
    TableName: process.env.TABLE_NAME,
    Key: { PK: `GAME#${gameId}`, SK: `CATEGORY#${selectedCategory.categoryId}#ORDER` }
  }));

  const categoryActiveQuery = await db.send(new GetCommand({
    TableName: process.env.TABLE_NAME,
    Key: { PK: `GAME#${gameId}`, SK: `CATEGORY#${selectedCategory.categoryId}#ACTIVE` }
  }));

  if (!categoryOrderQuery.Item || !categoryActiveQuery.Item) {
    console.log(`❌ Category order/active data not found for ${selectedCategory.categoryId}`);
    return null;
  }

  const storedIndex = categoryActiveQuery.Item.ActiveIndex || 0;
  const questionCount = categoryActiveQuery.Item.QuestionCount || 0;
  const questionOrder = categoryOrderQuery.Item.QuestionOrder;

  console.log(`📊 Category ${selectedCategory.categoryId}: activeIndex=${storedIndex}, questionCount=${questionCount}`);

  if (storedIndex >= questionCount) {
    console.log(`❌ No more questions in category ${selectedCategory.categoryId}`);
    return null;
  }

  // The same skip as the position-mapped path above, through the same helper.
  const landed = advancePastAsked({
    questionOrder,
    activeIndex: storedIndex,
    questionCount,
    categoryId: selectedCategory.categoryId,
    asked
  });

  if (!landed) {
    console.log(`❌ Every remaining question in category ${selectedCategory.categoryId} has been asked`);
    return null;
  }

  const { index: activeIndex, questionNumber, questionId } = landed;

  console.log(`🎯 Selected question: ${questionId}`);

  return {
    questionId,
    categoryId: selectedCategory.categoryId,
    categoryPosition: selectedCategory.position,
    activeIndex,
    questionCount,
    questionNumber
  };
};

// Efficient WebSocket broadcasting
const broadcastToGame = async (gameId, message) => {
  try {
    console.log(`🔔 WEBSOCKET DEBUG: broadcastToGame called for game ${gameId}`);
    console.log(`🔔 WEBSOCKET DEBUG: Environment WEBSOCKET_API_ENDPOINT: ${process.env.WEBSOCKET_API_ENDPOINT}`);
    console.log(`🔔 WEBSOCKET DEBUG: Message to broadcast:`, JSON.stringify(message, null, 2));
    
    const connectionsResult = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `GAME#${gameId}`,
        ':sk': 'CONNECTION#'
      }
    }));
    
    const connections = connectionsResult.Items || [];
    console.log(`🔔 WEBSOCKET DEBUG: Found ${connections.length} connections for game ${gameId}`);
    console.log(`🔔 WEBSOCKET DEBUG: Connection details:`, connections.map(c => ({
      ConnectionId: c.ConnectionId,
      ConnectionType: c.ConnectionType,
      PlayerName: c.PlayerName,
      ConnectedAt: c.ConnectedAt
    })));
    
    if (connections.length === 0) {
      console.log(`⚠️ WEBSOCKET DEBUG: No active connections found for game ${gameId}`);
      return;
    }
    
    const broadcastPromises = connections.map(async (connection) => {
      try {
        console.log(`🔔 WEBSOCKET DEBUG: Sending to ${connection.ConnectionType} connection ${connection.ConnectionId}`);
        
        const command = new PostToConnectionCommand({
          ConnectionId: connection.ConnectionId,
          Data: JSON.stringify(message)
        });
        
        const result = await apigateway.send(command);
        console.log(`✅ WEBSOCKET DEBUG: Message sent successfully to ${connection.ConnectionId}`, result);
      } catch (error) {
        console.error(`❌ WEBSOCKET DEBUG: Failed to send to connection ${connection.ConnectionId}:`, error);
        console.error(`❌ WEBSOCKET DEBUG: Error details:`, {
          message: error.message,
          statusCode: error.statusCode || error.$response?.statusCode,
          code: error.Code || error.code
        });
        
        // Remove stale connections inline (410 = Gone). PK is known from the
        // connection row itself, so no full-table Scan is needed.
        if (error.statusCode === 410 || error.name === 'GoneException' || error.$metadata?.httpStatusCode === 410 || error.$response?.statusCode === 410) {
          console.log(`🧹 WEBSOCKET DEBUG: Removing stale connection: ${connection.ConnectionId}`);
          await db.send(new DeleteCommand({
            TableName: process.env.TABLE_NAME,
            Key: { PK: connection.PK, SK: connection.SK }
          })).catch(() => {});
        }
      }
    });
    
    await Promise.all(broadcastPromises);
    console.log(`✅ WEBSOCKET DEBUG: Broadcast complete for game ${gameId}`);
  } catch (error) {
    console.error('❌ WEBSOCKET DEBUG: Broadcast error:', error);
    console.error('❌ WEBSOCKET DEBUG: Broadcast error details:', {
      message: error.message,
      stack: error.stack
    });
    // Don't throw error - this shouldn't block the question progression
  }
};

exports.handler = async (event) => {
  try {
    const { gameId } = event.pathParameters || {};
    const body = JSON.parse(event.body || '{}');
    const { action, questionId } = body; // Allow 'skip' action to force progression, questionId for specific selection
    
    if (!gameId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Game ID is required' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    console.log(`➡️ Getting next question for game ${gameId}, action: ${action || 'normal'}, questionId: ${questionId || 'auto-select'}`);

    // Get game state, and the org that owns this session.
    const [gameState, ownerRead] = await Promise.all([
      db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: `GAME#${gameId}`, SK: 'STATE' }
      })),
      db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: `GAME#${gameId}`, SK: 'METADATA' },
        ProjectionExpression: 'orgId'
      })),
    ]);

    if (!gameState.Item) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Game not found' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    /*
      THE SHARPEST OF THE SESSION HOLES. This route ADVANCES A LIVE ROOM, and it
      compared nothing: on dev a host in another organisation moved somebody
      else's session to the next question with only the four-digit code. There
      are 9,000 of those.

      404 rather than 403, so a guessed code cannot be used to discover that a
      session exists — see tenant.callerMayDriveSession.
    */
    if (!callerMayDriveSession(event, ownerRead.Item || {})) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Game not found' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    // DUPLICATE PREVENTION: Check current state and validate progression
    const currentState = gameState.Item.State;
    const currentLessonNumber = gameState.Item.LessonNumber || 0;
    
    console.log(`🔒 NEXT-QUESTION: Current state: ${currentState}, lesson: ${currentLessonNumber}`);
    console.log(`🔒 NEXT-QUESTION: Expected transition patterns:`);
    console.log(`🔒   - RESULTS#001 → ASK#002 (normal flow)`);
    console.log(`🔒   - ASK#001 → ASK#002 (skip during ask)`); 
    console.log(`🔒   - VOTE#001 → ASK#002 (skip during vote)`);
    console.log(`🔒 NEXT-QUESTION: Full game state item:`, JSON.stringify(gameState.Item, null, 2));
    
    // Only allow progression from STARTED, ASK#, VOTE#, or RESULTS# states
    const validStates = ['STARTED', 'CREATED'];
    const isValidState = validStates.includes(currentState) || 
                        currentState.startsWith('ASK#') || 
                        currentState.startsWith('VOTE#') || 
                        currentState.startsWith('RESULTS#');
    
    if (!isValidState && action !== 'skip' && action !== 'select_specific' && action !== 'skip_to_specific') {
      return {
        statusCode: 400,
        body: JSON.stringify({ 
          error: 'Invalid state transition',
          message: `Cannot advance from state '${currentState}'. Use action 'skip' to force progression.`,
          currentState: currentState
        }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    // Prevent duplicate calls - if currently processing a question, return current state
    if (currentState.startsWith('ASK#') && action !== 'skip' && action !== 'skip_to_specific') {
      const currentQuestionNumber = currentState.replace('ASK#', '');
      console.log(`⚠️ Already in ASK state for question ${currentQuestionNumber}, not advancing (use action:'skip' to force)`);
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          message: 'Already asking a question',
          gameId: gameId,
          state: currentState,
          lessonNumber: currentLessonNumber,
          questionId: gameState.Item.CurrentQuestionId
        }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    // Get game metadata for question set ID
    const gameMetadata = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'METADATA' }
    }));

    if (!gameMetadata.Item || !gameMetadata.Item.QuestionSetId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Game metadata or question set ID not found' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    // Resolve which VERSION of the question set this game reads, ONCE, and use
    // it for every set read below. The game's pinned QuestionSetVersion wins, so
    // replacing a set cannot change the questions under a game in progress; a
    // game with no pin follows the set's activeVersion; an unmigrated set falls
    // through to its legacy `SET#<id>` partition.
    const resolvedSet = await resolveSetPartition(
      db, process.env.TABLE_NAME,
      gameMetadata.Item.QuestionSetId,
      gameMetadata.Item.QuestionSetVersion
    );
    const setPk = resolvedSet.pk;

    // Get category state
    const categoryState = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'STATE#CATS' }
    }));

    if (!categoryState.Item) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Category state not found' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    let nextQuestion;
    let queueOutcome = null;

    // Check if specific question was requested
    if (questionId && (action === 'select_specific' || action === 'skip_to_specific')) {
      console.log(`🎯 Specific question requested: ${questionId}`);
      
      // Validate that the requested question exists
      const specificQuestionQuery = await db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: setPk, SK: `QUESTION#${questionId}` }
      }));

      if (!specificQuestionQuery.Item) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: `Question ${questionId} not found in set ${gameMetadata.Item.QuestionSetId}` }),
          headers: { 'Access-Control-Allow-Origin': '*' }
        };
      }

      // For specific question selection, we need to determine the category
      const questionCategory = specificQuestionQuery.Item.category || specificQuestionQuery.Item.Category;
      
      if (!questionCategory) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: `Question ${questionId} has no category` }),
          headers: { 'Access-Control-Allow-Origin': '*' }
        };
      }

      // Find the categoryId and position for the specific question. Shared with
      // the queue drain — see locateCategory on why this is not inlined twice.
      const located = await locateCategory(setPk, questionCategory);
      const categoryId = located && located.categoryId;
      const categoryPosition = located && located.categoryPosition;

      if (!categoryId || !categoryPosition) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: `Category ${questionCategory} not found` }),
          headers: { 'Access-Control-Allow-Origin': '*' }
        };
      }

      console.log(`📋 Specific question ${questionId} mapped to category ${categoryId} at position ${categoryPosition}`);

      /*
        A SPECIFIC PICK CARRIES NO CURSOR, AND MUST NOT PRETEND TO.

        This object used to carry `activeIndex: 0` and `questionCount: 1`, with
        a comment on the second saying "Not relevant for specific selection".
        That was true of the intent and false of the effect: two blocks further
        down read both as if they were real, and did real damage with them.

          - the ActiveIndex write took `activeIndex + 1` and stored 1 on
            `CATEGORY#<id>#ACTIVE`, CLOBBERING wherever the auto-selection
            cursor actually was. A category the room had worked through to
            position 5 was reset to 1, and the next five auto-picks re-served
            questions everyone had already answered.

          - the exhaustion check asked `activeIndex + 1 >= questionCount`,
            which with the fabricated pair is `1 >= 1` — TRUE for every
            specific pick ever made. So each one zeroed that category's
            AvailMask bit, and the auto path never offered the category again.
            A host who picked one question out of a 40-question category lost
            the other 39.

        Both blocks are now gated on `isSpecific`, and the two invented numbers
        are gone rather than left lying around for the next reader to trust.
        `decrementCategoryCount` below still runs: the question really was
        asked, and that count is honest bookkeeping either way.

        This matters far more than it looks. One press did the damage once;
        anything that serves several questions in a row does it once per
        question.
      */
      nextQuestion = {
        questionId: `QUESTION#${questionId}`,
        categoryId: categoryId,
        categoryPosition: categoryPosition,
        isSpecific: true,
        questionNumber: parseInt(questionId)
      };

    } else {
      /*
        THE HOST'S OWN RUNNING ORDER GETS FIRST REFUSAL.

        This sits AFTER the ASK# duplicate guard above on purpose. That guard
        answers "Already asking a question" for a repeat press mid-round, and it
        must keep doing that WITHOUT consuming the queue — a double-tap that
        quietly swallowed the next queued question would lose it with no error
        and no way to tell it had happened.

        It sits after the metadata, set resolution and category state because it
        needs all three: which version of the set the game is playing, and which
        categories the host currently has switched on.

        An empty queue — every session that has never used the feature, on every
        round — falls straight through to the automatic selection below with no
        change to anything. That is the load-bearing property here; the queue is
        an addition to the existing path, never a replacement for it.
      */
      queueOutcome = await drainQueuedQuestion({
        gameId, setPk, resolvedSet, categoryState: categoryState.Item
      });

      if (queueOutcome && queueOutcome.served) {
        const served = queueOutcome.served;
        console.log(`📋 QUEUE: serving ${served.questionId} from the host's queue`);
        nextQuestion = {
          questionId: served.questionId,
          categoryId: served.categoryId,
          categoryPosition: served.categoryPosition,
          /*
            A QUEUED PICK IS A SPECIFIC PICK, and this flag is why.

            The host reached past the automatic selector to name this question,
            just in advance rather than in the moment. So the two writes gated
            on `isSpecific` further down must NOT fire: `7ddb0e0a` records what
            they cost when they do — the ActiveIndex write resets the category's
            cursor to 1, and the exhaustion check zeroes its AvailMask bit and
            makes the whole category unreachable. `tests/specific-selection-
            damage.js` pins that for the direct path; the queue must not
            reintroduce it by the side door, once per queued question.
          */
          isSpecific: true,
          questionNumber: parseInt(served.questionKey, 10)
        };
      } else {
        // Get randomization preference from any category ORDER record
        let isRandomized = true; // Default to true
        const categoryOrderQuery = await db.send(new QueryCommand({
          TableName: process.env.TABLE_NAME,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
          ExpressionAttributeValues: {
            ':pk': `GAME#${gameId}`,
            ':sk': 'CATEGORY#'
          }
        }));

        // Find the first ORDER record
        const orderRecords = (categoryOrderQuery.Items || []).filter(item => item.SK.includes('#ORDER'));
        if (orderRecords.length > 0) {
          isRandomized = orderRecords[0].IsRandom !== false;
          console.log(`🎲 Randomization preference: ${isRandomized ? 'RANDOM' : 'IN ORDER'}`);
        }

        // Select next question automatically
        /*
          The rounds this game has already served, so the cursor can step over
          anything queued or hand-picked. Queried once, here, and threaded down
          through both selection paths — see advancePastAsked.
        */
        const alreadyAsked = await askedSourceQuestionIds(gameId);
        /*
          The seed and the round together decide the category on a randomised
          set. The round is the one being SERVED — currentLessonNumber + 1 —
          because that is the number the preview used when it planned this same
          slot; keying on the round already finished would offset the whole
          sequence by one and the two would disagree on every round.
        */
        const seed = seedFor({ ...gameMetadata.Item, GameId: gameId });
        const roundNumber = currentLessonNumber + 1;
        nextQuestion = await selectNextQuestion(
          gameId, categoryState.Item, setPk, isRandomized, alreadyAsked, seed, roundNumber
        );
      }
    }

    // Whether the queue had anything to say about this round — reported on both
    // the served and the ENDED response so a host whose running order was built
    // against a replaced set finds out, rather than watching it be ignored.
    const queueNotes = queueOutcome && queueOutcome.staleSet ? { staleSet: true } : {};

    if (!nextQuestion) {
      // Game is finished - update state to ENDED and broadcast
      console.log(`🏁 Game ${gameId} has ended - no more questions available`);
      
      const now = new Date().toISOString();
      
      // Update game state to ENDED
      await db.send(new UpdateCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: `GAME#${gameId}`, SK: 'STATE' },
        UpdateExpression: 'SET #state = :state, #updatedAt = :updatedAt',
        ExpressionAttributeNames: {
          '#state': 'State',
          '#updatedAt': 'UpdatedAt'
        },
        ExpressionAttributeValues: {
          ':state': 'ENDED',
          ':updatedAt': now
        }
      }));

      // Broadcast game ended to all connected players
      await broadcastToGame(gameId, {
        type: 'hostMessage',
        messageType: 'END',
        gameId: gameId,
        state: `GAME#${gameId} ENDED`,
        timestamp: now,
        message: 'All questions have been completed'
      });

      console.log(`✅ Game ${gameId} ended successfully - final report should be generated`);

      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          gameId: gameId,
          state: 'ENDED',
          message: 'Game completed - all questions have been used',
          gameEnded: true,
          ...queueNotes
        }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    // CREATE QUESTION REFERENCE (as per game flow specification)
    const now = new Date().toISOString();
    const newLessonNumber = currentLessonNumber + 1;
    const questionNumber = String(newLessonNumber).padStart(3, '0');
    const newState = `ASK#${questionNumber}`;

    console.log(`📝 Creating question reference QUESTION#${questionNumber}#REF for ${nextQuestion.questionId}`);

    // Step 1: Create question reference record (CRITICAL: per game flow spec)
    await db.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: {
        PK: `GAME#${gameId}`,
        SK: `QUESTION#${questionNumber}#REF`,
        SourceQuestionId: nextQuestion.questionId,
        SetId: gameMetadata.Item.QuestionSetId,
        // The version this round was actually served from. get-question.js reads
        // it back as the pin, so a round already on screen keeps resolving to
        // the same version even if the set is replaced or promoted mid-round.
        // Omitted for a legacy (unversioned) set so the REF row keeps its old
        // shape and the resolver's legacy branch still fires.
        ...(resolvedSet.version !== null ? { SetVersion: resolvedSet.version } : {}),
        QuestionNumber: questionNumber,
        StartedAt: now,
        ttl: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 hours
      }
    }));

    // Step 2: Update game state
    await db.send(new UpdateCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'STATE' },
      UpdateExpression: 'SET #state = :state, #currentQuestionId = :questionId, #lessonNumber = :lessonNumber, #updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#state': 'State',
        '#currentQuestionId': 'CurrentQuestionId',
        '#lessonNumber': 'LessonNumber',
        '#updatedAt': 'UpdatedAt'
      },
      ExpressionAttributeValues: {
        ':state': newState,
        ':questionId': nextQuestion.questionId,
        ':lessonNumber': newLessonNumber,
        ':updatedAt': now
      }
    }));

    /*
      THE CURSOR AND THE EXHAUSTION FLAG BELONG TO THE AUTOMATIC PATH ONLY.

      Both of these describe where the auto-selector has got to in a category.
      A host reaching past it to name one question has not moved that position
      and has not emptied anything, so neither write applies. See the note on
      `isSpecific` where the specific branch builds `nextQuestion`.
    */
    if (!nextQuestion.isSpecific) {
      // Update category active index
      await db.send(new UpdateCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: `GAME#${gameId}`, SK: `CATEGORY#${nextQuestion.categoryId}#ACTIVE` },
        UpdateExpression: 'SET #activeIndex = :activeIndex',
        ExpressionAttributeNames: {
          '#activeIndex': 'ActiveIndex'
        },
        ExpressionAttributeValues: {
          ':activeIndex': nextQuestion.activeIndex + 1
        }
      }));
    }

    // Check if this category is now exhausted and update AvailMask if needed
    if (!nextQuestion.isSpecific && nextQuestion.activeIndex + 1 >= nextQuestion.questionCount) {
      console.log(`🏁 Category ${nextQuestion.categoryId} exhausted, updating AvailMask`);
      
      const position = nextQuestion.categoryPosition;
      let updateExpression = '';
      let expressionAttributeNames = {};
      let expressionAttributeValues = {};

      if (position <= 8) {
        const newMask = setBitToZero(categoryState.Item['AvailMask1-8'], position);
        updateExpression = 'SET #availMask1_8 = :availMask1_8';
        expressionAttributeNames['#availMask1_8'] = 'AvailMask1-8';
        expressionAttributeValues[':availMask1_8'] = newMask;
      } else if (position <= 16) {
        const newMask = setBitToZero(categoryState.Item['AvailMask9-16'], position - 8);
        updateExpression = 'SET #availMask9_16 = :availMask9_16';
        expressionAttributeNames['#availMask9_16'] = 'AvailMask9-16';
        expressionAttributeValues[':availMask9_16'] = newMask;
      } else {
        const newMask = setBitToZero(categoryState.Item['AvailMask17-24'], position - 16);
        updateExpression = 'SET #availMask17_24 = :availMask17_24';
        expressionAttributeNames['#availMask17_24'] = 'AvailMask17-24';
        expressionAttributeValues[':availMask17_24'] = newMask;
      }

      await db.send(new UpdateCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: `GAME#${gameId}`, SK: 'STATE#CATS' },
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues
      }));
    }

    // Decrement category count when question is asked (not when results are calculated)
    console.log(`🔢 Calling decrementCategoryCount for asked question ${questionNumber} in game ${gameId}`);
    await decrementCategoryCount(gameId, questionNumber, nextQuestion.categoryId, setPk);

    // Send simplified WebSocket notification to all connected players
    await broadcastToGame(gameId, {
      type: 'questionStarted',
      gameId: gameId,
      state: `GAME#${gameId} ASK#${questionNumber}`,
      questionNumber: questionNumber,
      lessonNumber: newLessonNumber,
      timestamp: now
    });

    // The list is one shorter than it was. Told separately, and never folded
    // into questionStarted, because the phone remote's queue panel and the
    // stage's are the same fact on two devices — and the phone would otherwise
    // go on drawing the served question as still queued until its next 2s poll.
    if (queueOutcome && queueOutcome.queue) {
      await broadcastToGame(gameId, {
        type: 'questionQueueChanged',
        gameId: gameId,
        version: queueOutcome.version,
        queue: queueOutcome.queue,
        timestamp: now
      });
    }

    console.log(`✅ Next question selected for game ${gameId}: ${nextQuestion.questionId}`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        gameId: gameId,
        state: newState,
        questionId: nextQuestion.questionId,
        lessonNumber: newLessonNumber,
        categoryId: nextQuestion.categoryId,
        message: 'Next question selected successfully',
        // Whether this round came off the host's running order, and what is
        // left of it. The surface that pressed the button re-renders from this
        // rather than guessing which entry was consumed.
        fromQueue: Boolean(queueOutcome && queueOutcome.served),
        ...(queueOutcome && queueOutcome.queue
          ? { queue: queueOutcome.queue, queueVersion: queueOutcome.version }
          : {}),
        ...queueNotes
      }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };

  } catch (error) {
    console.error('Next question error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Failed to get next question: ${error.message}` }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};

// Helper function to decrement category count when question is asked
// `setPk` is the caller's already-resolved set partition (see selectNextQuestion).
// Passing it in rather than rebuilding `SET#<id>` here is what keeps the category
// POSITIONS this decrement uses identical to the ones the selection used — two
// versions of a set can order or number their categories differently, and a
// mismatch would decrement the wrong counter.
const decrementCategoryCount = async (gameId, questionId, categoryId, setPk) => {
  try {
    console.log(`🔢 Decrementing category count for asked question ${questionId} (category ${categoryId}) in game ${gameId}`);
    
    // Check if this question has already been decremented (prevent duplicates)
    const resultsCheck = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: `QUESTION#${questionId}#RESULTS` }
    }));
    
    if (resultsCheck.Item && resultsCheck.Item.CategoryCountDecremented) {
      console.log(`⚠️ Question ${questionId} already processed for category count decrement, skipping`);
      return;
    }
    
    // Get current category counts with retry logic for concurrent updates
    let attempts = 0;
    const maxAttempts = 3;
    
    while (attempts < maxAttempts) {
      try {
        const countsResult = await db.send(new GetCommand({
          TableName: process.env.TABLE_NAME,
          Key: { PK: `GAME#${gameId}`, SK: 'STATE#CATS#COUNTS' }
        }));

        if (!countsResult.Item) {
          console.log(`📊 No category counts found for game ${gameId}, skipping decrement`);
          return;
        }

        // Get the position of this category from the game's category state
        const categoryStateResult = await db.send(new GetCommand({
          TableName: process.env.TABLE_NAME,
          Key: { PK: `GAME#${gameId}`, SK: 'STATE#CATS' }
        }));

        if (!categoryStateResult.Item) {
          console.log(`⚠️ Category state not found for game ${gameId}, skipping decrement`);
          return;
        }

        if (!setPk) {
          console.log(`⚠️ No resolved question-set partition for ${gameId}, skipping decrement`);
          return;
        }

        // Find category position by querying question set categories
        const categoriesQuery = await db.send(new QueryCommand({
          TableName: process.env.TABLE_NAME,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
          ExpressionAttributeValues: {
            ':pk': setPk,
            ':sk': 'CATEGORY#'
          }
        }));

        const allCategories = categoriesQuery.Items || [];
        let categoryPosition = null;
        
        for (let i = 0; i < allCategories.length; i++) {
          const catId = allCategories[i].SK.replace('CATEGORY#', '');
          if (catId === categoryId) {
            categoryPosition = i + 1; // 1-based position
            break;
          }
        }

        if (!categoryPosition) {
          console.log(`⚠️ Could not determine position for category ${categoryId}, skipping decrement`);
          return;
        }

        console.log(`📋 Found category ${categoryId} at position ${categoryPosition}`);

        const currentCounts = countsResult.Item;
        console.log(`🔍 Current counts record:`, JSON.stringify(currentCounts, null, 2));
        
        // Check for Version field
        if (typeof currentCounts.Version !== 'number') {
          console.log(`⚠️ Version field missing or invalid: ${currentCounts.Version}, initializing to 1`);
          currentCounts.Version = 1;
        }
        
        const counts1_8 = [...(currentCounts['1-8'] || [])];
        const counts9_16 = [...(currentCounts['9-16'] || [])];
        const counts17_24 = [...(currentCounts['17-24'] || [])];
        
        console.log(`📊 Current counts - 1-8: [${counts1_8}], 9-16: [${counts9_16}], 17-24: [${counts17_24}]`);
        
        // Determine which array and index to update
        let arrayIndex, targetArray, arrayName;
        if (categoryPosition >= 1 && categoryPosition <= 8) {
          arrayIndex = categoryPosition - 1;
          targetArray = counts1_8;
          arrayName = '1-8';
        } else if (categoryPosition >= 9 && categoryPosition <= 16) {
          arrayIndex = categoryPosition - 9;
          targetArray = counts9_16;
          arrayName = '9-16';
        } else if (categoryPosition >= 17 && categoryPosition <= 24) {
          arrayIndex = categoryPosition - 17;
          targetArray = counts17_24;
          arrayName = '17-24';
        } else {
          console.log(`⚠️ Invalid category position ${categoryPosition}, skipping decrement`);
          return;
        }

        const currentRemaining = targetArray[arrayIndex] || 0;
        console.log(`🎯 Target: ${categoryId} at position ${categoryPosition} → ${arrayName}[${arrayIndex}] = ${currentRemaining}`);
        
        // Check if already at 0
        if (currentRemaining <= 0) {
          console.log(`⚠️ Category ${categoryId} already at 0 remaining questions`);
          return;
        }

        // Update the array
        const newCount = Math.max(0, currentRemaining - 1);
        targetArray[arrayIndex] = newCount;
        console.log(`🔄 Decrementing ${categoryId}: ${currentRemaining} → ${newCount}`);

        // Calculate total enabled (need to check bitmasks)
        const hostMask1_8 = categoryStateResult.Item['HostMask1-8'];
        const hostMask9_16 = categoryStateResult.Item['HostMask9-16'];
        const hostMask17_24 = categoryStateResult.Item['HostMask17-24'];
        
        let totalEnabled = 0;
        
        // Count enabled questions from 1-8
        for (let i = 0; i < 8; i++) {
          if (isBitSet(hostMask1_8, i + 1)) {
            totalEnabled += counts1_8[i] || 0;
          }
        }
        
        // Count enabled questions from 9-16
        for (let i = 0; i < 8; i++) {
          if (isBitSet(hostMask9_16, i + 1)) {
            totalEnabled += counts9_16[i] || 0;
          }
        }
        
        // Count enabled questions from 17-24
        for (let i = 0; i < 8; i++) {
          if (isBitSet(hostMask17_24, i + 1)) {
            totalEnabled += counts17_24[i] || 0;
          }
        }

        // Recalculate totalRemaining from enabled categories only (should match totalEnabled)
        const totalRemaining = totalEnabled;

        // Atomic update with optimistic locking
        await db.send(new UpdateCommand({
          TableName: process.env.TABLE_NAME,
          Key: { PK: `GAME#${gameId}`, SK: 'STATE#CATS#COUNTS' },
          UpdateExpression: 'SET #ver = :newVer, #c1_8 = :c1_8, #c9_16 = :c9_16, #c17_24 = :c17_24, #totEnabled = :totEnabled, #totRemaining = :totRemaining, #updated = :updated',
          ConditionExpression: 'Version = :expectedVer',
          ExpressionAttributeNames: {
            '#ver': 'Version',
            '#c1_8': '1-8',
            '#c9_16': '9-16',
            '#c17_24': '17-24',
            '#totEnabled': 'TotalEnabled',
            '#totRemaining': 'TotalRemaining',
            '#updated': 'UpdatedAt'
          },
          ExpressionAttributeValues: {
            ':newVer': currentCounts.Version + 1,
            ':c1_8': counts1_8,
            ':c9_16': counts9_16,
            ':c17_24': counts17_24,
            ':totEnabled': totalEnabled,
            ':totRemaining': totalRemaining,
            ':updated': new Date().toISOString(),
            ':expectedVer': currentCounts.Version
          }
        }));

        console.log(`✅ Decremented ${categoryId} (position ${categoryPosition}, ${arrayName}[${arrayIndex}]): ${currentRemaining} → ${currentRemaining - 1}`);
        console.log(`📊 Updated totals - Enabled: ${totalEnabled}, Total Remaining: ${totalRemaining}`);
        
        // Mark this question as processed for category count (create the RESULTS record)
        try {
          await db.send(new PutCommand({
            TableName: process.env.TABLE_NAME,
            Item: {
              PK: `GAME#${gameId}`,
              SK: `QUESTION#${questionId}#RESULTS`,
              CategoryCountDecremented: true,
              DecrementedAt: new Date().toISOString(),
              CategoryId: categoryId,
              CategoryPosition: categoryPosition,
              ttl: Math.floor(Date.now() / 1000) + (24 * 60 * 60) // 24 hours
            }
          }));
          console.log(`🏷️ Marked question ${questionId} as processed for category count`);
        } catch (markError) {
          console.log(`⚠️ Failed to mark question as processed, but decrement succeeded:`, markError.message);
        }
        
        return; // Success, exit retry loop

      } catch (error) {
        attempts++;
        
        if (error.name === 'ConditionalCheckFailedException') {
          console.log(`🔄 Concurrent update detected, retrying (${attempts}/${maxAttempts})`);
          if (attempts < maxAttempts) {
            // Brief delay before retry
            await new Promise(resolve => setTimeout(resolve, 100 * attempts));
            continue;
          }
        }
        
        throw error; // Re-throw non-retryable errors or max attempts reached
      }
    }
    
    console.log(`❌ Failed to decrement category count after ${maxAttempts} attempts`);
    
  } catch (error) {
    console.error(`❌ Error decrementing category count for game ${gameId}, question ${questionId}:`, error);
    // Don't throw - this shouldn't block question progression
  }
};