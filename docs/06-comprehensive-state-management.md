# Comprehensive State Management Design

## Overview

This document defines a complete state management system that enables seamless reconnection, real-time synchronization, and comprehensive engagement tracking for both hosts and participants.

## Core Principles

1. **Single Source of Truth**: All state stored in DynamoDB with real-time WebSocket sync
2. **Granular State Tracking**: Track individual player progress per question
3. **Seamless Reconnection**: Any user can reconnect and resume exactly where they left off
4. **Real-time Notifications**: WebSocket broadcasts for all state changes
5. **Complete Audit Trail**: Full engagement history for reporting

## Enhanced Data Model

### Game Context State
```
PK: GAME#{gameId}
SK: CONTEXT
Attributes:
  - Title: string
  - EngagementType: string (call-and-answer|trivia|poll|survey)
  - QuestionSetId: string
  - SelectedCategories: string[] (list of selected category IDs)
  - CategoryOrder: object {categoryId: [questionIds]}
  - HostPreferences: object {randomOrder: boolean, timeLimit: number}
  - CreatedAt: ISO timestamp
  - CreatedBy: string
  - AiContext: string
  - DebugMode: boolean
  - TTL: number
```

### Enhanced Game State
```
PK: GAME#{gameId}
SK: STATE
Attributes:
  - Stage: string (BEGIN|ASK|VOTE|RESULTS|END)
  - State: string (waiting|question|voting|results|ended)
  - CurrentQuestionId: string (sequential: 001, 002, etc.)
  - CurrentQuestionIndex: number
  - CurrentQuestionData: object (full question content)
  - QuestionStartedAt: ISO timestamp
  - PlayedQuestions: string[] (completed question IDs)
  - ScoredQuestions: string[] (scored question IDs)
  - UsedQuestions: string[] (all used question IDs)
  - TotalQuestions: number
  - UpdatedAt: ISO timestamp
  - TTL: number
```

### Player State Tracking
```
PK: GAME#{gameId}
SK: PLAYER#{playerName}#STATE
Attributes:
  - PlayerName: string
  - CurrentStage: string (JOINED|ANSWERING|ANSWERED|VOTING|VOTED|VIEWING_RESULTS)
  - LastQuestionAnswered: string (question ID)
  - LastQuestionVoted: string (question ID)
  - AnsweredQuestions: string[] (list of answered question IDs)
  - VotedQuestions: string[] (list of voted question IDs)
  - TotalScore: number
  - CurrentRank: number
  - LastSeenAt: ISO timestamp
  - IsActive: boolean
  - TTL: number
```

### Question Progress Tracking
```
PK: GAME#{gameId}
SK: QUESTION#{questionId}#PROGRESS
Attributes:
  - QuestionId: string
  - PlayersAnswered: string[] (list of player names)
  - PlayersVoted: string[] (list of player names)
  - AnswerCount: number
  - VoteCount: number
  - StartedAt: ISO timestamp
  - AnsweringCompletedAt: ISO timestamp
  - VotingCompletedAt: ISO timestamp
  - TTL: number
```

## State Management APIs

### Enhanced State Retrieval

#### Get Complete Game State
```http
GET /games/{gameId}/state/complete
Response: {
  "gameContext": {
    "title": "Team Retrospective",
    "engagementType": "call-and-answer",
    "questionSetId": "greatest-hits",
    "selectedCategories": ["leadership", "innovation"],
    "hostPreferences": {"randomOrder": true}
  },
  "gameState": {
    "stage": "ASK",
    "currentQuestionId": "001",
    "currentQuestionData": {...},
    "playedQuestions": [],
    "totalQuestions": 15
  },
  "playerStates": {
    "John Doe": {
      "currentStage": "ANSWERING",
      "answeredQuestions": [],
      "totalScore": 0
    }
  },
  "questionProgress": {
    "001": {
      "playersAnswered": [],
      "answerCount": 0,
      "voteCount": 0
    }
  }
}
```

#### Get Player State
```http
GET /games/{gameId}/players/{playerName}/state
Response: {
  "playerName": "John Doe",
  "currentStage": "ANSWERING",
  "gameStage": "ASK",
  "currentQuestionId": "001",
  "hasAnswered": false,
  "hasVoted": false,
  "totalScore": 15,
  "rank": 2,
  "answeredQuestions": ["001", "002"],
  "votedQuestions": ["001"],
  "canAnswer": true,
  "canVote": false,
  "shouldShowResults": false
}
```

### State Update Operations

#### Update Player State
```http
POST /games/{gameId}/players/{playerName}/state
{
  "action": "ANSWERED",
  "questionId": "001",
  "timestamp": "2024-01-15T10:37:00Z"
}
```

#### Batch State Update
```http
POST /games/{gameId}/state/batch
{
  "gameState": {
    "stage": "VOTE",
    "currentQuestionId": "001"
  },
  "playerUpdates": [
    {
      "playerName": "John Doe",
      "currentStage": "VOTING"
    }
  ],
  "questionProgress": {
    "001": {
      "answerCount": 5,
      "playersAnswered": ["John", "Jane", "Bob", "Alice", "Carol"]
    }
  }
}
```

## WebSocket State Notifications

### Enhanced Message Types

#### Complete State Sync
```javascript
{
  "type": "completeStateSync",
  "gameId": "1234",
  "timestamp": "2024-01-15T10:35:00Z",
  "data": {
    "gameState": {...},
    "playerState": {...}, // Only for the receiving player
    "questionProgress": {...}
  }
}
```

#### Player State Changed
```javascript
{
  "type": "playerStateChanged",
  "gameId": "1234",
  "timestamp": "2024-01-15T10:37:00Z",
  "data": {
    "playerName": "John Doe",
    "previousStage": "ANSWERING",
    "currentStage": "ANSWERED",
    "questionId": "001"
  }
}
```

#### Question Progress Update
```javascript
{
  "type": "questionProgressUpdate",
  "gameId": "1234",
  "timestamp": "2024-01-15T10:37:00Z",
  "data": {
    "questionId": "001",
    "answerCount": 3,
    "voteCount": 0,
    "playersAnswered": ["John", "Jane", "Bob"],
    "totalPlayers": 5
  }
}
```

## Reconnection Strategy

### Client Reconnection Flow
1. **Connect to WebSocket** with gameId and playerName
2. **Request State Sync** via `requestStateSync` message
3. **Receive Complete State** via `completeStateSync` message
4. **Restore UI State** based on received data
5. **Resume Normal Operation** with real-time updates

### State Restoration Logic
```javascript
// Client-side state restoration
function restoreState(stateData) {
  const { gameState, playerState, questionProgress } = stateData;
  
  // Restore game context
  setGameStage(gameState.stage);
  setCurrentQuestion(gameState.currentQuestionData);
  
  // Restore player state
  setPlayerStage(playerState.currentStage);
  setHasAnswered(playerState.hasAnswered);
  setHasVoted(playerState.hasVoted);
  
  // Determine UI state
  if (playerState.currentStage === 'ANSWERING') {
    showAnswerForm();
  } else if (playerState.currentStage === 'VOTING') {
    showVotingForm();
  } else if (playerState.currentStage === 'VIEWING_RESULTS') {
    showResults();
  }
  
  // Restore progress indicators
  updateProgressIndicators(questionProgress);
}
```

## Implementation Priority

### Phase 1: Enhanced State Storage
1. ✅ Update data model with new state entities
2. ✅ Create enhanced state management functions
3. ✅ Implement complete state retrieval APIs

### Phase 2: Real-time State Sync
1. ✅ Enhanced WebSocket message types
2. ✅ State change broadcasting
3. ✅ Client-side state restoration

### Phase 3: Comprehensive Testing
1. ✅ Reconnection scenarios
2. ✅ Multi-player state synchronization
3. ✅ Edge case handling

This comprehensive state management system ensures that any participant or host can reconnect at any time and immediately understand exactly where they are in the engagement process.
