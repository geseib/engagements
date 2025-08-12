#!/bin/bash

# Setup script for Google OAuth parameters in AWS Parameter Store
# This script helps securely store OAuth credentials for each environment

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Google OAuth Parameter Store Setup${NC}"
echo "This script will help you store Google OAuth credentials securely in AWS Parameter Store"
echo

# Function to create parameter
create_parameter() {
    local env=$1
    local param_name=$2
    local param_value=$3
    local is_secure=$4
    
    local type="String"
    if [ "$is_secure" = "true" ]; then
        type="SecureString"
    fi
    
    echo -e "${YELLOW}Creating parameter: $param_name${NC}"
    
    if aws ssm get-parameter --name "$param_name" --region us-east-1 $AWS_PROFILE_FLAG &>/dev/null; then
        echo -e "${YELLOW}Parameter $param_name already exists. Updating...${NC}"
        aws ssm put-parameter \
            --name "$param_name" \
            --value "$param_value" \
            --type "$type" \
            --overwrite \
            --region us-east-1 \
            $AWS_PROFILE_FLAG
    else
        aws ssm put-parameter \
            --name "$param_name" \
            --value "$param_value" \
            --type "$type" \
            --region us-east-1 \
            $AWS_PROFILE_FLAG
    fi
    
    echo -e "${GREEN}✓ Parameter $param_name created successfully${NC}"
}

# Check for AWS profile
AWS_PROFILE_FLAG=""
if [ ! -z "$AWS_PROFILE" ]; then
    AWS_PROFILE_FLAG="--profile $AWS_PROFILE"
    echo -e "${YELLOW}Using AWS profile: $AWS_PROFILE${NC}"
elif aws sts get-caller-identity --profile adminaccess &>/dev/null; then
    AWS_PROFILE_FLAG="--profile adminaccess"
    echo -e "${YELLOW}Using AWS profile: adminaccess${NC}"
fi

# Check AWS CLI is configured
if ! aws sts get-caller-identity $AWS_PROFILE_FLAG &>/dev/null; then
    echo -e "${RED}Error: AWS CLI not configured or no valid credentials${NC}"
    echo "Please run one of the following:"
    echo "  aws configure"
    echo "  export AWS_PROFILE=adminaccess"
    echo "  aws sso login --profile adminaccess"
    exit 1
fi

echo -e "${GREEN}AWS credentials verified${NC}"
echo

# Environment selection
echo "Which environment are you setting up?"
echo "1) dev"
echo "2) test" 
echo "3) prod"
read -p "Enter choice (1-3): " env_choice

case $env_choice in
    1) ENV="dev"; STACK="engdev" ;;
    2) ENV="test"; STACK="engtest" ;;
    3) ENV="prod"; STACK="engprod" ;;
    *) echo -e "${RED}Invalid choice${NC}"; exit 1 ;;
esac

echo -e "${GREEN}Setting up parameters for environment: $ENV${NC}"
echo

# Get Google OAuth credentials
echo -e "${YELLOW}Please provide your Google OAuth credentials:${NC}"
read -p "Google Client ID: " client_id
read -s -p "Google Client Secret: " client_secret
echo

if [ -z "$client_id" ] || [ -z "$client_secret" ]; then
    echo -e "${RED}Error: Both Client ID and Client Secret are required${NC}"
    exit 1
fi

# Create parameters
CLIENT_ID_PARAM="/$STACK/oauth/google/client-id"
CLIENT_SECRET_PARAM="/$STACK/oauth/google/client-secret"

create_parameter "$ENV" "$CLIENT_ID_PARAM" "$client_id" "false"
create_parameter "$ENV" "$CLIENT_SECRET_PARAM" "$client_secret" "true"

echo
echo -e "${GREEN}✓ All parameters created successfully!${NC}"
echo
echo "Parameter paths created:"
echo "  Client ID: $CLIENT_ID_PARAM"
echo "  Client Secret: $CLIENT_SECRET_PARAM (SecureString)"
echo
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Update your SAM config to use these parameter paths"
echo "2. Deploy your stack with: sam deploy --config-file samconfig-$ENV-local.toml"
echo
echo -e "${GREEN}Google OAuth setup complete for $ENV environment!${NC}"