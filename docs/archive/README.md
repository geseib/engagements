# Archive System Documentation

## Overview

The Archive System enables cross-environment content management for the Engage2 platform, allowing administrators to backup, share, and synchronize prompts and question sets between different deployments (dev, test, prod, or separate instances).

## Documentation Structure

### [01-archive-system-overview.md](./01-archive-system-overview.md)
**Complete system architecture and design**
- Purpose and environment-agnostic design
- Frontend and backend components
- DynamoDB schema patterns
- Integration points and benefits
- Current implementation status

### [02-deployment-requirements.md](./02-deployment-requirements.md)  
**Everything needed to deploy the archive system**
- SAM template additions (6 Lambda functions)
- API Gateway route definitions
- IAM permissions and policies
- Deployment commands and testing procedures
- Current blockers and next steps

### [03-security-and-permissions.md](./03-security-and-permissions.md)
**Security model and future enhancements**
- Current same-account security model
- Planned MTLS and cross-account access
- Permission models and implementation steps
- Security best practices and testing
- Compliance considerations

### [04-admin-feature-integration.md](./04-admin-feature-integration.md)
**Complete integration with AdminPage interface**
- Navigation and modal integration
- User interface flow and component architecture
- API integration patterns
- Styling and responsive design
- User experience features and testing

## Quick Start

### Current Status
✅ **Frontend Components** - Complete and integrated  
✅ **Backend Functions** - Implemented but not deployed  
❌ **SAM Template** - Functions need to be added  
❌ **API Routes** - Not yet exposed via API Gateway  

### Immediate Next Steps
1. Add 6 Lambda functions to `template-clean.yaml`
2. Deploy to dev environment: `./scripts/deploy-clean.sh engagedev eng.dev.seibtribe.us`
3. Test archive operations in AdminPage → Archive tab
4. Deploy to additional environments as needed

### Key Files
- **Frontend:** `src/src/components/ArchivePanel.jsx` and related components
- **Backend:** `lambda-functions/admin/get-archives.js` and 5 other archive functions
- **Styling:** `src/src/components/ArchivePanel.css`
- **Integration:** Archive tab in `src/src/AdminPage.jsx`

## System Architecture

```
┌─────────────────┐    ┌─────────────────────┐    ┌─────────────────┐
│   Environment   │───▶│   Archive System    │◀───│   Environment   │
│   (Dev/Test)    │    │                     │    │     (Prod)      │
│                 │    │ - DynamoDB Storage  │    │                 │
│ - Admin UI      │    │ - Lambda Functions  │    │ - Admin UI      │
│ - Archive Tab   │    │ - API Gateway       │    │ - Archive Tab   │
│ - Content Mgmt  │    │ - Conflict Handling │    │ - Content Mgmt  │
└─────────────────┘    └─────────────────────┘    └─────────────────┘
```

## Benefits

1. **Content Backup** - Preserve important prompts and question sets
2. **Environment Sync** - Transfer content between dev/test/prod  
3. **Content Sharing** - Share question sets between deployments
4. **Disaster Recovery** - Restore content from archives
5. **Cross-Instance Support** - Transfer between separate installations

## Technology Stack

- **Frontend:** React, CSS Grid, Modal system
- **Backend:** AWS Lambda (Node.js), DynamoDB, API Gateway
- **Infrastructure:** SAM (Serverless Application Model)
- **Storage:** Single-table DynamoDB design with archive patterns
- **Security:** IAM roles, CORS, future MTLS support

## Support

For implementation questions or issues:
1. Review the specific documentation file for your area of interest
2. Check the Lambda function implementations in `lambda-functions/admin/`
3. Test using the deployment commands in the deployment requirements
4. Refer to the security documentation for permission setup

---

*The Archive System is designed to integrate seamlessly with the existing Engage2 serverless infrastructure while providing powerful cross-environment content management capabilities.*