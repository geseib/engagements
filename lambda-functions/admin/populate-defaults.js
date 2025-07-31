const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

// Generate unique ID for prompts (same as other admin functions)
const generatePromptId = () => {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
};

const tableName = process.env.TABLE_NAME;
const aiPromptsBucket = process.env.AI_PROMPTS_BUCKET;

const dynamoClient = new DynamoDBClient({});
const dynamodb = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: {
    removeUndefinedValues: true
  }
});

const s3Client = new S3Client({});

// Default prompts data - comprehensive set for all categories
const defaultPrompts = {
  "callandanswer": {
    "lessons-learned": {
      "name": "Lessons Learned - Strategic Insights",
      "description": "AI prompt for analyzing lessons learned scenarios and extracting strategic insights from team experiences",
      "template": "You are an expert business strategist analyzing responses from {sessionContext}.\n\nLESSON DETAILS:\nQuestion: \"{questionTitle}\"\nCategory: {questionCategory}\nContext: {questionDetail}\n{contextSections}\n\nPLAYER RESPONSES (ranked by peer voting):\n{responsesText}\n\nANALYSIS INSTRUCTIONS:\nYou are analyzing {responseCount} responses that were peer-voted by the team. The responses above are ranked by total vote points, with the highest-scoring response first.{contextInstructions}\n\nPlease provide your strategic analysis in this EXACT format for reliable parsing:\n\n=== SUMMARY ===\n[Write 2-3 sentences synthesizing the key strategic themes and insights from these responses. Pay special attention to the top-ranked responses as they represent the team's collective wisdom.]\n\n=== DISCUSSION QUESTIONS ===\nQ1: [First thought-provoking question that builds on these specific responses for deeper strategic discussion. Reference specific player insights.]\nQ2: [Second question that facilitates strategic discussion based on the responses.]\nQ3: [Third question for deeper strategic discussion.]\n\n=== NEXT STEPS ===\nSTEP1: [First concrete, actionable step the team could take based on these insights.]\nSTEP2: [Second actionable step, prioritizing ideas from highest-ranked responses.]\nSTEP3: [Third actionable step for implementation.]\nSTEP4: [Fourth actionable step (optional but recommended).]\n\nFocus on actionable insights that connect directly to what these players shared and the specific context they were asked to consider. Be specific and insightful.",
      "category": "lessons-learned",
      "gameType": "callandanswer",
      "status": "active",
      "isDefault": true,
      "tags": ["lessons-learned", "strategic", "retrospective", "analysis"]
    },
    "problem-solving": {
      "name": "Problem-Solving - Solution Architecture",
      "description": "AI prompt for analyzing problem-solving approaches and building comprehensive solution frameworks",
      "template": "You are a senior solution architect and problem-solving expert. Your role is to analyze team problem-solving approaches and synthesize them into actionable frameworks.\n\n**Problem Scenario**: {question}\n**Team Solutions**: {playerResponses}\n**Context**: {gameContext}\n\nAnalyze the proposed solutions and provide:\n\n## Summary\nSummarize the most promising approaches and identify common themes in the problem-solving strategies.\n\n## Discussion Questions\nCreate 3 questions to deepen problem-solving thinking:\n1. [Root cause analysis question]\n2. [Implementation feasibility question]\n3. [Risk mitigation question]\n\n## Next Steps\nRecommend a structured approach:\n1. [Immediate investigation or validation step]\n2. [Solution design and planning phase]\n3. [Implementation and monitoring strategy]\n\nEmphasize systematic thinking, risk assessment, and measurable outcomes.",
      "category": "problem-solving",
      "gameType": "callandanswer",
      "status": "active",
      "isDefault": true,
      "tags": ["problem-solving", "solutions", "architecture", "systematic"]
    },
    "amazon-principles": {
      "name": "Amazon Leadership Principles - Application Guide",
      "description": "AI prompt for analyzing responses related to Amazon Leadership Principles and their practical application",
      "template": "You are an Amazon leadership development expert specializing in the practical application of Amazon's Leadership Principles. Analyze how team members apply these principles in real situations.\n\n**Leadership Principle Scenario**: {question}\n**Team Applications**: {playerResponses}\n**Organizational Context**: {gameContext}\n\nProvide analysis focused on leadership development:\n\n## Summary\nHighlight how the responses demonstrate understanding and application of Amazon Leadership Principles, noting particularly strong examples.\n\n## Discussion Questions\nGenerate 3 leadership development questions:\n1. [Principle application question]\n2. [Behavioral example question]\n3. [Leadership growth question]\n\n## Next Steps\nSuggest leadership development actions:\n1. [Immediate practice opportunity]\n2. [Skill development focus area]\n3. [Long-term leadership growth strategy]\n\nFocus on practical leadership behaviors, measurable outcomes, and continuous improvement in line with Amazon's high standards.",
      "category": "amazon-principles",
      "gameType": "callandanswer",
      "status": "active",
      "isDefault": true,
      "tags": ["amazon", "leadership", "principles", "development"]
    },
    "interview-prep": {
      "name": "Interview Preparation - STAR Method Analysis",
      "description": "AI prompt for analyzing interview responses and providing feedback using the STAR (Situation, Task, Action, Result) method",
      "template": "You are a senior interview coach and talent development expert. Your role is to analyze interview-style responses and provide constructive feedback using the STAR method framework.\n\n**Interview Question**: {question}\n**Candidate Responses**: {playerResponses}\n**Interview Context**: {gameContext}\n\nEvaluate the responses for interview readiness:\n\n## Summary\nAssess the overall quality of responses, highlighting strengths and identifying areas for improvement in storytelling and structure.\n\n## Discussion Questions\nProvide 3 coaching questions to improve interview performance:\n1. [STAR structure improvement question]\n2. [Impact and results clarification question]\n3. [Behavioral competency question]\n\n## Next Steps\nRecommend interview preparation actions:\n1. [Immediate story refinement task]\n2. [Practice and rehearsal strategy]\n3. [Long-term skill development focus]\n\nEmphasize clear storytelling, quantifiable results, and authentic examples that demonstrate growth and learning.",
      "category": "interview-prep",
      "gameType": "callandanswer",
      "status": "active",
      "isDefault": true,
      "tags": ["interview", "STAR", "coaching", "preparation"]
    },
    "team-building": {
      "name": "Team Building - Collaboration Insights",
      "description": "AI prompt for analyzing team building responses and fostering stronger collaboration and communication",
      "template": "You are a team dynamics expert and organizational psychologist. Your role is to analyze team responses and provide insights that strengthen collaboration and team effectiveness.\n\n**Team Building Scenario**: {question}\n**Team Member Responses**: {playerResponses}\n**Team Context**: {gameContext}\n\nAnalyze team dynamics and collaboration:\n\n## Summary\nIdentify collaboration strengths, communication patterns, and opportunities for stronger team cohesion based on the responses.\n\n## Discussion Questions\nFacilitate team development with 3 questions:\n1. [Communication and trust question]\n2. [Collaboration effectiveness question]\n3. [Team growth and development question]\n\n## Next Steps\nSuggest team building actions:\n1. [Immediate team connection activity]\n2. [Communication improvement initiative]\n3. [Long-term team development strategy]\n\nFocus on psychological safety, inclusive participation, and building on diverse team strengths.",
      "category": "team-building",
      "gameType": "callandanswer",
      "status": "active",
      "isDefault": true,
      "tags": ["team-building", "collaboration", "communication", "dynamics"]
    },
    "opinions": {
      "name": "Opinion Analysis - Perspective Synthesis",
      "description": "AI prompt for analyzing diverse opinions and finding common ground while respecting different viewpoints",
      "template": "You are a skilled facilitator and perspective analyst. Your role is to analyze diverse opinions and help teams find common ground while respecting different viewpoints.\n\n**Opinion Topic**: {question}\n**Team Perspectives**: {playerResponses}\n**Discussion Context**: {gameContext}\n\nSynthesize diverse viewpoints constructively:\n\n## Summary\nIdentify key themes, areas of consensus, and valuable diverse perspectives without judging any particular viewpoint.\n\n## Discussion Questions\nPromote inclusive dialogue with 3 questions:\n1. [Common ground exploration question]\n2. [Perspective understanding question]\n3. [Constructive synthesis question]\n\n## Next Steps\nFacilitate productive outcomes:\n1. [Immediate consensus-building action]\n2. [Perspective-sharing initiative]\n3. [Decision-making or synthesis strategy]\n\nEmphasize respect for diverse viewpoints, finding common ground, and productive dialogue that moves the team forward.",
      "category": "opinions",
      "gameType": "callandanswer",
      "status": "active",
      "isDefault": true,
      "tags": ["opinions", "perspectives", "consensus", "dialogue"]
    },
    "custom": {
      "name": "Custom Scenario - Adaptive Analysis",
      "description": "Flexible AI prompt template that adapts to any custom scenario or business context",
      "template": "You are a versatile business consultant and analytical expert. Your role is to analyze team responses to custom scenarios and provide relevant, actionable insights.\n\n**Scenario**: {question}\n**Team Responses**: {playerResponses}\n**Business Context**: {gameContext}\n\nProvide comprehensive analysis:\n\n## Summary\nAnalyze the key themes, insights, and patterns from the team responses, adapting your analysis to the specific scenario context.\n\n## Discussion Questions\nGenerate 3 relevant questions that drive deeper thinking about this specific topic:\n1. [Context-specific strategic question]\n2. [Implementation or application question]\n3. [Future implications or development question]\n\n## Next Steps\nSuggest practical actions appropriate to the scenario:\n1. [Immediate next step]\n2. [Short-term development action]\n3. [Strategic follow-up initiative]\n\nAdapt your analysis style and recommendations to match the specific business context and scenario requirements.",
      "category": "custom",
      "gameType": "callandanswer",
      "status": "active",
      "isDefault": true,
      "tags": ["custom", "flexible", "adaptive", "general"]
    }
  },
  "trivia": {
    "general": {
      "name": "Trivia Basic - Learning Analysis",
      "description": "AI prompt for analyzing trivia results focusing on learning insights and knowledge retention",
      "template": "You are an educational expert analyzing trivia game results to identify learning opportunities and knowledge gaps.\n\n**Trivia Question**: {questionTitle}\n**Category**: {questionCategory}\n**Correct Answer**: {correctAnswer}\n**Player Results**: {triviaResults}\n\nAnalyze the learning outcomes:\n\n## Summary\nAssess the team's knowledge level in this area and identify key learning patterns from correct and incorrect responses.\n\n## Discussion Questions\nGenerate 3 questions to reinforce learning:\n1. [Knowledge application question based on the trivia topic]\n2. [Deeper understanding question to explore the subject further]\n3. [Practical application question for real-world context]\n\n## Next Steps\nSuggest learning actions:\n1. [Immediate knowledge reinforcement activity]\n2. [Deeper study recommendation for knowledge gaps]\n3. [Practical application or follow-up learning opportunity]\n\nFocus on turning trivia moments into lasting knowledge and practical understanding.",
      "category": "general",
      "gameType": "trivia",
      "status": "active",
      "isDefault": true,
      "tags": ["trivia", "learning", "knowledge", "education"]
    },
    "business": {
      "name": "Business Trivia - Strategic Knowledge",
      "description": "AI prompt for analyzing business trivia results and connecting knowledge to strategic thinking",
      "template": "You are a business strategy expert analyzing trivia results to connect factual knowledge with strategic insights.\n\n**Business Question**: {questionTitle}\n**Topic Area**: {questionCategory}\n**Correct Answer**: {correctAnswer}\n**Team Performance**: {triviaResults}\n\nConnect knowledge to business strategy:\n\n## Summary\nAnalyze how this knowledge area relates to business decision-making and strategic thinking, noting team strengths and knowledge gaps.\n\n## Discussion Questions\nCreate 3 strategic thinking questions:\n1. [Strategic application question connecting the trivia topic to business decisions]\n2. [Market or competitive analysis question related to this knowledge area]\n3. [Innovation or opportunity question building on this topic]\n\n## Next Steps\nRecommend strategic learning actions:\n1. [Immediate business application of this knowledge]\n2. [Strategic research or analysis opportunity]\n3. [Long-term strategic development in this area]\n\nEmphasize how factual knowledge supports better strategic thinking and business decision-making.",
      "category": "business",
      "gameType": "trivia",
      "status": "active",
      "isDefault": true,
      "tags": ["business", "strategy", "knowledge", "decision-making"]
    }
  },
  "polls": {
    "general": {
      "name": "Poll Analysis - Team Preferences",
      "description": "AI prompt for analyzing poll results and understanding team preferences and decision patterns",
      "template": "You are a team dynamics analyst examining poll results to understand collective preferences and decision-making patterns.\n\n**Poll Question**: {questionTitle}\n**Category**: {questionCategory}\n**Poll Results**: {pollResults}\n**Team Context**: {gameContext}\n\nAnalyze team preferences and decision patterns:\n\n## Summary\nExamine the distribution of responses and what they reveal about team preferences, consensus areas, and diverse viewpoints.\n\n## Discussion Questions\nFacilitate team understanding with 3 questions:\n1. [Preference exploration question to understand the reasoning behind choices]\n2. [Consensus-building question to find common ground]\n3. [Decision-making question to move from preferences to action]\n\n## Next Steps\nSuggest actions based on poll insights:\n1. [Immediate action based on majority preference or consensus]\n2. [Process improvement based on decision patterns]\n3. [Follow-up polling or discussion to refine understanding]\n\nFocus on using poll data to improve team decision-making and build stronger consensus.",
      "category": "general",
      "gameType": "polls",
      "status": "active",
      "isDefault": true,
      "tags": ["polls", "preferences", "consensus", "decision-making"]
    }
  }
};

exports.handler = async (event) => {
  console.log('🚀 Populate Default AI Prompts - Event:', JSON.stringify(event, null, 2));

  try {
    // Handle CORS preflight
    if (event.requestContext?.http?.method === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'POST, OPTIONS'
        },
        body: ''
      };
    }

    console.log('🔄 Starting default AI prompts population...');
    
    // Check for overwrite parameter
    console.log('📋 Raw event body:', event.body);
    const body = event.body ? JSON.parse(event.body) : {};
    const overwrite = body.overwrite || false;
    console.log(`📋 Parsed body:`, body);
    console.log(`🔄 Overwrite mode: ${overwrite}`);
    
    const results = {
      created: 0,
      skipped: 0,
      overwritten: 0,
      errors: 0,
      prompts: []
    };

    // Check existing prompts to avoid duplicates
    console.log('📋 Checking existing prompts...');
    const existingPrompts = await dynamodb.send(new ScanCommand({
      TableName: tableName,
      FilterExpression: 'begins_with(PK, :pk)',
      ExpressionAttributeValues: {
        ':pk': 'AI_PROMPT#'
      }
    }));

    const existingPromptNames = new Set(
      existingPrompts.Items?.map(item => item.name) || []
    );

    console.log(`📊 Found ${existingPromptNames.size} existing prompts`);

    // Process each game type and category
    for (const [gameType, categories] of Object.entries(defaultPrompts)) {
      console.log(`🎮 Processing ${gameType} prompts...`);
      
      for (const [categoryKey, promptData] of Object.entries(categories)) {
        try {
          // Check if prompt already exists
          const existingPrompt = existingPrompts.Items?.find(item => item.name === promptData.name);
          const promptExists = !!existingPrompt;
          
          console.log(`📋 Processing prompt: ${promptData.name}`);
          console.log(`📋 Prompt exists: ${promptExists}`);
          console.log(`📋 Overwrite flag: ${overwrite}`);
          console.log(`📋 Existing prompt:`, existingPrompt ? { id: existingPrompt.promptId, name: existingPrompt.name } : null);
          
          if (promptExists && !overwrite) {
            console.log(`⏭️ Skipping existing prompt: ${promptData.name}`);
            results.skipped++;
            continue;
          }
          
          if (promptExists && overwrite) {
            console.log(`🔄 Overwriting existing prompt: ${promptData.name} with ID: ${existingPrompt.promptId}`);
          } else if (!promptExists) {
            console.log(`✨ Creating new prompt: ${promptData.name}`);
          }

          // Use existing promptId when overwriting, generate new one when creating
          const promptId = promptExists && overwrite ? existingPrompt.promptId : generatePromptId();
          const timestamp = new Date().toISOString();

          // Store prompt template in S3 (matching create-ai-prompt format)
          const version = 1;
          const s3Key = `prompts/${gameType}/${promptId}/v${version}.json`;
          
          // Use the same structure as create-ai-prompt.js for consistency
          const s3Data = {
            id: promptId,
            version,
            name: promptData.name,
            description: promptData.description,
            gameType: gameType,
            category: promptData.category,
            scenario: categoryKey,
            // Map the old template field to the new structured format
            template: promptData.template,
            instructions: promptData.template, // Use template as instructions for legacy prompts
            outputFormat: "Provide your analysis in the specified format with clear sections and actionable insights.",
            isDefault: true,
            status: 'active',
            questionSetIds: [],
            tags: promptData.tags || [],
            createdAt: timestamp,
            updatedAt: timestamp,
            metadata: {
              author: 'system',
              createdBy: 'populate-defaults',
              format: 'legacy'
            }
          };
          
          await s3Client.send(new PutObjectCommand({
            Bucket: aiPromptsBucket,
            Key: s3Key,
            Body: JSON.stringify(s3Data, null, 2),
            ContentType: 'application/json'
          }));

          // Store metadata in DynamoDB using current structure
          const metadataRecord = {
            PK: 'AIPROMPTS',
            SK: `AIPROMPT#${promptId}`,
            promptId: promptId,
            name: promptData.name,
            description: promptData.description,
            gameType: promptData.gameType,
            category: promptData.category,
            scenario: categoryKey,
            status: promptData.status,
            isDefault: promptData.isDefault,
            tags: promptData.tags,
            s3Key: s3Key,
            s3Bucket: aiPromptsBucket,
            createdAt: timestamp,
            updatedAt: timestamp,
            createdBy: 'system',
            version: '1.0',
            usageCount: 0
          };

          // Use conditional expression only if not overwriting
          const putCommand = {
            TableName: tableName,
            Item: metadataRecord
          };
          
          if (!overwrite) {
            putCommand.ConditionExpression = 'attribute_not_exists(PK)';
          }

          await dynamodb.send(new PutCommand(putCommand));

          if (promptExists && overwrite) {
            console.log(`✅ Overwritten default prompt: ${promptData.name}`);
            results.overwritten++;
          } else {
            console.log(`✅ Created default prompt: ${promptData.name}`);
            results.created++;
          }
          results.prompts.push({
            id: promptId,
            name: promptData.name,
            gameType: promptData.gameType,
            category: promptData.category
          });

        } catch (error) {
          console.error(`❌ Error creating prompt ${promptData.name}:`, error);
          results.errors++;
        }
      }
    }

    console.log(`🎉 Default prompts population completed!`);
    console.log(`📊 Results: ${results.created} created, ${results.skipped} skipped, ${results.errors} errors`);

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: JSON.stringify({
        success: true,
        message: 'Default AI prompts populated successfully',
        results: results
      })
    };

  } catch (error) {
    console.error('❌ Error populating default prompts:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: JSON.stringify({ 
        error: 'Failed to populate default prompts',
        message: error.message 
      })
    };
  }
};