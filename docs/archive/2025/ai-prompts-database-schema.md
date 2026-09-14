# AI Prompts Database Schema

## Current Structure (Analysis Prompts)
```
PK: AIPROMPTS
SK: AIPROMPT#{promptId}
```

## Extended Structure (Analysis + Generation Prompts)

### Analysis Prompts (existing)
```
PK: AIPROMPTS  
SK: AIPROMPT#ANALYSIS#{category}#{gameType}
promptType: "analysis"
gameType: "callandanswer" | "trivia" | "polls" | "wavelength"
category: "lessons-learned" | "problem-solving" | etc.
name: "Display name"
description: "Purpose description"  
template: "Prompt template with {variables}"
status: "active" | "draft" | "archived"
isDefault: true | false
tags: ["tag1", "tag2"]
variables: { "var1": "description" }
```

### Generation Prompts (new)
```
PK: AIPROMPTS
SK: AIPROMPT#GENERATION#{scenarioType}#{gameType}  
promptType: "generation"
gameType: "call-and-answer" | "trivia" | "polls" | "wavelength"
scenarioType: "lessons-learned" | "general-knowledge" | etc.
name: "Display name"
description: "Purpose description"
basePrompt: "Core generation instruction"
contextTemplate: "Template for context addition"
audienceTemplate: "Template for audience addition"  
categoryTemplate: "Template for category requirements"
outputFormat: "JSON format specification"
defaultSettings: {
  difficulty: "medium",
  numberOfCategories: 3,
  mustHaveCategories: "default categories"
}
status: "active" | "draft" | "archived"
isDefault: true | false
tags: ["tag1", "tag2"]
```

## Migration Strategy

### Phase 1: Add Generation Prompts
1. Extract all hardcoded prompts from:
   - AIScenarioBuilder.jsx (scenario types and templates)
   - TriviaAIBuilder.jsx (trivia generation)
   - PollAIBuilder.jsx (poll generation) 
   - SurveyAIBuilder.jsx (survey generation)
   - ai-generate-scenarios.js (backend prompt building)

2. Store in DynamoDB with new schema

### Phase 2: Update APIs  
1. Extend get-ai-prompts.js to handle both types
2. Create update-ai-prompt.js for editing
3. Update generation lambdas to fetch from DB

### Phase 3: Update Frontend
1. Fetch prompts from API instead of hardcoding
2. Create prompt editor UI
3. Remove hardcoded prompt arrays

## Key Benefits
- Centralized prompt management
- Version control through database updates
- A/B testing capabilities  
- Easy prompt customization per client
- Audit trail of prompt changes