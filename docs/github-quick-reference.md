# GitHub Integration Quick Reference

## 🚀 Setup (Choose One)

### Option 1: Automated Setup
```bash
./setup-github-integration.sh
```

### Option 2: Manual Setup
```bash
# 1. Create token at https://github.com/settings/tokens
# 2. Set environment variables and deploy
export GITHUB_TOKEN="ghp_your_to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ken_here"
export GITHUB_REPO="username/repo-name"
./deployall
```

### Option 3: One-Line Deploy
```bash
GITHUB_TOKEN="ghp_your_token_here" GITHUB_REPO="username/repo" ./deployall
```

## 🔑 Token Requirements

| Repository Type | Required Scope |
|----------------|----------------|
| **Public** | `public_repo` |
| **Private** | `repo` |

## 📱 How to Use

1. **Click** floating 📝 button on any screen
2. **Choose** issue type: 🐛 Bug / 💡 Feature / ❓ Help
3. **Fill** form (context auto-detected)
4. **Submit** → Issue created in GitHub!

## 🏷️ Auto-Generated Labels

| Issue Type | Context | GitHub Labels |
|------------|---------|---------------|
| Bug Report | Host Screen | `bug`, `host-screen` |
| Feature Request | Player Screen | `enhancement`, `player-screen` |
| Help Request | Admin Panel | `question`, `admin-panel` |

## 🔧 Troubleshooting

| Error | Solution |
|-------|----------|
| "GitHub integration not configured" | Deploy with `GITHUB_TOKEN` set |
| "Bad credentials" | Check/regenerate GitHub token |
| "Repository not found" | Verify `GITHUB_REPO` format |
| No network call | Check browser console for errors |

## 📚 Full Documentation

- [Complete Setup Guide](../github-integration-setup.md)
- [Token Setup Details](github-token-setup.md)
- [Full Feature Documentation](github-integration-README.md)

---
💡 **Tip**: Keep your GitHub token secure and never commit it to code!