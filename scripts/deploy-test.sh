#!/usr/bin/env bash

# AWS SAM deployment script for quiz-game TEST environment
# This script deploys the backend infrastructure using SAM for the test environment

set -e  # Exit on any error

echo "🚀 Starting AWS SAM TEST deployment..."

# Get the script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Change to project root directory
echo "📁 Changing to project root: $PROJECT_ROOT"
cd "$PROJECT_ROOT"

# Check if template-test.yaml exists
if [ ! -f "template-test.yaml" ]; then
    echo "❌ Error: template-test.yaml not found in project root"
    exit 1
fi

# Check if samconfig-test.toml exists
if [ ! -f "samconfig-test.toml" ]; then
    echo "❌ Error: samconfig-test.toml not found. Creating default config..."
    exit 1
fi

# Set AWS profile
AWS_PROFILE="adfs"
echo "🔑 Using AWS profile: $AWS_PROFILE"

# Deploy using SAM with test template and config
echo "☁️  Deploying AWS SAM TEST template..."
AWS_PROFILE="$AWS_PROFILE" sam deploy \
    --template-file template-test.yaml \
    --config-file samconfig-test.toml \
    --parameter-overrides DomainName=engagetest.sb.seibtribe.us HostedZoneId=Z03473042HSYD8BUY4XSL

if [ $? -eq 0 ]; then
    echo "✅ AWS SAM TEST deployment completed successfully!"
    
    # Get the API Gateway URL from CloudFormation outputs
    API_URL=$(aws cloudformation describe-stacks \
        --stack-name engagements-test \
        --query 'Stacks[0].Outputs[?OutputKey==`ApiUrl`].OutputValue' \
        --output text \
        --profile $AWS_PROFILE 2>/dev/null || echo "Unable to fetch API URL")
    
    # Get the WebSocket URL from CloudFormation outputs  
    WS_URL=$(aws cloudformation describe-stacks \
        --stack-name engagements-test \
        --query 'Stacks[0].Outputs[?OutputKey==`WebSocketUrl`].OutputValue' \
        --output text \
        --profile $AWS_PROFILE 2>/dev/null || echo "Unable to fetch WebSocket URL")
    
    echo "🌐 TEST API Base URL: $API_URL"
    echo "🔌 TEST WebSocket URL: $WS_URL"
    echo "🌐 TEST Website URL: https://engagetest.sb.seibtribe.us"
    echo ""
    echo "🔧 Next steps:"
    echo "   1. Run scripts/deploy-frontend-test.sh to deploy the frontend"
    echo "   2. Test the application at https://engagetest.sb.seibtribe.us"
else
    echo "❌ SAM TEST deployment failed"
    exit 1
fi
