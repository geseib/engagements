# 📖 Engagements Platform - Project Documentation Index

**Real-time interactive meeting platform for engaging polls, trivia, surveys, and collaborative exercises**

---

## 🏗️ Architecture Overview

**Type**: AWS Serverless Application  
**Frontend**: React SPA with real-time WebSocket communication  
**Backend**: AWS Lambda functions with API Gateway  
**Database**: DynamoDB single-table design  
**Infrastructure**: CloudFormation with automated CI/CD  

---

## 🌐 Live Environments

| Environment | URL | Status | Pipeline |
|-------------|-----|--------|----------|
| 🟢 **Development** | https://engagedev.sb.seibtribe.us | Active | [Dev Pipeline](https://console.aws.amazon.com/codesuite/codepipeline/pipelines/engagements-cicd-dev-pipeline/view) |
| 🟡 **Test** | https://engagetest.sb.seibtribe.us | Active | [Test Pipeline](https://console.aws.amazon.com/codesuite/codepipeline/pipelines/engagements-cicd-test-pipeline/view) |
| 🔴 **Production** | https://engagements.sb.seibtribe.us | Active | [Prod Pipeline](https://console.aws.amazon.com/codesuite/codepipeline/pipelines/engagements-cicd-prod-pipeline/view) |

---

## 📁 Project Structure

```
engage2/
├── 📚 Documentation/
│   ├── README.md                           # Main project overview
│   ├── PROJECT_INDEX.md                    # This file
│   ├── DATABASE_DESIGN.md                  # DynamoDB schema and patterns
│   ├── VOTING_DESIGN.md                    # Voting system architecture
│   ├── ADMIN_SETUP.md                      # Admin interface setup
│   ├── DEPLOYMENT.md                       # Deployment procedures
│   ├── CLEANUP-GUIDE.md                    # Cleanup procedures
│   ├── system_documentation_guide-v2.md   # System design documentation
│   └── #allGame Flow and Database Design.md
│
├── 💻 Frontend Application/
│   └── src/                                # React SPA application
│       ├── components/                     # React components
│       ├── dist/                          # Built application
│       └── node_modules/                  # Dependencies
│
├── ⚡ Lambda Functions/
│   ├── lambda-functions/websocket/         # WebSocket handlers
│   ├── lambda-functions/game/              # Game HTTP APIs
│   ├── lambda-functions/admin/             # Admin operations
│   └── Shared utilities and managers
│
├── ☁️ Infrastructure/
│   ├── template-clean.yaml                 # CloudFormation template
│   ├── buildspec*.yml                      # CI/CD build specifications
│   └── samconfig-*.toml                   # SAM deployment configs
│
├── 🔧 Scripts & Tools/
│   ├── scripts/clean-aws-sam.js            # SAM cleanup utility
│   ├── test-new-apis.js                    # API testing
│   └── package.json                       # Project dependencies
│
└── 📋 Configuration/
    ├── API and table schema logic/         # Legacy API logic
    └── Various configuration files
```

---

## 🎯 Platform Capabilities

### Engagement Types

| Type | Description | Features |
|------|-------------|----------|
| 📊 **Polls** | Real-time polling | Multiple choice, live results, random order |
| 🧠 **Trivia Games** | Interactive quizzes | Scoring, leaderboards, timed questions |
| 📝 **Surveys** | Feedback collection | Rating scales, free-form responses |
| 💡 **Call & Answer** | Discussion prompts | Lessons learned, solution sessions, AI insights |
| 🎯 **Prioritization** | Ranking exercises | Drag-and-drop, aggregated results |

### User Interfaces

| Interface | Purpose | Users |
|-----------|---------|--------|
| **Host Dashboard** | Session management | Event facilitators |
| **Participant Experience** | Mobile-optimized participation | Meeting attendees |
| **Admin Portal** | Content and user management | System administrators |
| **Builder UI** | *(Future)* Template creation | Internal product team |

---

## 🔌 API Architecture

### WebSocket Functions (Real-time)
**Path**: `/lambda-functions/websocket/`

| Function | Purpose | Triggers |
|----------|---------|----------|
| `connect.js` | WebSocket connection setup | Client connects |
| `disconnect.js` | Connection cleanup | Client disconnects |
| `message.js` | General message routing | WebSocket messages |
| `create-game.js` | Game instance creation | Host creates session |
| `start-question.js` | Question round initiation | Host starts question |
| `start-vote.js` | Voting phase start | Host initiates voting |
| `submit-answer.js` | Answer collection | Participant responds |
| `get-ai-summary.js` | AI-powered insights | Request summary |
| `show-results.js` | Results display | Host shows results |

### HTTP REST APIs
**Path**: `/lambda-functions/game/`

| Function | Method | Purpose |
|----------|--------|---------|
| `get-game-state.js` | GET | Retrieve game state |
| `get-players.js` | GET | List participants |
| `get-categories.js` | GET | Available categories |
| `join-game.js` | POST | Player joins session |
| `validate-game.js` | POST | Game validation |

### Admin Functions
**Path**: `/lambda-functions/admin/`

| Function | Purpose | Access |
|----------|---------|---------|
| `ai-generate-questions.js` | AI question generation | Admin only |
| `upload-questions.js` | Content upload | Admin only |
| `delete-game.js` | Game deletion | Admin only |
| `clear-all-games.js` | System cleanup | Admin only |

---

## 📊 Database Design

**Type**: DynamoDB Single Table Design  
**Key Strategy**: Composite primary keys with GSI support  
**TTL**: Automatic cleanup of expired sessions  

### Key Entities
- **Games**: Session instances with metadata
- **Players**: Participant records and states
- **Questions**: Content sets and question banks
- **Answers**: Response collection and tracking
- **Votes**: Voting data and aggregations
- **WebSocket Connections**: Real-time connection management

---

## 🚀 Development Workflow

### Branch Strategy
```
main     → Production (manual approval required)
test     → Test environment (auto-deploy)
dev      → Development environment (auto-deploy)
```

### Deployment Process
1. **Development**: Push to `dev` branch triggers auto-deployment
2. **Testing**: Merge to `test` branch for validation
3. **Production**: Manual approval required for `main` branch deployment

### Local Development
```bash
# Setup
git clone https://github.com/geseib/engagements.git
cd engagements
cd src && npm install

# Deploy to dev
git checkout dev
git push origin dev

# Clean build artifacts
npm run clean
```

---

## 🛠️ Tools & Scripts

| Script | Purpose | Usage |
|--------|---------|-------|
| `scripts/clean-aws-sam.js` | Remove build artifacts | `npm run clean` |
| `test-new-apis.js` | API testing utility | Direct execution |
| Various `buildspec*.yml` | CI/CD configurations | AWS CodeBuild |

---

## 📚 Additional Documentation

### Core Documentation
- [README.md](./README.md) - Main project overview and quick start
- [DATABASE_DESIGN.md](./DATABASE_DESIGN.md) - DynamoDB schema and access patterns
- [VOTING_DESIGN.md](./VOTING_DESIGN.md) - Voting system architecture
- [DEPLOYMENT.md](./DEPLOYMENT.md) - Deployment procedures and CI/CD

### System Design
- [system_documentation_guide-v2.md](./system_documentation_guide-v2.md) - Comprehensive system design
- [ADMIN_SETUP.md](./ADMIN_SETUP.md) - Admin interface configuration
- [CLEANUP-GUIDE.md](./CLEANUP-GUIDE.md) - System maintenance procedures

### Operations
- [CI/CD Pipeline Documentation](https://console.aws.amazon.com/codesuite/codepipeline/home)
- [AWS Lambda Function Logs](https://console.aws.amazon.com/cloudwatch/home)
- [DynamoDB Tables](https://console.aws.amazon.com/dynamodb/home)

---

## 🔍 Quick Navigation

### For Developers
1. [Development Setup](./README.md#quick-start)
2. [Lambda Functions API](./PROJECT_INDEX.md#api-architecture)
3. [Database Schema](./DATABASE_DESIGN.md)
4. [Deployment Guide](./DEPLOYMENT.md)

### For Administrators
1. [Admin Setup](./ADMIN_SETUP.md)
2. [System Cleanup](./CLEANUP-GUIDE.md)
3. [Environment Management](./PROJECT_INDEX.md#live-environments)

### For Users
1. [Platform Overview](./README.md#how-it-works)
2. [Engagement Types](./README.md#engagement-types)
3. [User Interfaces](./README.md#user-interfaces)

---

## 📊 Project Metrics

**Languages**: JavaScript (Node.js 18.x), React  
**Architecture**: Serverless  
**Lambda Functions**: 50+ functions  
**Environments**: 3 (dev/test/prod)  
**Real-time**: WebSocket-powered  
**Database**: Single-table DynamoDB  
**CI/CD**: Automated with AWS CodePipeline  

---

*Last Updated: Generated via /sc:index command*