#!/usr/bin/env bash

# Full development deployment script
# Deploys both backend (SAM) and frontend to development environment

set -e  # Exit on any error

echo "🚀 Starting FULL DEVELOPMENT deployment..."
echo "📅 $(date)"
echo ""

# Get the script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "📁 Project root: $PROJECT_ROOT"
echo "📁 Script directory: $SCRIPT_DIR"
echo ""

# Step 1: Deploy backend (SAM stack)
echo "🔧 STEP 1: Deploying backend infrastructure..."
echo "----------------------------------------"
if [ -f "$SCRIPT_DIR/deploy-clean.sh" ]; then
    chmod +x "$SCRIPT_DIR/deploy-clean.sh"
    "$SCRIPT_DIR/deploy-clean.sh" engdev eng.dev.seibtribe.us
    
    if [ $? -eq 0 ]; then
        echo "✅ Backend deployment completed successfully!"
        echo ""
    else
        echo "❌ Backend deployment failed"
        exit 1
    fi
else
    echo "❌ Error: deploy-clean.sh not found"
    exit 1
fi

# Step 2: Update frontend environment variables
echo "🔐 STEP 2: Updating frontend environment variables..."
echo "----------------------------------------"
if [ -f "$SCRIPT_DIR/update-frontend-env.sh" ]; then
    chmod +x "$SCRIPT_DIR/update-frontend-env.sh"
    "$SCRIPT_DIR/update-frontend-env.sh" engdev
    
    if [ $? -eq 0 ]; then
        echo "✅ Frontend environment variables updated!"
        echo ""
    else
        echo "⚠️  Warning: Could not update frontend environment variables"
        echo "   You may need to update src/.env manually"
        echo ""
    fi
else
    echo "⚠️  Warning: update-frontend-env.sh not found"
    echo "   You may need to update src/.env manually"
    echo ""
fi

# Step 3: Deploy frontend
echo "🎨 STEP 3: Deploying frontend application..."
echo "----------------------------------------"
if [ -f "$SCRIPT_DIR/deploy-frontend-eng.sh" ]; then
    chmod +x "$SCRIPT_DIR/deploy-frontend-eng.sh"
    "$SCRIPT_DIR/deploy-frontend-eng.sh"
    
    if [ $? -eq 0 ]; then
        echo "✅ Frontend deployment completed successfully!"
        echo ""
    else
        echo "❌ Frontend deployment failed"
        exit 1
    fi
else
    echo "❌ Error: deploy-frontend-eng.sh not found"
    exit 1
fi

# Success summary
echo "🎉 FULL DEVELOPMENT DEPLOYMENT COMPLETE!"
echo "========================================"
echo "✅ Backend: AWS SAM stack deployed to 'engdev'"
echo "✅ Frontend: React app deployed to S3 + CloudFront"
echo "✅ Authentication: AWS Cognito configured"
echo ""
echo "🌐 Your application is now live at:"
echo "   https://eng.dev.seibtribe.us"
echo ""
echo "🔧 Development Environment Details:"
echo "   Stack: engdev"
echo "   Domain: eng.dev.seibtribe.us"
echo "   API: https://h1jcmja0w1.execute-api.us-east-1.amazonaws.com/dev/"
echo "   WebSocket: wss://r4c24mqku1.execute-api.us-east-1.amazonaws.com/dev"
echo ""
echo "🔐 Authentication Configuration:"
echo "   Cognito User Pool: Check CloudFormation outputs"
echo "   Google Sign-In: Enabled"
echo "   Admin Setup: Create first admin user in Cognito Console"
echo ""
echo "📊 Deployment completed at: $(date)"
echo "⏱️  Total time: $SECONDS seconds"