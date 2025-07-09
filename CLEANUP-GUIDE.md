# 🧹 Clean Slate Deployment Guide

## Overview
This guide walks through completely cleaning up the existing deployment and starting fresh with HTTP API v2 to avoid CloudFormation update conflicts.

## 🎯 Why Clean Slate?
- **CloudFormation Conflict**: Can't change `AWS::Serverless::Api` to `AWS::Serverless::HttpApi` in-place
- **Template Size Issues**: Original template exceeded 51KB CloudFormation limit
- **Clean Architecture**: Start fresh with external Lambda functions and proper structure

## 📋 Prerequisites
- AWS CLI configured with appropriate permissions
- SAM CLI installed
- Access to AWS Console (backup method)

## 🗑️ Step 1: Empty S3 Buckets

### Option A: AWS CLI
```bash
# List engagement buckets
aws s3 ls | grep engage

# Empty the buckets (replace with actual names)
aws s3 rm s3://engagedev-web --recursive
aws s3 rm s3://engagedev-reports --recursive
```

### Option B: AWS Console
1. Go to **S3 Console**
2. Find buckets starting with `engagedev`
3. Select each bucket → **Empty** → Confirm deletion
4. Repeat for all engagement-related buckets

## 🗂️ Step 2: Delete CloudFormation Stack

### Option A: AWS CLI
```bash
# Delete the stack
aws cloudformation delete-stack --stack-name engagedev

# Wait for deletion to complete
aws cloudformation wait stack-delete-complete --stack-name engagedev

# Verify deletion
aws cloudformation describe-stacks --stack-name engagedev
# Should return "Stack does not exist"
```

### Option B: AWS Console
1. Go to **CloudFormation Console**
2. Find `engagedev` stack
3. Select stack → **Delete** → **Delete stack**
4. Wait for `DELETE_COMPLETE` status

## 🔍 Step 3: Verify Complete Cleanup

### Check for Leftover Resources
```bash
# Lambda functions
aws lambda list-functions --query 'Functions[?contains(FunctionName, `engagedev`)]'

# API Gateways
aws apigateway get-rest-apis --query 'items[?contains(name, `engagedev`)]'
aws apigatewayv2 get-apis --query 'Items[?contains(Name, `engagedev`)]'

# DynamoDB tables
aws dynamodb list-tables --query 'TableNames[?contains(@, `engagedev`)]'

# S3 buckets
aws s3 ls | grep engage
```

All commands should return empty results or no matches.

## 🚀 Step 4: Deploy Clean Template

### Option A: Automated Script
```bash
# Run the automated deployment script
./deploy-clean.sh
```

### Option B: Manual SAM Deployment
```bash
# Validate template
aws cloudformation validate-template --template-body file://template-clean.yaml

# Build SAM application
sam build --template template-clean.yaml

# Deploy
sam deploy \
    --template-file .aws-sam/build/template.yaml \
    --stack-name engagedev \
    --parameter-overrides \
        Environment=dev \
        StackName=engagedev \
        DomainName=engage.dev.seibtribe.us \
        HostedZoneId=ZB9TUA073B5SH \
    --capabilities CAPABILITY_IAM \
    --no-confirm-changeset
```

## 🧪 Step 5: Test Deployment

### Get API Endpoints
```bash
# Get REST API URL
REST_API_URL=$(aws cloudformation describe-stacks --stack-name engagedev --query 'Stacks[0].Outputs[?OutputKey==`RestApiUrl`].OutputValue' --output text)

echo "REST API: $REST_API_URL"
```

### Test Admin Endpoints
```bash
# Test admin question sets
curl "$REST_API_URL/admin/question-sets"

# Test game creation question sets
curl "$REST_API_URL/question-sets"

# Test AI generation (with sample data)
curl -X POST "$REST_API_URL/admin/ai-generate-questions" \
  -H "Content-Type: application/json" \
  -d '{"engagementType":"call-and-answer","userInput":"Test questions","questionCount":2}'
```

### Expected Results
- **Admin question sets**: `{"questionSets":[]}`
- **Game question sets**: `{"sets":[]}`
- **AI generation**: Should return generated questions (not CORS error)

## ✅ Success Criteria

### 1. All Endpoints Respond
- ✅ `GET /admin/question-sets` returns 200
- ✅ `GET /question-sets` returns 200
- ✅ `POST /admin/ai-generate-questions` returns 200 (not CORS error)
- ✅ `POST /admin/ai-generate-scenarios` returns 200 (not CORS error)
- ✅ `POST /admin/upload-questions` accepts CSV uploads

### 2. Frontend Integration
- ✅ Admin page loads without errors
- ✅ Game creation page loads without errors
- ✅ AI generation tools work without CORS errors
- ✅ CSV upload creates question sets that appear in both admin and game creation

### 3. Data Flow
- ✅ Upload CSV → Creates question set in DynamoDB
- ✅ Admin page → Shows uploaded question sets
- ✅ Game creation → Shows question sets in dropdown
- ✅ AI generation → Creates usable question sets

## 🚨 Troubleshooting

### Stack Deletion Stuck
```bash
# Force delete if stuck
aws cloudformation cancel-update-stack --stack-name engagedev
aws cloudformation delete-stack --stack-name engagedev
```

### S3 Bucket Deletion Issues
```bash
# Check for versioned objects
aws s3api list-object-versions --bucket engagedev-web

# Delete all versions if needed
aws s3api delete-objects --bucket engagedev-web --delete "$(aws s3api list-object-versions --bucket engagedev-web --query '{Objects: Versions[].{Key:Key,VersionId:VersionId}}')"
```

### Template Validation Errors
- Ensure template size < 51KB: `wc -c template-clean.yaml`
- Check YAML syntax: `yamllint template-clean.yaml`
- Validate with AWS: `aws cloudformation validate-template --template-body file://template-clean.yaml`

## 📞 Support
If you encounter issues:
1. Check CloudFormation Events in AWS Console
2. Review Lambda function logs in CloudWatch
3. Verify IAM permissions for deployment
4. Ensure all prerequisites are installed and configured
