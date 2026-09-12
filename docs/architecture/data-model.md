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

> **None of the entities in this section carry `ttl`, and none of them ever may.**
> See "TTL Strategy" below — this is content, not session data.

#### Question Set Metadata
```
PK: SETS
SK: SET#{setId}
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

#### Versioned set partitions

A set replaced through the editor is written to a **new** partition and the
metadata row is flipped atomically, so a live game never sees a half-written set:

```
PK: SET#{setId}#v{n}      SK: QUESTION#… / CATEGORY#…
```

The `SETS / SET#{setId}` row then carries `activeVersion` and `versions[]`. The
resolver falls back to the unversioned `SET#{setId}` partition when a set has
never been migrated, which is why `scripts/migrate-set-versions.js` **copies**
rather than moves — legacy rows stay put and rollback needs no restore.

### AI Prompts and Personas

**One partition, `PK: AIPROMPTS`, holding three different things.** None of them
carries `ttl` (see TTL Strategy).

#### Prompt pointer — DynamoDB
```
PK: AIPROMPTS
SK: AIPROMPT#{promptId}
Attributes:
  - name, description, gameType, category
  - promptType: "analysis" | "generation"
  - isDefault: boolean          (at most one per gameType)
  - s3Key: string               → the BODY lives in S3, not here
  - status, questionSetIds[], tags[], createdAt, updatedAt
```

#### Prompt body — S3, not DynamoDB
```
s3://{StackName}-ai-prompts/prompts/{gameType}/{promptId}/v{n}.json
```

The body is the prompt: `instructions`, `outputFormat` (or a legacy single
`template`), plus a copy of the metadata. An update writes a **new** key and
repoints `s3Key`; old versions are left behind.

**The split is the failure mode, and it has bitten twice.** The pointer and the
body can drift apart, and nothing reconciles them:

- `get-ai-summary.js` reads the pointer for `s3Key`, then `GetObject`s the body,
  then falls back to the pointer record itself.
- A pointer whose S3 object is **missing** and which carries no inline
  `template`/`instructions` fails `isUsableSummaryPrompt` (`prompt-shape.js`),
  so `resolvePromptTemplate` returns `null` and the summary lambda takes
  `buildFallback()` — **no Bedrock call at all**. The room gets canned text and
  there is no error anywhere.
- Found live on `engagedev`, 2026-08-10: the default trivia prompt
  `AIPROMPT#mdnrm2awjobwax0vcdl` pointed at
  `prompts/trivia/mdnrm2awjobwax0vcdl/v1.json`, which returned 404. The bucket
  held bodies for call-and-answer and wavelength only, so **trivia and poll AI
  commentary were silently dead.**

**When auditing, check both halves.** A prompt that "exists" in DynamoDB proves
nothing about whether it can run.

#### Persona
```
PK: AIPROMPTS
SK: PERSONA#{personaId}
Attributes:
  - personaId, name, tagline, icon
  - voice: string               ← the persona IS this string
  - gameTypes: ["all"] | ["trivia", …]
  - status: "active" | "inactive"
  - isDefault: boolean, sortOrder: number
```

**A persona is not a prompt.** It has no S3 body and cannot change output
structure — it supplies only the `VOICE:` block prepended to the prompt, while
the system appends the output contract last. Resolution is host pick → set
persona → set/game free-text AI context → inferred → legacy template, and a
dangling or inactive id falls through rather than dead-ending. Seeded from
`SEED_PERSONAS` in `lambda-functions/game/personas.js` via
`scripts/seed-personas.js`.

#### Default lookup
```
PK: AIPROMPTS
SK: GAMETYPE#{gameType}#CATEGORY#{category}
```
Written when a prompt is marked `isDefault`, so the game-time lookup is a get
rather than a scan.

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

**The rule, stated once so it cannot be assumed:**

> **`ttl` is for SESSION data only. Content and configuration must never carry it.**

DynamoDB TTL is enabled on the table for the attribute `ttl`, and it applies to the
*whole table* — it does not know or care which partition a row is in. So the
attribute itself is the only thing standing between a record and deletion.

| Carries `ttl` | Does **not**, ever |
|---|---|
| `GAME#{gameId}` — every SK | `SETS` / `SET#{setId}` / `SET#{setId}#v{n}` — sets, categories, questions |
| `PLAYER#{name}` and its `#SCORE` / `#STATE` rows | `AIPROMPTS` — prompts, personas, default-lookup rows |
| `CONNECTION#{connectionId}` | |

- **Game Data**: 2 weeks after creation
- **WebSocket Connections**: 2 hours after connection
- **Temporary Data**: 1 hour (partial votes, etc.)

**This has been violated in production, and it is why the rule is now written
here.** Every AI-prompt writer used to stamp records with `now + 365d`. Because
TTL is table-wide, DynamoDB was silently deleting prompts and personas a year
after they were authored — no error, no log, just a game that one day stopped
having a voice. `scripts/cull-ai-prompts.js --only=ttl` strips the attribute and
is labelled "THE URGENT ONE" for this reason. Verified clear on `engagedev` and
`engagetest` on 2026-08-10 (0 records in the `AIPROMPTS` partition carry `ttl`).

**When adding any writer, ask which of the two columns above the record belongs
in.** A content row that acquires a `ttl` looks perfectly healthy until the day
it disappears.

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
