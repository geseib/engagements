# GitHub Integration for Engage2

A comprehensive issue reporting system that allows users to create GitHub issues directly from the Engage2 platform.

## 🌟 Features

- **🐛 Bug Reporting**: Report bugs with automatic context capture
- **💡 Feature Requests**: Request new features with detailed descriptions
- **❓ Help Requests**: Ask questions and get support
- **🎯 Auto-Context Detection**: Automatically detects if user is on host, player, or admin screen
- **📊 Metadata Capture**: Includes game ID, URL, user agent, and timestamp
- **🏷️ Smart Labeling**: Automatically applies appropriate GitHub labels
- **📱 Mobile-Friendly**: Responsive design works on all devices
- **🔒 Secure**: Uses encrypted tokens and minimal permissions

## 🚀 Quick Start

### 1. Setup GitHub Token
```bash
./setup-github-integration.sh
```

### 2. Deploy with GitHub Integration
```bash
source .env.github
./deployall
```

### 3. Test the Integration
1. Open any Engage2 screen
2. Click the floating 📝 button
3. Submit a test issue
4. Check your GitHub repository

## 📖 Documentation

| Document | Description |
|----------|-------------|
| [GitHub Token Setup Guide](github-token-setup.md) | Detailed instructions for creating GitHub tokens |
| [Architecture Overview](#architecture) | Technical implementation details |
| [API Reference](#api-reference) | Lambda function API documentation |
| [Troubleshooting](#troubleshooting) | Common issues and solutions |

## 🏗️ Architecture

### Components

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Frontend      │    │   AWS Lambda     │    │   GitHub API    │
│                 │    │                  │    │                 │
│ ┌─────────────┐ │    │ ┌──────────────┐ │    │ ┌─────────────┐ │
│ │ IssueFab    │─┼────┼→│ create-      │─┼────┼→│ Create      │ │
│ │ Component   │ │    │ │ github-issue │ │    │ │ Issue       │ │
│ └─────────────┘ │    │ └──────────────┘ │    │ └─────────────┘ │
│                 │    │                  │    │                 │
│ ┌─────────────┐ │    │ ┌──────────────┐ │    │                 │
│ │IssueReport  │ │    │ │  DynamoDB    │ │    │                 │
│ │Form         │ │    │ │  Tracking    │ │    │                 │
│ └─────────────┘ │    │ └──────────────┘ │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

### Flow Diagram

```
User Action → Frontend Form → API Gateway → Lambda Function → GitHub API
                                    ↓
                              DynamoDB Tracking
```

## 📋 API Reference

### POST /admin/create-github-issue

Creates a new GitHub issue with automatic labeling and metadata.

**Request Body:**
```json
{
  "title": "Issue title",
  "description": "Detailed description",
  "issueType": "bug|feature|help",
  "context": "host|player|admin",
  "gameId": "1234",
  "additionalInfo": "Optional additional context"
}
```

**Response:**
```json
{
  "success": true,
  "issueNumber": 123,
  "issueUrl": "https://github.com/owner/repo/issues/123",
  "message": "Issue created successfully"
}
```

**Automatic Metadata:**
- URL where issue was created
- User agent (browser information)
- Timestamp
- Game ID (if applicable)

## 🏷️ GitHub Labels

Issues are automatically labeled based on type and context:

### Type Labels
- `bug` - Bug reports
- `enhancement` - Feature requests
- `question` - Help requests

### Context Labels
- `host-screen` - Issues from game host interface
- `player-screen` - Issues from player interface
- `admin-panel` - Issues from admin panel

### Example Issue Labels
- Bug from host screen: `bug`, `host-screen`
- Feature request from admin: `enhancement`, `admin-panel`
- Help request from player: `question`, `player-screen`

## 🔧 Configuration

### Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `GITHUB_TOKEN` | GitHub Personal Access Token | Yes | None |
| `GITHUB_REPO` | Repository in format `owner/repo` | No | `georgeseib/engage2` |

### CloudFormation Parameters

```yaml
Parameters:
  GitHubToken:
    Type: String
    Description: GitHub Personal Access Token
    NoEcho: true
    
  GitHubRepo:
    Type: String
    Description: GitHub repository (owner/repo-name)
    Default: "georgeseib/engage2"
```

### Deployment Options

**Option 1: Environment Variables**
```bash
export GITHUB_TOKEN="ghp_your_token_here"
export GITHUB_REPO="username/repo-name"
./deployall
```

**Option 2: Configuration File**
```bash
# Create .env.github (add to .gitignore)
echo 'export GITHUB_TOKEN="ghp_your_token_here"' > .env.github
echo 'export GITHUB_REPO="username/repo-name"' >> .env.github

# Deploy
source .env.github && ./deployall
```

**Option 3: One-time Deployment**
```bash
GITHUB_TOKEN="ghp_your_token_here" GITHUB_REPO="username/repo" ./deployall
```

## 🎨 UI Components

### IssueFab Component
Floating action button that appears on all screens.

**Props:**
- `context`: `"host" | "player" | "admin"` - Auto-detects user context
- `gameId`: Current game ID (optional)

### IssueReportForm Component
Modal form for creating issues.

**Features:**
- Form validation
- Character limits
- Auto-context detection
- Success/error feedback
- Mobile-responsive design

## 🔒 Security

### Token Security
- Tokens stored as encrypted CloudFormation parameters
- Never exposed in frontend code
- Minimal required permissions (issues:write only)
- Regular rotation recommended

### Data Privacy
- No sensitive user data transmitted
- Technical metadata only (URL, user agent, timestamp)
- Audit trail in DynamoDB with TTL

### Access Control
- Issues can only be created, not read or modified
- Limited to configured repository
- Rate limited by GitHub API

## 🧪 Testing

### Manual Testing
1. Deploy with valid GitHub token
2. Navigate to any screen (host/player/admin)
3. Click floating 📝 button
4. Test each issue type (bug/feature/help)
5. Verify issues appear in GitHub with correct labels

### Automated Testing
```bash
# Test API endpoint directly
curl -X POST https://your-api.com/admin/create-github-issue \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Test Issue",
    "description": "Test description",
    "issueType": "bug",
    "context": "host"
  }'
```

## 🔍 Monitoring

### CloudWatch Logs
Monitor Lambda function logs for:
- Issue creation success/failure
- GitHub API responses
- Error patterns

### DynamoDB Tracking
All created issues are tracked with:
- Issue number and GitHub URL
- Original request details
- Creation timestamp
- 1-year TTL for automatic cleanup

### GitHub Repository
Monitor your GitHub repository for:
- Issue creation rate
- Label distribution
- Response patterns

## 🐛 Troubleshooting

### Common Issues

**"GitHub integration not configured"**
- Solution: Deploy with `GITHUB_TOKEN` environment variable set

**"Bad credentials" error**
- Check token validity and permissions
- Regenerate token if expired

**"Repository not found"**
- Verify `GITHUB_REPO` format (`owner/repo-name`)
- Check token repository access

**No network call being made**
- Check browser console for JavaScript errors
- Verify API_BASE configuration

### Debug Steps

1. **Check deployment parameters:**
   ```bash
   aws cloudformation describe-stacks --stack-name your-stack-name \
     --query "Stacks[0].Parameters"
   ```

2. **Test Lambda function:**
   ```bash
   aws lambda invoke --function-name your-stack-create-github-issue \
     --payload '{"body":"{\"title\":\"Test\",\"description\":\"Test\",\"issueType\":\"bug\",\"context\":\"host\"}"}' \
     response.json
   ```

3. **Check CloudWatch logs:**
   ```bash
   aws logs tail /aws/lambda/your-stack-create-github-issue --follow
   ```

### Support

If you encounter issues not covered here:
1. Check CloudWatch logs for detailed error messages
2. Verify GitHub token permissions and expiration
3. Test with minimal issue data
4. Use the Engage2 issue reporting feature (once working) to report bugs

## 🚀 Future Enhancements

Potential future improvements:
- Issue templates for different types
- Integration with GitHub Projects
- Automatic issue assignment
- Screenshot attachment
- Issue status synchronization
- Bulk issue creation
- Custom label configuration

---

**Last Updated:** 2025-01-20
**Version:** 1.0.0