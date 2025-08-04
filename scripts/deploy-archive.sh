#!/bin/bash

# Archive Service Deployment Script
# This deploys the shared archive service that all environments can connect to

set -e

echo "🚀 Starting Archive Service deployment..."

# Variables
STACK_NAME="engage2-archive-service"
TEMPLATE_FILE="template-archive.yaml"
DOMAIN_NAME="archive.seibtribe.us"
HOSTED_ZONE_ID="ZB9TUA073B5SH"
AWS_REGION="us-east-1"

# Use adminaccess profile if AWS_PROFILE not set
if [ -z "$AWS_PROFILE" ]; then
    export AWS_PROFILE=adminaccess
    echo -e "${YELLOW}[INFO]${NC} Using AWS profile: adminaccess"
fi

# Color codes for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${YELLOW}[INFO]${NC} Stack Name: ${STACK_NAME}"
echo -e "${YELLOW}[INFO]${NC} Domain: ${DOMAIN_NAME}"
echo -e "${YELLOW}[INFO]${NC} Region: ${AWS_REGION}"

# Build the SAM application
echo -e "${YELLOW}[INFO]${NC} Building archive service..."
sam build -t ${TEMPLATE_FILE}

if [ $? -eq 0 ]; then
    echo -e "${GREEN}[SUCCESS]${NC} Build completed"
else
    echo -e "${RED}[ERROR]${NC} Build failed"
    exit 1
fi

# Deploy the stack
echo -e "${YELLOW}[INFO]${NC} Deploying archive service stack..."
sam deploy \
    --stack-name ${STACK_NAME} \
    --template-file .aws-sam/build/template.yaml \
    --capabilities CAPABILITY_IAM \
    --parameter-overrides \
        DomainName=${DOMAIN_NAME} \
        HostedZoneId=${HOSTED_ZONE_ID} \
    --resolve-s3 \
    --no-confirm-changeset \
    --no-fail-on-empty-changeset

if [ $? -eq 0 ]; then
    echo -e "${GREEN}[SUCCESS]${NC} Deployment completed"
else
    echo -e "${RED}[ERROR]${NC} Deployment failed"
    exit 1
fi

# Get stack outputs
echo -e "${YELLOW}[INFO]${NC} Retrieving stack outputs..."
ARCHIVE_API_URL=$(aws cloudformation describe-stacks \
    --stack-name ${STACK_NAME} \
    --query "Stacks[0].Outputs[?OutputKey=='ArchiveApiUrl'].OutputValue" \
    --output text)

ARCHIVE_DOMAIN_URL=$(aws cloudformation describe-stacks \
    --stack-name ${STACK_NAME} \
    --query "Stacks[0].Outputs[?OutputKey=='ArchiveDomainUrl'].OutputValue" \
    --output text)

ARCHIVE_TABLE_NAME=$(aws cloudformation describe-stacks \
    --stack-name ${STACK_NAME} \
    --query "Stacks[0].Outputs[?OutputKey=='ArchiveTableName'].OutputValue" \
    --output text)

ARCHIVE_BUCKET_NAME=$(aws cloudformation describe-stacks \
    --stack-name ${STACK_NAME} \
    --query "Stacks[0].Outputs[?OutputKey=='ArchiveBucketName'].OutputValue" \
    --output text)

echo -e "${GREEN}[SUCCESS]${NC} === ARCHIVE SERVICE DEPLOYMENT SUMMARY ==="
echo "Archive API URL: ${ARCHIVE_API_URL}"
echo "Archive Domain URL: ${ARCHIVE_DOMAIN_URL}"
echo "DynamoDB Table: ${ARCHIVE_TABLE_NAME}"
echo "S3 Bucket: ${ARCHIVE_BUCKET_NAME}"

# Create a configuration file for the main app to use
CONFIG_FILE="config/archive-service.json"
mkdir -p config

cat > ${CONFIG_FILE} << EOF
{
  "archiveServiceUrl": "${ARCHIVE_DOMAIN_URL}",
  "archiveApiUrl": "${ARCHIVE_API_URL}",
  "tableName": "${ARCHIVE_TABLE_NAME}",
  "bucketName": "${ARCHIVE_BUCKET_NAME}",
  "region": "${AWS_REGION}"
}
EOF

echo -e "${GREEN}[SUCCESS]${NC} Configuration saved to: ${CONFIG_FILE}"
echo -e "${GREEN}[SUCCESS]${NC} Archive service deployment completed successfully!"
echo ""
echo "Next steps:"
echo "1. Update the main app to use the archive service URL: ${ARCHIVE_DOMAIN_URL}"
echo "2. Configure CORS if needed for specific domains"
echo "3. Set up API key authentication if required"