# Archive System Security and Permissions

## Current Security Model

### Phase 1: Same-Account Operation (Current Implementation)
The archive system currently operates within the same AWS account and uses existing security infrastructure.

#### Security Components ✅
- **DynamoDB Permissions** - Inherits from existing admin function policies
- **API Gateway** - Uses existing CORS and request validation
- **Lambda IAM Roles** - Standard admin function permissions
- **Single-Table Access** - Operates on existing `GameTable`

#### Access Control
- **Admin-Only Access** - Archive functions only available in Admin interface
- **Environment Isolation** - Each environment (dev/test/prod) has separate archives
- **No Cross-Account** - All operations within same AWS account

## Future Security Enhancements (Planned)

### Phase 2: Cross-Environment MTLS Security

#### Mutual TLS (MTLS) Authentication
```yaml
# Certificate-based authentication between environments
ClientCertificate:
  Type: AWS::CertificateManager::Certificate
  Properties:
    DomainName: !Sub 'archive-client-${Environment}.${DomainName}'
    ValidationMethod: DNS
    
ServerCertificate:
  Type: AWS::CertificateManager::Certificate  
  Properties:
    DomainName: !Sub 'archive-server-${Environment}.${DomainName}'
    ValidationMethod: DNS
```

#### API Gateway Client Certificates
```yaml
ClientCertificate:
  Type: AWS::ApiGateway::ClientCertificate
  Properties:
    Description: !Sub 'Archive client certificate for ${Environment}'
    
# Configure MTLS on API Gateway
ApiGatewayDomainName:
  Type: AWS::ApiGateway::DomainName
  Properties:
    MutualTlsAuthentication:
      TruststoreUri: !Sub 's3://${TruststoreBucket}/truststore.pem'
```

### Phase 3: Cross-Account Archive Access

#### Cross-Account IAM Roles
```yaml
CrossAccountArchiveRole:
  Type: AWS::IAM::Role
  Properties:
    AssumeRolePolicyDocument:
      Version: '2012-10-17'
      Statement:
        - Effect: Allow
          Principal:
            AWS: 
              - !Sub 'arn:aws:iam::${TrustedAccountId}:root'
          Action: sts:AssumeRole
          Condition:
            StringEquals:
              'sts:ExternalId': !Ref ExternalId
    Policies:
      - PolicyName: ArchiveAccess
        PolicyDocument:
          Version: '2012-10-17'
          Statement:
            - Effect: Allow
              Action:
                - dynamodb:Query
                - dynamodb:GetItem
                - dynamodb:PutItem
                - dynamodb:UpdateItem
                - dynamodb:DeleteItem
              Resource: !GetAtt ArchiveTable.Arn
```

#### Resource-Based Policies
```yaml
ArchiveTableResourcePolicy:
  Type: AWS::DynamoDB::ResourcePolicy
  Properties:
    TableName: !Ref ArchiveTable
    PolicyDocument:
      Version: '2012-10-17'
      Statement:
        - Effect: Allow
          Principal:
            AWS: !Sub 'arn:aws:iam::${TrustedAccountId}:role/ArchiveClientRole'
          Action:
            - dynamodb:Query
            - dynamodb:GetItem
          Resource: !Sub '${ArchiveTable}/index/*'
```

## Permission Models

### Model 1: Shared Archive Account (Recommended)
```
┌─────────────┐    ┌─────────────────────┐    ┌─────────────┐
│   Dev Env   │───▶│   Archive Account   │◀───│  Prod Env   │
│             │    │                     │    │             │
│ - Assume    │    │ - Central Archives  │    │ - Assume    │
│   Role      │    │ - MTLS Gateway      │    │   Role      │
│ - MTLS      │    │ - Audit Logging     │    │ - MTLS      │
│   Client    │    │ - Access Control    │    │   Client    │
└─────────────┘    └─────────────────────┘    └─────────────┘
```

**Benefits:**
- Centralized archive management
- Single source of truth for all environments
- Simplified audit and compliance
- Cost-effective storage

**Configuration:**
```yaml
Parameters:
  ArchiveAccountId:
    Type: String
    Description: AWS Account ID for centralized archives
    
  CrossAccountRoleArn:
    Type: String
    Description: ARN of role to assume for archive access
```

### Model 2: Federated Archives (Future)
```
┌──────────────────────────────────────────────────────────────┐
│                    Archive Federation                        │
├─────────────┬─────────────────────┬─────────────────────────┤
│   Dev Env   │     Test Env        │       Prod Env          │
│             │                     │                         │
│ - Local     │   - Local Archives  │   - Local Archives      │
│   Archives  │   - Sync to Fed     │   - Sync to Fed         │
│ - Fed Sync  │   - Cross-Env Sync  │   - Master Archives     │
└─────────────┴─────────────────────┴─────────────────────────┘
```

## Security Implementation Steps

### Phase 1: Current Implementation (No Changes Needed)
```yaml
# Archive functions inherit existing admin permissions
AdminArchiveFunction:
  Type: AWS::Serverless::Function
  Properties:
    Policies:
      - DynamoDBCrudPolicy:
          TableName: !Ref GameTable
```

### Phase 2: Enhanced Security (6-8 weeks)

#### 1. API Key Authentication
```yaml
ApiKey:
  Type: AWS::ApiGateway::ApiKey
  Properties:
    Name: !Sub '${StackName}-archive-key'
    Description: Archive system API key
    Enabled: true

UsagePlan:
  Type: AWS::ApiGateway::UsagePlan
  Properties:
    UsagePlanName: !Sub '${StackName}-archive-usage'
    ApiStages:
      - ApiId: !Ref RestApi
        Stage: !Ref Environment
    Throttle:
      RateLimit: 100
      BurstLimit: 200
```

#### 2. Environment-Specific Access
```yaml
# Archive access permissions by environment
ArchiveAccessRole:
  Type: AWS::IAM::Role
  Properties:
    RoleName: !Sub '${StackName}-archive-access'
    AssumeRolePolicyDocument:
      Version: '2012-10-17'
      Statement:
        - Effect: Allow
          Principal:
            Service: lambda.amazonaws.com
          Action: sts:AssumeRole
        - Effect: Allow
          Principal:
            AWS: !Sub 'arn:aws:iam::${AWS::AccountId}:root'
          Action: sts:AssumeRole
          Condition:
            StringEquals:
              'aws:PrincipalTag/Environment': !Ref Environment
```

#### 3. Audit Logging
```yaml
ArchiveAuditLog:
  Type: AWS::Logs::LogGroup
  Properties:
    LogGroupName: !Sub '/aws/lambda/${StackName}-archive-audit'
    RetentionInDays: 90

# Lambda function for audit logging
ArchiveAuditFunction:
  Type: AWS::Serverless::Function
  Properties:
    Handler: audit-logger.handler
    Environment:
      Variables:
        AUDIT_LOG_GROUP: !Ref ArchiveAuditLog
    Events:
      DynamoDBStream:
        Type: DynamoDB
        Properties:
          Stream: !GetAtt GameTable.StreamArn
          StartingPosition: TRIM_HORIZON
          FilterCriteria:
            Filters:
              - Pattern: '{"eventName": ["INSERT", "MODIFY", "REMOVE"], "dynamodb": {"Keys": {"PK": {"S": [{"prefix": "ARCHIVE#"}]}}}}'
```

### Phase 3: Cross-Account Access (Future)

#### 1. Dedicated Archive Account
- Separate AWS account for all archives
- Cross-account IAM roles and policies
- Centralized billing and governance

#### 2. MTLS Implementation  
- Certificate-based authentication
- Client certificate validation
- Encrypted transport layer

## Security Best Practices

### Data Protection
- **Encryption at Rest** - DynamoDB encryption enabled
- **Encryption in Transit** - HTTPS/TLS for all API calls
- **Access Logging** - CloudTrail integration for audit trails
- **Data Classification** - Tag archives with sensitivity levels

### Access Control
- **Principle of Least Privilege** - Minimal required permissions
- **Time-Based Access** - Temporary credentials where possible
- **Multi-Factor Authentication** - For sensitive archive operations
- **IP Restrictions** - Limit access to known networks

### Compliance
- **SOC 2 Type II** - Audit trails for all archive operations
- **GDPR Compliance** - Data retention and deletion policies
- **Industry Standards** - Follow AWS security best practices

## Current Security Status

✅ **Implemented**
- Basic admin-only access control
- DynamoDB encryption at rest
- HTTPS transport encryption
- CloudTrail audit logging (existing)

❌ **Planned Enhancements**
- API key authentication
- MTLS client certificates
- Cross-account access controls
- Dedicated audit logging
- Role-based access control

## Security Testing

### Phase 1: Basic Security Testing
```bash
# Test unauthorized access
curl -X GET https://api.dev.seibtribe.us/admin/archives
# Should require admin authentication

# Test CORS policies
curl -H "Origin: https://malicious-site.com" \
     https://api.dev.seibtribe.us/admin/archives
# Should reject unauthorized origins
```

### Phase 2: Enhanced Security Testing
- Penetration testing of API endpoints
- Certificate validation testing
- Cross-account access verification
- Audit log completeness validation

The current implementation provides basic security suitable for same-account operations. Enhanced security features will be implemented in future phases as requirements evolve.