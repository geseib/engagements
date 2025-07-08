# Clean State Management System

## Overview

This document defines the cleaned-up state management system with consistent states, proper WebSocket broadcasting, and comprehensive database tracking.

## Host States

### State Definitions
- `CREATING` - Host is setting up game (no gameId yet)
- `LOBBY` - Game created, waiting for players to join
- `ASK/Q001` - Host is asking question 001 (participants can answer)
- `VOTE/Q001` - Host opened voting for question 001 (participants can vote)
- `RESULTS/Q001` - Host showing results for question 001
- `END` - Game completed

### State Transitions & WebSocket Broadcasts
```
CREATING → LOBBY
  WebSocket: { type: 'gameCreated', gameId, state: 'LOBBY' }

LOBBY → ASK/Q001
  WebSocket: { type: 'questionStarted', gameId, questionId: 'Q001', state: 'ASK/Q001' }

ASK/Q001 → VOTE/Q001
  WebSocket: { type: 'votingStarted', gameId, questionId: 'Q001', state: 'VOTE/Q001' }

VOTE/Q001 → RESULTS/Q001
  WebSocket: { type: 'resultsReady', gameId, questionId: 'Q001', state: 'RESULTS/Q001' }

RESULTS/Q001 → ASK/Q002 (next question)
  WebSocket: { type: 'questionStarted', gameId, questionId: 'Q002', state: 'ASK/Q002' }

RESULTS/Q001 → END (no more questions)
  WebSocket: { type: 'gameEnded', gameId, state: 'END' }
```

## Participant States

### State Definitions
- `JOINED` - Joined game, waiting for questions
- `ANSWERED/Q001` - Answered question 001, waiting for voting
- `VOTED/Q001` - Voted on question 001, waiting for results
- `QUIT` - Left the game

### State Transitions & WebSocket Broadcasts
```
JOINED → ANSWERED/Q001
  WebSocket: { type: 'playerAnswered', gameId, playerName, questionId: 'Q001', state: 'ANSWERED/Q001' }

ANSWERED/Q001 → VOTED/Q001
  WebSocket: { type: 'playerVoted', gameId, playerName, questionId: 'Q001', state: 'VOTED/Q001' }

Any State → QUIT
  WebSocket: { type: 'playerQuit', gameId, playerName, state: 'QUIT' }
```

## Database Schema

### Game State Record
```
PK: GAME#{gameId}
SK: STATE
Attributes:
  - HostState: string (LOBBY|ASK/Q001|VOTE/Q001|RESULTS/Q001|END)
  - CurrentQuestionId: string (Q001, Q002, etc.)
  - QuestionCount: number
  - PlayedQuestions: string[] (Q001, Q002, etc.)
  - UpdatedAt: ISO timestamp
  - TTL: number
```

### Game Context Record (Persistent Settings)
```
PK: GAME#{gameId}
SK: CONTEXT
Attributes:
  - Title: string
  - QuestionSetId: string
  - SelectedCategories: string[]
  - HostPreferences: object {
      randomOrder: boolean,
      customInstructions: string,
      aiEnabled: boolean,
      aiAdditionalInfo: string
    }
  - CreatedAt: ISO timestamp
  - TTL: number
```

### Player State Record
```
PK: GAME#{gameId}
SK: PLAYER#{playerName}#STATE
Attributes:
  - PlayerName: string
  - CurrentState: string (JOINED|ANSWERED/Q001|VOTED/Q001|QUIT)
  - AnsweredQuestions: string[] (Q001, Q002, etc.)
  - VotedQuestions: string[] (Q001, Q002, etc.)
  - TotalScore: number
  - LastSeenAt: ISO timestamp
  - TTL: number
```

## WebSocket Message Types

### Host → Participants
- `gameCreated` - Game is ready, participants can join
- `questionStarted` - New question available for answering
- `votingStarted` - Voting opened for current question
- `resultsReady` - Results available for viewing
- `gameEnded` - Game completed

### Participants → Host
- `playerJoined` - Player joined the game
- `playerAnswered` - Player submitted answer
- `playerVoted` - Player submitted vote
- `playerQuit` - Player left the game

### Bidirectional
- `stateSync` - Complete state synchronization for reconnection

## Implementation Requirements

### 1. State Management Functions
- `updateHostState(gameId, newState, questionId?)` - Update host state with WebSocket broadcast
- `updatePlayerState(gameId, playerName, newState, questionId?)` - Update player state with WebSocket broadcast
- `getCompleteGameState(gameId)` - Get all state for reconnection
- `getPlayerState(gameId, playerName)` - Get specific player state

### 2. WebSocket Broadcasting
- All state changes must broadcast to relevant parties
- Host receives all participant state changes
- Participants receive all host state changes
- Include timestamp and questionId in all messages

### 3. Reconnection Support
- Any user can reconnect and get complete current state
- State determines what UI to show (answer form, voting form, results, etc.)
- No state is lost on page refresh

### 4. State Validation
- Participants can only answer during ASK phase
- Participants can only vote during VOTE phase
- Host controls all state transitions
- Invalid state transitions are rejected

This clean state management system ensures consistent behavior, proper WebSocket notifications, and seamless reconnection for all users.
