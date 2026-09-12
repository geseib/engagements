# API Design

## Overview

The API follows RESTful principles with WebSocket support for real-time features. All endpoints are designed for efficiency with minimal round trips.

## Base URLs

- **HTTP API**: `https://api.engagements.{domain}/`
- **WebSocket API**: `wss://ws.engagements.{domain}/`

## Authentication

- **Public Endpoints**: No authentication required
- **Game Access**: Game ID provides access control
- **Admin Endpoints**: Bearer token authentication (future)

## HTTP API Endpoints

### Game Management

#### Create Game
```http
POST /games
Content-Type: application/json

{
  "title": "Team Retrospective",
  "engagementType": "call-and-answer",
  "questionSetId": "greatest-hits",
  "aiContext": "Software development team retrospective",
  "debugMode": false
}

Response: 201 Created
{
  "gameId": "1234",
  "title": "Team Retrospective",
  "engagementType": "call-and-answer",
  "createdAt": "2024-01-15T10:30:00Z",
  "joinUrl": "https://engagements.example.com/play?gameId=1234"
}
```

#### Get Game Info
```http
GET /games/{gameId}

Response: 200 OK
{
  "gameId": "1234",
  "title": "Team Retrospective",
  "engagementType": "call-and-answer",
  "state": "waiting",
  "playerCount": 5,
  "createdAt": "2024-01-15T10:30:00Z",
  "currentQuestion": null
}
```

#### Update Game State
```http
PUT /games/{gameId}/state
Content-Type: application/json

{
  "state": "question",
  "currentQuestionId": "001",
  "questionStartedAt": "2024-01-15T10:35:00Z"
}

Response: 200 OK
{
  "success": true,
  "state": "question",
  "updatedAt": "2024-01-15T10:35:00Z"
}
```

### Player Management

#### Join Game
```http
POST /games/{gameId}/players
Content-Type: application/json

{
  "name": "John Doe"
}

Response: 201 Created
{
  "playerName": "John Doe",
  "gameId": "1234",
  "joinedAt": "2024-01-15T10:32:00Z",
  "totalScore": 0,
  "rejoined": false
}
```

#### Get Players
```http
GET /games/{gameId}/players

Response: 200 OK
{
  "players": [
    {
      "name": "John Doe",
      "totalScore": 15,
      "rank": 1,
      "joinedAt": "2024-01-15T10:32:00Z",
      "isActive": true
    },
    {
      "name": "Jane Smith", 
      "totalScore": 12,
      "rank": 2,
      "joinedAt": "2024-01-15T10:33:00Z",
      "isActive": true
    }
  ],
  "totalPlayers": 2
}
```

### Question Management

#### Start Question
```http
POST /games/{gameId}/questions
Content-Type: application/json

{
  "questionId": "001",
  "sourceQuestionRef": "SET#greatest-hits/QUESTION#leadership#001",
  "setId": "greatest-hits",
  "category": "leadership"
}

Response: 201 Created
{
  "questionId": "001",
  "startedAt": "2024-01-15T10:35:00Z",
  "success": true
}
```

#### Get Question Content
```http
GET /questions/{setId}/{questionRef}

Response: 200 OK
{
  "questionId": "leadership#001",
  "title": "Effective Leadership in Crisis",
  "detail": "During the 2008 financial crisis, leaders who maintained transparent communication...",
  "category": "leadership",
  "school": "School of Management",
  "customInstruction": "How would you apply this leadership approach in your current role?"
}
```

### Answer Management

#### Submit Answer
```http
POST /games/{gameId}/answers
Content-Type: application/json

{
  "playerName": "John Doe",
  "questionId": "001",
  "answer": "I would implement daily stand-ups to maintain transparency and build trust with my team during uncertain times."
}

Response: 201 Created
{
  "success": true,
  "submittedAt": "2024-01-15T10:37:00Z"
}
```

#### Get Answers
```http
GET /games/{gameId}/answers?questionId=001

Response: 200 OK
{
  "answers": [
    {
      "playerName": "John Doe",
      "answer": "I would implement daily stand-ups...",
      "submittedAt": "2024-01-15T10:37:00Z",
      "wordCount": 23
    },
    {
      "playerName": "Jane Smith",
      "answer": "Regular team check-ins and clear communication...",
      "submittedAt": "2024-01-15T10:38:00Z", 
      "wordCount": 18
    }
  ],
  "totalAnswers": 2
}
```

### Voting Management

#### Submit Votes
```http
POST /games/{gameId}/votes
Content-Type: application/json

{
  "voterName": "John Doe",
  "questionId": "001",
  "votes": {
    "0": 1,  // First answer gets rank 1 (best)
    "1": 2   // Second answer gets rank 2
  }
}

Response: 201 Created
{
  "success": true,
  "submittedAt": "2024-01-15T10:40:00Z"
}
```

#### Get Votes
```http
GET /games/{gameId}/votes?questionId=001

Response: 200 OK
{
  "votes": [
    {
      "voterName": "John Doe",
      "votes": {"0": 1, "1": 2},
      "submittedAt": "2024-01-15T10:40:00Z"
    },
    {
      "voterName": "Jane Smith",
      "votes": {"0": 2, "1": 1},
      "submittedAt": "2024-01-15T10:41:00Z"
    }
  ],
  "totalVotes": 2
}
```

### Question Sets

#### Get Question Sets
```http
GET /question-sets

Response: 200 OK
{
  "questionSets": [
    {
      "setId": "greatest-hits",
      "name": "Greatest Hits",
      "description": "Popular lessons from various industries",
      "totalQuestions": 25,
      "categories": ["leadership", "innovation", "teamwork"],
      "isActive": true
    }
  ]
}
```

#### Get Set Categories
```http
GET /question-sets/{setId}/categories

Response: 200 OK
{
  "categories": [
    {
      "categoryId": "leadership",
      "name": "Leadership",
      "questionCount": 8,
      "description": "Leadership lessons from successful executives"
    },
    {
      "categoryId": "innovation", 
      "name": "Innovation",
      "questionCount": 7,
      "description": "Innovation strategies from industry pioneers"
    }
  ]
}
```

## WebSocket API

### Connection Management

#### Connect
```javascript
// Connect with query parameters
const ws = new WebSocket('wss://ws.engagements.example.com/?gameId=1234&playerName=John&isHost=false');
```

#### Message Format
```javascript
// All messages follow this structure
{
  "type": "messageType",
  "gameId": "1234", 
  "timestamp": "2024-01-15T10:35:00Z",
  "data": { /* message-specific data */ }
}
```

### Real-time Events

#### Game State Changes
```javascript
{
  "type": "gameStateChanged",
  "gameId": "1234",
  "timestamp": "2024-01-15T10:35:00Z",
  "data": {
    "state": "question",
    "currentQuestionId": "001"
  }
}
```

#### Player Joined
```javascript
{
  "type": "playerJoined",
  "gameId": "1234", 
  "timestamp": "2024-01-15T10:32:00Z",
  "data": {
    "playerName": "John Doe",
    "playerCount": 3
  }
}
```

#### Answer Submitted
```javascript
{
  "type": "playerAnswered",
  "gameId": "1234",
  "timestamp": "2024-01-15T10:37:00Z",
  "data": {
    "playerName": "John Doe",
    "questionId": "001",
    "answerCount": 2
  }
}
```

#### Vote Submitted
```javascript
{
  "type": "playerVoted",
  "gameId": "1234",
  "timestamp": "2024-01-15T10:40:00Z",
  "data": {
    "voterName": "John Doe",
    "questionId": "001",
    "voteCount": 1
  }
}
```

## Error Handling

### HTTP Error Responses
```javascript
// 400 Bad Request
{
  "error": "INVALID_REQUEST",
  "message": "Player name is required",
  "details": {
    "field": "name",
    "code": "MISSING_REQUIRED_FIELD"
  }
}

// 404 Not Found
{
  "error": "GAME_NOT_FOUND",
  "message": "Game with ID 1234 does not exist"
}

// 409 Conflict
{
  "error": "PLAYER_ALREADY_EXISTS",
  "message": "Player with name 'John Doe' already exists in this game"
}
```

### WebSocket Error Messages
```javascript
{
  "type": "error",
  "error": "CONNECTION_FAILED",
  "message": "Failed to join game",
  "timestamp": "2024-01-15T10:35:00Z"
}
```

## Rate Limiting

- **Per IP**: 100 requests per minute
- **Per Game**: 1000 requests per minute
- **WebSocket**: 10 messages per second per connection

## Caching Strategy

- **Question Sets**: Cache for 1 hour
- **Game State**: No caching (real-time)
- **Static Content**: Cache for 24 hours

This API design provides efficient, real-time collaboration while maintaining simplicity and extensibility.
