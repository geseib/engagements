#!/usr/bin/env bash

# AWS SAM deployment script for quiz-game PRODUCTION environment
# This script deploys the backend infrastructure using SAM for the production environment

set -e  # Exit on any error

echo "🚀 Starting AWS SAM PRODUCTION deployment..."

# Get the script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Change to project root directory
echo "📁 Changing to project root: $PROJECT_ROOT"
cd "$PROJECT_ROOT"

# Check if template-prod.yaml exists
if [ ! -f "template-prod.yaml" ]; then
    echo "❌ Error: template-prod.yaml not found in project root"
    exit 1
fi

# Check if samconfig-prod.toml exists
if [ ! -f "samconfig-prod.toml" ]; then
    echo "❌ Error: samconfig-prod.toml not found. Creating default config..."
    exit 1
fi

# Set AWS profile
AWS_PROFILE="adfs"
echo "🔑 Using AWS profile: $AWS_PROFILE"

# Confirmation for production deployment
echo "⚠️  WARNING: You are about to deploy to PRODUCTION!"
echo "   Domain: engagements.sb.seibtribe.us"
echo "   Stack: engagements-prod"
echo ""
read -p "Are you sure you want to continue? (yes/no): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    echo "❌ Production deployment cancelled"
    exit 1
fi

# Deploy using SAM with prod template and config
echo "☁️  Deploying AWS SAM PRODUCTION template..."
AWS_PROFILE="$AWS_PROFILE" sam deploy \
    --template-file template-prod.yaml \
    --config-file samconfig-prod.toml \
    --parameter-overrides DomainName=engagements.sb.seibtribe.us HostedZoneId=Z03473042HSYD8BUY4XSL

if [ $? -eq 0 ]; then
    echo "✅ AWS SAM PRODUCTION deployment completed successfully!"
    
    # Get the API Gateway URL from CloudFormation outputs
    API_URL=$(aws cloudformation describe-stacks \
        --stack-name engagements-prod \
        --query 'Stacks[0].Outputs[?OutputKey==`ApiUrl`].OutputValue' \
        --output text \
        --profile $AWS_PROFILE 2>/dev/null || echo "Unable to fetch API URL")
    
    # Get the WebSocket URL from CloudFormation outputs  
    WS_URL=$(aws cloudformation describe-stacks \
        --stack-name engagements-prod \
        --query 'Stacks[0].Outputs[?OutputKey==`WebSocketUrl`].OutputValue' \
        --output text \
        --profile $AWS_PROFILE 2>/dev/null || echo "Unable to fetch WebSocket URL")
    
    echo "🌐 PRODUCTION API Base URL: $API_URL"
    echo "🔌 PRODUCTION WebSocket URL: $WS_URL"
    echo "🌐 PRODUCTION Website URL: https://engagements.sb.seibtribe.us"
    echo ""
    echo "🔧 Next steps:"
    echo "   1. Run scripts/deploy-frontend-prod.sh to deploy the frontend"
    echo "   2. Verify the application at https://engagements.sb.seibtribe.us"
    echo "   3. Monitor CloudWatch logs for any issues"
else
    echo "❌ SAM PRODUCTION deployment failed"
    exit 1
fi
