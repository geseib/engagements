# Cognito Validation Checklist
## Prevent Breaking Authentication During Deployments

### 🔍 Pre-Deployment Validation

#### Dev Environment Health Check
```bash
# Run these checks BEFORE any deployment
```
- [ ] Can log in to dev with Cognito username/password
- [ ] Can log in to dev with Google OAuth
- [ ] No errors in dev CloudWatch logs for last 24 hours
- [ ] Document current working User Pool ID: _______________
- [ ] Document current working Client ID: _______________

#### Configuration Backup
- [ ] Backup samconfig-test.toml before changes
- [ ] Screenshot Cognito User Pool settings
- [ ] Screenshot Google OAuth Console redirect URIs
- [ ] Note current OAuth scopes in User Pool Client

### 🚦 Deployment Gates

#### Gate 1: After Infrastructure Deploy
- [ ] Stack shows UPDATE_COMPLETE or CREATE_COMPLETE
- [ ] No rollback triggered
- [ ] User Pool created successfully
- [ ] User Pool Client created successfully
- [ ] Lambda functions deployed

#### Gate 2: After Basic Auth Setup
- [ ] Can create user in Cognito Console
- [ ] User can log in with username/password
- [ ] User groups (admins, hosts, pending) exist
- [ ] No token errors in browser console
- [ ] Frontend shows correct User Pool ID

#### Gate 3: After OAuth Configuration
- [ ] Google Identity Provider shows in Cognito Console
- [ ] Client ID and Secret are correct (from SSM)
- [ ] Attribute mappings configured (email → email)
- [ ] Callback URLs match exactly:
  - [ ] `https://eng.test.seibtribe.us/auth/callback`
  - [ ] `http://localhost:3000/auth/callback`
- [ ] OAuth scopes include: email, openid, profile

#### Gate 4: After Google Console Update
- [ ] New redirect URI ADDED (not replaced):
  - [ ] Test: `https://engtest-auth-v2.auth.us-east-1.amazoncognito.com/oauth2/idpresponse`
- [ ] Old dev redirect URI still present:
  - [ ] Dev: `https://engdev-auth-v2.auth.us-east-1.amazoncognito.com/oauth2/idpresponse`
- [ ] Authorized JavaScript origins include domain

### 🧪 Testing Validation

#### Authentication Flows
- [ ] **Cognito Native:**
  - [ ] Register new user
  - [ ] Email verification (if enabled)
  - [ ] Password reset flow
  - [ ] Login/logout cycle

- [ ] **Google OAuth:**
  - [ ] "Continue with Google" button appears
  - [ ] Redirects to Google correctly
  - [ ] Returns to app after auth
  - [ ] User created in Cognito
  - [ ] Correct attributes mapped

- [ ] **Session Management:**
  - [ ] Tokens stored in localStorage
  - [ ] Auto-refresh works
  - [ ] Logout clears tokens
  - [ ] Protected routes enforce auth

#### Common Error Patterns to Check

##### ❌ Token Errors
```
"Invalid token"
"Token has expired"
"Not authenticated"
```
**Fix:** Check token refresh logic, verify Cognito App Client settings

##### ❌ Scope Errors
```
"Invalid scope"
"Scope not allowed"
```
**Fix:** Verify OAuth scopes in User Pool Client match Google configuration

##### ❌ Redirect Errors
```
"redirect_uri_mismatch"
"Invalid redirect URI"
```
**Fix:** Exact match required in Google Console, including https:// and trailing slashes

##### ❌ Attribute Errors
```
"Attribute cannot be updated"
"Email already exists"
```
**Fix:** Check attribute mutability in User Pool, verify attribute mappings

### 📊 Post-Deployment Monitoring

#### First Hour
- [ ] Monitor CloudWatch logs every 15 minutes
- [ ] Check for authentication errors
- [ ] Verify no increase in error rate
- [ ] Test login every 30 minutes

#### First 24 Hours
- [ ] Daily active users logging in successfully
- [ ] No spike in password reset requests
- [ ] GitHub issues can be created (if configured)
- [ ] WebSocket connections stable

### 🔄 Rollback Criteria

**Immediate Rollback If:**
- ❌ Users cannot log in (any method)
- ❌ Token errors affecting >10% of users
- ❌ Google OAuth completely broken
- ❌ Dev environment affected in ANY way

**Investigation Required If:**
- ⚠️ Intermittent login failures
- ⚠️ Slow authentication response
- ⚠️ Some users report issues
- ⚠️ New error patterns in logs

### 📝 Documentation Requirements

After successful deployment, document:
1. Exact User Pool ID
2. Exact Client ID  
3. OAuth configuration details
4. Any workarounds applied
5. Timestamp of deployment
6. Who performed deployment
7. Any issues encountered

### 🛡️ Safety Rules

1. **NEVER** delete and recreate User Pools (loses all users)
2. **NEVER** change immutable attributes
3. **ALWAYS** add redirect URIs (don't replace)
4. **ALWAYS** test in dev console before prod
5. **ALWAYS** have a rollback plan ready
6. **NEVER** deploy to prod on Friday

### 📞 Escalation Path

If authentication breaks:
1. Check this checklist first
2. Review CloudWatch logs
3. Compare with working environment
4. Check recent commits for changes
5. Rollback if not fixed in 30 minutes

---
Last Updated: $(date)
Version: 1.0