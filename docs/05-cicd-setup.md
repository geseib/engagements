# CI/CD Pipeline Setup

## Overview

This document describes the automated CI/CD pipeline setup for the Engagements Platform using AWS CodePipeline, CodeBuild, and GitHub integration.

## Environment Strategy

### Environment Naming Convention
- **Development**: `engagedev.sb.seibtribe.us` (Stack: `engagements-dev`)
- **Test**: `engagetest.sb.seibtribe.us` (Stack: `engagements-test`)
- **Production**: `engagements.sb.seibtribe.us` (Stack: `engagements-prod`)

### Branch Strategy
- **`dev` branch** → Auto-deploy to Development environment
- **`test` branch** → Auto-deploy to Test environment  
- **`main` branch** → Manual approval required for Production deployment

## Architecture

### Pipeline Components
```
GitHub Repository
├── dev branch → CodePipeline → CodeBuild → Dev Environment
├── test branch → CodePipeline → CodeBuild → Test Environment
└── main branch → CodePipeline → Manual Approval → CodeBuild → Prod Environment
```

### Infrastructure Components
- **CodePipeline**: Orchestrates the deployment workflow
- **CodeBuild**: Builds and deploys both backend and frontend
- **S3 Bucket**: Stores pipeline artifacts
- **IAM Roles**: Secure access for pipeline operations
- **CloudFormation**: Infrastructure as Code deployment

## Setup Instructions

### 1. Prerequisites
- AWS CLI configured with appropriate permissions
- GitHub repository with the code
- GitHub Personal Access Token with `repo` and `admin:repo_hook` permissions

### 2. Deploy CI/CD Infrastructure
```bash
# Run the setup script
./scripts/setup-cicd.sh
```

This script will:
- Prompt for your GitHub Personal Access Token
- Deploy the CI/CD CloudFormation stack
- Create three separate pipelines (Dev, Test, Prod)
- Display pipeline URLs and next steps

### 3. Create Environment Branches
```bash
# Create and push dev branch
git checkout -b dev
git push origin dev

# Create and push test branch  
git checkout -b test
git push origin test
```

### 4. Verify Pipeline Execution
- Monitor pipeline execution in AWS Console
- Check CloudFormation stack deployment
- Verify applications are accessible at their respective URLs

## Pipeline Configuration

### Build Specifications

Each environment uses a CodeBuild project with the following phases:

#### Install Phase
- Install Node.js 18 runtime
- Install AWS SAM CLI
- Install Node.js dependencies (`npm ci`)

#### Build Phase
- Build SAM application (`sam build`)
- Deploy CloudFormation stack (`sam deploy`)
- Build React frontend (`npm run build`)
- Configure environment-specific API endpoints
- Deploy frontend to S3 (`aws s3 sync`)

#### Environment Variables
Each build project includes:
- `ENVIRONMENT`: Environment name (dev/test/prod)
- `DOMAIN_NAME`: Target domain for the environment
- `HOSTED_ZONE_ID`: Route53 hosted zone ID
- `STACK_NAME`: CloudFormation stack name

### SAM Configuration Files

#### Development (`samconfig-dev.toml`)
```toml
stack_name = "engagements-dev"
parameter_overrides = "DomainName=engagedev.sb.seibtribe.us HostedZoneId=Z03473042HSYD8BUY4XSL"
```

#### Test (`samconfig-test.toml`)
```toml
stack_name = "engagements-test"
parameter_overrides = "DomainName=engagetest.sb.seibtribe.us HostedZoneId=Z03473042HSYD8BUY4XSL"
```

#### Production (`samconfig-prod.toml`)
```toml
stack_name = "engagements-prod"
parameter_overrides = "DomainName=engagements.sb.seibtribe.us HostedZoneId=Z03473042HSYD8BUY4XSL"
```

## Deployment Workflow

### Automatic Deployments

#### Development Environment
1. Push code to `dev` branch
2. GitHub webhook triggers Dev pipeline
3. CodeBuild builds and deploys automatically
4. Application available at `https://engagedev.sb.seibtribe.us`

#### Test Environment
1. Push code to `test` branch
2. GitHub webhook triggers Test pipeline
3. CodeBuild builds and deploys automatically
4. Application available at `https://engagetest.sb.seibtribe.us`

### Manual Production Deployment
1. Push code to `main` branch
2. Production pipeline starts but waits for manual approval
3. Review changes and approve deployment in AWS Console
4. CodeBuild builds and deploys to production
5. Application available at `https://engagements.sb.seibtribe.us`

## Security & Permissions

### IAM Roles
- **CodePipelineServiceRole**: Manages pipeline execution
- **CodeBuildServiceRole**: Executes build and deployment tasks

### Permissions
- CloudFormation stack management
- Lambda function deployment
- API Gateway configuration
- S3 bucket operations
- Route53 DNS management
- DynamoDB table operations

### Secrets Management
- GitHub Personal Access Token stored in CloudFormation parameters
- AWS credentials managed through IAM roles
- No hardcoded secrets in code or configuration

## Monitoring & Troubleshooting

### Pipeline Monitoring
- **AWS Console**: Monitor pipeline execution status
- **CloudWatch Logs**: View detailed build logs
- **CloudFormation Events**: Track infrastructure changes

### Common Issues

#### Build Failures
- Check CodeBuild logs in CloudWatch
- Verify SAM template syntax
- Ensure all required parameters are provided

#### Deployment Failures
- Check CloudFormation stack events
- Verify IAM permissions
- Ensure domain and hosted zone configuration

#### Frontend Issues
- Verify S3 bucket permissions
- Check CloudFront distribution status
- Validate API endpoint configuration

### Debugging Commands
```bash
# Check pipeline status
aws codepipeline get-pipeline-state --name engagements-cicd-dev-pipeline

# View build logs
aws logs describe-log-groups --log-group-name-prefix /aws/codebuild/

# Check stack status
aws cloudformation describe-stacks --stack-name engagements-dev
```

## Manual Deployment Scripts

For local development and testing, manual deployment scripts are available:

```bash
# Deploy to development
./scripts/deploy-dev.sh

# Deploy to test
./scripts/deploy-test.sh

# Deploy to production (with confirmation)
./scripts/deploy-prod.sh
```

## Best Practices

### Development Workflow
1. Create feature branches from `dev`
2. Test locally before pushing
3. Push feature branch to `dev` for testing: `git push origin feature-branch:dev`
4. Merge to `test` branch for integration testing
5. Merge to `main` for production deployment

### Code Quality
- All deployments include automated testing
- Frontend builds must pass without errors
- Backend SAM templates must validate successfully

### Environment Isolation
- Each environment has separate AWS resources
- No shared databases or storage between environments
- Independent domain names and SSL certificates

## Rollback Strategy

### Automatic Rollback
- CloudFormation automatically rolls back failed deployments
- Previous application versions remain in S3 for quick restoration

### Manual Rollback
```bash
# Rollback CloudFormation stack
aws cloudformation cancel-update-stack --stack-name engagements-dev

# Restore previous frontend version
aws s3 sync s3://backup-bucket/previous-version/ s3://frontend-bucket/
```

## Cost Optimization

### Pipeline Costs
- CodePipeline: $1/month per active pipeline
- CodeBuild: Pay per build minute (typically <$5/month for small projects)
- S3 Storage: Minimal cost for artifacts

### Environment Costs
- Each environment includes: Lambda, API Gateway, DynamoDB, S3, CloudFront
- Estimated cost per environment: $10-50/month depending on usage
- Use TTL and lifecycle policies to minimize storage costs

This CI/CD setup provides a robust, scalable deployment pipeline that follows AWS best practices while maintaining security and cost efficiency.
