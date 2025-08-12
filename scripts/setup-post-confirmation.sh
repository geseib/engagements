#!/bin/bash

# Script to configure PostConfirmation Lambda trigger for Cognito User Pool
# This is done post-deployment to avoid circular dependencies in CloudFormation

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if stack name is provided
if [ -z "$1" ]; then
    echo -e "${RED}Error: Stack name is required${NC}"
    echo "Usage: $0 <stack-name>"
    echo "Example: $0 engdev"
    exit 1
fi

STACK_NAME=$1
PROFILE="adminaccess"
REGION="us-east-1"

echo -e "${YELLOW}Setting up PostConfirmation trigger for stack: ${STACK_NAME}${NC}"

# Get the User Pool ID from CloudFormation stack
echo "Getting User Pool ID..."
USER_POOL_ID=$(AWS_PROFILE=$PROFILE aws cloudformation describe-stacks \
    --stack-name $STACK_NAME \
    --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" \
    --output text \
    --region $REGION)

if [ -z "$USER_POOL_ID" ]; then
    echo -e "${RED}Error: Could not find User Pool ID in stack outputs${NC}"
    exit 1
fi

echo "User Pool ID: $USER_POOL_ID"

# Get the PostConfirmation Function ARN
echo "Getting PostConfirmation Function ARN..."
FUNCTION_ARN=$(AWS_PROFILE=$PROFILE aws cloudformation describe-stack-resources \
    --stack-name $STACK_NAME \
    --query "StackResources[?LogicalResourceId=='PostConfirmationFunction'].PhysicalResourceId" \
    --output text \
    --region $REGION)

if [ -z "$FUNCTION_ARN" ]; then
    echo -e "${RED}Error: Could not find PostConfirmationFunction in stack${NC}"
    exit 1
fi

# Convert function name to ARN if needed
if [[ ! "$FUNCTION_ARN" == arn:* ]]; then
    FUNCTION_ARN="arn:aws:lambda:${REGION}:$(AWS_PROFILE=$PROFILE aws sts get-caller-identity --query Account --output text):function:${FUNCTION_ARN}"
fi

echo "PostConfirmation Function ARN: $FUNCTION_ARN"

# Grant Cognito permission to invoke the Lambda function
echo "Adding Lambda permission for Cognito..."
AWS_PROFILE=$PROFILE aws lambda add-permission \
    --function-name $FUNCTION_ARN \
    --statement-id CognitoPostConfirmationTrigger \
    --action lambda:InvokeFunction \
    --principal cognito-idp.amazonaws.com \
    --source-arn "arn:aws:cognito-idp:${REGION}:$(AWS_PROFILE=$PROFILE aws sts get-caller-identity --query Account --output text):userpool/${USER_POOL_ID}" \
    --region $REGION 2>/dev/null || echo "Permission already exists (this is OK)"

# Update the User Pool to add the PostConfirmation trigger
echo "Updating User Pool with PostConfirmation trigger..."
AWS_PROFILE=$PROFILE aws cognito-idp update-user-pool \
    --user-pool-id $USER_POOL_ID \
    --lambda-config PostConfirmation=$FUNCTION_ARN \
    --auto-verified-attributes email \
    --region $REGION

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ PostConfirmation trigger successfully configured!${NC}"
    echo ""
    echo "New users will now automatically be added to the 'pending' group upon registration."
    echo ""
    echo "Group workflow:"
    echo "  1. User registers → Automatically added to 'pending' group"
    echo "  2. Admin reviews → Moves user to 'hosts' or 'admins' group"
    echo "  3. If needed → Can move to 'disabled' or delete user"
else
    echo -e "${RED}❌ Error updating User Pool${NC}"
    exit 1
fi

# Verify the configuration
echo ""
echo "Verifying configuration..."
CONFIGURED_TRIGGER=$(AWS_PROFILE=$PROFILE aws cognito-idp describe-user-pool \
    --user-pool-id $USER_POOL_ID \
    --query "UserPool.LambdaConfig.PostConfirmation" \
    --output text \
    --region $REGION)

if [ "$CONFIGURED_TRIGGER" == "$FUNCTION_ARN" ]; then
    echo -e "${GREEN}✅ Verification successful: PostConfirmation trigger is properly configured${NC}"
else
    echo -e "${YELLOW}⚠️ Warning: Trigger may not be properly configured. Please check manually.${NC}"
fi