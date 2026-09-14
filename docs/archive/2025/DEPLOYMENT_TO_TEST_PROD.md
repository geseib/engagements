> ⚠️ **Superseded — see [`../DEPLOYMENT.md`](../DEPLOYMENT.md) for the canonical deployment guide.**
> Kept for history; may contain stale commands, domains, or scripts.

# Deployment Guide: Dev → Test → Prod

This guide outlines the steps needed to deploy the authentication fixes from dev to test and eventually to production.

## Current Dev Configuration Summary

### What Was Changed
1. **New User Pool (UserPoolV2)** with mutable email attributes
2. **Google OAuth Integration** with proper scopes
3. **PostConfirmation Lambda** for user group management
4. **Frontend OAuth URLs** with environment detection

### Current State
- **User Pool Domain**: `engdev-auth-v2` (instead of `engdev-auth`)
- **Google OAuth**: Manually configured in AWS Console (not via CloudFormation)
- **CloudFormation**: `HasGoogleOAuth: false` to avoid SSM parameter issues
- **Frontend**: Uses environment detection for domain selection

## Prerequisites for Test/Prod Deployment

### 1. Google Cloud Console Setup
Each environment needs its own OAuth 2.0 Client ID:

**Test Environment:**
1. Create new OAuth 2.0 Client ID in Google Cloud Console
2. Add authorized redirect URI: `https://test-auth.auth.us-east-1.amazoncognito.com/oauth2/idpresponse`
3. Note the Client ID and Client Secret

**Production Environment:**
1. Create new OAuth 2.0 Client ID in Google Cloud Console  
2. Add authorized redirect URI: `https://prod-auth.auth.us-east-1.amazoncognito.com/oauth2/idpresponse`
3. Note the Client ID and Client Secret

### 2. Update CloudFormation Templates

Update `samconfig-test.toml` and `samconfig-prod.toml` to ensure they don't reference Google SSM parameters (or set them to empty):

```toml
parameter_overrides = [
    "Environment=test",
    "StackName=engtest",
    "DomainName=eng.test.seibtribe.us",
    "GoogleClientIdParameter=",
    "GoogleClientSecretParameter="
]
```

## Deployment Steps for Test Environment

### Step 1: Deploy CloudFormation Stack

```bash
# Build and deploy to test
AWS_PROFILE=adminaccess sam build --template-file template-clean.yaml
AWS_PROFILE=adminaccess sam deploy --config-file samconfig-test.toml --no-confirm-changeset
```

This will create:
- New User Pool with mutable email attributes
- User Pool Domain: `test-auth` (not `test-auth-v2` since it's a fresh start)
- PostConfirmation Lambda function
- User groups: `admins`, `hosts`, `pending`

### Step 2: Configure PostConfirmation Trigger

The PostConfirmation trigger needs to be manually configured due to circular dependency:

```bash
# Get the function ARN
FUNCTION_ARN=$(AWS_PROFILE=adminaccess aws lambda get-function --function-name engtest-post-confirmation --query 'Configuration.FunctionArn' --output text)

# Get the User Pool ID from stack outputs
USER_POOL_ID=$(AWS_PROFILE=adminaccess aws cloudformation describe-stacks --stack-name engtest --query 'Stacks[0].Outputs[?OutputKey==`UserPoolId`].OutputValue' --output text)

# Configure the trigger
AWS_PROFILE=adminaccess aws cognito-idp update-user-pool --user-pool-id $USER_POOL_ID --lambda-config PostConfirmation=$FUNCTION_ARN

# Add Lambda permission
AWS_PROFILE=adminaccess aws lambda add-permission \
  --function-name engtest-post-confirmation \
  --statement-id cognito-post-confirmation-trigger \
  --action lambda:InvokeFunction \
  --principal cognito-idp.amazonaws.com \
  --source-arn arn:aws:cognito-idp:us-east-1:239601476690:userpool/$USER_POOL_ID
```

### Step 3: Configure Google OAuth (Manual)

1. **In AWS Cognito Console:**
   - Navigate to the test User Pool
   - Go to **Sign-in experience** → **Federated identity provider sign-in**
   - Click **Add identity provider** → **Google**
   - Enter:
     - Client ID: (from Google Cloud Console for test)
     - Client secret: (from Google Cloud Console for test)
     - Authorized scopes: `email openid profile`
   - Attribute mapping:
     - email → email
     - name → name
     - username → sub

2. **Update App Client:**
   - Go to **App integration** → App client
   - Edit → Enable **Google** under Identity providers
   - Ensure OAuth scopes include: `openid`, `email`, `profile`, `aws.cognito.signin.user.admin`
   - Save

### Step 4: Update Frontend Configuration

1. **Get new Cognito values:**
```bash
# Update frontend environment
./scripts/update-frontend-env.sh engtest
```

2. **Update environment detection in frontend:**

Edit `src/src/auth/LoginForm.jsx` and `src/src/auth/RegisterForm.jsx`:

```javascript
// Update the environment detection logic with actual test pool ID
const environment = userPoolId.includes('QAsrTnPpj') ? 'engdev' : 
                   userPoolId.includes('TEST_POOL_ID_HERE') ? 'test' : 'prod';
const domainSuffix = environment === 'engdev' ? '-v2' : ''; // Only dev uses v2
```

3. **Deploy frontend:**
```bash
./scripts/deploy-frontend-test.sh
```

### Step 5: Test the Deployment

1. **Create test users:**
   - Register with email/password → Should go to `pending` group
   - Register with Google → Should go to `pending` group
   
2. **Verify group assignment:**
```bash
AWS_PROFILE=adminaccess aws cognito-idp list-users --user-pool-id $USER_POOL_ID
AWS_PROFILE=adminaccess aws cognito-idp admin-list-groups-for-user --user-pool-id $USER_POOL_ID --username USERNAME
```

3. **Test admin approval flow:**
   - Admin user approves pending user
   - User moves from `pending` to `hosts` group

## Deployment Steps for Production

Follow the same steps as Test, but with production-specific values:

- Use `samconfig-prod.toml`
- Stack name: `engageprod` (or your prod stack name)
- Domain: `prod-auth`
- Different Google OAuth Client ID/Secret

## Important Notes

### Domain Naming
- **Dev**: Uses `engdev-auth-v2` (due to migration from immutable email issue)
- **Test**: Uses `test-auth` (fresh start, no `-v2` needed)
- **Prod**: Uses `prod-auth` (fresh start, no `-v2` needed)

### Google OAuth Management
Since we're keeping `HasGoogleOAuth: false` in CloudFormation:
- Google OAuth must be configured manually in each environment
- This avoids SSM parameter complexity
- Provides flexibility for different OAuth configurations per environment

### User Migration
For production deployment, consider:
1. **User communication** about the authentication update
2. **Migration plan** for existing users (if any)
3. **Rollback plan** if issues arise

### Monitoring
After deployment, monitor:
- CloudWatch logs for PostConfirmation Lambda
- Failed authentication attempts
- User registration flow completion rates

## Rollback Plan

If issues occur:
1. **Frontend**: Redeploy previous version
2. **User Pool**: Can't rollback (would need to restore from backup if critical)
3. **Lambda**: Redeploy previous function code
4. **Google OAuth**: Disable in App Client temporarily

## Checklist for Each Environment

### Test Environment
- [ ] Google OAuth Client created in Google Console
- [ ] CloudFormation stack deployed
- [ ] PostConfirmation trigger configured
- [ ] Google OAuth manually configured in Cognito
- [ ] Frontend updated with new User Pool IDs
- [ ] Frontend deployed
- [ ] User registration tested (local & Google)
- [ ] Group assignment verified
- [ ] Admin approval flow tested

### Production Environment
- [ ] Google OAuth Client created in Google Console
- [ ] User communication sent
- [ ] CloudFormation stack deployed
- [ ] PostConfirmation trigger configured
- [ ] Google OAuth manually configured in Cognito
- [ ] Frontend updated with new User Pool IDs
- [ ] Frontend deployed
- [ ] Smoke tests completed
- [ ] Monitoring configured
- [ ] Rollback plan documented

## Post-Deployment Cleanup

Once all environments are successfully deployed:

1. **Remove temporary code:**
   - Admin bypass code in `LoginForm.jsx`
   - Admin bypass Lambda function
   
2. **Update documentation:**
   - Update CLAUDE.md with final configuration
   - Document the Google OAuth manual setup requirement
   
3. **Google Console cleanup:**
   - Remove old redirect URIs once migration is complete
   - Keep only the active environment URIs

---
*Last Updated: 2025-08-14*
*Related: AUTHENTICATION_RECOVERY.md*