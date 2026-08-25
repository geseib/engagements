const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { resolvePartitionFromMeta } = require('./shared/set-version');
const { findSetForCaller, requestedScope } = require('./shared/question-set-access');
const { ORG } = require('./shared/tenant');
const { decryptItem, decryptItems } = require('./shared/tenant-crypto');

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

exports.handler = async (event) => {
  try {
    const setId = event.pathParameters?.setId;
    const category = event.queryStringParameters?.category;
    // Optional `?version=2` so the admin editor can preview an older version.
    // Omitted means the set's activeVersion, falling through to legacy.
    const requestedVersion = event.queryStringParameters?.version;
    
    console.log(`Getting questions for set: ${setId}, category: ${category || 'all'}`);
    
    if (!setId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Set ID is required' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }
    
    // Verify the question set exists — IN A LIBRARY THIS CALLER MAY READ.
    //
    // This is a read, so the guard is READABILITY, not manageability. Guarding
    // it with requireSetManager would be wrong in a way worth naming: no org
    // user may MANAGE a platform set, so that guard would stop every host from
    // previewing the questions of the shared library — which the owner's
    // requirement is that every org can read. `findSetForCaller` searches only
    // the caller's own org, platform and public, so another organisation's set
    // is absent and this 404s on it.
    const found = await findSetForCaller(
      db, process.env.TABLE_NAME, event, setId, requestedScope(event)
    );
    const setRes = { Item: found && found.item };

    if (!setRes.Item) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Question set not found' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }
    
    // Read the resolved VERSION of the set, not the bare `SET#<id>` partition:
    // once a set has been replaced its live questions live at `SET#<id>#v<n>`
    // and the legacy partition holds the superseded copy.
    const resolved = resolvePartitionFromMeta(found.ref, setRes.Item, requestedVersion);

    // Build query parameters
    let queryParams = {
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :setpk AND begins_with(SK, :questionPrefix)',
      ExpressionAttributeValues: { 
        ':setpk': resolved.pk,
        ':questionPrefix': 'QUESTION#'
      }
    };

    // Add category filter if specified
    if (category) {
      queryParams.FilterExpression = '(#category = :category OR #Category = :category)';
      queryParams.ExpressionAttributeNames = { 
        '#category': 'category',
        '#Category': 'Category'
      };
      queryParams.ExpressionAttributeValues[':category'] = category;
    }
    
    // Get questions for this set
    const questionsRes = await db.send(new QueryCommand(queryParams));

    // ── PLAINTEXT FOR THE EDITOR ─────────────────────────────────────────────
    //
    // This is what the admin question editor lists and then saves back, so an
    // envelope reaching it would be shown as the question's title and written
    // back as one. Only org content is decrypted, because only org content was
    // ever encrypted — `found.ref` is the library the row was really read from,
    // and platform/public sets have no org key to ask for.
    //
    // The `...Object.keys(item).reduce(...)` passthrough below is the reason
    // this happens to the ROW and not to the projection: it copies every field
    // nobody named, so a boundary field that grew later would sail past a
    // hand-written list untouched.
    const cryptoOrgId = found.ref && found.ref.scope === ORG ? String(found.ref.orgId || '') : '';
    const questionItems = cryptoOrgId
      ? await decryptItems(cryptoOrgId, 'question', questionsRes.Items || [])
      : (questionsRes.Items || []);
    questionsRes.Items = questionItems;

    // The set NAME is a `set` boundary field too, so on an org row it is an
    // envelope and has to come back through the same door as the questions.
    const setMeta = cryptoOrgId
      ? await decryptItem(cryptoOrgId, 'set', setRes.Item)
      : setRes.Item;

    // DEBUG: Log the first raw item to see what fields are available
    if (questionsRes.Items && questionsRes.Items.length > 0) {
      console.log('🔍 Raw database item fields:', Object.keys(questionsRes.Items[0]));
      console.log('🔍 Sample raw item:', questionsRes.Items[0]);
    }
    
    const questions = (questionsRes.Items || []).map(item => ({
      id: item.SK.replace('QUESTION#', ''),
      title: item.title || item.Title,
      questionDetail: item.questionDetail || item.QuestionDetail || item.detail || item.Detail,
      category: item.category || item.Category,
      school: item.school || item.School || '',
      image: item.image || item.Image || '', // Optional artwork URL ("Art Title" rounds)
      // Trivia question fields
      optionA: item.optionA || item.OptionA,
      optionB: item.optionB || item.OptionB,
      optionC: item.optionC || item.OptionC,
      optionD: item.optionD || item.OptionD,
      correctAnswer: item.correctAnswer || item.CorrectAnswer,
      answerDetails: item.answerDetails || item.AnswerDetails,
      difficulty: item.difficulty || item.Difficulty,
      // Poll/engagement question fields
      customInstructions: item.customInstructions || item.CustomInstructions,
      // Common fields
      engagementType: item.engagementType || item.EngagementType,
      setId: setId,
      sortOrder: item.sortOrder || 0,
      // Pass through any additional fields that might exist
      ...Object.keys(item).reduce((acc, key) => {
        if (!['SK', 'PK', 'title', 'Title', 'questionDetail', 'QuestionDetail', 'detail', 'Detail', 
              'category', 'Category', 'optionA', 'OptionA', 'optionB', 'OptionB', 'optionC', 'OptionC', 
              'optionD', 'OptionD', 'correctAnswer', 'CorrectAnswer', 'answerDetails', 'AnswerDetails',
              'difficulty', 'Difficulty', 'customInstructions', 'CustomInstructions', 'engagementType', 
              'EngagementType', 'sortOrder'].includes(key)) {
          acc[key] = item[key];
        }
        return acc;
      }, {})
    }));
    
    // Sort questions by sortOrder, then by title
    questions.sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) {
        return (a.sortOrder || 0) - (b.sortOrder || 0);
      }
      return (a.title || '').localeCompare(b.title || '');
    });
    
    console.log(`Found ${questions.length} questions for set ${setId}`);
    
    return {
      statusCode: 200,
      body: JSON.stringify({ 
        questions,
        setId,
        scope: found.ref.scope,
        orgId: found.ref.orgId || null,
        setName: setMeta.name || setMeta.Name,
        version: resolved.version,
        totalQuestions: questions.length
      }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
    
  } catch (error) {
    console.error('Get question set questions error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Failed to get questions: ${error.message}` }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};