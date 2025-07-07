#!/usr/bin/env bash

# CI/CD Pipeline Setup Script - Manual Version
# Usage: ./scripts/setup-cicd-manual.sh YOUR_GITHUB_TOKEN

set -e  # Exit on any error

if [ -z "$1" ]; then
    echo "❌ Error: GitHub token required"
    echo "Usage: $0 YOUR_GITHUB_TOKEN"
    echo ""
    echo "🔐 To get a GitHub token:"
    echo "   1. Go to GitHub Settings > Developer settings > Personal access tokens"
    echo "   2. Create a token with 'repo' and 'admin:repo_hook' permissions"
    echo "   3. Run: $0 YOUR_TOKEN_HERE"
    exit 1
fi

GITHUB_TOKEN="$1"

echo "🚀 Setting up CI/CD Pipeline for Engagements Platform..."

# Get the script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Change to project root directory
echo "📁 Changing to project root: $PROJECT_ROOT"
cd "$PROJECT_ROOT"

# Check if template-cicd.yaml exists
if [ ! -f "template-cicd.yaml" ]; then
    echo "❌ Error: template-cicd.yaml not found in project root"
    exit 1
fi

# Set AWS profile
AWS_PROFILE="adfs"
echo "🔑 Using AWS profile: $AWS_PROFILE"

# Deploy the CI/CD infrastructure
echo "☁️  Deploying CI/CD Pipeline infrastructure..."
AWS_PROFILE="$AWS_PROFILE" aws cloudformation deploy \
    --template-file template-cicd.yaml \
    --stack-name engagements-cicd \
    --parameter-overrides \
        GitHubOwner=geseib \
        GitHubRepo=engagements \
        GitHubToken="$GITHUB_TOKEN" \
        HostedZoneId=Z03473042HSYD8BUY4XSL \
    --capabilities CAPABILITY_NAMED_IAM \
    --region us-east-1

if [ $? -eq 0 ]; then
    echo "✅ CI/CD Pipeline infrastructure deployed successfully!"
    
    # Get pipeline URLs
    DEV_PIPELINE_URL=$(aws cloudformation describe-stacks \
        --stack-name engagements-cicd \
        --query 'Stacks[0].Outputs[?OutputKey==`DevPipelineUrl`].OutputValue' \
        --output text \
        --profile $AWS_PROFILE 2>/dev/null || echo "Unable to fetch Dev Pipeline URL")
    
    TEST_PIPELINE_URL=$(aws cloudformation describe-stacks \
        --stack-name engagements-cicd \
        --query 'Stacks[0].Outputs[?OutputKey==`TestPipelineUrl`].OutputValue' \
        --output text \
        --profile $AWS_PROFILE 2>/dev/null || echo "Unable to fetch Test Pipeline URL")
    
    PROD_PIPELINE_URL=$(aws cloudformation describe-stacks \
        --stack-name engagements-cicd \
        --query 'Stacks[0].Outputs[?OutputKey==`ProdPipelineUrl`].OutputValue' \
        --output text \
        --profile $AWS_PROFILE 2>/dev/null || echo "Unable to fetch Prod Pipeline URL")
    
    echo ""
    echo "🎯 CI/CD Pipeline Setup Complete!"
    echo ""
    echo "📋 Pipeline URLs:"
    echo "   🟢 Dev Pipeline:  $DEV_PIPELINE_URL"
    echo "   🟡 Test Pipeline: $TEST_PIPELINE_URL"
    echo "   🔴 Prod Pipeline: $PROD_PIPELINE_URL"
    echo ""
    echo "🌐 Environment URLs (after deployment):"
    echo "   🟢 Dev:  https://engagedev.sb.seibtribe.us"
    echo "   🟡 Test: https://engagetest.sb.seibtribe.us"
    echo "   🔴 Prod: https://engagements.sb.seibtribe.us"
    echo ""
    echo "🔧 How it works:"
    echo "   • Push to 'dev' branch → Auto-deploy to Dev environment"
    echo "   • Push to 'test' branch → Auto-deploy to Test environment"
    echo "   • Push to 'main' branch → Manual approval required for Prod"
    echo ""
    echo "🚀 Next steps:"
    echo "   1. Create and push to 'dev' branch to trigger first deployment"
    echo "   2. Monitor pipeline execution in AWS Console"
    echo "   3. Test your changes at https://engagedev.sb.seibtribe.us"
    echo ""
    echo "💡 Pro tip: Use 'git push origin feature-branch:dev' to deploy feature branches to dev"
    
else
    echo "❌ CI/CD Pipeline deployment failed"
    exit 1
fi
