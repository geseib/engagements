# Optimized DynamoDB Schema Proposal

## Overview

Based on the data access patterns analysis, this document proposes an optimized DynamoDB schema that eliminates all table scans and minimizes API calls while supporting all platform requirements.

---

## 1. Critical Issues to Solve

### 1.1 Current Schema Limitations
1. **Content filtering by type** requires application-level processing
2. **Engagement discovery** by status/type/host requires scans
3. **Token usage analytics** requires date filtering in application
4. **Cross-item participant analysis** requires multiple queries
5. **Dashboard aggregations** require extensive application processing

### 1.2 Performance Goals
- ✅ Zero table scans in production
- ✅ Maximum 5 API calls for any use case
- ✅ Sub-100ms response times for all queries
- ✅ Efficient real-time updates
- ✅ Cost-effective at scale

---

## 2. Optimized Schema Design

### 2.1 Main Table Structure (Enhanced)

#### User Management (Unchanged - Already Efficient)
```
PK: USER#email@domain.com
SK: PROFILE
Attributes: Name, PlanTier, TokenBalance, CreatedAt, LastLoginAt

PK: USER#email@domain.com  
SK: TOKENLEDGER#YYYY-MM#engagementType
Attributes: MonthlyUsage, LastUpdated, EngagementCount
```

**Change**: Pre-aggregate monthly token usage by type instead of individual records

#### Content Set Management (Enhanced)
```
PK: SETS#GLOBAL#engagementType
SK: SET#setId
Attributes: Name, Description, TotalItems, CreatedBy, Active, CreatedAt

PK: SETS#USER#userId#engagementType  
SK: SET#setId
Attributes: Name, Description, TotalItems, CreatedBy, Active, CreatedAt

PK: SET#setId
SK: METADATA | CATEGORY#catId | ITEM#catId#itemId
Attributes: [existing attributes]
```

**Change**: Group sets by engagement type in PK for efficient filtering

#### Host Management (Enhanced)
```
PK: HOST#userId
SK: PROFILE
Attributes: Name, CreatedAt, LastActiveAt, TotalEngagements

PK: HOST#userId#status
SK: ENGAGEMENT#engagementId#timestamp
Attributes: Title, EngagementType, SetId, CreatedAt, Status
```

**Change**: Include status in PK for efficient status-based queries

#### Engagement Management (Enhanced)
```
PK: ENGAGEMENTS#status#engagementType
SK: ENGAGEMENT#engagementId#timestamp
Attributes: Title, HostId, SetId, CreatedAt, JoinCode

PK: ENGAGEMENT#engagementId
SK: METADATA | STATE | PARTICIPANT#name | STATS
Attributes: [existing attributes plus aggregated stats]
```

**Change**: Group by status and type for efficient discovery, add stats record

### 2.2 Global Secondary Indexes (Optimized)

#### GSI1: Join Code Lookup (Unchanged)
```
PK: JoinCode (e.g., "A1B2")
SK: ENGAGEMENT#engagementId
```

#### GSI2: Host Engagement Lookup (New)
```
PK: HOST#userId#status
SK: TIMESTAMP#engagementId
Purpose: Efficient host dashboard queries by status
```

#### GSI3: Content Usage Analytics (New)
```
PK: CONTENT_USAGE#YYYY-MM
SK: SET#setId#usageCount
Purpose: Popular content tracking and analytics
```

#### GSI4: Platform Analytics (New)
```
PK: ANALYTICS#YYYY-MM#engagementType
SK: METRIC#metricName#value
Purpose: Platform-wide analytics and reporting
```

---

## 3. Optimized Access Patterns

### 3.1 Host Admin Dashboard - Main Page Load
**Optimized Queries**:
```
1. PK = USER#email AND SK = PROFILE (1 call)
2. PK = HOST#userId#ACTIVE AND begins_with(SK, "ENGAGEMENT#") (1 call)
3. PK = HOST#userId#COMPLETED AND begins_with(SK, "ENGAGEMENT#") 
   with Limit=5 for recent history (1 call)
```
**Result**: 3 calls, no filtering needed ✅

### 3.2 Content Set Selection by Type
**Optimized Queries**:
```
1. PK = SETS#GLOBAL#trivia (1 call)
2. PK = SETS#USER#userId#trivia (1 call)
```
**Result**: 2 calls, direct type filtering ✅

### 3.3 Monthly Usage Report
**Optimized Queries**:
```
1. PK = USER#email AND begins_with(SK, "TOKENLEDGER#2024-01#") (1 call)
2. PK = USER#email AND begins_with(SK, "TOKENLEDGER#2023-12#") (1 call)
```
**Result**: 2 calls, pre-aggregated data ✅

### 3.4 Platform Analytics Dashboard
**Optimized Queries**:
```
1. PK = ANALYTICS#2024-01#trivia (1 call)
2. PK = ANALYTICS#2024-01#poll (1 call)
3. GSI3: PK = CONTENT_USAGE#2024-01 (1 call)
```
**Result**: 3 calls, pre-aggregated analytics ✅

---

## 4. Data Aggregation Strategy

### 4.1 Real-time Aggregation via DynamoDB Streams

#### Token Usage Aggregation
```javascript
// Lambda function triggered by token usage
exports.aggregateTokenUsage = async (event) => {
  for (const record of event.Records) {
    if (record.eventName === 'INSERT' && record.dynamodb.Keys.SK.S.startsWith('TOKENLEDGER#')) {
      const userId = record.dynamodb.Keys.PK.S;
      const month = extractMonth(record.dynamodb.NewImage.CreatedAt.S);
      const engagementType = record.dynamodb.NewImage.EngagementType.S;
      const tokensUsed = record.dynamodb.NewImage.UsedTokens.N;
      
      // Update monthly aggregate
      await updateMonthlyUsage(userId, month, engagementType, tokensUsed);
    }
  }
};
```

#### Engagement Statistics Aggregation
```javascript
// Update engagement stats on participant join/response
exports.updateEngagementStats = async (event) => {
  for (const record of event.Records) {
    if (record.eventName === 'INSERT' && 
        (record.dynamodb.Keys.SK.S.startsWith('PARTICIPANT#') || 
         record.dynamodb.Keys.SK.S.startsWith('RESPONSE#'))) {
      
      const engagementId = extractEngagementId(record.dynamodb.Keys.PK.S);
      await updateEngagementStats(engagementId);
    }
  }
};
```

### 4.2 Batch Processing for Analytics

#### Daily Analytics Aggregation
```javascript
// Scheduled Lambda for daily analytics processing
exports.generateDailyAnalytics = async (event) => {
  const yesterday = getYesterday();
  
  // Aggregate engagement metrics
  const engagementMetrics = await aggregateEngagementMetrics(yesterday);
  
  // Aggregate content usage
  const contentUsage = await aggregateContentUsage(yesterday);
  
  // Store in analytics partition
  await storeAnalytics(yesterday, engagementMetrics, contentUsage);
};
```

---

## 5. Migration Strategy

### 5.1 Phase 1: Add New Structures (No Breaking Changes)
1. Create new GSI structures
2. Add aggregation Lambda functions
3. Start dual-writing to old and new patterns
4. Validate data consistency

### 5.2 Phase 2: Migrate Existing Data
1. Backfill aggregated token usage data
2. Restructure content set records
3. Update engagement records with new PK patterns
4. Migrate host engagement records

### 5.3 Phase 3: Switch to New Patterns
1. Update application code to use new query patterns
2. Remove old query patterns
3. Clean up old data structures
4. Monitor performance improvements

---

## 6. Performance Validation

### 6.1 Query Performance Targets
```
Host Dashboard Load: < 200ms (3 queries)
Content Set Browsing: < 100ms (2 queries)
Participant Joining: < 150ms (4 queries)
Real-time Updates: < 50ms (1-2 queries)
Analytics Dashboard: < 300ms (5 queries max)
```

### 6.2 Cost Optimization
- **Read Capacity**: Predictable with direct key access
- **Write Capacity**: Efficient with batch operations
- **Storage**: Optimized with TTL and aggregation
- **GSI Costs**: Justified by eliminated scans

---

## 7. Implementation Priority

### 7.1 High Priority (Week 1-2)
1. Content set type filtering (immediate UX impact)
2. Host engagement status queries (dashboard performance)
3. Join code lookup optimization (already efficient, validate)

### 7.2 Medium Priority (Week 3-4)
1. Token usage aggregation (billing accuracy)
2. Engagement statistics (real-time performance)
3. Basic analytics structure

### 7.3 Low Priority (Week 5-6)
1. Advanced analytics dashboard
2. Content usage tracking
3. Performance monitoring and optimization

---

This optimized schema eliminates all identified scan operations while maintaining data consistency and supporting all platform requirements with minimal API calls.
