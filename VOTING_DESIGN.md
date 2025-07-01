# Efficient Voting System Design

## Database Structure

```
PK: GAME#{gameId}
├── SK: QUESTION#{questionId}#PLAYER#{name}#ANSWER     → Player's answer
├── SK: QUESTION#{questionId}#PLAYER#{name}#VOTES      → Player's complete vote set  
├── SK: QUESTION#{questionId}#RESULTS                  → Pre-calculated round results
└── SK: PLAYER#{name}#TOTALSCORE                      → Running total score
```

## Vote Storage (Single Record Per Voter)

**Frontend Submits:**
```javascript
{
  name: "marco",
  questionId: "QUESTION#c003#001", 
  votes: { "0": 1, "1": 2, "2": 3 }  // answerIndex: rank
}
```

**Backend Stores:**
```javascript
{
  PK: "GAME#1234",
  SK: "QUESTION#c003#001#PLAYER#marco#VOTES",
  VoterName: "marco",
  QuestionId: "QUESTION#c003#001", 
  Votes: { "0": 1, "1": 2, "2": 3 },  // Store complete vote set
  SubmittedAt: "2024-12-17T...",
  ttl: ...
}
```

## Benefits:

1. **Single Record Per Vote** → 1 record instead of 3
2. **Simple Duplicate Check** → Query single SK pattern
3. **Efficient Retrieval** → One query gets all votes for question
4. **Easy Results Calculation** → Process votes in memory
5. **Clear Data Structure** → Matches frontend submission format

## Vote Retrieval Logic:

```javascript
// Get all votes for question
const params = {
  TableName: TABLE_NAME,
  KeyConditionExpression: 'PK = :gameId AND begins_with(SK, :prefix)',
  ExpressionAttributeValues: {
    ':gameId': `GAME#${gameId}`,
    ':prefix': `QUESTION#${questionId}#PLAYER#`
  }
};

// Filter for vote records only
const voteRecords = result.Items
  .filter(item => item.SK.endsWith('#VOTES'))
  .map(item => ({
    voter: item.VoterName,
    questionId: item.QuestionId,
    votes: item.Votes,  // { "0": 1, "1": 2, "2": 3 }
    submittedAt: item.SubmittedAt
  }));
```

## Results Calculation:

```javascript
// Calculate points efficiently in memory
const answerPoints = {};
voteRecords.forEach(record => {
  Object.entries(record.votes).forEach(([answerIndex, rank]) => {
    if (!answerPoints[answerIndex]) answerPoints[answerIndex] = 0;
    const points = rank === 1 ? 3 : rank === 2 ? 2 : rank === 3 ? 1 : 0;
    answerPoints[answerIndex] += points;
  });
});
```

## Duplicate Prevention:

```javascript
// Simple check for existing vote
const existingVote = await db.get({
  TableName: TABLE_NAME,
  Key: {
    PK: `GAME#${gameId}`,
    SK: `QUESTION#${questionId}#PLAYER#${playerName}#VOTES`
  }
}).promise();

const hasVoted = !!existingVote.Item;
```

This design is much more efficient and matches the frontend data flow perfectly.