# Engagements Platform 🎯

A serverless, real-time interactive meeting platform for making meetings, offsites, and training more engaging with polls, trivia, surveys, lessons learned, and collaborative exercises.

## 🚀 Live Environments

- **🟢 Development**: https://engagedev.sb.seibtribe.us
- **🟡 Test**: https://engagetest.sb.seibtribe.us
- **🔴 Production**: https://engagements.sb.seibtribe.us

## 🏗️ Architecture

**Frontend**: React SPA with real-time WebSocket communication
**Backend**: AWS Lambda functions with API Gateway
**Database**: DynamoDB single-table design
**Infrastructure**: CloudFormation with automated CI/CD

## 🔄 Development Workflow

### Branch Strategy
- `dev` → Auto-deploy to Development environment
- `test` → Auto-deploy to Test environment
- `main` → Manual approval required for Production

### CI/CD Pipelines
- **🟢 Dev Pipeline**: https://console.aws.amazon.com/codesuite/codepipeline/pipelines/engagements-cicd-dev-pipeline/view
- **🟡 Test Pipeline**: https://console.aws.amazon.com/codesuite/codepipeline/pipelines/engagements-cicd-test-pipeline/view
- **🔴 Prod Pipeline**: https://console.aws.amazon.com/codesuite/codepipeline/pipelines/engagements-cicd-prod-pipeline/view

## 📁 Project Structure

```
engagements/
├── docs/                    # 📚 System documentation
├── src/                     # 💻 React frontend application
├── scripts/                 # 🔧 Deployment and setup scripts
├── template-*.yaml          # ☁️  CloudFormation templates
├── samconfig-*.toml         # ⚙️  SAM deployment configurations
└── README.md               # 📖 This file
```

## 🚀 Quick Start

### For Developers
1. **Clone and setup**:
   ```bash
   git clone https://github.com/geseib/engagements.git
   cd engagements
   cd src && npm install
   ```

2. **Deploy to development**:
   ```bash
   # Switch to dev branch and push to trigger deployment
   git checkout dev
   git push origin dev
   ```

3. **Monitor deployment**: Check the [Dev Pipeline](https://console.aws.amazon.com/codesuite/codepipeline/pipelines/engagements-cicd-dev-pipeline/view)

4. **Test your changes**: Visit https://engagedev.sb.seibtribe.us

### For Hosts
1. Visit the appropriate environment URL
2. Create a new engagement session
3. Share the game ID or QR code with participants
4. Manage the session in real-time

## 🎮 How It Works

Hosts create interactive engagement sessions that participants can join using a simple game ID. The platform supports multiple engagement types with real-time updates and collaborative features.

## 📚 Documentation

Detailed system documentation is available in the `/docs` folder:
- **System Architecture** - Overall design and technology choices
- **Data Model** - DynamoDB schema and access patterns
- **API Design** - REST and WebSocket API specifications
- **Implementation Guide** - Development and deployment procedures
- **CI/CD Setup** - Pipeline configuration and branch strategy

## 🎯 Engagement Types

### 📊 **Polls**
Real-time polling with multiple choice options. Perfect for quick feedback and decision making.
- Multiple choice questions with configurable selection limits
- Real-time results visualization
- Random order option for unbiased responses

### 🧠 **Trivia Games**
Interactive quiz games with scoring, leaderboards, and real-time competition.
- Timed questions with multiple choice answers
- Live scoring and leaderboards
- Category-based question sets
- Detailed performance reports

### 📝 **Surveys**
Comprehensive feedback collection with rating scales and free-form responses.
- Rating scales (1-5) for quantitative feedback
- Free-form text responses for qualitative insights
- Batch submission for efficiency
- Optional results sharing

### 💡 **Call & Answer**
Interactive discussion prompts with voting and AI-powered insights.
- **Lessons Learned**: Scenario-based learning with peer voting
- **Solution Sessions**: Problem-solving with collaborative evaluation
- **Interview Practice**: Mock interviews with peer feedback
- AI summarization and insights (optional)

### 🎯 **Prioritization**
Ranking exercises to help teams align on priorities and decisions.
- Drag-and-drop ranking interface
- Aggregated team priorities
- Visual results presentation

## 🖥️ User Interfaces

### **Host Dashboard**
- **Main Screen**: Large display for shared viewing with participant cards and live content
- **Control Panel**: Session management, QR codes, and real-time controls
- **Admin Panel**: Content management and engagement configuration

### **Participant Experience**
- Mobile-optimized interface for easy participation
- Simple game ID entry to join sessions
- Real-time updates and instant feedback

### **Admin Portal**
- Content set management (upload CSV, manual entry, AI generation)
- User and host management
- System configuration and game cleanup

## 🛠️ Technical Features

- **Real-time Updates**: WebSocket-powered live synchronization
- **Mobile-First Design**: Responsive interface for all devices
- **Serverless Architecture**: AWS Lambda + DynamoDB for scalability
- **Automated CI/CD**: Branch-based deployment pipeline
- **Single Table Design**: Optimized DynamoDB access patterns
- **TTL Management**: Automatic cleanup of expired sessions

## 🤝 Contributing

This platform is designed for extensibility. See `/docs` for detailed technical documentation and development guidelines.