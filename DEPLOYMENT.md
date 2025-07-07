# Engagements Platform - Deployment Guide

## Quick Start

### 🚀 One-Time Setup
```bash
# 1. Setup CI/CD Pipeline (one-time)
./scripts/setup-cicd.sh

# 2. Create environment branches
git checkout -b dev
git push origin dev
git checkout -b test  
git push origin test
```

### 🔄 Daily Development Workflow
```bash
# Deploy your feature to dev environment
git push origin your-feature-branch:dev

# Check deployment at: https://engagedev.sb.seibtribe.us
```

## Environment URLs

| Environment | URL | Branch | Deployment |
|-------------|-----|--------|------------|
| 🟢 **Development** | https://engagedev.sb.seibtribe.us | `dev` | Automatic |
| 🟡 **Test** | https://engagetest.sb.seibtribe.us | `test` | Automatic |
| 🔴 **Production** | https://engagements.sb.seibtribe.us | `main` | Manual Approval |

## Pipeline URLs

After running `./scripts/setup-cicd.sh`, you'll get URLs to monitor your deployments:

- **Dev Pipeline**: Monitor dev deployments
- **Test Pipeline**: Monitor test deployments  
- **Prod Pipeline**: Monitor production deployments (with approval)

## Common Commands

### Deploy Feature to Dev
```bash
# Option 1: Push feature branch to dev
git push origin feature-name:dev

# Option 2: Merge to dev branch
git checkout dev
git merge feature-name
git push origin dev
```

### Promote to Test
```bash
git checkout test
git merge dev
git push origin test
```

### Deploy to Production
```bash
git checkout main
git merge test
git push origin main
# Then approve in AWS Console
```

### Manual Deployment (Local)
```bash
# Deploy to dev manually
./scripts/deploy-dev.sh

# Deploy to test manually  
./scripts/deploy-test.sh

# Deploy to production manually
./scripts/deploy-prod.sh
```

## Troubleshooting

### Build Failed?
1. Check the pipeline in AWS Console
2. Look at CodeBuild logs
3. Common issues:
   - Node.js dependency conflicts
   - SAM template syntax errors
   - Missing environment variables

### Frontend Not Loading?
1. Check if API endpoints are correct
2. Verify S3 bucket deployment
3. Check CloudFront distribution

### API Not Working?
1. Check CloudFormation stack status
2. Verify Lambda function deployment
3. Check API Gateway configuration

## Architecture

```
GitHub Repo
├── dev branch    → Auto-deploy → engagedev.sb.seibtribe.us
├── test branch   → Auto-deploy → engagetest.sb.seibtribe.us
└── main branch   → Manual approval → engagements.sb.seibtribe.us
```

## File Structure

```
├── template-dev.yaml          # Dev environment CloudFormation
├── template-test.yaml         # Test environment CloudFormation  
├── template-prod.yaml         # Prod environment CloudFormation
├── template-cicd.yaml         # CI/CD pipeline infrastructure
├── samconfig-dev.toml         # Dev SAM configuration
├── samconfig-test.toml        # Test SAM configuration
├── samconfig-prod.toml        # Prod SAM configuration
└── scripts/
    ├── setup-cicd.sh          # One-time CI/CD setup
    ├── deploy-dev.sh          # Manual dev deployment
    ├── deploy-test.sh         # Manual test deployment
    └── deploy-prod.sh         # Manual prod deployment
```

## Best Practices

### ✅ Do
- Test locally before pushing
- Use feature branches
- Deploy to dev first, then test, then prod
- Monitor pipeline execution
- Check application after deployment

### ❌ Don't
- Push directly to main branch
- Skip testing in dev/test environments
- Deploy to production without approval
- Ignore build failures
- Hardcode environment-specific values

## Getting Help

1. **Pipeline Issues**: Check AWS CodePipeline console
2. **Build Issues**: Check AWS CodeBuild logs
3. **Infrastructure Issues**: Check CloudFormation events
4. **Application Issues**: Check CloudWatch logs

## Emergency Procedures

### Rollback Production
```bash
# Option 1: Revert the commit and redeploy
git revert <commit-hash>
git push origin main
# Approve in AWS Console

# Option 2: Rollback CloudFormation stack
aws cloudformation cancel-update-stack --stack-name engagements-prod
```

### Disable Auto-Deployment
```bash
# Temporarily disable a pipeline
aws codepipeline stop-pipeline-execution --pipeline-name engagements-cicd-dev-pipeline
```

---

**Need help?** Check the detailed documentation in `docs/05-cicd-setup.md` or contact the development team.
