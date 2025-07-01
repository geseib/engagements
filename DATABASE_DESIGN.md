# Quiz Game Database Design

## Table Structure: `quiz-game-v2-table`

This document defines the complete DynamoDB table structure for the quiz game. All API calls must follow this exact schema.

### Game Management Records

| PK          | SK                    | Item Type        | Attributes                                                     |
| ----------- | --------------------- | ---------------- | -------------------------------------------------------------- |
| `GAME#1234` | `METADATA`            | Game Info        | Title, CreatedAt, HostName, QuestionSetId, LastPlayedAt, ttl  |
| `GAME#1234` | `STATE`               | Game State       | State: `Q1#ASK`, GameState: `question`, LessonNumber: `1`, CurrentQuestionId, UsedQuestions, PlayedQuestions, UpdatedAt, ttl |
| `GAME#1234` | `PLAYER#John`         | Player Record    | PlayerName: `John`, JoinedAt, TotalScore: `0`, ttl            |

### Question Management

| PK          | SK                    | Item Type        | Attributes                                                     |
| ----------- | --------------------- | ---------------- | -------------------------------------------------------------- |
| `GAME#1234` | `QUESTION#001`        | Question Ref     | SourceQuestionId: `QUESTION#c001#001`, SetId: `GreatestHits`, Category: `Entertainment`, QuestionTitle, QuestionDetail, StartedAt, ttl |

### Answer Management

| PK          | SK                         | Item Type        | Attributes                                                |
| ----------- | -------------------------- | ---------------- | --------------------------------------------------------- |
| `GAME#1234` | `ANSWER#001#PLAYER#John`   | Answer Record    | PlayerName: `John`, QuestionNumber: `001`, SourceQuestionId: `QUESTION#c001#001`, Answer: `Prince`, SubmittedAt, ttl |
| `GAME#1234` | `ANSWER#001#PLAYER#Mary`   | Answer Record    | PlayerName: `Mary`, QuestionNumber: `001`, SourceQuestionId: `QUESTION#c001#001`, Answer: `Beatles`, SubmittedAt, ttl |

### Voting Management

| PK          | SK                       | Item Type      | Attributes                                                    |
| ----------- | ------------------------ | -------------- | ------------------------------------------------------------- |
| `GAME#1234` | `VOTE#001#PLAYER#John`   | Vote Record    | VoterName: `John`, QuestionNumber: `001`, Votes: `{"0": 1, "1": 2, "2": 3}`, SubmittedAt, ttl |
| `GAME#1234` | `VOTE#001#PLAYER#Mary`   | Vote Record    | VoterName: `Mary`, QuestionNumber: `001`, Votes: `{"0": 3, "1": 1, "2": 2}`, SubmittedAt, ttl |

### Question Set Management (Separate from Game Data)

| PK          | SK                    | Item Type        | Attributes                                                     |
| ----------- | --------------------- | ---------------- | -------------------------------------------------------------- |
| `SETS`      | `SET#GreatestHits`    | Question Set     | Name: `Greatest Hits`, Description, TotalQuestions: `10`, CategoryCount: `5`, CustomInstruction, CreatedDate, Active: `true` |
| `SET#GreatestHits` | `CATEGORY#c001`   | Category Info    | Name: `Entertainment`, Description: `5 questions in Entertainment` |
| `SET#GreatestHits` | `QUESTION#c001#001` | Source Question | Prompt: `Greatest Musical Artist`, Detail: `Music has the power...`, Category: `Entertainment`, School: `School of Cultural Arts`, OrderInCategory: `1` |

### Game History Management

| PK          | SK                    | Item Type        | Attributes                                                     |
| ----------- | --------------------- | ---------------- | -------------------------------------------------------------- |
| `GAMES`     | `GAME#1234`           | Game Index       | GameId: `1234`, Title: `Team Session`, LastPlayedAt, CreatedAt |

## API Query Patterns

### Answer Queries
- **Get answers for question 1**: `PK = GAME#1234 AND begins_with(SK, "ANSWER#001#PLAYER#")`
- **Get all answers for game**: `PK = GAME#1234 AND begins_with(SK, "ANSWER#")`
- **Check if player answered Q1**: `PK = GAME#1234 AND SK = "ANSWER#001#PLAYER#John"`

### Vote Queries  
- **Get votes for question 1**: `PK = GAME#1234 AND begins_with(SK, "VOTE#001#PLAYER#")`
- **Get all votes for game**: `PK = GAME#1234 AND begins_with(SK, "VOTE#")`
- **Check if player voted on Q1**: `PK = GAME#1234 AND SK = "VOTE#001#PLAYER#John"`

### Game State Queries
- **Get game state**: `PK = GAME#1234 AND SK = "STATE"`
- **Get game metadata**: `PK = GAME#1234 AND SK = "METADATA"`
- **Get all players**: `PK = GAME#1234 AND begins_with(SK, "PLAYER#")`

### Question Reference Queries
- **Get question 1 reference**: `PK = GAME#1234 AND SK = "QUESTION#001"`
- **Get source question details**: `PK = SET#GreatestHits AND SK = "QUESTION#c001#001"`

## State Management

### Game States (Structured Format)
- `INIT` → Initial game setup
- `Q1#ASK` → Question 1 being asked
- `Q1#VOTE` → Question 1 voting phase  
- `Q1#RESULTS` → Question 1 results display
- `Q2#ASK` → Question 2 being asked
- `OVER` → Game finished

### Question Numbers
- Always 3-digit padded: `001`, `002`, `003`, etc.
- Sequential within each game
- Used as reference in ANSWER and VOTE records

## Data Flow

1. **Question Start**: Store `QUESTION#001` with reference to source question
2. **Answer Submission**: Store `ANSWER#001#PLAYER#name` with answer text
3. **Vote Submission**: Store `VOTE#001#PLAYER#name` with vote rankings
4. **Results Calculation**: Query votes by question number, calculate scores
5. **Score Update**: Update player `TotalScore` in `PLAYER#name` record

## Key Design Principles

1. **Sequential Question Numbers** - Clean 001, 002, 003 progression
2. **Source References** - Game questions reference original question set data
3. **Efficient Queries** - Direct queries by question number, no scans
4. **Separation of Concerns** - Game data separate from question catalog
5. **Player-Centric Records** - Each player has individual answer/vote records
6. **State Persistence** - Game state stored for page refresh handling