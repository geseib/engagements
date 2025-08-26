# SAFE TEST ENVIRONMENT DEPLOYMENT PLAN
## Protecting Dev While Deploying to Test

### 🛡️ GOLDEN RULE: DO NOT TOUCH DEV
Dev is working. We will NOT modify anything in dev environment.

## 📋 PHASE 0: DOCUMENT & BACKUP CURRENT STATE

### Step 0.1: Document What's Working in Dev
```bash
# Document current dev configuration (DO NOT MODIFY)
echo "=== DEV CONFIGURATION BASELINE ===" > dev_baseline.txt
echo "Stack: engdev" >> dev_baseline.txt
echo "Domain: eng.dev.seibtribe.us" >> dev_baseline.txt
echo "Auth Domain: engdev-auth-v2" >> dev_baseline.txt
echo "Google OAuth: Configured and working" >> dev_baseline.txt
echo "GitHub Integration: Not configured (no token)" >> dev_baseline.txt
```

### Step 0.2: Check Test Environment Current State
```bash
# Check if test stack exists and its current state
AWS_PROFILE=adminaccess aws cloudformation describe-stacks --stack-name engtest \
  --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "Test stack not found"
```

## 📋 PHASE 1: MINIMAL TEST DEPLOYMENT (NO SOCIAL PROVIDERS)

### Step 1.1: Create GitHub Token for TEST ONLY (SECURE METHOD)
```bash
# Go to: https://github.com/settings/tokens
# Create token named: "Engage2 TEST Environment Only"
# Scope: public_repo
# Save token in password manager

# SECURE: Store token in AWS Secrets Manager (NOT in config files)
./scripts/setup-secure-github-token.sh test
```

### Step 1.2: Use Secure Deployment (RECOMMENDED)
```bash
# SECURE METHOD: Use the secure buildspec that retrieves tokens from Secrets Manager
cp buildspec-secure.yml buildspec.yml

# Deploy secure CI/CD pipeline (one-time setup)
aws cloudformation deploy \
  --template-file cicd/pipeline-secure.yaml \
  --stack-name engage-cicd-secure \
  --capabilities CAPABILITY_NAMED_IAM

# Activate GitHub connection in AWS Console
# CodePipeline → Settings → Connections → engage-github-connection
```

### Step 1.2 Alternative: Manual Deployment (LESS SECURE)
```bash
# Only use this if you need manual control
# Create a backup first
cp samconfig-test.toml samconfig-test.toml.backup

# Update ONLY the test configuration
# Edit samconfig-test.toml and add GitHub token
# DO NOT TOUCH samconfig-dev.toml
```

### Step 1.3: Deploy to Test WITHOUT Social Providers
```bash
# First, ensure we're on the right branch
git checkout test
git merge main --no-edit

# Deploy with basic Cognito only (no Google OAuth yet)
git push origin test

# Monitor deployment
echo "Watch CodeBuild for engtest pipeline"
```

## 📋 PHASE 2: VALIDATE BASIC AUTHENTICATION

### Step 2.1: Test Basic Cognito Auth
```bash
# Get test User Pool info
USER_POOL_ID=$(AWS_PROFILE=adminaccess aws cloudformation describe-stacks \
  --stack-name engtest \
  --query 'Stacks[0].Outputs[?OutputKey==`UserPoolId`].OutputValue' \
  --output text)

echo "Test User Pool: $USER_POOL_ID"

# Create a test user via Console (NOT via API to avoid scope issues)
echo "1. Go to Cognito Console"
echo "2. Create user: testuser@seibtribe.com"
echo "3. Add to 'hosts' group (NOT admins yet)"
echo "4. Test login at https://eng.test.seibtribe.us"
```

### Step 2.2: Verification Gate 1
```bash
# STOP HERE if any of these fail:
# [ ] Test stack deployed successfully
# [ ] Frontend accessible at https://eng.test.seibtribe.us
# [ ] Basic Cognito login works with test user
# [ ] No errors in CloudWatch logs
# [ ] Dev environment still working (test it!)
```

## 📋 PHASE 3: ADD GOOGLE OAUTH (CAREFULLY)

### Step 3.1: Configure Google OAuth for TEST ONLY
```bash
# In AWS Cognito Console for TEST User Pool:
# 1. Navigate to engtest User Pool (NOT engdev!)
# 2. Add Google Identity Provider
# 3. Use DIFFERENT OAuth credentials if possible
#    OR use same but add TEST redirect URI

# Google Console - ADD (don't replace) redirect URI:
echo "ADD this URI (keep existing dev URI):"
echo "https://engtest-auth-v2.auth.us-east-1.amazoncognito.com/oauth2/idpresponse"
```

### Step 3.2: Update UserPoolClient in TEST
```bash
# Via Console (safer than CLI):
# 1. Go to TEST User Pool Client
# 2. Add Google to SupportedIdentityProviders
# 3. Verify callback URLs:
#    - https://eng.test.seibtribe.us/auth/callback
#    - http://localhost:3000/auth/callback (for local testing)
```

### Step 3.3: Verification Gate 2
```bash
# Test thoroughly before proceeding:
# [ ] Google OAuth works in test
# [ ] Regular Cognito still works in test
# [ ] Dev Google OAuth STILL WORKS (critical!)
# [ ] No token/scope errors
```

## 📋 PHASE 4: GITHUB INTEGRATION TESTING

### Step 4.1: Test GitHub Issue Creation
```bash
# From test environment:
# 1. Click the 📝 button
# 2. Submit test issue
# 3. Verify issue appears in GitHub

# Check Lambda logs for errors:
AWS_PROFILE=adminaccess aws logs tail \
  /aws/lambda/engtest-CreateGitHubIssue \
  --follow
```

## 📋 PHASE 5: FINAL VALIDATION

### Step 5.1: Complete Test Suite
```bash
# Run through complete user flows:
# [ ] Admin login (Cognito)
# [ ] Admin login (Google OAuth)
# [ ] Create game
# [ ] Join as player
# [ ] Submit GitHub issue
# [ ] WebSocket connections work
```

### Step 5.2: Document Working Configuration
```bash
# Save the working test configuration
echo "=== TEST CONFIGURATION WORKING ===" > test_working_config.txt
echo "Date: $(date)" >> test_working_config.txt
echo "User Pool: $USER_POOL_ID" >> test_working_config.txt
echo "Client ID: $CLIENT_ID" >> test_working_config.txt
echo "Google OAuth: Configured" >> test_working_config.txt
echo "GitHub Token: Configured" >> test_working_config.txt
```

## 🔴 STOP CONDITIONS (DO NOT PROCEED IF):
- ❌ Dev environment shows ANY authentication errors
- ❌ Token or scope errors appear in test
- ❌ Google OAuth redirect fails
- ❌ Users can't log in to test
- ❌ CloudWatch shows Cognito errors

## 🟢 PROCEED TO PROD ONLY WHEN:
- ✅ Test has been running for 24+ hours without issues
- ✅ All authentication methods work in test
- ✅ GitHub integration works in test
- ✅ Dev is still working perfectly
- ✅ You have documented the exact working configuration

## 🔄 ROLLBACK PLAN

### If Test Breaks:
```bash
# 1. Don't panic - dev is still working
# 2. Check CloudWatch logs for specific errors
# 3. If Cognito is broken, check:
#    - User Pool Client settings
#    - Identity Provider configuration
#    - Callback URLs
#    - OAuth scopes

# 4. Can always redeploy from backup:
cp samconfig-test.toml.backup samconfig-test.toml
git checkout test
git reset --hard HEAD~1
git push origin test --force
```

### If Dev Gets Affected:
```bash
# This shouldn't happen if you follow the plan, but if it does:
# 1. Check Google Console - you may have replaced instead of added redirect URI
# 2. Verify dev User Pool settings weren't changed
# 3. Check that dev frontend still points to correct Cognito IDs
# 4. Revert any changes immediately
```

## 📊 Key Differences from Previous Plan:
1. **Never modify dev environment**
2. **Deploy incrementally with validation gates**
3. **Test basic auth before adding OAuth**
4. **Use Console for sensitive operations (safer than CLI)**
5. **Document working configurations at each step**
6. **24-hour test period before prod**

## ⏱️ Timeline:
- Phase 0-1: 30 minutes (careful configuration)
- Phase 2: 15 minutes (basic auth testing)
- Phase 3: 30 minutes (OAuth setup)
- Phase 4-5: 30 minutes (integration testing)
- Wait Period: 24 hours (stability verification)
- **Total: 2 hours active work + 24 hour verification**

---
Last Updated: $(date)