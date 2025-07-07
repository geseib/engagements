# Deployment and CI/CD Documentation

## Overview

This document outlines the complete CI/CD pipeline for the Meeting Engagements Platform using GitHub, AWS CodePipeline, and CodeBuild. The system implements a three-environment strategy (Dev, Test, Prod) with automated deployments for development and testing, and manual approval gates for production releases.

---

## 1. Repository Structure and Branching Strategy

### 1.1 Branch Strategy

```
main (production)
├── test (test environment)
├── dev (development environment)
└── feature/* (feature branches)
    ├── feature/new-engagement-type
    ├── feature/mobile-optimization
    └── feature/ai-improvements
```

#### Branch Policies
- **`dev`**: Automatic deployment to development environment
- **`test`**: Automatic deployment to test environment
- **`main`**: Manual approval required for production deployment
- **`feature/*`**: Pull request required to merge to `dev`

### 1.2 Repository Structure
```
meeting-engagements-platform/
├── .github/
│   └── workflows/
│       ├── dev-deploy.yml
│       ├── test-deploy.yml
│       └── prod-deploy.yml
├── deployment/
│   ├── buildspec-dev.yml
│   ├── buildspec-test.yml
│   ├── buildspec-prod.yml
│   ├── pipeline.yml
│   └── scripts/
│       ├── deploy.sh
│       ├── test.sh
│       └── rollback.sh
├── infrastructure/
│   ├── base/
│   │   ├── dynamodb.yml
│   │   ├── s3.yml
│   │   └── iam.yml
│   ├── dev/
│   │   ├── main.yml
│   │   └── parameters.json
│   ├── test/
│   │   ├── main.yml
│   │   └── parameters.json
│   └── prod/
│       ├── main.yml
│       └── parameters.json
├── frontend/
├── backend/
└── docs/
```

---

## 2. AWS CodePipeline Configuration

### 2.1 Pipeline Architecture

```yaml
# deployment/pipeline.yml
AWSTemplateFormatVersion: '2010-09-09'
Description: 'Meeting Engagements Platform CI/CD Pipeline'

Parameters:
  GitHubOwner:
    Type: String
    Default: 'georgeseib'
  GitHubRepo:
    Type: String
    Default: 'meeting-engagements-platform'
  GitHubToken:
    Type: String
    NoEcho: true
    Description: 'GitHub Personal Access Token'

Resources:
  # Development Pipeline
  DevPipeline:
    Type: AWS::CodePipeline::Pipeline
    Properties:
      Name: meeting-engagements-dev
      RoleArn: !GetAtt CodePipelineRole.Arn
      Stages:
        - Name: Source
          Actions:
            - Name: SourceAction
              ActionTypeId:
                Category: Source
                Owner: ThirdParty
                Provider: GitHub
                Version: '1'
              Configuration:
                Owner: !Ref GitHubOwner
                Repo: !Ref GitHubRepo
                Branch: dev
                OAuthToken: !Ref GitHubToken
              OutputArtifacts:
                - Name: SourceOutput
        
        - Name: Build
          Actions:
            - Name: BuildAction
              ActionTypeId:
                Category: Build
                Owner: AWS
                Provider: CodeBuild
                Version: '1'
              Configuration:
                ProjectName: !Ref DevBuildProject
              InputArtifacts:
                - Name: SourceOutput
              OutputArtifacts:
                - Name: BuildOutput
        
        - Name: Deploy
          Actions:
            - Name: DeployAction
              ActionTypeId:
                Category: Deploy
                Owner: AWS
                Provider: CloudFormation
                Version: '1'
              Configuration:
                ActionMode: CREATE_UPDATE
                StackName: meeting-engagements-dev
                TemplatePath: BuildOutput::infrastructure/dev/main.yml
                Capabilities: CAPABILITY_IAM
                RoleArn: !GetAtt CloudFormationRole.Arn
                ParameterOverrides: |
                  {
                    "Environment": "dev",
                    "DomainName": "dev.engagements.platform.com"
                  }
              InputArtifacts:
                - Name: BuildOutput

  # Test Pipeline (similar structure with test branch)
  TestPipeline:
    Type: AWS::CodePipeline::Pipeline
    Properties:
      Name: meeting-engagements-test
      # ... similar configuration for test environment

  # Production Pipeline with Manual Approval
  ProdPipeline:
    Type: AWS::CodePipeline::Pipeline
    Properties:
      Name: meeting-engagements-prod
      RoleArn: !GetAtt CodePipelineRole.Arn
      Stages:
        - Name: Source
          Actions:
            - Name: SourceAction
              ActionTypeId:
                Category: Source
                Owner: ThirdParty
                Provider: GitHub
                Version: '1'
              Configuration:
                Owner: !Ref GitHubOwner
                Repo: !Ref GitHubRepo
                Branch: main
                OAuthToken: !Ref GitHubToken
              OutputArtifacts:
                - Name: SourceOutput
        
        - Name: Build
          Actions:
            - Name: BuildAction
              ActionTypeId:
                Category: Build
                Owner: AWS
                Provider: CodeBuild
                Version: '1'
              Configuration:
                ProjectName: !Ref ProdBuildProject
              InputArtifacts:
                - Name: SourceOutput
              OutputArtifacts:
                - Name: BuildOutput
        
        - Name: ManualApproval
          Actions:
            - Name: ApprovalAction
              ActionTypeId:
                Category: Approval
                Owner: AWS
                Provider: Manual
                Version: '1'
              Configuration:
                CustomData: 'Please review the changes and approve for production deployment'
                ExternalEntityLink: 'https://test.engagements.platform.com'
        
        - Name: Deploy
          Actions:
            - Name: DeployAction
              ActionTypeId:
                Category: Deploy
                Owner: AWS
                Provider: CloudFormation
                Version: '1'
              Configuration:
                ActionMode: CREATE_UPDATE
                StackName: meeting-engagements-prod
                TemplatePath: BuildOutput::infrastructure/prod/main.yml
                Capabilities: CAPABILITY_IAM,CAPABILITY_NAMED_IAM
                RoleArn: !GetAtt CloudFormationRole.Arn
                ParameterOverrides: |
                  {
                    "Environment": "prod",
                    "DomainName": "engagements.platform.com"
                  }
              InputArtifacts:
                - Name: BuildOutput
```

### 2.2 CodeBuild Projects

#### Development Build Specification
```yaml
# deployment/buildspec-dev.yml
version: 0.2

phases:
  install:
    runtime-versions:
      nodejs: 18
    commands:
      - echo Installing dependencies...
      - npm install -g aws-cli
      - npm install
  
  pre_build:
    commands:
      - echo Logging in to Amazon ECR...
      - aws ecr get-login-password --region $AWS_DEFAULT_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_DEFAULT_REGION.amazonaws.com
      - echo Running tests...
      - npm run test:unit
      - npm run test:integration
      - echo Running security scans...
      - npm audit --audit-level moderate
  
  build:
    commands:
      - echo Build started on `date`
      - echo Building frontend applications...
      - cd frontend/builder-ui && npm run build:dev
      - cd ../user-dashboard && npm run build:dev
      - cd ../engagement-runtime && npm run build:dev
      - cd ../../
      - echo Building backend functions...
      - cd backend && npm run build
      - cd ../
      - echo Packaging CloudFormation templates...
      - aws cloudformation package --template-file infrastructure/dev/main.yml --s3-bucket $ARTIFACTS_BUCKET --output-template-file infrastructure/dev/packaged.yml
  
  post_build:
    commands:
      - echo Build completed on `date`
      - echo Uploading artifacts to S3...
      - aws s3 sync frontend/builder-ui/dist s3://$DEV_FRONTEND_BUCKET/builder-ui/
      - aws s3 sync frontend/user-dashboard/dist s3://$DEV_FRONTEND_BUCKET/user-dashboard/
      - aws s3 sync frontend/engagement-runtime/dist s3://$DEV_FRONTEND_BUCKET/engagement-runtime/

artifacts:
  files:
    - infrastructure/dev/packaged.yml
    - backend/dist/**/*
    - deployment/scripts/**/*
  name: dev-build-$(date +%Y-%m-%d-%H-%M-%S)

cache:
  paths:
    - node_modules/**/*
    - frontend/*/node_modules/**/*
    - backend/node_modules/**/*
```

#### Production Build Specification
```yaml
# deployment/buildspec-prod.yml
version: 0.2

phases:
  install:
    runtime-versions:
      nodejs: 18
    commands:
      - echo Installing dependencies...
      - npm install -g aws-cli
      - npm install
  
  pre_build:
    commands:
      - echo Running comprehensive tests...
      - npm run test:unit
      - npm run test:integration
      - npm run test:e2e
      - echo Running security and compliance checks...
      - npm audit --audit-level moderate
      - npm run lint
      - npm run security:scan
      - echo Running performance tests...
      - npm run test:performance
  
  build:
    commands:
      - echo Production build started on `date`
      - echo Building optimized frontend applications...
      - cd frontend/builder-ui && npm run build:prod
      - cd ../user-dashboard && npm run build:prod
      - cd ../engagement-runtime && npm run build:prod
      - cd ../../
      - echo Building and optimizing backend functions...
      - cd backend && npm run build:prod
      - cd ../
      - echo Generating production CloudFormation templates...
      - aws cloudformation package --template-file infrastructure/prod/main.yml --s3-bucket $ARTIFACTS_BUCKET --output-template-file infrastructure/prod/packaged.yml
      - echo Creating deployment documentation...
      - npm run docs:generate
  
  post_build:
    commands:
      - echo Production build completed on `date`
      - echo Validating build artifacts...
      - npm run validate:build
      - echo Creating deployment manifest...
      - echo '{"version":"'$(git rev-parse HEAD)'","timestamp":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","environment":"prod"}' > deployment-manifest.json

artifacts:
  files:
    - infrastructure/prod/packaged.yml
    - backend/dist/**/*
    - frontend/*/dist/**/*
    - deployment/scripts/**/*
    - deployment-manifest.json
    - docs/deployment/**/*
  name: prod-build-$(date +%Y-%m-%d-%H-%M-%S)
```

---

## 3. Environment Configuration

### 3.1 Development Environment

```yaml
# infrastructure/dev/parameters.json
{
  "Parameters": {
    "Environment": "dev",
    "DomainName": "dev.engagements.platform.com",
    "DatabaseTableName": "meeting-engagements-dev",
    "S3BucketPrefix": "meeting-engagements-dev",
    "CloudFrontDistribution": "dev-distribution",
    "ApiGatewayStage": "dev",
    "LambdaMemorySize": "512",
    "LambdaTimeout": "30",
    "DynamoDBBillingMode": "PAY_PER_REQUEST",
    "EnableDetailedMonitoring": "false",
    "LogRetentionDays": "7",
    "EnableXRayTracing": "true",
    "CorsOrigins": "*",
    "RateLimitPerMinute": "1000"
  }
}
```

### 3.2 Test Environment

```yaml
# infrastructure/test/parameters.json
{
  "Parameters": {
    "Environment": "test",
    "DomainName": "test.engagements.platform.com",
    "DatabaseTableName": "meeting-engagements-test",
    "S3BucketPrefix": "meeting-engagements-test",
    "CloudFrontDistribution": "test-distribution",
    "ApiGatewayStage": "test",
    "LambdaMemorySize": "1024",
    "LambdaTimeout": "60",
    "DynamoDBBillingMode": "PAY_PER_REQUEST",
    "EnableDetailedMonitoring": "true",
    "LogRetentionDays": "14",
    "EnableXRayTracing": "true",
    "CorsOrigins": "https://test.engagements.platform.com",
    "RateLimitPerMinute": "500"
  }
}
```

### 3.3 Production Environment

```yaml
# infrastructure/prod/parameters.json
{
  "Parameters": {
    "Environment": "prod",
    "DomainName": "engagements.platform.com",
    "DatabaseTableName": "meeting-engagements-prod",
    "S3BucketPrefix": "meeting-engagements-prod",
    "CloudFrontDistribution": "prod-distribution",
    "ApiGatewayStage": "v1",
    "LambdaMemorySize": "2048",
    "LambdaTimeout": "300",
    "DynamoDBBillingMode": "PROVISIONED",
    "DynamoDBReadCapacity": "100",
    "DynamoDBWriteCapacity": "50",
    "EnableDetailedMonitoring": "true",
    "LogRetentionDays": "90",
    "EnableXRayTracing": "true",
    "CorsOrigins": "https://engagements.platform.com",
    "RateLimitPerMinute": "100",
    "EnableWAF": "true",
    "EnableCloudTrail": "true"
  }
}
```

---

## 4. Deployment Scripts

### 4.1 Main Deployment Script

```bash
#!/bin/bash
# deployment/scripts/deploy.sh

set -e

ENVIRONMENT=$1
STACK_NAME="meeting-engagements-${ENVIRONMENT}"
TEMPLATE_FILE="infrastructure/${ENVIRONMENT}/packaged.yml"
PARAMETERS_FILE="infrastructure/${ENVIRONMENT}/parameters.json"

echo "Deploying to ${ENVIRONMENT} environment..."

# Validate CloudFormation template
echo "Validating CloudFormation template..."
aws cloudformation validate-template --template-body file://${TEMPLATE_FILE}

# Deploy infrastructure
echo "Deploying infrastructure stack..."
aws cloudformation deploy \
  --template-file ${TEMPLATE_FILE} \
  --stack-name ${STACK_NAME} \
  --parameter-overrides file://${PARAMETERS_FILE} \
  --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM \
  --no-fail-on-empty-changeset

# Get stack outputs
echo "Retrieving stack outputs..."
API_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name ${STACK_NAME} \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiEndpoint`].OutputValue' \
  --output text)

WEBSOCKET_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name ${STACK_NAME} \
  --query 'Stacks[0].Outputs[?OutputKey==`WebSocketEndpoint`].OutputValue' \
  --output text)

CLOUDFRONT_DOMAIN=$(aws cloudformation describe-stacks \
  --stack-name ${STACK_NAME} \
  --query 'Stacks[0].Outputs[?OutputKey==`CloudFrontDomain`].OutputValue' \
  --output text)

echo "Deployment completed successfully!"
echo "API Endpoint: ${API_ENDPOINT}"
echo "WebSocket Endpoint: ${WEBSOCKET_ENDPOINT}"
echo "CloudFront Domain: ${CLOUDFRONT_DOMAIN}"

# Run post-deployment tests
if [ "${ENVIRONMENT}" != "prod" ]; then
  echo "Running post-deployment tests..."
  npm run test:deployment -- --endpoint=${API_ENDPOINT}
fi

# Update DNS records for production
if [ "${ENVIRONMENT}" == "prod" ]; then
  echo "Updating DNS records..."
  ./scripts/update-dns.sh ${CLOUDFRONT_DOMAIN}
fi
```

### 4.2 Rollback Script

```bash
#!/bin/bash
# deployment/scripts/rollback.sh

set -e

ENVIRONMENT=$1
STACK_NAME="meeting-engagements-${ENVIRONMENT}"

if [ "${ENVIRONMENT}" == "prod" ]; then
  echo "Production rollback requires manual confirmation."
  read -p "Are you sure you want to rollback production? (yes/no): " confirm
  if [ "${confirm}" != "yes" ]; then
    echo "Rollback cancelled."
    exit 1
  fi
fi

echo "Rolling back ${ENVIRONMENT} environment..."

# Get previous stack template
echo "Retrieving previous stack configuration..."
aws cloudformation get-template \
  --stack-name ${STACK_NAME} \
  --template-stage Processed \
  > previous-template.json

# Cancel any in-progress updates
echo "Cancelling any in-progress updates..."
aws cloudformation cancel-update-stack --stack-name ${STACK_NAME} || true

# Wait for stack to be in a stable state
echo "Waiting for stack to stabilize..."
aws cloudformation wait stack-update-complete --stack-name ${STACK_NAME} || true

# Perform rollback
echo "Performing rollback..."
aws cloudformation continue-update-rollback --stack-name ${STACK_NAME}

# Wait for rollback to complete
echo "Waiting for rollback to complete..."
aws cloudformation wait stack-update-complete --stack-name ${STACK_NAME}

echo "Rollback completed successfully!"

# Run health checks
echo "Running post-rollback health checks..."
npm run test:health -- --environment=${ENVIRONMENT}
```

---

## 5. Monitoring and Alerting

### 5.1 CloudWatch Alarms

```yaml
# Infrastructure monitoring alarms
ProductionAlarms:
  Type: AWS::CloudWatch::Alarm
  Properties:
    AlarmName: !Sub '${AWS::StackName}-high-error-rate'
    AlarmDescription: 'High error rate detected'
    MetricName: Errors
    Namespace: AWS/Lambda
    Statistic: Sum
    Period: 300
    EvaluationPeriods: 2
    Threshold: 10
    ComparisonOperator: GreaterThanThreshold
    AlarmActions:
      - !Ref SNSAlarmTopic

DatabaseAlarms:
  Type: AWS::CloudWatch::Alarm
  Properties:
    AlarmName: !Sub '${AWS::StackName}-high-read-throttles'
    AlarmDescription: 'DynamoDB read throttling detected'
    MetricName: ReadThrottles
    Namespace: AWS/DynamoDB
    Statistic: Sum
    Period: 300
    EvaluationPeriods: 1
    Threshold: 0
    ComparisonOperator: GreaterThanThreshold
```

### 5.2 Deployment Notifications

```yaml
# SNS topic for deployment notifications
DeploymentNotifications:
  Type: AWS::SNS::Topic
  Properties:
    TopicName: !Sub '${AWS::StackName}-deployments'
    Subscription:
      - Protocol: email
        Endpoint: george@seibtribe.com
      - Protocol: slack
        Endpoint: !Ref SlackWebhookUrl
```

---

## 6. Security and Compliance

### 6.1 IAM Roles and Policies

```yaml
# CodePipeline service role
CodePipelineRole:
  Type: AWS::IAM::Role
  Properties:
    AssumeRolePolicyDocument:
      Version: '2012-10-17'
      Statement:
        - Effect: Allow
          Principal:
            Service: codepipeline.amazonaws.com
          Action: sts:AssumeRole
    Policies:
      - PolicyName: PipelineExecutionPolicy
        PolicyDocument:
          Version: '2012-10-17'
          Statement:
            - Effect: Allow
              Action:
                - s3:GetObject
                - s3:PutObject
                - s3:GetBucketVersioning
              Resource:
                - !Sub '${ArtifactsBucket}/*'
                - !Ref ArtifactsBucket
            - Effect: Allow
              Action:
                - codebuild:BatchGetBuilds
                - codebuild:StartBuild
              Resource: '*'
            - Effect: Allow
              Action:
                - cloudformation:CreateStack
                - cloudformation:UpdateStack
                - cloudformation:DescribeStacks
              Resource: '*'
```

### 6.2 Security Scanning

```bash
# Security scanning in build process
echo "Running security scans..."

# Dependency vulnerability scanning
npm audit --audit-level moderate

# Static code analysis
npm run lint:security

# Infrastructure security scanning
cfn-lint infrastructure/**/*.yml

# Container security scanning (if using containers)
docker run --rm -v $(pwd):/app clair-scanner:latest /app

# Secrets detection
git-secrets --scan
```

---

This CI/CD pipeline provides automated, secure, and reliable deployments across all environments while maintaining proper approval gates and monitoring for production releases.
