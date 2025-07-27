#!/bin/bash

# GitHub Integration Setup Script for Engage2
# This script helps you configure GitHub issue creation

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

print_header() {
    echo -e "${BLUE}============================================${NC}"
    echo -e "${BLUE}    GitHub Integration Setup - Engage2${NC}"
    echo -e "${BLUE}============================================${NC}"
    echo ""
}

print_step() {
    echo -e "${GREEN}[STEP]${NC} $1"
}

print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_header

print_step "1. GitHub Personal Access Token Setup"
echo ""
echo "To enable GitHub issue creation, you need a Personal Access Token."
echo ""
echo "📚 For detailed token setup instructions, see: docs/github-token-setup.md"
echo ""
echo "🔗 Quick setup:"
echo "   1. Go to: https://github.com/settings/tokens"
echo "   2. Click 'Generate new token (classic)'"
echo "   3. Name: 'Engage2 Issue Reporter'"
echo "   4. Scope: 'repo' (private repos) or 'public_repo' (public repos)"
echo "   5. Copy token immediately (GitHub only shows it once!)"
echo ""
echo "⚠️  IMPORTANT: Keep your token secure and never commit it to code!"
echo ""

read -p "Do you have your GitHub token ready? (y/n): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    print_info "Please create your GitHub token first, then run this script again."
    exit 0
fi

print_step "2. Configure Token"
echo ""
read -p "Enter your GitHub Personal Access Token: " -s GITHUB_TOKEN
echo ""

if [ -z "$GITHUB_TOKEN" ]; then
    print_error "Token cannot be empty!"
    exit 1
fi

print_step "3. Configure Repository"
echo ""
echo "Default repository: georgeseib/engage2"
read -p "Enter repository (owner/repo-name) or press Enter for default: " GITHUB_REPO

if [ -z "$GITHUB_REPO" ]; then
    GITHUB_REPO="georgeseib/engage2"
fi

print_step "4. Save Configuration"
echo ""

# Create or update .env file for local development
ENV_FILE=".env.github"
cat > "$ENV_FILE" << EOF
# GitHub Integration Configuration
# Use these environment variables when deploying

export GITHUB_TOKEN="$GITHUB_TOKEN"
export GITHUB_REPO="$GITHUB_REPO"
EOF

print_info "Configuration saved to: $ENV_FILE"
print_warning "Keep this file secure and do not commit it to version control!"

# Add to .gitignore if it exists
if [ -f ".gitignore" ]; then
    if ! grep -q ".env.github" .gitignore; then
        echo ".env.github" >> .gitignore
        print_info "Added .env.github to .gitignore"
    fi
fi

print_step "5. Deployment Instructions"
echo ""
echo "To deploy with GitHub integration enabled:"
echo ""
echo "Method 1 - Using environment variables:"
echo "  source .env.github"
echo "  ./deployall"
echo ""
echo "Method 2 - Direct export:"
echo "  export GITHUB_TOKEN=\"your_token_here\""
echo "  export GITHUB_REPO=\"$GITHUB_REPO\""
echo "  ./deployall"
echo ""
echo "Method 3 - One-line deployment:"
echo "  GITHUB_TOKEN=\"your_token_here\" GITHUB_REPO=\"$GITHUB_REPO\" ./deployall"
echo ""

print_step "6. Verify Setup"
echo ""
echo "After deployment, test the integration by:"
echo "1. Opening any screen (host/player/admin)"
echo "2. Clicking the floating 📝 button"
echo "3. Submitting a test issue"
echo "4. Checking your GitHub repository for the created issue"
echo ""

print_info "✅ GitHub integration setup complete!"
print_warning "Remember to source .env.github before deploying:"
echo -e "${YELLOW}source .env.github && ./deployall${NC}"