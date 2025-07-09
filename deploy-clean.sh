#!/bin/bash

# Clean Slate Deployment Script for Engagements Platform
# This script performs a complete clean deployment with HTTP API v2

set -e  # Exit on any error

echo "🧹 CLEAN SLATE DEPLOYMENT FOR ENGAGEMENTS PLATFORM"
echo "=================================================="

# Configuration
STACK_NAME="engagedev"
ENVIRONMENT="dev"
DOMAIN_NAME="engage.dev.seibtribe.us"
HOSTED_ZONE_ID="ZB9TUA073B5SH"

echo "📋 Configuration:"
echo "  Stack Name: $STACK_NAME"
echo "  Environment: $ENVIRONMENT"
echo "  Domain: $DOMAIN_NAME"
echo ""

# Step 1: Clean up existing resources
echo "🗑️  STEP 1: CLEANING UP EXISTING RESOURCES"
echo "----------------------------------------"

echo "🪣 Emptying S3 buckets..."
aws s3 rm s3://${STACK_NAME}-web --recursive --quiet 2>/dev/null || echo "  Bucket ${STACK_NAME}-web not found or already empty"
aws s3 rm s3://${STACK_NAME}-reports --recursive --quiet 2>/dev/null || echo "  Bucket ${STACK_NAME}-reports not found or already empty"

echo "🗂️  Deleting CloudFormation stack..."
aws cloudformation delete-stack --stack-name $STACK_NAME 2>/dev/null || echo "  Stack $STACK_NAME not found"

echo "⏳ Waiting for stack deletion to complete..."
aws cloudformation wait stack-delete-complete --stack-name $STACK_NAME 2>/dev/null || echo "  Stack deletion complete or stack didn't exist"

echo "✅ Cleanup complete!"
echo ""

# Step 2: Validate template
echo "🔍 STEP 2: VALIDATING TEMPLATE"
echo "------------------------------"

echo "📏 Checking template size..."
TEMPLATE_SIZE=$(wc -c < template-clean.yaml)
echo "  Template size: ${TEMPLATE_SIZE} bytes"

if [ $TEMPLATE_SIZE -gt 51200 ]; then
    echo "❌ Template too large (${TEMPLATE_SIZE} > 51200 bytes)"
    exit 1
fi

echo "✅ Template validation..."
aws cloudformation validate-template --template-body file://template-clean.yaml > /dev/null
echo "✅ Template is valid!"
echo ""

# Step 3: Build and deploy
echo "🚀 STEP 3: BUILDING AND DEPLOYING"
echo "---------------------------------"

echo "🔨 Building SAM application..."
sam build --template template-clean.yaml

echo "🚀 Deploying to AWS..."
sam deploy \
    --template-file .aws-sam/build/template.yaml \
    --stack-name $STACK_NAME \
    --parameter-overrides \
        Environment=$ENVIRONMENT \
        StackName=$STACK_NAME \
        DomainName=$DOMAIN_NAME \
        HostedZoneId=$HOSTED_ZONE_ID \
    --capabilities CAPABILITY_IAM \
    --no-confirm-changeset \
    --no-fail-on-empty-changeset

echo "✅ Deployment complete!"
echo ""

# Step 4: Get outputs
echo "📋 STEP 4: DEPLOYMENT OUTPUTS"
echo "-----------------------------"

echo "🔗 Getting stack outputs..."
REST_API_URL=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --query 'Stacks[0].Outputs[?OutputKey==`RestApiUrl`].OutputValue' --output text)
WEBSOCKET_URL=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --query 'Stacks[0].Outputs[?OutputKey==`WebSocketUrl`].OutputValue' --output text)
FRONTEND_URL=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --query 'Stacks[0].Outputs[?OutputKey==`FrontendUrl`].OutputValue' --output text)

echo ""
echo "🎉 DEPLOYMENT SUCCESSFUL!"
echo "========================"
echo ""
echo "📡 API Endpoints:"
echo "  REST API: $REST_API_URL"
echo "  WebSocket: $WEBSOCKET_URL"
echo ""
echo "🌐 Frontend:"
echo "  URL: $FRONTEND_URL"
echo ""
echo "🛠️  Admin Endpoints Ready:"
echo "  GET  $REST_API_URL/admin/question-sets"
echo "  GET  $REST_API_URL/question-sets"
echo "  POST $REST_API_URL/admin/ai-generate-questions"
echo "  POST $REST_API_URL/admin/ai-generate-scenarios"
echo "  POST $REST_API_URL/admin/upload-questions"
echo ""
echo "🧪 Test Commands:"
echo "  curl $REST_API_URL/admin/question-sets"
echo "  curl $REST_API_URL/question-sets"
echo ""
echo "✅ Ready for testing!"
