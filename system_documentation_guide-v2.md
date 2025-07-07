# System Documentation Guide – Meeting Engagements Platform

## 🗺️ Overview: Platform Surfaces and Audiences

This platform contains **four distinct application surfaces**, each serving a different user group with its own set of functionality. The system manages and provides tools for unique interaction with partipants in an event. We call the tools engagmenets. They are polls, trivia games, excericses, surveys, thought proviking call and answer, prioritizations, and  collaborations that are used for organziations during offistes to help their initatives.    

### 1. Builder UI (Internal Product Team)

- Internal-use only
- Used by the platform builders to create and configure reusable engagement templates: Trivia, Polls, Lessons, Bingo, etc.
- Outputs New Engagements, with a tool name, the flow, instructions for partipants, custom experiences, and output definition. one type of User, called hosts, will select from the tools and chose a data set (either system wide provided, or one they have uploaded), they then can share an event code to their partipants and partipants can join via phone, laptop or tablet.
- Define the content set template. content sets can be uploaded system-wide or per host. content sets are uniquly formated per event type (trivia is different than call and answer, which is different from polls, etc)
- Supports building, and publishing engagments for use by external users of the system. These engagements will be identified by gameID below, and can be hosted and managed by the host, up to 7 days in advance by default (system setting)

### 2. External User Portal / Dashboard (For Event Facilitators, Customers)

- Public-facing user interface for customers to log in and:
  - See token balance and plan tier
  - Launch available engagments(games/polls/tools) that were built using the Builder
  - Administer their own content sets
  - View and control their currently active experiences
  - Ability to define the experiences by type, add context, pick content sets, etc either prior to the meeting (so everything is setup) or adhoc.
- Authenticated per user
- Permissions scoped to user-owned content and game instances

### 3. Agenda Builder (Planned Future Tool)

- Will allow external users to build multi-day event agendas
- Create/edit/delete scheduled sessions: trainings, workshops, offsites, mini-conferences
- Each session can:
  - Attach engagments (game, poll, trivia, etc.)
  - Predefine content set, category, instructions, background theme
  - Generate QR code invite link for attendees
- Attendees:
  - Can RSVP
  - Access presentations, feedback, live activities
  - Join chats and interactive tools triggered by presenters

  ### 4. Engagement 
  - Main interface for the interaction for 

This document defines the **complete schema guidance**, **AI summarization support system**, and **API documentation architecture** (including OpenAPI/Swagger), to be implemented by the AI Agent and used across both the Builder system and the engagements.

---

## 📚 Part 1: Schema Guidance Documentation

... (existing content unchanged)

---

## 🔧 Part 5: Runtime Engagement Architecture and Flow

### 🔁 Engagement Lifecycle Phases

Each engagement progresses through a defined lifecycle. These states are persisted under the game ID and used to control frontend routing and host/player behavior.

| State      | Description                                                  |
| ---------- | ------------------------------------------------------------ |
| `INIT`     | Game instance created, no participants yet                   |
| `JOINING`  | Waiting for players to connect via code or link              |
| `ACTIVE`   | Host begins game; questions are asked in order or randomly   |
| `VOTING`   | Optional phase where users vote on others’ responses         |
| `FINISHED` | Game complete; summary report and AI output may be generated |

These are stored as:

```txt
PK: GAMEID#[ID]    SK: STATE
ATTRIBUTES: phase (INIT | JOINING | ACTIVE | VOTING | FINISHED), updatedAt
```

### 🧑‍💻 Component Responsibilities

#### GameHostPage.jsx

- Displays current question or voting prompt
- Advances game state on button click
- Can view submitted answers, optionally reveal correct answers (trivia)
- Triggers AI summary after game ends

#### PlayerPage.jsx

- Shows joining interface with game code
- Displays current question and allows answer input
- Locks responses after submission
- Displays results (trivia) or other answers (lesson games)

#### AdminPage.jsx

- Controls game lifecycle start to finish
- Can reset state, delete game, or view token usage
- Limited to content and games owned by the logged-in user

#### WebSocketClient.js

- Handles real-time state updates using API Gateway WebSocket API
- Player state and host state synced via `onMessage`
- Reconnects on page refresh or mobile sleep

#### App.jsx / index.jsx

- Controls routing across `/host`, `/player`, `/admin`, etc.
- Injects current game state via context or props

## 🎨 Part 6: Styling & UI Patterns

### Purpose:

Provide a unified design language and component look-and-feel across all outputted games. The UI is built to function well across phones, tablets, and desktop displays during live events.

### ✨ CSS Class Breakdown

#### Core Switch Styling

```css
.switch {
  position: relative;
  display: inline-block;
  width: 60px;
  height: 34px;
}

.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
  position: absolute;
  cursor: pointer;
  top: 0; left: 0; right: 0; bottom: 0;
  background-color: #ccc;
  transition: .4s;
  border-radius: 34px;
}

.slider:before {
  position: absolute;
  content: "";
  height: 26px; width: 26px;
  left: 4px; bottom: 4px;
  background-color: white;
  transition: .4s;
  border-radius: 50%;
}

input:checked + .slider {
  background-color: #2196F3;
}

input:focus + .slider {
  box-shadow: 0 0 1px #2196F3;
}
```

#### Layout Classes

- `.content-box`: White card with soft shadow, used for host/player displays
- `.host-box`: Highlighted variant used by the host for admin actions
- `.question`: Enlarged font with margin; used for displaying active prompt
- `.answer-box`: Checkbox or freeform display depending on game type
- `.result-list`: Used to display voting or scoring outcomes

### 📱 Responsive Design Considerations

- Buttons are oversized for mobile use
- Viewport-aware layout scaling via flexbox/grid
- Minimal modal usage; prefers panel-based navigation

### 🧪 Style Guidelines

- Primary color: `#2196F3` (sky blue)
- Font: System default sans-serif (e.g., Helvetica, Arial)
- Emphasis on clarity, contrast, and interactivity

## 🧱 Part 7: Game Content Format Specs

### Purpose:

Define the structure, fields, and constraints of game content files and uploaded CSVs, enabling compatibility with the Builder system and generated game flows.

### 🔠 Content Format Types

#### 🎯 Trivia Content (`trivia-template.csv`)

| Column          | Type    | Required | Description                                     |
| --------------- | ------- | -------- | ----------------------------------------------- |
| `Category`      | string  | ✅        | Thematic group for sorting or scoring           |
| `Question`      | string  | ✅        | The prompt shown to players                     |
| `Option1-4`     | strings | ✅        | Multiple choice answers                         |
| `CorrectAnswer` | string  | ✅        | Correct response (should match one option)      |
| `Instructions`  | string  | ⛔️       | Optional override for how to play this category |

#### 🧠 Lesson Application (`lessons.csv`)

| Column           | Type   | Required | Description                                    |
| ---------------- | ------ | -------- | ---------------------------------------------- |
| `Lesson`         | string | ✅        | Short name of concept or inspiration           |
| `Description`    | string | ✅        | Contextual detail of the lesson                |
| `Instructions`   | string | ⛔️       | Specific call-to-action for players            |
| `PromptOverride` | string | ⛔️       | AI customization for summarization or response |

### 🏷 Metadata Per Set (in builder UI or YAML)

All content sets, regardless of type, include these fields at the metadata level:

```yaml
name: "Team Trivia Set - Fall Edition"
category: "Trivia"
deliveryOrder: "random"  # or "ordered"
instructions: "Answer each question quickly and confidently."
aiPrompt: "Summarize the team knowledge trends."
owner: user123
```

These metadata values:

- Are stored in the `SETS` and `SETID#` partitions
- Are inherited by the `GAMES` created using them
- May override AI behavior or player experience (e.g., presentation style)

### 🔄 Delivery Order

- `ordered`: Questions shown in CSV order (Q1 → Q2 → Q3...)
- `random`: Random subset or shuffled full list per session

These settings are available in the Builder when uploading a set or creating a new one inline.

## 🧭 Part 8: Builder Output Structure

### Purpose:

Describe what the Builder system produces for each game/tool type and how it enables rapid deployment and reuse.

### 🏗️ Output Artifacts Per Tool Build

Each created tool instance (e.g., Trivia, Poll, etc.) includes:

#### 🖼️ Frontend React App

- Customized based on selected tool template
- Injected with content set, game ID, and delivery rules
- Includes:
  - `App.jsx` wrapper
  - `PlayerPage.jsx`, `HostPage.jsx`, `AdminPage.jsx`
  - Preconfigured `WebSocketClient.js`
  - Token gating logic per player

#### 🧾 CloudFormation Template

- Based on base `template-dev.yaml`
- Includes:
  - Lambda handlers (createGame, recordAnswer, generateSummary, etc.)
  - WebSocket API routes and permissions
  - S3 bucket for deployment artifacts
  - DynamoDB table reference

#### 📥 Deployment Package

- Zipped folder with:
  - `build/` frontend
  - `template.yaml`
  - `/prompts/summaryPrompt.txt`
  - `/metadata.json` (title, tool type, tokens required)

#### 🌐 Hosting & Endpoint Mapping

- Hosted via CloudFront per subdomain (e.g., `game123.domain.com`)
- Player joins via short code URL (e.g., `g123.domain.com`)
- Admin interface via `/admin` route

#### 🧪 Token Cost Estimates

Stored in `metadata.json` or DynamoDB:

```json
{
  "estimatedTokens": 100,
  "calculation": "players * questions",
  "planRequired": "Free, Pro, Unlimited"
}
```

#### 🧠 AI Prompt Injection

- `summaryPrompt.txt` generated based on:
  - Game type
  - Set metadata
  - Voting or reflection phases
- Stored alongside the game or in `/prompts/`

#### 📄 Game Manifest

```json
{
  "gameId": "GAME#xyz",
  "setId": "SETID#abc",
  "toolType": "trivia",
  "createdBy": "user123",
  "frontendPath": "/games/game-xyz/index.html",
  "cloudFormationTemplate": "/infra/game-xyz/template.yaml",
  "promptFile": "/prompts/game-xyz/summaryPrompt.txt"
}
```

## 🧠 Part 9: AI Agent Execution and Iteration Strategy

### Objective:

Guide the AI Agent through a disciplined, autonomous build cycle of the full Builder platform and game deployment ecosystem.

### 📋 Overall Process Outline

1. **Initialize System Repos & Structure**

   - Create base project layout for frontend, backend, infra
   - Scaffold `/builder`, `/games`, `/infra`, `/prompts`, `/docs`

2. **Frontend Generator Framework**

   - Build modular React templates (trivia, polls, feedback, etc.)
   - Add token checks, join code entry, state-driven navigation

3. **CloudFormation Deployment Base**

   - Clone and extend `template-dev.yaml`
   - Parameterize: GameID, WebSocket route, S3 path, Lambda ARNs
   - Support export of packaged ZIP for upload/deployment

4. **DynamoDB Schema + Seed Loader**

   - Define tables, indexes, and TTL support
   - Create helper scripts to seed `SETS`, `GAMES`, `USERS`

5. **Admin & Auth**

   - Build simple signup/login UI (email/password)
   - Restrict AdminPage by `owner` match
   - Token ledger visible to admin users only

6. **Prompt Management**

   - Write base templates: `summaryPrompt.txt`, `aiPrompt.txt`
   - Store in `/prompts/[gameID]/`
   - Generate via backend `generatePromptLambda`

7. **AI Summary Flow**

   - Lambda: fetch answers, votes, lesson metadata, game info
   - Assemble input for Bedrock Claude call
   - Store AI response in `SUMMARY#` record

8. **Token Billing + Plan Enforcement**

   - Record per-player usage in `TokenLedger`
   - Check token balance before joining/starting
   - Enforce Free/Pro/Unlimited tier plan limits

9. **CSV Parser/Validator**

   - Tool to ingest `trivia-template.csv`, `lessons.csv`
   - Converts into JSON Set + Content records
   - Detects malformed rows or duplicates

10. **OpenAPI Documentation Generator**

- Produce `/docs/openapi.yaml`
- Document endpoints like `POST /games`, `GET /summary`, etc.

### 🔁 Iteration Strategy

- Work in **modular units** (one tool type or feature at a time)
- Use `dev/` prefix builds (e.g., `dev-trivia`, `dev-feedback`)
- Verify success through:
  - Frontend test case
  - CLI test of Lambda or API
  - Prompt preview validation

### ✅ Completion Criteria

- All 7 supported game types function end-to-end
- Builder UI operational with content upload + preview
- AI summaries generate as expected per content type
- Tokens enforce limits with proper error reporting
- Documentation generated: dev, user, and API

---

## 🧰 Part 10: Builder UI Wireframe and Flow

> 💡 **Update Scope:** Builder UI is for internal platform customers (event hosts, facilitators) who log in, manage tokens, launch game tools, and optionally administer their own content. The product team uses this to expose tools created via the App Builder. Future Expansion: An Agenda Builder system allows event/session planning with attached game tools, access control, and session-specific configuration.

### Purpose:

Define the user experience and layout of the Builder UI that guides users in creating, managing, and deploying interactive tools.

### 🧩 Primary Screens

#### 1. **Dashboard Page**

| Section         | Description                                       |
| --------------- | ------------------------------------------------- |
| Token Balance   | Display current token count & plan status         |
| Create New      | Button to launch new tool/game wizard             |
| My Games        | List of games created (filter by tool, date, set) |
| My Content Sets | View/edit uploaded content sets                   |

#### 2. **Create Tool Wizard**

A multi-step flow for creating a new tool/game.

1. **Select Tool Type**: `Trivia`, `Lesson App`, `Poll`, `Survey`, etc.
2. **Upload or Select Content Set**
   - Option to upload CSV or select existing
   - Configure metadata (`deliveryOrder`, `instructions`, `aiPrompt`)
3. **Configure Game Settings**
   - Max Players, Voting phase?, Auto-start?, AI Summary enabled?
4. **Estimate Token Usage**
   - Show estimated usage based on players \* content items
5. **Deploy**
   - Generates subdomain, game code, and links for host/player

#### 3. **Content Set Manager**

| Feature            | Description                                   |
| ------------------ | --------------------------------------------- |
| Upload CSV         | Upload `trivia-template.csv` or `lessons.csv` |
| Manual Entry       | UI to manually create/edit questions          |
| Delivery Order     | `random` or `ordered` toggle                  |
| Preview & Validate | Check structure and estimate token impact     |

#### 4. **Admin Page (Per)**

Accessible via `/admin` route with auth

- View participant count & tokens used
- Trigger game phases manually (start, next question, end)
- View content set questions (by engagement type) in current order
- Trigger AI 
- Delete/reset game instance

### 🧾 Visual Layout Reference

**Navigation Menu** (left or top):

- Dashboard
- My Games
- Content Sets
- Create Tool
- Account & Tokens

**Styling:**

- Reuse `.content-box`, `.switch`, `.slider` classes for consistency
- Responsive layout with flex/grid
- Use icons for tool types (e.g., 📊 for Poll, 🎯 for Trivia)

**Modals:**

- Used for CSV upload, confirmation dialogs, manual content edits

### 🔐 Auth Integration

- Login/Signup page (email/password)
- JWT session stored in localStorage
- Role-based access: `owner` of game/content sets can only manage their own

## 🧑‍💼 Part 11: External User Dashboard Wireframe and Flow

### 🎯 Purpose

To provide a clear, intuitive interface for customers (facilitators, event owners) to:

- View token balances and usage
- Launch prebuilt interactive tools
- Manage their own content sets
- Monitor and administer live game sessions

### 🧩 Key Screens and Flows

#### 1. **User Home / Dashboard**

| Component       | Purpose                                               |
| --------------- | ----------------------------------------------------- |
| Welcome Box     | Greets the user, shows their name & current plan tier |
| Token Overview  | Shows remaining tokens, renewal date, plan limits     |
| Active Sessions | Lists currently running games/sessions                |
| Launch New Tool | Shortcut to begin a new tool session                  |
| My Content Sets | View, edit, or add content for private use            |

#### 2. **Launch Tool Flow**

Step-by-step tool launch sequence:

1. Select tool type (Trivia, Poll, etc.)
2. Choose from:
   - System-provided content sets
   - User-uploaded content sets
3. Customize session metadata:
   - Title, Background, Delivery Mode, Visibility
   - Optionally override player instructions
4. Confirm estimated token cost
5. Deploy and get session code/QR link

#### 3. **Content Set Manager**

| Feature        | Description                                    |
| -------------- | ---------------------------------------------- |
| Upload New Set | Import CSV or use inline editor                |
| Tagging        | Organize sets by theme or event type           |
| Preview        | See structure, estimate impact, test sample AI |
| Reuse/Delete   | Manage owned sets only                         |

#### 4. **Session Admin View**

| Tab              | Details                                           |
| ---------------- | ------------------------------------------------- |
| Summary          | Game status, joined players, total usage          |
| Phase Control    | Host can move game to next stage (e.g., Q2, Vote) |
| Token Log        | Per-player participation token spend              |
| Generate Summary | Runs AI summarization                             |

#### 5. **Account & Plan Management**

- View current tier (Free, Pro, Unlimited)
- Upgrade or modify plan
- View token top-ups, purchase history
- Reset password or update user info

### 🧠 Notes

- All content/tools launched by user are scoped by their `userId`
- System content sets always available
- QR code + join code generated per session
- Responsive layout for desktop/tablet use

## 🗓️ Part 12: Agenda Builder Wireframe (Planned Tool)

### 🎯 Purpose

To enable users to build rich, multi-day agendas for events like workshops, summits, or trainings—embedding games, polls, and feedback tools into scheduled sessions.

### 🧩 Key Screens and Flows

#### 1. **Agenda Dashboard**

| Section           | Description                                               |
| ----------------- | --------------------------------------------------------- |
| My Agendas        | Lists all created agendas (with date range & event title) |
| Create New Agenda | Button to launch the agenda builder wizard                |
| Token Overview    | Shows remaining tokens; link to user dashboard            |
| Sessions by Date  | Expandable list of sessions per agenda, grouped by day    |

#### 2. **Agenda Creation Flow**

1. Enter Agenda Title, Host Info, Date Range
2. Add one or more days to agenda
3. For each day:
   - Add sessions: title, start time, end time, presenter
   - Optional: attach files/presentations
   - Optional: add links to feedback forms or chat
   - Select tools to attach (Trivia, Poll, etc.)
   - Configure tool metadata (theme, background, content set)
4. Generate QR Code Invite for agenda or session

#### 3. **Session Configuration Modal**

| Field               | Purpose                                                    |
| ------------------- | ---------------------------------------------------------- |
| Title & Description | Public-facing title, internal notes                        |
| Presenter Name      | Listed on invite and during session                        |
| Attach Game/Tool    | Select game/poll/survey (from available user dashboard)    |
| Pre-configure Tool  | Choose content set, delivery order, custom player guidance |
| Enable RSVP         | If enabled, collect attendee signups via QR link           |

#### 4. **Attendee View (Mobile-Optimized)**

| Feature              | Description                                   |
| -------------------- | --------------------------------------------- |
| Event Invite Page    | Shows sessions, presenters, times, join links |
| RSVP / Login Option  | Allows user to save to calendar or sign in    |
| Active Tools Button  | Only visible when host activates a session    |
| Chat/Discussion Feed | Optional embedded group thread per session    |

### 🧠 Notes

- Agendas are scoped per user or team
- Sessions reference ToolIDs from user’s dashboard
- QR codes link to session-specific landing pages (not generic tools)
- RSVP and feedback tied to event/session ID

## 📘 Appendix A: Planned Tool Types and Token Logic

### 🎮 Supported Tool Types

| Tool Name        | Description                                                              |
| ---------------- | ------------------------------------------------------------------------ |
| Trivia           | Multiple choice quiz format; AI summary optional                         |
| Poll             | Players vote on predefined options; results shown in real time           |
| Survey           | Structured form submission; no competitive element                       |
| Lesson App       | Players reflect/apply a lesson to their work context and vote on answers |
| Feedback Tool    | Open-ended prompts for collecting feedback on sessions or events         |
| Bingo Trivia     | Host-led facts/questions with Bingo card layout on player devices        |
| Solutioning Tool | Prompt-based design or planning challenge for teams or individuals       |

Each tool type has its own:

- UI layout template (Host/Player/Admin)
- Expected content format
- Lifecycle phases (START, ANSWER, VOTE, END)
- AI summary logic (optional)

### 🔐 Token Usage Logic

Tokens are used to track fair usage of the platform for non-Unlimited plans.

#### 📊 Calculation:

```
totalTokens = numParticipants × numContentItems
```

- `numParticipants`: Number of players who joined the game
- `numContentItems`: Number of questions/prompts answered or voted

#### 🔧 Plan Tiers:

| Plan Name | Monthly Tokens | Features Included                              |
| --------- | -------------- | ---------------------------------------------- |
| Free      | 20 tokens      | Max 5 users/game, no AI summary                |
| Pro       | 1,000 tokens   | AI summaries, player voting, full admin access |
| Unlimited | ∞              | No restrictions, priority AI processing        |

#### 📎 Token Enforcement:

- Tokens are deducted **at time of game phase execution**, not game creation
- AI summary generation also consumes additional tokens (e.g., 5 tokens/summary)
- Sessions display estimated token usage before launch

### 📌 Token Storage Schema

```txt
PK: USER#user123   SK: TOKENLEDGER#[gameID]#[timestamp]
Fields: usedTokens, reason (join, vote, summary), setId, gameId
```

### 🧪 Example Scenarios:

1. **Trivia for 10 players, 10 questions** → 100 tokens used
2. **Lesson app with 8 players, 3 questions, voting** → 8×3 (answers) + 8×3 (votes) = 48 tokens
3. **Survey sent to 50 attendees** → 50 tokens
4. **Poll with 25 players, no AI summary** → 25 tokens

Next up: ✍️ OpenAPI Specification Overview

