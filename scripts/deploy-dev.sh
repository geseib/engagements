#!/usr/bin/env bash

# AWS SAM deployment script for quiz-game DEVELOPMENT environment
# This script deploys the backend infrastructure using SAM for the dev environment

set -e  # Exit on any error

echo "🚀 Starting AWS SAM DEVELOPMENT deployment..."

# Get the script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Change to project root directory
echo "📁 Changing to project root: $PROJECT_ROOT"
cd "$PROJECT_ROOT"

# Check if template-dev.yaml exists
if [ ! -f "template-dev.yaml" ]; then
    echo "❌ Error: template-dev.yaml not found in project root"
    exit 1
fi

# Check if samconfig-dev.toml exists
if [ ! -f "samconfig-dev.toml" ]; then
    echo "❌ Error: samconfig-dev.toml not found. Creating default config..."
    exit 1
fi

# Set AWS profile
AWS_PROFILE="adfs"
echo "🔑 Using AWS profile: $AWS_PROFILE"

# Deploy using SAM with dev template and config
echo "☁️  Deploying AWS SAM DEV template..."
AWS_PROFILE="$AWS_PROFILE" sam deploy \
    --template-file template-dev.yaml \
    --config-file samconfig-dev.toml \
    --parameter-overrides DomainName=engagements.sb.seibtribe.us HostedZoneId=Z03473042HSYD8BUY4XSL

if [ $? -eq 0 ]; then
    echo "✅ AWS SAM DEVELOPMENT deployment completed successfully!"
    
    # Get the API Gateway URL from CloudFormation outputs
    API_URL=$(aws cloudformation describe-stacks \
        --stack-name quiz-game-dev \
        --query 'Stacks[0].Outputs[?OutputKey==`ApiUrl`].OutputValue' \
        --output text \
        --profile $AWS_PROFILE 2>/dev/null || echo "Unable to fetch API URL")
    
    # Get the WebSocket URL from CloudFormation outputs  
    WS_URL=$(aws cloudformation describe-stacks \
        --stack-name quiz-game-dev \
        --query 'Stacks[0].Outputs[?OutputKey==`WebSocketUrl`].OutputValue' \
        --output text \
        --profile $AWS_PROFILE 2>/dev/null || echo "Unable to fetch WebSocket URL")
    
    echo "🌐 DEV API Base URL: $API_URL"
    echo "🔌 DEV WebSocket URL: $WS_URL"
    echo "🌐 DEV Website URL: https://engagement.sb.seibtribe.us"
    echo ""
    echo "🔧 Next steps:"
    echo "   1. Run scripts/deploy-frontend-dev.sh to deploy the frontend"
    echo "   2. Update frontend to use WebSocket for real-time state"
else
    echo "❌ SAM DEVELOPMENT deployment failed"
    exit 1
fi