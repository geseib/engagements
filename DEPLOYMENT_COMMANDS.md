# 🚀 Deployment Commands

Quick reference for deploying the Engagements Platform to different environments.

## Development Environment

### Full Deployment (Backend + Frontend)
```bash
# Option 1: Run the custom script directly
./scripts/deploy-dev-full.sh

# Option 2: Use npm script
npm run deploy:dev
```

**What it does:**
1. Deploys AWS SAM stack to `engdev` environment
2. Deploys React frontend to S3 + CloudFront
3. Configures all endpoints and domains
4. Provides complete deployment summary

**Output:**
- Backend: AWS Lambda functions, API Gateway, DynamoDB
- Frontend: https://eng.dev.seibtribe.us
- WebSocket: Real-time communication endpoints

### Individual Deployments

#### Backend Only
```bash
# Option 1: Direct script
./scripts/deploy-clean.sh engdev eng.dev.seibtribe.us

# Option 2: npm script
npm run deploy:backend
```

#### Frontend Only
```bash
# Option 1: Direct script
./scripts/deploy-frontend-eng.sh

# Option 2: npm script
npm run deploy:frontend
```

## Other Environments

### Test Environment
```bash
./scripts/deploy-clean.sh engtest engagetest.sb.seibtribe.us
# Frontend deployment script for test environment would need to be created
```

### Production Environment
```bash
./scripts/deploy-clean.sh engprod engagements.sb.seibtribe.us
# Frontend deployment script for prod environment would need to be created
```

## Cleanup

### Remove AWS SAM Build Artifacts
```bash
# Option 1: Direct script
node scripts/clean-aws-sam.js

# Option 2: npm script
npm run clean
```

## Usage Examples

### After Making Backend Changes
```bash
# Deploy only backend
npm run deploy:backend

# Or full deployment if frontend also changed
npm run deploy:dev
```

### After Making Frontend Changes
```bash
# Deploy only frontend (faster)
npm run deploy:frontend

# Or full deployment for complete sync
npm run deploy:dev
```

### Starting Fresh
```bash
# Clean build artifacts
npm run clean

# Full deployment
npm run deploy:dev
```

## Deployment Flow

```
npm run deploy:dev
    ↓
1. Backend Deployment
   - AWS SAM build
   - CloudFormation stack update
   - Lambda functions deployed
   - API Gateway configured
   - DynamoDB tables created/updated
    ↓
2. Frontend Deployment
   - React app build
   - S3 upload
   - CloudFront distribution
   - Environment config updated
    ↓
3. Success Summary
   - All endpoints listed
   - Deployment metrics
   - Ready to use!
```

## Environment URLs

| Environment | Frontend URL | Status |
|-------------|-------------|---------|
| Development | https://eng.dev.seibtribe.us | ✅ Active |
| Test | https://engagetest.sb.seibtribe.us | ⚠️ Manual deployment |
| Production | https://engagements.sb.seibtribe.us | ⚠️ Manual deployment |

## Troubleshooting

### Common Issues

**Backend deployment fails:**
```bash
# Check AWS credentials
aws sts get-caller-identity

# Check SAM CLI version
sam --version

# Clean and retry
npm run clean
npm run deploy:backend
```

**Frontend deployment fails:**
```bash
# Check if backend is deployed first
npm run deploy:backend

# Then try frontend
npm run deploy:frontend
```

**Environment config issues:**
```bash
# Check CloudFormation stack exists
aws cloudformation describe-stacks --stack-name engdev

# Verify S3 bucket exists
aws s3 ls | grep engdev
```

## Performance Tips

- **Backend-only changes**: Use `npm run deploy:backend` (faster)
- **Frontend-only changes**: Use `npm run deploy:frontend` (faster)
- **Full deployment**: Use `npm run deploy:dev` (comprehensive)
- **Clean slate**: Run `npm run clean` before deployment if issues occur