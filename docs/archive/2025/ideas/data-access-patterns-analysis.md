# Data Access Patterns Analysis

## Overview

This document analyzes all data access patterns in the Meeting Engagements Platform to ensure optimal DynamoDB performance with minimal API calls and zero table scans.

---

## 1. User Management Access Patterns

### 1.1 User Authentication & Profile
**Use Case**: User login, profile retrieval, token balance check

**Current Schema**:
```
PK: USER#email@domain.com
SK: PROFILE
```

**Access Patterns**:
- ✅ **Get user profile**: `PK = USER#email AND SK = PROFILE` (1 call)
- ✅ **Update user profile**: `PK = USER#email AND SK = PROFILE` (1 call)

**Analysis**: ✅ Efficient - Direct key access

### 1.2 Token Usage Tracking
**Use Case**: View token usage history, calculate monthly usage

**Current Schema**:
```
PK: USER#email@domain.com
SK: TOKENLEDGER#timestamp
```

**Access Patterns**:
- ✅ **Get user's token history**: `PK = USER#email AND begins_with(SK, "TOKENLEDGER#")` (1 call)
- ❌ **Get monthly usage**: Requires filtering by date range - potential scan
- ❌ **Get usage by engagement type**: Requires filtering by attributes - potential scan

**Issues Identified**:
1. Monthly usage calculation may require scanning all token records
2. Usage analytics by engagement type not efficiently queryable

---

## 2. Content Set Management Access Patterns

### 2.1 Content Set Discovery
**Use Case**: List available content sets, search by type

**Current Schema**:
```
PK: SETS
SK: SET#GLOBAL#setId  or  SET#USER#userId#setId
```

**Access Patterns**:
- ✅ **List all global sets**: `PK = SETS AND begins_with(SK, "SET#GLOBAL#")` (1 call)
- ✅ **List user's sets**: `PK = SETS AND begins_with(SK, "SET#USER#userId#")` (1 call)
- ❌ **List sets by engagement type**: Requires filtering by EngagementType attribute - potential scan
- ❌ **Search sets by name**: Requires filtering by Name attribute - potential scan

**Issues Identified**:
1. Filtering by engagement type requires scan
2. Search functionality not efficiently supported

### 2.2 Content Set Details
**Use Case**: Get set metadata, categories, and content items

**Current Schema**:
```
PK: SET#setId
SK: METADATA | CATEGORY#catId | ITEM#catId#itemId
```

**Access Patterns**:
- ✅ **Get set metadata**: `PK = SET#setId AND SK = METADATA` (1 call)
- ✅ **Get all categories**: `PK = SET#setId AND begins_with(SK, "CATEGORY#")` (1 call)
- ✅ **Get all items**: `PK = SET#setId AND begins_with(SK, "ITEM#")` (1 call)
- ✅ **Get items by category**: `PK = SET#setId AND begins_with(SK, "ITEM#catId#")` (1 call)

**Analysis**: ✅ Efficient - All direct key access patterns

---

## 3. Host Management Access Patterns

### 3.1 Host Profile and Engagement List
**Use Case**: Host dashboard, engagement history

**Current Schema**:
```
PK: HOSTS
SK: HOST#userId

PK: HOST#userId
SK: ENGAGEMENT#engagementId
```

**Access Patterns**:
- ✅ **Get host profile**: `PK = HOSTS AND SK = HOST#userId` (1 call)
- ✅ **List host's engagements**: `PK = HOST#userId AND begins_with(SK, "ENGAGEMENT#")` (1 call)
- ❌ **List engagements by status**: Requires filtering by Status attribute - potential scan
- ❌ **List recent engagements**: Requires sorting by date - may need scan

**Issues Identified**:
1. Filtering engagements by status not efficiently supported
2. Date-based sorting may require scanning

---

## 4. Engagement Management Access Patterns

### 4.1 Engagement Discovery and Joining
**Use Case**: Join by code, list active engagements

**Current Schema**:
```
PK: ENGAGEMENTS
SK: ENGAGEMENT#engagementId

GSI1: JoinCode -> ENGAGEMENT#engagementId
```

**Access Patterns**:
- ✅ **Join by code**: `GSI1: PK = joinCode` (1 call)
- ✅ **List all engagements**: `PK = ENGAGEMENTS` (1 call)
- ❌ **List active engagements**: Requires filtering by Status - potential scan
- ❌ **List engagements by type**: Requires filtering by EngagementType - potential scan
- ❌ **List engagements by host**: Requires filtering by HostId - potential scan

**Issues Identified**:
1. Multiple filtering needs not supported by current GSI structure
2. Host-specific engagement listing requires scan

### 4.2 Engagement State and Participants
**Use Case**: Real-time updates, participant management

**Current Schema**:
```
PK: ENGAGEMENT#engagementId
SK: METADATA | STATE | PARTICIPANT#name
```

**Access Patterns**:
- ✅ **Get engagement metadata**: `PK = ENGAGEMENT#id AND SK = METADATA` (1 call)
- ✅ **Get engagement state**: `PK = ENGAGEMENT#id AND SK = STATE` (1 call)
- ✅ **List all participants**: `PK = ENGAGEMENT#id AND begins_with(SK, "PARTICIPANT#")` (1 call)
- ✅ **Get specific participant**: `PK = ENGAGEMENT#id AND SK = PARTICIPANT#name` (1 call)

**Analysis**: ✅ Efficient - All direct key access patterns

---

## 5. Content Delivery Access Patterns

### 5.1 Category and Item Management
**Use Case**: Random selection, progress tracking

**Current Schema**:
```
PK: ENGAGEMENT#engagementId
SK: DELIVERY#CATEGORIES | DELIVERY#CAT#catId#ORDER | ITEM#itemNumber
```

**Access Patterns**:
- ✅ **Get category state**: `PK = ENGAGEMENT#id AND SK = DELIVERY#CATEGORIES` (1 call)
- ✅ **Get category order**: `PK = ENGAGEMENT#id AND begins_with(SK, "DELIVERY#CAT#")` (1 call)
- ✅ **Get specific category order**: `PK = ENGAGEMENT#id AND SK = DELIVERY#CAT#catId#ORDER` (1 call)
- ✅ **Get current item**: `PK = ENGAGEMENT#id AND SK = ITEM#001` (1 call)
- ✅ **Get all active items**: `PK = ENGAGEMENT#id AND begins_with(SK, "ITEM#")` (1 call)

**Analysis**: ✅ Efficient - All direct key access patterns

---

## 6. Response Management Access Patterns

### 6.1 Response Collection and Analysis
**Use Case**: Real-time response tracking, results calculation

**Current Schema**:
```
PK: ENGAGEMENT#engagementId
SK: RESPONSE#itemNum#participant | VOTE#itemNum#participant
```

**Access Patterns**:
- ✅ **Get responses for item**: `PK = ENGAGEMENT#id AND begins_with(SK, "RESPONSE#001#")` (1 call)
- ✅ **Get participant's response**: `PK = ENGAGEMENT#id AND SK = RESPONSE#001#participant` (1 call)
- ✅ **Get votes for item**: `PK = ENGAGEMENT#id AND begins_with(SK, "VOTE#001#")` (1 call)
- ❌ **Get all participant responses**: Requires multiple queries or scan
- ❌ **Get response analytics**: May require scanning for aggregation

**Issues Identified**:
1. Getting all responses for a participant across items requires multiple queries
2. Analytics and aggregation may require scanning

---

## 7. AI Processing Access Patterns

### 7.1 AI Summary and Analysis
**Use Case**: Generate and retrieve AI insights

**Current Schema**:
```
PK: ENGAGEMENT#engagementId
SK: AI#SUMMARY | AI#ITEM#itemNum
```

**Access Patterns**:
- ✅ **Get engagement summary**: `PK = ENGAGEMENT#id AND SK = AI#SUMMARY` (1 call)
- ✅ **Get item analysis**: `PK = ENGAGEMENT#id AND SK = AI#ITEM#itemNum` (1 call)
- ✅ **Get all AI analyses**: `PK = ENGAGEMENT#id AND begins_with(SK, "AI#")` (1 call)

**Analysis**: ✅ Efficient - All direct key access patterns

---

## 8. Critical Issues Summary

### 8.1 High Priority Issues (Require Schema Changes)

1. **Content Set Filtering**
   - **Issue**: Cannot efficiently filter sets by engagement type
   - **Impact**: Poor performance when browsing content by type
   - **Solution Needed**: Additional GSI or schema restructure

2. **Engagement Discovery**
   - **Issue**: Cannot efficiently list engagements by status, type, or host
   - **Impact**: Dashboard performance, host management
   - **Solution Needed**: Additional GSI structure

3. **Token Usage Analytics**
   - **Issue**: Monthly usage and type-based analytics require scans
   - **Impact**: Billing calculations, usage reports
   - **Solution Needed**: Aggregated data structure or GSI

4. **Participant Response Analytics**
   - **Issue**: Cross-item participant analysis requires multiple queries
   - **Impact**: Performance analytics, AI processing
   - **Solution Needed**: Denormalized participant summary

### 8.2 Medium Priority Issues

1. **Content Set Search**
   - **Issue**: Name-based search not supported
   - **Impact**: User experience when finding content
   - **Solution**: ElasticSearch integration or GSI with normalized names

2. **Date-based Queries**
   - **Issue**: Recent engagements, time-based analytics
   - **Impact**: Dashboard performance
   - **Solution**: Date-based GSI or time-bucketed keys

---

## 9. Recommended Schema Optimizations

### 9.1 Additional GSI Requirements

**GSI2: Content Type Lookup**
```
PK: ENGAGEMENT_TYPE#trivia
SK: SET#GLOBAL#setId  or  SET#USER#userId#setId
```

**GSI3: Engagement Status Lookup**
```
PK: STATUS#ACTIVE
SK: ENGAGEMENT#engagementId#timestamp
```

**GSI4: Host Engagement Lookup**
```
PK: HOST#userId
SK: STATUS#ACTIVE#ENGAGEMENT#engagementId
```

### 9.2 Denormalization Opportunities

1. **Participant Summary Records**
   - Store aggregated participant data for quick analytics
   - Update on each response submission

2. **Monthly Token Usage**
   - Pre-aggregate monthly usage by user and type
   - Update incrementally with each token usage

3. **Engagement Statistics**
   - Store real-time engagement stats for dashboard display
   - Update via DynamoDB Streams

---

## 10. Next Steps

1. **Review and validate** these access patterns with actual use cases
2. **Design optimized schema** addressing the identified issues
3. **Create migration plan** from current to optimized schema
4. **Implement efficient query patterns** with minimal API calls
5. **Add monitoring** to ensure no scans are performed in production

This analysis provides the foundation for creating a truly efficient, scan-free DynamoDB design that supports all platform requirements with optimal performance.

---

## 11. Detailed Use Case Analysis

### 11.1 Host Admin Dashboard - Main Page Load
**Scenario**: Host logs in and loads their dashboard

**Required Data**:
1. User profile and token balance
2. List of host's engagements (with status filtering)
3. Active sessions count
4. Recent activity summary

**Current Queries Needed**:
```
1. PK = USER#email AND SK = PROFILE (1 call)
2. PK = HOST#userId AND begins_with(SK, "ENGAGEMENT#") (1 call)
3. Filter results by status in application code (inefficient)
4. PK = SETS AND begins_with(SK, "SET#USER#userId#") (1 call)
```

**Issues**: Status filtering happens in application, not database level

### 11.2 Participant Joining Flow
**Scenario**: Participant enters join code and joins session

**Required Data**:
1. Find engagement by join code
2. Get engagement metadata and current state
3. Add participant record
4. Get current question/content item

**Current Queries Needed**:
```
1. GSI1: PK = joinCode (1 call)
2. PK = ENGAGEMENT#id AND SK = METADATA (1 call)
3. PK = ENGAGEMENT#id AND SK = STATE (1 call)
4. PK = ENGAGEMENT#id AND SK = ITEM#currentItem (1 call)
5. PUT PK = ENGAGEMENT#id AND SK = PARTICIPANT#name (1 call)
```

**Analysis**: ✅ Efficient - 5 targeted calls, no scans

### 11.3 Real-time Response Collection
**Scenario**: Host wants to see real-time response progress during question

**Required Data**:
1. Current engagement state
2. All responses for current question
3. Participant count
4. Response statistics

**Current Queries Needed**:
```
1. PK = ENGAGEMENT#id AND SK = STATE (1 call)
2. PK = ENGAGEMENT#id AND begins_with(SK, "RESPONSE#001#") (1 call)
3. PK = ENGAGEMENT#id AND begins_with(SK, "PARTICIPANT#") (1 call)
```

**Analysis**: ✅ Efficient - 3 targeted calls

### 11.4 Content Set Selection
**Scenario**: Host creating new engagement, browsing content by type

**Required Data**:
1. All global content sets of specific type (e.g., trivia)
2. User's content sets of specific type
3. Set metadata for preview

**Current Queries Needed**:
```
1. PK = SETS AND begins_with(SK, "SET#GLOBAL#") (1 call)
   - Then filter by EngagementType in application ❌
2. PK = SETS AND begins_with(SK, "SET#USER#userId#") (1 call)
   - Then filter by EngagementType in application ❌
```

**Issues**: Type filtering requires application-level processing of all sets

### 11.5 AI Summary Generation
**Scenario**: Generate AI summary after engagement completion

**Required Data**:
1. All responses for all questions
2. All votes (if applicable)
3. Engagement metadata
4. Content set information for context

**Current Queries Needed**:
```
1. PK = ENGAGEMENT#id AND begins_with(SK, "RESPONSE#") (1 call)
2. PK = ENGAGEMENT#id AND begins_with(SK, "VOTE#") (1 call)
3. PK = ENGAGEMENT#id AND SK = METADATA (1 call)
4. PK = SET#setId AND SK = METADATA (1 call)
```

**Analysis**: ✅ Efficient - 4 targeted calls

### 11.6 Monthly Usage Report
**Scenario**: Generate monthly token usage report for user

**Required Data**:
1. All token usage records for user in date range
2. Breakdown by engagement type
3. Comparison with previous month

**Current Queries Needed**:
```
1. PK = USER#email AND begins_with(SK, "TOKENLEDGER#") (1 call)
   - Then filter by date range in application ❌
   - Then group by engagement type in application ❌
```

**Issues**: Date filtering and grouping require application processing

### 11.7 Engagement Analytics Dashboard
**Scenario**: Platform admin viewing engagement analytics

**Required Data**:
1. All engagements by type and status
2. Participation statistics
3. Popular content sets
4. Usage trends

**Current Queries Needed**:
```
1. PK = ENGAGEMENTS (1 call)
   - Then filter/group by type and status in application ❌
2. Multiple queries to get participation data ❌
3. PK = SETS with usage counting ❌
```

**Issues**: Requires extensive application-level processing and multiple queries
