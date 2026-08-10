> ⚠️ **Superseded — see [`DEPLOYMENT.md`](DEPLOYMENT.md) for the canonical deployment guide.**
> Kept for history; the Secrets Manager / SSM flow is summarized there.

# SECURE DEPLOYMENT - QUICKSTART

## 🏃‍♂️ One-Time Setup (10 minutes)

### 1. Store GitHub Tokens Securely
```bash
# For test environment
./scripts/setup-secure-github-token.sh test

# For prod environment  
./scripts/setup-secure-github-token.sh prod
```

### 2. Update CI/CD Pipeline for Security  
```bash
AWS_PROFILE=adminaccess aws cloudformation deploy \
  --template-file cicd/pipeline-clean.yaml \
  --stack-name engagecicd \
  --capabilities CAPABILITY_NAMED_IAM
```

### 3. Activate GitHub Connection
- Go to AWS Console → CodePipeline → Settings → Connections
- Click the pending `engage-github-connection`
- Click "Update pending connection" and authorize

### 4. Update Buildspec
```bash
cp buildspec-secure.yml buildspec.yml
git add buildspec.yml && git commit -m "Use secure buildspec" && git push
```

## 🚀 Daily Operations

> **A branch push does NOT deploy** (changed 2026-08-10 — the pipelines are tag-triggered only).
> Pushing the branch shares the code; pushing the tag ships it. See `DEPLOYMENT.md`.

### Deploy to Test
```bash
git checkout test
git merge main
git push origin test                              # shares it — deploys nothing
git tag test-v1.3.0 && git push origin test-v1.3.0  # this is the deploy
```

### Deploy to Prod
```bash
git checkout prod  
git merge test
git push origin prod                              # shares it — deploys nothing
git tag prod-v1.3.0 && git push origin prod-v1.3.0  # starts the pipeline
# then approve at the ApprovalForProd stage in the CodePipeline console
```

### Verify Deployment
```bash
# Check pipeline status
aws codepipeline get-pipeline-state --name engagecicd-pipeline-test

# Check build logs
aws logs tail /aws/codebuild/engagecicd-build-test --follow
```

## 🔐 Token Management

### Rotate Tokens (Quarterly)
```bash
# Create new PAT on GitHub, then:
./scripts/setup-secure-github-token.sh test
# Immediately works - no deployments needed!
```

### Check Token Status
```bash
# Verify tokens are stored securely
aws secretsmanager list-secrets --filters Key=name,Values=engage/

# Test token retrieval (without exposing value)
aws secretsmanager get-secret-value --secret-id engage/test/github-token --query SecretString > /dev/null && echo "✅ Token accessible"
```

## ⚠️ Troubleshooting

### "Failed to retrieve GitHub token"
```bash
# Check secret exists
aws secretsmanager describe-secret --secret-id engage/test/github-token

# Re-run setup if needed
./scripts/setup-secure-github-token.sh test
```

### Pipeline Not Triggering
- Verify GitHub connection is active in AWS Console
- Check branch names match (test/prod)
- Verify repository permissions

### Lambda GitHub Integration Failing
- Check CloudFormation passes token parameter
- Verify Lambda environment variables
- Check Lambda logs for specific errors

## 📊 What Changed?

| Before (Insecure) | After (Secure) |
|-------------------|----------------|
| PAT in samconfig files | PAT in Secrets Manager |
| PAT visible in CloudFormation | PAT retrieved at runtime |
| PAT in git history risk | No tokens in code |
| Manual token management | Automated retrieval |

## 🎯 Benefits

✅ **Zero tokens in code** - No security risk in public repos  
✅ **Automatic retrieval** - CodeBuild gets tokens at runtime  
✅ **Easy rotation** - Update secret, no code changes  
✅ **Environment isolation** - Separate tokens per environment  
✅ **Audit trail** - CloudTrail logs all secret access  

---
**Status:** Production Ready  
**Security:** ✅ AWS Best Practices  
**Setup Time:** ~10 minutes one-time