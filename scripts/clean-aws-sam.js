#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

/**
 * AWS SAM Cleanup Script
 * Removes all .aws-sam build artifacts and cache files
 */

const projectRoot = path.dirname(__dirname);
const awsSamPath = path.join(projectRoot, '.aws-sam');

function removeDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return false;
  }

  console.log(`🗑️  Removing: ${path.relative(projectRoot, dirPath)}`);
  
  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
    return true;
  } catch (error) {
    console.error(`❌ Error removing ${dirPath}:`, error.message);
    return false;
  }
}

function removeFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  console.log(`🗑️  Removing: ${path.relative(projectRoot, filePath)}`);
  
  try {
    fs.unlinkSync(filePath);
    return true;
  } catch (error) {
    console.error(`❌ Error removing ${filePath}:`, error.message);
    return false;
  }
}

function cleanupAWSSam() {
  console.log('🧹 Starting AWS SAM cleanup...\n');
  
  let removedCount = 0;
  let totalSize = 0;

  // Calculate size before cleanup
  if (fs.existsSync(awsSamPath)) {
    try {
      const stats = fs.statSync(awsSamPath);
      totalSize = getDirectorySize(awsSamPath);
      console.log(`📊 .aws-sam directory size: ${formatBytes(totalSize)}`);
    } catch (error) {
      console.log('📊 Could not calculate directory size');
    }
  }

  // Remove the entire .aws-sam directory
  if (removeDirectory(awsSamPath)) {
    removedCount++;
  }

  // Remove any additional SAM-related files
  const samFiles = [
    '.aws-sam-build-cache',
    'samconfig.toml'
  ];

  samFiles.forEach(file => {
    const filePath = path.join(projectRoot, file);
    if (removeFile(filePath)) {
      removedCount++;
    }
  });

  console.log('\n✅ AWS SAM cleanup completed!');
  console.log(`📊 Removed ${removedCount} item(s)`);
  if (totalSize > 0) {
    console.log(`💾 Freed up: ${formatBytes(totalSize)}`);
  }
}

function getDirectorySize(dirPath) {
  let totalSize = 0;
  
  try {
    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const item of items) {
      const itemPath = path.join(dirPath, item.name);
      
      if (item.isDirectory()) {
        totalSize += getDirectorySize(itemPath);
      } else {
        const stats = fs.statSync(itemPath);
        totalSize += stats.size;
      }
    }
  } catch (error) {
    // Skip directories we can't read
  }
  
  return totalSize;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Run cleanup if called directly
if (require.main === module) {
  cleanupAWSSam();
}

module.exports = { cleanupAWSSam };