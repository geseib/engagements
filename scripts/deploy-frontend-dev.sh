#!/usr/bin/env bash

# Frontend deployment script for DEVELOPMENT environment
# This script builds and deploys the React frontend to the dev S3 bucket

set -e  # Exit on any error

echo "🚀 Starting DEVELOPMENT frontend deployment..."

# Get the script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Change to frontend directory
FRONTEND_DIR="$PROJECT_ROOT/src"
echo "📁 Changing to frontend directory: $FRONTEND_DIR"
cd "$FRONTEND_DIR"

# Check if package.json exists
if [ ! -f "package.json" ]; then
    echo "❌ Error: package.json not found in frontend directory"
    exit 1
fi

# Set AWS profile
AWS_PROFILE="adfs"
STACK_NAME="engagements-v1"

# Get CloudFront URL from CloudFormation outputs
echo "🔍 Getting CloudFront URL from CloudFormation stack: $STACK_NAME"
CLOUDFRONT_URL=$(aws cloudformation describe-stacks \
    --stack-name $STACK_NAME \
    --query 'Stacks[0].Outputs[?OutputKey==`WebsiteUrl`].OutputValue' \
    --output text \
    --profile $AWS_PROFILE)

if [ -z "$CLOUDFRONT_URL" ]; then
    echo "❌ Error: Could not retrieve CloudFront URL from stack $STACK_NAME"
    exit 1
fi

echo "🔗 Found CloudFront URL: $CLOUDFRONT_URL"

# Get API Gateway URL from CloudFormation outputs
API_URL=$(aws cloudformation describe-stacks \
    --stack-name $STACK_NAME \
    --query 'Stacks[0].Outputs[?OutputKey==`ApiUrl`].OutputValue' \
    --output text \
    --profile $AWS_PROFILE)

# Get WebSocket URL from CloudFormation outputs
WS_URL=$(aws cloudformation describe-stacks \
    --stack-name $STACK_NAME \
    --query 'Stacks[0].Outputs[?OutputKey==`WebSocketUrl`].OutputValue' \
    --output text \
    --profile $AWS_PROFILE)

echo "📝 Updating API_BASE to use direct API Gateway URL for DEV..."
# Update the public/config.js file with dev API endpoint
cat > public/config.js << EOF
// Development environment configuration
window.API_BASE = '$API_URL/';
window.WS_URL = '$WS_URL';
window.ENV = 'development';

console.log('🔧 DEV Environment loaded:');
console.log('  API_BASE:', window.API_BASE);
console.log('  WS_URL:', window.WS_URL);
console.log('  ENV:', window.ENV);
EOF

echo "✅ Updated DEV API_BASE to: $API_URL/"
echo "✅ Updated DEV WS_URL to: $WS_URL"

# Build the frontend
echo "🔨 Building frontend for DEV environment..."
npm run build

if [ $? -ne 0 ]; then
    echo "❌ Frontend build failed"
    exit 1
fi

# Get S3 bucket name from CloudFormation outputs
echo "🔍 Getting S3 bucket name from CloudFormation stack: $STACK_NAME"
BUCKET_NAME=$(aws cloudformation describe-stacks \
    --stack-name $STACK_NAME \
    --query 'Stacks[0].Outputs[?OutputKey==`StaticSiteBucketName`].OutputValue' \
    --output text \
    --profile $AWS_PROFILE)

if [ -z "$BUCKET_NAME" ]; then
    echo "❌ Error: Could not retrieve S3 bucket name from stack $STACK_NAME"
    exit 1
fi

# Upload to S3
echo "☁️  Uploading to DEV S3 bucket: $BUCKET_NAME"
echo "🔑 Using AWS profile: $AWS_PROFILE"
aws s3 sync dist/ s3://$BUCKET_NAME/ --delete --profile $AWS_PROFILE

if [ $? -eq 0 ]; then
    echo "✅ DEVELOPMENT frontend deployment completed successfully!"
    echo "🌐 Your DEV changes are now live at: $CLOUDFRONT_URL"
    echo "🔌 WebSocket endpoint available at: $WS_URL"
    echo ""
    echo "🔧 DEV Environment URLs:"
    echo "   Frontend: $CLOUDFRONT_URL"
    echo "   API: $API_URL"
    echo "   WebSocket: $WS_URL"
else
    echo "❌ S3 upload failed"
    exit 1
fi