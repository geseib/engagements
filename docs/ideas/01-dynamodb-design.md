# DynamoDB Single Table Design - Meeting Engagements Platform

## Overview

This document defines the complete DynamoDB single table structure for the Meeting Engagements Platform. The design supports all engagement types (trivia, polls, surveys, lessons, etc.) while maintaining efficient query patterns and data consistency.

## Table Structure: `meeting-engagements-table`

### Core Design Principles

1. **Single Table Design**: All data stored in one table with strategic PK/SK patterns
2. **Engagement Type Agnostic**: Schema supports any engagement type (trivia, polls, surveys, etc.)
3. **Efficient Queries**: Direct access patterns, minimal scans
4. **Real-time Support**: Optimized for WebSocket real-time updates
5. **TTL Support**: Automatic cleanup of expired data
6. **User Isolation**: Data scoped by user ownership

---

## 1. User Management

| PK | SK | Item Type | Attributes |
|----|----|-----------|------------|
| `USER#email@domain.com` | `PROFILE` | User Profile | Name, PlanTier, TokenBalance, CreatedAt, LastLoginAt |
| `USER#email@domain.com` | `TOKENLEDGER#timestamp` | Token Usage | UsedTokens, Reason, EngagementId, SetId, CreatedAt |

### Query Patterns:
- Get user profile: `PK = USER#email AND SK = PROFILE`
- Get token usage history: `PK = USER#email AND begins_with(SK, "TOKENLEDGER#")`

---

## 2. Content Set Management

| PK | SK | Item Type | Attributes |
|----|----|-----------|------------|
| `SETS#GLOBAL#trivia` | `SET#setId` | Global Set Index | Name, EngagementType, Description, TotalItems, CreatedBy, Active |
| `SETS#USER#userId#trivia` | `SET#setId` | User Set Index | Name, EngagementType, Description, TotalItems, CreatedBy, Active |
| `SET#setId` | `METADATA` | Set Details | Name, EngagementType, DeliveryOrder, Instructions, AIPrompt, CreatedAt |
| `SET#setId` | `CATEGORY#catId` | Category Info | Name, Description, ItemCount |
| `SET#setId` | `ITEM#catId#itemId` | Content Item | Question/Prompt, Options, CorrectAnswer, Category, OrderInCategory |

### Content Item Examples by Engagement Type:

**Trivia:**
```json
{
  "Question": "What is the capital of France?",
  "Option1": "London", "Option2": "Berlin", "Option3": "Paris", "Option4": "Madrid",
  "CorrectAnswer": "Paris",
  "Category": "Geography"
}
```

**Poll:**
```json
{
  "Question": "Which feature should we prioritize?",
  "Option1": "Mobile App", "Option2": "API Integration", "Option3": "Analytics Dashboard",
  "Category": "Product Planning"
}
```

**Lesson Application:**
```json
{
  "Lesson": "Active Listening",
  "Description": "Practice reflecting back what you hear",
  "Instructions": "Share how you would apply this in your next team meeting",
  "Category": "Communication Skills"
}
```

### Query Patterns:
- List global sets by type: `PK = SETS#GLOBAL#trivia`
- List user's sets by type: `PK = SETS#USER#userId#trivia`
- List all global sets: Multiple queries by type (trivia, poll, survey, etc.)
- Get set metadata: `PK = SET#setId AND SK = METADATA`
- Get set categories: `PK = SET#setId AND begins_with(SK, "CATEGORY#")`
- Get content items: `PK = SET#setId AND begins_with(SK, "ITEM#")`

---

## 3. Host Management

| PK | SK | Item Type | Attributes |
|----|----|-----------|------------|
| `HOST#userId` | `PROFILE` | Host Profile | UserId, Name, CreatedAt, LastActiveAt, TotalEngagements |
| `HOST#userId#ACTIVE` | `ENGAGEMENT#engagementId#timestamp` | Active Engagement | Title, EngagementType, SetId, CreatedAt, Status |
| `HOST#userId#COMPLETED` | `ENGAGEMENT#engagementId#timestamp` | Completed Engagement | Title, EngagementType, SetId, CreatedAt, CompletedAt, Status |

### Query Patterns:
- Get host profile: `PK = HOST#userId AND SK = PROFILE`
- List active engagements: `PK = HOST#userId#ACTIVE`
- List completed engagements: `PK = HOST#userId#COMPLETED`
- List all engagements: Multiple queries by status or query-and-filter for large datasets

---

## 4. Engagement Management (Unified for All Types)

| PK | SK | Item Type | Attributes |
|----|----|-----------|------------|
| `ENGAGEMENTS#ACTIVE#trivia` | `ENGAGEMENT#engagementId#timestamp` | Active Engagement Index | Title, HostId, SetId, CreatedAt, JoinCode |
| `ENGAGEMENTS#COMPLETED#trivia` | `ENGAGEMENT#engagementId#timestamp` | Completed Engagement Index | Title, HostId, SetId, CreatedAt, CompletedAt |
| `ENGAGEMENT#engagementId` | `METADATA` | Engagement Info | Title, EngagementType, HostId, SetId, MaxPlayers, Settings, CreatedAt, TTL, ReportGenerated, ReportS3Key |
| `ENGAGEMENT#engagementId` | `STATE` | Current State | Phase, CurrentItemId, ItemsUsed, ItemsCompleted, UpdatedAt, TTL |
| `ENGAGEMENT#engagementId` | `PARTICIPANT#name` | Participant Record | Name, JoinedAt, TotalScore, Status, TTL |
| `ENGAGEMENT#engagementId` | `STATS` | Real-time Stats | ParticipantCount, ResponseCount, CurrentPhase, UpdatedAt, TTL |

### Engagement Settings by Type:
```json
{
  "trivia": {
    "hasVoting": true,
    "showCorrectAnswers": true,
    "aiSummaryEnabled": true,
    "timePerQuestion": 30
  },
  "poll": {
    "showRealTimeResults": true,
    "allowMultipleVotes": false
  },
  "survey": {
    "anonymous": true,
    "requireAllAnswers": false
  }
}
```

### Query Patterns:
- Get engagement by join code: `GSI1: PK = JoinCode`
- List active engagements by type: `PK = ENGAGEMENTS#ACTIVE#trivia`
- List all active engagements: Multiple queries by type or query-and-filter
- Get engagement metadata: `PK = ENGAGEMENT#id AND SK = METADATA`
- Get engagement state: `PK = ENGAGEMENT#id AND SK = STATE`
- Get engagement stats: `PK = ENGAGEMENT#id AND SK = STATS`
- List participants: `PK = ENGAGEMENT#id AND begins_with(SK, "PARTICIPANT#")`

---

## 5. Content Delivery Management

| PK | SK | Item Type | Attributes |
|----|----|-----------|------------|
| `ENGAGEMENT#engagementId` | `DELIVERY#CATEGORIES` | Category State | AvailableCategories, UsedCategories, RandomSeed, UpdatedAt |
| `ENGAGEMENT#engagementId` | `DELIVERY#CAT#catId#ORDER` | Category Order | IsRandom, ItemOrder, ActiveIndex, UpdatedAt |
| `ENGAGEMENT#engagementId` | `ITEM#itemNumber` | Active Item | SourceItemId, SetId, Category, Content, StartedAt, TTL |

### Query Patterns:
- Get category delivery state: `PK = ENGAGEMENT#id AND SK = DELIVERY#CATEGORIES`
- Get category order: `PK = ENGAGEMENT#id AND begins_with(SK, "DELIVERY#CAT#")`
- Get current item: `PK = ENGAGEMENT#id AND SK = ITEM#001`

---

## 6. Response Management (Unified for All Engagement Types)

| PK | SK | Item Type | Attributes |
|----|----|-----------|------------|
| `ENGAGEMENT#engagementId` | `RESPONSE#itemNum#participant` | Response Record | ParticipantName, ItemNumber, ResponseData, SubmittedAt, TTL |
| `ENGAGEMENT#engagementId` | `VOTE#itemNum#participant` | Vote Record | VoterName, ItemNumber, Votes, SubmittedAt, TTL |

### Response Data Examples by Type:

**Trivia Response:**
```json
{
  "selectedOption": "Option3",
  "timeToAnswer": 15,
  "isCorrect": true
}
```

**Poll Response:**
```json
{
  "selectedOptions": ["Option1", "Option3"],
  "confidence": 8
}
```

**Survey Response:**
```json
{
  "answers": {
    "question1": "Very satisfied",
    "question2": "The interface could be more intuitive",
    "question3": 9
  }
}
```

**Lesson Application Response:**
```json
{
  "reflection": "I will start each meeting by asking team members to share one thing they learned since our last meeting",
  "confidence": 7,
  "category": "Team Leadership"
}
```

### Query Patterns:
- Get responses for item: `PK = ENGAGEMENT#id AND begins_with(SK, "RESPONSE#001#")`
- Get participant's responses: `PK = ENGAGEMENT#id AND begins_with(SK, "RESPONSE#") AND contains(SK, "#participant")`
- Get votes for item: `PK = ENGAGEMENT#id AND begins_with(SK, "VOTE#001#")`

---

## 7. AI Processing and Results

| PK | SK | Item Type | Attributes |
|----|----|-----------|------------|
| `ENGAGEMENT#engagementId` | `AI#SUMMARY` | AI Summary | Prompt, Summary, Insights, GeneratedAt, TokensUsed, TTL |
| `ENGAGEMENT#engagementId` | `AI#ITEM#itemNum` | Item Analysis | ItemId, Analysis, Themes, TopResponses, GeneratedAt, TTL |

### Query Patterns:
- Get engagement summary: `PK = ENGAGEMENT#id AND SK = AI#SUMMARY`
- Get item analysis: `PK = ENGAGEMENT#id AND begins_with(SK, "AI#ITEM#")`

---

## 8. Global Secondary Indexes (GSI) - Minimized

### GSI1: Join Code Lookup (Essential Only)
- **PK**: `JoinCode` (e.g., "A1B2")
- **SK**: `ENGAGEMENT#engagementId`
- **Purpose**: Fast lookup of engagements by join code (critical for participant joining)

**Note**: All other access patterns are handled through strategic main table partitioning to eliminate additional GSI costs and complexity. Analytics queries are handled via OpenSearch integration for complex aggregations and reporting.

---

## 9. OpenSearch Integration for Analytics

### 9.1 Analytics Data Pipeline

**DynamoDB Streams → Lambda → OpenSearch**
- Real-time streaming of engagement data to OpenSearch
- Automated document transformation and indexing
- Support for complex analytics queries and aggregations

### 9.2 OpenSearch Document Structure

```json
{
  "engagementId": "eng_123",
  "timestamp": "2024-01-15T10:30:00Z",
  "engagementType": "trivia",
  "hostId": "user_456",
  "participantCount": 12,
  "duration": 1800,
  "tokensUsed": 120,
  "setId": "set_789",
  "completionRate": 0.95,
  "averageResponseTime": 15.2
}
```

### 9.3 Analytics Query Examples

**Popular Content Sets**:
```json
{
  "aggs": {
    "popular_sets": {
      "terms": {
        "field": "setId",
        "size": 10
      }
    }
  }
}
```

**Usage Trends**:
```json
{
  "aggs": {
    "usage_over_time": {
      "date_histogram": {
        "field": "timestamp",
        "calendar_interval": "day"
      }
    }
  }
}
```

### 9.4 Benefits of OpenSearch for Analytics
- **Complex Aggregations**: Time-series analysis, multi-dimensional grouping
- **Full-Text Search**: Search content sets, engagement titles, etc.
- **Real-time Dashboards**: Live analytics without impacting DynamoDB performance
- **Cost Efficiency**: Pay only for analytics usage, not constant GSI costs

---

## 9. TTL Configuration - Tiered Retention Strategy

### 9.1 Configurable Retention Periods

All TTL values are configurable via system settings:

```
PK: SYSTEM_SETTINGS
SK: RETENTION_POLICY
Attributes: {
  INIT_ENGAGEMENT_TTL_DAYS: 30,        // Initialized engagements
  ACTIVE_ENGAGEMENT_TTL_DAYS: 7,       // Active sessions
  COMPLETED_ENGAGEMENT_TTL_DAYS: 30,   // Completed engagements
  REPORT_RETENTION_DAYS: 90,           // PDF reports in S3
  AUTO_GENERATE_REPORTS: true
}
```

### 9.2 Phase-Based TTL Management

**Engagement Lifecycle TTL**:
- **INIT/JOINING**: 30 days (configurable) - Hosts may prepare in advance
- **ACTIVE**: 7 days (configurable) - Active sessions should complete quickly
- **COMPLETED**: 30 days (configurable) - Time to download reports before deletion
- **PDF Reports**: 90 days (configurable) - S3 lifecycle policy

**Dynamic TTL Calculation**:
```javascript
function calculateTTL(engagement) {
  const settings = getSystemSettings();
  const now = Date.now();

  switch (engagement.Phase) {
    case 'INIT':
    case 'JOINING':
      return Math.floor((now + (settings.INIT_ENGAGEMENT_TTL_DAYS * 24 * 60 * 60 * 1000)) / 1000);
    case 'ACTIVE':
      return Math.floor((now + (settings.ACTIVE_ENGAGEMENT_TTL_DAYS * 24 * 60 * 60 * 1000)) / 1000);
    case 'COMPLETED':
      return Math.floor((now + (settings.COMPLETED_ENGAGEMENT_TTL_DAYS * 24 * 60 * 60 * 1000)) / 1000);
  }
}
```

### 9.3 Automatic PDF Report Generation

**Before Deletion Pipeline**:
1. Engagement moves to COMPLETED phase
2. DynamoDB Streams triggers Lambda
3. Generate comprehensive PDF report
4. Upload to S3 with lifecycle policy
5. Update engagement with report metadata
6. Notify host of report availability

**Report Data Includes**:
- Engagement summary and statistics
- Participant responses and scores
- AI analysis and insights
- Detailed question-by-question breakdown

---

## 10. State Management

### Engagement Phases (Universal)
- `INIT` → Initial setup, no participants
- `JOINING` → Participants can join
- `ACTIVE` → Content delivery in progress
- `VOTING` → Voting phase (if applicable)
- `COMPLETED` → Engagement finished
- `ARCHIVED` → Historical record only

### State Transitions
```
INIT → JOINING → ACTIVE → [VOTING] → COMPLETED → ARCHIVED
```

Each engagement type can customize which phases apply and their specific behaviors.

---

This unified schema supports all current and future engagement types while maintaining efficient query patterns and real-time capabilities. The design is extensible and can accommodate new engagement types without schema changes.
