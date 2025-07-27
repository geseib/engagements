# GitHub Integration Setup Guide

This guide explains how to set up the GitHub issue creation integration for the Engage2 platform.

## 📚 Complete Documentation

For comprehensive documentation, see:
- **[GitHub Token Setup Guide](docs/github-token-setup.md)** - Detailed token creation instructions
- **[GitHub Integration README](docs/github-integration-README.md)** - Complete feature documentation
- **[Setup Script](#automated-setup)** - Automated configuration tool

## 🚀 Quick Setup

### Automated Setup (Recommended)
```bash
./setup-github-integration.sh
```

### Manual Setup

## 1. Create GitHub Personal Access Token

📖 **For detailed instructions with screenshots, see [docs/github-token-setup.md](docs/github-token-setup.md)**

**Quick Steps:**
1. Go to GitHub Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Click "Generate new token (classic)"
3. Give it a descriptive name like "Engage2 Issue Reporter"
4. Select the following scopes:
   - `repo` (Full control of private repositories) - includes issues:write
   - OR just `public_repo` if your repository is public
5. Click "Generate token" and copy the token immediately

⚠️ **Important**: GitHub only shows the token once for security reasons!

## 2. Configure AWS CloudFormation Parameters

When deploying the stack, you need to provide these additional parameters:

```bash
# For dev environment
sam deploy --parameter-overrides \
  Environment=dev \
  StackName=engagedev \
  GitHubToken="your_github_token_here" \
  GitHubRepo="georgeseib/engage2"
```

Or update your deployment script to include these parameters.

## 3. Environment Variables

The Lambda function uses these environment variables (automatically set by CloudFormation):
- `GITHUB_TOKEN` - Your GitHub personal access token
- `GITHUB_REPO` - Repository in format "owner/repo-name"

## 4. API Endpoint

Once deployed, the GitHub integration will be available at:
```
POST https://your-api-domain.com/admin/create-github-issue
```

## 5. Issue Creation Flow

### Frontend Usage
The system includes a floating action button (FAB) on all screens that allows users to:
1. Report bugs 🐛
2. Request features 💡  
3. Ask for help ❓

### Auto-Context Detection
The system automatically detects and pre-fills:
- **Context**: host, player, or admin screen
- **Game ID**: Current game ID if applicable
- **URL**: Current page URL
- **User Agent**: Browser information
- **Timestamp**: When the issue was created

### GitHub Issue Format
Created issues will have:
- **Title**: `[BUG/FEATURE/HELP] User's title`
- **Labels**: Automatic labeling based on type and context
  - Type: `bug`, `enhancement`, `question`
  - Context: `host-screen`, `player-screen`, `admin-panel`
- **Body**: User description + technical metadata

## 6. Security Considerations

- GitHub token is stored securely in AWS environment variables
- Token has minimal required permissions (issues:write)
- All issue creation is logged in DynamoDB for audit purposes
- Rate limiting is handled by GitHub's API limits

## 7. Monitoring

Issues created through the system are tracked in DynamoDB with:
- Issue number and GitHub URL
- Original request details
- Creation timestamp
- 1-year TTL for cleanup

## 8. Testing

To test the integration:
1. Deploy with valid GitHub token
2. Open any screen (host, player, admin)
3. Click the floating 📝 button
4. Fill out and submit a test issue
5. Check GitHub repository for the created issue

## 9. Troubleshooting

**Common Issues:**
- Invalid token: Check token permissions and expiration
- Repository not found: Verify GitHubRepo parameter format
- Rate limiting: GitHub API has rate limits for issue creation

**Logs:**
Check CloudWatch logs for the `create-github-issue` Lambda function for detailed error information.