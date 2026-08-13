const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { toVersion, versionList } = require('./shared/set-version');
const { canManageSet, isSetOwner, setOwnerId } = require('./shared/question-set-access');
const { isAdminCaller } = require('./shared/require-admin');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

exports.handler = async (event) => {
  try {
    console.log('Getting question sets...');
    
    // Get all question set metadata (both active and inactive)
    const res = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': 'SETS' }
    }));

    // Hosts read this list too now — it is the only projection that carries
    // ownership, and the host surface needs it to know which rows it may offer
    // controls on. Computed once, outside the loop, because the answer is the
    // same for every row.
    const callerIsAdmin = isAdminCaller(event);

    const questionSets = res.Items.map(item => ({
      id: item.SK.replace('SET#', ''),
      name: item.name,
      description: item.description,
      customInstruction: item.customInstruction,
      aiContextInstruction: item.aiContextInstruction,
      promptId: item.promptId,
      // Per-set persona override. Without this projection the admin form always
      // reads back `undefined` and silently drops whatever was written.
      personaId: item.personaId,
      // Per-set round-label override ("Lesson 3" on a genuine lessons set while
      // the default stays "Round"). Resolved for display by resolveRoundNoun().
      roundNoun: item.roundNoun,
      // THE SET'S DIRECTION — what the room is asked to DO with each item, as
      // distinct from the topic it is about. Projected RAW, not resolved to
      // `produce`: the editor has to be able to tell "the author chose Produce"
      // from "nobody has ever been asked", because its save payload is a diff
      // and a resolved default would make every open-and-save write a value
      // that was never chosen. Readers apply the default themselves
      // (config/roundKinds.js resolveRoundKind).
      roundKind: item.roundKind || '',
      roundKindBrief: item.roundKindBrief || '',
      engagementType: item.engagementType,
      questionCount: item.questionCount || 0,
      totalQuestions: item.questionCount || 0, // Add for frontend compatibility
      categoryCount: item.categoryCount || 0,
      active: item.active !== false,
      quickstart: item.Quickstart || false, // Add quickstart field
      createdAt: item.createdAt,
      // edit-question-set.js used to write `UpdatedAt` while this read
      // `updatedAt`, so an edit never moved the date. Both writers now agree on
      // the lower-case spelling; the fallback keeps rows written before the fix
      // showing a date instead of nothing.
      updatedAt: item.updatedAt || item.UpdatedAt,
      isAIGenerated: item.isAIGenerated || false,
      hasImages: item.hasImages === true,
      // OWNERSHIP.
      //
      // `canManage` is the server's answer to "may THIS caller edit or delete
      // THIS set", computed by the same function the edit and delete handlers
      // enforce with (shared/question-set-access.js). The console renders
      // controls from it, so a button can never appear for an action the
      // handler would refuse — and, just as importantly, the handler refuses
      // regardless of what the console rendered.
      //
      // `createdByName` is a display string and is NEVER authorised against;
      // `createdBy` is the Cognito sub the rule actually uses. It is projected
      // only for admins: an opaque sub is of no use to a host and the roster of
      // who authored what is not a host's business. `mine` gives the host
      // surface everything it needs without it.
      canManage: canManageSet(event, item),
      // "I created this", which is NOT the same question as canManage: an admin
      // can manage every set and authored almost none of them, and the host
      // surface wants to show a host their own shelf rather than everything
      // they happen to have rights over.
      mine: isSetOwner(event, item),
      createdByName: item.createdByName || null,
      ...(callerIsAdmin ? { createdBy: setOwnerId(item) || null } : {}),
      // Versioning. `activeVersion` is null for a set that has never been
      // versioned — its content is still in the legacy `SET#<id>` partition and
      // it plays perfectly well from there — so the UI must treat null as "not
      // versioned yet", not as an error. `versions` is likewise [] until the
      // set is first replaced or migrated.
      activeVersion: toVersion(item.activeVersion),
      versions: versionList(item)
        .map((v) => ({
          version: toVersion(v && v.version),
          createdAt: (v && v.createdAt) || null,
          questionCount: (v && v.questionCount) || 0,
          categoryCount: (v && v.categoryCount) || 0,
          sourceFile: (v && v.sourceFile) || '',
          note: (v && v.note) || ''
        }))
        .filter((v) => v.version !== null)
        .sort((a, b) => a.version - b.version)
    }));

    return {
      statusCode: 200,
      body: JSON.stringify({ questionSets }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
    
  } catch (error) {
    console.error('Get question sets error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Failed to get question sets: ${error.message}` }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};
