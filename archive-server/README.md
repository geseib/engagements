# Content Archive Server

Remote content backup and synchronization system for Engage2 question sets and AI prompts.

## Overview

The Content Archive Server provides secure, centralized storage and synchronization of content between different environments (dev, test, prod). It features mTLS authentication, full-text search capabilities, and bi-directional content sync.

## Architecture

### Core Components
- **PostgreSQL Database**: Stores question sets, prompts, and metadata with full-text search
- **Node.js API Server**: RESTful API with mTLS authentication
- **mTLS Security**: Mutual TLS authentication for secure client connections
- **Search Engine**: Full-text search across content with filtering capabilities
- **Sync Engine**: Bi-directional content synchronization between environments

### Security Features
- **mTLS Authentication**: Mutual certificate validation for all connections
- **Environment Isolation**: Content tagged by source environment
- **Access Control**: Certificate-based access control with environment restrictions
- **Audit logging**: Complete audit trail of all content operations

## API Endpoints

### Authentication
All endpoints require valid client certificates configured for mTLS.

### Content Operations
- `GET /api/search` - Search question sets and prompts
- `GET /api/content/:type/:id` - Retrieve specific content
- `POST /api/upload` - Upload content to archive
- `POST /api/download` - Download selected content
- `GET /api/environments` - List available source environments
- `GET /api/sync/status` - Get synchronization status

### Admin Operations
- `GET /api/health` - System health check
- `GET /api/stats` - Archive statistics
- `POST /api/admin/cleanup` - Archive maintenance

## Deployment

The archive server is designed to be deployed independently from the main Engage2 application, typically on dedicated infrastructure with enhanced security controls.

### Requirements
- Node.js 18+
- PostgreSQL 14+
- SSL certificates for mTLS
- Secure network environment

### Configuration
- Environment-specific certificates
- Database connection settings
- Search indexing configuration
- Sync schedule settings

## Usage from Engage2

The main Engage2 application connects to the archive server through the admin interface, allowing administrators to:

1. **Backup Content**: Upload question sets and prompts to the archive
2. **Search Archive**: Find content using full-text search with filters
3. **Restore Content**: Download and restore content to the current environment
4. **Environment Sync**: Transfer content between dev, test, and prod environments

## Development Status

🚧 **Under Development** - Implementation in progress on `feature/archiver` branch.