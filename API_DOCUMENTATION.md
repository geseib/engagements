# 🔌 Engagements Platform - API Documentation

**Comprehensive API reference for the real-time interactive meeting platform**

---

## 🏗️ API Architecture Overview

The Engagements Platform uses a hybrid API architecture:

- **WebSocket APIs**: Real-time communication for live gameplay and updates
- **HTTP REST APIs**: Traditional request-response for game management
- **Admin APIs**: Secure endpoints for content and system management

**Base WebSocket URL**: `wss://{api-gateway-id}.execute-api.{region}.amazonaws.com/{stage}`  
**Base HTTP URL**: `https://{api-gateway-id}.execute-api.{region}.amazonaws.com/{stage}`

---

## 🔄 WebSocket APIs (Real-time)

### Connection Management

#### Connect to WebSocket
```javascript
const ws = new WebSocket('wss://api.engagements.sb.seibtribe.us');
```
**Handler**: `connect.js`  
**Purpose**: Establishes WebSocket connection and stores connection info  
**Response**: Connection ID and success status

#### Disconnect from WebSocket
**Handler**: `disconnect.js`  
**Purpose**: Cleanup connection data and remove from active connections  
**Automatic**: Triggered on client disconnect

#### Message Routing
**Handler**: `message.js`  
**Purpose**: Routes WebSocket messages to appropriate handlers  
**Format**: JSON messages with `action` field

---

### Game Management

#### Create Game
```json
{
  "action": "create-game",
  "data": {
    "gameType": "trivia|poll|survey|call-answer|prioritization",
    "hostName": "string",
    "settings": {
      "maxPlayers": 50,
      "timeLimit": 30,
      "questionSet": "string"
    }
  }
}
```
**Handler**: `create-game.js`  
**Purpose**: Creates new game instance with specified configuration  
**Response**: Game ID, WebSocket endpoint, and initial state

#### Start Question
```json
{
  "action": "start-question",
  "data": {
    "gameId": "string",
    "questionIndex": 0,
    "timeLimit": 30
  }
}
```
**Handler**: `start-question.js`  
**Purpose**: Initiates a new question round  
**Response**: Question data and timer information  
**Broadcast**: Sends question to all connected participants

#### Start Vote
```json
{
  "action": "start-vote",
  "data": {
    "gameId": "string",
    "voteType": "answer|solution|priority",
    "options": ["option1", "option2", "option3"]
  }
}
```
**Handler**: `start-vote.js`  
**Purpose**: Initiates voting phase for call-answer or prioritization  
**Response**: Vote configuration and available options  
**Broadcast**: Voting UI activated for participants

---

### Participant Actions

#### Submit Answer
```json
{
  "action": "submit-answer",
  "data": {
    "gameId": "string",
    "playerId": "string",
    "questionId": "string",
    "answer": "string|number|array",
    "timestamp": "ISO-8601"
  }
}
```
**Handler**: `submit-answer.js`  
**Purpose**: Collects participant answers during gameplay  
**Response**: Submission confirmation and current stats  
**Validation**: Answer format, time limits, duplicate submissions

#### Submit Vote
```json
{
  "action": "submit-vote",
  "data": {
    "gameId": "string",
    "playerId": "string",
    "voteTarget": "string",
    "voteType": "up|down|rank",
    "value": "number"
  }
}
```
**Handler**: `submit-votes.js`  
**Purpose**: Processes vote submissions for collaborative exercises  
**Response**: Vote confirmation and updated tallies  
**Features**: Duplicate vote prevention, weighted voting

---

### Data Retrieval

#### Get Complete Game State
```json
{
  "action": "get-complete-state",
  "data": {
    "gameId": "string"
  }
}
```
**Handler**: `get-complete-state.js`  
**Purpose**: Retrieves comprehensive game state for reconnection  
**Response**: Full game state including players, questions, answers, votes  
**Use Case**: Client reconnection, state synchronization

#### Get Answers
```json
{
  "action": "get-answers",
  "data": {
    "gameId": "string",
    "questionId": "string"
  }
}
```
**Handler**: `get-answers.js`  
**Purpose**: Retrieves submitted answers for a specific question  
**Response**: All participant answers with metadata  
**Privacy**: Respects answer visibility settings

#### Get AI Summary
```json
{
  "action": "get-ai-summary",
  "data": {
    "gameId": "string",
    "type": "question|session|insights",
    "context": "string"
  }
}
```
**Handler**: `get-ai-summary.js`  
**Purpose**: Generates AI-powered insights and summaries  
**Response**: Formatted summary with key insights  
**Features**: Sentiment analysis, trend identification, recommendations

---

### Game State Management

#### Show Results
```json
{
  "action": "show-results",
  "data": {
    "gameId": "string",
    "resultType": "question|vote|final",
    "includeDetails": true
  }
}
```
**Handler**: `show-results.js`  
**Purpose**: Displays results to participants  
**Response**: Formatted results with visualizations  
**Broadcast**: Results screen shown to all participants

#### Set Game State
```json
{
  "action": "set-game-state",
  "data": {
    "gameId": "string",
    "state": "waiting|active|paused|completed",
    "metadata": {}
  }
}
```
**Handler**: `set-game-state.js`  
**Purpose**: Updates overall game state  
**Response**: State change confirmation  
**Broadcast**: State change notification to all participants

#### Save Game Context
```json
{
  "action": "save-game-context",
  "data": {
    "gameId": "string",
    "context": "string",
    "metadata": {}
  }
}
```
**Handler**: `save-game-context.js`  
**Purpose**: Saves game context for AI processing  
**Response**: Save confirmation  
**Use Case**: AI analysis, session reporting

---

## 📡 HTTP REST APIs

### Game Operations

#### Get Game State
```http
GET /api/game/{gameId}/state
```
**Handler**: `get-game-state.js`  
**Purpose**: Retrieves current game state via HTTP  
**Response**: JSON with game status, players, current question  
**Use Case**: Status checks, monitoring, debugging

#### Get Players
```http
GET /api/game/{gameId}/players
```
**Handler**: `get-players.js`  
**Purpose**: Lists all participants in a game  
**Response**: Array of player objects with status and scores  
**Features**: Player filtering, sorting options

#### Join Game
```http
POST /api/game/{gameId}/join
Content-Type: application/json

{
  "playerName": "string",
  "playerId": "string"
}
```
**Handler**: `join-game.js`  
**Purpose**: Adds participant to game session  
**Response**: Player registration confirmation and WebSocket details  
**Validation**: Name uniqueness, game capacity, active status

#### Validate Game
```http
POST /api/game/{gameId}/validate
Content-Type: application/json

{
  "validationType": "basic|detailed",
  "context": "string"
}
```
**Handler**: `validate-game.js` / `validate-game-detailed.js`  
**Purpose**: Validates game state and configuration  
**Response**: Validation results with error details  
**Types**: Basic validation, detailed integrity checks

---

### Content Management

#### Get Categories
```http
GET /api/content/categories
```
**Handler**: `get-categories.js`  
**Purpose**: Retrieves available question categories  
**Response**: Array of category objects with metadata  
**Features**: Category filtering, enabled/disabled status

#### Get Question Sets
```http
GET /api/content/question-sets
```
**Handler**: `get-question-sets.js`  
**Purpose**: Lists available question sets  
**Response**: Question set metadata with preview  
**Features**: Pagination, filtering by category/type

#### Get Category State
```http
GET /api/content/categories/{categoryId}/state
```
**Handler**: `get-category-state.js`  
**Purpose**: Retrieves state of specific category  
**Response**: Category configuration and usage statistics  
**Features**: Performance metrics, usage tracking

---

## 🛡️ Admin APIs

### Content Administration

#### Upload Questions
```http
POST /api/admin/questions/upload
Content-Type: multipart/form-data

{
  "file": "CSV file",
  "category": "string",
  "type": "trivia|poll|survey|call-answer"
}
```
**Handler**: `upload-questions.js`  
**Purpose**: Uploads question content via CSV  
**Response**: Upload status and validation results  
**Validation**: CSV format, question structure, duplicates

#### AI Generate Questions
```http
POST /api/admin/ai/generate
Content-Type: application/json

{
  "type": "trivia|poll|survey|scenario",
  "topic": "string",
  "difficulty": "easy|medium|hard",
  "count": 10,
  "context": "string"
}
```
**Handler**: `ai-generate-questions.js`  
**Purpose**: Generates questions using AI  
**Response**: Generated questions with metadata  
**Features**: Topic customization, difficulty levels, bulk generation

#### Edit Question Set
```http
PUT /api/admin/question-sets/{setId}
Content-Type: application/json

{
  "name": "string",
  "description": "string",
  "questions": [],
  "metadata": {}
}
```
**Handler**: `edit-question-set.js`  
**Purpose**: Modifies existing question set  
**Response**: Update confirmation  
**Features**: Versioning, change tracking, validation

#### Delete Question Set
```http
DELETE /api/admin/question-sets/{setId}
```
**Handler**: `delete-question-set.js`  
**Purpose**: Removes question set from system  
**Response**: Deletion confirmation  
**Safety**: Cascade deletion, usage checking

---

### System Management

#### Delete Game
```http
DELETE /api/admin/games/{gameId}
```
**Handler**: `delete-game.js`  
**Purpose**: Removes specific game instance  
**Response**: Deletion confirmation  
**Cleanup**: Players, connections, associated data

#### Clear All Games
```http
DELETE /api/admin/games
```
**Handler**: `clear-all-games.js`  
**Purpose**: Removes all game instances (danger zone)  
**Response**: Cleanup summary  
**Safety**: Confirmation required, audit logging

#### Toggle Question Set
```http
PATCH /api/admin/question-sets/{setId}/toggle
```
**Handler**: `toggle-question-set.js`  
**Purpose**: Enables/disables question set  
**Response**: Status change confirmation  
**Features**: Bulk toggle operations

---

## 🔒 Authentication & Security

### WebSocket Authentication
- Connection tokens validated on connect
- Session-based authentication for participants
- Host privileges verified per action

### HTTP Authentication
- API key authentication for admin endpoints
- JWT tokens for user sessions
- CORS configuration for cross-origin requests

### Rate Limiting
- WebSocket message rate limiting
- HTTP request throttling
- Participant action cooldowns

---

## 📊 Response Formats

### Success Response
```json
{
  "success": true,
  "data": {},
  "timestamp": "ISO-8601",
  "requestId": "uuid"
}
```

### Error Response
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": {}
  },
  "timestamp": "ISO-8601",
  "requestId": "uuid"
}
```

### WebSocket Broadcast Format
```json
{
  "type": "broadcast",
  "event": "question-start|vote-start|results-show",
  "data": {},
  "timestamp": "ISO-8601",
  "gameId": "string"
}
```

---

## 🔧 Utility Functions

### Shared Utilities
- **utils.js**: Common utility functions
- **schema-compliant-manager.js**: Data validation
- **game-state-manager.js**: State management
- **vote-manager.js**: Vote processing
- **bitmask-category-manager.js**: Category management

### Connection Management
- **clean-websocket-utils.js**: WebSocket utilities
- **clean-state-manager.js**: State cleanup
- **comprehensive-state.js**: State aggregation

---

## 📈 Performance Considerations

### WebSocket Optimization
- Connection pooling and reuse
- Message batching for bulk operations
- Automatic reconnection handling
- Heartbeat monitoring

### HTTP Optimization
- Response caching where appropriate
- Compression for large responses
- Efficient database queries
- Connection pooling

### Database Optimization
- Single-table design for DynamoDB
- Efficient access patterns
- TTL for automatic cleanup
- Batch operations for bulk updates

---

## 🚀 Usage Examples

### JavaScript Client Example
```javascript
const ws = new WebSocket('wss://api.engagements.sb.seibtribe.us');

ws.onopen = () => {
  // Create game
  ws.send(JSON.stringify({
    action: 'create-game',
    data: {
      gameType: 'trivia',
      hostName: 'John Doe',
      settings: { maxPlayers: 50 }
    }
  }));
};

ws.onmessage = (event) => {
  const response = JSON.parse(event.data);
  console.log('Received:', response);
};
```

### HTTP API Example
```javascript
// Join game via HTTP
const response = await fetch('/api/game/GAME123/join', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    playerName: 'Alice',
    playerId: 'player-uuid'
  })
});

const result = await response.json();
```

---

## 🐛 Error Handling

### Common Error Codes
- `GAME_NOT_FOUND`: Game ID doesn't exist
- `PLAYER_ALREADY_EXISTS`: Duplicate player registration
- `INVALID_GAME_STATE`: Action not valid in current state
- `RATE_LIMITED`: Too many requests
- `AUTHENTICATION_FAILED`: Invalid credentials
- `VALIDATION_ERROR`: Invalid input data

### Error Recovery
- Client-side retry logic
- Automatic reconnection for WebSocket
- Graceful degradation for API failures
- User-friendly error messages

---

*Last Updated: Generated via /sc:index API documentation*