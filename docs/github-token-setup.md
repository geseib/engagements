# GitHub Personal Access Token Setup Guide

This guide provides step-by-step instructions for creating a GitHub Personal Access Token (PAT) to enable issue creation in the Engage2 platform.

## 📋 Overview

GitHub Personal Access Tokens are secure authentication credentials that allow applications to interact with GitHub's API on your behalf. For Engage2's issue creation feature, we need a token with permission to create issues in your repository.

## 🔐 Token Requirements

**Minimum Required Permissions:**
- **For Public Repositories**: `public_repo` scope
- **For Private Repositories**: `repo` scope (full repository access)

**Recommended Expiration**: 90 days (you can set longer if preferred)

## 📝 Step-by-Step Token Creation

### Step 1: Access GitHub Token Settings

1. **Log in to GitHub** at https://github.com
2. **Click your profile picture** in the top-right corner
3. **Select "Settings"** from the dropdown menu
4. **Scroll down** in the left sidebar and click **"Developer settings"**
5. **Click "Personal access tokens"**
6. **Select "Tokens (classic)"**

![GitHub Settings Path](docs/images/github-settings-path.png)

### Step 2: Generate New Token

1. **Click "Generate new token"** button
2. **Select "Generate new token (classic)"**
3. **You may be prompted to confirm your password**

### Step 3: Configure Token Settings

**Token Name/Note:**
```
Engage2 Issue Reporter - [Environment]
```
*Example: "Engage2 Issue Reporter - Dev"*

**Expiration:**
- Choose expiration period (recommended: 90 days)
- You can select "No expiration" but this is less secure

**Scopes/Permissions:**

For **Public Repositories**, select:
- ✅ `public_repo` - Access public repositories

For **Private Repositories**, select:
- ✅ `repo` - Full control of private repositories
  - This includes: repo:status, repo_deployment, public_repo, repo:invite, security_events

**Important**: Only select the minimum permissions needed. If your repository is public, only use `public_repo`.

### Step 4: Generate and Copy Token

1. **Click "Generate token"** at the bottom of the page
2. **Copy the token immediately** - GitHub will only show it once
3. **Store it securely** - treat it like a password

⚠️ **Critical**: Save the token immediately! GitHub will not show it again for security reasons.

## 🔒 Security Best Practices

### Token Security
- **Never commit tokens to code repositories**
- **Store tokens in secure password managers**
- **Use environment variables for deployment**
- **Rotate tokens regularly (every 90 days)**
- **Revoke unused tokens immediately**

### Access Control
- **Use organization tokens for organization repositories**
- **Limit token scope to minimum required permissions**
- **Monitor token usage in GitHub settings**
- **Create separate tokens for different applications**

### Environment-Specific Tokens
Consider creating separate tokens for different environments:
- `Engage2 Issue Reporter - Dev`
- `Engage2 Issue Reporter - Test`
- `Engage2 Issue Reporter - Prod`

This allows you to:
- Track usage per environment
- Revoke environment-specific access
- Use different repositories per environment

## 🛠️ Token Management

### Viewing Active Tokens
1. Go to **GitHub Settings → Developer settings → Personal access tokens → Tokens (classic)**
2. View all your active tokens with their:
   - Name/Note
   - Scopes
   - Last used date
   - Expiration date

### Regenerating Tokens
1. **Click on an existing token name**
2. **Click "Regenerate token"**
3. **Copy the new token value**
4. **Update your deployment configuration**

### Revoking Tokens
1. **Find the token in your token list**
2. **Click "Delete"** next to the token
3. **Confirm deletion**

## 📊 Token Scopes Explained

| Scope | Description | Use Case |
|-------|-------------|----------|
| `repo` | Full repository access | Private repositories |
| `public_repo` | Public repository access | Public repositories only |
| `repo:status` | Access commit status | Not needed for Engage2 |
| `repo_deployment` | Access deployment status | Not needed for Engage2 |
| `write:repo_hook` | Write repository hooks | Not needed for Engage2 |
| `read:repo_hook` | Read repository hooks | Not needed for Engage2 |

**For Engage2**: Only `repo` (private) or `public_repo` (public) is needed.

## 🔧 Integration with Engage2

### Environment Variable Setup

Once you have your token, configure it for deployment:

```bash
# Set environment variables
export GITHUB_TOKEN="ghp_your_token_here"
export GITHUB_REPO="username/repository-name"

# Deploy with GitHub integration
./deployall
```

### Secure Configuration File

Create a secure configuration file (never commit this):

```bash
# .env.github (add to .gitignore)
export GITHUB_TOKEN="ghp_your_token_here"
export GITHUB_REPO="georgeseib/engage2"
```

Use it:
```bash
source .env.github
./deployall
```

## 🚨 Troubleshooting

### Common Issues

**"Bad credentials" error:**
- Token may be expired or invalid
- Check token permissions and regenerate if needed

**"Not Found" error:**
- Repository name may be incorrect
- Token may not have access to the repository
- Repository may be private but token only has public_repo scope

**"API rate limit exceeded":**
- GitHub limits API calls per hour
- Wait for rate limit reset or use a different token

### Validation Steps

1. **Test token validity:**
   ```bash
   curl -H "Authorization: token YOUR_TOKEN" https://api.github.com/user
   ```

2. **Test repository access:**
   ```bash
   curl -H "Authorization: token YOUR_TOKEN" https://api.github.com/repos/username/repo-name
   ```

3. **Test issue creation permission:**
   ```bash
   curl -X POST -H "Authorization: token YOUR_TOKEN" \
        -H "Content-Type: application/json" \
        -d '{"title":"Test Issue","body":"Test"}' \
        https://api.github.com/repos/username/repo-name/issues
   ```

## 📚 Additional Resources

- [GitHub Personal Access Token Documentation](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token)
- [GitHub API Issues Documentation](https://docs.github.com/en/rest/issues/issues)
- [GitHub Token Best Practices](https://docs.github.com/en/developers/overview/managing-deploy-keys#machine-users)

## 🔄 Token Rotation Schedule

**Recommended Schedule:**
- **Review tokens**: Monthly
- **Rotate tokens**: Every 90 days
- **Update documentation**: When tokens change
- **Audit usage**: Quarterly

**Rotation Process:**
1. Generate new token with same permissions
2. Update deployment configuration
3. Test integration
4. Revoke old token
5. Update documentation

---

**Need Help?** If you encounter issues with token setup, please use the Engage2 issue reporting feature (once configured) or contact the development team.