# SECURE DEPLOYMENT GUIDE
## GitHub Token Security with AWS Secrets Manager

### 🔐 Security Overview
This guide implements secure handling of GitHub Personal Access Tokens (PATs) for CI/CD pipelines, eliminating the security risk of storing tokens in public repositories or configuration files.

**Key Security Improvements:**
- ✅ Tokens stored in AWS Secrets Manager (encrypted at rest)
- ✅ Retrieved at runtime by CodeBuild (not stored in code)
- ✅ IAM role-based access control
- ✅ No tokens in git history
- ✅ Environment-specific token isolation

## 📋 Prerequisites

1. **AWS CLI configured** with appropriate credentials
2. **GitHub Personal Access Token** (one for each environment)
3. **AWS IAM permissions** to create/manage secrets and IAM policies

## 🚀 Initial Setup

### Step 1: Create GitHub Personal Access Tokens

Create separate tokens for each environment for better security and auditability.

1. Go to https://github.com/settings/tokens
2. Create tokens with these specifications:

**Test Environment Token:**
- Name: `Engage2 TEST Environment`
- Expiration: 90 days (or your preference)
- Scope: `public_repo` (for public repos) or `repo` (for private)

**Production Environment Token:**
- Name: `Engage2 PROD Environment`
- Expiration: 90 days (or your preference)
- Scope: `public_repo` (for public repos) or `repo` (for private)

⚠️ **IMPORTANT:** Save these tokens immediately - GitHub only shows them once!

### Step 2: Store Tokens in AWS Secrets Manager

Use the secure setup script to store tokens:

```bash
# Store test environment token
./scripts/setup-secure-github-token.sh test

# Store prod environment token
./scripts/setup-secure-github-token.sh prod
```

The script will:
1. Prompt for your GitHub PAT
2. Store it encrypted in AWS Secrets Manager
3. Configure IAM permissions for CodeBuild access
4. Verify the storage was successful

**Secret Names Created:**
- Test: `engage/test/github-token`
- Prod: `engage/prod/github-token`

### Step 3: Update CI/CD Infrastructure

Update the existing CI/CD pipeline to add Secrets Manager support:

```bash
# Update the existing pipeline stack to add secure token retrieval
AWS_PROFILE=adminaccess aws cloudformation deploy \
  --template-file cicd/pipeline-clean.yaml \
  --stack-name engagecicd \
  --parameter-overrides \
    GitHubOwner=georgeseib \
    GitHubRepo=engage2 \
  --capabilities CAPABILITY_NAMED_IAM
```

### Step 4: Activate GitHub Connection

The new pipeline uses AWS CodeStar Connections for secure GitHub integration:

1. Go to AWS Console → CodePipeline → Settings → Connections
2. Find the pending connection named `engage-github-connection`
3. Click "Update pending connection"
4. Authorize with GitHub
5. Select your repository when prompted

### Step 5: Update Your Repository

Ensure your repository has the secure buildspec:

```bash
# Copy the secure buildspec to the root
cp buildspec-secure.yml buildspec.yml

# Commit and push
git add buildspec.yml
git commit -m "Use secure buildspec with Secrets Manager integration"
git push origin main
```

## 🔄 Deployment Workflow

### Automatic Deployments

Once configured, deployments are automatic:

1. **Test Environment:**
   ```bash
   git checkout test
   git merge main
   git push origin test
   ```
   - Pipeline triggers automatically
   - CodeBuild retrieves token from Secrets Manager
   - Deploys to test environment

2. **Production Environment:**
   ```bash
   git checkout prod
   git merge test
   git push origin prod
   ```
   - Pipeline triggers automatically
   - CodeBuild retrieves token from Secrets Manager
   - Deploys to production environment

### Manual Testing

To verify token retrieval is working:

```bash
# Check CodeBuild logs
aws logs tail /aws/logs/codebuild/engagecicd-build-test-secure --follow

# Verify secret exists
aws secretsmanager describe-secret --secret-id engage/test/github-token
```

## 🔧 Troubleshooting

### Issue: CodeBuild Cannot Retrieve Token

**Error:** "Failed to retrieve GitHub token from Secrets Manager"

**Solution:**
1. Verify the secret exists:
   ```bash
   aws secretsmanager list-secrets --filters Key=name,Values=engage/
   ```

2. Check IAM permissions:
   ```bash
   aws iam get-role-policy \
     --role-name engagecicd-codebuild-secure \
     --policy-name CodeBuildPolicy
   ```

3. Ensure the secret contains the correct structure:
   ```bash
   aws secretsmanager get-secret-value \
     --secret-id engage/test/github-token \
     --query SecretString
   ```

### Issue: GitHub Connection Not Working

**Error:** "Could not access the GitHub repository"

**Solution:**
1. Ensure the connection is activated (see Step 4)
2. Verify repository permissions
3. Check the connection status:
   ```bash
   aws codestar-connections list-connections
   ```

### Issue: Lambda Functions Not Getting Token

**Error:** "GitHub integration not configured" in Lambda logs

**Solution:**
1. Verify the SAM template passes the token to Lambda:
   ```yaml
   Environment:
     Variables:
       GITHUB_TOKEN: !Ref GitHubToken
   ```

2. Check CloudFormation parameters are being passed:
   ```bash
   aws cloudformation describe-stacks \
     --stack-name engtest \
     --query 'Stacks[0].Parameters[?ParameterKey==`GitHubToken`]'
   ```

## 🔐 Security Best Practices

### Token Rotation

Rotate tokens every 90 days:

```bash
# Generate new token on GitHub
# Update in Secrets Manager
./scripts/setup-secure-github-token.sh test

# No code changes needed - retrieved at runtime!
```

### Token Scoping

- Use minimum required permissions
- `public_repo` for public repositories
- Separate tokens per environment
- Consider fine-grained PATs for enhanced security

### Access Control

The setup implements least-privilege access:
- CodeBuild can only read secrets for its environment
- Secrets are encrypted at rest with AWS KMS
- Access is logged in CloudTrail

### Monitoring

Set up alerts for token usage:

```bash
# Create CloudWatch alarm for failed secret retrievals
aws cloudwatch put-metric-alarm \
  --alarm-name GitHubTokenRetrievalFailure \
  --alarm-description "Alert on GitHub token retrieval failures" \
  --metric-name Errors \
  --namespace AWS/Lambda \
  --statistic Sum \
  --period 300 \
  --threshold 1 \
  --comparison-operator GreaterThanThreshold
```

## 📝 Migration Checklist

When migrating from insecure to secure token handling:

- [ ] Create new GitHub PATs for each environment
- [ ] Store tokens in Secrets Manager using setup script
- [ ] Deploy secure CI/CD pipeline stack
- [ ] Activate GitHub connection in console
- [ ] Update buildspec.yml in repository
- [ ] Test deployment to test environment
- [ ] Test deployment to prod environment
- [ ] Remove any hardcoded tokens from:
  - [ ] samconfig files
  - [ ] Environment variables
  - [ ] Configuration files
  - [ ] Git history (if exposed)
- [ ] Update documentation
- [ ] Notify team of new process

## 🚨 Emergency Procedures

### If Token Is Compromised

1. **Immediately revoke** the token on GitHub
2. **Generate new token** with same permissions
3. **Update in Secrets Manager:**
   ```bash
   ./scripts/setup-secure-github-token.sh [environment]
   ```
4. **No deployment needed** - new token used automatically
5. **Audit logs** for any unauthorized usage

### Rollback to Previous System

If you need to temporarily rollback:

```bash
# Use original pipeline (NOT RECOMMENDED - security risk!)
aws cloudformation deploy \
  --template-file cicd/pipeline-clean.yaml \
  --stack-name engage-cicd-temp \
  --parameter-overrides \
    GitHubToken=YOUR_TOKEN_HERE \
  --capabilities CAPABILITY_NAMED_IAM
```

⚠️ **WARNING:** This exposes your token in CloudFormation parameters!

## 📚 Additional Resources

- [AWS Secrets Manager Best Practices](https://docs.aws.amazon.com/secretsmanager/latest/userguide/best-practices.html)
- [GitHub PAT Security](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token)
- [CodeBuild Security](https://docs.aws.amazon.com/codebuild/latest/userguide/security.html)

---

**Last Updated:** 2025-01-27
**Security Level:** Production-Ready
**Compliance:** Follows AWS Well-Architected Security Pillar