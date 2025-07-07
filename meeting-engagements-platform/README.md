# Meeting Engagements Platform

A comprehensive serverless platform for interactive meeting tools including trivia, polls, surveys, lessons, and collaborative exercises.

## 🏗️ Project Structure

```
meeting-engagements-platform/
├── docs/                           # System Documentation
│   ├── 01-dynamodb-design.md       # Single table design for all engagement types
│   ├── 02-game-host-system.md      # Host interface and controls
│   ├── 03-host-admin-dashboard.md  # Admin interface and management
│   ├── 04-participant-experience.md # Player/participant flows
│   ├── 05-system-builder.md        # Builder UI for creating templates
│   ├── 06-deployment-cicd.md       # GitHub + CodePipeline setup
│   └── api/                        # API Documentation
│       └── openapi.yaml            # Complete API specification
├── frontend/                       # React Frontend Applications
│   ├── builder-ui/                 # Internal builder interface
│   ├── user-dashboard/             # External user portal
│   ├── engagement-runtime/         # Real-time engagement interface
│   └── shared/                     # Shared components and utilities
├── backend/                        # AWS Lambda Functions
│   ├── auth/                       # Authentication and user management
│   ├── games/                      # Game/engagement management
│   ├── content/                    # Content set management
│   ├── websocket/                  # Real-time communication
│   └── ai/                         # AI summarization and processing
├── infrastructure/                 # CloudFormation Templates
│   ├── base/                       # Core infrastructure (DynamoDB, S3, etc.)
│   ├── dev/                        # Development environment
│   ├── test/                       # Test environment
│   └── prod/                       # Production environment
├── deployment/                     # CI/CD Configuration
│   ├── buildspec.yml               # CodeBuild configuration
│   ├── pipeline.yml                # CodePipeline setup
│   └── scripts/                    # Deployment scripts
└── content-templates/              # Sample content sets
    ├── trivia/                     # Trivia question templates
    ├── polls/                      # Poll templates
    ├── surveys/                    # Survey templates
    └── lessons/                    # Lesson application templates
```

## 🎯 System Overview

### Core Engagement Types
- **Trivia**: Multiple choice quiz with scoring and AI summaries
- **Polls**: Real-time voting with instant results
- **Surveys**: Structured data collection
- **Lesson Applications**: Reflective exercises with peer voting
- **Feedback Tools**: Open-ended response collection
- **Bingo Trivia**: Host-led facts with bingo card layout
- **Solutioning Tools**: Collaborative problem-solving exercises

### Key Features
- **Real-time Interaction**: WebSocket-based live updates
- **Token-based Usage**: Fair usage tracking across plan tiers
- **AI Summarization**: Automated insights and summaries
- **Multi-device Support**: Responsive design for phones, tablets, desktop
- **Content Management**: Upload and manage custom content sets
- **User Authentication**: Secure user accounts and permissions

## 🚀 Technology Stack

### Frontend
- **React 18** with modern hooks and context
- **Vite** for fast development and building
- **WebSocket Client** for real-time communication
- **Responsive CSS** with mobile-first design

### Backend
- **AWS Lambda** for serverless compute
- **DynamoDB** single table design for all data
- **API Gateway** for REST and WebSocket APIs
- **S3** for static asset hosting
- **CloudFront** for global content delivery

### Infrastructure
- **CloudFormation** for infrastructure as code
- **GitHub** for source control
- **CodePipeline + CodeBuild** for CI/CD
- **Route 53** for DNS management

## 🔄 Development Workflow

### Branch Strategy
- `dev` → Automatic deployment to development environment
- `test` → Automatic deployment to test environment  
- `prod` → Manual approval required for production deployment

### Getting Started
1. Clone the repository
2. Install dependencies: `npm install`
3. Configure AWS credentials
4. Deploy development environment: `npm run deploy:dev`
5. Start local development: `npm run dev`

## 📚 Documentation

Detailed documentation is available in the `/docs` folder:
- System architecture and design decisions
- API specifications and usage examples
- Deployment and operational procedures
- Content creation guidelines

## 🤝 Contributing

This platform is designed for extensibility. New engagement types can be added by:
1. Creating new React components in `frontend/engagement-runtime`
2. Adding Lambda handlers in `backend/games`
3. Updating the DynamoDB schema as needed
4. Adding content templates and documentation

## 📄 License

[License information to be added]
