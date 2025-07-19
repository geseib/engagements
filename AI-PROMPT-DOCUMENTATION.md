# AI Summary Prompt Structure Documentation

## Overview
The AI Summary system generates strategic insights for call-and-answer engagement sessions using AWS Bedrock with Claude 3.5 Sonnet or Claude 3.5 Haiku as fallback.

## Prompt Construction Process

### 1. Data Collection Phase
The system gathers comprehensive context before building the prompt:

```javascript
const aiData = {
  eventTitle: metadata.EventTitle || metadata.Title || 'Engagement Event',
  gameType: metadata.GameType || 'call-and-answer',
  gameAiContext: metadata.AIContext || metadata.EngagementInfo || '',
  questionSetAiContext: questionSetAiContext,
  customInstruction: customInstruction,
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
}
```

### 2. Answer Ranking and Scoring
Answers are ranked by peer voting results using the scoring system:
- **1st Place**: 3 points (configurable)
- **2nd Place**: 2 points (configurable)  
- **3rd Place**: 1 point (configurable)

```javascript
const rankedAnswers = answers.map((answer, idx) => {
  const voteData = voteTallies[idx] || { totalScore: 0 };
  return {
    player: answer.PlayerName,
    answer: answer.Answer,
    score: voteData.totalScore
  };
}).sort((a, b) => b.score - a.score);
```

### 3. Context Section Assembly
Multiple context sources are combined when available:

```javascript
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
```

### 4. Response Text Generation
Ranked responses with proper tie handling:

```javascript
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
```

## Final Prompt Structure

### Template Format
```
You are an expert business strategist analyzing responses from [SESSION_CONTEXT].

LESSON DETAILS:
Question: "[QUESTION_TITLE]"
Category: [QUESTION_CATEGORY]
Context: [QUESTION_DETAIL || 'No additional context provided']

[CONTEXT_SECTIONS]

PLAYER RESPONSES (ranked by peer voting):
[RANKED_RESPONSES_WITH_SCORES]

ANALYSIS INSTRUCTIONS:
You are analyzing [N] responses that were peer-voted by the team. The responses above are ranked by total vote points, with the highest-scoring response first.

[CONTEXT_SPECIFIC_INSTRUCTIONS]

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

Focus on actionable insights that connect directly to what these players shared and the specific context they were asked to consider. Be specific and insightful.
```

### Example Complete Prompt
```
You are an expert business strategist analyzing responses from an "Engagements" strategic thinking session where participants apply lessons to their work context.

LESSON DETAILS:
Question: "What age would you go back to and why?"
Category: Personal Development
Context: No additional context provided

SESSION BACKGROUND: Team building exercise focused on reflection and strategic thinking
QUESTION SET CONTEXT: Leadership development questions for team growth

PLAYER RESPONSES (ranked by peer voting):
🥇 1st Place: Ges - "50s. Wise and still active. Getting to do stuff with your little bit of money, finally!" (5 vote points)

🥇 1st Place: Jason - "20s. I could actually stay up past 10pm and not regret it!" (5 vote points)

ANALYSIS INSTRUCTIONS:
You are analyzing 2 responses that were peer-voted by the team. The responses above are ranked by total vote points, with the highest-scoring response first.

IMPORTANT: Please tailor your analysis based on the provided context information above. Consider the specific background, goals, and instructions relevant to this session.

Please provide your strategic analysis in this EXACT format for reliable parsing:

=== SUMMARY ===
[Strategic analysis content]

=== DISCUSSION QUESTIONS ===
Q1: [Question 1]
Q2: [Question 2]  
Q3: [Question 3]

=== NEXT STEPS ===
STEP1: [Step 1]
STEP2: [Step 2]
STEP3: [Step 3]
STEP4: [Step 4]

Focus on actionable insights that connect directly to what these players shared and the specific context they were asked to consider. Be specific and insightful.
```

## Response Parsing

The system expects the AI response in the exact format with section markers:
- `=== SUMMARY ===` - Main strategic insights (2-3 sentences)
- `=== DISCUSSION QUESTIONS ===` - Three questions (Q1:, Q2:, Q3:)
- `=== NEXT STEPS ===` - Four actionable steps (STEP1:, STEP2:, STEP3:, STEP4:)

### Parsing Logic
```javascript
const parseAIResponse = (aiResponse) => {
  // Extract summary (content between "=== SUMMARY ===" and next section)
  const summaryMatch = aiResponse.match(/===\s*SUMMARY\s*===\s*\n([\s\S]*?)(?=\n===|$)/i);
  
  // Extract discussion questions (Q1:, Q2:, Q3: format)
  const discussionMatch = aiResponse.match(/===\s*DISCUSSION\s*QUESTIONS\s*===\s*\n([\s\S]*?)(?=\n===|$)/i);
  
  // Extract next steps (STEP1:, STEP2:, STEP3:, STEP4: format)
  const nextStepsMatch = aiResponse.match(/===\s*NEXT\s*STEPS\s*===\s*\n([\s\S]*?)$/i);
  
  return {
    summaryText: summaryText,
    discussionQuestions: discussionQuestions,
    nextSteps: nextSteps
  };
}
```

## Model Configuration

### Primary Model: Claude 3.5 Sonnet
```javascript
{
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
}
```

### Fallback Model: Claude 3.5 Haiku
```javascript
{
  modelId: 'arn:aws:bedrock:us-east-1:239601476690:inference-profile/us.anthropic.claude-3-5-haiku-20241022-v1:0',
  // Same configuration as above
}
```

### Final Fallback: Static Response
If both Bedrock models fail, the system generates a fallback message:
```javascript
const fallbackSummary = winner && winner.player && winner.answer
  ? `Great responses to this question! ${winner.player} takes the lead with "${winner.answer}" earning ${winner.score} points from the group. The creativity and thoughtfulness in all ${totalParticipants} answers really shows the engagement of our participants!`
  : `Fantastic participation from all ${totalParticipants} participants! The variety and creativity in the answers really showcased everyone's engagement with this question.`;
```

## Storage Format

The generated AI summary is stored in DynamoDB with this structure:
```javascript
{
  PK: `GAME#${gameId}`,
  SK: `QUESTION#${paddedQuestionNumber}#AISummary`,
  GameId: gameId,
  QuestionId: targetQuestionId,
  Summary: summaryData.summary, // For backwards compatibility
  SummaryText: summaryData.summaryText,
  DiscussionQuestions: summaryData.discussionQuestions,
  NextSteps: summaryData.nextSteps,
  FullResponse: summaryData.fullResponse,
  GeneratedAt: now,
  model: 'claude-3.5-sonnet' | 'claude-3.5-haiku' | 'fallback',
  ttl: Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60) // 30 days TTL
}
```

## Debugging and Monitoring

Enhanced logging tracks the AI generation process:
```javascript
console.log('🤖 BEDROCK: Attempting to call Claude 3.5 Sonnet...');
console.log('🤖 BEDROCK: Model ID: anthropic.claude-3-5-sonnet-20241022-v2:0');
console.log('🤖 BEDROCK: Prompt length:', prompt.length);

// Success logging
console.log('✅ CLAUDE SUCCESS: Real AI response received');
console.log('📝 AI Response preview:', aiResponse.substring(0, 200) + '...');

// Error logging  
console.error('🚨 BEDROCK API ERROR (Claude 3.5 Sonnet):');
console.error('  Error name:', error.name);
console.error('  Error message:', error.message);
console.error('  Error code:', error.code || error.$metadata?.httpStatusCode);

// Fallback logging
console.log('🔄 BEDROCK: Trying Claude 3 Haiku as fallback...');
console.log('🚨 BEDROCK FINAL FALLBACK: Using static response.');
```

## Current Status

- ✅ **Prompt Structure**: Fully documented and working
- ✅ **Response Parsing**: Structured parsing with fallback handling
- ✅ **Data Storage**: DynamoDB integration with TTL
- ⚠️ **Bedrock API**: Currently failing, using fallback responses
- ✅ **Report Integration**: AI summaries included in comprehensive reports

## Next Steps

1. **Debug Bedrock API Access**: Investigate why both Claude models are failing
2. **Model Availability**: Verify model access in the AWS account/region
3. **Enhanced Error Handling**: Implement more specific error handling for different failure types
4. **Performance Monitoring**: Add metrics for AI generation success rates