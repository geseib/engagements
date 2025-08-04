# Archive System - Serverless Architecture

## Overview

The Engage2 Archive System is a serverless content management service built with AWS Lambda, DynamoDB, and S3. It provides a centralized repository for storing and managing question sets, documents, templates, and reports across all environments (dev/test/prod).

## Architecture

### Infrastructure Components

1. **AWS Lambda Functions**
   - `list-archive.js` - List and filter archive items
   - `get-archive-item.js` - Retrieve specific item with download URL
   - `upload-archive.js` - Upload new content to archive
   - `update-archive.js` - Update metadata for existing items
   - `delete-archive.js` - Remove items from archive
   - `search-archive.js` - Full-text search across archive

2. **DynamoDB Table**
   - Table Name: `engage2-archive`
   - Partition Key: `PK` (always "ARCHIVE")
   - Sort Key: `SK` (format: `ITEM#${archiveId}`)
   - Stores metadata, not actual content

3. **S3 Bucket**
   - Bucket Name: `engage2-archive-content`
   - Stores actual file content
   - Versioning enabled
   - Lifecycle rules for old versions

4. **API Gateway**
   - HTTP API: `engage2-archive-api`
   - Stage: `v1`
   - CORS enabled for all origins (configurable)

5. **CloudFront Distribution**
   - Domain: `archive.seibtribe.us`
   - SSL certificate from ACM
   - Caching optimized for API responses

## Deployment

### Prerequisites
- AWS CLI configured
- SAM CLI installed
- Valid AWS credentials

### Deploy Archive Service
```bash
# Deploy the archive service (one-time setup)
./scripts/deploy-archive.sh
```

This creates a separate CloudFormation stack: `engage2-archive-service`

### Configuration
After deployment, a configuration file is created at `config/archive-service.json`:
```json
{
  "archiveServiceUrl": "https://archive.seibtribe.us",
  "archiveApiUrl": "https://{api-id}.execute-api.us-east-1.amazonaws.com/v1",
  "tableName": "engage2-archive",
  "bucketName": "engage2-archive-content"
}
```

## API Endpoints

### List Archive Items
```
GET /archive/items?type={type}&category={category}
```

### Get Archive Item
```
GET /archive/items/{archiveId}
```
Returns metadata and a presigned S3 URL for downloading content.

### Upload Archive Item
```
POST /archive/items
Content-Type: application/json

{
  "title": "Question Set Title",
  "description": "Optional description",
  "content": "CSV or JSON content",
  "contentType": "questionset",
  "category": "business",
  "tags": ["leadership", "strategy"]
}
```

### Update Archive Item
```
PUT /archive/items/{archiveId}
Content-Type: application/json

{
  "title": "Updated Title",
  "description": "Updated description",
  "category": "education",
  "tags": ["updated", "tags"]
}
```

### Delete Archive Item
```
DELETE /archive/items/{archiveId}
```

### Search Archive
```
POST /archive/search
Content-Type: application/json

{
  "query": "leadership",
  "filters": {
    "contentType": "questionset",
    "category": "business",
    "dateFrom": "2024-01-01",
    "dateTo": "2024-12-31"
  },
  "limit": 50
}
```

## Integration with Main Application

### Frontend Integration

1. **Import Archive Config**
```javascript
import { archiveService } from './config/archive-config';
```

2. **Use Archive Service**
```javascript
// List items
const items = await archiveService.listItems({ type: 'questionset' });

// Upload new item
await archiveService.uploadItem({
  title: 'My Question Set',
  content: csvContent,
  contentType: 'questionset'
});

// Download item
const item = await archiveService.getItem(archiveId);
window.open(item.downloadUrl, '_blank');
```

3. **Add Archive Panel to Admin Page**
```javascript
import ArchivePanel from './components/ArchivePanel';

// In AdminPage.jsx
<ArchivePanel onQuestionSetImport={handleQuestionSetImport} />
```

## Data Model

### DynamoDB Item Structure
```javascript
{
  PK: "ARCHIVE",
  SK: "ITEM#uuid",
  ArchiveId: "uuid",
  Title: "Question Set Title",
  Description: "Description text",
  ContentType: "questionset|document|template|report",
  Category: "general|business|education|entertainment|technology",
  Tags: ["tag1", "tag2"],
  FileName: "original-filename.csv",
  S3Key: "archive/questionset/uuid.csv",
  FileSize: 12345,
  UploadedBy: "user-id",
  CreatedAt: "2024-01-01T00:00:00Z",
  UpdatedAt: "2024-01-01T00:00:00Z",
  Version: 1,
  Status: "active"
}
```

### S3 Storage Structure
```
engage2-archive-content/
├── archive/
│   ├── questionset/
│   │   ├── uuid1.csv
│   │   └── uuid2.csv
│   ├── document/
│   │   └── uuid3.txt
│   ├── template/
│   │   └── uuid4.json
│   └── report/
│       └── uuid5.pdf
```

## Security Considerations

1. **CORS Configuration**
   - Currently allows all origins (`*`)
   - Should be restricted to specific domains in production

2. **Authentication**
   - Currently no authentication required
   - Can add API Gateway authorizers for security

3. **S3 Access**
   - Content accessed via presigned URLs (1-hour expiration)
   - Direct S3 access blocked by bucket policies

4. **IAM Permissions**
   - Lambda functions have minimal required permissions
   - Each function can only access specific operations

## Monitoring & Maintenance

### CloudWatch Logs
- Log Group: `/aws/lambda/engage2-archive-*`
- Each Lambda function has its own log stream

### Metrics to Monitor
- API Gateway request count and latency
- Lambda function duration and errors
- DynamoDB read/write capacity
- S3 storage usage

### Backup Strategy
- DynamoDB: Point-in-time recovery enabled
- S3: Versioning enabled, cross-region replication recommended

## Cost Optimization

1. **DynamoDB**: Using on-demand billing (pay per request)
2. **S3**: Lifecycle rules to delete old versions after 90 days
3. **Lambda**: Minimal memory allocation (128MB) for most functions
4. **API Gateway**: HTTP API (cheaper than REST API)

## Future Enhancements

1. **Authentication & Authorization**
   - Add Cognito or custom authorizer
   - Role-based access control

2. **Advanced Search**
   - Elasticsearch integration for better search
   - Tag-based filtering

3. **Bulk Operations**
   - Batch upload/download
   - Import/export functionality

4. **Analytics**
   - Usage tracking
   - Popular content insights

5. **Multi-tenancy**
   - Organization-based isolation
   - Shared vs private archives