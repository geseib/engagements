# System Builder Documentation

## Overview

The System Builder is an internal tool used by the platform team to create and configure reusable engagement templates. This system enables the creation of new engagement types (trivia, polls, surveys, lessons, etc.) and manages the templates that external users can access through the Host Admin Dashboard.

---

## 1. Builder Architecture

### Core Components

#### BuilderDashboard.jsx
- **Template Management**: Create, edit, and organize engagement templates
- **Content Integration**: Manage system-wide content sets
- **Deployment Tools**: Package and deploy new engagement types
- **Analytics Interface**: Monitor template usage and performance

#### TemplateEditor.jsx
- **Visual Designer**: Drag-and-drop interface for creating engagement flows
- **Component Library**: Reusable UI components for different engagement types
- **Logic Builder**: Define engagement rules, scoring, and progression
- **Preview System**: Test templates before deployment

#### ContentManager.jsx
- **Global Content**: Manage system-wide content sets available to all users
- **Template Content**: Create default content for new engagement types
- **Import Tools**: Bulk import and validation of content sets
- **Quality Control**: Review and approve user-submitted content

---

## 2. Template Creation Workflow

### 2.1 New Engagement Type Creation

#### Template Initialization
```
🏗️ Create New Engagement Template

┌─ Basic Information ────────────────────────────────────┐
│ Template Name: [Team Collaboration Exercise          ] │
│ Template ID: [team-collab-v1                        ] │
│ Category: [Team Building ▼]                          │
│ Description: [Interactive exercise for team dynamics ] │
│ Estimated Duration: [15-30 minutes                  ] │
│ Difficulty Level: [Beginner ▼]                       │
└────────────────────────────────────────────────────────┘

┌─ Engagement Settings ──────────────────────────────────┐
│ Participant Limits:                                    │
│ • Minimum: [3] participants                           │
│ • Maximum: [50] participants                          │
│ • Recommended: [8-12] participants                    │
│                                                        │
│ Features:                                              │
│ ☑ Real-time responses    ☑ Voting phase               │
│ ☑ AI summarization      ☐ Breakout groups             │
│ ☑ Progress tracking      ☐ Anonymous mode             │
│ ☑ Mobile optimized       ☑ Accessibility support      │
└────────────────────────────────────────────────────────┘

[Continue to Flow Designer] [Save Draft] [Cancel]
```

#### Flow Designer Interface
```
🎨 Engagement Flow Designer

┌─ Phase Library ────────────────────────────────────────┐
│ Drag components to build your engagement flow:         │
│                                                        │
│ 📝 [Content Phase]     🗳️ [Voting Phase]              │
│ 📊 [Results Phase]     🤖 [AI Analysis]               │
│ 💬 [Discussion Phase]  ⏱️ [Timer Component]           │
│ 🎯 [Scoring Phase]     📱 [Breakout Groups]           │
└────────────────────────────────────────────────────────┘

┌─ Flow Canvas ──────────────────────────────────────────┐
│ START                                                  │
│   ↓                                                    │
│ ┌─────────────────┐                                   │
│ │  JOINING PHASE  │ ← Participants join session       │
│ │  (Built-in)     │                                   │
│ └─────────────────┘                                   │
│   ↓                                                    │
│ ┌─────────────────┐                                   │
│ │ CONTENT PHASE 1 │ ← Drag from library               │
│ │ Team Challenge  │   [Edit] [Delete] [Duplicate]     │
│ └─────────────────┘                                   │
│   ↓                                                    │
│ ┌─────────────────┐                                   │
│ │  VOTING PHASE   │                                   │
│ │ Peer Evaluation │   [Edit] [Delete] [Duplicate]     │
│ └─────────────────┘                                   │
│   ↓                                                    │
│ ┌─────────────────┐                                   │
│ │ RESULTS PHASE   │                                   │
│ │ Show Rankings   │   [Edit] [Delete] [Duplicate]     │
│ └─────────────────┘                                   │
│   ↓                                                    │
│ END                                                    │
└────────────────────────────────────────────────────────┘

[Add Phase] [Test Flow] [Save Template] [Preview]
```

### 2.2 Component Configuration

#### Content Phase Configuration
```
⚙️ Configure Content Phase: "Team Challenge"

┌─ Phase Settings ───────────────────────────────────────┐
│ Phase Name: [Team Challenge                          ] │
│ Duration: [5 minutes per item                        ] │
│ Content Type: [Scenario-based questions ▼           ] │
│ Delivery Order: ○ Sequential ● Random ○ User Choice   │
│                                                        │
│ Participant Interaction:                               │
│ ● Individual responses → Group discussion              │
│ ○ Group collaboration → Individual reflection          │
│ ○ Real-time collaboration                             │
└────────────────────────────────────────────────────────┘

┌─ Content Structure ────────────────────────────────────┐
│ Content Format:                                        │
│ • Scenario Description (required)                      │
│ • Challenge Question (required)                        │
│ • Response Options (optional - for guided responses)   │
│ • Follow-up Questions (optional)                       │
│ • Resource Links (optional)                           │
│                                                        │
│ Example Content Item:                                  │
│ Scenario: "Your team has conflicting priorities..."    │
│ Challenge: "How would you facilitate resolution?"      │
│ Options: Open text response                           │
└────────────────────────────────────────────────────────┘

┌─ Scoring and Feedback ─────────────────────────────────┐
│ Scoring Method:                                        │
│ ○ No scoring (feedback only)                          │
│ ● Peer voting (participants vote on responses)        │
│ ○ Facilitator scoring                                 │
│ ○ AI-assisted scoring                                 │
│                                                        │
│ Feedback Display:                                      │
│ ☑ Show all responses to group                         │
│ ☑ Highlight top-voted responses                       │
│ ☐ Anonymous response display                          │
│ ☑ Real-time response counter                          │
└────────────────────────────────────────────────────────┘

[Save Configuration] [Test Phase] [Cancel Changes]
```

#### AI Integration Configuration
```
🤖 AI Analysis Configuration

┌─ AI Summary Settings ──────────────────────────────────┐
│ Enable AI Summary: ☑ Yes ☐ No                         │
│                                                        │
│ Summary Triggers:                                      │
│ ☑ After each content phase                            │
│ ☑ After voting phases                                 │
│ ☑ At engagement completion                            │
│ ☐ On-demand only                                      │
│                                                        │
│ Analysis Focus:                                        │
│ ☑ Response themes and patterns                        │
│ ☑ Participation and engagement levels                 │
│ ☑ Learning insights and recommendations               │
│ ☑ Team dynamics observations                          │
└────────────────────────────────────────────────────────┘

┌─ Custom AI Prompts ────────────────────────────────────┐
│ Base Prompt Template:                                  │
│ ┌─────────────────────────────────────────────────────┐ │
│ │ You are an expert facilitator analyzing team       │ │
│ │ collaboration responses. Focus on identifying       │ │
│ │ patterns in problem-solving approaches and         │ │
│ │ communication styles. Provide actionable insights  │ │
│ │ for improving team effectiveness.                   │ │
│ └─────────────────────────────────────────────────────┘ │
│                                                        │
│ Phase-Specific Prompts:                               │
│ • Content Phase: [Analyze response creativity...]     │
│ • Voting Phase: [Examine consensus patterns...]       │
│ • Results Phase: [Summarize key learnings...]         │
│                                                        │
│ [Test AI Prompt] [Use Default] [Advanced Settings]    │
└────────────────────────────────────────────────────────┘

[Save AI Configuration] [Preview Output] [Cancel]
```

---

## 3. Content Set Management

### 3.1 Global Content Creation

#### System Content Library
```
📚 Global Content Library

[+ Create New Set] [📤 Import CSV] [🔍 Search] [🏷️ Filter]

┌─ System Content Sets ──────────────────────────────────┐
│ 🎯 General Knowledge Trivia        Type: Trivia        │
│    50 questions • 10 categories • Active              │
│    Usage: 1,247 sessions • Rating: 4.8/5              │
│    [Edit] [Duplicate] [Analytics] [Deactivate]        │
│                                                        │
│ 🧠 Leadership Fundamentals         Type: Lesson App    │
│    15 lessons • 3 modules • Active                    │
│    Usage: 892 sessions • Rating: 4.9/5                │
│    [Edit] [Duplicate] [Analytics] [Deactivate]        │
│                                                        │
│ 📊 Team Dynamics Assessment        Type: Survey        │
│    25 questions • 5 sections • Active                 │
│    Usage: 634 sessions • Rating: 4.7/5                │
│    [Edit] [Duplicate] [Analytics] [Deactivate]        │
│                                                        │
│ 🗳️ Innovation Workshop Tools       Type: Poll          │
│    12 polls • 4 categories • Draft                    │
│    Usage: 0 sessions • Not yet published              │
│    [Edit] [Test] [Publish] [Delete]                   │
└────────────────────────────────────────────────────────┘

┌─ Content Performance ──────────────────────────────────┐
│ Most Popular Content (Last 30 days):                  │
│ 1. General Knowledge Trivia (89 sessions)             │
│ 2. Leadership Fundamentals (67 sessions)              │
│ 3. Team Dynamics Assessment (45 sessions)             │
│                                                        │
│ Highest Rated Content:                                │
│ 1. Leadership Fundamentals (4.9/5)                    │
│ 2. General Knowledge Trivia (4.8/5)                   │
│ 3. Team Dynamics Assessment (4.7/5)                   │
│                                                        │
│ [Detailed Analytics] [Usage Reports] [Export Data]    │
└────────────────────────────────────────────────────────┘
```

#### Content Quality Control
```
✅ Content Review Queue

┌─ Pending Review ───────────────────────────────────────┐
│ 📝 User Submission: "Sales Training Quiz"             │
│    Submitted by: john@company.com                      │
│    Type: Trivia • 20 questions • 4 categories         │
│    Submitted: Jan 15, 2024                            │
│    [Review Content] [Approve] [Request Changes] [Reject] │
│                                                        │
│ 📊 User Submission: "Customer Feedback Survey"        │
│    Submitted by: sarah@startup.com                     │
│    Type: Survey • 15 questions • 3 sections           │
│    Submitted: Jan 14, 2024                            │
│    [Review Content] [Approve] [Request Changes] [Reject] │
└────────────────────────────────────────────────────────┘

┌─ Review Criteria ──────────────────────────────────────┐
│ Content Quality:                                       │
│ ☑ Appropriate language and tone                       │
│ ☑ Clear and understandable questions                  │
│ ☑ Accurate information (fact-checked)                 │
│ ☑ Inclusive and accessible content                    │
│                                                        │
│ Technical Requirements:                                │
│ ☑ Proper formatting and structure                     │
│ ☑ Complete metadata and categorization                │
│ ☑ Compatible with engagement type                     │
│ ☑ Appropriate difficulty level                        │
│                                                        │
│ [Review Guidelines] [Approval Workflow] [Quality Standards] │
└────────────────────────────────────────────────────────┘
```

### 3.2 Template Content Integration

#### Default Content Assignment
```
🔗 Template Content Integration

Template: Team Collaboration Exercise

┌─ Default Content Sets ─────────────────────────────────┐
│ Assign default content that users can select:          │
│                                                        │
│ ☑ Team Building Scenarios (12 scenarios)              │
│   Default for new users of this template              │
│                                                        │
│ ☑ Communication Challenges (8 scenarios)              │
│   Alternative content option                          │
│                                                        │
│ ☐ Leadership Dilemmas (10 scenarios)                  │
│   Advanced content option                             │
│                                                        │
│ ☑ Problem-Solving Exercises (15 scenarios)            │
│   Recommended for larger groups                       │
└────────────────────────────────────────────────────────┘

┌─ Content Customization Options ────────────────────────┐
│ Allow users to:                                        │
│ ☑ Upload their own content sets                       │
│ ☑ Modify default content                              │
│ ☑ Mix multiple content sets                           │
│ ☐ Create content during session                       │
│                                                        │
│ Content Validation:                                    │
│ ☑ Require minimum number of items (5)                 │
│ ☑ Validate content format                             │
│ ☑ Check for appropriate content                       │
│ ☐ Require admin approval for custom content           │
└────────────────────────────────────────────────────────┘

[Save Content Integration] [Test with Sample Data] [Preview User Experience]
```

---

## 4. Template Testing and Validation

### 4.1 Template Testing Environment

#### Test Session Setup
```
🧪 Template Testing: "Team Collaboration Exercise"

┌─ Test Configuration ───────────────────────────────────┐
│ Test Mode: [Full Simulation ▼]                        │
│ Simulated Participants: [8] (John, Mary, Alex...)     │
│ Content Set: [Team Building Scenarios]                │
│ Test Duration: [Accelerated - 5x speed]               │
│                                                        │
│ Test Scenarios:                                        │
│ ☑ Normal flow completion                              │
│ ☑ Participant disconnection/reconnection             │
│ ☑ Late participant joining                           │
│ ☑ Host controls and phase transitions                │
│ ☑ AI summary generation                              │
│ ☑ Mobile device simulation                           │
└────────────────────────────────────────────────────────┘

[Start Test Session] [Load Previous Test] [Configure Advanced]
```

#### Test Results Analysis
```
📊 Test Results: "Team Collaboration Exercise"

┌─ Performance Metrics ──────────────────────────────────┐
│ ✅ Template Execution: Successful                      │
│ ✅ Phase Transitions: All working correctly           │
│ ✅ Real-time Updates: Average latency 45ms            │
│ ✅ AI Summary: Generated in 23 seconds                │
│ ⚠️  Mobile Layout: Minor spacing issue on iPhone SE   │
│ ❌ Accessibility: Missing alt text on 2 components    │
└────────────────────────────────────────────────────────┘

┌─ User Experience Simulation ───────────────────────────┐
│ Participant Feedback (Simulated):                     │
│ • Clear instructions and easy navigation               │
│ • Engaging content and appropriate difficulty          │
│ • Good pacing and time management                     │
│ • Minor: Some buttons too small on mobile             │
│                                                        │
│ Host Experience:                                       │
│ • Intuitive controls and clear status indicators      │
│ • Effective real-time monitoring                      │
│ • Useful AI insights and summaries                    │
│ • Suggestion: Add bulk participant management         │
└────────────────────────────────────────────────────────┘

┌─ Technical Validation ─────────────────────────────────┐
│ ✅ Database schema compatibility                       │
│ ✅ WebSocket message handling                          │
│ ✅ Token calculation accuracy                          │
│ ✅ Error handling and recovery                         │
│ ✅ Cross-browser compatibility                         │
│ ⚠️  Performance optimization needed for 50+ participants │
└────────────────────────────────────────────────────────┘

[Fix Issues] [Approve for Deployment] [Run Extended Test] [Export Report]
```

### 4.2 Quality Assurance Checklist

#### Pre-Deployment Validation
```
✅ Quality Assurance Checklist

Template: Team Collaboration Exercise v1.0

┌─ Functionality Testing ────────────────────────────────┐
│ ☑ All engagement phases work correctly                │
│ ☑ Participant joining and leaving handled gracefully  │
│ ☑ Host controls function as expected                  │
│ ☑ Real-time updates work across all devices           │
│ ☑ Data persistence and recovery mechanisms            │
│ ☑ AI integration and summary generation               │
│ ☑ Token calculation and billing integration           │
└────────────────────────────────────────────────────────┘

┌─ User Experience Testing ──────────────────────────────┐
│ ☑ Intuitive navigation and clear instructions         │
│ ☑ Responsive design across device sizes               │
│ ☑ Accessibility compliance (WCAG 2.1 AA)             │
│ ☑ Performance optimization (< 3s load time)           │
│ ☑ Error messages are helpful and actionable           │
│ ☑ Offline resilience and connection recovery          │
└────────────────────────────────────────────────────────┘

┌─ Content and Compliance ───────────────────────────────┐
│ ☑ Default content reviewed and approved               │
│ ☑ Content guidelines and restrictions documented      │
│ ☑ Privacy and data handling compliance                │
│ ☑ Inclusive language and accessibility                │
│ ☑ Age-appropriate content and interactions            │
│ ☑ Cultural sensitivity review completed               │
└────────────────────────────────────────────────────────┘

┌─ Documentation and Support ────────────────────────────┐
│ ☑ User documentation created                          │
│ ☑ Host guide and best practices                       │
│ ☑ Troubleshooting guide                              │
│ ☑ API documentation updated                           │
│ ☑ Support team training materials                     │
│ ☑ Release notes and changelog                         │
└────────────────────────────────────────────────────────┘

Approval Status: ⏳ Pending Final Review
[Approve for Production] [Request Changes] [Schedule Review]
```

---

## 5. Template Deployment and Management

### 5.1 Deployment Pipeline

#### Template Packaging
```
📦 Template Deployment: "Team Collaboration Exercise"

┌─ Deployment Package ───────────────────────────────────┐
│ Template Files:                                        │
│ ✅ template-config.json (metadata and settings)        │
│ ✅ engagement-flow.json (phase definitions)            │
│ ✅ ui-components/ (React components)                   │
│ ✅ default-content/ (sample content sets)             │
│ ✅ ai-prompts/ (AI integration templates)             │
│ ✅ documentation/ (user guides and help)              │
│                                                        │
│ Infrastructure:                                        │
│ ✅ CloudFormation templates updated                    │
│ ✅ Lambda functions deployed                           │
│ ✅ Database schema migrations                          │
│ ✅ API Gateway routes configured                       │
└────────────────────────────────────────────────────────┘

┌─ Deployment Environments ──────────────────────────────┐
│ 🟢 Development: Deployed successfully                  │
│    Version: v1.0.0-dev.123                           │
│    Last deployed: Jan 15, 2024 10:30 AM              │
│                                                        │
│ 🟡 Staging: Ready for deployment                       │
│    Target version: v1.0.0-rc.1                       │
│    Scheduled: Jan 16, 2024 2:00 PM                   │
│                                                        │
│ ⏳ Production: Pending approval                        │
│    Target version: v1.0.0                            │
│    Scheduled: Jan 18, 2024 9:00 AM                   │
└────────────────────────────────────────────────────────┘

[Deploy to Staging] [Schedule Production] [Rollback] [View Logs]
```

#### Template Versioning
```
📋 Template Version Management

Template: Team Collaboration Exercise

┌─ Version History ──────────────────────────────────────┐
│ v1.0.0 (Production)        Jan 18, 2024               │
│ • Initial release with core functionality             │
│ • 4 engagement phases, AI integration                 │
│ • Mobile optimization and accessibility               │
│ [View Details] [Download] [Create Hotfix]             │
│                                                        │
│ v1.1.0 (In Development)    Target: Feb 15, 2024       │
│ • Enhanced mobile experience                          │
│ • Additional content customization options            │
│ • Improved AI summary algorithms                      │
│ [View Progress] [Edit] [Test Build]                   │
│                                                        │
│ v0.9.0 (Archived)          Jan 10, 2024               │
│ • Beta version with limited features                  │
│ • Used for internal testing only                      │
│ [View Details] [Archive]                              │
└────────────────────────────────────────────────────────┘

┌─ Version Control ──────────────────────────────────────┐
│ Branching Strategy:                                    │
│ • main: Production-ready code                         │
│ • develop: Integration branch for new features        │
│ • feature/*: Individual feature development           │
│ • hotfix/*: Critical production fixes                 │
│                                                        │
│ Release Process:                                       │
│ 1. Feature development and testing                    │
│ 2. Integration testing in staging                     │
│ 3. User acceptance testing                            │
│ 4. Production deployment approval                     │
│ 5. Post-deployment monitoring                         │
└────────────────────────────────────────────────────────┘
```

---

This System Builder provides comprehensive tools for creating, testing, and deploying engagement templates while maintaining quality standards and user experience consistency across the platform.
