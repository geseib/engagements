# Game Flow Architecture Documentation

## Overview
This document describes the detailed game flow architecture for the Engage2 application, focusing on the interaction between hosts and players through API calls, WebSocket messages, and data structures.

## Core Principles
- **Host-driven flow**: The host controls the game progression
- **Real-time updates**: WebSocket broadcasts keep all players synchronized
- **Stateless API design**: Each API call contains all necessary context
- **Clean separation**: Host and player screens have distinct responsibilities

## Data Structure Overview

### Primary Keys Structure
```
GAME#{gameId}                          - Game metadata
GAME#{gameId}#PLAYER#{playerId}        - Player info and total score
GAME#{gameId}#QUESTION#{questionNum}#LOOKUP    - Maps game question number to actual question
GAME#{gameId}#QUESTION#{questionNum}#ANSWER#{playerId}  - Player's answer
GAME#{gameId}#QUESTION#{questionNum}#VOTE#{playerId}    - Player's votes
GAME#{gameId}#QUESTION#{questionNum}#RESULT#{playerId}  - Round results and points
SET#{setId}#{categoryId}#{questionId}  - Question bank
```

## Game Flow Sequence

### 1. HOST: Next Question
**Action**: Host clicks "Next Question" button

**API Calls**:
```
POST /api/getQuestion
{
  "gameId": "game123",
  "role": "host",
  "questionNumber": 1
}
```

**Lambda Logic**:
1. Check game settings (question sets, categories, random mode)
2. Select appropriate question from SET#{setId}
3. Create GAME#{gameId}#QUESTION#{questionNum}#LOOKUP mapping
4. Retrieve full question details
5. Return question data to host

**Response**:
```json
{
  "questionNumber": 1,
  "title": "Question Title",
  "category": "Category Name",
  "questionText": "What is...",
  "specialInstructions": "Optional instructions",
  "metadata": {}
}
```

### 2. HOST: Display Question & Broadcast
**Screen Update**: Host screen displays question details

**API Calls**:
```
1. HTTP API - State Change:
POST /api/updateGameState
{
  "gameId": "game123",
  "state": "ASK#1"
}

2. WebSocket Broadcast:
{
  "action": "STATE",
  "state": "ASK#1",
  "questionNumber": 1
}
```

### 3. PLAYER: Receive Question
**Trigger**: WebSocket message received

**API Call**:
```
POST /api/getQuestion
{
  "gameId": "game123",
  "role": "player",
  "playerId": "player123",
  "questionNumber": 1
}
```

**Lambda Logic**:
1. Retrieve GAME#{gameId}#QUESTION#{questionNum}#LOOKUP
2. Fetch question details from SET#{setId}
3. Return formatted question for player display

### 4. PLAYER: Submit Answer
**Action**: Player types answer and clicks "Submit"

**API Call**:
```
POST /api/answerQuestion
{
  "gameId": "game123",
  "playerId": "player123",
  "questionNumber": 1,
  "answer": "Player's answer text"
}
```

**Lambda Logic**:
1. Store answer in GAME#{gameId}#QUESTION#{questionNum}#ANSWER#{playerId}
2. Return success confirmation

**WebSocket Message to Host**:
```json
{
  "action": "ANSWERED",
  "questionNumber": 1,
  "playerId": "player123"
}
```

### 5. HOST: Track Answers
**Trigger**: WebSocket ANSWERED message

**Screen Update**:
- Mark player card with checkmark
- Update answer tally (e.g., 2/5 answered)

### 6. HOST: Request Voting
**Action**: Host clicks "Vote" button (when all answers received)

**API Call**:
```
POST /api/getAnswers
{
  "gameId": "game123",
  "questionNumber": 1,
  "mode": "VOTE"
}
```

**Response**:
```json
{
  "answers": [
    {
      "playerId": "player123",
      "playerName": "John",
      "answer": "Answer text",
      "answerId": "unique-id"
    },
    ...
  ]
}
```

### 7. HOST: Initiate Voting Phase
**API Calls**:
```
1. HTTP API - State Change:
POST /api/updateGameState
{
  "gameId": "game123",
  "state": "VOTE#1"
}

2. WebSocket Broadcast:
{
  "action": "STATE",
  "state": "VOTE#1",
  "questionNumber": 1
}
```

### 8. PLAYER: Enter Voting Mode
**Trigger**: WebSocket VOTE message

**API Call**:
```
POST /api/getAnswers
{
  "gameId": "game123",
  "questionNumber": 1,
  "mode": "VOTE",
  "playerId": "player123"
}
```

**Screen**: Display all answers with voting interface (1st, 2nd, 3rd place selections)

### 9. PLAYER: Submit Votes
**Action**: Player selects rankings and clicks "Submit"

**API Call**:
```
POST /api/placeVote
{
  "gameId": "game123",
  "playerId": "player123",
  "questionNumber": 1,
  "votes": {
    "first": "answerId1",
    "second": "answerId2",
    "third": "answerId3"
  }
}
```

**WebSocket Message to Host**:
```json
{
  "action": "VOTED",
  "questionNumber": 1,
  "playerId": "player123"
}
```

### 10. HOST: Calculate & Display Results
**Action**: Host clicks "Results" button

**API Calls (Parallel)**:
```
1. GET /api/getQuestion/{gameId}/{questionNumber}
2. GET /api/getAnswers/{gameId}/{questionNumber}
3. POST /api/getResults
{
  "gameId": "game123",
  "questionNumber": 1
}
```

**Lambda Logic for getResults**:
1. Calculate vote tallies and placements
2. Assign points based on rankings
3. Store in GAME#{gameId}#QUESTION#{questionNum}#RESULT#{playerId}
4. Update GAME#{gameId}#PLAYER#{playerId} total scores
5. Return formatted results

### 11. HOST: Get AI Summary
**API Call**:
```
POST /api/getAISummary
{
  "gameId": "game123",
  "questionNumber": 1,
  "question": {...},
  "answers": [...],
  "results": [...]
}
```

**Response**: AI-generated commentary incorporating game context and results

### 12. HOST: Broadcast Results
**API Calls**:
```
1. HTTP API - State Change:
POST /api/updateGameState
{
  "gameId": "game123",
  "state": "RESULTS#1"
}

2. WebSocket Broadcast:
{
  "action": "STATE",
  "state": "RESULTS#1",
  "questionNumber": 1
}
```

### 13. PLAYER: View Results
**Trigger**: WebSocket RESULTS message

**API Call**:
```
GET /api/getResults/{gameId}/{questionNumber}/{playerId}
```

**Response**:
```json
{
  "points": 9,
  "placement": "1st",
  "trophies": {
    "first": 3,
    "second": 1,
    "third": 0
  },
  "correctAnswer": "For trivia games",
  "wasCorrect": false
}
```

## WebSocket Message Format

### Standard Message Structure
```json
{
  "action": "ACTION_TYPE",
  "gameId": "game123",
  "timestamp": "2024-01-14T10:30:00Z",
  "data": {
    // Action-specific data
  }
}
```

### Action Types
- `STATE`: Game state changes (ASK, VOTE, RESULTS)
- `ANSWERED`: Player submitted answer
- `VOTED`: Player submitted votes
- `PLAYER_JOINED`: New player joined
- `PLAYER_LEFT`: Player disconnected

## State Machine

```
LOBBY → ASK#1 → VOTE#1 → RESULTS#1 → ASK#2 → ... → GAME_END
```

Each state transition is:
1. Initiated by host
2. Propagated via WebSocket
3. Triggers appropriate API calls from players

## Error Handling

### API Errors
- All APIs return standardized error responses
- Client retries with exponential backoff
- WebSocket reconnection logic for disconnections

### State Consistency
- Host is source of truth for game state
- Players query current state on reconnection
- Idempotent operations where possible

## Performance Considerations

1. **Batch Operations**: Multiple API calls can be made in parallel
2. **Caching**: Question lookups cached during game session
3. **Pagination**: Results can be paginated for large player counts
4. **WebSocket Optimization**: Minimal payload sizes for real-time updates

## Security Considerations

1. **Player Authentication**: Each API call includes playerId validation
2. **Host Verification**: Host-only operations verified server-side
3. **Answer Timing**: Server timestamps prevent late submissions
4. **Vote Validation**: Ensure players can't vote for themselves

## Future Enhancements

1. **Spectator Mode**: Read-only access to game state
2. **Replay System**: Store complete game history
3. **Analytics**: Track question difficulty and player performance
4. **Custom Scoring**: Configurable point systems per game type