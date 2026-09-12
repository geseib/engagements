# AWS Account Migration Plan

## 🎯 **Migration Overview**

Moving the Engagements platform from current AWS account to a new AWS account with:
- Clean resource naming conventions
- Updated domain and hosted zone
- Rebuilt CI/CD pipeline
- Improved infrastructure organization

---

## 📊 **Current State Analysis**

### **Current Resources to Migrate:**
- **DynamoDB Table**: `engagements-dev-GameTable-*` (random suffix)
- **S3 Buckets**: Various with random suffixes
- **Lambda Functions**: Multiple with inconsistent naming
- **API Gateway**: REST and WebSocket APIs
- **CloudFormation Stacks**: `engagements-dev`, `engagements-test`, `engagements-prod`
- **Route53**: Current hosted zone and domain
- **CI/CD Pipeline**: CodePipeline, CodeBuild, GitHub integration

### **Current Domains:**
- Dev: `engagedev.sb.seibtribe.us`
- Test: `engagetest.sb.seibtribe.us`  
- Prod: `engagements.sb.seibtribe.us`

---

## 🏗️ **New Resource Naming Convention**

### **Naming Pattern:**
`{service}-{environment}-{resource-type}-{purpose}`

### **Examples:**
```
# DynamoDB Tables
engagements-dev-table-main
engagements-test-table-main
engagements-prod-table-main

# S3 Buckets
engagements-dev-bucket-frontend
engagements-dev-bucket-artifacts
engagements-test-bucket-frontend
engagements-test-bucket-artifacts
engagements-prod-bucket-frontend
engagements-prod-bucket-artifacts

# Lambda Functions
engagements-dev-lambda-websocket-connect
engagements-dev-lambda-websocket-message
engagements-dev-lambda-api-create-game
engagements-dev-lambda-api-start-question

# API Gateways
engagements-dev-api-rest
engagements-dev-api-websocket
engagements-test-api-rest
engagements-test-api-websocket

# CloudFormation Stacks
engagements-dev-infrastructure
engagements-test-infrastructure
engagements-prod-infrastructure
```

---

## 🌐 **New Domain Strategy**

### **Option 1: New Domain**
```
# Primary Domain: engagements.example.com
Dev: dev.engagements.example.com
Test: test.engagements.example.com
Prod: engagements.example.com
```

### **Option 2: Subdomain of Existing**
```
# Under existing domain: seibtribe.com
Dev: engagements-dev.seibtribe.com
Test: engagements-test.seibtribe.com
Prod: engagements.seibtribe.com
```

### **Required DNS Changes:**
- Create new Route53 hosted zone
- Update domain registrar nameservers
- Create SSL certificates for new domains
- Update CORS and frontend configurations

---

## 🚀 **Migration Steps**

### **Phase 1: Preparation (1-2 days)**
1. **New AWS Account Setup**
   - Create new AWS account
   - Set up IAM users and roles
   - Configure billing and security settings

2. **Domain and DNS Setup**
   - Register new domain (if needed)
   - Create Route53 hosted zone
   - Request SSL certificates
   - Update nameservers

3. **CI/CD Pipeline Setup**
   - Create new CodePipeline
   - Set up CodeBuild projects
   - Configure GitHub integration
   - Set up deployment permissions

### **Phase 2: Infrastructure Deployment (1 day)**
1. **Deploy Clean Templates**
   - Update CloudFormation templates with new naming
   - Deploy dev environment first
   - Test all resources and connections
   - Deploy test and prod environments

2. **Data Migration (if needed)**
   - Export data from current DynamoDB
   - Import to new DynamoDB tables
   - Verify data integrity

### **Phase 3: Application Deployment (1 day)**
1. **Frontend Deployment**
   - Update configuration for new domains
   - Deploy to new S3 buckets
   - Configure CloudFront distributions
   - Test all functionality

2. **Backend Deployment**
   - Deploy Lambda functions
   - Test API endpoints
   - Verify WebSocket connections
   - Run integration tests

### **Phase 4: DNS Cutover (1 day)**
1. **DNS Updates**
   - Update domain DNS to point to new infrastructure
   - Monitor for propagation
   - Test from multiple locations

2. **Verification**
   - Full end-to-end testing
   - Performance verification
   - Security validation

### **Phase 5: Cleanup (1 day)**
1. **Old Infrastructure**
   - Backup any remaining data
   - Delete old CloudFormation stacks
   - Clean up old resources
   - Cancel old services

---

## 📝 **Updated Template Structure**

### **New Parameter Structure:**
```yaml
Parameters:
  Environment:
    Type: String
    AllowedValues: [dev, test, prod]
    Description: Environment name
  
  ProjectName:
    Type: String
    Default: engagements
    Description: Project name for resource naming
  
  DomainName:
    Type: String
    Description: Domain name for the environment
  
  HostedZoneId:
    Type: String
    Description: Route53 hosted zone ID
```

### **Resource Naming Examples:**
```yaml
Resources:
  GameTable:
    Type: AWS::DynamoDB::Table
    Properties:
      TableName: !Sub '${ProjectName}-${Environment}-table-main'
  
  FrontendBucket:
    Type: AWS::S3::Bucket
    Properties:
      BucketName: !Sub '${ProjectName}-${Environment}-bucket-frontend'
  
  RestApi:
    Type: AWS::ApiGateway::RestApi
    Properties:
      Name: !Sub '${ProjectName}-${Environment}-api-rest'
```

---

## ⚠️ **Migration Risks and Mitigation**

### **Risks:**
1. **Downtime during DNS cutover**
2. **Data loss during migration**
3. **Configuration mismatches**
4. **SSL certificate issues**

### **Mitigation:**
1. **Blue-Green Deployment**
   - Keep old infrastructure running
   - Test new infrastructure thoroughly
   - Quick rollback capability

2. **Data Backup**
   - Full backup before migration
   - Incremental sync during migration
   - Verification scripts

3. **Testing Strategy**
   - Automated testing suite
   - Manual verification checklist
   - Performance benchmarks

---

## 📋 **Migration Checklist**

### **Pre-Migration:**
- [ ] New AWS account created and configured
- [ ] Domain and DNS setup complete
- [ ] CI/CD pipeline configured
- [ ] Templates updated with new naming
- [ ] Testing environment ready

### **Migration Day:**
- [ ] Deploy new infrastructure
- [ ] Migrate data (if applicable)
- [ ] Deploy applications
- [ ] Run integration tests
- [ ] Update DNS records
- [ ] Monitor for issues

### **Post-Migration:**
- [ ] Full functionality verification
- [ ] Performance monitoring
- [ ] Security audit
- [ ] Documentation updates
- [ ] Old infrastructure cleanup

---

## 🎯 **Success Criteria**

1. **All functionality working** in new environment
2. **Performance equal or better** than current
3. **Clean resource naming** throughout
4. **Automated CI/CD** pipeline operational
5. **Zero data loss** during migration
6. **Minimal downtime** (< 1 hour)

---

## 📞 **Next Steps**

1. **Review and approve** migration plan
2. **Set migration date** and timeline
3. **Prepare new AWS account** and domain
4. **Update templates** with new naming convention
5. **Execute migration** following this plan

---

## 🎯 **Ready-to-Deploy Assets**

### **✅ Created Files:**
- `template-clean.yaml` - Clean CloudFormation template with consistent naming
- `scripts/deploy-clean.sh` - Automated deployment script
- `cicd/pipeline-clean.yaml` - New CI/CD pipeline configuration
- `docs/migration-plan.md` - This migration plan

### **🔧 Key Features of New Infrastructure:**
- **Consistent Naming**: `{project}-{environment}-{resource-type}-{purpose}`
- **Environment Separation**: Clear dev/test/prod boundaries
- **Clean Resource Names**: No random suffixes
- **Automated Deployment**: Single script deployment
- **Proper Tagging**: All resources tagged with environment and project
- **Domain Support**: SSL certificates and CloudFront integration
- **CI/CD Ready**: Automated pipeline with manual prod approval

### **📋 Deployment Commands:**
```bash
# Deploy development environment
./scripts/deploy-clean.sh dev dev.engagements.example.com Z1234567890ABC

# Deploy test environment
./scripts/deploy-clean.sh test test.engagements.example.com Z1234567890ABC

# Deploy production environment
./scripts/deploy-clean.sh prod engagements.example.com Z1234567890ABC

# Deploy CI/CD pipeline
aws cloudformation deploy \
  --template-file cicd/pipeline-clean.yaml \
  --stack-name engagements-cicd-pipeline \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    GitHubToken=your-github-token \
    DevDomain=dev.engagements.example.com \
    TestDomain=test.engagements.example.com \
    ProdDomain=engagements.example.com \
    HostedZoneId=Z1234567890ABC
```

### **🎯 Migration Ready**
All assets are prepared and ready for deployment to the new AWS account. The migration can proceed as soon as:
1. New AWS account is set up
2. Domain and DNS are configured
3. GitHub token is obtained for CI/CD
4. Deployment commands are executed
