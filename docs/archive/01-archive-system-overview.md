# Archive System Overview

## Purpose

The Archive System provides cross-environment content management for the Engage2 platform, enabling administrators to backup, share, and synchronize prompts and question sets between different deployments (dev, test, prod, or separate instances).

## Architecture

### Environment-Agnostic Design
- **Local Environment** = Current deployment (dev, test, prod, or any instance)
- **Archive** = Central content repository accessible by all environments
- **Cross-Environment Sync** = Bidirectional content transfer between any environments

### Core Components

#### 1. **Frontend Components**
- **ArchivePanel.jsx** - Split-panel interface for content management
- **ContentList.jsx** - Reusable content display component  
- **ArchiveSelector.jsx** - Archive selection and creation interface
- **ArchivePanel.css** - Complete responsive styling

#### 2. **Backend Lambda Functions** (Serverless)
- **get-archives.js** - Retrieve all available archives with metadata
- **create-archive.js** - Create new archives with UUID and description
- **get-archive-content.js** - Fetch content from specific archive
- **archive-items.js** - Move items from local to archive (hash appending for conflicts)
- **download-items.js** - Copy items from archive to local (conflict resolution)
- **delete-archive-items.js** - Remove items from archives

#### 3. **Data Storage**
- **DynamoDB Single-Table Design** - Uses existing `GameTable` with archive-specific patterns
- **S3 Integration** - For large content storage (when needed)

## Key Features

### 1. **Bidirectional Content Transfer**
- **Archive** - Move content from local environment to archive
- **Download** - Copy content from archive to local environment
- **Conflict Resolution** - Automatic ID conflict handling with timestamp suffixes

### 2. **ID Management Strategy**
- **Archive Storage** - Append hash to original IDs (`originalId_abc12345`)
- **Conflict Resolution** - Generate new IDs for downloads (`originalId_copy_123456`)
- **Original ID Preservation** - Maintain `originalId` field for restoration

### 3. **Archive Metadata**
- Archive name and description
- Creation and modification timestamps
- Item counts (total, question sets, prompts)
- Archive UUID for unique identification

## DynamoDB Schema Patterns

### Archive Metadata
```
PK: ARCHIVE#{archiveId}
SK: METADATA
{
  id: UUID,
  name: "Archive Name",
  description: "Archive Description", 
  createdAt: ISO_TIMESTAMP,
  lastModified: ISO_TIMESTAMP,
  itemCount: NUMBER,
  questionSetsCount: NUMBER,
  promptsCount: NUMBER
}
```

### Archived Question Sets
```
PK: ARCHIVE#{archiveId}
SK: SET#{archivedSetId}
{
  originalId: "original-set-id",
  originalPK: "QUESTION_SETS",
  originalSK: "original-set-id",
  archivedAt: ISO_TIMESTAMP,
  ...originalSetData
}
```

### Archived Questions
```
PK: ARCHIVE#{archiveId}#SET#{archivedSetId}
SK: QUESTION#{questionId}
{
  originalPK: "QUESTION_SET#{originalSetId}",
  archivedAt: ISO_TIMESTAMP,
  ...originalQuestionData
}
```

### Archived Prompts
```
PK: ARCHIVE#{archiveId}
SK: PROMPT#{archivedPromptId}
{
  originalId: "original-prompt-id",
  originalPK: "AI_PROMPTS", 
  originalSK: "original-prompt-id",
  archivedAt: ISO_TIMESTAMP,
  ...originalPromptData
}
```

## Integration Points

### AdminPage Integration
- **Archive Tab** - New tab in admin interface
- **Launch Button** - Opens Archive Panel modal
- **Environment Context** - Shows current environment in UI

### API Integration
- **REST Endpoints** - Standard HTTP API calls to Lambda functions
- **CORS Support** - Configured for cross-origin requests
- **Error Handling** - Comprehensive error responses with details

## Security Considerations

### Current Implementation
- Uses existing DynamoDB table and permissions
- Operates within same AWS account and region
- No additional authentication required

### Future Security Enhancements (Planned)
- **MTLS (Mutual TLS)** - Certificate-based authentication between environments
- **API Keys** - Environment-specific access keys
- **Cross-Account Access** - Support for archives in different AWS accounts
- **Audit Logging** - Track all archive operations with user attribution

## Benefits

1. **Content Backup** - Preserve important prompts and question sets
2. **Environment Sync** - Transfer content between dev/test/prod
3. **Content Sharing** - Share question sets between different deployments
4. **Disaster Recovery** - Restore content from archives if needed
5. **Cross-Instance Support** - Transfer content between separate installations

## Current Status

✅ **Completed**
- Frontend components and UI
- Lambda function implementations
- DynamoDB schema design
- Conflict resolution logic
- AdminPage integration

❌ **Pending Deployment**
- SAM template additions
- API Gateway route definitions
- Production deployment
- Security enhancements

See additional documentation files for deployment instructions and security implementation details.