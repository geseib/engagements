# Data Model Design

## Single Table Design

All data is stored in a single DynamoDB table following single-table design principles for optimal performance and cost efficiency.

## Table Structure

**Table Name**: `engagements-{environment}-table`

### Primary Key Design
- **PK (Partition Key)**: Entity identifier
- **SK (Sort Key)**: Entity type and sub-identifier
- **TTL**: Automatic expiration timestamp

## Entity Patterns

### Game Entities

#### Game Metadata
```
PK: GAME#{gameId}
SK: METADATA
Attributes:
  - GameId: string (4-digit ID)
  - Title: string (event title)
  - EngagementType: string (call-and-answer|trivia|poll|survey)
  - CreatedAt: ISO timestamp
  - CreatedBy: string (host identifier)
  - QuestionSetId: string (selected question set)
  - AiContext: string (optional AI context)
  - DebugMode: boolean
  - LastActivityAt: ISO timestamp
  - TTL: number (2 weeks from creation)
```

#### Game State
```
PK: GAME#{gameId}
SK: STATE
Attributes:
  - CurrentState: string (waiting|question|voting|results|ended)
  - CurrentQuestionId: string (sequential: 001, 002, etc.)
  - CurrentQuestionIndex: number
  - QuestionStartedAt: ISO timestamp
  - PlayedQuestions: string[] (list of played question IDs)
  - ScoredQuestions: string[] (list of scored question IDs)
  - UpdatedAt: ISO timestamp
  - TTL: number (2 weeks from creation)
```

#### Player Records
```
PK: GAME#{gameId}
SK: PLAYER#{playerName}
Attributes:
  - PlayerName: string
  - JoinedAt: ISO timestamp
  - LastSeenAt: ISO timestamp
  - TotalScore: number (default: 0)
  - CurrentRank: number
  - IsActive: boolean
  - TTL: number (2 weeks from creation)
```

### Question Management

#### Question References (Game-Specific)
```
PK: GAME#{gameId}
SK: QUESTION#{sequentialId}
Attributes:
  - QuestionId: string (sequential: 001, 002, etc.)
  - SourceQuestionRef: string (reference to SET question)
  - SetId: string (question set identifier)
  - Category: string
  - StartedAt: ISO timestamp
  - CompletedAt: ISO timestamp (when voting ends)
  - TTL: number (2 weeks from creation)
```

#### Answer Records
```
PK: GAME#{gameId}
SK: ANSWER#{questionId}#{playerName}
Attributes:
  - QuestionId: string
  - PlayerName: string
  - Answer: string (player's response)
  - SubmittedAt: ISO timestamp
  - WordCount: number
  - TTL: number (2 weeks from creation)
```

#### Vote Records
```
PK: GAME#{gameId}
SK: VOTE#{questionId}#{voterName}
Attributes:
  - QuestionId: string
  - VoterName: string
  - Votes: object {answerIndex: rank} (e.g., {"0": 1, "1": 3, "2": 2})
  - SubmittedAt: ISO timestamp
  - TTL: number (2 weeks from creation)
```

### Question Set Catalog

#### Question Set Metadata
```
PK: SET#{setId}
SK: METADATA
Attributes:
  - SetId: string (unique identifier)
  - Name: string (display name)
  - Description: string
  - TotalQuestions: number
  - Categories: string[] (list of categories)
  - CreatedAt: ISO timestamp
  - CreatedBy: string
  - IsActive: boolean
  - CustomInstructions: string (optional)
  - SourceFile: string (S3 key if uploaded)
```

#### Category Information
```
PK: SET#{setId}
SK: CATEGORY#{categoryId}
Attributes:
  - CategoryId: string
  - Name: string (display name)
  - Description: string
  - QuestionCount: number
  - OrderIndex: number
```

#### Question Content
```
PK: SET#{setId}
SK: QUESTION#{categoryId}#{questionNumber}
Attributes:
  - QuestionId: string (composite identifier)
  - Title: string (main question/prompt)
  - Detail: string (extended description/lesson)
  - Category: string
  - CategoryId: string
  - School: string (optional context)
  - OrderInCategory: number
  - CustomInstruction: string (optional)
  - CreatedAt: ISO timestamp
```

### WebSocket Connections

#### Connection Tracking
```
PK: CONNECTION#{connectionId}
SK: METADATA
Attributes:
  - ConnectionId: string (WebSocket connection ID)
  - GameId: string (associated game)
  - PlayerName: string (if player connection)
  - IsHost: boolean
  - ConnectedAt: ISO timestamp
  - LastPingAt: ISO timestamp
  - TTL: number (2 hours from connection)
```

### Game History & Analytics

#### Game Index (for history/reports)
```
PK: GAMES
SK: GAME#{gameId}
Attributes:
  - GameId: string
  - Title: string
  - EngagementType: string
  - CreatedAt: ISO timestamp
  - CompletedAt: ISO timestamp
  - PlayerCount: number
  - QuestionCount: number
  - Duration: number (minutes)
```

## Access Patterns

### High-Frequency Queries (Optimized)

1. **Get Game State**: `PK = GAME#{gameId} AND SK = STATE`
2. **Get Game Metadata**: `PK = GAME#{gameId} AND SK = METADATA`
3. **Get All Players**: `PK = GAME#{gameId} AND begins_with(SK, "PLAYER#")`
4. **Get Question Answers**: `PK = GAME#{gameId} AND begins_with(SK, "ANSWER#{questionId}#")`
5. **Get Question Votes**: `PK = GAME#{gameId} AND begins_with(SK, "VOTE#{questionId}#")`
6. **Get Question Sets**: `PK = SETS AND begins_with(SK, "SET#")`
7. **Get Set Questions**: `PK = SET#{setId} AND begins_with(SK, "QUESTION#")`

### Batch Operations

1. **Player Leaderboard**: Query all players, sort by TotalScore in application
2. **Question Results**: Query all answers + votes for question, calculate in application
3. **Game Summary**: Query all game entities, aggregate in application

## Data Lifecycle

### TTL Strategy
- **Game Data**: 2 weeks after creation
- **WebSocket Connections**: 2 hours after connection
- **Temporary Data**: 1 hour (partial votes, etc.)

### Cleanup Process
- DynamoDB TTL handles automatic cleanup
- No manual cleanup required
- Configurable TTL values via environment variables

## Consistency Model

### Strong Consistency
- Game state updates (critical for real-time sync)
- Player join/leave operations
- Question state transitions

### Eventual Consistency
- Leaderboard updates (acceptable delay)
- Analytics data
- Historical reports

## Performance Characteristics

### Read Patterns
- Single-item reads: ~1ms latency
- Query operations: ~5ms latency
- Batch operations: ~10ms latency

### Write Patterns
- Single writes: ~2ms latency
- Batch writes: ~5ms latency
- Conditional writes: ~3ms latency

### Scaling Limits
- 40,000 read/write capacity units per table
- 400KB item size limit
- 1MB query result limit

This data model provides efficient access patterns while maintaining flexibility for future enhancements.
