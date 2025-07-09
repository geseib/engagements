#!/bin/bash

# CI/CD Pipeline Deployment Script
# Usage: ./scripts/deploy-cicd.sh

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

print_status "🚀 Deploying CI/CD Pipeline for Engagements Platform"
echo ""

# Check if AWS CLI is configured with adminaccess profile
if ! aws sts get-caller-identity --profile adminaccess > /dev/null 2>&1; then
    print_error "AWS CLI not configured with adminaccess profile. Please configure it first."
    exit 1
fi

# Get AWS account ID and region
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --profile adminaccess --query Account --output text)
AWS_REGION=$(aws configure get region --profile adminaccess)

print_status "AWS Account: $AWS_ACCOUNT_ID"
print_status "AWS Region: $AWS_REGION"

# Verify we're in the correct account
if [ "$AWS_ACCOUNT_ID" != "239601476690" ]; then
    print_error "Wrong AWS account. Expected 239601476690, got $AWS_ACCOUNT_ID"
    exit 1
fi

print_success "✅ Connected to correct AWS account"

# Configuration
STACK_NAME="engagecicd"
HOSTED_ZONE_ID="ZB9TUA073B5SH"
DEV_DOMAIN="engage.dev.seibtribe.us"
TEST_DOMAIN="engage.test.seibtribe.us"
PROD_DOMAIN="engage.seibtribe.us"

print_status "Stack Name: $STACK_NAME"
print_status "Hosted Zone: $HOSTED_ZONE_ID"
print_status "Dev Domain: $DEV_DOMAIN"
print_status "Test Domain: $TEST_DOMAIN"
print_status "Prod Domain: $PROD_DOMAIN"

# Prompt for GitHub token
echo ""
print_warning "⚠️  GitHub Personal Access Token Required"
echo "The CI/CD pipeline needs a GitHub personal access token with the following permissions:"
echo "  - repo (Full control of private repositories)"
echo "  - admin:repo_hook (Full control of repository hooks)"
echo ""
echo "You can create one at: https://github.com/settings/tokens"
echo ""
read -s -p "Enter your GitHub Personal Access Token: " GITHUB_TOKEN
echo ""

if [ -z "$GITHUB_TOKEN" ]; then
    print_error "GitHub token is required"
    exit 1
fi

print_success "✅ GitHub token provided"

# Deploy the CI/CD pipeline
print_status "Deploying CI/CD pipeline CloudFormation stack..."

aws cloudformation deploy \
    --template-file cicd/pipeline-clean.yaml \
    --stack-name "$STACK_NAME" \
    --capabilities CAPABILITY_NAMED_IAM \
    --parameter-overrides \
        ProjectName=engage \
        GitHubOwner=geseib \
        GitHubRepo=engagements \
        GitHubToken="$GITHUB_TOKEN" \
        DevDomain="$DEV_DOMAIN" \
        TestDomain="$TEST_DOMAIN" \
        ProdDomain="$PROD_DOMAIN" \
        HostedZoneId="$HOSTED_ZONE_ID" \
    --tags \
        Project=engage \
        Purpose=CICD \
    --profile adminaccess

if [ $? -ne 0 ]; then
    print_error "CI/CD pipeline deployment failed"
    exit 1
fi

print_success "✅ CI/CD pipeline deployed successfully"

# Get stack outputs
print_status "Retrieving CI/CD pipeline information..."

DEV_PIPELINE_NAME=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='DevPipelineName'].OutputValue" \
    --output text \
    --profile adminaccess)

TEST_PIPELINE_NAME=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='TestPipelineName'].OutputValue" \
    --output text \
    --profile adminaccess)

PROD_PIPELINE_NAME=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='ProdPipelineName'].OutputValue" \
    --output text \
    --profile adminaccess)

ARTIFACTS_BUCKET=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='ArtifactsBucketName'].OutputValue" \
    --output text \
    --profile adminaccess)

DEV_PIPELINE_URL=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='DevPipelineUrl'].OutputValue" \
    --output text \
    --profile adminaccess)

TEST_PIPELINE_URL=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='TestPipelineUrl'].OutputValue" \
    --output text \
    --profile adminaccess)

PROD_PIPELINE_URL=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='ProdPipelineUrl'].OutputValue" \
    --output text \
    --profile adminaccess)

# Display deployment summary
echo ""
print_success "=== CI/CD PIPELINE DEPLOYMENT SUMMARY ==="
echo "Stack Name: $STACK_NAME"
echo "Artifacts Bucket: $ARTIFACTS_BUCKET"
echo ""
echo "📋 PIPELINES BY BRANCH:"
echo "  Dev Pipeline: $DEV_PIPELINE_NAME"
echo "  Test Pipeline: $TEST_PIPELINE_NAME"
echo "  Prod Pipeline: $PROD_PIPELINE_NAME"
echo ""
echo "🌐 PIPELINE URLS:"
echo "  Dev: $DEV_PIPELINE_URL"
echo "  Test: $TEST_PIPELINE_URL"
echo "  Prod: $PROD_PIPELINE_URL"
echo ""

# Create CI/CD configuration file
CONFIG_FILE="config/cicd.json"
mkdir -p config

cat > "$CONFIG_FILE" << EOF
{
  "cicd": {
    "stackName": "$STACK_NAME",
    "artifactsBucket": "$ARTIFACTS_BUCKET",
    "pipelines": {
      "dev": {
        "name": "$DEV_PIPELINE_NAME",
        "url": "$DEV_PIPELINE_URL",
        "branch": "dev"
      },
      "test": {
        "name": "$TEST_PIPELINE_NAME",
        "url": "$TEST_PIPELINE_URL",
        "branch": "test"
      },
      "prod": {
        "name": "$PROD_PIPELINE_NAME",
        "url": "$PROD_PIPELINE_URL",
        "branch": "prod"
      }
    }
  },
  "aws": {
    "accountId": "$AWS_ACCOUNT_ID",
    "region": "$AWS_REGION",
    "profile": "adminaccess"
  },
  "domains": {
    "dev": "$DEV_DOMAIN",
    "test": "$TEST_DOMAIN",
    "prod": "$PROD_DOMAIN",
    "hostedZoneId": "$HOSTED_ZONE_ID"
  },
  "github": {
    "owner": "geseib",
    "repo": "engagements",
    "branches": ["dev", "test", "prod"]
  }
}
EOF

print_success "Configuration saved to: $CONFIG_FILE"

# Next steps
echo ""
print_status "=== NEXT STEPS ==="
echo "1. 🌐 Open pipelines in AWS Console:"
echo "   - Dev: $DEV_PIPELINE_URL"
echo "   - Test: $TEST_PIPELINE_URL"
echo "   - Prod: $PROD_PIPELINE_URL"
echo ""
echo "2. 🔧 Branch-based deployment strategy:"
echo "   - Push to 'dev' branch → Auto-deploy to engagedev"
echo "   - Merge dev → test branch → Auto-deploy to engagetest"
echo "   - Merge test → prod branch → Manual approval → Deploy to engageprod"
echo ""
echo "4. 📋 Manual deployment commands (if needed):"
echo "   ./scripts/deploy-clean.sh engagedev engage.dev.seibtribe.us"
echo "   ./scripts/deploy-clean.sh engagetest engage.test.seibtribe.us"
echo "   ./scripts/deploy-clean.sh engageprod engage.seibtribe.us"
echo ""

print_success "🎉 CI/CD Pipeline deployment completed successfully!"
print_status "The pipeline is now ready to deploy your engagements platform automatically."
