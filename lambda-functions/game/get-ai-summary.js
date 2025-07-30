const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');

const bedrock = new BedrockRuntimeClient({ region: 'us-east-1' });
const dynamoClient = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(dynamoClient);
const s3 = new S3Client({ region: 'us-east-1' });

// Parse Claude's response - standardized markdown headers (## Summary, ## Discussion Questions, ## Next Steps)
const parseAIResponse = (aiResponse) => {
  console.log('🔍 PARSING: Full AI response length:', aiResponse.length);
  console.log('🔍 PARSING: First 300 chars:', aiResponse.substring(0, 300));
  
  // Clean up and normalize any non-standard headers to our expected format
  let cleanedResponse = aiResponse
    .replace(/##\s*(Results|Dive\s*Deep|Game\s*Status|Insights?|Analysis)/gim, '## Summary')
    .replace(/##\s*(Discussion\s*Topics?|Questions?)/gim, '## Discussion Questions')
    .replace(/##\s*(Next\s*Steps?|Actions?|Recommendations?)/gim, '## Next Steps')
    .replace(/🎡\s*Next\s*Steps/g, '## Next Steps') // Handle emoji headers
    .replace(/💬\s*Discussion\s*Topics/g, '## Discussion Questions'); // Handle emoji headers
  
  console.log('🔍 PARSING: Cleaned response headers for consistency');
  
  // Extract content sections using cleaned markdown headers
  let summaryText = '';
  let discussionQuestions = [];
  let nextSteps = [];
  
  // Extract summary (content between "## Summary" and next ## section)
  const summaryMatch = cleanedResponse.match(/##\s*Summary[^\n]*\n([\s\S]*?)(?=\n##|$)/i);
  if (summaryMatch) {
    summaryText = summaryMatch[1].trim();
    // Remove any embedded markdown headers from within the summary
    summaryText = summaryText.replace(/##\s*[^\n]*\n?/g, '').trim();
    console.log('🔍 PARSING: Extracted summary:', summaryText.substring(0, 100) + '...');
  }
  
  // Extract discussion questions (content between "## Discussion Questions" and next ## section)
  const discussionMatch = cleanedResponse.match(/##\s*Discussion\s*Questions[^\n]*\n([\s\S]*?)(?=\n##|$)/i);
  if (discussionMatch) {
    const discussionText = discussionMatch[1];
    // Extract numbered list items (1., 2., 3., etc.)
    const listItems = discussionText.match(/^\d+\.\s*(.*?)(?=\n\d+\.|$)/gm);
    if (listItems) {
      discussionQuestions = listItems.map(item => item.replace(/^\d+\.\s*/, '').trim());
    } else {
      // Fallback: split by lines and filter non-empty
      discussionQuestions = discussionText.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.startsWith('#'))
        .slice(0, 3); // Limit to 3 questions
    }
    console.log('🔍 PARSING: Extracted discussion questions:', discussionQuestions);
  }
  
  // Extract next steps (content between "## Next Steps" and end)
  const nextStepsMatch = cleanedResponse.match(/##\s*Next\s*Steps[^\n]*\n([\s\S]*?)$/i);
  if (nextStepsMatch) {
    const nextStepsText = nextStepsMatch[1];
    // Extract numbered list items (1., 2., 3., etc.)
    const listItems = nextStepsText.match(/^\d+\.\s*(.*?)(?=\n\d+\.|$)/gm);
    if (listItems) {
      nextSteps = listItems.map(item => item.replace(/^\d+\.\s*/, '').trim());
    } else {
      // Fallback: split by lines and filter non-empty
      nextSteps = nextStepsText.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.startsWith('#'))
        .slice(0, 4); // Limit to 4 steps
    }
    console.log('🔍 PARSING: Extracted next steps:', nextSteps);
  }
  
  // Fallback for summary if empty - use first paragraph that's not a header
  if (!summaryText || summaryText.length < 20) {
    console.log('⚠️ PARSING: Summary too short, using first paragraph as fallback');
    const firstParagraph = cleanedResponse.split('\n').find(line => line.trim().length > 20 && !line.startsWith('#'));
    summaryText = firstParagraph ? firstParagraph.trim() : cleanedResponse.trim();
  }
  
  return {
    summaryText: summaryText,
    discussionQuestions: discussionQuestions,
    nextSteps: nextSteps,
    markdownResponse: cleanedResponse
  };
};

// Fetch AI prompt from S3
const fetchPromptFromS3 = async (promptId) => {
  try {
    console.log(`📄 Fetching prompt ${promptId} from S3...`);
    
    // First get the prompt record from DynamoDB to get the correct S3 key
    const dbResult = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: 'AIPROMPTS', SK: `AIPROMPT#${promptId}` }
    }));
    
    if (!dbResult.Item) {
      console.error(`❌ Prompt ${promptId} not found in DynamoDB`);
      return null;
    }
    
    const promptRecord = dbResult.Item;
    const s3Key = promptRecord.s3Key;
    
    if (!s3Key) {
      console.error(`❌ No S3 key found in prompt record for ${promptId}`);
      return null;
    }
    
    console.log(`📄 Using S3 Key from DB record: ${s3Key}`);
    
    const response = await s3.send(new GetObjectCommand({
      Bucket: process.env.AI_PROMPTS_BUCKET,
      Key: s3Key
    }));
    
    const promptData = JSON.parse(await response.Body.transformToString());
    console.log(`✅ Successfully fetched prompt: ${promptData.name || 'Unknown'}`);
    
    return promptData;
  } catch (error) {
    console.error(`❌ Error fetching prompt ${promptId}:`, error);
    
    // Try to get the DynamoDB record as final fallback
    try {
      const dbResult = await db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: 'AIPROMPTS', SK: `AIPROMPT#${promptId}` }
      }));
      
      if (dbResult.Item) {
        console.log(`✅ Using DynamoDB record as fallback for prompt ${promptId}`);
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
        template: `You are an expert business strategist analyzing team responses from {sessionContext}.

QUESTION ANALYSIS:
Question: "{questionTitle}"
Category: {questionCategory}
Full Context: {questionDetail}
{contextSections}

TOP RESULTS (Team's Collective Choice):
{winnerInfo}
{topVotedAnswers}

COMPLETE RESPONSE RANKING ({responseCount} total responses):
{responsesText}

VOTING INSIGHTS:
- Participation: {votingParticipation} 
- Pattern: {votingPattern}
- Consensus Level: {consensusLevel}
- Vote Distribution: {votingBreakdown}

STRATEGIC ANALYSIS INSTRUCTIONS:
The team has spoken through their votes. The top-ranked responses above represent their collective judgment on "{questionTitle}". Your role is to extract strategic insights that build on what the team prioritized and provide actionable direction.{contextInstructions}

Key Focus Areas:
1. Why did the team gravitate toward the top responses?
2. What strategic themes emerge from their choices?
3. How can these insights drive concrete action?
4. What deeper questions does this raise?

Please provide your strategic analysis in this EXACT format for reliable parsing:

=== SUMMARY ===
[Write 2-3 sentences that synthesize the strategic themes from the TOP-RANKED responses. Focus on why the team prioritized these particular insights and what they reveal about strategic thinking. Reference specific winning responses by name/content.]

=== DISCUSSION QUESTIONS ===
Q1: [Build directly on the winning response(s). Why did the team choose this direction? What does it reveal about priorities or challenges?]
Q2: [Explore tensions or trade-offs revealed by comparing the top responses. What strategic choices does this highlight?]
Q3: [Look forward: How can the team build on these insights? What's the next level of strategic thinking needed?]

=== NEXT STEPS ===
STEP1: [Concrete action based on the #1 response. Be specific about what the team can do immediately.]
STEP2: [Secondary action that leverages other top responses. Show how to integrate multiple winning insights.]
STEP3: [Strategic follow-up that addresses the question's deeper implications for the organization.]
STEP4: [Measurement or validation step to track progress on these insights.]

Ground every insight in the actual responses the team prioritized. Be specific about who said what and why their collective choice matters strategically.`,
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
    const normalizedGameType = gameType === 'call-and-answer' ? 'callandanswer' : 
                              gameType === 'wavelength' ? 'wavelength' : gameType;
    
    // Scan for default prompts matching the game type
    const scanResult = await db.send(new ScanCommand({
      TableName: process.env.TABLE_NAME,
      FilterExpression: 'PK = :pk AND gameType = :gameType AND isDefault = :isDefault',
      ExpressionAttributeValues: {
        ':pk': 'AIPROMPTS',
        ':gameType': normalizedGameType,
        ':isDefault': true
      }
    }));

    if (scanResult.Items && scanResult.Items.length > 0) {
      // Prefer category based on game type
      let defaultPrompt;
      if (normalizedGameType === 'callandanswer') {
        defaultPrompt = scanResult.Items.find(item => item.category === 'lessons-learned') || scanResult.Items[0];
      } else if (normalizedGameType === 'trivia') {
        defaultPrompt = scanResult.Items.find(item => item.category === 'general') || scanResult.Items[0];
      } else {
        defaultPrompt = scanResult.Items[0]; // For polls or other types, just take the first one
      }
      console.log(`✅ Found default prompt: ${defaultPrompt.promptId} (${defaultPrompt.name}) for ${normalizedGameType}`);
      return defaultPrompt.promptId;
    }

    // Final fallback - return a hardcoded default based on game type
    const fallbackPrompt = normalizedGameType === 'trivia' ? 'trivia-basic' : 'lessons-learned';
    console.log(`⚠️ No default prompt found for ${gameType}, using hardcoded fallback: ${fallbackPrompt}`);
    return fallbackPrompt;
    
  } catch (error) {
    console.error(`❌ Error finding default prompt for ${gameType}:`, error);
    const fallbackPrompt = gameType === 'trivia' ? 'trivia-basic' : 'lessons-learned';
    return fallbackPrompt; // Fallback
  }
};

exports.handler = async (event) => {
  try {
    const { gameId } = event.pathParameters || {};
    const queryParams = event.queryStringParameters || {};
    const { questionId, generateNew, debug, promptDebug } = queryParams;

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
        const responseData = {
          gameId: gameId,
          questionId: targetQuestionId,
          summary: existingSummary.Item.Summary || existingSummary.Item.SummaryText,
          summaryText: existingSummary.Item.SummaryText || existingSummary.Item.Summary,
          discussionQuestions: existingSummary.Item.DiscussionQuestions || [],
          nextSteps: existingSummary.Item.NextSteps || [],
          markdownResponse: existingSummary.Item.MarkdownResponse || null,
          generatedAt: existingSummary.Item.GeneratedAt,
          fromCache: true
        };
        
        // Add debug information if debug mode is enabled
        if (debug === 'true' && existingSummary.Item.DebugInfo) {
          responseData.debugPrompt = existingSummary.Item.DebugInfo.fullPrompt || 'Debug info not available';
          responseData.debugProvenance = existingSummary.Item.DebugInfo.promptProvenance || null;
        }
        
        // Add prompt debug information if prompt debug mode is enabled
        if (promptDebug === 'true' && existingSummary.Item.DebugInfo) {
          responseData.templateVariables = existingSummary.Item.DebugInfo.templateVariables || {};
          responseData.promptTemplate = existingSummary.Item.DebugInfo.promptTemplate || '';
          responseData.promptName = existingSummary.Item.DebugInfo.promptName || '';
          responseData.promptSource = existingSummary.Item.DebugInfo.promptSource || '';
        }
        
        return {
          statusCode: 200,
          body: JSON.stringify(responseData),
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

    // Extract scoring configuration and game type early since they're used in vote processing
    const gameType = gameMetadata.Item.GameType || 'call-and-answer';
    const scoringConfig = gameMetadata.Item.ScoringConfig || {
      firstPlacePoints: 3,
      secondPlacePoints: 2,
      thirdPlacePoints: 1,
      participationPoints: 0
    };

    console.log(`🔍 DEBUG: Getting question for AI Summary - gameId: ${gameId}, paddedQuestionNumber: ${paddedQuestionNumber}`);
    
    // Use the same question retrieval logic as get-results.js
    let question = null;
    let questionSetId = null;
    try {
      // Get question reference record (same as get-results.js)
      const questionRef = await db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: `GAME#${gameId}`, SK: `QUESTION#${paddedQuestionNumber}#REF` }
      }));
      
      if (questionRef.Item) {
        const sourceQuestionId = questionRef.Item.SourceQuestionId;
        questionSetId = questionRef.Item.SetId;
        
        console.log(`📋 Found question reference: ${sourceQuestionId} from set ${questionSetId}`);
        
        // Get the actual question from the question set (same as get-results.js)
        const questionResponse = await db.send(new GetCommand({
          TableName: process.env.TABLE_NAME,
          Key: { 
            PK: `SET#${questionSetId}`, 
            SK: sourceQuestionId 
          }
        }));
        question = questionResponse.Item;
        console.log(`📋 Question data fetched from question set:`, question ? 'Success' : 'Not found');
      } else {
        console.log(`❌ Question reference not found: QUESTION#${paddedQuestionNumber}#REF`);
      }
    } catch (error) {
      console.error(`❌ Error fetching question data:`, error);
    }
    
    console.log(`📋 Question query result:`, question ? 'Found' : 'Not found');
    if (question) {
      console.log('🔍 RAW QUESTION DATA FIELDS:', Object.keys(question));
      console.log('🔍 RAW QUESTION DATA SAMPLE:', {
        correctAnswer: question.correctAnswer,
        CorrectAnswer: question.CorrectAnswer,
        optionA: question.optionA,
        OptionA: question.OptionA,
        answerDetails: question.answerDetails,
        AnswerDetails: question.AnswerDetails
      });
    }

    // If question not found in set, create a fallback question object
    if (!question) {
      console.log(`⚠️ Question not found, using fallback`);
      question = {
        title: `Question ${paddedQuestionNumber}`,
        questionDetail: 'Question details not available',
        category: 'General',
        Title: `Question ${paddedQuestionNumber}`,
        Detail: 'Question details not available',
        Category: 'General'
      };
    }
    
    // Use questionSetId from game metadata as fallback if not found in reference
    if (!questionSetId) {
      questionSetId = gameMetadata.Item.QuestionSetId;
      console.log(`📋 Using fallback questionSetId from game metadata: ${questionSetId}`);
    }
    
    // Normalize field names for consistency (trivia uses lowercase, others use titlecase)
    if (question) {
      question.title = question.title || question.Title;
      question.questionDetail = question.questionDetail || question.Detail || question.detail;
      question.category = question.category || question.Category;
      
      // Normalize trivia-specific fields
      question.correctAnswer = question.correctAnswer || question.CorrectAnswer;
      question.correctAnswers = question.correctAnswers || question.CorrectAnswers;
      question.optionA = question.optionA || question.OptionA;
      question.optionB = question.optionB || question.OptionB;
      question.optionC = question.optionC || question.OptionC;
      question.optionD = question.optionD || question.OptionD;
      question.optionE = question.optionE || question.OptionE;
      question.optionF = question.optionF || question.OptionF;
      question.answerDetails = question.answerDetails || question.AnswerDetails;
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

    // Process each vote (exact logic from get-results.js) - skip for trivia and wavelength games
    if (votes && votes.length > 0 && gameType !== 'trivia' && gameType !== 'wavelength') {
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
    } else if (gameType === 'trivia') {
      // For trivia games, use actual points earned by players (from get-results.js trivia processing)
      answers.forEach((answer, index) => {
        // Use actual points earned from the answer record
        const pointsEarned = answer.PointsEarned || answer.pointsEarned || 0;
        const isCorrect = answer.IsCorrect || answer.isCorrect || false;
        
        voteTallies[index].totalScore = pointsEarned;
        answerScores[index] = pointsEarned;
        voteTallies[index].isCorrect = isCorrect;
        voteTallies[index].basePoints = answer.BasePoints || answer.basePoints || 0;
        voteTallies[index].speedBonus = answer.SpeedBonus || answer.speedBonus || 0;
        voteTallies[index].responseTime = answer.ResponseTimeMs || answer.responseTimeMs || 0;
        
        console.log(`🔍 AI TRIVIA DEBUG - Player ${voteTallies[index].playerName}: points=${pointsEarned}, correct=${isCorrect}, base=${voteTallies[index].basePoints}, bonus=${voteTallies[index].speedBonus}`);
      });
    } else if (gameType === 'wavelength') {
      // For wavelength games, everyone gets the same team score (number of common words found)
      const teamScore = (commonWords && Array.isArray(commonWords)) ? commonWords.length : 0;
      
      answers.forEach((answer, index) => {
        voteTallies[index].totalScore = teamScore;
        voteTallies[index].teamScore = teamScore;
        voteTallies[index].wordsSubmitted = (answer.Answer || answer.answer || '').split(',').filter(w => w.trim()).length;
        answerScores[index] = teamScore;
        
        console.log(`🌊 AI WAVELENGTH DEBUG - Player ${voteTallies[index].playerName}: team score=${teamScore}, words submitted=${voteTallies[index].wordsSubmitted}`);
      });
    }

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
      totalVotes: votes ? votes.length : 0,
      maxScore: maxScore
    };

    const metadata = gameMetadata.Item;

    // Fetch question set details for AI context and custom instructions
    let customInstruction = null;
    let questionSetAiContext = null;
    let promptId = null;
    let promptProvenance = {
      source: 'fallback',
      details: 'Using hardcoded fallback prompt',
      hierarchy: []
    };
    
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
            promptProvenance.hierarchy.push({
              type: 'customInstruction',
              source: 'question_set',
              value: customInstruction
            });
          }
          if (setResult.Item.aiContextInstruction) {
            questionSetAiContext = setResult.Item.aiContextInstruction;
            console.log('🎯 Found question set AI context:', questionSetAiContext);
            promptProvenance.hierarchy.push({
              type: 'aiContext',
              source: 'question_set',
              value: questionSetAiContext
            });
          }
          if (setResult.Item.promptId) {
            promptId = setResult.Item.promptId;
            console.log('🎨 Found custom prompt ID:', promptId);
            promptProvenance = {
              source: 'question_set',
              details: `Custom prompt "${promptId}" attached to question set "${setResult.Item.SetName || questionSetId}"`,
              promptId: promptId,
              promptName: setResult.Item.promptName || promptId,
              hierarchy: promptProvenance.hierarchy
            };
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
      
      // Check if this is a default for the category or just the game type
      try {
        const defaultPromptInfo = await db.send(new GetCommand({
          TableName: process.env.TABLE_NAME,
          Key: { PK: 'AIPROMPTS', SK: `AIPROMPT#${promptId}` }
        }));
        
        if (defaultPromptInfo.Item) {
          const hasCategory = defaultPromptInfo.Item.category && defaultPromptInfo.Item.category !== metadata.GameType;
          promptProvenance = {
            source: hasCategory ? 'default_category' : 'default_game_type',
            details: hasCategory 
              ? `Default prompt for ${metadata.GameType} games with "${defaultPromptInfo.Item.category}" category`
              : `Default prompt for ${metadata.GameType} games`,
            promptId: promptId,
            promptName: defaultPromptInfo.Item.name || promptId,
            gameType: metadata.GameType,
            category: defaultPromptInfo.Item.category,
            hierarchy: promptProvenance.hierarchy
          };
        }
      } catch (error) {
        console.log('⚠️ Could not fetch default prompt info:', error.message);
        promptProvenance = {
          source: 'default_game_type',
          details: `Default prompt for ${metadata.GameType} games (details unavailable)`,
          promptId: promptId,
          gameType: metadata.GameType,
          hierarchy: promptProvenance.hierarchy
        };
      }
    }

    // Prepare data for AI
    const aiData = {
      eventTitle: metadata.EventTitle || metadata.Title || 'Engagement Event',
      gameType: metadata.GameType || 'call-and-answer',
      gameAiContext: metadata.AIContext || metadata.EngagementInfo || '',
      questionSetAiContext: questionSetAiContext,
      customInstruction: customInstruction,
      promptId: promptId,
      promptProvenance: promptProvenance,
      debugMode: debug === 'true',
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
      },
      votes: votes || [],
      gameId: gameId,
      questionSetId: questionSetId,
      paddedQuestionNumber: paddedQuestionNumber,
      scoringConfig: scoringConfig
    };

    // Generate AI summary
    const summaryData = await generateAISummary(aiData);

    // Store the enhanced AI summary in DynamoDB (keeping same storage key)
    const now = new Date().toISOString();
    const dbItem = {
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
    };
    
    // Store debug information if available
    if (summaryData.debugInfo) {
      dbItem.DebugInfo = summaryData.debugInfo;
    }
    
    await db.send(new PutCommand({
      TableName: process.env.TABLE_NAME,
      Item: dbItem
    }));

    console.log(`✅ Enhanced AI summary generated and stored for ${gameId}: ${targetQuestionId}`);

    const responseData = {
      gameId: gameId,
      questionId: targetQuestionId,
      summary: summaryData.summary,
      summaryText: summaryData.summaryText,
      discussionQuestions: summaryData.discussionQuestions,
      nextSteps: summaryData.nextSteps,
      markdownResponse: summaryData.markdownResponse,
      generatedAt: now,
      fromCache: false
    };
    
    // Add debug information if debug mode is enabled
    if (debug === 'true' && summaryData.debugInfo) {
      responseData.debugPrompt = summaryData.debugInfo.fullPrompt;
      responseData.debugProvenance = summaryData.debugInfo.promptProvenance;
    }
    
    // Add prompt debug information if prompt debug mode is enabled
    if (promptDebug === 'true' && summaryData.debugInfo) {
      responseData.templateVariables = summaryData.debugInfo.templateVariables || {};
      responseData.promptTemplate = summaryData.debugInfo.promptTemplate || '';
      responseData.promptName = summaryData.debugInfo.promptName || '';
      responseData.promptSource = summaryData.debugInfo.promptSource || '';
    }

    return {
      statusCode: 200,
      body: JSON.stringify(responseData),
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

async function generateAISummary({ eventTitle, gameType, gameAiContext, questionSetAiContext, customInstruction, promptId, promptProvenance, debugMode, questionId, question, answers, results, votes, gameId, questionSetId, paddedQuestionNumber, scoringConfig }) {
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
  
  if (!promptData || (!promptData.template && (!promptData.instructions || !promptData.outputFormat))) {
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

  // Build responses text with proper tie handling and game-type specific point formatting
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
    
    // Use appropriate point terminology based on game type
    const pointsLabel = gameType === 'trivia' ? 'points' : 'vote points';
    return `${rank}: ${answer.player} - "${answer.answer}" (${answer.score} ${pointsLabel})`;
  }).join('\n\n');
  
  // Get question set metadata for additional context
  let questionSetName = 'Question Set';
  let questionSetDescription = '';
  let categoryCount = 0;
  let totalQuestionsInSet = 0;
  
  try {
    // Try the current metadata structure first (SET#{id} / METADATA)
    const setMetadata = await db.send(new GetCommand({
      TableName: process.env.TABLE_NAME,
      Key: { PK: `SET#${questionSetId}`, SK: 'METADATA' }
    }));
    
    if (setMetadata.Item && setMetadata.Item.metadata) {
      questionSetName = setMetadata.Item.metadata.name || questionSetName;
      questionSetDescription = setMetadata.Item.metadata.description || '';
      categoryCount = setMetadata.Item.metadata.categoryCount || 0;
      console.log(`📚 Found question set metadata: ${questionSetName} - ${questionSetDescription}`);
    } else {
      // Fallback to old structure
      const oldSetMetadata = await db.send(new GetCommand({
        TableName: process.env.TABLE_NAME,
        Key: { PK: 'SETS', SK: `SET#${questionSetId}` }
      }));
      
      if (oldSetMetadata.Item) {
        questionSetName = oldSetMetadata.Item.SetName || questionSetName;
        questionSetDescription = oldSetMetadata.Item.Description || '';
        console.log(`📚 Found question set metadata (old structure): ${questionSetName} - ${questionSetDescription}`);
      }
    }
    
    // Count questions in the set
    const allQuestions = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: {
        ':pk': `SET#${questionSetId}`,
        ':sk': 'QUESTION#'  // Questions are stored with SK pattern: QUESTION#{categoryId}#{questionNumber}
      }
    }));
    
    totalQuestionsInSet = allQuestions.Items?.length || 0;
    const categories = new Set(allQuestions.Items?.map(q => q.Category).filter(c => c));
    categoryCount = categories.size;
  } catch (error) {
    console.log('⚠️ Could not fetch question set metadata:', error.message);
  }
  
  // Get current scores and leaderboard
  let leaderboard = [];
  let totalScores = '';
  let averageScore = 0;
  
  try {
    // Query for player score records using efficient SK pattern
    const scoresQuery = await db.send(new QueryCommand({
      TableName: process.env.TABLE_NAME,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': `GAME#${gameId}`,
        ':skPrefix': 'PLAYER#'
      }
    }));
    
    // Filter for score records only (SK contains '#SCORE')
    const scoreRecords = scoresQuery.Items?.filter(item => item.SK && item.SK.includes('#SCORE')) || [];
    
    if (scoreRecords.length > 0) {
      console.log(`📊 Found ${scoreRecords.length} player score records`);
      const playerScores = scoreRecords.map(scoreRecord => ({
        name: scoreRecord.PlayerName,
        score: scoreRecord.score || 0  // Note: lowercase 'score' based on get-results.js
      })).sort((a, b) => b.score - a.score);
      
      leaderboard = playerScores;
      totalScores = playerScores.slice(0, 5).map((p, idx) => 
        `${idx + 1}. ${p.name}: ${p.score} pts`
      ).join(', ');
      
      if (playerScores.length > 0) {
        const totalSum = playerScores.reduce((sum, p) => sum + p.score, 0);
        averageScore = Math.round(totalSum / playerScores.length);
      }
      
      console.log(`📊 Total game scores - Top 5: ${totalScores}`);
      console.log(`📊 Average score: ${averageScore}`);
    } else {
      console.log('⚠️ No player score records found');
      totalScores = '';  // Empty string when no scores exist (will show as empty in template)
    }
  } catch (error) {
    console.log('⚠️ Could not fetch player scores:', error.message);
  }
  
  // Get player names and active participants
  const playerNames = answers.map(a => a.PlayerName || a.playerName).filter((v, i, a) => a.indexOf(v) === i);
  const activeParticipants = (votes && votes.length > 0) ? votes.length : answers.length; // For trivia, use answer count instead of votes
  
  // Format voting data (trivia games don't have votes)
  const voteData = (votes && votes.length > 0) ? 
    votes.map(v => `${v.PlayerName || 'Player'} voted`).join(', ') : 
    'No voting for trivia questions';
  const votingParticipation = totalParticipants > 0 ? Math.round((activeParticipants / totalParticipants) * 100) : 0;
  
  // Determine voting pattern
  let votingPattern = 'Diverse opinions';
  if (gameType === 'trivia') {
    votingPattern = 'Trivia scoring - no voting';
  } else if (gameType === 'wavelength') {
    votingPattern = 'Wavelength word association - team scoring';
  } else if (votes && votes.length > 0) {
    if (winners.length === 1 && winners[0].score > (results.totalVotes * 2)) {
      votingPattern = 'Clear consensus';
    } else if (winners.length > 1) {
      votingPattern = 'Split decision';
    }
  }
  
  // Build results string (vote tally for call-and-answer, score tally for trivia)
  const resultsString = gameType === 'trivia' ? 
    sortedAnswers.slice(0, 5).map(([idx, data], rank) => 
      `${rank + 1}. ${data.playerName}: ${data.answerText} - ${data.totalScore} points ${data.isCorrect ? '(Correct)' : '(Incorrect)'}`
    ).join(', ') :
    sortedAnswers.slice(0, 5).map(([idx, data], rank) => 
      `${rank + 1}. ${data.answerText} (${data.totalScore} vote points)`
    ).join(', ');
  
  // Format top answers (different for trivia vs voting)
  const topAnswers_formatted = gameType === 'trivia' ?
    topAnswers.map(a => 
      `${a.playerName}: ${a.answer} - ${a.score} points`
    ).join(', ') :
    topAnswers.map(a => 
      `${a.playerName}: ${a.score} vote points`
    ).join(', ');
  
  // Initialize wavelength variables early to avoid undefined errors
  let commonWords = [];
  let connectionScore = 0;
  let totalUniqueWords = 0;

  // Calculate consensus level
  let consensusLevel = 'Mixed opinions';
  if (gameType === 'trivia') {
    consensusLevel = 'Trivia results - no consensus voting';
  } else if (gameType === 'wavelength') {
    consensusLevel = `Team collaboration - ${connectionScore}% word connection rate`;
  } else if (winners.length === 1 && winners[0].score > (results.maxScore * 0.8)) {
    consensusLevel = 'Strong consensus';
  } else if (sortedAnswers.length > 1 && sortedAnswers[0][1].totalScore > (sortedAnswers[1][1].totalScore * 2)) {
    consensusLevel = 'Moderate consensus';
  }
  
  // Format final results (different for trivia vs voting)
  const finalResults = gameType === 'trivia' ?
    sortedAnswers.slice(0, 3).map(([idx, data], rank) => {
      const emoji = rank === 0 ? '🥇' : rank === 1 ? '🥈' : '🥉';
      return `${emoji} ${data.playerName}: ${data.answerText} (${data.totalScore} points, ${data.isCorrect ? 'Correct' : 'Incorrect'})`;
    }).join(', ') :
    sortedAnswers.slice(0, 3).map(([idx, data], rank) => {
      const emoji = rank === 0 ? '🥇' : rank === 1 ? '🥈' : '🥉';
      return `${emoji} ${data.answerText} (${data.totalScore} votes)`;
    }).join(', ');
  
  // Winner info (different format for trivia vs voting)
  const winnerInfo = winners.length > 0 ? 
    gameType === 'trivia' ?
      `Winner: ${winners[0].playerName} with "${winners[0].answerText}" (${winners[0].score} points)` :
      `Winner: ${winners[0].playerName} with "${winners[0].answerText}" (${winners[0].score} vote points)` : 
    'No clear winner';
  
  // Results summary (different for trivia vs wavelength vs voting) - wavelength will be updated later
  let resultsSummary = '';
  if (gameType === 'trivia') {
    resultsSummary = winners.length === 1 ? 
      `Clear winner with ${winners[0].score} points` :
      winners.length > 1 ? 
      `${winners.length}-way tie for first place with ${winners[0].score} points each` :
      'No correct answers';
  } else if (gameType === 'wavelength') {
    resultsSummary = `Team found ${commonWords.length} common words with ${connectionScore}% connection rate`;
  } else {
    resultsSummary = winners.length === 1 ? 
      `Clear winner with ${Math.round((winners[0].score / (results.totalVotes * 3)) * 100)}% of possible vote points` :
      winners.length > 1 ? 
      `${winners.length}-way tie for first place` :
      'No votes recorded';
  }
  
  // Participation rate
  const participationRate = `${Math.round((answers.length / totalParticipants) * 100)}% answered, ${Math.round((activeParticipants / totalParticipants) * 100)}% voted`;
  
  // Get unique answers
  const uniqueAnswers = [...new Set(answers.map(a => a.Answer || a.answer))];
  const uniqueAnswersText = uniqueAnswers.slice(0, 5).join(', ');
  
  // Group answers by theme (simple grouping)
  const answerCategories = uniqueAnswers.length < 5 ? 
    `${uniqueAnswers.length} unique responses` :
    `${uniqueAnswers.length} unique responses across various themes`;
  
  // Player rankings - proper ordinal formatting
  const getOrdinal = (n) => {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };
  
  const playerRankings = leaderboard.slice(0, 3).map((p, idx) => 
    `${getOrdinal(idx + 1)}: ${p.name} (${p.score} pts)`
  ).join(', ');
  
  // Top performers
  const topPerformers = leaderboard.length > 0 ?
    `${leaderboard[0].name} leads with ${leaderboard[0].score} points` :
    '';
  
  // Round scores (for current question only - not cumulative)
  const roundScores = sortedAnswers.slice(0, 3).map(([idx, data]) => 
    `${data.playerName}: +${data.totalScore} pts`
  ).join(', ') || 'No scores this round';
  
  // Score changes - show points earned this round
  const scoreChanges = gameType === 'trivia' ? 
    (sortedAnswers.length > 0 ? 
      sortedAnswers.map(([idx, data]) => 
        `${data.playerName}: +${data.totalScore} pts ${data.isCorrect ? '(Correct)' : '(Incorrect)'}`
      ).join(', ') : 'No points earned this round') :
    (sortedAnswers.length > 0 ? 
      sortedAnswers.slice(0, 3).map(([idx, data]) => 
        `${data.playerName}: +${data.totalScore} vote pts`
      ).join(', ') : 'No vote points this round');
  
  // Current round/question number
  const currentRound = `Question ${parseInt(paddedQuestionNumber)}`;
  
  // Session duration - calculate from game metadata if available
  let sessionDuration = 'Current session';
  try {
    if (metadata.CreatedAt) {
      const gameStart = new Date(metadata.CreatedAt);
      const now = new Date();
      const durationMs = now - gameStart;
      const minutes = Math.floor(durationMs / 60000);
      const seconds = Math.floor((durationMs % 60000) / 1000);
      sessionDuration = minutes > 0 ? `${minutes} minutes, ${seconds} seconds` : `${seconds} seconds`;
    }
  } catch (error) {
    console.log('⚠️ Could not calculate session duration:', error.message);
  }
  
  // Scoring system explanation
  const scoringSystem = `1st place: ${scoringConfig.firstPlacePoints} pts, 2nd place: ${scoringConfig.secondPlacePoints} pts, 3rd place: ${scoringConfig.thirdPlacePoints} pt`;
  
  // Voting breakdown
  const votingBreakdown = sortedAnswers.slice(0, 3).map(([idx, data]) => 
    `${data.answerText}: ${data.firstPlace} first-place, ${data.secondPlace} second-place, ${data.thirdPlace} third-place votes`
  ).join('; ');
  
  // Format trivia/poll/wavelength specific variables
  let triviaChoices = '';
  let pollOptions = '';
  let correctAnswer = '';
  let triviaResponses = '';
  let triviaCorrectness = '';
  let correctCount = 0; // Initialize correctCount for all game types
  let correctAnswers = [];
  
  // Wavelength-specific variables (already initialized above)
  let wavelengthTopic = '';
  let wavelengthWords = '';
  let wordAnalysis = '';
  
  // Check if this is a trivia or poll game
  if (gameType === 'trivia' && question) {
    // Format trivia choices with better formatting
    const options = [];
    if (question.optionA) options.push(`A) ${question.optionA}`);
    if (question.optionB) options.push(`B) ${question.optionB}`);
    if (question.optionC) options.push(`C) ${question.optionC}`);
    if (question.optionD) options.push(`D) ${question.optionD}`);
    if (question.optionE) options.push(`E) ${question.optionE}`);
    if (question.optionF) options.push(`F) ${question.optionF}`);
    triviaChoices = options.join(', ');
    
    console.log('🔍 TRIVIA CHOICES DEBUG:', triviaChoices);
    
    // Get correct answer(s) with improved extraction
    let correctAnswerValue = question.correctAnswer || question.CorrectAnswer;
    
    if (correctAnswerValue) {
      // If it's an option ID (like OptionA), convert to actual text
      if (correctAnswerValue.startsWith('Option')) {
        const optionLetter = correctAnswerValue.replace('Option', '');
        const optionField = `option${optionLetter}`;
        const optionText = question[optionField];
        if (optionText) {
          correctAnswer = `The correct answer is ${optionLetter}: ${optionText}`;
        } else {
          correctAnswer = `The correct answer is ${optionLetter}`;
        }
        console.log(`🔍 CORRECT ANSWER DEBUG: Converted ${correctAnswerValue} to "${correctAnswer}"`);
      } else {
        correctAnswer = correctAnswerValue;
        console.log(`🔍 CORRECT ANSWER DEBUG: Using direct value "${correctAnswer}"`);
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
      console.log(`🔍 CORRECT ANSWER DEBUG: Multiple answers converted to "${correctAnswer}"`);
    } else {
      console.log('🔍 CORRECT ANSWER DEBUG: No correct answer found in question object');
    }
    
    // Calculate trivia response distribution
    const responseDistribution = {};
    
    answers.forEach(answer => {
      const playerAnswer = answer.Answer || answer.answer;
      responseDistribution[playerAnswer] = (responseDistribution[playerAnswer] || 0) + 1;
      
      // Check if answer is correct using both field name variants
      const correctAnswerValue = question.correctAnswer || question.CorrectAnswer;
      const correctAnswersArray = question.correctAnswers || question.CorrectAnswers;
      
      // Handle OptionA format conversion to actual text
      let actualCorrectAnswer = correctAnswerValue;
      if (correctAnswerValue && correctAnswerValue.startsWith('Option')) {
        const optionLetter = correctAnswerValue.replace('Option', '');
        const optionField = `option${optionLetter}`;
        actualCorrectAnswer = question[optionField] || correctAnswerValue;
      }
      
      // Check if player's answer is correct (handle both letter and full text matching)
      let isCorrect = false;
      if (correctAnswersArray && correctAnswersArray.includes(playerAnswer)) {
        isCorrect = true;
      } else if (correctAnswerValue) {
        if (correctAnswerValue.startsWith('Option')) {
          // For OptionA format, compare the letter (A, B, C, D)
          const correctLetter = correctAnswerValue.replace('Option', '');
          isCorrect = playerAnswer === correctLetter;
        } else {
          // Direct comparison for non-Option format
          isCorrect = playerAnswer === correctAnswerValue || playerAnswer === actualCorrectAnswer;
        }
      }
      
      console.log(`🔍 CORRECTNESS CHECK: Player "${answer.PlayerName || answer.playerName}" answered "${playerAnswer}", correct="${correctAnswerValue}", isCorrect=${isCorrect}`);
      
      if (isCorrect) {
        correctCount++;
        correctAnswers.push({
          playerName: answer.PlayerName || answer.playerName,
          answer: playerAnswer
        });
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
    
    console.log('🔍 TRIVIA PROCESSING COMPLETE:');
    console.log('  question.correctAnswer:', question.correctAnswer);
    console.log('  question.optionA:', question.optionA);
    console.log('  question.optionB:', question.optionB);
    console.log('  question.optionC:', question.optionC);
    console.log('  question.optionD:', question.optionD);
    console.log('  question.answerDetails:', question.answerDetails);
    console.log('  triviaChoices:', triviaChoices);
    console.log('  correctAnswer:', correctAnswer);
    console.log('  correctCount:', correctCount);
    console.log('  triviaResponses:', triviaResponses);
    console.log('  triviaCorrectness:', triviaCorrectness);
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
  } else if (gameType === 'wavelength') {
    // Handle wavelength word analysis
    console.log('🌊 Processing wavelength data for AI summary');
    
    // Get the topic/prompt from the question
    wavelengthTopic = question.title || question.topic || 'Word Association';
    
    // Process all player words to find common ones
    const wordCounts = {};
    const playerWordLists = {};
    let totalWordsSubmitted = 0;
    
    answers.forEach(answer => {
      const playerName = answer.PlayerName || answer.playerName;
      const answerText = answer.Answer || answer.answer || '';
      
      // Parse words (should already be normalized from message.js processing)
      const words = answerText.split(',')
        .map(w => w.trim().toLowerCase())
        .filter(w => w.length > 0);
      
      playerWordLists[playerName] = words;
      totalWordsSubmitted += words.length;
      
      // Count word frequencies
      words.forEach(word => {
        wordCounts[word] = (wordCounts[word] || 0) + 1;
      });
    });
    
    // Find common words (mentioned by 2+ players)
    commonWords = Object.entries(wordCounts)
      .filter(([word, count]) => count > 1)
      .sort((a, b) => b[1] - a[1]) // Sort by frequency
      .map(([word, count]) => ({ word, count }));
    
    totalUniqueWords = Object.keys(wordCounts).length;
    connectionScore = Math.round((commonWords.length / totalUniqueWords) * 100) || 0;
    
    // Format wavelength data for AI
    wavelengthWords = Object.entries(playerWordLists)
      .map(([player, words]) => `${player}: [${words.join(', ')}]`)
      .join('; ');
    
    wordAnalysis = `${commonWords.length} common words found out of ${totalUniqueWords} unique words (${connectionScore}% connection rate). ` +
      `Common words: ${commonWords.map(w => `${w.word} (${w.count}x)`).join(', ')}`;
    
    console.log('🌊 Wavelength analysis complete:', {
      topic: wavelengthTopic,
      commonWordsCount: commonWords.length,
      totalUniqueWords: totalUniqueWords,
      connectionScore: connectionScore
    });
    
    // Update wavelength-specific summary variables now that we have the real values
    resultsSummary = `Team found ${commonWords.length} common words with ${connectionScore}% connection rate`;
    consensusLevel = `Team collaboration - ${connectionScore}% word connection rate`;
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
    gameContext: eventTitle, // Alias for backward compatibility
    
    // PLAYER INFO
    totalParticipants: totalParticipants,
    totalPlayers: totalParticipants, // Trivia template uses totalPlayers
    activeParticipants: activeParticipants,
    playerNames: playerNames.join(', '),
    playerRankings: playerRankings,
    topPerformers: topPerformers,
    
    // QUESTION INFO
    question: question.title || question.questionDetail || 'Question not available', // Trivia template uses {question}
    questionTitle: question.title || 'Question not available',
    questionDetail: question.questionDetail || question.detail || 'No additional context provided',
    questionCategory: question.category || 'General',
    questionContext: question.questionDetail || question.detail || '',
    questionNumber: currentRound,
    triviaChoices: triviaChoices,
    pollOptions: pollOptions,
    correctAnswer: correctAnswer,
    answerDetails: question.answerDetails || question.AnswerDetails || 'No explanation provided',
    difficulty: question.difficulty || question.Difficulty || 'medium',
    questionExplanation: question.answerDetails || question.AnswerDetails || question.detail || '',
    
    // ANSWERS
    playerAnswers: playerAnswers,
    playerResponses: playerAnswers, // Trivia template uses playerResponses
    responseCount: rankedAnswers.length,
    uniqueAnswers: uniqueAnswersText,
    answerCategories: answerCategories,
    triviaResponses: triviaResponses,
    responsesText: responsesText,
    correctCount: gameType === 'trivia' ? correctCount : 0, // For trivia templates
    
    // VOTES
    voteData: voteData,
    voteCount: votes ? votes.length : 0,
    votingParticipation: `${votingParticipation}%`,
    votingPattern: votingPattern,
    
    // VOTE TALLY / RESULTS
    voteTally: resultsString,
    topVotedAnswers: topAnswers_formatted,
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
      `${getOrdinal(idx + 1)}: ${p.name} (${p.score} pts)`
    ).join(', '),
    scoringSystem: scoringSystem,
    averageScore: `${averageScore} points`,
    
    // WAVELENGTH SPECIFIC
    wavelengthTopic: wavelengthTopic,
    wavelengthWords: wavelengthWords,
    commonWords: commonWords.map(w => w.word).join(', '),
    commonWordsCount: commonWords.length,
    totalUniqueWords: totalUniqueWords,
    connectionScore: `${connectionScore}%`,
    wordAnalysis: wordAnalysis,
    teamScore: commonWords.length, // Team-based scoring for wavelength
    
    // CONTEXT (backward compatibility)
    contextSections: contextSections.length > 0 ? ('\nCONTEXT INFORMATION:\n' + contextSections.join('\n') + '\n') : '',
    contextInstructions: contextSections.length > 0 ? 
      '\n\nIMPORTANT: Please tailor your analysis based on the provided context information above. Consider the specific background, goals, and instructions relevant to this session.' : 
      ''
  };
  
  // Build the final prompt - support both old (template) and new (instructions + outputFormat) structure
  let prompt;
  if (promptData.template) {
    // Legacy format: use template directly
    prompt = promptData.template;
  } else if (promptData.instructions && promptData.outputFormat) {
    // New format: combine instructions and output format
    prompt = promptData.instructions + '\n\n' + promptData.outputFormat;
  } else {
    console.error('❌ Invalid prompt structure - missing required fields');
    throw new Error('Prompt must have either template OR both instructions and outputFormat');
  }
  
  // Debug: Log key trivia variables
  if (gameType === 'trivia') {
    console.log('🔍 TRIVIA DEBUG - Template variables:');
    console.log('  question:', templateVars.question);
    console.log('  questionTitle:', templateVars.questionTitle);
    console.log('  questionDetail:', templateVars.questionDetail);
    console.log('  correctAnswer:', templateVars.correctAnswer);
    console.log('  correctCount:', templateVars.correctCount);
    console.log('  totalPlayers:', templateVars.totalPlayers);
    console.log('  triviaChoices:', templateVars.triviaChoices);
    console.log('  triviaResponses:', templateVars.triviaResponses);
    console.log('  triviaCorrectness:', templateVars.triviaCorrectness);
    console.log('  playerResponses:', templateVars.playerResponses);
    console.log('  scoreChanges:', templateVars.scoreChanges);
    console.log('  cumulativeScores:', templateVars.cumulativeScores);
    console.log('  responsesText:', templateVars.responsesText);
    
    console.log('🔍 TRIVIA DEBUG - Question object:');
    console.log('  question.title:', question.title);
    console.log('  question.correctAnswer:', question.correctAnswer);
    console.log('  question.optionA:', question.optionA);
    console.log('  question.optionB:', question.optionB);
    console.log('  question.optionC:', question.optionC);
    console.log('  question.optionD:', question.optionD);
    
    console.log('🔍 TRIVIA DEBUG - Raw values:');
    console.log('  triviaChoices raw:', triviaChoices);
    console.log('  correctAnswer raw:', correctAnswer);
    console.log('  scoreChanges raw:', scoreChanges);
  } else if (gameType === 'wavelength') {
    console.log('🌊 WAVELENGTH DEBUG - Template variables:');
    console.log('  wavelengthTopic:', templateVars.wavelengthTopic);
    console.log('  wavelengthWords:', templateVars.wavelengthWords);
    console.log('  commonWords:', templateVars.commonWords);
    console.log('  commonWordsCount:', templateVars.commonWordsCount);
    console.log('  totalUniqueWords:', templateVars.totalUniqueWords);
    console.log('  connectionScore:', templateVars.connectionScore);
    console.log('  wordAnalysis:', templateVars.wordAnalysis);
    console.log('  teamScore:', templateVars.teamScore);
  }
  
  for (const [key, value] of Object.entries(templateVars)) {
    const regex = new RegExp(`\\{${key}\\}`, 'g');
    prompt = prompt.replace(regex, value);
  }

  console.log('🤖 FULL AI PROMPT CONSTRUCTED:');
  console.log('=====================================');
  console.log(prompt);
  console.log('=====================================');

  // Prepare debug information
  const debugInfo = {
    promptProvenance: promptProvenance,
    fullPrompt: prompt,
    templateVariables: templateVars,
    promptTemplate: promptData.template || (promptData.instructions + '\n\n' + promptData.outputFormat),
    promptInstructions: promptData.instructions,
    promptOutputFormat: promptData.outputFormat,
    promptFormat: promptData.template ? 'legacy' : 'structured',
    promptName: promptData.name,
    promptSource: promptProvenance.source
  };

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
    const result = {
      summary: parsed.summaryText,
      summaryText: parsed.summaryText, // For backwards compatibility
      discussionQuestions: parsed.discussionQuestions,
      nextSteps: parsed.nextSteps,
      fullResponse: aiResponse,
      markdownResponse: parsed.markdownResponse,
      model: 'claude-3.5-sonnet' // Track which model was used
    };
    
    // Include debug information if in debug mode
    if (debugMode) {
      result.debugInfo = debugInfo;
    }
    
    return result;

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
      const haikuResult = {
        summary: parsed.summaryText,
        summaryText: parsed.summaryText,
        discussionQuestions: parsed.discussionQuestions,
        nextSteps: parsed.nextSteps,
        fullResponse: haikuAiResponse,
        model: 'claude-3.5-haiku' // Track which model was used
      };
      
      // Include debug information if in debug mode
      if (debugMode) {
        haikuResult.debugInfo = debugInfo;
      }
      
      return haikuResult;
      
    } catch (haikuError) {
      console.error('🚨 BEDROCK HAIKU ALSO FAILED:');
      console.error('  Haiku Error:', haikuError.message);
      
      // Final fallback structured response if both AI models fail
      const winner = rankedAnswers && rankedAnswers.length > 0 ? rankedAnswers[0] : null;
      const fallbackSummary = winner && winner.player && winner.answer
        ? `Great responses to this question! ${winner.player} takes the lead with "${winner.answer}" earning ${winner.score} points from the group. The creativity and thoughtfulness in all ${totalParticipants} answers really shows the engagement of our participants!`
        : `Fantastic participation from all ${totalParticipants} participants! The variety and creativity in the answers really showcased everyone's engagement with this question.`;
      
      console.log(`🚨 BEDROCK FINAL FALLBACK: Using static response. Winner:`, winner, 'TotalParticipants:', totalParticipants);
      
      const fallbackResult = {
        summary: fallbackSummary,
        summaryText: fallbackSummary,
        discussionQuestions: [],
        nextSteps: [],
        fullResponse: fallbackSummary,
        model: 'fallback'
      };
      
      // Include debug information if in debug mode
      if (debugMode) {
        fallbackResult.debugInfo = debugInfo;
      }
      
      return fallbackResult;
    }
  }
}