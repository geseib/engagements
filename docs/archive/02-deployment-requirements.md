# Archive System Deployment Requirements

## Current Status

The Archive System components are implemented but **NOT YET DEPLOYED**. The following components need to be added to the serverless infrastructure.

## Required SAM Template Additions

### 1. Lambda Functions to Add to `template-clean.yaml`

Add these 6 Lambda functions to the Resources section:

```yaml
  # Archive Management Functions
  AdminGetArchivesFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: !Sub '${StackName}-admin-get-archives'
      CodeUri: lambda-functions/admin/
      Handler: get-archives.handler
      Environment:
        Variables:
          TABLE_NAME: !Ref GameTable
      Events:
        GetArchives:
          Type: Api
          Properties:
            RestApiId: !Ref RestApi
            Path: /admin/archives
            Method: GET

  AdminCreateArchiveFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: !Sub '${StackName}-admin-create-archive'
      CodeUri: lambda-functions/admin/
      Handler: create-archive.handler
      Environment:
        Variables:
          TABLE_NAME: !Ref GameTable
      Events:
        CreateArchive:
          Type: Api
          Properties:
            RestApiId: !Ref RestApi
            Path: /admin/archives
            Method: POST

  AdminGetArchiveContentFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: !Sub '${StackName}-admin-get-archive-content'
      CodeUri: lambda-functions/admin/
      Handler: get-archive-content.handler
      Environment:
        Variables:
          TABLE_NAME: !Ref GameTable
      Events:
        GetArchiveContent:
          Type: Api
          Properties:
            RestApiId: !Ref RestApi
            Path: /admin/archives/{archiveId}/content
            Method: GET

  AdminArchiveItemsFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: !Sub '${StackName}-admin-archive-items'
      CodeUri: lambda-functions/admin/
      Handler: archive-items.handler
      Environment:
        Variables:
          TABLE_NAME: !Ref GameTable
      Events:
        ArchiveItems:
          Type: Api
          Properties:
            RestApiId: !Ref RestApi
            Path: /admin/archives/{archiveId}/items
            Method: POST

  AdminDownloadItemsFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: !Sub '${StackName}-admin-download-items'
      CodeUri: lambda-functions/admin/
      Handler: download-items.handler
      Environment:
        Variables:
          TABLE_NAME: !Ref GameTable
      Events:
        DownloadItems:
          Type: Api
          Properties:
            RestApiId: !Ref RestApi
            Path: /admin/archives/{archiveId}/download
            Method: POST

  AdminDeleteArchiveItemsFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: !Sub '${StackName}-admin-delete-archive-items'
      CodeUri: lambda-functions/admin/
      Handler: delete-archive-items.handler
      Environment:
        Variables:
          TABLE_NAME: !Ref GameTable
      Events:
        DeleteArchiveItems:
          Type: Api
          Properties:
            RestApiId: !Ref RestApi
            Path: /admin/archives/{archiveId}/items
            Method: DELETE
```

### 2. IAM Permissions

The functions need DynamoDB permissions (should inherit from existing admin functions):

```yaml
      Policies:
        - DynamoDBCrudPolicy:
            TableName: !Ref GameTable
        - Version: '2012-10-17'
          Statement:
            - Effect: Allow
              Action:
                - dynamodb:Query
                - dynamodb:GetItem
                - dynamodb:PutItem
                - dynamodb:UpdateItem
                - dynamodb:DeleteItem
                - dynamodb:TransactWrite
              Resource: !GetAtt GameTable.Arn
```

## API Endpoints Created

Once deployed, these endpoints will be available:

### Archive Management
- `GET /admin/archives` - List all archives
- `POST /admin/archives` - Create new archive
- `GET /admin/archives/{archiveId}/content` - Get archive contents

### Content Operations  
- `POST /admin/archives/{archiveId}/items` - Archive items
- `POST /admin/archives/{archiveId}/download` - Download items
- `DELETE /admin/archives/{archiveId}/items` - Delete archive items

## Deployment Commands

### 1. Build the Application
```bash
sam build -t template-clean.yaml
```

### 2. Deploy to Environments
```bash
# Deploy to dev
./scripts/deploy-clean.sh engagedev eng.dev.seibtribe.us

# Deploy to test  
./scripts/deploy-clean.sh engagetest eng.test.seibtribe.us

# Deploy to prod
./scripts/deploy-clean.sh engageprod eng.seibtribe.us
```

### 3. Frontend Deployment
```bash
# Deploy frontend with archive components
./scripts/deploy-frontend-eng.sh
```

## Frontend Requirements

### Already Implemented ✅
- **React Components** - ArchivePanel, ContentList, ArchiveSelector
- **CSS Styling** - Complete responsive design
- **AdminPage Integration** - Archive tab and modal

### Configuration Requirements
- **API Base URL** - Uses existing `window.API_BASE` configuration
- **CORS Headers** - Already configured in Lambda functions

## Database Requirements

### Uses Existing Infrastructure ✅
- **DynamoDB Table** - Uses existing `GameTable` 
- **Single-Table Design** - No schema changes required
- **Archive Patterns** - New PK/SK patterns for archive data

### No Additional Resources Needed
- No new tables required
- No GSI (Global Secondary Index) needed
- Uses existing TTL and backup configuration

## Testing After Deployment

### 1. Verify API Endpoints
```bash
# Test get archives
curl https://api.dev.seibtribe.us/admin/archives

# Test create archive
curl -X POST https://api.dev.seibtribe.us/admin/archives \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Archive","description":"Test description"}'
```

### 2. Test Frontend Integration
1. Navigate to Admin page
2. Click "Archive" tab
3. Click "Open Archive Manager"
4. Verify split-panel interface loads
5. Test archive creation and content transfer

## Current Blockers

❌ **Cannot Deploy Yet** - Need to add functions to template-clean.yaml
❌ **No API Routes** - Functions not exposed via API Gateway
❌ **Frontend Points to Non-Existent APIs** - Will get 404 errors

## Next Steps Priority

1. **High Priority** - Add Lambda functions to SAM template
2. **High Priority** - Deploy to dev environment for testing
3. **Medium Priority** - Test all archive operations end-to-end
4. **Low Priority** - Deploy to test/prod environments

Once the SAM template is updated, the archive system will be fully functional and deployable using the existing serverless infrastructure.