# GSI-Free Schema Optimization

## Overview

This document proposes a DynamoDB schema design that eliminates both GSIs and table scans, using strategic data partitioning and considering OpenSearch for analytics while evaluating query-and-filter patterns for large datasets.

---

## 1. GSI Analysis and Alternatives

### 1.1 Current GSI Usage Assessment

**GSI1: Join Code Lookup**
```
PK: JoinCode -> SK: ENGAGEMENT#engagementId
```
**Assessment**: ✅ **Keep** - Critical for participant joining, no alternative
**Justification**: Join codes are unique, small dataset, essential for UX

**GSI2: Host Engagement Lookup** 
```
PK: HOST#userId#status -> SK: TIMESTAMP#engagementId
```
**Assessment**: ❌ **Eliminate** - Can be replaced with main table partitioning

**GSI3: Content Usage Analytics**
```
PK: CONTENT_USAGE#YYYY-MM -> SK: SET#setId#usageCount
```
**Assessment**: ❌ **Eliminate** - Move to OpenSearch or pre-computed aggregates

**GSI4: Platform Analytics**
```
PK: ANALYTICS#YYYY-MM#engagementType -> SK: METRIC#metricName#value
```
**Assessment**: ❌ **Eliminate** - Move to OpenSearch

### 1.2 Revised GSI Strategy
- **Keep only GSI1** (Join Code Lookup) - essential for core functionality
- **Eliminate analytics GSIs** - Move to OpenSearch
- **Eliminate host lookup GSI** - Use main table partitioning

---

## 2. GSI-Free Schema Design

### 2.1 Main Table Structure (Optimized)

#### User Management (Unchanged)
```
PK: USER#email@domain.com
SK: PROFILE | TOKENLEDGER#YYYY-MM#engagementType
```

#### Content Set Management (Partitioned by Type)
```
PK: SETS#GLOBAL#trivia
SK: SET#setId
Attributes: Name, Description, TotalItems, CreatedBy, Active, CreatedAt

PK: SETS#USER#userId#trivia  
SK: SET#setId
Attributes: Name, Description, TotalItems, CreatedBy, Active, CreatedAt
```

#### Host Management (Status in PK)
```
PK: HOST#userId#ACTIVE
SK: ENGAGEMENT#engagementId#timestamp
Attributes: Title, EngagementType, SetId, CreatedAt

PK: HOST#userId#COMPLETED
SK: ENGAGEMENT#engagementId#timestamp
Attributes: Title, EngagementType, SetId, CreatedAt, CompletedAt
```

#### Engagement Management (Status + Type in PK)
```
PK: ENGAGEMENTS#ACTIVE#trivia
SK: ENGAGEMENT#engagementId#timestamp
Attributes: Title, HostId, SetId, CreatedAt, JoinCode

PK: ENGAGEMENT#engagementId
SK: METADATA | STATE | PARTICIPANT#name | STATS
```

### 2.2 Single GSI (Join Code Only)
```
GSI1: Join Code Lookup
PK: JoinCode (e.g., "A1B2")
SK: ENGAGEMENT#engagementId
```

---

## 3. Query-and-Filter Analysis

### 3.1 Content Set Browsing
**Scenario**: User browsing all trivia content sets

**Option A: Direct Query (Recommended)**
```javascript
// Query specific type partition - small, targeted result set
const triviaContent = await dynamodb.query({
  KeyConditionExpression: 'PK = :pk',
  ExpressionAttributeValues: {
    ':pk': 'SETS#GLOBAL#trivia'
  }
}).promise();
```
**Analysis**: ✅ Efficient - Type-specific partitions keep result sets small

**Option B: Query-and-Filter (Not needed)**
```javascript
// Would require querying all content types then filtering
// Not recommended - defeats the purpose of partitioning
```

### 3.2 Host Dashboard - All Engagements
**Scenario**: Host wants to see all their engagements regardless of status

**Option A: Multiple Targeted Queries (Recommended)**
```javascript
// Query each status partition separately
const [active, completed, archived] = await Promise.all([
  dynamodb.query({
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: { ':pk': 'HOST#userId#ACTIVE' }
  }).promise(),
  dynamodb.query({
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: { ':pk': 'HOST#userId#COMPLETED' }
  }).promise(),
  dynamodb.query({
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: { ':pk': 'HOST#userId#ARCHIVED' }
  }).promise()
]);

// Combine and sort in application
const allEngagements = [...active.Items, ...completed.Items, ...archived.Items]
  .sort((a, b) => new Date(b.CreatedAt) - new Date(a.CreatedAt));
```

**Option B: Query-and-Filter (Consider for large datasets)**
```javascript
// If a host has 1000+ engagements, might be more efficient to:
// 1. Query one large partition
// 2. Filter in Lambda (which has more CPU/memory than DynamoDB)
const allEngagements = await dynamodb.query({
  KeyConditionExpression: 'PK = :pk',
  ExpressionAttributeValues: { ':pk': 'HOST#userId' }
}).promise();

// Filter by status in Lambda
const activeEngagements = allEngagements.Items.filter(item => 
  item.SK.includes('#ACTIVE#'));
```

**Decision Matrix**:
- **< 100 engagements per status**: Use multiple targeted queries
- **> 100 engagements per status**: Consider query-and-filter
- **> 1000 total engagements**: Definitely use query-and-filter

### 3.3 Platform-wide Engagement Discovery
**Scenario**: Admin dashboard showing all active engagements

**Option A: Multiple Type Queries (Small scale)**
```javascript
// Query each engagement type separately
const engagementTypes = ['trivia', 'poll', 'survey', 'lesson'];
const activeEngagements = await Promise.all(
  engagementTypes.map(type =>
    dynamodb.query({
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: { ':pk': `ENGAGEMENTS#ACTIVE#${type}` }
    }).promise()
  )
);
```

**Option B: Query-and-Filter (Large scale)**
```javascript
// If there are many engagement types or large datasets
const allActive = await dynamodb.query({
  KeyConditionExpression: 'PK = :pk',
  ExpressionAttributeValues: { ':pk': 'ENGAGEMENTS#ACTIVE' }
}).promise();

// Filter by specific criteria in Lambda
const filteredEngagements = allActive.Items.filter(item => 
  matchesCriteria(item, filterCriteria));
```

---

## 4. OpenSearch Integration for Analytics

### 4.1 Analytics Data Pipeline

#### DynamoDB Streams → Lambda → OpenSearch
```javascript
// Lambda function triggered by DynamoDB Streams
exports.syncToOpenSearch = async (event) => {
  for (const record of event.Records) {
    if (record.eventName === 'INSERT' || record.eventName === 'MODIFY') {
      const item = record.dynamodb.NewImage;
      
      // Transform DynamoDB item to OpenSearch document
      const document = transformForAnalytics(item);
      
      // Index in OpenSearch
      await opensearchClient.index({
        index: 'engagement-analytics',
        body: document
      });
    }
  }
};

function transformForAnalytics(dynamoItem) {
  return {
    timestamp: dynamoItem.CreatedAt.S,
    engagementType: dynamoItem.EngagementType?.S,
    hostId: dynamoItem.HostId?.S,
    participantCount: dynamoItem.ParticipantCount?.N,
    duration: dynamoItem.Duration?.N,
    tokensUsed: dynamoItem.TokensUsed?.N,
    // Add other analytics fields
  };
}
```

### 4.2 Analytics Query Examples

#### Popular Content Sets
```javascript
// OpenSearch query instead of DynamoDB GSI
const popularContent = await opensearchClient.search({
  index: 'engagement-analytics',
  body: {
    query: {
      range: {
        timestamp: {
          gte: 'now-30d'
        }
      }
    },
    aggs: {
      popular_sets: {
        terms: {
          field: 'setId',
          size: 10
        }
      }
    }
  }
});
```

#### Usage Trends
```javascript
// Time-series analytics
const usageTrends = await opensearchClient.search({
  index: 'engagement-analytics',
  body: {
    query: {
      range: {
        timestamp: {
          gte: 'now-90d'
        }
      }
    },
    aggs: {
      usage_over_time: {
        date_histogram: {
          field: 'timestamp',
          calendar_interval: 'day'
        },
        aggs: {
          by_type: {
            terms: {
              field: 'engagementType'
            }
          }
        }
      }
    }
  }
});
```

---

## 5. Decision Framework

### 5.1 When to Use Query-and-Filter

**Use Query-and-Filter When**:
- Dataset size > 100 items per partition
- Complex filtering criteria
- Lambda has sufficient memory/CPU
- Filtering logic is simple and fast
- Network transfer cost < computation cost

**Example Calculation**:
```
Scenario: Host with 500 engagements across 3 statuses

Option A (Multiple Queries):
- 3 DynamoDB queries
- ~150ms total latency
- 3 RCU consumed

Option B (Query-and-Filter):
- 1 DynamoDB query (500 items)
- ~100ms DynamoDB + 20ms filtering
- 1 RCU consumed
- Better performance and cost
```

### 5.2 When to Avoid Query-and-Filter

**Avoid Query-and-Filter When**:
- Dataset size < 50 items per partition
- Complex filtering logic
- Memory constraints in Lambda
- Real-time performance requirements
- Filtering would eliminate >80% of results

### 5.3 Partition Size Guidelines

**Optimal Partition Sizes**:
- **< 50 items**: Direct targeted queries
- **50-500 items**: Consider query-and-filter
- **> 500 items**: Definitely use query-and-filter
- **> 10,000 items**: Consider data archiving or pagination

---

## 6. Revised Schema Recommendations

### 6.1 Final Schema Design

#### Main Table (No Additional GSIs)
```
// User data
PK: USER#email, SK: PROFILE | TOKENLEDGER#YYYY-MM#type

// Content sets (partitioned by type)
PK: SETS#GLOBAL#trivia, SK: SET#setId
PK: SETS#USER#userId#trivia, SK: SET#setId

// Host engagements (partitioned by status)
PK: HOST#userId#ACTIVE, SK: ENGAGEMENT#id#timestamp
PK: HOST#userId#COMPLETED, SK: ENGAGEMENT#id#timestamp

// Engagements (partitioned by status and type)
PK: ENGAGEMENTS#ACTIVE#trivia, SK: ENGAGEMENT#id#timestamp
PK: ENGAGEMENT#id, SK: METADATA | STATE | PARTICIPANT#name
```

#### Single GSI (Essential Only)
```
GSI1: Join Code Lookup
PK: JoinCode, SK: ENGAGEMENT#engagementId
```

#### OpenSearch (Analytics)
```
Index: engagement-analytics
Documents: Real-time engagement data for complex analytics
```

### 6.2 Query Strategy by Use Case

| Use Case | Strategy | Justification |
|----------|----------|---------------|
| Content browsing by type | Direct query | Small, type-specific partitions |
| Host dashboard (< 100 engagements) | Multiple targeted queries | Fast, predictable |
| Host dashboard (> 100 engagements) | Query-and-filter | More efficient for large datasets |
| Platform analytics | OpenSearch | Complex aggregations, time-series |
| Real-time monitoring | Direct queries | Performance critical |
| Monthly reports | Pre-aggregated data | Instant results |

---

## 7. Implementation Benefits

### 7.1 Cost Optimization
- **GSI Elimination**: 75% reduction in index costs
- **Efficient Queries**: Predictable RCU consumption
- **OpenSearch**: Pay only for analytics usage
- **Query-and-Filter**: Optimal for large datasets

### 7.2 Performance Benefits
- **No Scans**: 100% key-based access
- **Minimal GSIs**: Reduced complexity
- **Smart Partitioning**: Optimal query patterns
- **Flexible Analytics**: OpenSearch for complex queries

### 7.3 Operational Benefits
- **Simpler Schema**: Easier to understand and maintain
- **Predictable Costs**: No surprise GSI charges
- **Scalable Analytics**: OpenSearch handles complex queries
- **Future-Proof**: Easy to add new engagement types

This GSI-free approach provides optimal performance while minimizing costs and complexity.
