# Unified Database Access Patterns

## Overview

This document defines the **canonical** database schema and access patterns that ALL code must follow. Any deviation from these patterns will cause data inconsistencies.

## 🎯 **Canonical Schema (MUST USE)**

### Game State Record
```
PK: GAME#{gameId}
SK: STATE
Attributes:
  HostState: string (LOBBY|ASK/Q001|VOTE/Q001|RESULTS/Q001|END)
  CurrentQuestionId: string (Q001, Q002, etc.)
  PlayedQuestions: string[] (Q001, Q002, etc.)
  GameStarted: boolean
  UseRandomQuestions: boolean
  UseRandomCategories: boolean
  StartedAt: ISO timestamp
  UpdatedAt: ISO timestamp
  ttl: number (TTL_CREATION_PHASE or TTL_ACTIVE_PHASE)
```

### Game Context Record
```
PK: GAME#{gameId}
SK: CONTEXT
Attributes:
  Title: string
  EngagementType: string
  QuestionSetId: string
  SelectedCategories: string[]
  HostPreferences: object
  AiContext: string
  DebugMode: boolean
  CreatedAt: ISO timestamp
  UpdatedAt: ISO timestamp
  ttl: number
```

### Player State Record
```
PK: GAME#{gameId}
SK: PLAYER#{playerName}#STATE
Attributes:
  PlayerName: string
  CurrentState: string (JOINED|ANSWERED/Q001|VOTED/Q001|QUIT)
  AnsweredQuestions: string[]
  VotedQuestions: string[]
  TotalScore: number
  LastSeenAt: ISO timestamp
  ttl: number
```

### Category State Record (Bitmask)
```
PK: GAME#{gameId}
SK: STATE#CATS
Attributes:
  HostMask1_8: string (8-bit binary)
  HostMask9_16: string (8-bit binary)
  HostMask17_24: string (8-bit binary)
  AvailMask1_8: string (8-bit binary)
  AvailMask9_16: string (8-bit binary)
  AvailMask17_24: string (8-bit binary)
  SelectedCategories: string[]
  QuestionSetId: string
  CreatedAt: ISO timestamp
  UpdatedAt: ISO timestamp
  ttl: number
```

### Category Order Record
```
PK: GAME#{gameId}
SK: CAT#{categoryNumber}#ORDER
Attributes:
  CategoryNumber: number
  CategoryName: string
  IsRandom: boolean
  QuestionOrder: number[] (if IsRandom=true)
  TotalQuestions: number
  CreatedAt: ISO timestamp
  ttl: number
```

### Category Active Record
```
PK: GAME#{gameId}
SK: CAT#{categoryNumber}#ACTIVE
Attributes:
  CategoryNumber: number
  CategoryName: string
  QuestionCount: number
  ActiveIndex: number
  QuestionsUsed: number
  RemainingQuestions: number
  CompletedAt: ISO timestamp (null if not completed)
  UpdatedAt: ISO timestamp
  ttl: number
```

### WebSocket Connection Record
```
PK: GAME#{gameId}
SK: CONNECTION#{connectionId}
Attributes:
  ConnectionId: string
  GameId: string
  PlayerName: string
  IsHost: boolean
  ConnectedAt: ISO timestamp
  ttl: number (2 hours)
```

## 🔧 **Standard Access Patterns**

### Game State Operations
```javascript
// READ Game State
const getGameState = async (gameId) => {
  const result = await db.send(new GetCommand({
    TableName: process.env.TABLE_NAME,
    Key: { PK: `GAME#${gameId}`, SK: 'STATE' }
  }));
  
  return {
    hostState: result.Item?.HostState || 'LOBBY',
    currentQuestionId: result.Item?.CurrentQuestionId || null,
    playedQuestions: result.Item?.PlayedQuestions || [],
    gameStarted: result.Item?.GameStarted || false,
    useRandomQuestions: result.Item?.UseRandomQuestions || true,
    useRandomCategories: result.Item?.UseRandomCategories || true,
    startedAt: result.Item?.StartedAt,
    updatedAt: result.Item?.UpdatedAt
  };
};

// WRITE Game State
const updateGameState = async (gameId, updates) => {
  const ttl = Math.floor(Date.now() / 1000) + TTL_ACTIVE_PHASE;
  
  await db.send(new PutCommand({
    TableName: process.env.TABLE_NAME,
    Item: {
      PK: `GAME#${gameId}`,
      SK: 'STATE',
      ...updates,
      UpdatedAt: new Date().toISOString(),
      ttl
    }
  }));
};
```

### Game Context Operations
```javascript
// READ Game Context
const getGameContext = async (gameId) => {
  const result = await db.send(new GetCommand({
    TableName: process.env.TABLE_NAME,
    Key: { PK: `GAME#${gameId}`, SK: 'CONTEXT' }
  }));
  
  return {
    title: result.Item?.Title,
    engagementType: result.Item?.EngagementType,
    questionSetId: result.Item?.QuestionSetId,
    selectedCategories: result.Item?.SelectedCategories || [],
    hostPreferences: result.Item?.HostPreferences || {},
    aiContext: result.Item?.AiContext,
    debugMode: result.Item?.DebugMode || false,
    createdAt: result.Item?.CreatedAt,
    updatedAt: result.Item?.UpdatedAt
  };
};

// WRITE Game Context
const updateGameContext = async (gameId, updates) => {
  const isGameStarted = false; // Check actual game state
  const ttl = Math.floor(Date.now() / 1000) + (isGameStarted ? TTL_ACTIVE_PHASE : TTL_CREATION_PHASE);
  
  await db.send(new PutCommand({
    TableName: process.env.TABLE_NAME,
    Item: {
      PK: `GAME#${gameId}`,
      SK: 'CONTEXT',
      ...updates,
      UpdatedAt: new Date().toISOString(),
      ttl
    }
  }));
};
```

### Player State Operations
```javascript
// READ Player State
const getPlayerState = async (gameId, playerName) => {
  const result = await db.send(new GetCommand({
    TableName: process.env.TABLE_NAME,
    Key: { PK: `GAME#${gameId}`, SK: `PLAYER#${playerName}#STATE` }
  }));
  
  return {
    playerName: result.Item?.PlayerName,
    currentState: result.Item?.CurrentState || 'JOINED',
    answeredQuestions: result.Item?.AnsweredQuestions || [],
    votedQuestions: result.Item?.VotedQuestions || [],
    totalScore: result.Item?.TotalScore || 0,
    lastSeenAt: result.Item?.LastSeenAt
  };
};

// WRITE Player State
const updatePlayerState = async (gameId, playerName, updates) => {
  const ttl = Math.floor(Date.now() / 1000) + TTL_ACTIVE_PHASE;
  
  await db.send(new PutCommand({
    TableName: process.env.TABLE_NAME,
    Item: {
      PK: `GAME#${gameId}`,
      SK: `PLAYER#${playerName}#STATE`,
      PlayerName: playerName,
      ...updates,
      LastSeenAt: new Date().toISOString(),
      ttl
    }
  }));
};
```

### WebSocket Connection Operations
```javascript
// READ Game Connections (NO SCAN!)
const getGameConnections = async (gameId) => {
  const result = await db.send(new QueryCommand({
    TableName: process.env.TABLE_NAME,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
    ExpressionAttributeValues: {
      ':pk': `GAME#${gameId}`,
      ':sk': 'CONNECTION#'
    }
  }));
  
  return result.Items || [];
};

// WRITE Connection
const addConnection = async (gameId, connectionId, playerName, isHost) => {
  const ttl = Math.floor(Date.now() / 1000) + (2 * 60 * 60); // 2 hours
  
  await db.send(new PutCommand({
    TableName: process.env.TABLE_NAME,
    Item: {
      PK: `GAME#${gameId || 'LOBBY'}`,
      SK: `CONNECTION#${connectionId}`,
      ConnectionId: connectionId,
      GameId: gameId,
      PlayerName: playerName,
      IsHost: isHost,
      ConnectedAt: new Date().toISOString(),
      ttl
    }
  }));
};
```

## ❌ **DEPRECATED PATTERNS (DO NOT USE)**

### Old Field Names (NEVER USE)
- `Stage` → Use `HostState`
- `State` → Use `HostState` 
- `CurrentQuestion` → Use `CurrentQuestionId`
- `UsedQuestions` → Use `PlayedQuestions`
- `METADATA` SK → Use `CONTEXT` SK

### Old Connection Pattern (NEVER USE)
```javascript
// BAD - Uses scan
PK: CONNECTION#{connectionId}, SK: METADATA, GameId: {gameId}

// GOOD - Uses query
PK: GAME#{gameId}, SK: CONNECTION#{connectionId}
```

### Old TTL Pattern (NEVER USE)
```javascript
// BAD - Hardcoded TTL
const ttl = Math.floor(Date.now() / 1000) + (14 * 24 * 60 * 60);

// GOOD - Proper TTL constants
const ttl = Math.floor(Date.now() / 1000) + (isGameStarted ? TTL_ACTIVE_PHASE : TTL_CREATION_PHASE);
```

## 🎯 **Migration Checklist**

### Files That Need Updates:
1. ✅ **clean-state-manager.js** - Uses correct schema
2. ❌ **get-complete-state.js** - Uses old field names
3. ❌ **comprehensive-state.js** - Uses old patterns
4. ❌ **set-game-state.js** - Uses old field names
5. ✅ **save-game-context.js** - Uses correct schema
6. ✅ **start-game.js** - Uses correct schema
7. ✅ **start-question.js** - Uses correct schema

### Required Changes:
1. Update all read operations to use new field names
2. Update all write operations to use new field names
3. Replace hardcoded TTLs with constants
4. Ensure all functions use efficient query patterns
5. Remove any remaining scan operations

This unified schema ensures data consistency and optimal performance across the entire application.
