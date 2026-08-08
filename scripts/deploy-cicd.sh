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

# NOTE: no GitHub Personal Access Token is prompted for or passed.
# pipeline-clean.yaml has no GitHubToken parameter — repository access is via the
# AWS::CodeStarConnections::Connection ("engage-github-connection"), which is
# authorized once, by hand, in the AWS console. Passing GitHubToken= here made
# every redeploy fail with an unknown-parameter error.
#
# The separate GitHub PAT the *application* uses to file issues lives in Secrets
# Manager (engage/<env>/github-token) and is set by scripts/setup-secure-github-token.sh.

# Which CodeStar connection to authenticate to GitHub with.
#
# Do NOT let CloudFormation pick this. On 2026-08-08 a routine stack update
# reverted the pipelines from a working connection back to `!Ref
# GitHubConnection` — the stack's own connection, which is in ERROR ("GitHub
# authorization has been revoked or expired"). All three pipelines began
# failing at Source with no template change that mentioned connections.
#
# Resolve the newest AVAILABLE connection by name and pin it. If none is
# AVAILABLE we pass empty, which lets the stack create one — correct for a
# fresh bootstrap, and the check below will tell the operator it needs the
# manual GitHub handshake.
print_status "Resolving an AVAILABLE CodeStar connection..."
GITHUB_CONNECTION_ARN=$(aws codestar-connections list-connections \
    --query "Connections[?ConnectionName=='${STACK_NAME%cicd}-github-connection' && ConnectionStatus=='AVAILABLE'].ConnectionArn | [0]" \
    --output text \
    --profile adminaccess 2>/dev/null || echo "")
[ "$GITHUB_CONNECTION_ARN" = "None" ] && GITHUB_CONNECTION_ARN=""

if [ -n "$GITHUB_CONNECTION_ARN" ]; then
    print_success "Pinning pipelines to AVAILABLE connection: ${GITHUB_CONNECTION_ARN##*/}"
else
    print_warning "No AVAILABLE connection found — the stack will create one."
    print_warning "A new connection starts PENDING and cannot fetch source until"
    print_warning "you complete the GitHub handshake in the AWS console."
fi

# Deploy the CI/CD pipeline
print_status "Deploying CI/CD pipeline CloudFormation stack..."

if ! aws cloudformation deploy \
    --template-file cicd/pipeline-clean.yaml \
    --stack-name "$STACK_NAME" \
    --capabilities CAPABILITY_NAMED_IAM \
    --no-fail-on-empty-changeset \
    --parameter-overrides \
        ProjectName=engage \
        GitHubOwner=geseib \
        GitHubRepo=engagements \
        DevDomain="$DEV_DOMAIN" \
        TestDomain="$TEST_DOMAIN" \
        ProdDomain="$PROD_DOMAIN" \
        HostedZoneId="$HOSTED_ZONE_ID" \
        GitHubConnectionArn="$GITHUB_CONNECTION_ARN" \
    --tags \
        Project=engage \
        Purpose=CICD \
    --profile adminaccess; then
    print_error "CI/CD pipeline deployment failed"
    exit 1
fi

print_success "✅ CI/CD pipeline deployed successfully"

# Verify the GitHub connection is actually usable. A brand-new connection is
# created in PENDING and cannot fetch source until a human completes the GitHub
# handshake in the console — the pipelines will fail at Source until then.
CONNECTION_ARN=$(aws codestar-connections list-connections \
    --query "Connections[?ConnectionName=='engage-github-connection'].ConnectionArn | [0]" \
    --output text \
    --profile adminaccess 2>/dev/null || echo "")

if [ -n "$CONNECTION_ARN" ] && [ "$CONNECTION_ARN" != "None" ]; then
    CONNECTION_STATUS=$(aws codestar-connections get-connection \
        --connection-arn "$CONNECTION_ARN" \
        --query 'Connection.ConnectionStatus' \
        --output text \
        --profile adminaccess 2>/dev/null || echo "UNKNOWN")
    if [ "$CONNECTION_STATUS" = "AVAILABLE" ]; then
        print_success "✅ GitHub connection is AVAILABLE"
    else
        print_warning "⚠️  GitHub connection status is $CONNECTION_STATUS (expected AVAILABLE)"
        echo "   Finish the handshake in the console, then re-run any failed pipeline:"
        echo "   https://console.aws.amazon.com/codesuite/settings/connections"
    fi
else
    print_warning "⚠️  Could not read the engage-github-connection status"
fi

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
        "stack": "engagedev",
        "branch": "dev",
        "tagPattern": "dev-v*",
        "manualApproval": false
      },
      "test": {
        "name": "$TEST_PIPELINE_NAME",
        "url": "$TEST_PIPELINE_URL",
        "stack": "engagetest",
        "branch": "test",
        "tagPattern": "test-v*",
        "manualApproval": false
      },
      "prod": {
        "name": "$PROD_PIPELINE_NAME",
        "url": "$PROD_PIPELINE_URL",
        "stack": "engageprod",
        "branch": "prod",
        "tagPattern": "prod-v*",
        "manualApproval": true
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
    "connectionName": "engage-github-connection",
    "branches": ["dev", "test", "prod"],
    "tagPatterns": ["dev-v*", "test-v*", "prod-v*"]
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
echo "2. 🔧 Triggers (branch push OR matching tag push — either starts the pipeline):"
echo "   - push 'dev'  branch  or  tag dev-v*   → engagedev   (auto)"
echo "   - push 'test' branch  or  tag test-v*  → engagetest  (auto)"
echo "   - push 'prod' branch  or  tag prod-v*  → engageprod  (MANUAL APPROVAL first)"
echo ""
echo "3. 🏷️  Tag a release:"
echo "   git tag dev-v1.3.0 && git push origin dev-v1.3.0"
echo "   git tag --sort=-creatordate | grep '^prod-'   # what shipped to prod"
echo ""
echo "4. 📋 Manual deployment commands (if needed):"
echo "   ./scripts/deploy-clean.sh engagedev engage.dev.seibtribe.us"
echo "   ./scripts/deploy-clean.sh engagetest engage.test.seibtribe.us"
echo "   ./scripts/deploy-clean.sh engageprod engage.seibtribe.us"
echo ""

print_success "🎉 CI/CD Pipeline deployment completed successfully!"
print_status "The pipeline is now ready to deploy your engagements platform automatically."
