#!/bin/bash

# Build script for Lambda functions
echo "🔧 Building Lambda functions..."

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Create deployment packages
echo "📁 Creating deployment packages..."

# WebSocket functions
mkdir -p dist/websocket
cp -r websocket/* dist/websocket/
cp -r node_modules dist/websocket/

echo "✅ Lambda functions built successfully!"
echo "📁 Deployment packages created in dist/ directory"
