# Comprehensive Game Types Documentation - Engage2 Platform

## Table of Contents
1. [Overview](#overview)
2. [Supported Game Types](#supported-game-types)
3. [Game Type Details](#game-type-details)
   - [Call & Answer](#call--answer)
   - [Trivia](#trivia)
   - [Poll](#poll)
   - [Survey](#survey)
   - [Wavelength](#wavelength)
   - [Scenarios](#scenarios)
4. [Game Flow States](#game-flow-states)
5. [Question Formats](#question-formats)
6. [Scoring Systems](#scoring-systems)
7. [AI Integration](#ai-integration)
8. [Implementation Reference](#implementation-reference)

## Overview

The Engage2 platform supports six distinct game types, each designed for different engagement scenarios and learning objectives. All game types share a common infrastructure but have unique gameplay flows and scoring mechanisms.

## Supported Game Types

| Game Type | Purpose | Player Interaction | Voting | Scoring |
|-----------|---------|-------------------|---------|----------|
| **Call & Answer** | Open-ended discussion questions | Text responses | Yes - rank top 3 | Points for votes received |
| **Trivia** | Knowledge testing | Multiple choice (A-D) | No | Points for correct + speed bonus |
| **Poll** | Quick opinions | Multiple choice | No | Results display only |
| **Survey** | Detailed feedback | Mixed formats | No | Analytics only |
| **Wavelength** | Team alignment | 10 word associations | No | Team score for common words |
| **Scenarios** | Situational analysis | Text responses | Yes | Points for votes received |

## Game Type Details

### Call & Answer

**Purpose**: Facilitate strategic discussions and gather diverse perspectives on open-ended questions.

**Game Flow**:
```
CREATED → STARTED → ASK#001 → VOTE#001 → RESULTS#001 → ASK#002 → ...
```

**Question Format**:
```javascript
{
  id: timestamp,
  title: "Question title",           // Main question shown to players
  detail: "Detailed context",        // Background information
  category: "Category",              // Question category
  school: "Context",                 // Business/Trade school context
  customInstructions: "Instructions", // Specific response guidance
  active: true
}
```

**Player Experience**:
1. View question and context
2. Submit text response (unlimited length)
3. Vote on other players' responses (rank top 3)
4. View results with vote tallies

**Scoring**:
- 1st place vote: 3 points
- 2nd place vote: 2 points  
- 3rd place vote: 1 point
- Cumulative scoring across rounds

**Use Cases**:
- Lessons learned discussions
- Problem-solving sessions
- Strategic planning
- Team building exercises
- Opinion gathering

### Trivia

**Purpose**: Test knowledge and create competitive learning experiences.

**Game Flow**:
```
CREATED → STARTED → ASK#001 → RESULTS#001 → ASK#002 → ...
```
*Note: No voting phase for trivia*

**Question Format**:
```javascript
{
  id: timestamp,
  title: "Question title",          // Short descriptive title
  questionDetail: "Full question",  // The actual trivia question
  category: "Category",             
  school: "Context",
  optionA: "First choice",
  optionB: "Second choice",
  optionC: "Third choice",
  optionD: "Fourth choice",
  correctAnswer: "OptionA",         // Must be exactly "OptionA", "OptionB", etc.
  answerDetails: "Explanation",     // Educational context for the answer
  difficulty: "medium",             // easy, medium, hard
  active: true
}
```

**Player Experience**:
1. View question with 4 multiple choice options
2. Select answer (single choice)
3. View results with correct answer highlighted
4. See personal score and leaderboard

**Scoring**:
- Base points: 100 for correct answer
- Speed bonus: Up to 50 points based on response time
- No points for incorrect answers
- Individual cumulative scoring

**Use Cases**:
- Knowledge assessment
- Training reinforcement
- Team competitions
- Ice breakers
- Educational games

### Poll

**Purpose**: Quick opinion gathering and preference measurement.

**Game Flow**:
```
CREATED → STARTED → ASK#001 → VOTE#001 → RESULTS#001 → ASK#002 → ...
```

**Question Format**:
```javascript
{
  id: timestamp,
  title: "Poll question",
  detail: "Additional context",
  category: "Category",
  options: ["Option 1", "Option 2", "Option 3", "Option 4"],
  allowMultiple: false,              // Single or multiple selection
  active: true
}
```

**Player Experience**:
1. View poll question
2. Select from predefined options
3. Submit response
4. Vote on written responses from others
5. View aggregated results

**Scoring**: No scoring - results display only

**Use Cases**:
- Quick decisions
- Preference gathering
- Feedback collection
- Meeting polls
- Audience engagement

### Survey

**Purpose**: Comprehensive feedback collection with multiple question types.

**Game Flow**:
```
CREATED → STARTED → SURVEY → COMPLETE
```

**Question Formats**:
```javascript
// Rating Question
{
  type: "rating",
  question: "Rate your satisfaction",
  scale: "1-5",                      // or "1-10"
  labels: ["Poor", "Excellent"]
}

// Multiple Choice
{
  type: "multiple_choice",
  question: "Select your preference",
  options: ["Option A", "Option B", "Option C"],
  allowMultiple: false
}

// Text Entry
{
  type: "text_entry",
  question: "Provide detailed feedback",
  maxLength: 500
}
```

**Player Experience**:
1. Progress through multiple question types
2. Submit comprehensive feedback
3. View completion confirmation

**Scoring**: No scoring - analytics only

**Use Cases**:
- Employee feedback
- Training evaluation
- Customer satisfaction
- Event feedback
- Research surveys

### Wavelength

**Purpose**: Measure team alignment and shared thinking patterns.

**Game Flow**:
```
CREATED → STARTED → ASK#001 → RESULTS#001 → ASK#002 → ...
```

**Question Format**:
```javascript
{
  id: timestamp,
  title: "Association prompt",        // Main prompt
  topic: "Topic word",               // Word to associate with
  instructions: "Enter 10 words that come to mind",
  category: "Category",
  active: true
}
```

**Player Experience**:
1. View topic word or prompt
2. Enter 10 word associations
3. View team results showing common words
4. See connection score

**Scoring**:
- Team-based scoring
- Points for each common word (mentioned by 2+ players)
- Connection score: percentage of shared words
- Everyone gets the same score per round

**Use Cases**:
- Team building
- Cultural alignment
- Creative brainstorming
- Communication assessment
- Group dynamics analysis

### Scenarios

**Purpose**: Analyze situational responses and decision-making approaches.

**Game Flow**:
```
CREATED → STARTED → ASK#001 → VOTE#001 → RESULTS#001 → ASK#002 → ...
```

**Question Format**:
```javascript
{
  id: timestamp,
  title: "Scenario title",
  scenario: "Detailed situation description",
  challenge: "Specific challenge to address",
  context: "Additional background",
  category: "Category",
  responsePrompt: "What would you do?",
  active: true
}
```

**Player Experience**:
1. Read detailed scenario
2. Submit response approach
3. Vote on others' approaches
4. Discuss results

**Scoring**: Same as Call & Answer (voting-based)

**Use Cases**:
- Leadership development
- Ethics training
- Decision-making practice
- Problem-solving exercises
- Case study analysis

## Game Flow States

All game types follow a state machine pattern:

| State | Description | Player Actions | Host Actions |
|-------|-------------|----------------|--------------|
| `CREATED` | Game exists but not started | Cannot join | Start game, configure settings |
| `STARTED` | Game open for players | Join game | Begin first question |
| `ASK#XXX` | Question displayed | Submit answer | Monitor progress, show results |
| `VOTE#XXX` | Voting phase (if applicable) | Vote on answers | Monitor voting, show results |
| `RESULTS#XXX` | Results displayed | View results | Next question or end game |
| `END` | Game completed | View final scores | Download report |

## Question Formats

### Common Fields

All question types share these base fields:
- `id`: Unique identifier (usually timestamp)
- `category`: Question category for organization
- `school`: Context (Business School, Trade School, etc.)
- `active`: Whether question is currently active

### Type-Specific Fields

Each game type has additional required fields as detailed in the sections above.

## Scoring Systems

### Individual Scoring (Trivia)
- Points awarded for correct answers
- Speed bonuses for quick responses
- Cumulative individual leaderboard
- No interaction between players' scores

### Voting-Based Scoring (Call & Answer, Scenarios)
- Points from peer voting
- Ranked choice voting (1st, 2nd, 3rd)
- Rewards quality responses
- Encourages thoughtful participation

### Team Scoring (Wavelength)
- Collective performance metrics
- Everyone gets the same score
- Rewards alignment and shared thinking
- Builds team cohesion

### No Scoring (Poll, Survey)
- Focus on data collection
- Results for insight, not competition
- Removes competitive pressure
- Encourages honest responses

## AI Integration

### AI-Powered Features

1. **Question Generation**
   - Custom prompts for each game type
   - Context-aware question creation
   - Difficulty balancing
   - Category management

2. **Result Analysis**
   - Automatic summarization
   - Key theme extraction
   - Discussion question generation
   - Next steps recommendations

3. **Prompt Templates**
   - Pre-configured for each game type
   - Customizable per category
   - Industry-specific variations
   - Multi-language support

### AI Prompt Structure

Each game type has specialized AI prompts stored in `default-ai-prompts.json`:
- Call & Answer: Focus on discussion facilitation
- Trivia: Educational insights and fact sharing
- Poll: Consensus building analysis
- Survey: Comprehensive feedback analysis
- Wavelength: Team alignment insights
- Scenarios: Decision-making patterns

## Implementation Reference

### Key Files

**Backend (Lambda Functions)**:
- `/websocket/create-game.js` - Game creation with type specification
- `/game/get-results.js` - Type-specific result calculation
- `/game/get-question.js` - Question retrieval and formatting
- `/admin/ai-generate-*.js` - AI generation for each type

**Frontend (React Components)**:
- `/src/GameHostPage.jsx` - Host interface adapts to game type
- `/src/PlayerPage.jsx` - Player interface changes per type
- `/src/components/*Builder.jsx` - Type-specific builders

**Database Structure**:
- `GAME#${gameId}#METADATA` - Stores game type
- `QUESTION#XXX#ANSWER#` - Answer format varies by type
- `QUESTION#XXX#VOTE#` - Only for voting-enabled types
- `QUESTION#XXX#RESULTS` - Type-specific result storage

### Adding New Game Types

To add a new game type:
1. Define question format schema
2. Implement result calculation logic in `get-results.js`
3. Add AI prompt template to `default-ai-prompts.json`
4. Create builder component in frontend
5. Update game flow state machine if needed
6. Add type-specific UI in `PlayerPage.jsx` and `GameHostPage.jsx`

## Best Practices

### Game Type Selection
- **Call & Answer**: Best for open discussion and idea generation
- **Trivia**: Ideal for knowledge testing and competitive learning
- **Poll**: Quick consensus or preference checking
- **Survey**: Comprehensive feedback collection
- **Wavelength**: Team building and alignment measurement
- **Scenarios**: Complex situation analysis and training

### Question Design
- Keep questions clear and concise
- Provide adequate context without overwhelming
- Use appropriate difficulty levels
- Mix question types within sessions
- Consider time constraints

### Engagement Tips
- Start with easier questions to build confidence
- Use variety to maintain interest
- Allow sufficient time for thoughtful responses
- Encourage participation over competition
- Follow up with discussion for deeper learning

---

*Last Updated: January 2025*
*Version: 2.0*