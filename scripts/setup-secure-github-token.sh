#!/bin/bash

# Secure GitHub Token Setup for CI/CD
# This script stores the GitHub PAT securely in AWS Secrets Manager

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

print_header() {
    echo -e "${BLUE}============================================${NC}"
    echo -e "${BLUE}    Secure GitHub Token Setup${NC}"
    echo -e "${BLUE}============================================${NC}"
    echo ""
}

print_step() {
    echo -e "${GREEN}[STEP]${NC} $1"
}

print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

# Check for required parameters
if [ $# -lt 1 ]; then
    echo "Usage: $0 <environment> [github-token]"
    echo ""
    echo "Examples:"
    echo "  $0 test                    # Prompts for token"
    echo "  $0 prod ghp_xxxxx          # Provides token directly"
    echo ""
    echo "Environments: test, prod"
    exit 1
fi

ENVIRONMENT=$1
GITHUB_TOKEN=$2

# Validate environment
if [[ ! "$ENVIRONMENT" =~ ^(dev|test|prod)$ ]]; then
    print_error "Invalid environment. Must be 'dev', 'test', or 'prod'"
    exit 1
fi

# Set stack name based on environment
if [ "$ENVIRONMENT" == "dev" ]; then
    STACK_NAME="engdev"
    SECRET_NAME="engage/dev/github-token"
elif [ "$ENVIRONMENT" == "test" ]; then
    STACK_NAME="engtest"
    SECRET_NAME="engage/test/github-token"
elif [ "$ENVIRONMENT" == "prod" ]; then
    STACK_NAME="engprod"
    SECRET_NAME="engage/prod/github-token"
fi

print_header

print_step "1. GitHub Token Configuration"
echo ""

# If token not provided, prompt for it
if [ -z "$GITHUB_TOKEN" ]; then
    echo "📚 GitHub Personal Access Token Requirements:"
    echo "   - Go to: https://github.com/settings/tokens"
    echo "   - Create token named: 'Engage2 $(echo $ENVIRONMENT | tr '[:lower:]' '[:upper:]') Environment'"
    echo "   - Required scope: 'public_repo' (for public repos)"
    echo "   - Copy token immediately (shown only once!)"
    echo ""
    
    read -p "Enter your GitHub Personal Access Token: " -s GITHUB_TOKEN
    echo ""
    
    if [ -z "$GITHUB_TOKEN" ]; then
        print_error "Token cannot be empty!"
        exit 1
    fi
fi

# Validate token format
if [[ ! "$GITHUB_TOKEN" =~ ^(ghp_|github_pat_) ]]; then
    print_warning "Token doesn't match expected format (ghp_* or github_pat_*)"
    read -p "Continue anyway? (y/n): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

print_step "2. Storing Token in AWS Secrets Manager"
echo ""

# Check if AWS CLI is configured
if ! aws sts get-caller-identity > /dev/null 2>&1; then
    print_error "AWS CLI not configured. Please configure with: aws configure"
    exit 1
fi

# Store or update the secret
print_info "Storing token in Secrets Manager as: $SECRET_NAME"

# Check if secret exists
if aws secretsmanager describe-secret --secret-id "$SECRET_NAME" > /dev/null 2>&1; then
    # Update existing secret
    aws secretsmanager update-secret \
        --secret-id "$SECRET_NAME" \
        --secret-string "{\"GITHUB_TOKEN\":\"$GITHUB_TOKEN\"}" \
        --description "GitHub PAT for Engage2 $ENVIRONMENT environment CI/CD" \
        > /dev/null 2>&1
    
    print_success "Updated existing secret: $SECRET_NAME"
else
    # Create new secret
    aws secretsmanager create-secret \
        --name "$SECRET_NAME" \
        --description "GitHub PAT for Engage2 $ENVIRONMENT environment CI/CD" \
        --secret-string "{\"GITHUB_TOKEN\":\"$GITHUB_TOKEN\"}" \
        --tags "[{\"Key\":\"Environment\",\"Value\":\"$ENVIRONMENT\"},{\"Key\":\"Project\",\"Value\":\"engage2\"},{\"Key\":\"Purpose\",\"Value\":\"CI-CD\"}]" \
        > /dev/null 2>&1
    
    print_success "Created new secret: $SECRET_NAME"
fi

print_step "3. Grant CodeBuild Access to Secret"
echo ""

# Get CodeBuild role ARN
CODEBUILD_ROLE_ARN=$(aws iam get-role --role-name "engagecicd-codebuild" --query 'Role.Arn' --output text 2>/dev/null || echo "")

if [ -z "$CODEBUILD_ROLE_ARN" ]; then
    print_warning "CodeBuild role 'engagecicd-codebuild' not found"
    print_info "You'll need to update the CodeBuild IAM role manually to access the secret"
else
    print_info "CodeBuild role found: $CODEBUILD_ROLE_ARN"
    
    # Create policy for secret access
    POLICY_NAME="EngageSecretsAccess-$ENVIRONMENT"
    POLICY_DOC=$(cat <<EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "secretsmanager:GetSecretValue",
                "secretsmanager:DescribeSecret"
            ],
            "Resource": "arn:aws:secretsmanager:*:*:secret:engage/$ENVIRONMENT/*"
        }
    ]
}
EOF
)
    
    # Check if policy already exists
    if aws iam get-role-policy --role-name "engagecicd-codebuild" --policy-name "$POLICY_NAME" > /dev/null 2>&1; then
        print_info "Policy already exists, updating..."
        aws iam put-role-policy \
            --role-name "engagecicd-codebuild" \
            --policy-name "$POLICY_NAME" \
            --policy-document "$POLICY_DOC"
    else
        print_info "Creating new policy..."
        aws iam put-role-policy \
            --role-name "engagecicd-codebuild" \
            --policy-name "$POLICY_NAME" \
            --policy-document "$POLICY_DOC"
    fi
    
    print_success "CodeBuild role updated with secret access permissions"
fi

print_step "4. Update CI/CD Pipeline"
echo ""

echo "The CI/CD pipeline needs to be updated to retrieve the token from Secrets Manager."
echo ""
echo "Next steps:"
echo "1. Update the buildspec.yml to retrieve the token:"
echo ""
echo -e "${YELLOW}pre_build:"
echo "  commands:"
echo "    - echo Retrieving GitHub token from Secrets Manager..."
echo "    - export GITHUB_TOKEN=\$(aws secretsmanager get-secret-value --secret-id $SECRET_NAME --query SecretString --output text | jq -r .GITHUB_TOKEN)"
echo -e "${NC}"
echo ""
echo "2. Update template-clean.yaml to pass the token to Lambda functions"
echo "3. Redeploy the CI/CD stack"
echo ""

print_step "5. Verification"
echo ""

# Verify the secret can be retrieved
print_info "Verifying secret retrieval..."
if aws secretsmanager get-secret-value --secret-id "$SECRET_NAME" --query SecretString > /dev/null 2>&1; then
    print_success "Secret successfully stored and retrievable"
else
    print_error "Unable to retrieve secret. Check permissions."
    exit 1
fi

print_success "✅ GitHub token securely stored in AWS Secrets Manager!"
echo ""
print_info "Secret Name: $SECRET_NAME"
print_info "Environment: $ENVIRONMENT"
echo ""
print_warning "IMPORTANT: Never store the token in configuration files or code!"
print_warning "The token is now securely stored and will be retrieved at runtime."
echo ""
echo "To deploy with the secure token:"
echo "  1. Ensure buildspec.yml retrieves the token from Secrets Manager"
echo "  2. Push changes to the $ENVIRONMENT branch"
echo "  3. CodeBuild will automatically retrieve the token during build"