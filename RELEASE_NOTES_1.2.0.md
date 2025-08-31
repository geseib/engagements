# Release Notes - Version 1.2.0

**Release Date**: August 30, 2025  
**Release Branch**: `release/1.2.0`

## 🎉 Major Features

### 🔐 Google OAuth Integration
- **Complete OAuth 2.0 implementation** with AWS Cognito and Google as identity provider
- **Seamless social login** allowing users to sign in with their Google accounts
- **Automatic user provisioning** from Google profile information
- **Production-ready configuration** across all environments (dev, test, prod)

### 📚 Enhanced Question Management
- **Question Browser**: New interface for hosts to browse and select specific questions
- **Improved question selection**: Better filtering and category management
- **Question set management**: Enhanced UI for managing and organizing question sets

### 🛡️ Security Enhancements
- **Secure GitHub Token Management**: Tokens now stored in AWS Secrets Manager
- **Enhanced authentication flow**: Improved security with proper token handling
- **Environment-specific configuration**: Secure separation of dev, test, and prod configs

## 🐛 Bug Fixes

### Authentication & Authorization
- Fixed Google OAuth "undefined" configuration errors in production
- Resolved Cognito domain configuration issues across environments
- Fixed AuthContext to properly use window variables instead of process.env
- Corrected OAuth redirect URI mismatches
- Fixed user pool client configuration for social providers

### Frontend Issues
- Fixed AI prompt displaying "[object Object]" instead of actual content
- Resolved hard-coded API URLs in UserManagement component
- Fixed config.js generation and deployment in build pipelines
- Corrected environment variable usage in OAuth components (LoginForm, RegisterForm, OAuthCallback)

### Infrastructure & Deployment
- Fixed buildspec files for proper Cognito configuration deployment
- Resolved GitHub repository name inconsistencies
- Fixed YAML syntax errors in pipeline configurations
- Corrected CloudFormation output references for Cognito resources

## 🔧 Technical Improvements

### Build & Deployment Pipeline
- **Enhanced buildspecs** with Cognito configuration retrieval from CloudFormation
- **Improved config.js generation** with comprehensive environment variables:
  - `window.API_BASE`
  - `window.WS_URL`
  - `window.USER_POOL_ID`
  - `window.USER_POOL_CLIENT_ID`
  - `window.COGNITO_DOMAIN`
- **Verification steps** added to validate config.js deployment
- **Debug logging** for troubleshooting deployment issues

### Code Quality
- Standardized configuration pattern across all authentication components
- Improved error handling and user feedback
- Enhanced markdown rendering for AI-generated content
- Better separation of concerns in authentication flow

### Documentation
- Comprehensive authentication recovery documentation
- Updated CLAUDE.md with current project context
- Added troubleshooting guides for common issues
- Improved inline code documentation

## 🚀 Deployment Notes

### Environment URLs
| Environment | Frontend URL | Status |
|------------|--------------|--------|
| Development | https://eng.dev.seibtribe.us | ✅ OAuth Working |
| Test | https://eng.test.seibtribe.us | ✅ OAuth Working |
| Production | https://eng.seibtribe.us | ✅ OAuth Working |

### Required Post-Deployment Steps
1. Ensure GitHub token is configured in AWS Secrets Manager:
   - `engage/test/github-token` for test environment
   - `engage/prod/github-token` for production environment

2. Verify Google OAuth configuration in AWS Cognito Console:
   - Check Google as identity provider is enabled
   - Verify redirect URIs match your domain
   - Confirm client ID and secret are properly configured

3. Clear browser cache and cookies if experiencing authentication issues

## 📊 Migration Notes

### Breaking Changes
- None - this release maintains backward compatibility

### Database Changes
- None - existing data structures remain unchanged

### Configuration Changes
- Frontend now requires proper config.js with Cognito variables
- BuildSpec files updated to include GitHub token retrieval
- OAuth redirect URIs must be configured in Google Console

## 🔄 Upgrade Instructions

1. **From version 1.1.x or earlier**:
   ```bash
   git checkout release/1.2.0
   git pull origin release/1.2.0
   ./deployall  # For development
   ```

2. **For production deployment**:
   - Merge release/1.2.0 into prod branch
   - Pipeline will automatically deploy with new configuration

3. **Post-deployment verification**:
   - Test Google OAuth login flow
   - Verify user registration and authentication
   - Check question browser functionality
   - Confirm AI prompt generation works correctly

## 👥 Contributors
- Authentication system overhaul and Google OAuth integration
- Question browser implementation
- Security enhancements and GitHub integration
- Bug fixes and performance improvements

## 📝 Known Issues
- Category bitmask occasionally showing zeros (debug logging added)
- Player dates may show 1969 epoch time in some cases
- Categories may flash briefly before deactivating

## 🔮 Next Release Preview
- Enhanced category management system
- Improved player experience and UI
- Additional social login providers (Facebook, Amazon, Apple)
- Performance optimizations for large sessions
- Advanced analytics and reporting features

---

**Note**: This release represents a significant enhancement to the authentication system and overall security posture of the Engage2 platform. All environments have been tested and validated with the new OAuth implementation.