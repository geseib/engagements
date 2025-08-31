# Authentication Design for Engage2

## Overview
Implement AWS Cognito authentication to secure the Engage2 platform with role-based access control.

## Authentication Architecture

### User Roles
1. **Anonymous Users** (Players)
   - Can join games with game ID
   - Can participate in voting/answering
   - No authentication required

2. **Registered Users** (Hosts)
   - Can create and manage games
   - Requires authentication
   - Must be approved after registration

3. **Admin Users**
   - All host privileges
   - Can manage users (enable/disable/delete)
   - Can approve new registrations
   - Access to admin dashboard

### AWS Cognito Setup

#### User Pool Configuration
```yaml
UserPool:
  - Name: engage2-users
  - Sign-in: Email/Username
  - MFA: Optional (SMS/TOTP)
  - Password Policy: 
    - Min 8 chars
    - Uppercase, lowercase, numbers, symbols
  - Account Recovery: Email
  - User Attributes:
    - email (required, verified)
    - name (required)
    - custom:status (enabled/disabled/pending)
    - custom:role (admin/host)
```

#### Identity Pool
- Supports authenticated and unauthenticated access
- Unauthenticated users get player permissions
- Authenticated users get host/admin permissions based on groups

#### User Groups
1. **admins** - Full system access
2. **hosts** - Can create/manage games
3. **pending** - Awaiting approval

### Social Providers
- Facebook Login
- Google Sign-In
- Amazon Login
- Apple Sign-In

Each provider will be configured in Cognito with proper redirect URIs and client configurations.

## API Security

### Lambda Authorizers
1. **Public Endpoints** (No auth required)
   - GET /games/{gameId} (player view)
   - POST /games/{gameId}/join
   - POST /games/{gameId}/answer
   - POST /games/{gameId}/vote
   - WebSocket connections for players

2. **Authenticated Endpoints** (Host/Admin)
   - POST /games (create game)
   - PUT /games/{gameId} (update game)
   - DELETE /games/{gameId}
   - GET /games (list user's games)
   - All /admin/* endpoints

3. **Admin-Only Endpoints**
   - GET /admin/users
   - PUT /admin/users/{userId}
   - DELETE /admin/users/{userId}
   - POST /admin/users/{userId}/approve

### Authorization Flow
```
Request → API Gateway → Lambda Authorizer → Check Cognito Token → 
→ Verify User Groups → Allow/Deny → Lambda Function
```

## User Management Features

### Registration Flow
1. User signs up (email/social)
2. Email verification (if email signup)
3. User placed in "pending" status
4. Admin receives notification
5. Admin approves/rejects
6. User notified of decision

### Admin User Management
- List all users with pagination
- Search by name, email, ID
- Filter by status (enabled/disabled/pending)
- Bulk operations support
- Activity logs

### User Attributes
```javascript
{
  userId: "cognito-sub",
  email: "user@example.com",
  name: "John Doe",
  status: "enabled", // enabled/disabled/pending
  role: "host", // admin/host
  createdAt: "2025-01-07T...",
  lastLogin: "2025-01-07T...",
  provider: "cognito", // cognito/google/facebook/amazon/apple
  groups: ["hosts"],
  gameCount: 42,
  lastActivity: "2025-01-07T..."
}
```

## Frontend Implementation

### Login/Registration Components
1. **LoginModal** - Email/password + social buttons
2. **RegisterModal** - Sign up form with validation
3. **ForgotPasswordModal** - Password recovery
4. **UserProfile** - View/edit profile
5. **AdminDashboard** - User management interface

### Protected Routes
```javascript
<Route path="/admin/*" element={<RequireAuth role="admin"><AdminDashboard /></RequireAuth>} />
<Route path="/host/*" element={<RequireAuth role="host"><HostDashboard /></RequireAuth>} />
```

### Auth Context
Provides authentication state and methods throughout the app:
- `currentUser` - Current user object
- `isAuthenticated` - Boolean
- `isAdmin` - Boolean
- `login()`, `logout()`, `register()`

## Database Schema Updates

### User Table (DynamoDB)
```
PK: USER#{userId}
SK: PROFILE
Attributes:
  - all user attributes listed above
  - GSI1PK: STATUS#{status} (for filtering)
  - GSI1SK: CREATED#{timestamp}
```

### Game Ownership
Update game records to include:
- `ownerId`: Cognito user ID
- `ownerEmail`: For display
- `ownerName`: For display

## Security Best Practices

1. **Token Management**
   - Store tokens securely (httpOnly cookies)
   - Implement token refresh
   - Clear tokens on logout

2. **Rate Limiting**
   - Login attempts: 5 per minute
   - API calls: Based on user tier

3. **Audit Logging**
   - Log all admin actions
   - Track login attempts
   - Monitor suspicious activity

4. **Data Privacy**
   - Encrypt sensitive data
   - GDPR compliance
   - Data retention policies

## Implementation Phases

### Phase 1: Core Authentication
- Cognito setup
- Basic login/registration
- Lambda authorizers
- Protected API endpoints

### Phase 2: User Management
- Admin dashboard
- User approval workflow
- Search and filtering
- Bulk operations

### Phase 3: Social Providers
- Configure OAuth providers
- Update login UI
- Test provider flows

### Phase 4: Enhanced Features
- MFA support
- Session management
- Activity tracking
- Audit logs

## Migration Strategy

1. **Existing Games**: Remain accessible
2. **New Games**: Require authentication
3. **Gradual Rollout**: Feature flag for auth
4. **Backward Compatibility**: Support both modes initially