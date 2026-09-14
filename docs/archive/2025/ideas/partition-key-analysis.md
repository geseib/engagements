# Partition Key Analysis: HOST#userId#ACTIVE

## The Question: Why Include Status in Partition Key?

Let's analyze the trade-offs between different partitioning strategies for host engagement data.

---

## 1. Approach Comparison

### Option A: Status in Partition Key (Current Proposal)
```
PK: HOST#userId#ACTIVE
SK: ENGAGEMENT#engagementId#timestamp

PK: HOST#userId#COMPLETED  
SK: ENGAGEMENT#engagementId#timestamp

PK: HOST#userId#ARCHIVED
SK: ENGAGEMENT#engagementId#timestamp
```

### Option B: Status as Attribute (Alternative)
```
PK: HOST#userId
SK: ENGAGEMENT#engagementId#timestamp
Attributes: Status, Title, EngagementType, etc.
```

---

## 2. When Status in PK Helps

### 2.1 Dashboard Query Efficiency

**Scenario**: Host dashboard showing only active engagements

**Option A (Status in PK)**:
```javascript
// Single targeted query - gets only active engagements
const activeEngagements = await dynamodb.query({
  KeyConditionExpression: 'PK = :pk',
  ExpressionAttributeValues: {
    ':pk': 'HOST#user123#ACTIVE'
  }
}).promise();

// Result: 5 active engagements returned
// RCU consumed: ~1 (small result set)
// Processing: None needed
```

**Option B (Status as Attribute)**:
```javascript
// Query all engagements, then filter
const allEngagements = await dynamodb.query({
  KeyConditionExpression: 'PK = :pk',
  ExpressionAttributeValues: {
    ':pk': 'HOST#user123'
  },
  FilterExpression: 'Status = :status',
  ExpressionAttributeValues: {
    ':status': 'ACTIVE'
  }
}).promise();

// DynamoDB still reads ALL engagements, then filters
// If host has 100 total engagements but only 5 active:
// RCU consumed: ~20 (reads all 100 items)
// Network transfer: 100 items sent, 95 discarded
// Processing: DynamoDB does filtering, but still charges for all reads
```

### 2.2 The Key Insight: DynamoDB FilterExpression Limitation

**Critical Point**: DynamoDB's `FilterExpression` is applied AFTER reading the data, not before. You still pay RCU for all items read, even those filtered out.

**Example with Numbers**:
- Host has 1000 total engagements
- 50 are ACTIVE, 900 are COMPLETED, 50 are ARCHIVED
- Dashboard wants to show only ACTIVE engagements

**Option A Cost**: 
- Read 50 items (ACTIVE partition)
- RCU: ~10 units
- Network: 50 items transferred

**Option B Cost**:
- Read 1000 items, filter to 50
- RCU: ~200 units (20x more expensive!)
- Network: 1000 items transferred, 950 discarded

---

## 3. When Status in PK Doesn't Help

### 3.1 Small Datasets
**Scenario**: Host with only 10 total engagements

```javascript
// Option A: Multiple queries needed for "all engagements"
const [active, completed, archived] = await Promise.all([
  dynamodb.query({ KeyConditionExpression: 'PK = :pk', ExpressionAttributeValues: { ':pk': 'HOST#user123#ACTIVE' } }),
  dynamodb.query({ KeyConditionExpression: 'PK = :pk', ExpressionAttributeValues: { ':pk': 'HOST#user123#COMPLETED' } }),
  dynamodb.query({ KeyConditionExpression: 'PK = :pk', ExpressionAttributeValues: { ':pk': 'HOST#user123#ARCHIVED' } })
]);

// 3 API calls for 10 total items

// Option B: Single query
const allEngagements = await dynamodb.query({
  KeyConditionExpression: 'PK = :pk',
  ExpressionAttributeValues: { ':pk': 'HOST#user123' }
});

// 1 API call for 10 items
```

**Analysis**: For small datasets, the overhead of multiple queries outweighs the filtering benefit.

### 3.2 Even Status Distribution
**Scenario**: Host with 100 ACTIVE, 100 COMPLETED, 100 ARCHIVED

If you frequently need "all engagements", Option A requires 3 queries vs 1 query for Option B. The benefit diminishes when status distribution is even and you often need all statuses.

---

## 4. Real-World Usage Patterns

### 4.1 Typical Host Dashboard Needs

**Primary Use Cases** (90% of queries):
1. Show active engagements only
2. Show recent completed engagements (last 10)
3. Show engagement history with pagination

**Secondary Use Cases** (10% of queries):
1. Show all engagements across all statuses
2. Search engagements by title
3. Analytics across all engagements

### 4.2 Status Distribution Reality

**Typical Host Profile**:
- **ACTIVE**: 2-5 engagements (current sessions)
- **COMPLETED**: 50-500 engagements (historical)
- **ARCHIVED**: 100-1000+ engagements (old data)

**Key Insight**: ACTIVE is a tiny fraction of total engagements, making status partitioning very beneficial for the primary use case.

---

## 5. Decision Matrix

### Use Status in Partition Key When:
✅ **Primary queries filter by status** (dashboard showing active only)  
✅ **Uneven status distribution** (few active, many completed)  
✅ **Large total datasets** (>100 engagements per host)  
✅ **Cost optimization priority** (RCU efficiency matters)  

### Don't Use Status in Partition Key When:
❌ **Frequently need all statuses** (analytics, full history views)  
❌ **Small total datasets** (<50 engagements per host)  
❌ **Even status distribution** (similar counts across statuses)  
❌ **Complex cross-status queries** (search, advanced filtering)  

---

## 6. Alternative Hybrid Approach

### Option C: Hybrid Strategy
```
// Keep simple partitioning for small/medium hosts
PK: HOST#userId
SK: ENGAGEMENT#engagementId#timestamp
Attributes: Status, Title, etc.

// Use application logic to decide query strategy
async function getHostEngagements(userId, status = null, limit = null) {
  const hostStats = await getHostStats(userId); // cached stats
  
  if (hostStats.totalEngagements < 100) {
    // Small dataset: query all and filter in app
    const all = await queryAllEngagements(userId);
    return status ? all.filter(e => e.Status === status) : all;
  } else {
    // Large dataset: use status-specific partitions
    if (status) {
      return await queryByStatus(userId, status, limit);
    } else {
      // Multiple queries for all statuses
      return await queryAllStatuses(userId, limit);
    }
  }
}
```

---

## 7. Recommendation for Your Platform

### For Meeting Engagements Platform:

**Use Status in Partition Key** because:

1. **Primary Use Case**: Host dashboard showing active engagements (90% of queries)
2. **Uneven Distribution**: Most hosts have 2-5 active, 50+ completed
3. **Cost Efficiency**: Dramatic RCU savings for primary use case
4. **Scalability**: Works well as hosts create more engagements over time

**Implementation**:
```
PK: HOST#userId#ACTIVE     (2-5 items typically)
PK: HOST#userId#COMPLETED  (50-500 items typically)  
PK: HOST#userId#ARCHIVED   (100+ items typically)
```

**Query Patterns**:
```javascript
// Primary: Dashboard active engagements (fast, cheap)
const active = await query('HOST#user123#ACTIVE');

// Secondary: Recent history (fast, targeted)
const recent = await query('HOST#user123#COMPLETED', { limit: 10, reverse: true });

// Tertiary: All engagements (multiple queries, but rare)
const all = await Promise.all([
  query('HOST#user123#ACTIVE'),
  query('HOST#user123#COMPLETED'), 
  query('HOST#user123#ARCHIVED')
]);
```

---

## 8. The Bottom Line

**Status in partition key helps when**:
- You frequently query by status (which you do for dashboards)
- Status distribution is uneven (which it is - few active, many completed)
- Dataset size is large enough that filtering matters (which it will be)

**The benefit**: Transform expensive filtered queries into cheap targeted queries, especially important as the platform scales and hosts accumulate engagement history.

For your platform, this optimization will provide significant cost savings and performance improvements for the most common use case (host dashboard), while the occasional "all engagements" query can use multiple targeted queries which is still efficient.
