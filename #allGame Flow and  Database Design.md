# Quiz Game Database Design

## Table Structure: `quiz-game-v2-table`

This document defines the complete DynamoDB table structure for the quiz game. All API calls must follow this exact schema.


#Host Management 
| PK          | SK                    | Item Type        | Attributes                                                     |
| ----------- | --------------------- | ---------------- | -------------------------------------------------------------- |
| `HOSTS`     | `HOST#1234`           | Host List        | ID, CreatedAt, HostName, QuestionSetId, LastPlayedAt, ttl  |

#Host Management 
| PK          | SK                    | Item Type        | Attributes                                                     |
| ----------- | --------------------- | ---------------- | -------------------------------------------------------------- |
| `HOST#1234' | `GAME#1234`           | Host Game List   | Title, CreatedAt, HostName, QuestionSetId, LastPlayedAt, ttl |

### Game Management Records

| PK          | SK                    | Item Type        | Attributes                                                     |
| ----------- | --------------------- | ---------------- | -------------------------------------------------------------- |
| `GAMES`     | `GAME#1234`           | Game List        | Title, CreatedAt, HostName, GameType, QuestionSetId, LastPlayedAt, ttl  |
| `GAME#1234` | `METADATA`            | Game Info        | Title, CreatedAt, HostName, GameType, QuestionSetId, LastPlayedAt, ttl  |
| `GAME#1234` | `STATE`               | Game State       | State: `Q1#ASK`, GameState: `question`, LessonNumber: `1`, CurrentQuestionId, UsedQuestions, PlayedQuestions, UpdatedAt, ttl |
| `GAME#1234` | `PLAYER#John`         | Player Record    | PlayerName: `John`, JoinedAt, TotalScore: `0`, ttl            |

### Game Catagory Management

| PK          | SK                         | Item Type        | Attributes                                                |
| ----------- | -------------------------- | ---------------- | --------------------------------------------------------- |
| `GAME#1234` | `STATE#CATS`               | Catagory List    | HostMask1-8: `1111111`, HostMask9-16: `1111111`, HostMask17-24: `00000000`, AvailMask1-8: `1111111`, AvailMask9-16: `1111111`, AvailMask17-24: `00000000`,SubmittedAt, ttl |
| `GAME#1234` | `CAT#001#ORDER`            | Catagory         | IsRandom: True, QuestionOrder: [3,2,1,5,6,4,7,8,]], SubmittedAt, ttl |
| `GAME#1234` | `CAT#001#ACTIVE`           | Catagory         | QuestionCount: `8`, ActiveIndex: `3`, SubmittedAt, ttl |
(non-random games categories will show ORDER as such
| `GAME#2122` | `CAT#001#ORDER`            | Catagory         | IsRandom: False, ttl |
| `GAME#2122` | `CAT#001#ACTIVE`           | Catagory         | QuestionCount: `8`, ActiveIndex: `4`, SubmittedAt, ttl |

### Game Question Management

| PK          | SK                    | Item Type        | Attributes                                                     |
| ----------- | --------------------- | ---------------- | -------------------------------------------------------------- |
| `GAME#1234` | `QUESTION#001#REF`        | Question Ref     | SourceQuestionId: `QUESTION#c001#001`, SetId: `GreatestHits`,  StartedAt, ttl |

### Game Answer Management

| PK          | SK                         | Item Type        | Attributes                                                |
| ----------- | -------------------------- | ---------------- | --------------------------------------------------------- |
| `GAME#1234` | `QUESTION#001#ANSWER#John`   | Answer Record    | PlayerName: `John`, QuestionNumber: `001`, SourceQuestionId: `QUESTION#c001#001`, Answer: `Prince`, SubmittedAt, ttl |
| `GAME#1234` | `QUESTION#001#ANSWER#Mary`   | Answer Record    | PlayerName: `Mary`, QuestionNumber: `001`, SourceQuestionId: `QUESTION#c001#001`, Answer: `Beatles`, SubmittedAt, ttl |

### Game Voting Management

| PK          | SK                       | Item Type      | Attributes                                                    |
| ----------- | ------------------------ | -------------- | ------------------------------------------------------------- |
| `GAME#1234` | `QUESTION#001#VOTE#John`   | Vote Record    | VoterName: `John`, QuestionNumber: `001`, Votes: `{"0": 1, "1": 2, "2": 3}`, SubmittedAt, ttl |
| `GAME#1234` | `QUESTION#001#VOTE#Mary`   | Vote Record    | VoterName: `Mary`, QuestionNumber: `001`, Votes: `{"0": 3, "1": 1, "2": 2}`, SubmittedAt, ttl |

### GAME AI Results Management

| PK          | SK                    | Item Type        | Attributes                                                     |
| ----------- | --------------------- | ---------------- | -------------------------------------------------------------- |
| `GAME#1234` | `QUESTION#001#AI#Summary`  | AI Record        | AI Prompt: `you are a consultant...`, Summary: `Summmary`, CreatedAt, TTL |



### Game Question Set Management (Separate from Game Data)

| PK          | SK                    | Item Type        | Attributes                                                     |
| ----------- | --------------------- | ---------------- | -------------------------------------------------------------- |
| `SETS`      | `SET#GLOABAL#GreatestHits`    | Question Set     | Name: `Greatest Hits`, GameType, Description, TotalQuestions: `10`, CategoryCount: `5`, CustomInstruction, AIInstructions, CreatedDate, Active: `true` |
| `SETS`      | `SET#HOST#1234#CustomSet`    | Question Set     | Name: `Custom Set`, GameType, Description, TotalQuestions: `10`, CategoryCount: `5`, CustomInstruction, AIInstructions, CreatedDate, Active: `true` |
| `SET#GreatestHits` | `CATEGORY#c001`   | Category Info    | Name: `Entertainment`, Description: `5 questions in Entertainment` |
| `SET#GreatestHits` | `QUESTION#c001#001` | Source Question | Prompt: `Greatest Musical Artist`, Detail: `Music has the power...`, Category: `Entertainment`, School: `School of Cultural Arts`, OrderInCategory: `1` |


### Game History Management

| PK          | SK                    | Item Type        | Attributes                                                     |
| ----------- | --------------------- | ---------------- | -------------------------------------------------------------- |
| `GAMES`     | `GAME#1234`           | Game Index       | GameId: `1234`, Title: `Team Session`, LastPlayedAt, CreatedAt, TTL |

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

### Game States (Structured Format) For the Host (announced to players)
- `INIT` → Initial game setup and lobby for players to join
- `Q1#ASK` → Question 1 being asked -broadcast statechange
- `Q1#VOTE` → Question 1 voting phase  -broadcast statechange
- `Q1#RESULTS` → Question 1 results display - broadcast statechange
- `Q2#ASK` → Question 2 being asked -broadast statechange 
- `OVER` → Game finished broadcast statechange


### Game States (Structured Format) For the Host (announced to players)
- `JOINED` → Initial player join boradcast to host
- `Q1#ANSWERED` → Question n answered -broadcast statechange to host
- `Q1#VOTED` → Question 1 voting phase  -broadCAST statechange to host

### Question Numbers
- Always 3-digit padded: `001`, `002`, `003`, etc.
- Sequential within each game
- Used as reference in ANSWER and VOTE records

## Data Flow

1. **Question Start**: check if game Random,then pick CAT from Game#nnn CATS, then pick question from CAT ORDER/CAT ACTIVE place in GAME#nnn QUESTION#mmm with reference to source question in the set data
2. **Answer Submission**: Store `QUESTION#001#ANSWER#name` with answer text
3. **Vote Submission**: Store `QUESTION#001#VOTE#name` with vote rankings
4. **Results Calculation**: Query votes by question number, calculate scores
5. **Score Update**: Update player `TotalScore` in `PLAYER#name` record
6. If enabled **generate AI Response: this will require general prompt+set prompt+event prompt, question, top 3 response if voted, 

## Key Design Principles

1. **Sequential GAME Question Numbers** - Clean 001, 002, 003 progression with LOOKUP in SET Data
2. **Source References** - Game questions reference original question set data
3. **Efficient Queries** - Direct queries by question number, no scans
4. **Separation of Concerns** - Game data separate from question catalog
5. **Player-Centric Records** - Each player has individual answer/vote records
6. **State Persistence** - Game state stored for page refresh handling



# Screens - on page load check state if no game ID provided launch Get Started Game Page else if host check host state, if player, check player state, if no player created go to Join dialog
## Host

## Get Started Dialog
Get Started
Choose how you'd like to begin your collaborative learning session:

Button - 🎯 Start New Game - go to New Game Dialog
Entry - Enter 4-digit Game ID Continue Existing Game, button-Continue Game, check state of gameid entered and go to that place in the game or error and return here
button - 📋 View Game History (go to game histroy dialog )

## Lobby
Title from game#nnn meta 



##Game Flow
  1. createGame(host) + state change: CREATED - Host creates the game
  2. getGame(both) - Both host and players can get game info (they do this when they join the page, reload, etc)
  3. startGame(host) + state change: STARTED - Host starts the game
  4. nextQuestion(host) [Host->WS] + state change: ASK#{questionid} - Host advances to next question
  5. getQuestion(both) - Both get the current question - THis api calls a function that looks at the gamequestionnumber lookup and pulls the question from the set data
  6. answer(player) [Player->WS] - Players submit answers - host front end will add a checkmark next to the player card and tally the number of players that answered of the total players
  7. requestVote(host) [Host->WS] + state change: VOTE#{questionid} - Host starts voting 
  8. getAnswers(both) - Both get answers to vote on
  9. vote(player) [Player->WS] - Players vote - host front end will add a checkmark next to the player card and tally the number of players that voted of the total players
  10. createResults(host) [Host->WS] + state change: RESULTS#{questionid} - Host creates results
  11. getResults(both) - Both get results
  12. createReport(host) - Host creates final report
  13. getReport(both) - Both can get the report

  Extra APIs that can be used in conjunction with the above:
  1. joinGame(player) - Player joins the game at anytime after start 
  2. getPlayers(both) - Host can get the list of players
  3. getGameState(both) - Both can get the current game state
  4. getQuestionSet(both) - Host can get the question set
  5. getCategories(both) - Host can get the categories
