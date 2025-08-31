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
AWS_PROFILE="adminaccess"
STACK_NAME="engdev"

# Get CloudFront URL from CloudFormation outputs
echo "🔍 Getting CloudFront URL from CloudFormation stack: $STACK_NAME"
CLOUDFRONT_URL=$(aws cloudformation describe-stacks \
    --stack-name $STACK_NAME \
    --query 'Stacks[0].Outputs[?OutputKey==`FrontendUrl`].OutputValue' \
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
    --query 'Stacks[0].Outputs[?OutputKey==`RestApiUrl`].OutputValue' \
    --output text \
    --profile $AWS_PROFILE)

# Get WebSocket URL from CloudFormation outputs
WS_URL=$(aws cloudformation describe-stacks \
    --stack-name $STACK_NAME \
    --query 'Stacks[0].Outputs[?OutputKey==`WebSocketUrl`].OutputValue' \
    --output text \
    --profile $AWS_PROFILE)

# Get Cognito configuration from CloudFormation outputs
USER_POOL_ID=$(aws cloudformation describe-stacks \
    --stack-name $STACK_NAME \
    --query 'Stacks[0].Outputs[?OutputKey==`UserPoolId`].OutputValue' \
    --output text \
    --profile $AWS_PROFILE)

USER_POOL_CLIENT_ID=$(aws cloudformation describe-stacks \
    --stack-name $STACK_NAME \
    --query 'Stacks[0].Outputs[?OutputKey==`UserPoolClientId`].OutputValue' \
    --output text \
    --profile $AWS_PROFILE)

COGNITO_DOMAIN=$(aws cloudformation describe-stacks \
    --stack-name $STACK_NAME \
    --query 'Stacks[0].Outputs[?OutputKey==`UserPoolDomain`].OutputValue' \
    --output text \
    --profile $AWS_PROFILE)

echo "📝 Updating config.js with API endpoints and Cognito configuration for DEV..."
# Update the public/config.js file with dev API endpoint and Cognito config
cat > public/config.js << EOF
// Development environment configuration
window.API_BASE = '$API_URL/';
window.WS_URL = '$WS_URL';
window.USER_POOL_ID = '$USER_POOL_ID';
window.USER_POOL_CLIENT_ID = '$USER_POOL_CLIENT_ID';
window.COGNITO_DOMAIN = '$COGNITO_DOMAIN';
window.ENV = 'development';

console.log('🔧 DEV Environment loaded:');
console.log('  API_BASE:', window.API_BASE);
console.log('  WS_URL:', window.WS_URL);
console.log('  USER_POOL_ID:', window.USER_POOL_ID);
console.log('  USER_POOL_CLIENT_ID:', window.USER_POOL_CLIENT_ID);
console.log('  COGNITO_DOMAIN:', window.COGNITO_DOMAIN);
console.log('  ENV:', window.ENV);
EOF

echo "✅ Updated DEV API_BASE to: $API_URL/"
echo "✅ Updated DEV WS_URL to: $WS_URL"
echo "✅ Updated DEV USER_POOL_ID to: $USER_POOL_ID"
echo "✅ Updated DEV USER_POOL_CLIENT_ID to: $USER_POOL_CLIENT_ID"
echo "✅ Updated DEV COGNITO_DOMAIN to: $COGNITO_DOMAIN"

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
    --query 'Stacks[0].Outputs[?OutputKey==`FrontendBucketName`].OutputValue' \
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
    echo "✅ S3 upload completed successfully!"
    
    # Invalidate CloudFront cache to force fresh content
    echo "🔄 Invalidating CloudFront cache..."
    DISTRIBUTION_ID=$(aws cloudfront list-distributions \
        --query "DistributionList.Items[?Aliases.Items[0]=='eng.dev.seibtribe.us'].Id" \
        --output text \
        --profile $AWS_PROFILE)
    
    if [ ! -z "$DISTRIBUTION_ID" ]; then
        aws cloudfront create-invalidation \
            --distribution-id $DISTRIBUTION_ID \
            --paths "/*" \
            --profile $AWS_PROFILE \
            --output text
        echo "✅ CloudFront cache invalidation initiated"
    else
        echo "⚠️  Could not find CloudFront distribution ID"
    fi
    
    echo "✅ DEVELOPMENT frontend deployment completed successfully!"
    echo "🌐 Your DEV changes are now live at: $CLOUDFRONT_URL"
    echo "🔌 WebSocket endpoint available at: $WS_URL"
    echo ""
    echo "🔧 DEV Environment URLs:"
    echo "   Frontend: $CLOUDFRONT_URL"
    echo "   API: $API_URL"
    echo "   WebSocket: $WS_URL"
    echo "🔐 DEV Cognito Configuration:"
    echo "   User Pool ID: $USER_POOL_ID"
    echo "   Client ID: $USER_POOL_CLIENT_ID"
    echo "   Domain: $COGNITO_DOMAIN"
else
    echo "❌ S3 upload failed"
    exit 1
fi
