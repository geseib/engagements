const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');

const bedrock = new BedrockRuntimeClient({ region: 'us-east-1' });
const dynamoClient = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(dynamoClient);
const s3 = new S3Client({ region: 'us-east-1' });

// Parse Claude's response into structured sections using the new === FORMAT ===
const parseAIResponse = (aiResponse) => {
  console.log('🔍 PARSING: Full AI response length:', aiResponse.length);
  console.log('🔍 PARSING: First 300 chars:', aiResponse.substring(0, 300));
  
  // Convert the response to Markdown format
  let markdownResponse = aiResponse;
  
  // Extract summary (content between "=== SUMMARY ===" and next section)
  let summaryText = '';
  const summaryMatch = aiResponse.match(/===\s*SUMMARY\s*===\s*\n([\s\S]*?)(?=\n===|$)/i);
  if (summaryMatch) {
    summaryText = summaryMatch[1].trim().replace(/^\[|\]$/g, ''); // Remove template brackets
    console.log('🔍 PARSING: Extracted summary:', summaryText.substring(0, 100) + '...');
  } else {
    console.log('⚠️ PARSING: No === SUMMARY === section found');
  }
  
  // Extract discussion questions (content between "=== DISCUSSION QUESTIONS ===" and next section)
  let discussionQuestions = [];
  const discussionMatch = aiResponse.match(/===\s*DISCUSSION\s*QUESTIONS\s*===\s*\n([\s\S]*?)(?=\n===|$)/i);
  if (discussionMatch) {
    const discussionText = discussionMatch[1];
    // Extract Q1:, Q2:, Q3: format questions
    const q1Match = discussionText.match(/Q1:\s*(.*?)(?=\nQ2:|$)/s);
    const q2Match = discussionText.match(/Q2:\s*(.*?)(?=\nQ3:|$)/s);
    const q3Match = discussionText.match(/Q3:\s*(.*?)(?=\n|$)/s);
    
    if (q1Match) discussionQuestions.push(q1Match[1].trim().replace(/^\[|\]$/g, ''));
    if (q2Match) discussionQuestions.push(q2Match[1].trim().replace(/^\[|\]$/g, ''));
    if (q3Match) discussionQuestions.push(q3Match[1].trim().replace(/^\[|\]$/g, ''));
    
    console.log('🔍 PARSING: Extracted discussion questions:', discussionQuestions);
  } else {
    console.log('⚠️ PARSING: No === DISCUSSION QUESTIONS === section found');
  }
  
  // Extract next steps (content between "=== NEXT STEPS ===" and end)
  let nextSteps = [];
  const nextStepsMatch = aiResponse.match(/===\s*NEXT\s*STEPS\s*===\s*\n([\s\S]*?)$/i);
  if (nextStepsMatch) {
    const nextStepsText = nextStepsMatch[1];
    // Extract STEP1:, STEP2:, STEP3:, STEP4: format
    const step1Match = nextStepsText.match(/STEP1:\s*(.*?)(?=\nSTEP2:|$)/s);
    const step2Match = nextStepsText.match(/STEP2:\s*(.*?)(?=\nSTEP3:|$)/s);
    const step3Match = nextStepsText.match(/STEP3:\s*(.*?)(?=\nSTEP4:|$)/s);
    const step4Match = nextStepsText.match(/STEP4:\s*(.*?)(?=\n|$)/s);
    
    if (step1Match) nextSteps.push(step1Match[1].trim().replace(/^\[|\]$/g, ''));
    if (step2Match) nextSteps.push(step2Match[1].trim().replace(/^\[|\]$/g, ''));
    if (step3Match) nextSteps.push(step3Match[1].trim().replace(/^\[|\]$/g, ''));
    if (step4Match) nextSteps.push(step4Match[1].trim().replace(/^\[|\]$/g, ''));
    
    console.log('🔍 PARSING: Extracted next steps:', nextSteps);
  } else {
    console.log('⚠️ PARSING: No === NEXT STEPS === section found');
  }
  
  // Fallback to simpler parsing if structured parsing fails
  if (!summaryText || summaryText.length < 20) {
    console.log('⚠️ PARSING: Falling back to simple summary extraction');
    summaryText = aiResponse.trim();
  }
  
  // Convert the raw response to Markdown format
  markdownResponse = aiResponse
    .replace(/===\s*SUMMARY\s*===/gi, '## Summary')
    .replace(/===\s*DISCUSSION\s*QUESTIONS\s*===/gi, '## Discussion Questions')
    .replace(/===\s*NEXT\s*STEPS\s*===/gi, '## Next Steps')
    .replace(/Q1:\s*/g, '1. ')
    .replace(/Q2:\s*/g, '2. ')
    .replace(/Q3:\s*/g, '3. ')
    .replace(/STEP1:\s*/g, '1. ')
    .replace(/STEP2:\s*/g, '2. ')
    .replace(/STEP3:\s*/g, '3. ')
    .replace(/STEP4:\s*/g, '4. ');
  
  const result = {
    summaryText: summaryText,
    discussionQuestions: discussionQuestions,
    nextSteps: nextSteps,
    markdownResponse: markdownResponse
  };
  
  console.log('✅ PARSING: Summary length:', result.summaryText.length);
  console.log('✅ PARSING: Discussion questions count:', result.discussionQuestions.length);
  console.log('✅ PARSING: Next steps count:', result.nextSteps.length);
  
  return result;
};

// Fetch AI prompt from S3
const fetchPromptFromS3 = async (promptId) => {
  try {
    console.log(`📄 Fetching prompt ${promptId} from S3...`);
    
    // Match the structure used by create-ai-prompt: prompts/{gameType}/{promptId}/v{version}.json
    const gameType = 'callandanswer'; // Default game type
    const version = 1; // Default version
    
    const s3Key = `prompts/${gameType}/${promptId}/v${version}.json`;
    console.log(`📄 S3 Key: ${s3Key}`);
    
    const response = await s3.send(new GetObjectCommand({
      Bucket: process.env.AI_PROMPTS_BUCKET,
      Key: s3Key
    }));
    
    const promptData = JSON.parse(await response.Body.transformToString());
    console.log(`✅ Successfully fetched prompt: ${promptData.name}`);
    
    return promptData;
  } catch (error) {
    console.error(`❌ Error fetching prompt ${promptId}:`, error);
    
    // Try to get from DynamoDB as fallback
    try {
      const dbResult = await db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: 'AI_PROMPTS', SK: promptId }
      }));
      
      if (dbResult.Item) {
        console.log(`✅ Found prompt in DynamoDB fallback`);
        return dbResult.Item;
      }
    } catch (dbError) {
      console.error(`❌ DynamoDB fallback also failed:`, dbError);
    }
    
    // Final fallback: use the original hardcoded prompt for 'lessons-learned'
    if (promptId === 'lessons-learned') {
      console.log(`📄 Using hardcoded fallback for lessons-learned prompt`);
      return {
        id: 'lessons-learned',
        name: 'Lessons Learned - Strategic Insights',
        category: 'callandanswer',
        template: `You are an expert business strategist analyzing responses from {sessionContext}.

LESSON DETAILS:
Question: "{questionTitle}"
Category: {questionCategory}
Context: {questionDetail}
{contextSections}

PLAYER RESPONSES (ranked by peer voting):
{responsesText}

ANALYSIS INSTRUCTIONS:
You are analyzing {responseCount} responses that were peer-voted by the team. The responses above are ranked by total vote points, with the highest-scoring response first.{contextInstructions}

Please provide your strategic analysis in this EXACT format for reliable parsing:

=== SUMMARY ===
[Write 2-3 sentences synthesizing the key strategic themes and insights from these responses. Pay special attention to the top-ranked responses as they represent the team's collective wisdom.]

=== DISCUSSION QUESTIONS ===
Q1: [First thought-provoking question that builds on these specific responses for deeper strategic discussion. Reference specific player insights.]
Q2: [Second question that facilitates strategic discussion based on the responses.]
Q3: [Third question for deeper strategic discussion.]

=== NEXT STEPS ===
STEP1: [First concrete, actionable step the team could take based on these insights.]
STEP2: [Second actionable step, prioritizing ideas from highest-ranked responses.]
STEP3: [Third actionable step for implementation.]
STEP4: [Fourth actionable step (optional but recommended).]

Focus on actionable insights that connect directly to what these players shared and the specific context they were asked to consider. Be specific and insightful.`,
        description: 'Strategic insights and actionable next steps based on team responses'
      };
    }
    
    return null;
  }
};

// Find default prompt ID for a given game type
const findDefaultPromptId = async (gameType) => {
  try {
    console.log(`🔍 Finding default prompt for game type: ${gameType}`);
    
    // Normalize game type
    const normalizedGameType = gameType === 'call-and-answer' ? 'callandanswer' : gameType;
    
    // Scan for default prompts matching the game type
    const scanResult = await db.send(new ScanCommand({
      TableName: process.env.TABLE_NAME,
      FilterExpression: 'begins_with(PK, :pk) AND gameType = :gameType AND isDefault = :isDefault',
      ExpressionAttributeValues: {
        ':pk': 'AI_PROMPT#',
        ':gameType': normalizedGameType,
        ':isDefault': true
      }
    }));

    if (scanResult.Items && scanResult.Items.length > 0) {
      // Prefer lessons-learned category for call-and-answer, or take first available
      let defaultPrompt = scanResult.Items.find(item => item.category === 'lessons-learned') || scanResult.Items[0];
      console.log(`✅ Found default prompt: ${defaultPrompt.promptId} (${defaultPrompt.name})`);
      return defaultPrompt.promptId;
    }

    // Final fallback - return a hardcoded default
    console.log(`⚠️ No default prompt found for ${gameType}, using hardcoded fallback`);
    return 'lessons-learned';
    
  } catch (error) {
    console.error(`❌ Error finding default prompt for ${gameType}:`, error);
    return 'lessons-learned'; // Fallback
  }
};

exports.handler = async (event) => {
  try {
    const { gameId } = event.pathParameters || {};
    const queryParams = event.queryStringParameters || {};
    const { questionId, generateNew } = queryParams;

    if (!gameId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Game ID is required' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    console.log(`🤖 Getting AI summary for game ${gameId}, questionId: ${questionId || 'current'}`);

    // Get game state first
    const gameState = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'STATE' }
    }));

    if (!gameState.Item) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Game not found' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    let targetQuestionId = questionId;
    
    // If no specific question ID provided, get current question from game state
    if (!targetQuestionId) {
      targetQuestionId = gameState.Item.CurrentQuestionId;
      
      if (!targetQuestionId) {
        return {
          statusCode: 400,
          body: JSON.stringify({ 
            error: 'No current question',
            message: 'No question is currently active'
          }),
          headers: { 'Access-Control-Allow-Origin': '*' }
        };
      }
    }

    // Extract the question number from questionId (e.g., "002" from questionId or from current state)
    let paddedQuestionNumber = targetQuestionId;
    
    // If questionId looks like a sequential number, use it directly
    if (/^\d{3}$/.test(targetQuestionId)) {
      paddedQuestionNumber = targetQuestionId;
    } else {
      // Try to extract from current state if it's in RESULTS#002 format
      const currentState = gameState.Item.State;
      if (currentState && currentState.includes('#')) {
        const stateMatch = currentState.match(/#(\d+)/);
        if (stateMatch) {
          paddedQuestionNumber = stateMatch[1];
        }
      }
    }
    
    console.log(`🔍 Using question number ${paddedQuestionNumber} for lookups`);
    
    // Check if AI summary already exists (unless generateNew is true)
    if (!generateNew) {
      const existingSummary = await db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { 
          PK: `GAME#${gameId}`, 
          SK: `QUESTION#${paddedQuestionNumber}#AISummary` 
        }
      }));

      if (existingSummary.Item) {
        console.log(`✅ Returning existing AI summary for ${gameId}: ${targetQuestionId}`);
        return {
          statusCode: 200,
          body: JSON.stringify({
            gameId: gameId,
            questionId: targetQuestionId,
            summary: existingSummary.Item.Summary || existingSummary.Item.SummaryText,
            summaryText: existingSummary.Item.SummaryText || existingSummary.Item.Summary,
            discussionQuestions: existingSummary.Item.DiscussionQuestions || [],
            nextSteps: existingSummary.Item.NextSteps || [],
            markdownResponse: existingSummary.Item.MarkdownResponse || null,
            generatedAt: existingSummary.Item.GeneratedAt,
            fromCache: true
          }),
          headers: { 'Access-Control-Allow-Origin': '*' }
        };
      }
    }

    // Get game metadata for AI context and scoring configuration
    const gameMetadata = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: 'METADATA' }
    }));

    if (!gameMetadata.Item) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Game not found' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    // Extract scoring configuration early since it's used in vote processing
    const scoringConfig = gameMetadata.Item.ScoringConfig || {
      firstPlacePoints: 3,
      secondPlacePoints: 2,
      thirdPlacePoints: 1,
      participationPoints: 0
    };

    // Get question details from question set
    const questionSetId = gameMetadata.Item.QuestionSetId;
    
    // First try to get the question reference to find the source question
    const questionRef = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `GAME#${gameId}`, SK: `QUESTION#${paddedQuestionNumber}#REF` }
    }));
    
    let sourceQuestionId = targetQuestionId;
    if (questionRef.Item && questionRef.Item.SourceQuestionId) {
      sourceQuestionId = questionRef.Item.SourceQuestionId;
    }
    
    const questionInfo = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { 
        PK: `SET#${questionSetId}`, 
        SK: sourceQuestionId 
      }
    }));

    // If question not found in set, create a fallback question object
    let question;
    if (!questionInfo.Item) {
      console.log(`⚠️ Question ${sourceQuestionId} not found in set ${questionSetId}, using fallback`);
      question = {
        Title: `Question ${paddedQuestionNumber}`,
        Detail: 'Question details not available',
        Category: 'General'
      };
    } else {
      question = questionInfo.Item;
    }

    // Use the sequential question number for answers lookup (already calculated above)
    
    // Get answers for this question using sequential question number
    const answersQuery = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `GAME#${gameId}`,
        ':sk': `QUESTION#${paddedQuestionNumber}#ANSWER#`
      }
    }));

    // Get vote tallies for results calculation (using same logic as get-results.js)
    const votesQuery = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `GAME#${gameId}`,
        ':sk': `QUESTION#${paddedQuestionNumber}#VOTE#`
      }
    }));

    const votes = votesQuery.Items || [];
    const answers = answersQuery.Items || [];
    
    console.log(`📊 Found ${answers.length} answers and ${votes.length} votes for question ${paddedQuestionNumber}`);
    
    if (answers.length === 0) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'No answers found for this question.' }),
        headers: { 'Access-Control-Allow-Origin': '*' }
      };
    }

    // Calculate vote tallies (using exact same logic as get-results.js)
    const voteTallies = {};
    const answerScores = {};

    // Initialize scores for each answer (by index, matching get-results.js)
    answers.forEach((answer, index) => {
      answerScores[index] = 0;
      voteTallies[index] = {
        answerText: answer.Answer,
        playerName: answer.PlayerName,
        firstPlace: 0,
        secondPlace: 0,
        thirdPlace: 0,
        totalScore: 0
      };
    });

    // Process each vote (exact logic from get-results.js)
    votes.forEach(vote => {
      const voteData = vote.Votes; // e.g., {"0": 1, "1": 2, "2": 3}
      
      Object.entries(voteData).forEach(([answerIndex, rank]) => {
        const idx = parseInt(answerIndex);
        const position = parseInt(rank);
        
        if (voteTallies[idx]) {
          // Award points using configurable scoring system
          let points = 0;
          if (position === 1) {
            voteTallies[idx].firstPlace++;
            points = scoringConfig.firstPlacePoints;
          } else if (position === 2) {
            voteTallies[idx].secondPlace++;
            points = scoringConfig.secondPlacePoints;
          } else if (position === 3) {
            voteTallies[idx].thirdPlace++;
            points = scoringConfig.thirdPlacePoints;
          }
          
          voteTallies[idx].totalScore += points;
          answerScores[idx] += points;
        }
      });
    });

    // Find winners (highest score) - using same logic as get-results.js
    const maxScore = Math.max(...Object.values(answerScores));
    const winners = [];
    
    Object.entries(answerScores).forEach(([index, score]) => {
      if (score === maxScore && voteTallies[index]) {
        winners.push({
          playerName: voteTallies[index].playerName,
          answerText: voteTallies[index].answerText,
          score: score
        });
      }
    });

    const results = {
      voteTallies: voteTallies,
      winners: winners,
      totalVotes: votes.length,
      maxScore: maxScore
    };

    const metadata = gameMetadata.Item;

    // Fetch question set details for AI context and custom instructions
    let customInstruction = null;
    let questionSetAiContext = null;
    let promptId = null;
    
    if (questionSetId) {
      try {
        const setResult = await db.send(new GetCommand({
          TableName: process.env.TABLE_NAME,
          Key: { PK: 'SETS', SK: `SET#${questionSetId}` }
        }));
        
        if (setResult.Item) {
          if (setResult.Item.customInstruction) {
            customInstruction = setResult.Item.customInstruction;
            console.log('📋 Found custom instruction for AI prompt:', customInstruction);
          }
          if (setResult.Item.aiContextInstruction) {
            questionSetAiContext = setResult.Item.aiContextInstruction;
            console.log('🎯 Found question set AI context:', questionSetAiContext);
          }
          if (setResult.Item.promptId) {
            promptId = setResult.Item.promptId;
            console.log('🎨 Found custom prompt ID:', promptId);
          }
        }
      } catch (fetchError) {
        console.log('⚠️ Could not fetch question set context:', fetchError.message);
      }
    }
    
    // Default prompt ID if none specified - find default prompt for the game type
    if (!promptId) {
      promptId = await findDefaultPromptId(metadata.GameType || 'call-and-answer');
      console.log(`📌 Using default prompt ID: ${promptId}`);
    }

    // Prepare data for AI
    const aiData = {
      eventTitle: metadata.EventTitle || metadata.Title || 'Engagement Event',
      gameType: metadata.GameType || 'call-and-answer',
      gameAiContext: metadata.AIContext || metadata.EngagementInfo || '',
      questionSetAiContext: questionSetAiContext,
      customInstruction: customInstruction,
      promptId: promptId,
      questionId: targetQuestionId,
      question: {
        title: question.Title,
        detail: question.Detail || '',
        category: question.Category
      },
      answers: answers.map(answer => ({
        playerName: answer.PlayerName,
        answer: answer.Answer
      })),
      results: {
        voteTallies: results.voteTallies,
        winners: results.winners,
        totalVotes: results.totalVotes
      }
    };

    // Generate AI summary
    const summaryData = await generateAISummary(aiData);

    // Store the enhanced AI summary in DynamoDB (keeping same storage key)
    const now = new Date().toISOString();
    await db.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: {
        PK: `GAME#${gameId}`,
        SK: `QUESTION#${paddedQuestionNumber}#AISummary`,
        GameId: gameId,
        QuestionId: targetQuestionId,
        Summary: summaryData.summary, // For backwards compatibility
        SummaryText: summaryData.summaryText,
        DiscussionQuestions: summaryData.discussionQuestions,
        NextSteps: summaryData.nextSteps,
        FullResponse: summaryData.fullResponse,
        MarkdownResponse: summaryData.markdownResponse,
        GeneratedAt: now,
        ttl: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60) // 30 days TTL
      }
    }));

    console.log(`✅ Enhanced AI summary generated and stored for ${gameId}: ${targetQuestionId}`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        gameId: gameId,
        questionId: targetQuestionId,
        summary: summaryData.summary,
        summaryText: summaryData.summaryText,
        discussionQuestions: summaryData.discussionQuestions,
        nextSteps: summaryData.nextSteps,
        markdownResponse: summaryData.markdownResponse,
        generatedAt: now,
        fromCache: false
      }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };

  } catch (error) {
    console.error('Get AI summary error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Failed to generate AI summary: ${error.message}` }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};

async function generateAISummary({ eventTitle, gameType, gameAiContext, questionSetAiContext, customInstruction, promptId, questionId, question, answers, results }) {
  // Prepare the context for AI
  const totalParticipants = answers.length;
  const winners = results.winners || [];
  const voteTallies = results.voteTallies || {};
  
  // Get top 3 answers based on vote tallies (by index like get-results.js)
  const sortedAnswers = Object.entries(voteTallies)
    .sort(([,a], [,b]) => b.totalScore - a.totalScore)
    .slice(0, 3);
  
  const topAnswers = sortedAnswers.map(([index, voteData]) => {
    return {
      playerName: voteData.playerName,
      answer: voteData.answerText,
      score: voteData.totalScore,
      votes: `${voteData.firstPlace} first, ${voteData.secondPlace} second, ${voteData.thirdPlace} third`
    };
  });

  // Fetch the prompt template
  const promptData = await fetchPromptFromS3(promptId);
  
  if (!promptData || !promptData.template) {
    console.error('❌ Failed to fetch prompt template, using final fallback');
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'AI prompt template not available',
        promptId: promptId,
        details: 'Please ensure default prompts are populated or use the admin tool to create this prompt'
      }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
  
  console.log(`📝 Using prompt template: ${promptData.name}`);
  
  // Use custom instruction if available, otherwise default context
  const sessionContext = customInstruction || 
    'an "Engagements" strategic thinking session where participants apply lessons to their work context';
  
  // Build context sections for the AI prompt
  const contextSections = [];
  if (gameAiContext) {
    contextSections.push(`SESSION BACKGROUND: ${gameAiContext}`);
  }
  if (questionSetAiContext) {
    contextSections.push(`QUESTION SET CONTEXT: ${questionSetAiContext}`);
  }
  if (customInstruction) {
    contextSections.push(`PARTICIPANT INSTRUCTIONS: "${customInstruction}"`);
  }

  // Create a more comprehensive answer list for the prompt
  console.log('🔍 DEBUG: AI Summary - answers structure:', answers.length > 0 ? answers[0] : 'No answers');
  console.log('🔍 DEBUG: AI Summary - voteTallies structure:', voteTallies);
  
  const rankedAnswers = answers.map((answer, idx) => {
    const voteData = voteTallies[idx] || { totalScore: 0 };
    const playerName = answer.playerName || answer.PlayerName;
    const answerText = answer.answer || answer.Answer;
    
    console.log(`🔍 DEBUG: AI Summary - Answer ${idx}: player="${playerName}", answer="${answerText}", score=${voteData.totalScore}`);
    
    return {
      player: playerName,
      answer: answerText,
      score: voteData.totalScore
    };
  }).sort((a, b) => b.score - a.score);

  // Build responses text with proper tie handling
  let currentRank = 1;
  const responsesText = rankedAnswers.map((answer, idx) => {
    // Handle ties: if current score is different from previous, update rank
    if (idx > 0 && answer.score !== rankedAnswers[idx - 1].score) {
      currentRank = idx + 1;
    }
    
    const rank = currentRank === 1 ? '🥇 1st Place' : 
               currentRank === 2 ? '🥈 2nd Place' : 
               currentRank === 3 ? '🥉 3rd Place' : 
               `${currentRank}th Place`;
               
    return `${rank}: ${answer.player} - "${answer.answer}" (${answer.score} vote points)`;
  }).join('\n\n');
  
  // Get question set metadata for additional context
  let questionSetName = 'Question Set';
  let questionSetDescription = '';
  let categoryCount = 0;
  let totalQuestionsInSet = 0;
  
  try {
    const setMetadata = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: 'SETS', SK: `SET#${questionSetId}` }
    }));
    
    if (setMetadata.Item) {
      questionSetName = setMetadata.Item.SetName || questionSetName;
      questionSetDescription = setMetadata.Item.Description || '';
      
      // Count categories and questions
      const allQuestions = await db.send(new QueryCommand({
        TableName: process.env.TABLE_NAME,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: {
          ':pk': `SET#${questionSetId}`,
          ':sk': 'q'
        }
      }));
      
      totalQuestionsInSet = allQuestions.Items?.length || 0;
      const categories = new Set(allQuestions.Items?.map(q => q.Category).filter(c => c));
      categoryCount = categories.size;
    }
  } catch (error) {
    console.log('⚠️ Could not fetch question set metadata:', error.message);
  }
  
  // Get current scores and leaderboard
  let leaderboard = [];
  let totalScores = '';
  let averageScore = 0;
  
  try {
    const scoresQuery = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `GAME#${gameId}`,
        ':sk': 'PLAYER#'
      }
    }));
    
    if (scoresQuery.Items) {
      const playerScores = scoresQuery.Items.map(player => ({
        name: player.PlayerName,
        score: player.TotalScore || 0
      })).sort((a, b) => b.score - a.score);
      
      leaderboard = playerScores;
      totalScores = playerScores.slice(0, 5).map((p, idx) => 
        `${idx + 1}. ${p.name}: ${p.score} pts`
      ).join(', ');
      
      if (playerScores.length > 0) {
        const totalSum = playerScores.reduce((sum, p) => sum + p.score, 0);
        averageScore = Math.round(totalSum / playerScores.length);
      }
    }
  } catch (error) {
    console.log('⚠️ Could not fetch player scores:', error.message);
  }
  
  // Get player names and active participants
  const playerNames = answers.map(a => a.PlayerName || a.playerName).filter((v, i, a) => a.indexOf(v) === i);
  const activeParticipants = votes.length;
  
  // Format voting data
  const voteData = votes.map(v => `${v.PlayerName || 'Player'} voted`).join(', ');
  const votingParticipation = totalParticipants > 0 ? Math.round((activeParticipants / totalParticipants) * 100) : 0;
  
  // Determine voting pattern
  let votingPattern = 'Diverse opinions';
  if (winners.length === 1 && winners[0].score > (results.totalVotes * 2)) {
    votingPattern = 'Clear consensus';
  } else if (winners.length > 1) {
    votingPattern = 'Split decision';
  }
  
  // Build vote tally string
  const voteTallyString = sortedAnswers.slice(0, 5).map(([idx, data], rank) => 
    `${rank + 1}. ${data.answerText} (${data.totalScore} points)`
  ).join(', ');
  
  // Format top voted answers
  const topVotedAnswers = topAnswers.map(a => 
    `${a.playerName}: ${a.score} points`
  ).join(', ');
  
  // Calculate consensus level
  let consensusLevel = 'Mixed opinions';
  if (winners.length === 1 && winners[0].score > (maxScore * 0.8)) {
    consensusLevel = 'Strong consensus';
  } else if (sortedAnswers.length > 1 && sortedAnswers[0][1].totalScore > (sortedAnswers[1][1].totalScore * 2)) {
    consensusLevel = 'Moderate consensus';
  }
  
  // Format final results
  const finalResults = sortedAnswers.slice(0, 3).map(([idx, data], rank) => {
    const emoji = rank === 0 ? '🥇' : rank === 1 ? '🥈' : '🥉';
    return `${emoji} ${data.answerText} (${data.totalScore} votes)`;
  }).join(', ');
  
  // Winner info
  const winnerInfo = winners.length > 0 ? 
    `Winner: ${winners[0].playerName} with "${winners[0].answerText}" (${winners[0].score} votes)` : 
    'No clear winner';
  
  // Results summary
  const resultsSummary = winners.length === 1 ? 
    `Clear winner with ${Math.round((winners[0].score / (results.totalVotes * 3)) * 100)}% of possible points` :
    winners.length > 1 ? 
    `${winners.length}-way tie for first place` :
    'No votes recorded';
  
  // Participation rate
  const participationRate = `${Math.round((answers.length / totalParticipants) * 100)}% answered, ${Math.round((activeParticipants / totalParticipants) * 100)}% voted`;
  
  // Get unique answers
  const uniqueAnswers = [...new Set(answers.map(a => a.Answer || a.answer))];
  const uniqueAnswersText = uniqueAnswers.slice(0, 5).join(', ');
  
  // Group answers by theme (simple grouping)
  const answerCategories = uniqueAnswers.length < 5 ? 
    `${uniqueAnswers.length} unique responses` :
    `${uniqueAnswers.length} unique responses across various themes`;
  
  // Player rankings
  const playerRankings = leaderboard.slice(0, 3).map((p, idx) => 
    `${idx + 1}st: ${p.name} (${p.score} pts)`
  ).join(', ');
  
  // Top performers
  const topPerformers = leaderboard.length > 0 ?
    `${leaderboard[0].name} leads with ${leaderboard[0].score} points` :
    'No scores recorded yet';
  
  // Round scores (for current question)
  const roundScores = sortedAnswers.slice(0, 3).map(([idx, data]) => 
    `${data.playerName}: +${data.totalScore} pts`
  ).join(', ');
  
  // Score changes (would need previous round data - placeholder for now)
  const scoreChanges = 'Score tracking for this round';
  
  // Current round/question number
  const currentRound = `Question ${parseInt(paddedQuestionNumber)}`;
  
  // Session duration (placeholder - would need game start time)
  const sessionDuration = 'Current session';
  
  // Scoring system explanation
  const scoringSystem = `1st place: ${scoringConfig.firstPlacePoints} pts, 2nd place: ${scoringConfig.secondPlacePoints} pts, 3rd place: ${scoringConfig.thirdPlacePoints} pt`;
  
  // Voting breakdown
  const votingBreakdown = sortedAnswers.slice(0, 3).map(([idx, data]) => 
    `${data.answerText}: ${data.firstPlace} first-place, ${data.secondPlace} second-place, ${data.thirdPlace} third-place votes`
  ).join('; ');
  
  // Format trivia/poll specific variables
  let triviaChoices = '';
  let pollOptions = '';
  let correctAnswer = '';
  let triviaResponses = '';
  let triviaCorrectness = '';
  
  // Check if this is a trivia or poll game
  if (gameType === 'trivia' && question) {
    // Format trivia choices
    const options = [];
    if (question.optionA) options.push(`A) ${question.optionA}`);
    if (question.optionB) options.push(`B) ${question.optionB}`);
    if (question.optionC) options.push(`C) ${question.optionC}`);
    if (question.optionD) options.push(`D) ${question.optionD}`);
    triviaChoices = options.join(', ');
    
    // Get correct answer(s)
    if (question.correctAnswer) {
      correctAnswer = question.correctAnswer;
      // If it's an option ID, convert to actual text
      if (correctAnswer.startsWith('Option')) {
        const optionLetter = correctAnswer.replace('Option', '');
        const optionField = `option${optionLetter}`;
        correctAnswer = question[optionField] || correctAnswer;
      }
    } else if (question.correctAnswers && Array.isArray(question.correctAnswers)) {
      // Handle multiple correct answers
      correctAnswer = question.correctAnswers.map(ans => {
        if (ans.startsWith('Option')) {
          const optionLetter = ans.replace('Option', '');
          const optionField = `option${optionLetter}`;
          return question[optionField] || ans;
        }
        return ans;
      }).join(', ');
    }
    
    // Calculate trivia response distribution
    const responseDistribution = {};
    let correctCount = 0;
    
    answers.forEach(answer => {
      const playerAnswer = answer.Answer || answer.answer;
      responseDistribution[playerAnswer] = (responseDistribution[playerAnswer] || 0) + 1;
      
      // Check if answer is correct
      if (question.correctAnswer === playerAnswer || 
          (question.correctAnswers && question.correctAnswers.includes(playerAnswer))) {
        correctCount++;
      }
    });
    
    // Format response distribution
    triviaResponses = Object.entries(responseDistribution)
      .map(([option, count]) => `${option}: ${count} players`)
      .join(', ');
    
    // Calculate correctness percentage
    if (totalParticipants > 0) {
      const correctPercentage = Math.round((correctCount / totalParticipants) * 100);
      triviaCorrectness = `${correctCount} of ${totalParticipants} players correct (${correctPercentage}%)`;
    }
  } else if (gameType === 'polls' && question) {
    // Format poll options
    const options = [];
    if (question.optionA) options.push(`Option 1: ${question.optionA}`);
    if (question.optionB) options.push(`Option 2: ${question.optionB}`);
    if (question.optionC) options.push(`Option 3: ${question.optionC}`);
    if (question.optionD) options.push(`Option 4: ${question.optionD}`);
    if (question.optionE) options.push(`Option 5: ${question.optionE}`);
    pollOptions = options.join(', ');
    
    // For polls, there's no correct answer, just distribution
    const responseDistribution = {};
    answers.forEach(answer => {
      const playerAnswer = answer.Answer || answer.answer;
      responseDistribution[playerAnswer] = (responseDistribution[playerAnswer] || 0) + 1;
    });
    
    // Format as a distribution
    triviaResponses = Object.entries(responseDistribution)
      .map(([option, count]) => `${option}: ${count} votes`)
      .join(', ');
  }
  
  // Player answers formatted
  const playerAnswers = answers.map(a => 
    `${a.PlayerName || a.playerName}: "${a.Answer || a.answer}"`
  ).join(', ');
  
  // Prepare all template variables (comprehensive set)
  const templateVars = {
    // SET INFO
    questionSetName: questionSetName,
    questionSetDescription: questionSetDescription,
    categoryCount: categoryCount,
    totalQuestions: totalQuestionsInSet,
    sessionContext: sessionContext,
    
    // GAME INFO
    eventTitle: eventTitle,
    gameType: gameType,
    gameId: gameId,
    sessionDuration: sessionDuration,
    currentRound: currentRound,
    totalScores: totalScores,
    
    // PLAYER INFO
    totalParticipants: totalParticipants,
    activeParticipants: activeParticipants,
    playerNames: playerNames.join(', '),
    playerRankings: playerRankings,
    topPerformers: topPerformers,
    
    // QUESTION INFO
    questionTitle: question.title,
    questionDetail: question.detail || 'No additional context provided',
    questionCategory: question.category,
    questionContext: question.detail || '',
    questionNumber: currentRound,
    triviaChoices: triviaChoices,
    pollOptions: pollOptions,
    correctAnswer: correctAnswer,
    
    // ANSWERS
    playerAnswers: playerAnswers,
    responseCount: rankedAnswers.length,
    uniqueAnswers: uniqueAnswersText,
    answerCategories: answerCategories,
    triviaResponses: triviaResponses,
    responsesText: responsesText,
    
    // VOTES
    voteData: voteData,
    voteCount: votes.length,
    votingParticipation: `${votingParticipation}%`,
    votingPattern: votingPattern,
    
    // VOTE TALLY
    voteTally: voteTallyString,
    topVotedAnswers: topVotedAnswers,
    votingBreakdown: votingBreakdown,
    consensusLevel: consensusLevel,
    
    // RESULTS
    finalResults: finalResults,
    winnerInfo: winnerInfo,
    resultsSummary: resultsSummary,
    participationRate: participationRate,
    triviaCorrectness: triviaCorrectness,
    
    // SCORES
    roundScores: roundScores,
    cumulativeScores: totalScores,
    scoreChanges: scoreChanges,
    leaderboard: leaderboard.slice(0, 5).map((p, idx) => 
      `${idx + 1}. ${p.name} (${p.score} pts)`
    ).join(', '),
    scoringSystem: scoringSystem,
    averageScore: `${averageScore} points`,
    
    // CONTEXT (backward compatibility)
    contextSections: contextSections.length > 0 ? ('\nCONTEXT INFORMATION:\n' + contextSections.join('\n') + '\n') : '',
    contextInstructions: contextSections.length > 0 ? 
      '\n\nIMPORTANT: Please tailor your analysis based on the provided context information above. Consider the specific background, goals, and instructions relevant to this session.' : 
      ''
  };
  
  // Replace template variables
  let prompt = promptData.template;
  for (const [key, value] of Object.entries(templateVars)) {
    const regex = new RegExp(`\\{${key}\\}`, 'g');
    prompt = prompt.replace(regex, value);
  }

  console.log('🤖 FULL AI PROMPT CONSTRUCTED:');
  console.log('=====================================');
  console.log(prompt);
  console.log('=====================================');

  console.log('🤖 BEDROCK: Attempting to call Claude 3.5 Sonnet...');
  console.log('🤖 BEDROCK: Inference Profile ARN: arn:aws:bedrock:us-east-1:239601476690:inference-profile/us.anthropic.claude-3-5-sonnet-20241022-v2:0');
  console.log('🤖 BEDROCK: Prompt length:', prompt.length);
  
  try {
    // Use Claude 3.5 Sonnet inference profile ARN
    const response = await bedrock.send(new InvokeModelCommand({
      modelId: 'arn:aws:bedrock:us-east-1:239601476690:inference-profile/us.anthropic.claude-3-5-sonnet-20241022-v2:0',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 2000,
        temperature: 0.7,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      })
    }));

    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    const aiResponse = responseBody.content[0].text.trim();
    
    console.log('✅ CLAUDE SUCCESS: Real AI response received');
    console.log('📝 AI Response preview:', aiResponse.substring(0, 200) + '...');
    
    // Parse the structured response
    const parsed = parseAIResponse(aiResponse);
    
    // Return structured data for storage
    return {
      summary: parsed.summaryText,
      summaryText: parsed.summaryText, // For backwards compatibility
      discussionQuestions: parsed.discussionQuestions,
      nextSteps: parsed.nextSteps,
      fullResponse: aiResponse,
      markdownResponse: parsed.markdownResponse,
      model: 'claude-3.5-sonnet' // Track which model was used
    };

  } catch (error) {
    console.error('🚨 BEDROCK API ERROR (Claude 3.5 Sonnet):');
    console.error('  Error name:', error.name);
    console.error('  Error message:', error.message);
    console.error('  Error code:', error.code || error.$metadata?.httpStatusCode);
    console.error('  Full error:', JSON.stringify(error, null, 2));
    
    console.log('🔄 BEDROCK: Trying Claude 3.5 Haiku as fallback...');
    console.log('🤖 BEDROCK: Haiku Inference Profile ARN: arn:aws:bedrock:us-east-1:239601476690:inference-profile/us.anthropic.claude-3-5-haiku-20241022-v1:0');
    
    // Try Claude 3.5 Haiku inference profile ARN as fallback
    try {
      const haikuResponse = await bedrock.send(new InvokeModelCommand({
        modelId: 'arn:aws:bedrock:us-east-1:239601476690:inference-profile/us.anthropic.claude-3-5-haiku-20241022-v1:0',
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 2000,
          temperature: 0.7,
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ]
        })
      }));

      const haikuResponseBody = JSON.parse(new TextDecoder().decode(haikuResponse.body));
      const haikuAiResponse = haikuResponseBody.content[0].text.trim();
      
      console.log('✅ BEDROCK HAIKU SUCCESS: AI response received');
      console.log('📝 Haiku Response preview:', haikuAiResponse.substring(0, 200) + '...');
      
      // Parse the structured response
      const parsed = parseAIResponse(haikuAiResponse);
      
      // Return structured data for storage
      return {
        summary: parsed.summaryText,
        summaryText: parsed.summaryText,
        discussionQuestions: parsed.discussionQuestions,
        nextSteps: parsed.nextSteps,
        fullResponse: haikuAiResponse,
        model: 'claude-3.5-haiku' // Track which model was used
      };
      
    } catch (haikuError) {
      console.error('🚨 BEDROCK HAIKU ALSO FAILED:');
      console.error('  Haiku Error:', haikuError.message);
      
      // Final fallback structured response if both AI models fail
      const winner = rankedAnswers && rankedAnswers.length > 0 ? rankedAnswers[0] : null;
      const fallbackSummary = winner && winner.player && winner.answer
        ? `Great responses to this question! ${winner.player} takes the lead with "${winner.answer}" earning ${winner.score} points from the group. The creativity and thoughtfulness in all ${totalParticipants} answers really shows the engagement of our participants!`
        : `Fantastic participation from all ${totalParticipants} participants! The variety and creativity in the answers really showcased everyone's engagement with this question.`;
      
      console.log(`🚨 BEDROCK FINAL FALLBACK: Using static response. Winner:`, winner, 'TotalParticipants:', totalParticipants);
      
      return {
        summary: fallbackSummary,
        summaryText: fallbackSummary,
        discussionQuestions: [],
        nextSteps: [],
        fullResponse: fallbackSummary,
        model: 'fallback'
      };
    }
  }
}