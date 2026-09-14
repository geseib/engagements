# Data Lifecycle Management - Tiered TTL and Retention Strategy

## Overview

This document defines a comprehensive data lifecycle management strategy with configurable retention periods, automatic PDF report generation, and S3 lifecycle policies for the Meeting Engagements Platform.

---

## 1. Tiered TTL Strategy

### 1.1 Engagement Lifecycle Phases

```
INIT → JOINING → ACTIVE → COMPLETED → ARCHIVED → DELETED
 ↓       ↓        ↓         ↓          ↓         ↓
30d     30d      7d       PDF+30d    PDF+90d   Gone
```

### 1.2 TTL Configuration by Phase

#### Phase 1: Initialized Engagements (INIT/JOINING)
```
TTL: 30 days from creation
Rationale: Hosts may create engagements in advance, need time to prepare
Configurable: SYSTEM_SETTINGS.INIT_ENGAGEMENT_TTL_DAYS
Default: 30 days
```

#### Phase 2: Active Engagements (ACTIVE)
```
TTL: 7 days from start
Rationale: Active sessions should complete quickly, extended TTL for technical issues
Configurable: SYSTEM_SETTINGS.ACTIVE_ENGAGEMENT_TTL_DAYS  
Default: 7 days
```

#### Phase 3: Completed Engagements (COMPLETED)
```
TTL: 30 days from completion
Action: Generate PDF report before deletion
Configurable: SYSTEM_SETTINGS.COMPLETED_ENGAGEMENT_TTL_DAYS
Default: 30 days
```

#### Phase 4: PDF Reports (S3)
```
S3 Lifecycle: 90 days from creation
Action: Automatic deletion via S3 lifecycle policy
Configurable: SYSTEM_SETTINGS.REPORT_RETENTION_DAYS
Default: 90 days
```

---

## 2. Enhanced DynamoDB Schema with TTL

### 2.1 TTL Field Strategy

```javascript
// Dynamic TTL calculation based on engagement phase
function calculateTTL(engagement) {
  const now = Date.now();
  const settings = getSystemSettings();
  
  switch (engagement.Phase) {
    case 'INIT':
    case 'JOINING':
      return Math.floor((now + (settings.INIT_ENGAGEMENT_TTL_DAYS * 24 * 60 * 60 * 1000)) / 1000);
    
    case 'ACTIVE':
      return Math.floor((now + (settings.ACTIVE_ENGAGEMENT_TTL_DAYS * 24 * 60 * 60 * 1000)) / 1000);
    
    case 'COMPLETED':
      return Math.floor((now + (settings.COMPLETED_ENGAGEMENT_TTL_DAYS * 24 * 60 * 60 * 1000)) / 1000);
    
    default:
      return Math.floor((now + (7 * 24 * 60 * 60 * 1000)) / 1000); // Default 7 days
  }
}
```

### 2.2 Updated Schema with TTL Management

```
PK: ENGAGEMENT#engagementId
SK: METADATA
Attributes: {
  Title, EngagementType, HostId, SetId, CreatedAt, Phase,
  TTL: calculateTTL(engagement),
  ReportGenerated: false,
  ReportS3Key: null,
  PhaseHistory: [
    { phase: 'INIT', timestamp: '2024-01-15T10:00:00Z' },
    { phase: 'ACTIVE', timestamp: '2024-01-15T14:00:00Z' },
    { phase: 'COMPLETED', timestamp: '2024-01-15T15:30:00Z' }
  ]
}
```

---

## 3. System Settings Configuration

### 3.1 Settings Schema

```
PK: SYSTEM_SETTINGS
SK: RETENTION_POLICY
Attributes: {
  INIT_ENGAGEMENT_TTL_DAYS: 30,
  ACTIVE_ENGAGEMENT_TTL_DAYS: 7,
  COMPLETED_ENGAGEMENT_TTL_DAYS: 30,
  REPORT_RETENTION_DAYS: 90,
  AUTO_GENERATE_REPORTS: true,
  REPORT_FORMAT: 'PDF',
  REPORT_TEMPLATE: 'standard',
  NOTIFICATION_BEFORE_DELETION_DAYS: 7,
  ALLOW_HOST_EXTENSION: true,
  MAX_EXTENSION_DAYS: 30,
  UpdatedAt: '2024-01-15T10:00:00Z',
  UpdatedBy: 'admin@platform.com'
}
```

### 3.2 Settings Management API

```javascript
// Get current retention settings
async function getRetentionSettings() {
  const result = await dynamodb.get({
    TableName: 'meeting-engagements-table',
    Key: {
      PK: 'SYSTEM_SETTINGS',
      SK: 'RETENTION_POLICY'
    }
  }).promise();
  
  return result.Item || getDefaultSettings();
}

// Update retention settings (admin only)
async function updateRetentionSettings(newSettings, adminUserId) {
  const currentSettings = await getRetentionSettings();
  
  const updatedSettings = {
    ...currentSettings,
    ...newSettings,
    UpdatedAt: new Date().toISOString(),
    UpdatedBy: adminUserId
  };
  
  await dynamodb.put({
    TableName: 'meeting-engagements-table',
    Item: {
      PK: 'SYSTEM_SETTINGS',
      SK: 'RETENTION_POLICY',
      ...updatedSettings
    }
  }).promise();
  
  // Trigger TTL recalculation for existing engagements
  await triggerTTLUpdate();
}
```

---

## 4. Automatic PDF Report Generation

### 4.1 Report Generation Pipeline

#### DynamoDB Streams → Lambda → PDF Generation
```javascript
// Lambda function triggered when engagement moves to COMPLETED
exports.handleEngagementCompletion = async (event) => {
  for (const record of event.Records) {
    if (record.eventName === 'MODIFY' && 
        record.dynamodb.NewImage.Phase?.S === 'COMPLETED' &&
        record.dynamodb.OldImage.Phase?.S !== 'COMPLETED') {
      
      const engagementId = record.dynamodb.Keys.PK.S.split('#')[1];
      await generateEngagementReport(engagementId);
    }
  }
};

async function generateEngagementReport(engagementId) {
  try {
    // 1. Gather all engagement data
    const engagementData = await gatherEngagementData(engagementId);
    
    // 2. Generate PDF report
    const pdfBuffer = await generatePDFReport(engagementData);
    
    // 3. Upload to S3 with lifecycle policy
    const s3Key = `reports/${engagementId}/${Date.now()}-engagement-report.pdf`;
    await uploadReportToS3(pdfBuffer, s3Key);
    
    // 4. Update engagement record
    await updateEngagementWithReport(engagementId, s3Key);
    
    // 5. Notify host (optional)
    await notifyHostReportReady(engagementData.HostId, s3Key);
    
  } catch (error) {
    console.error(`Failed to generate report for ${engagementId}:`, error);
    await logReportGenerationFailure(engagementId, error);
  }
}
```

### 4.2 PDF Report Structure

```javascript
async function generatePDFReport(engagementData) {
  const doc = new PDFDocument();
  
  // Header
  doc.fontSize(20).text('Engagement Report', 50, 50);
  doc.fontSize(12).text(`Generated: ${new Date().toLocaleDateString()}`, 50, 80);
  
  // Engagement Summary
  doc.fontSize(16).text('Engagement Summary', 50, 120);
  doc.fontSize(12)
     .text(`Title: ${engagementData.title}`, 50, 150)
     .text(`Type: ${engagementData.type}`, 50, 170)
     .text(`Host: ${engagementData.hostName}`, 50, 190)
     .text(`Duration: ${engagementData.duration} minutes`, 50, 210)
     .text(`Participants: ${engagementData.participantCount}`, 50, 230);
  
  // Participation Summary
  doc.fontSize(16).text('Participation Summary', 50, 270);
  engagementData.participants.forEach((participant, index) => {
    const y = 300 + (index * 20);
    doc.fontSize(12).text(`${participant.name}: ${participant.score} points`, 50, y);
  });
  
  // Response Analysis (if available)
  if (engagementData.aiSummary) {
    doc.addPage();
    doc.fontSize(16).text('AI Analysis', 50, 50);
    doc.fontSize(12).text(engagementData.aiSummary, 50, 80, { width: 500 });
  }
  
  // Detailed Results
  doc.addPage();
  doc.fontSize(16).text('Detailed Results', 50, 50);
  // Add question-by-question breakdown
  
  return doc;
}
```

---

## 5. S3 Lifecycle Management

### 5.1 S3 Bucket Configuration

```yaml
# CloudFormation template for reports bucket
ReportsBucket:
  Type: AWS::S3::Bucket
  Properties:
    BucketName: !Sub '${AWS::StackName}-engagement-reports'
    LifecycleConfiguration:
      Rules:
        - Id: DeleteReportsAfterRetentionPeriod
          Status: Enabled
          ExpirationInDays: !Ref ReportRetentionDays
          NoncurrentVersionExpirationInDays: 1
    VersioningConfiguration:
      Status: Enabled
    PublicAccessBlockConfiguration:
      BlockPublicAcls: true
      BlockPublicPolicy: true
      IgnorePublicAcls: true
      RestrictPublicBuckets: true
    NotificationConfiguration:
      LambdaConfigurations:
        - Event: s3:ObjectCreated:*
          Function: !GetAtt ReportProcessorFunction.Arn
```

### 5.2 Dynamic Lifecycle Policy Updates

```javascript
// Update S3 lifecycle policy when retention settings change
async function updateS3LifecyclePolicy(newRetentionDays) {
  const s3 = new AWS.S3();
  
  const lifecycleConfig = {
    Rules: [
      {
        ID: 'DeleteReportsAfterRetentionPeriod',
        Status: 'Enabled',
        Expiration: {
          Days: newRetentionDays
        },
        Filter: {
          Prefix: 'reports/'
        }
      }
    ]
  };
  
  await s3.putBucketLifecycleConfiguration({
    Bucket: process.env.REPORTS_BUCKET,
    LifecycleConfiguration: lifecycleConfig
  }).promise();
}
```

---

## 6. TTL Update Management

### 6.1 Phase Transition TTL Updates

```javascript
// Update TTL when engagement phase changes
async function updateEngagementPhase(engagementId, newPhase) {
  const settings = await getRetentionSettings();
  const newTTL = calculateTTL({ Phase: newPhase });
  
  await dynamodb.update({
    TableName: 'meeting-engagements-table',
    Key: {
      PK: `ENGAGEMENT#${engagementId}`,
      SK: 'METADATA'
    },
    UpdateExpression: 'SET Phase = :phase, TTL = :ttl, PhaseHistory = list_append(PhaseHistory, :history)',
    ExpressionAttributeValues: {
      ':phase': newPhase,
      ':ttl': newTTL,
      ':history': [{
        phase: newPhase,
        timestamp: new Date().toISOString()
      }]
    }
  }).promise();
}
```

### 6.2 Bulk TTL Recalculation

```javascript
// Recalculate TTL for all engagements when settings change
async function recalculateAllTTLs() {
  const settings = await getRetentionSettings();
  
  // Use DynamoDB Streams or batch processing
  const engagements = await scanAllEngagements(); // Implement with pagination
  
  const batchUpdates = engagements.map(engagement => ({
    Update: {
      TableName: 'meeting-engagements-table',
      Key: {
        PK: engagement.PK,
        SK: engagement.SK
      },
      UpdateExpression: 'SET TTL = :ttl',
      ExpressionAttributeValues: {
        ':ttl': calculateTTL(engagement)
      }
    }
  }));
  
  // Process in batches of 25 (DynamoDB limit)
  await processBatchUpdates(batchUpdates);
}
```

---

## 7. Host Notifications and Extensions

### 7.1 Pre-deletion Notifications

```javascript
// Daily Lambda to check for engagements nearing deletion
exports.checkExpiringEngagements = async (event) => {
  const settings = await getRetentionSettings();
  const notificationThreshold = settings.NOTIFICATION_BEFORE_DELETION_DAYS;
  
  const expiringEngagements = await findExpiringEngagements(notificationThreshold);
  
  for (const engagement of expiringEngagements) {
    await sendExpirationNotification(engagement);
  }
};

async function sendExpirationNotification(engagement) {
  const message = {
    to: engagement.HostEmail,
    subject: 'Engagement Data Expiring Soon',
    body: `Your engagement "${engagement.Title}" will be automatically deleted in ${engagement.DaysUntilExpiration} days. Download your report now or request an extension.`,
    actions: [
      { label: 'Download Report', url: `${BASE_URL}/reports/${engagement.ReportS3Key}` },
      { label: 'Request Extension', url: `${BASE_URL}/extend/${engagement.EngagementId}` }
    ]
  };
  
  await sendEmail(message);
}
```

### 7.2 Host-Requested Extensions

```javascript
// Allow hosts to extend retention (if enabled in settings)
async function requestRetentionExtension(engagementId, hostId, extensionDays) {
  const settings = await getRetentionSettings();
  
  if (!settings.ALLOW_HOST_EXTENSION) {
    throw new Error('Host extensions not allowed');
  }
  
  if (extensionDays > settings.MAX_EXTENSION_DAYS) {
    throw new Error(`Extension cannot exceed ${settings.MAX_EXTENSION_DAYS} days`);
  }
  
  const engagement = await getEngagement(engagementId);
  
  if (engagement.HostId !== hostId) {
    throw new Error('Unauthorized: Not engagement owner');
  }
  
  const currentTTL = engagement.TTL;
  const extensionSeconds = extensionDays * 24 * 60 * 60;
  const newTTL = currentTTL + extensionSeconds;
  
  await dynamodb.update({
    TableName: 'meeting-engagements-table',
    Key: {
      PK: `ENGAGEMENT#${engagementId}`,
      SK: 'METADATA'
    },
    UpdateExpression: 'SET TTL = :ttl, ExtensionHistory = list_append(if_not_exists(ExtensionHistory, :empty), :extension)',
    ExpressionAttributeValues: {
      ':ttl': newTTL,
      ':empty': [],
      ':extension': [{
        extensionDays,
        requestedAt: new Date().toISOString(),
        requestedBy: hostId
      }]
    }
  }).promise();
}
```

---

## 8. Implementation Timeline

### Phase 1: Core TTL Management (Week 1)
- [ ] Implement tiered TTL calculation
- [ ] Add system settings schema
- [ ] Update engagement phase transitions
- [ ] Test TTL updates

### Phase 2: PDF Report Generation (Week 2)
- [ ] Build PDF generation pipeline
- [ ] Implement S3 upload with lifecycle
- [ ] Add report metadata to engagements
- [ ] Test end-to-end report flow

### Phase 3: Advanced Features (Week 3)
- [ ] Host notification system
- [ ] Extension request functionality
- [ ] Bulk TTL recalculation
- [ ] Admin settings interface

### Phase 4: Monitoring and Optimization (Week 4)
- [ ] CloudWatch metrics for retention
- [ ] Cost monitoring for S3 storage
- [ ] Performance optimization
- [ ] Documentation and training

This comprehensive data lifecycle management ensures proper data retention, cost optimization, and regulatory compliance while providing flexibility for different use cases.
