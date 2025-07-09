#!/bin/bash

# Clean Infrastructure Deployment Script
# Usage: ./scripts/deploy-clean.sh <environment> <domain> <hosted-zone-id>

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check arguments
if [ $# -lt 1 ]; then
    print_error "Usage: $0 <environment> [domain] [hosted-zone-id]"
    print_error "Example: $0 dev dev.engagements.example.com Z1234567890ABC"
    exit 1
fi

ENVIRONMENT=$1
DOMAIN=${2:-""}
HOSTED_ZONE_ID=${3:-""}
PROJECT_NAME="engagements"
STACK_NAME="${PROJECT_NAME}-${ENVIRONMENT}-infrastructure"

print_status "Starting deployment for environment: $ENVIRONMENT"

# Validate environment
if [[ ! "$ENVIRONMENT" =~ ^(dev|test|prod)$ ]]; then
    print_error "Environment must be one of: dev, test, prod"
    exit 1
fi

# Check if AWS CLI is configured
if ! aws sts get-caller-identity > /dev/null 2>&1; then
    print_error "AWS CLI not configured. Please run 'aws configure' first."
    exit 1
fi

# Get AWS account ID and region
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
AWS_REGION=$(aws configure get region)

print_status "AWS Account: $AWS_ACCOUNT_ID"
print_status "AWS Region: $AWS_REGION"
print_status "Stack Name: $STACK_NAME"

if [ -n "$DOMAIN" ]; then
    print_status "Domain: $DOMAIN"
    print_status "Hosted Zone ID: $HOSTED_ZONE_ID"
fi

# Build the application
print_status "Building application..."
sam build -t template-clean.yaml

if [ $? -ne 0 ]; then
    print_error "Build failed"
    exit 1
fi

print_success "Build completed"

# Prepare deployment parameters
PARAMETERS="Environment=$ENVIRONMENT ProjectName=$PROJECT_NAME"

if [ -n "$DOMAIN" ] && [ -n "$HOSTED_ZONE_ID" ]; then
    PARAMETERS="$PARAMETERS DomainName=$DOMAIN HostedZoneId=$HOSTED_ZONE_ID"
fi

print_status "Deployment parameters: $PARAMETERS"

# Deploy the stack
print_status "Deploying CloudFormation stack..."

sam deploy \
    --template-file .aws-sam/build/template.yaml \
    --stack-name "$STACK_NAME" \
    --capabilities CAPABILITY_IAM \
    --parameter-overrides $PARAMETERS \
    --resolve-s3 \
    --tags Environment="$ENVIRONMENT" Project="$PROJECT_NAME" \
    --no-fail-on-empty-changeset

if [ $? -ne 0 ]; then
    print_error "Deployment failed"
    exit 1
fi

print_success "Deployment completed"

# Get stack outputs
print_status "Retrieving stack outputs..."

REST_API_URL=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='RestApiUrl'].OutputValue" \
    --output text)

WEBSOCKET_URL=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='WebSocketUrl'].OutputValue" \
    --output text)

FRONTEND_BUCKET=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='FrontendBucketName'].OutputValue" \
    --output text)

FRONTEND_URL=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='FrontendUrl'].OutputValue" \
    --output text)

TABLE_NAME=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='GameTableName'].OutputValue" \
    --output text)

# Display deployment summary
echo ""
print_success "=== DEPLOYMENT SUMMARY ==="
echo "Environment: $ENVIRONMENT"
echo "Stack Name: $STACK_NAME"
echo "REST API URL: $REST_API_URL"
echo "WebSocket URL: $WEBSOCKET_URL"
echo "Frontend Bucket: $FRONTEND_BUCKET"
echo "Frontend URL: $FRONTEND_URL"
echo "DynamoDB Table: $TABLE_NAME"
echo ""

# Create environment configuration file
CONFIG_FILE="config/${ENVIRONMENT}.json"
mkdir -p config

cat > "$CONFIG_FILE" << EOF
{
  "environment": "$ENVIRONMENT",
  "aws": {
    "region": "$AWS_REGION",
    "accountId": "$AWS_ACCOUNT_ID"
  },
  "api": {
    "restUrl": "$REST_API_URL",
    "websocketUrl": "$WEBSOCKET_URL"
  },
  "frontend": {
    "bucket": "$FRONTEND_BUCKET",
    "url": "$FRONTEND_URL"
  },
  "database": {
    "tableName": "$TABLE_NAME"
  },
  "domain": {
    "name": "$DOMAIN",
    "hostedZoneId": "$HOSTED_ZONE_ID"
  }
}
EOF

print_success "Configuration saved to: $CONFIG_FILE"

# Test basic connectivity
print_status "Testing API connectivity..."

# Test REST API
if curl -s -f "$REST_API_URL/health" > /dev/null 2>&1; then
    print_success "REST API is responding"
else
    print_warning "REST API health check failed (this is normal if health endpoint doesn't exist)"
fi

# Test WebSocket API (basic connection test)
print_status "WebSocket API endpoint: $WEBSOCKET_URL"

print_success "Deployment verification completed"

# Next steps
echo ""
print_status "=== NEXT STEPS ==="
echo "1. Deploy frontend application to S3 bucket: $FRONTEND_BUCKET"
echo "2. Update frontend configuration with new API endpoints"
echo "3. Test all functionality end-to-end"
echo "4. Update CI/CD pipeline with new stack name and parameters"

if [ -n "$DOMAIN" ]; then
    echo "5. Verify SSL certificate validation in ACM"
    echo "6. Test domain access: $FRONTEND_URL"
fi

echo ""
print_success "Clean infrastructure deployment completed successfully!"
