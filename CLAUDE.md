# CLAUDE.md - Engage2 Project Context

## Project Overview
Real-time engagement platform for strategic thinking sessions with AWS serverless architecture.

## Key Technologies
- **Frontend**: React, WebSockets, QR codes
- **Backend**: AWS Lambda (Node.js), DynamoDB, API Gateway, WebSocket API
- **Infrastructure**: SAM (Serverless Application Model), CloudFormation
- **Deployment**: Custom deploy scripts for dev/test/prod environments

## Architecture Patterns
- **Database**: Single-table DynamoDB design with partition keys like `GAME#{gameId}`, `PLAYER#{playerId}`, `GAMES`
- **Real-time**: WebSocket connections for live updates between host and players
- **Game States**: CREATED → STARTED → ASK#{questionid} → VOTE#{questionid} → RESULTS#{questionid}
- **Categories**: Bitmask system (HostMask1-8/9-16/17-24) supporting up to 24 categories per game
- **Game Lifecycle**: Create (not playable) → Start (playable) → Play

## Key Files & Directories
```
/lambda-functions/
  /websocket/          # WebSocket handlers, game creation
  /game/               # Game APIs (join, get-players, start, etc.)
  /admin/              # Admin functions (clear, AI generation)
/src/src/              # React frontend source
  GameHostPage.jsx     # Main host interface
  GamePlayerPage.jsx   # Player interface
  /components/         # Reusable components
/template-clean.yaml   # SAM infrastructure template
```

## Common Commands

### Development & Deployment
```bash
# Deploy everything (backend + frontend) to dev
./deployall

# Individual deployment scripts
./scripts/deploy-clean.sh engdev eng.dev.seibtribe.us  # Backend only
./scripts/deploy-frontend-eng.sh                      # Frontend only

# Legacy deployment (if needed)
./deploy.sh dev
./deploy.sh test

# Build only (without deploy)
sam build -t template-clean.yaml

# View logs for specific function
sam logs -n CreateGameFunction --stack-name engdev --tail

# Local development
npm start  # Frontend development server
sam local start-api  # Local API testing
```

### Database Operations
```bash
# Clear all games (dev only)
curl -X DELETE https://api.dev.domain.com/admin/clear-all-games

# Clear specific game
curl -X DELETE https://api.dev.domain.com/admin/clear-game/{gameId}
```

### Testing Commands
```bash
# Test game creation
curl -X POST https://api.dev.domain.com/games \
  -H "Content-Type: application/json" \
  -d '{"eventTitle":"Test Game","gameType":"call-and-answer","questionSetId":"amazonleadershipprinciplesfornewhires"}'

# Get game status
curl https://api.dev.domain.com/games/{gameId}?role=host

# Get players
curl https://api.dev.domain.com/games/{gameId}/players
```

## Current Issues & Recent Fixes

### Fixed Issues ✅
- Game creation infinite loop resolved
- WebSocket player join notifications implemented  
- Game start/create separation implemented
- Category bitmask restoration from database
- URL-based game loading with proper status checking

### Active Issues 🔄
- Category bitmask generation showing all zeros (debug logging added)
- Categories flashing active then deactivating (partially fixed)
- Player date formatting showing 1969 epoch dates

### Game Flow Architecture
```
Host Creates Game → Game in CREATED state (Started: false)
     ↓
Host Starts Game → Game in STARTED state (Started: true, players can join)
     ↓  
Host Begins Questions → Game states: ASK# → VOTE# → RESULTS#
```

## Development Notes

### WebSocket Integration
- Host connections stored as `GAME#{gameId}#CONNECTION#{connectionId}` with `ConnectionType: HOST`
- Player connections for real-time updates
- Automatic cleanup of stale connections (410 status codes)

### Category Management
- Categories selected via bitmask system (3 x 8-bit masks = 24 categories max)
- Frontend uses Set for activeCategoryIds, converts to array for API calls
- Backend converts selectedCategories array to bitmask for storage

### Security & Access
- Games support public/private visibility with access codes
- Players blocked from joining non-started games
- Host-only endpoints protected with role-based access

### AI Integration
- AWS Bedrock (Claude 3 Haiku) for game result summaries
- AI summaries stored in DynamoDB with caching
- Structured prompts for strategic business insights

### Question Format Standards

#### Trivia Question Format
Both standard and advanced trivia builders create questions with this complete format:
```javascript
{
  id: timestamp,                    // Unique identifier
  title: "Question title",          // Short descriptive title
  questionDetail: "Full question text", // Actual question shown to players
  category: "Category",             // Question category (e.g., "History", "Science")
  school: "Context",                // School/context (e.g., "Business School")
  optionA: "First choice",          // Answer option A
  optionB: "Second choice",         // Answer option B
  optionC: "Third choice",          // Answer option C
  optionD: "Fourth choice",         // Answer option D
  correctAnswer: "OptionA",         // Correct answer ID (OptionA, OptionB, OptionC, or OptionD)
  answerDetails: "Explanation",     // Educational explanation of correct answer
  difficulty: "medium",             // Difficulty level: "easy", "medium", "hard"
  active: true                      // Whether question is active in the set
}
```

**Key Requirements:**
- `questionDetail` field contains the actual question text shown to players
- `optionA`-`optionD` contain the four multiple choice options
- `correctAnswer` must be exactly "OptionA", "OptionB", "OptionC", or "OptionD"
- `answerDetails` provides educational context shown in results
- Both standard (BuilderPage) and advanced (AdminPage) builders produce identical format

#### Call & Answer Question Format
Call & Answer questions use this standardized format for open-ended discussion questions:
```javascript
{
  id: timestamp,                    // Unique identifier
  title: "Question title",          // Main question or prompt shown to players
  detail: "Detailed context",       // Background information and context
  category: "Category",             // Question category (e.g., "Leadership", "Strategy")
  school: "Context",                // School/context (e.g., "Business School")
  customInstructions: "Instructions", // Specific instructions for this question
  active: true                      // Whether question is active in the set
}
```

**Key Requirements:**
- `title` field contains the main question shown to players
- `detail` provides background information and context
- `category` organizes questions by theme or subject area
- `customInstructions` can provide specific guidance for responses
- Players submit open-ended text responses that are then voted on by peers

## Environment Configuration

### API Endpoints
- **Dev**: `https://r4c24mqku1.execute-api.us-east-1.amazonaws.com/dev`
- **Test**: `https://api.test.seibtribe.us`  
- **Prod**: `https://api.seibtribe.us`

### Frontend URLs
- **Dev**: `https://eng.dev.seibtribe.us`
- **Test**: `https://eng.test.seibtribe.us`
- **Prod**: `https://eng.seibtribe.us`

## Debugging Tips

### Common Log Patterns
```bash
# Game creation issues
sam logs -n CreateGameFunction --stack-name engagedev --filter "ERROR"

# WebSocket connection issues  
sam logs -n ConnectFunction --stack-name engagedev --filter "WebSocket"

# Category bitmask debugging
sam logs -n CreateGameFunction --stack-name engagedev --filter "DEBUG.*categories"
```

### Frontend Debugging
- Game state in browser console: Check `gameState`, `activeCategoryIds`, `gameId`
- WebSocket status: Look for connection/disconnection messages
- API calls: Monitor Network tab for failed requests

### Database Debugging
```bash
# Check game exists
aws dynamodb get-item --table-name engagedev --key '{"PK":{"S":"GAME#1234"},"SK":{"S":"METADATA"}}'

# Check category state  
aws dynamodb get-item --table-name engagedev --key '{"PK":{"S":"GAME#1234"},"SK":{"S":"STATE#CATS"}}'
```

## Performance Considerations
- Single DynamoDB table with efficient query patterns
- WebSocket connections for real-time updates (no polling)
- TTL for automatic cleanup (90 days creation, 7 days active)
- Lambda cold start mitigation with connection reuse

## Recent Architecture Changes
1. **Game Lifecycle Separation**: Create vs Start operations now separate
2. **Started Flag**: Added to all game records for proper state management  
3. **Player Join Blocking**: Players cannot join non-started games
4. **Game History**: API and UI for hosts to manage multiple games
5. **Enhanced Logging**: Debug logs for troubleshooting category selection

---

# Game Flow Documentation

## Trivia Game Flow

### Complete State Flow Diagram
```
CREATED (host creates game)
   ↓ Host clicks "Start Game"
STARTED (players can join)
   ↓ Host clicks "Start Question" 
ASK#001 (question displayed, players answer)
   ↓ Host clicks "Show Results" (trivia has no voting phase)
RESULTS#001 (results displayed with scores)
   ↓ Host clicks "Next Question"
ASK#002 (next question)
   ↓ (repeat cycle)
END (game finished)
```

### State Management & Data Sources

#### 1. Game State Record (`GAME#{gameId}` / `STATE`)
**Purpose**: Single source of truth for current game state
**API Updates**: 
- `start-question.js` → Sets `ASK#001`
- `get-results.js` → Sets `RESULTS#001` 
- `start-question.js` (next question) → Sets `ASK#002`

**Fields**:
```javascript
{
  PK: "GAME#12345",
  SK: "STATE", 
  State: "ASK#001",           // Current state
  LessonNumber: 1,            // Current question number (numeric)
  CurrentQuestionId: "001",   // Padded question ID
  UpdatedAt: "2023-..."
}
```

#### 2. Question Reference Record (`GAME#{gameId}` / `QUESTION#{questionNumber}#REF`)
**Purpose**: Links game question numbers to actual question data
**API Updates**: `start-question.js` creates when starting new question

**Fields**:
```javascript
{
  PK: "GAME#12345",
  SK: "QUESTION#001#REF",
  SourceQuestionId: "question-id-from-set", // Original question ID
  SetId: "trivia-tech-culture",             // Question set ID  
  StartedAt: "2023-...",                    // When question started
  GameId: "12345"
}
```

### WebSocket Message Flow

#### Host → Players State Changes
**Sent by**: Host page when state changes via HTTP APIs
**WebSocket Handler**: `message.js` → `handleHostMessage()`
**Message Format**:
```javascript
{
  type: 'hostMessage',
  messageType: 'ASK#001',     // or 'RESULTS#001'
  gameId: '12345',
  timestamp: '2023-...'
}
```

#### Player → Host Answer Notifications  
**Sent by**: Player page when answering questions
**WebSocket Handler**: `message.js` → `handlePlayerMessage()` → `handlePlayerAnswer()`
**Message Format**:
```javascript
// From player to WebSocket
{
  messageType: 'ANSWER#1',
  gameId: '12345', 
  playerName: 'Alice',
  answer: 'C',                // Single letter
  answerType: 'trivia'
}

// Notification sent to host
{
  type: 'playerAnswered',
  messageType: 'ANSWER#1',
  gameId: '12345',
  playerName: 'Alice', 
  questionNumber: '1'
}
```

### Host Page Components & Data Sources

#### GameHostPage.jsx Main State
**Data Sources**:
- `gameState` - HTTP GET `/games/{gameId}?role=host`
- `players` - HTTP GET `/games/{gameId}/players`  
- `answers` - HTTP GET `/games/{gameId}/answers/{questionNumber}` (trivia only)
- `results` - HTTP GET `/games/{gameId}/results/{questionNumber}`

#### Question Display Component
**When**: State = `ASK#001`
**Data Source**: `gameState.currentQuestionData` from game state API
**Components**:
```javascript
// Large title
<h2>{currentQuestionData.title}</h2>

// Smaller detail text  
<p>{currentQuestionData.questionDetail}</p>

// Trivia options (trivia only)
<div className="trivia-options">
  <div>A: {currentQuestionData.optionA}</div>
  <div>B: {currentQuestionData.optionB}</div>
  <div>C: {currentQuestionData.optionC}</div>
  <div>D: {currentQuestionData.optionD}</div>
</div>
```

#### Answer Progress Component  
**When**: State = `ASK#001`
**Data Sources**: 
- Player count: `players.length` (local state)
- Answers received: WebSocket `playerAnswered` notifications → updates `answeredPlayers` set
- OR refresh via HTTP GET `/games/{gameId}/answers/{questionNumber}`

**Display**: "Answers: 3/5 players answered"

#### Results Display Component
**When**: State = `RESULTS#001` 
**Data Source**: `results` from HTTP GET `/games/{gameId}/results/{questionNumber}`
**Components**:
```javascript
// Player results with scores
results.playerResults.map(player => (
  <div key={player.playerName}>
    <span>{player.playerName}</span>
    <span>+{player.pointsEarned} pts</span>
    <span>Total: {player.totalScore}</span>
  </div>
))

// Correct answer highlighting (trivia)
<div className="trivia-result-option correct">
  {correctAnswerLetter}: {correctAnswerText}
</div>
```

### Player Page Components & Data Sources

#### PlayerPage.jsx Main State
**Data Sources**:
- `gameState` - HTTP GET `/games/{gameId}/state/{playerId}` 
- WebSocket messages for state changes

#### Question Display Component
**When**: State = `ASK#001`
**Data Source**: `gameState.currentQuestionData`
**Components**:
```javascript
// Question title and detail
<h3>{currentQuestionData.title}</h3>
<p>{currentQuestionData.questionDetail}</p>

// Answer options (trivia)
{['A', 'B', 'C', 'D'].map(option => (
  <button 
    key={option}
    onClick={() => submitTriviAnswer(option)}
  >
    {option}: {currentQuestionData[`option${option}`]}
  </button>
))}
```

#### Answer Submission
**Trigger**: Player clicks answer button
**Method**: WebSocket message to `message.js`
**Message**:
```javascript
{
  messageType: 'ANSWER#1',
  gameId: gameId,
  playerName: playerName,
  answer: 'C',
  answerType: 'trivia'
}
```
**Storage**: `QUESTION#001#ANSWER#Alice` in DynamoDB

#### Results Display Component
**When**: State = `RESULTS#001` and WebSocket state change received
**Data Source**: HTTP GET `/games/{gameId}/results/{questionNumber}`
**Components**:
```javascript
// Show if player was correct/incorrect
<div className={playerResult.isCorrect ? 'player-correct' : 'player-wrong'}>
  Your answer: {playerResult.playerAnswer}
  {playerResult.isCorrect ? '✓ Correct!' : '✗ Incorrect'}
</div>

// Show correct answer with green highlighting
<div className="correct-answer">
  Correct: {correctAnswerLetter}: {correctAnswerText}
</div>

// Show points earned
<div>+{playerResult.pointsEarned} points</div>
<div>Total Score: {playerResult.totalScore}</div>
```

---

## Poll Game Flow  

### Complete State Flow Diagram
```
CREATED (host creates poll)
   ↓ Host clicks "Start Game"
STARTED (players can join)
   ↓ Host clicks "Start Question"
ASK#001 (question displayed, players submit responses)
   ↓ Host clicks "Start Voting"
VOTE#001 (player responses shown, players vote)
   ↓ Host clicks "Show Results"  
RESULTS#001 (voting results displayed)
   ↓ Host clicks "Next Question"
ASK#002 (next question)
   ↓ (repeat cycle)
END (poll finished)
```

### State Management & Data Sources

#### Poll-Specific Records
**Player Answers**: `QUESTION#001#ANSWER#{playerName}`
```javascript
{
  PK: "GAME#12345",
  SK: "QUESTION#001#ANSWER#Alice",
  PlayerName: "Alice",
  Answer: "We should focus on mobile-first development",
  AnswerType: "text",
  SubmittedAt: "2023-..."
}
```

**Player Votes**: `QUESTION#001#VOTE#{voterName}`
```javascript
{
  PK: "GAME#12345", 
  SK: "QUESTION#001#VOTE#Bob",
  PlayerName: "Bob",           // Who voted
  VotedFor: "Alice",          // Who they voted for
  SubmittedAt: "2023-..."
}
```

**Vote Results**: `QUESTION#001#RESULTS`
```javascript
{
  PK: "GAME#12345",
  SK: "QUESTION#001#RESULTS", 
  VoteTallies: {
    "Alice": 3,
    "Charlie": 2  
  },
  Winners: ["Alice"],
  TotalVotes: 5,
  CreatedAt: "2023-..."
}
```

### WebSocket Message Flow

#### Host → Players State Changes
**State Changes**:
- `ASK#001` - Show question, collect answers
- `VOTE#001` - Show answers, collect votes  
- `RESULTS#001` - Show voting results

#### Player Messages
**Answer Submission**:
```javascript
{
  messageType: 'ANSWER#1',
  gameId: '12345',
  playerName: 'Alice', 
  answer: 'Focus on mobile development',
  answerType: 'text'
}
```

**Vote Submission**:
```javascript
{
  messageType: 'VOTE#QUESTION#category#001',
  gameId: '12345',
  playerName: 'Bob',
  votedFor: 'Alice'  // Player name they're voting for
}
```

### Host Page Components & Data Sources

#### Answer Collection Phase (`ASK#001`)
**Data Sources**:
- Submitted answers: HTTP GET `/games/{gameId}/answers/{questionNumber}`
- Progress tracking: WebSocket `playerAnswered` notifications

**Display**:
```javascript
// Show submitted answers as they come in
answers.map(answer => (
  <div key={answer.playerName}>
    <strong>{answer.playerName}:</strong>
    <p>{answer.answer}</p>
  </div>
))

// Progress indicator  
<div>Answers: {answers.length}/{players.length}</div>
```

#### Voting Phase (`VOTE#001`) 
**Data Sources**:
- All answers: HTTP GET `/games/{gameId}/answers/{questionNumber}`
- Vote progress: WebSocket `playerVoted` notifications

**Display**:
```javascript
// Show all answers for voting
answers.map(answer => (
  <div key={answer.playerName} className="voting-option">
    <strong>{answer.playerName}:</strong>
    <p>{answer.answer}</p>
    <span className="vote-count">{voteTallies[answer.playerName] || 0} votes</span>
  </div>
))
```

#### Results Phase (`RESULTS#001`)
**Data Source**: HTTP GET `/games/{gameId}/results/{questionNumber}`
**Display**:
```javascript
// Show winners and vote tallies
<div className="poll-results">
  <h3>Winners: {results.winners.join(', ')}</h3>
  {Object.entries(results.voteTallies).map(([player, votes]) => (
    <div key={player} className={results.winners.includes(player) ? 'winner' : ''}>
      <span>{player}: {votes} votes</span>
      <div className="vote-bar" style={{width: `${(votes/results.totalVotes)*100}%`}} />
    </div>
  ))}
</div>
```

### Player Page Components & Data Sources

#### Answer Submission Phase (`ASK#001`)
```javascript
// Text input for open-ended responses
<textarea 
  value={playerAnswer}
  onChange={(e) => setPlayerAnswer(e.target.value)}
  placeholder="Enter your response..."
/>
<button onClick={submitAnswer}>Submit Answer</button>
```

#### Voting Phase (`VOTE#001`)
**Data Source**: HTTP GET `/games/{gameId}/answers/{questionNumber}`
```javascript
// Show all answers, let player vote
answers.map(answer => (
  <div key={answer.playerName} className="voting-option">
    <p><strong>{answer.playerName}:</strong> {answer.answer}</p>
    <button 
      onClick={() => submitVote(answer.playerName)}
      disabled={answer.playerName === playerName} // Can't vote for self
    >
      Vote for this
    </button>
  </div>
))
```

#### Results Phase (`RESULTS#001`) 
**Data Source**: HTTP GET `/games/{gameId}/results/{questionNumber}`
```javascript
// Show results and highlight if player won
<div className="poll-results">
  {results.winners.includes(playerName) && (
    <div className="player-won">🎉 You won this round!</div>
  )}
  
  <div>Your answer received {results.voteTallies[playerName] || 0} votes</div>
  
  {/* Show all results */}
  {Object.entries(results.voteTallies).map(([player, votes]) => (
    <div key={player} className={results.winners.includes(player) ? 'winner' : ''}>
      {player}: {votes} votes
    </div>
  ))}
</div>
```

---

## Critical Implementation Notes

### State Synchronization
- **HTTP APIs** handle state persistence (DynamoDB writes)
- **WebSocket messages** handle real-time notifications (no data writes)
- **Frontend components** react to WebSocket state changes, then fetch data via HTTP

### Data Flow Pattern
1. Host action → HTTP API call → DynamoDB state update
2. HTTP API → WebSocket broadcast → All connected clients notified  
3. Client receives WebSocket → Updates local state → Fetches fresh data via HTTP

### Error Handling
- WebSocket disconnection → Auto-reconnect + state refresh via HTTP
- Failed HTTP calls → Retry with exponential backoff
- State mismatch → Force refresh from `/games/{gameId}/state`

### Performance Optimizations
- Cache question data in component state to avoid repeated API calls
- Batch WebSocket notifications to prevent spam
- Use connection pooling for DynamoDB operations
- Implement request deduplication for rapid successive calls

---
*Last Updated: 2025-07-22*