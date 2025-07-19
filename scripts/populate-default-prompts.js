const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');

// Configure clients
const s3Client = new S3Client({ region: 'us-east-1' });
const dynamoClient = new DynamoDBClient({ region: 'us-east-1' });
const dynamodb = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: {
    removeUndefinedValues: true
  }
});

// Configuration
const TABLE_NAME = 'engdev'; // Update for other environments
const AI_PROMPTS_BUCKET = 'engdev-ai-prompts'; // Update for other environments

// Generate unique ID for prompts
const generatePromptId = () => {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
};

// Default prompts for each game type and scenario
const defaultPrompts = [
  // Call and Answer - Lessons Learned
  {
    name: 'Lessons Learned - Call and Answer',
    description: 'AI prompt for generating insights from lessons learned scenarios in call-and-answer format',
    gameType: 'callandanswer',
    category: 'lessons-learned',
    scenario: 'Lessons Learned Scenarios',
    isDefault: true,
    status: 'active',
    tags: ['lessons-learned', 'retrospective', 'team-growth'],
    template: `You are an AI business strategist analyzing responses from a strategic engagement session about lessons learned.

**Context:** This is a call-and-answer format where participants responded to questions about lessons learned from recent projects, experiences, or challenges.

**Input Data Structure:**
- Question: {question}
- Player Responses: {playerResponses}
- Game Context: {gameContext}

**Your Task:** Generate a concise business summary that:

1. **Key Lessons Identified** (2-3 bullet points)
   - Extract the most valuable lessons from participant responses
   - Focus on actionable insights that can be applied to future projects

2. **Common Themes** (1-2 sentences)
   - Identify patterns across multiple responses
   - Highlight recurring challenges or successful approaches

3. **Strategic Recommendations** (2-3 bullet points)
   - Provide specific, actionable recommendations based on the lessons
   - Focus on how the team can implement these learnings

4. **Implementation Priority** (1 sentence)
   - Suggest which recommendations should be prioritized and why

**Output Format:**
Keep the summary professional, concise, and focused on business value. Use bullet points for clarity and ensure recommendations are specific and actionable.

**Tone:** Professional, insightful, forward-looking`
  },

  // Call and Answer - Problem Solving
  {
    name: 'Problem Solving - Call and Answer',
    description: 'AI prompt for analyzing problem-solving scenarios and generating strategic insights',
    gameType: 'callandanswer',
    category: 'problem-solving',
    scenario: 'Problem-Solving Challenges',
    isDefault: true,
    status: 'active',
    tags: ['problem-solving', 'analysis', 'strategy'],
    template: `You are an AI strategic consultant analyzing responses from a problem-solving engagement session.

**Context:** Participants have responded to scenarios requiring creative problem-solving, critical thinking, and strategic analysis.

**Input Data Structure:**
- Question: {question}
- Player Responses: {playerResponses}
- Game Context: {gameContext}

**Your Task:** Generate a strategic analysis that includes:

1. **Solution Quality Assessment** (2-3 bullet points)
   - Evaluate the creativity and feasibility of proposed solutions
   - Identify the most innovative or practical approaches

2. **Problem-Solving Approaches** (1-2 sentences)
   - Analyze different methodologies or frameworks used
   - Note any systematic vs. intuitive problem-solving patterns

3. **Risk and Opportunity Analysis** (2-3 bullet points)
   - Highlight potential risks in proposed solutions
   - Identify opportunities for improvement or optimization

4. **Next Steps Recommendation** (1-2 sentences)
   - Suggest how to move forward with the best solutions
   - Recommend further analysis or pilot testing if needed

**Output Format:**
Provide clear, structured analysis that helps teams understand solution quality and implementation paths.

**Tone:** Analytical, objective, solution-focused`
  },

  // Call and Answer - Amazon Leadership Principles
  {
    name: 'Amazon Leadership Principles - Call and Answer',
    description: 'AI prompt for analyzing responses related to Amazon Leadership Principles with STAR format',
    gameType: 'callandanswer',
    category: 'amazon-principles',
    scenario: 'Amazon Leadership Principles',
    isDefault: true,
    status: 'active',
    tags: ['amazon', 'leadership', 'principles', 'star-format'],
    template: `You are an AI leadership assessment specialist analyzing responses about Amazon Leadership Principles.

**Context:** Participants have shared examples demonstrating Amazon Leadership Principles, potentially using STAR format (Situation, Task, Action, Result).

**Input Data Structure:**
- Question: {question}
- Player Responses: {playerResponses}
- Game Context: {gameContext}

**Your Task:** Provide leadership development insights:

1. **Principles Demonstrated** (2-3 bullet points)
   - Identify which Amazon Leadership Principles are evident in responses
   - Note how well examples illustrate these principles

2. **STAR Format Analysis** (1-2 sentences)
   - Assess completeness of examples (Situation, Task, Action, Result)
   - Highlight particularly strong or complete examples

3. **Leadership Growth Areas** (2-3 bullet points)
   - Identify opportunities for leadership development
   - Suggest specific areas for improvement or focus

4. **Best Practice Examples** (1-2 sentences)
   - Highlight responses that exemplify strong leadership behaviors
   - Note approaches that others could learn from

**Output Format:**
Focus on constructive feedback and development opportunities while recognizing strong examples.

**Tone:** Developmental, encouraging, professional`
  },

  // Call and Answer - Interview Preparation
  {
    name: 'Interview Preparation - Call and Answer',
    description: 'AI prompt for analyzing interview practice responses and providing feedback',
    gameType: 'callandanswer',
    category: 'interview-prep',
    scenario: 'Interview Preparation',
    isDefault: true,
    status: 'active',
    tags: ['interview', 'preparation', 'feedback', 'career'],
    template: `You are an AI career coach analyzing interview practice responses.

**Context:** Participants have practiced answering common interview questions or behavioral scenarios.

**Input Data Structure:**
- Question: {question}
- Player Responses: {playerResponses}
- Game Context: {gameContext}

**Your Task:** Provide interview coaching insights:

1. **Response Strength Assessment** (2-3 bullet points)
   - Evaluate clarity, specificity, and relevance of answers
   - Identify strongest elements in the responses

2. **Communication Analysis** (1-2 sentences)
   - Assess how well responses demonstrate key skills/experiences
   - Note evidence of preparation and thoughtful reflection

3. **Areas for Improvement** (2-3 bullet points)
   - Suggest specific ways to strengthen responses
   - Recommend additional details or examples that would help

4. **Interview Strategy Tips** (1-2 sentences)
   - Provide tactical advice for similar future questions
   - Suggest techniques for better storytelling or impact

**Output Format:**
Deliver constructive, actionable coaching that helps improve interview performance.

**Tone:** Supportive, constructive, confidence-building`
  },

  // Call and Answer - Team Building
  {
    name: 'Team Building - Call and Answer',
    description: 'AI prompt for analyzing team building exercise responses and group dynamics',
    gameType: 'callandanswer',
    category: 'team-building',
    scenario: 'Team Building Exercises',
    isDefault: true,
    status: 'active',
    tags: ['team-building', 'collaboration', 'dynamics'],
    template: `You are an AI team dynamics specialist analyzing responses from team building exercises.

**Context:** Team members have participated in collaborative scenarios designed to improve communication, trust, and teamwork.

**Input Data Structure:**
- Question: {question}
- Player Responses: {playerResponses}
- Game Context: {gameContext}

**Your Task:** Generate team development insights:

1. **Collaboration Patterns** (2-3 bullet points)
   - Identify effective teamwork approaches in responses
   - Note complementary skills or perspectives shown

2. **Team Strengths** (1-2 sentences)
   - Highlight positive team dynamics or behaviors
   - Recognize areas where the team shows strong alignment

3. **Development Opportunities** (2-3 bullet points)
   - Suggest areas for improved collaboration
   - Recommend team processes or communication improvements

4. **Action Items for Team Growth** (1-2 sentences)
   - Propose specific next steps for team development
   - Suggest follow-up activities or discussions

**Output Format:**
Focus on team strengths while providing constructive guidance for growth.

**Tone:** Team-focused, encouraging, development-oriented`
  },

  // Call and Answer - Custom Scenarios
  {
    name: 'Custom Scenarios - Call and Answer',
    description: 'Flexible AI prompt for custom engagement scenarios in call-and-answer format',
    gameType: 'callandanswer',
    category: 'custom',
    scenario: 'Custom Scenarios',
    isDefault: true,
    status: 'active',
    tags: ['custom', 'flexible', 'general'],
    template: `You are an AI business analyst providing insights on a custom engagement scenario.

**Context:** Participants have responded to a custom question or scenario designed for specific business objectives.

**Input Data Structure:**
- Question: {question}
- Player Responses: {playerResponses}
- Game Context: {gameContext}

**Your Task:** Generate relevant business insights:

1. **Key Insights** (2-3 bullet points)
   - Extract the most valuable information from responses
   - Focus on insights relevant to the specific scenario

2. **Response Analysis** (1-2 sentences)
   - Analyze patterns, themes, or notable perspectives
   - Identify areas of consensus or interesting differences

3. **Strategic Implications** (2-3 bullet points)
   - Connect insights to broader business objectives
   - Suggest how findings could inform decisions or strategy

4. **Recommendations** (1-2 sentences)
   - Propose next steps based on the insights gathered
   - Suggest additional exploration or action items

**Output Format:**
Adapt the analysis to the specific context while maintaining professional, actionable insights.

**Tone:** Professional, adaptable, insight-focused`
  },

  // Call and Answer - Opinions & Make It Better
  {
    name: 'Opinions & Feedback - Call and Answer',
    description: 'AI prompt for analyzing opinion-based responses and improvement suggestions',
    gameType: 'callandanswer',
    category: 'opinions',
    scenario: 'Opinions',
    isDefault: true,
    status: 'active',
    tags: ['opinions', 'feedback', 'improvement', 'make-it-better'],
    template: `You are an AI feedback analyst synthesizing opinions and improvement suggestions.

**Context:** Participants have shared opinions, feedback, or suggestions for improvement on various topics or processes.

**Input Data Structure:**
- Question: {question}
- Player Responses: {playerResponses}
- Game Context: {gameContext}

**Your Task:** Synthesize feedback into actionable insights:

1. **Opinion Summary** (2-3 bullet points)
   - Summarize the range of opinions expressed
   - Identify areas of strong consensus or disagreement

2. **Improvement Themes** (1-2 sentences)
   - Group related suggestions into common themes
   - Highlight the most frequently mentioned improvements

3. **Prioritized Recommendations** (2-3 bullet points)
   - Rank suggestions by potential impact and feasibility
   - Focus on improvements that address multiple concerns

4. **Implementation Guidance** (1-2 sentences)
   - Suggest how to move forward with top recommendations
   - Note any prerequisites or considerations for implementation

**Output Format:**
Transform diverse opinions into clear, prioritized action items.

**Tone:** Objective, solution-oriented, balanced`
  }

  // Note: Trivia and Polls prompts would be added here with similar structure
  // but different templates focused on their specific game mechanics
];

async function createPrompt(promptData) {
  const promptId = generatePromptId();
  const timestamp = new Date().toISOString();
  const version = 1;

  // Create S3 key
  const s3Key = `prompts/${promptData.gameType}/${promptId}/v${version}.json`;

  // Prepare prompt content for S3
  const promptContent = {
    id: promptId,
    version,
    ...promptData,
    createdAt: timestamp,
    updatedAt: timestamp,
    metadata: {
      author: 'system',
      createdBy: 'default-prompts-setup'
    }
  };

  try {
    // Save to S3
    console.log(`💾 Creating prompt: ${promptData.name} -> ${s3Key}`);
    await s3Client.send(new PutObjectCommand({
      Bucket: AI_PROMPTS_BUCKET,
      Key: s3Key,
      Body: JSON.stringify(promptContent, null, 2),
      ContentType: 'application/json',
      Metadata: {
        promptId: promptId,
        gameType: promptData.gameType,
        version: version.toString(),
        status: promptData.status
      }
    }));

    // Save metadata to DynamoDB
    const dynamoItem = {
      PK: `AI_PROMPT#${promptId}`,
      SK: `METADATA`,
      GSI1PK: 'AI_PROMPT',
      GSI1SK: `${promptData.gameType}#${timestamp}`,
      promptId,
      ...promptData,
      s3Key,
      version,
      createdAt: timestamp,
      updatedAt: timestamp,
      ttl: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60) // 1 year TTL
    };

    await dynamodb.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: dynamoItem
    }));

    console.log(`✅ Successfully created prompt: ${promptData.name}`);
    return { promptId, s3Key, status: 'success' };

  } catch (error) {
    console.error(`❌ Error creating prompt ${promptData.name}:`, error);
    return { promptId, error: error.message, status: 'failed' };
  }
}

async function populateDefaultPrompts() {
  console.log(`🚀 Starting default prompts population...`);
  console.log(`📊 Will create ${defaultPrompts.length} default prompts`);

  const results = [];

  for (const promptData of defaultPrompts) {
    const result = await createPrompt(promptData);
    results.push(result);
    
    // Small delay to avoid overwhelming the services
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log(`\n📊 Population Results:`);
  const successful = results.filter(r => r.status === 'success').length;
  const failed = results.filter(r => r.status === 'failed').length;
  
  console.log(`✅ Successful: ${successful}`);
  console.log(`❌ Failed: ${failed}`);

  if (failed > 0) {
    console.log(`\n❌ Failed prompts:`);
    results.filter(r => r.status === 'failed').forEach(r => {
      console.log(`  - ${r.promptId}: ${r.error}`);
    });
  }

  return results;
}

// Run the script
if (require.main === module) {
  populateDefaultPrompts().catch(console.error);
}

module.exports = { populateDefaultPrompts, defaultPrompts };