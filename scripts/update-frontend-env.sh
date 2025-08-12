#!/bin/bash

# Script to update frontend .env file with Cognito values from CloudFormation stack
STACK_NAME=${1:-engdev}
ENV_FILE="src/.env"

echo "Updating frontend environment variables from CloudFormation stack: $STACK_NAME"

# Get values from CloudFormation stack outputs
USER_POOL_ID=$(AWS_PROFILE=adminaccess aws cloudformation describe-stacks --stack-name $STACK_NAME --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" --output text)
CLIENT_ID=$(AWS_PROFILE=adminaccess aws cloudformation describe-stacks --stack-name $STACK_NAME --query "Stacks[0].Outputs[?OutputKey=='UserPoolClientId'].OutputValue" --output text)
API_URL=$(AWS_PROFILE=adminaccess aws cloudformation describe-stacks --stack-name $STACK_NAME --query "Stacks[0].Outputs[?OutputKey=='RestApiUrl'].OutputValue" --output text)
WS_URL=$(AWS_PROFILE=adminaccess aws cloudformation describe-stacks --stack-name $STACK_NAME --query "Stacks[0].Outputs[?OutputKey=='WebSocketUrl'].OutputValue" --output text)

if [ -z "$USER_POOL_ID" ] || [ -z "$CLIENT_ID" ]; then
    echo "Error: Could not retrieve Cognito values from stack outputs"
    echo "USER_POOL_ID: $USER_POOL_ID"
    echo "CLIENT_ID: $CLIENT_ID"
    exit 1
fi

echo "Retrieved values:"
echo "USER_POOL_ID: $USER_POOL_ID"
echo "CLIENT_ID: $CLIENT_ID"
echo "API_URL: $API_URL"
echo "WS_URL: $WS_URL"

# Update .env file
cat > $ENV_FILE << EOF
# Cognito Configuration
REACT_APP_USER_POOL_ID=$USER_POOL_ID
REACT_APP_CLIENT_ID=$CLIENT_ID

# API Configuration
REACT_APP_API_URL=$API_URL
REACT_APP_WS_URL=$WS_URL
EOF

echo "Updated $ENV_FILE with CloudFormation stack outputs"
echo "Frontend can now authenticate with Cognito!"