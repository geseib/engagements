# Host Admin Dashboard Documentation

## Overview

The Host Admin Dashboard is the primary interface for external users (event facilitators, customers) to manage their account, content, engagements, and view analytics. This dashboard provides comprehensive tools for planning, executing, and analyzing interactive meeting sessions.

---

## 1. Dashboard Architecture

### Core Components

#### AdminDashboard.jsx
- **Main Interface**: Central hub for all admin functions
- **User Authentication**: Secure login and session management
- **Navigation**: Organized access to all admin features
- **Responsive Design**: Optimized for desktop and tablet use

#### UserProfile.jsx
- **Account Management**: Profile settings and preferences
- **Plan Management**: Token balance, usage, and plan upgrades
- **Billing Integration**: Payment history and subscription management

#### ContentManager.jsx
- **Content Set Management**: Create, edit, and organize content
- **Upload Tools**: CSV import and validation
- **Content Library**: Browse and manage all content sets

#### EngagementManager.jsx
- **Session Management**: Create, configure, and monitor engagements
- **History Tracking**: View past sessions and analytics
- **Template Management**: Save and reuse engagement configurations

---

## 2. Main Dashboard Screens

### 2.1 User Home Dashboard

```
🏠 Welcome back, George!

┌─ Account Overview ─────────────────────────────────────┐
│ Plan: Pro                    Token Balance: 847/1,000  │
│ Next Renewal: Feb 15, 2024   Usage This Month: 153     │
│ [Upgrade Plan] [Buy Tokens] [View Usage Details]       │
└────────────────────────────────────────────────────────┘

┌─ Quick Actions ────────────────────────────────────────┐
│ [🚀 Launch New Engagement] [📊 View Analytics]         │
│ [📁 Manage Content Sets]   [📋 Engagement History]     │
└────────────────────────────────────────────────────────┘

┌─ Active Sessions ──────────────────────────────────────┐
│ 🟢 Team Trivia Night        Join Code: A1B2  8 players │
│    Started: 2:30 PM         Status: Question 3/10      │
│    [View Host Interface] [Monitor] [End Session]       │
│                                                        │
│ 🟡 Leadership Survey        Join Code: C3D4  12 players│
│    Started: 1:45 PM         Status: Collecting responses│
│    [View Host Interface] [Monitor] [Generate Summary]  │
└────────────────────────────────────────────────────────┘

┌─ Recent Activity ──────────────────────────────────────┐
│ • Team Building Trivia completed - 15 participants     │
│ • New content set "Q4 Planning" uploaded              │
│ • Monthly usage report available                       │
│ • AI summary generated for "Leadership Workshop"       │
└────────────────────────────────────────────────────────┘
```

### 2.2 Token and Plan Management

```
💰 Account & Billing

┌─ Current Plan ─────────────────────────────────────────┐
│ Pro Plan - $29/month                                   │
│ ✅ 1,000 tokens/month    ✅ AI summaries enabled       │
│ ✅ Unlimited participants ✅ Advanced analytics        │
│ ✅ Custom content sets   ✅ Priority support           │
│                                                        │
│ [Upgrade to Unlimited] [Downgrade] [Cancel Plan]       │
└────────────────────────────────────────────────────────┘

┌─ Token Usage ──────────────────────────────────────────┐
│ This Month: 153/1,000 tokens used (15.3%)             │
│ ████████████████████████████████████████████████████   │
│                                                        │
│ Usage Breakdown:                                       │
│ • Trivia Sessions: 89 tokens (58%)                     │
│ • Poll Sessions: 34 tokens (22%)                       │
│ • Survey Sessions: 23 tokens (15%)                     │
│ • AI Summaries: 7 tokens (5%)                          │
│                                                        │
│ [View Detailed Usage] [Download Report] [Buy More]     │
└────────────────────────────────────────────────────────┘

┌─ Billing History ──────────────────────────────────────┐
│ Jan 2024: $29.00 - Pro Plan                           │
│ Dec 2023: $29.00 - Pro Plan                           │
│ Nov 2023: $15.00 - Token Top-up (500 tokens)          │
│ Nov 2023: $29.00 - Pro Plan                           │
│                                                        │
│ [Download Invoices] [Update Payment Method]            │
└────────────────────────────────────────────────────────┘
```

---

## 3. Content Management System

### 3.1 Content Set Library

```
📁 My Content Sets

[+ Create New Set] [📤 Upload CSV] [🔍 Search] [🏷️ Filter by Type]

┌─ Content Sets ─────────────────────────────────────────┐
│ 📊 Team Building Trivia        Type: Trivia            │
│    25 questions • 5 categories • Created: Jan 10       │
│    Last used: Jan 15 • Usage: 3 sessions              │
│    [Edit] [Duplicate] [Preview] [Delete]               │
│                                                        │
│ 📋 Leadership Assessment       Type: Survey            │
│    12 questions • 3 sections • Created: Dec 20        │
│    Last used: Jan 12 • Usage: 2 sessions              │
│    [Edit] [Duplicate] [Preview] [Delete]               │
│                                                        │
│ 🎯 Q4 Planning Poll           Type: Poll               │
│    8 questions • 2 categories • Created: Jan 8        │
│    Last used: Never • Usage: 0 sessions               │
│    [Edit] [Duplicate] [Preview] [Delete]               │
│                                                        │
│ 🧠 Communication Skills       Type: Lesson App        │
│    6 lessons • 2 modules • Created: Dec 15            │
│    Last used: Jan 14 • Usage: 4 sessions              │
│    [Edit] [Duplicate] [Preview] [Delete]               │
└────────────────────────────────────────────────────────┘

System Content Sets (Read-only):
• General Knowledge Trivia (50 questions)
• Workplace Communication (15 lessons)
• Team Dynamics Assessment (20 questions)
• Innovation Workshop Tools (12 exercises)
```

### 3.2 Content Set Editor

```
✏️ Edit Content Set: "Team Building Trivia"

┌─ Set Metadata ─────────────────────────────────────────┐
│ Name: [Team Building Trivia                          ] │
│ Type: [Trivia ▼]                                      │
│ Description: [Fun trivia questions for team bonding  ] │
│ Delivery Order: ○ Sequential ● Random                  │
│ AI Summary: ☑ Enabled                                 │
│ Custom Instructions: [Answer quickly and have fun!   ] │
└────────────────────────────────────────────────────────┘

┌─ Categories ───────────────────────────────────────────┐
│ 🎬 Entertainment (8 questions)    [Edit] [Delete]      │
│ 🏃 Sports (6 questions)           [Edit] [Delete]      │
│ 🌍 Geography (5 questions)        [Edit] [Delete]      │
│ 🔬 Science (4 questions)          [Edit] [Delete]      │
│ 📚 Literature (2 questions)       [Edit] [Delete]      │
│                                                        │
│ [+ Add Category]                                       │
└────────────────────────────────────────────────────────┘

┌─ Questions Preview ────────────────────────────────────┐
│ 1. Which movie won Best Picture in 2023?              │
│    A) Top Gun: Maverick  B) Everything Everywhere...  │
│    C) The Banshees...    D) Avatar: The Way of Water  │
│    Correct: B • Category: Entertainment                │
│                                                        │
│ 2. What is the capital of Australia?                  │
│    A) Sydney  B) Melbourne  C) Canberra  D) Perth     │
│    Correct: C • Category: Geography                    │
│                                                        │
│ [+ Add Question] [Bulk Import] [Reorder] [Validate]   │
└────────────────────────────────────────────────────────┘

[Save Changes] [Preview Set] [Test with AI] [Cancel]
```

### 3.3 CSV Upload and Validation

```
📤 Upload Content Set

┌─ File Upload ──────────────────────────────────────────┐
│ Content Type: [Trivia ▼]                               │
│ File: [Choose File] leadership_questions.csv           │
│ ✅ File uploaded successfully (2.3 KB)                 │
│                                                        │
│ [Download Template] [View Format Guide]                │
└────────────────────────────────────────────────────────┘

┌─ Validation Results ───────────────────────────────────┐
│ ✅ 15 questions found                                  │
│ ✅ All required columns present                        │
│ ✅ No duplicate questions detected                     │
│ ⚠️  2 questions missing category (will use "General")  │
│ ❌ Question 8: Invalid correct answer format           │
│                                                        │
│ [Fix Issues] [Import Anyway] [Cancel]                  │
└────────────────────────────────────────────────────────┘

┌─ Preview ──────────────────────────────────────────────┐
│ Set Name: [Leadership Assessment                     ] │
│ Description: [Questions about leadership styles      ] │
│                                                        │
│ Sample Questions:                                      │
│ • What is your preferred leadership style?            │
│ • How do you handle team conflicts?                   │
│ • What motivates your team members most?              │
│                                                        │
│ Estimated Token Usage: 15 questions × avg 8 participants = 120 tokens │
└────────────────────────────────────────────────────────┘

[Create Content Set] [Edit Before Import] [Cancel]
```

---

## 4. Engagement Management

### 4.1 Engagement History and Analytics

```
📊 Engagement History

[🔍 Search] [📅 Date Range] [🏷️ Filter by Type] [📈 Analytics View]

┌─ Recent Engagements ───────────────────────────────────┐
│ 🎯 Team Building Trivia        Jan 15, 2024 2:30 PM    │
│    Type: Trivia • Participants: 8 • Duration: 25 min   │
│    Content: Team Building Trivia • Tokens: 80          │
│    Status: ✅ Completed • AI Summary: ✅ Generated     │
│    [View Results] [Download Report] [View Summary]     │
│                                                        │
│ 📋 Leadership Survey           Jan 12, 2024 10:00 AM   │
│    Type: Survey • Participants: 12 • Duration: 15 min  │
│    Content: Leadership Assessment • Tokens: 144        │
│    Status: ✅ Completed • AI Summary: ✅ Generated     │
│    [View Results] [Download Report] [View Summary]     │
│                                                        │
│ 🗳️ Q4 Planning Poll            Jan 10, 2024 3:15 PM    │
│    Type: Poll • Participants: 15 • Duration: 8 min     │
│    Content: Q4 Planning Poll • Tokens: 120             │
│    Status: ✅ Completed • AI Summary: ❌ Not generated │
│    [View Results] [Download Report] [Generate Summary] │
└────────────────────────────────────────────────────────┘

┌─ Usage Analytics ──────────────────────────────────────┐
│ This Month:                                            │
│ • Total Sessions: 12                                   │
│ • Total Participants: 147                              │
│ • Average Session Duration: 18 minutes                 │
│ • Most Popular Type: Trivia (50%)                      │
│ • Peak Usage Time: 2:00-4:00 PM                        │
│                                                        │
│ [Detailed Analytics] [Export Data] [Schedule Report]   │
└────────────────────────────────────────────────────────┘
```

### 4.2 Live Session Monitoring

```
📺 Live Session Monitor: "Team Building Trivia"

┌─ Session Overview ─────────────────────────────────────┐
│ Join Code: A1B2          Status: Question 3/10        │
│ Started: 2:30 PM         Duration: 8 minutes          │
│ Participants: 8/20       Tokens Used: 24              │
│ Host: George Seib        Last Update: 30 seconds ago  │
└────────────────────────────────────────────────────────┘

┌─ Current Question ─────────────────────────────────────┐
│ "Which artist released the album 'Thriller'?"         │
│ Time Remaining: 0:15                                   │
│ Responses: 6/8 participants                            │
│                                                        │
│ Response Breakdown:                                    │
│ A) Madonna: 1 response                                 │
│ B) Michael Jackson: 4 responses                        │
│ C) Prince: 1 response                                  │
│ D) Whitney Houston: 0 responses                        │
│ Waiting for: Mary Johnson, Tom Anderson                │
└────────────────────────────────────────────────────────┘

┌─ Participant Status ───────────────────────────────────┐
│ 🟢 John Smith (Host)     🟢 Alex Chen                  │
│ 🟢 Sarah Wilson          🟢 Mike Brown                 │
│ 🟢 Lisa Garcia           🟢 Emma Davis                 │
│ 🟡 Mary Johnson          🟡 Tom Anderson               │
│                                                        │
│ Legend: 🟢 Active 🟡 Slow Response 🔴 Disconnected     │
└────────────────────────────────────────────────────────┘

┌─ Session Controls ─────────────────────────────────────┐
│ [📱 Join as Host] [⏸️ Pause Session] [⏹️ End Early]    │
│ [📊 View Leaderboard] [💬 Send Message] [⚙️ Settings]  │
│ [📄 Generate Summary] [📤 Export Data] [🔄 Refresh]    │
└────────────────────────────────────────────────────────┘
```

---

## 5. AI Summary and Analytics

### 5.1 AI Summary Generation

```
🤖 AI Summary: "Team Building Trivia"

┌─ Summary Generation ───────────────────────────────────┐
│ Status: ✅ Complete                                    │
│ Generated: Jan 15, 2024 3:05 PM                       │
│ Processing Time: 45 seconds                            │
│ Tokens Used: 5                                         │
└────────────────────────────────────────────────────────┘

┌─ Key Insights ─────────────────────────────────────────┐
│ 📊 Participation: Excellent engagement with 100%      │
│    completion rate and average response time of 12s   │
│                                                        │
│ 🎯 Knowledge Areas: Team showed strong entertainment   │
│    knowledge (85% accuracy) but struggled with        │
│    geography questions (45% accuracy)                  │
│                                                        │
│ 🏆 Top Performers: Mike Brown and Emma Davis          │
│    consistently answered quickly and accurately        │
│                                                        │
│ 💡 Recommendations: Consider adding more geography     │
│    content for future sessions to build knowledge     │
│    in weaker areas                                     │
└────────────────────────────────────────────────────────┘

┌─ Detailed Analysis ────────────────────────────────────┐
│ Response Patterns:                                     │
│ • Fastest average response: Entertainment (8.2s)      │
│ • Slowest average response: Science (18.7s)           │
│ • Most confident answers: Sports category              │
│ • Most discussion-worthy: Literature questions         │
│                                                        │
│ Team Dynamics:                                         │
│ • High collaboration in uncertain answers              │
│ • Good sportsmanship throughout                        │
│ • Balanced participation across all members            │
│                                                        │
│ [Download Full Report] [Share Summary] [Archive]       │
└────────────────────────────────────────────────────────┘
```

### 5.2 Advanced Analytics Dashboard

```
📈 Analytics Dashboard

┌─ Usage Trends ─────────────────────────────────────────┐
│ Sessions per Month:                                    │
│ Dec 2023: ████████████ 12 sessions                    │
│ Jan 2024: ████████████████ 16 sessions                │
│                                                        │
│ Participant Growth:                                    │
│ Dec 2023: ████████ 89 total participants              │
│ Jan 2024: ████████████ 147 total participants         │
│                                                        │
│ [View Detailed Trends] [Export Charts]                │
└────────────────────────────────────────────────────────┘

┌─ Content Performance ──────────────────────────────────┐
│ Most Used Content Sets:                               │
│ 1. Team Building Trivia (8 sessions)                  │
│ 2. Leadership Assessment (5 sessions)                 │
│ 3. Communication Skills (4 sessions)                  │
│                                                        │
│ Highest Engagement Rates:                             │
│ 1. Trivia Sessions (95% completion)                   │
│ 2. Poll Sessions (92% completion)                     │
│ 3. Lesson Apps (88% completion)                       │
│                                                        │
│ [Content Optimization Tips] [Usage Recommendations]   │
└────────────────────────────────────────────────────────┘
```

---

## 6. Account and Security Management

### 6.1 Profile Settings

```
👤 Profile Settings

┌─ Personal Information ─────────────────────────────────┐
│ Name: [George Seib                                   ] │
│ Email: [george@seibtribe.com                         ] │
│ Organization: [Seib Tribe Consulting                 ] │
│ Role: [Facilitator                                   ] │
│ Time Zone: [Pacific Time (US & Canada) ▼            ] │
│                                                        │
│ [Update Profile] [Change Password]                     │
└────────────────────────────────────────────────────────┘

┌─ Notification Preferences ────────────────────────────┐
│ Email Notifications:                                   │
│ ☑ Session completion summaries                        │
│ ☑ Monthly usage reports                               │
│ ☑ Plan and billing updates                            │
│ ☐ New feature announcements                           │
│ ☐ Tips and best practices                             │
│                                                        │
│ [Save Preferences]                                     │
└────────────────────────────────────────────────────────┘

┌─ Data and Privacy ─────────────────────────────────────┐
│ Data Retention: 90 days after session completion      │
│ Export Options: [Download All Data] [Request Archive] │
│ Privacy Settings: [Manage Consent] [View Policy]      │
│ Account Actions: [Export Account] [Delete Account]    │
└────────────────────────────────────────────────────────┘
```

---

This admin dashboard provides comprehensive management capabilities while maintaining ease of use for facilitators and event organizers. The interface scales from simple session management to advanced analytics and content creation.
