# GitHub Fine-Grained Personal Access Token Setup Guide

This guide provides step-by-step instructions for creating a Fine-Grained Personal Access Token for secure issue creation in the Engage2 platform.

## 📋 Overview

Fine-Grained Personal Access Tokens are GitHub's newest and most secure token type, allowing precise repository-specific permissions. This is the recommended approach for production deployments.

## 🔐 Token Requirements

**Token Naming Convention**: `{domain-name}-issues`
- Example: `eng.dev.seibtribe.us-issues`
- Example: `eng.prod.seibtribe.us-issues`

**Permissions Required**:
- **Issues**: Read and Write access only
- **Repository**: Specific repository only (not all repositories)

## 📝 Step-by-Step Fine-Grained Token Creation

### Step 1: Access GitHub Token Settings

1. **Log in to GitHub** at https://github.com
2. **Click your profile picture** in the top-right corner
3. **Select "Settings"** from the dropdown menu
4. **Scroll down** in the left sidebar and click **"Developer settings"**
5. **Click "Personal access tokens"**
6. **Select "Fine-grained tokens"** (NOT "Tokens (classic)")

### Step 2: Generate New Fine-Grained Token

1. **Click "Generate new token"** button
2. **You may be prompted to confirm your password**

### Step 3: Configure Token Settings

#### Basic Information

**Token Name**:
```
{your-domain}-issues
```
Examples:
- `eng.dev.seibtribe.us-issues`
- `eng.test.seibtribe.us-issues`
- `eng.prod.seibtribe.us-issues`

**Expiration**: 
- Recommended: **90 days**
- Maximum allowed: **1 year**

**Description** (optional):
```
GitHub issue creation for Engage2 platform at {your-domain}
```

#### Repository Access

1. **Select "Selected repositories"** (NOT "All repositories")
2. **Click "Select repositories"**
3. **Choose ONLY your specific repository** (e.g., `engage2`)
4. **Click the repository name** to add it

⚠️ **Important**: Only grant access to the specific repository needed

#### Repository Permissions

1. **Scroll down to "Repository permissions"**
2. **Find "Issues"** in the list
3. **Change from "No access" to "Read and write"**
4. **Leave ALL other permissions as "No access"**

✅ Your permissions should show:
- **Issues**: Read and write
- **Everything else**: No access

### Step 4: Generate and Save Token

1. **Review your settings**:
   - ✅ Token name follows pattern: `{domain}-issues`
   - ✅ Only ONE repository selected
   - ✅ Only Issues permission is Read/Write
   - ✅ All other permissions are No access
   
2. **Click "Generate token"** at the bottom
3. **Copy the token immediately** - it starts with `github_pat_`
4. **Store it securely** - you won't see it again!

⚠️ **Critical**: Save the token immediately! GitHub will not show it again.

## 🔒 AWS Secrets Manager Setup

### Creating the Secrets

Once you have your Fine-Grained token, store both the token and repository in AWS Secrets Manager using domain-based naming:

```bash
# Replace {DOMAIN} with your actual domain
DOMAIN="eng.dev.seibtribe.us"

# Create the GitHub token secret
aws secretsmanager create-secret \
  --name "${DOMAIN}-token" \
  --description "GitHub Fine-Grained PAT for Engage2 issue creation at ${DOMAIN}" \
  --secret-string "github_pat_YOUR_TOKEN_HERE"

# Create the GitHub repository secret
aws secretsmanager create-secret \
  --name "${DOMAIN}-repo" \
  --description "GitHub repository for Engage2 issue creation at ${DOMAIN}" \
  --secret-string "username/repository-name"
```

**Examples for different environments:**
```bash
# Development
aws secretsmanager create-secret --name "eng.dev.seibtribe.us-token" --secret-string "github_pat_YOUR_TOKEN"
aws secretsmanager create-secret --name "eng.dev.seibtribe.us-repo" --secret-string "georgeseib/engage2"

# Test
aws secretsmanager create-secret --name "eng.test.seibtribe.us-token" --secret-string "github_pat_YOUR_TOKEN"
aws secretsmanager create-secret --name "eng.test.seibtribe.us-repo" --secret-string "georgeseib/engage2"

# Production
aws secretsmanager create-secret --name "eng.seibtribe.us-token" --secret-string "github_pat_YOUR_TOKEN"
aws secretsmanager create-secret --name "eng.seibtribe.us-repo" --secret-string "georgeseib/engage2"
```

### Alternative JSON Format

You can also store as JSON (both formats are supported):

```bash
# Token as JSON
aws secretsmanager create-secret \
  --name "${DOMAIN}-token" \
  --secret-string '{"token":"github_pat_YOUR_TOKEN_HERE"}'

# Repository as JSON
aws secretsmanager create-secret \
  --name "${DOMAIN}-repo" \
  --secret-string '{"repo":"username/repository-name"}'
```

### Updating Existing Secrets

If the secrets already exist:

```bash
DOMAIN="eng.dev.seibtribe.us"

# Update token
aws secretsmanager update-secret \
  --secret-id "${DOMAIN}-token" \
  --secret-string "github_pat_NEW_TOKEN_HERE"

# Update repository (if needed)
aws secretsmanager update-secret \
  --secret-id "${DOMAIN}-repo" \
  --secret-string "username/new-repository"
```

### Verifying the Secrets

```bash
DOMAIN="eng.dev.seibtribe.us"

# Check that the secrets were created
aws secretsmanager describe-secret --secret-id "${DOMAIN}-token"
aws secretsmanager describe-secret --secret-id "${DOMAIN}-repo"

# Test retrieval (be careful not to expose the token)
aws secretsmanager get-secret-value --secret-id "${DOMAIN}-token" --query SecretString
aws secretsmanager get-secret-value --secret-id "${DOMAIN}-repo" --query SecretString
```

## 🚀 Deployment Configuration

### Environment Variables (Optional Fallback)

The Lambda function will use Secrets Manager by default, but can fall back to environment variables:

```bash
# Optional: Set fallback environment variables
export GITHUB_TOKEN="github_pat_YOUR_TOKEN_HERE"
export GITHUB_REPO="username/repository-name"

# Deploy
./deployall
```

### Stack Configuration

The SAM template automatically configures:
- Secret name: `{StackName}/github-token`
- Permissions to read the secret
- Fallback to environment variables if needed

## 🔍 Token Comparison

| Feature | Classic Token | Fine-Grained Token |
|---------|---------------|-------------------|
| Repository Access | All or Public | Specific repositories only |
| Permission Granularity | Broad scopes | Individual permissions |
| Security | Good | Best |
| Expiration | Optional | Required (max 1 year) |
| Recommended | Legacy only | ✅ Production use |

## 🚨 Troubleshooting

### Common Issues

**"Bad credentials" error:**
- Token may be expired (check expiration date)
- Token format incorrect (should start with `github_pat_`)
- Secret Manager configuration issue

**"Resource not accessible by integration":**
- Token doesn't have Issues permission
- Token is for wrong repository
- Repository was deleted or renamed

**"Secret not found" error:**
- Secret name mismatch (check domain name)
- Wrong AWS region
- IAM permissions missing

### Validation Steps

1. **Test token directly:**
   ```bash
   curl -H "Authorization: Bearer github_pat_YOUR_TOKEN" \
        https://api.github.com/repos/OWNER/REPO/issues
   ```

2. **Test secret retrieval:**
   ```bash
   DOMAIN="eng.dev.seibtribe.us"  # Use your actual domain
   
   # Test token secret
   aws secretsmanager get-secret-value \
     --secret-id "${DOMAIN}-token" \
     --query SecretString --output text
   
   # Test repo secret
   aws secretsmanager get-secret-value \
     --secret-id "${DOMAIN}-repo" \
     --query SecretString --output text
   ```

3. **Test Lambda permissions:**
   Check CloudWatch logs for the Lambda function to see any permission errors

## 📊 Security Best Practices

### Token Security
- ✅ Use Fine-Grained tokens (not Classic)
- ✅ Limit to single repository
- ✅ Grant minimum permissions (Issues only)
- ✅ Set expiration (90 days recommended)
- ✅ Store in AWS Secrets Manager
- ❌ Never commit tokens to code
- ❌ Never log token values

### Access Control
- Create separate tokens per environment
- Use descriptive names with domain
- Monitor token usage in GitHub settings
- Rotate tokens before expiration

### Token Rotation Schedule

**Recommended Timeline:**
- **60 days**: GitHub sends expiration warning
- **75 days**: Create new token
- **80 days**: Update Secrets Manager
- **85 days**: Test new token
- **90 days**: Old token expires

## 🔄 Token Rotation Process

1. **Create new Fine-Grained token** (follow steps above)
2. **Update AWS Secrets Manager:**
   ```bash
   DOMAIN="eng.dev.seibtribe.us"  # Use your actual domain
   
   aws secretsmanager update-secret \
     --secret-id "${DOMAIN}-token" \
     --secret-string "github_pat_NEW_TOKEN"
   ```
3. **Test the integration** (create test issue)
4. **Revoke old token** in GitHub settings
5. **Document rotation** in team notes

## 📚 Additional Resources

- [GitHub Fine-grained Personal Access Tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#fine-grained-personal-access-tokens)
- [AWS Secrets Manager Documentation](https://docs.aws.amazon.com/secretsmanager/latest/userguide/intro.html)
- [GitHub API Issues Documentation](https://docs.github.com/en/rest/issues/issues)

---

**Security Note**: This configuration provides the most secure method for GitHub integration, limiting access to only what's needed (Issues read/write on a specific repository) and storing credentials securely in AWS Secrets Manager.