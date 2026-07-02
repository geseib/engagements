# Authentication Recovery Guide

> **⚠️ SUPERSEDED (2026-07-02):** the UserPoolV2 migration described here is
> complete. See **[AUTH.md](AUTH.md)** for how authentication works now.
> Kept for historical context and the old-pool rollback notes.

This document outlines the steps required after deploying UserPoolV2 to fix the Google OAuth "Attribute cannot be updated" issue.

## Background

The original Cognito User Pool had immutable email attributes which prevented Google OAuth from working properly. The solution required creating a new user pool (UserPoolV2) with mutable email attributes, which necessitates updating all related configurations.

## Post-Deployment Steps

### 1. Update Google OAuth Console

**URL**: https://console.developers.google.com

1. Navigate to your project's OAuth 2.0 Client IDs
2. Edit the Web application client
3. Add new authorized redirect URI:
   ```
   https://engdev-auth-v2.auth.us-east-1.amazoncognito.com/oauth2/idpresponse
   ```
4. **Keep the old URI temporarily** for rollback safety:
   ```
   https://engdev-auth.auth.us-east-1.amazoncognito.com/oauth2/idpresponse
   ```
5. Save changes

### 2. Update Frontend Environment Variables

Run the automated script to update the frontend with new Cognito values:

```bash
./scripts/update-frontend-env.sh engdev
```

This script will:
- Get the new User Pool ID from CloudFormation outputs
- Get the new Client ID from CloudFormation outputs
- Update the frontend environment configuration
- Deploy the updated frontend

### 3. Verify Cognito Configuration

Check that the new resources are created correctly:

```bash
# Get new User Pool ID
AWS_PROFILE=adminaccess aws cloudformation describe-stacks --stack-name engdev --query 'Stacks[0].Outputs[?OutputKey==`UserPoolId`].OutputValue' --output text

# Get new Client ID  
AWS_PROFILE=adminaccess aws cloudformation describe-stacks --stack-name engdev --query 'Stacks[0].Outputs[?OutputKey==`UserPoolClientId`].OutputValue' --output text

# Get new domain
AWS_PROFILE=adminaccess aws cloudformation describe-stacks --stack-name engdev --query 'Stacks[0].Outputs[?OutputKey==`UserPoolDomain`].OutputValue' --output text
```

### 4. Recreate Admin User

Since this is a new user pool, the admin user needs to be recreated:

#### Option A: Via Registration Form
1. Go to the application and register with: `george@seibtribe.com`
2. Verify email if required
3. Via AWS Cognito Console, add user to `admins` group

#### Option B: Via AWS Console
1. Open AWS Cognito Console
2. Navigate to the new User Pool
3. Create user manually with email: `george@seibtribe.com`
4. Add to `admins` group
5. Set temporary password and require password change on first login

### 5. Test Authentication Flows

Test both authentication methods:

#### Local Cognito User
1. Try signing in with the recreated admin user
2. Verify access to admin features

#### Google OAuth
1. Try "Continue with Google" with `george.seib@gmail.com`
2. Should now work without "Attribute cannot be updated" error
3. User should be automatically created and linked

### 6. Clean Up Temporary Admin Bypass

After confirming authentication works, remove the temporary bypass code:

#### Remove from LoginForm.jsx
Remove the admin bypass button section (lines ~283-347):
```javascript
{/* Temporary admin bypass for Google OAuth issues */}
{window.location.hostname.includes('dev') && (
  <button>🔧 Admin Bypass (Dev Only)</button>
)}
```

#### Remove Lambda Functions
1. Delete `lambda-functions/auth/admin-bypass.js`
2. Remove the AdminBypassFunction from `template-clean.yaml`
3. Redeploy to clean up the Lambda function

### 7. Update CLAUDE.md

Update the project documentation with new Cognito resource IDs and any configuration changes.

## Troubleshooting

### Google OAuth Still Fails
- Verify the Google Console redirect URI is exactly correct
- Check that the Google Identity Provider is properly configured in the new User Pool
- Confirm the Google Client ID/Secret parameters in SSM are still valid

### Frontend Environment Issues
- Manually verify the `.env` files have the correct new values
- Clear browser cache and localStorage
- Check browser console for authentication errors

### User Group Issues
- Verify user groups (`admins`, `hosts`, `pending`) were created in the new User Pool
- Manually add users to appropriate groups via AWS Console if needed

## Verification Checklist

- [ ] Google OAuth Console updated with new redirect URI
- [ ] Frontend environment updated with new Cognito IDs
- [ ] Admin user recreated and added to `admins` group
- [ ] Local Cognito authentication works
- [ ] Google OAuth authentication works
- [ ] Admin features accessible
- [ ] Temporary bypass code removed
- [ ] Documentation updated

## Rollback Plan

If issues arise, the old User Pool still exists and can be reverted to by:
1. Reverting CloudFormation template to use `UserPool` instead of `UserPoolV2`
2. Rolling back frontend environment to old Cognito IDs
3. Using the original Google OAuth redirect URI

---
*Created: 2025-08-14*
*Related Issue: Google OAuth "Attribute cannot be updated" error*