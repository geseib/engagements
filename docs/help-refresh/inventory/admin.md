I've inventoried every admin console screen for all four audiences and checked the help claims against the code. In short: the console has only four help buttons, and the two admin guides plus two builder guides skip most of the screens added since tenancy. I found 18 claims that are stale or wrong; the five biggest are listed first in §4.

**Read this first:**
- **Last-change dates:** the clone is shallow. Its root commit (2026-10-15, "Session flow v3, phase 3", 2,852 files) is an import, so "≤10-15" below means "not changed since then; true date unknown". Only the 2026-10-21 dates are real changes.
- **Help buttons in /admin:** there are only four:
  - Top bar `?`: `section="admin"` opens the admin role index (`AdminPage.jsx:1883`).
  - Two `?` on the Prompts chooser cards: `ai-prompts` → `admin-ai-prompts` (`AdminPage.jsx:1998`, `2024`).
  - Settings → Real-time: `websocket-settings` → `admin-settings` (`AdminPage.jsx:2430`).
  - The `question-sets` alias (`index.js:56`) has no caller. The only other help link is a plain link in Billing, "How sessions are counted" → `/help/host-plan` (`BillingPanel.jsx:280`).

Audience labels: **P** = personal space, **TO/TA** = team owner/admin, **TM** = team member, **S** = Engage staff in Engage mode (`admins` group). The nav comes from `config/consoleSections.js:374-472`.

## 1. Screens and parts

| Screen / part (UI name) | File(s) | Audience | Key parts / controls | Help button → id | Last change |
|---|---|---|---|---|---|
| Shell: top bar, left nav, "Sections" button on phones, environment chip, Host ↗, Sign out | `components/AdminShell.jsx`, `AdminPage.jsx` | all | Grouped nav: "Your space"/"Account", the team's name/"Team", "Engage". Nav badges: Question sets (flagged + drafts), Plan requests, Accounts. Count: Moderation | Header `?` → `admin` (role index), with a report-issue menu | 10-21 |
| Scope row (the org switcher) | `ScopeTabs.jsx` | all; Engage tab (labelled "Engage · Staff") only for S | Personal, teams A–Z, More teams, Engage; + New team; + Personal space | none | ≤10-15 |
| Create a team dialog | `CreateOrgDialog.jsx` | all | Name, Create a team | none | ≤10-15 |
| Acting-as banner | `ActingAsBanner.jsx` | S | Leave Engage mode | none | ≤10-15 |
| Notifications bell | `NotificationsBell.jsx`, `utils/notificationsApi.js` | all | Count, list (drafts ready/partly ready/failed, invitations, approvals, sent-back sets, staff queues), Mark all read, Close; a click switches library and deep-links | none | 10-21 |
| Overview | `OverviewPanel.jsx`, `config/overviewAlerts.js` | P, TO/TA, TM, S (different per scope) | Boxes: invitations, sent back by the check, usage, plan request, reports deleted soon, awaiting approval, invitation running out, Engage staff opened your content. Staff boxes: accounts, plan requests, moderation, Claude 5.5 not connected. Uses DecideRequestDialog | none | ≤10-15 |
| Question sets list | `QuestionSetsPanel.jsx`, `ListControls.jsx`, `SetShelfBrowse.jsx` | P, TO/TA, TM; S sees it as "Shared library" | Search; filters for topic (shelf), type, status, owner; sort (incl. "Owner (yours first)"); shelf browse. Owner chip Yours/Team/Engage/Public (`utils/setOwnerTag.js`). Active and Quickstart chips are toggles. "Who can see it" column (org only). Row: Edit / Review / Open, Share, Copy, Delete; "Review · N" draft tag; New set | none | 10-21 |
| AI drafts strip | `DraftsStrip.jsx` | P, TO/TA, TM, S | Review / Watch / Restore… (discarded, restorable 7 days) | none | 10-21 |
| Review AI draft (a full screen with breadcrumb back) | `DraftReview.jsx`, `utils/draftsApi.js` | the draft's creator | Stop; keep/leave out per item or category; Edit; Regenerate this category; Generate the remaining N; Set name, Shelf, "Switch it on now"; Accept N of M; Undo; Discard draft (7-day restore); Decide later | none | 10-21 |
| New question set dialog | `NewSetDialog.jsx`, `QuestionSetUploadPanel.jsx` | P, TO/TA, TM, S (S writes to platform) | Engagement type; Generate with AI; Start from a template (Download template, copy the AI authoring prompt); Upload a file (CSV/JSON, title, shelf, preflight) | none | 10-15 / upload panel 10-21 |
| AI builders (4 modals) | `AIScenarioBuilder.jsx` (scenario/wavelength), `TriviaAIBuilder.jsx`, `PollAIBuilder.jsx`, `SurveyAIBuilder.jsx` + `DestinationField.jsx`, `GenerationJobPanel.jsx`, `FieldLock.jsx`, `AIFormAssist.jsx`, `CountField`, `BatchGuidanceField`, `AppendModeSwitch`, `GeneratedItemsTable` | all who can create | "Save into" (Your space / team / "Engage — the shared library (staff)"); when adding to a set: "Adds to …". Field locks and form assist (none in Survey); count; guidance; generate as a job, then hand off to the draft | none | 10-21 |
| Set editor (full screen) | `QuestionSetEditor.jsx`, `SetTopicField`, `SetMediaPanel`, `RoundKindPicker`, `SetReviewBanner`, `PromptShapePreview` | set managers; read-only preview for others | Details; AI banner; Workie ("Its voice" persona, summary prompt); Versions (Share publicly, Promote, Delete version); Close (×) | none | 10-21 / parts ≤10-15 |
| Questions panel (inside the editor) | `QuestionsPanel.jsx`, `AddQuestionsDialog.jsx`, `QuestionPullDialog.jsx` | as above | Per-question fields (Option A–F, Picture, "Reveal (shown only after the round)", Tags, Background for Workie…); Add questions…; Pull from another set; Download CSV; Replace from file; "Save as version N" / "Save as my own copy…"; inline draft review | none | 10-21 |
| Delete set dialog | `QuestionSetDeleteDialog.jsx` | set managers | Delete; "Deactivate it instead" | none | ≤10-15 |
| Share (publish) dialog | `ShareSetDialog.jsx` | P, TO/TA (org consoles) | Submits for the content check; progress; outcomes | none | ≤10-15 |
| Public library (org) | `PublicLibraryPanel.jsx` mode="org" | P, TO/TA, TM | Preview, "Copy to my team", Share a set | none | ≤10-15 |
| Sessions | `SessionsPanel.jsx` | P, TO/TA, TM | List (Code, Type, State, Players, Rounds, Created, Last played), Open, Report, Delete (staff must give a reason), Delete all sessions…, event rows | none | ≤10-15 |
| Events / event builder | `EventsPanel.jsx`, `EventBuilder.jsx`, `EventDetailsDialog.jsx`, `EventItemDialog.jsx` | P, TO/TA, TM when `features.events` is on | New event, list, Agenda (Add item, Break, Edit, Remove), join code, who can join, plan-request strip | none | ≤10-15 |
| Prompts chooser → two libraries | `AdminPage.jsx:1947-2057`, `AIGenerationPromptEditor.jsx`, `AIPromptManager.jsx`, `PromptLibraryPanel.jsx`, `PromptReadOnlyView`, `PromptPreflightPanel`, `PromptVariableInspector`, `PromptAssembledPreview`, `AIPromptAdvisor`, `PromptImportReview` | P and TO/TA read-only; S edits | Cards "Question set generator prompts" and "Engagement results prompts". Library: filters, status chip (Active ⇄ Draft), Default, View / Edit / Improve, Copy to archive, Retire, Populate Default Prompts; Workie file download/upload | `?` on each card → `admin-ai-prompts` | Manager and library 10-21; generation editor ≤10-15 |
| Prompt versions and repo review | `PromptVersionsPanel.jsx`, `PromptRepoReview.jsx`, `utils/repoPromptMatch.js` | S, results library only | Edit \| Versions tabs; View, Compare with live, Make live (press twice); repo State chip; notice with "Show only these"; Review → Save as version N / Not now | via the card `?` | 10-21 |
| Members | `TeamPanel.jsx` (+ `InviteDialog`/`PendingInvites` on host side) | TO/TA manage; TM read-only (+ Leave) | Invite someone (Member/Admin, Copy or Email the link), Resend, Revoke, Approve hosting, Make admin/member, Remove/Leave | none | ≤10-15 |
| Activity | `UsageStatsPanel.jsx` | TO/TA | Per-month counts, type filter, Download CSV | none | ≤10-15 |
| Plan & usage → Billing history → Invoice | `BillingPanel.jsx`, `InvoicePanel.jsx`, `AdjustmentsLedger.jsx`, `UsageMeter.jsx` | P, TO/TA | Usage meters, adjustments, request plan (owner or P), withdraw, leave plan (owner/admin/P), history, invoice | plain link "How sessions are counted" → `/help/host-plan` | ≤10-15 |
| Plan request / Leave plan dialogs | `PlanRequestDialog.jsx`, `LeavePlanDialog.jsx` | owner or P / TO/TA or P | Discount code, Withdraw; leaving: Keep / Make public / Delete each set | none | ≤10-15 |
| Data & privacy | `PrivacyPanel.jsx`, `AuditLog.jsx` | P, TO/TA | Who has read your data, Who changed what (audit), Export everything, Delete this organisation, Encryption | none | ≤10-15 |
| Settings (foot of nav) | `AdminPage.jsx:2424-2492` | all | WebSocket mode, Show AI Prompts in Debug Mode, Prompt Improvement Debug Mode | `?` → `admin-settings` | 10-21 (page) |
| Organisations | `PlatformOrgsPanel.jsx`, `OrgBillingDrawer.jsx`, `AuditLogDialog` | S | Counts; Approve (pending); Suspend (one click, no confirm or reason; teams only); Reinstate; Billing… (grant/revoke adjustment, reason required); Activity…; Staff activity… | none | ≤10-15 |
| Observability | `ObservabilityPanel.jsx`, `StaffStatsDrill.jsx` | S | Totals by month and category, Refresh, "What each number means" | none | ≤10-15 |
| Plan requests | `PlanRequestsPanel.jsx` | S | Filter; Decide… → Approve/Decline with a note to the customer | none | ≤10-15 |
| Discount codes | `DiscountCodesPanel.jsx` | S | New code, Retire, uses | none | ≤10-15 |
| Shared library | `QuestionSetsPanel` with scope=platform | S | As the Question sets list, no Copy or Share | none | 10-21 |
| Public library (staff) → Score card | `PublicLibraryPanel` mode="platform", `ScoreCard.jsx` | S | Score card, Unpublish; card: Run the check again, Take down | none | ≤10-15 |
| Moderation | `ModerationPanel.jsx` | S | Queue, "Why it escalated", Approve, Reject, Score card | none | ≤10-15 |
| Accounts | `UserManagement.jsx` | S | Waiting for approval: Approve as host / Admin / Reject (moves to Disabled, after confirm). Members: search; Active/Admins/Hosts/Disabled tabs; Make Engage admin / Make host / Disable; trash = delete account (confirm) | none | ≤10-15 |
| Archive | `ArchivePanel.jsx` | S | Backups list, filters, export, Download, Delete, restore | none | ≤10-15 |
| Engage settings | `ClaudeModelsPanel.jsx`, `SiteSkinPanel.jsx`, `SkinGallery.jsx` | S | Claude models (In use); Site look (preview, End preview) | none | ≤10-15 |
| Reports | `ReportsPanel.jsx` | **cannot be reached in /admin**: `reports` is not in `sectionsFor`, so after the orgs load it falls back (`AdminPage.jsx:1592-1597`). Only reachable from the host's `HostReportsDialog` | Keep for a year, download | none | ≤10-15 |

Personas: there is no management screen. A persona is only chosen in the set editor ("Its voice", `QuestionSetEditor.jsx:1534-1560`). Workie files are handled inside `AIPromptManager`.

## 2. Guides

**`admin.js`** (`ADMIN_ROLE`, line 569):
- **`admin-getting-started` "Getting started":** What the console is for · The first thing to do · Sessions expire.
- **`admin-question-sets` "Question sets":** What a set is · Versions, not overwrites · Quickstart · Pictures in questions · Moving sets between environments.
- **`admin-ai-prompts` "Prompts":** Two kinds, one library · Statuses · Retire and Copy to archive are different things · What an analysis prompt must produce · Placeholders · Managing them · Versions, and updates from the repo · When the output is wrong.
- **`admin-ai-builders` "AI builders":** What the builders do · Drafts, the bell, and the review · Accepting, and taking it back · Reviewing what came back · Generation prompts shape the output.
- **`admin-game-management` "Sessions":** The Sessions list · When a host says it went wrong.
- **`admin-settings` "Settings":** They are stored in this browser only · Real-time communication · Debug settings.

**`builder.js`** (`BUILDER_ROLE`, line 209):
- **`builder-manual` "Writing questions":** A trivia question · An open-answer question · Holding something back until they have answered · Pictures · Categories.
- **`builder-ai` "Building with AI":** Describing what you want · It runs as a job, into a draft · Before you let anyone play it · If it keeps coming out wrong the same way.

Also relevant: `host-plan` (the target of the `billing` alias and the Billing link) and `host-game-setup` › "Choosing a question set" (drafts and the bell on host screens).

## 3. Coverage

**Covered:**
- Question sets list → admin-question-sets (Quickstart). Drafts strip, Review AI draft, the bell → admin-ai-builders §2–3 and builder-ai §2.
- AI builders and "Save into" → admin-ai-builders §1 and builder-ai §2. Questions panel fields → builder-manual.
- Prompts libraries, versions, repo review → admin-ai-prompts. Settings → admin-settings. Sessions → admin-game-management (partly; see §4). Plan & usage → host-plan, which only explains session counting.
- The section map → admin-getting-started §1 (incomplete).

**Not covered:**
- **Navigation and inbox:** Overview (any scope); the scope row and "+ New team" / "+ Personal space" / Create a team; the Engage-mode banner; owner tags Yours/Team/Engage/Public and the owner filter/sort; set list filters (topic/shelf, type, status) and shelf browse.
- **Creating and editing sets:** the New set dialog's three ways in (template download, AI authoring prompt, file upload and preflight, CSV format); Copy / Open on sets that aren't yours, and the delete dialog's "Deactivate it instead"; the editor's Versions panel (Promote, Delete version), Replace from file, Pull from another set, Add questions…, Download CSV; Workie / "Its voice" persona and the set's summary prompt.
- **Publishing:** Share publicly, the content check, Score card, appeal/resubmit, sent-back sets; the org Public library (Preview, "Copy to my team").
- **Running sessions:** Events and the event builder; Sessions row actions and Delete all / delete reasons.
- **Prompts extras:** Improve (advisor), preflight checks, Workie file import/export, Populate Default Prompts.
- **Team and account (TO/TA, P):** Members (invite, roles, Approve hosting, revoke, leave); Activity; Plan request, Withdraw, Leave plan, discount code, Billing history and Invoice, adjustments; Data & privacy (audit log, Export everything, Delete this organisation).
- **Staff screens:** Organisations (Approve, Suspend/Reinstate, Billing… drawer, Activity…, Staff activity…); Observability; Plan requests (Decide); Discount codes; Shared library; staff Public library (Unpublish, take down, re-run check); Moderation; Accounts (Disable, Make Engage admin, delete account, Reject); Archive; Engage settings (Claude models, Site look).

**Help buttons missing:** none on the Question sets list, set editor, Review AI draft, any of the 4 AI builders, Sessions, or any team or staff screen. The `admin-question-sets`, `admin-ai-builders`, `builder-*` and `admin-game-management` guides are reachable only from the role index or search.

## 4. Stale or wrong claims

**The five biggest:**
1. **No "New version" / "Fork" buttons.** `admin.js:108` says hosts see "New version" on their own set and "Fork" on a house set. Neither label exists anywhere in the JSX. The editor says "Save as version N" / "Save as my own copy…" (`QuestionsPanel.jsx:1321-1322`), and the list says Edit / Review / Open / Copy (`QuestionSetsPanel.jsx:751`, `806`). The same claim is repeated at `host.js:190-196`.
2. **Sessions are not "every session on this environment".** `admin.js:500` says so, but `GET /games` (`lambda-functions/game/get-games-list.js`) builds its query from `callerOrgId`/`gamesIndexPk`, so it is scoped to the active library.
3. **"Saved reports are listed under Reports"** (`admin.js:506`). The console has no Reports section: `reports` isn't returned by `sectionsFor` (`consoleSections.js:374-472`), and `resolvedTab` falls back (`AdminPage.jsx:1592-1597`). Reports only appear in the Overview "Reports deleted soon" box (`overviewAlerts.js:211`) and the host's reports dialog.
4. **Prompt versions and repo marks only exist in one of the two libraries.** `admin.js:333-363` reads as if they apply to every prompt. In fact they exist only in the Engagement results (analysis) library, and only in Engage mode: `PromptVersionsPanel` and `repoStatusFor` are wired in `AIPromptManager.jsx:23,796-822,1864`, while `AIGenerationPromptEditor.jsx` imports neither. The repo marks are also hidden when read-only (`AIPromptManager.jsx:1864`).
5. **The section map in getting-started is incomplete** (`admin.js:31-36`):
   - Missing: Overview (every scope), Events, Activity (TO/TA), and Engage settings and Overview in the staff list.
   - "Prompts — Team owners and admins, read-only" leaves out personal spaces, which also get read-only Prompts (`consoleSections.js:439`).

**Other wrong or stale claims:**
6. **"Check Accounts" is advice only staff can follow** (`admin.js:47-56`). This guide is the first one every TO/TA/P reader sees. The group table also leaves out the Disabled state that Reject and Disable produce (`UserManagement.jsx:93,444`).
7. **Moving sets between environments** (`admin.js:154`) tells every reader to export a set to the archive. Only the staff Archive screen does that (`ArchivePanel.jsx:273`); there is no set export for P or teams.
8. **Prompt library names don't match the UI.** Help says "Generation prompts / Analysis prompts" (`admin.js:180-181`). The UI cards say "Question set generator prompts" and "Engagement results prompts" (`AdminPage.jsx:1980,2015`).
9. **Prompt filters are under-described.** `admin.js:186` says prompts are filtered "by type, kind of session, category and status". There are also owner (Team/Engage/Public) and repo filters (`PromptLibraryPanel.jsx:143-150`).
10. **"Editing a set creates a new version rather than changing the one already in use"** (`admin.js:104`). That's true for questions, but the editor itself says Details edits are "live for anyone hosting from it" (`QuestionSetEditor.jsx:1128-1131`).
11. **The reveal field has a different name in the UI.** `builder.js:30,73` call it "Answer details" / the answer-details field; the editor label is "Reveal (shown only after the round)" (`QuestionsPanel.jsx:2271`).
12. **Field locks don't exist in every builder.** `admin.js:401` and `builder.js:151` say you can lock fields. `SurveyAIBuilder.jsx` has no `FieldLock`/`AIFormAssist`; the other three do.
13. **Sessions expiry wording disagrees in three places:**
    - Help (`admin.js:68`, `506`): "7 days once started".
    - Page subtitle (`AdminPage.jsx:116`): "7 days after last play".
    - Nav subtitle (`consoleSections.js:135`): "90 days from creation" only.

**Gaps around recent work** (the help isn't wrong, it just never mentions these):
14. **Bell destinations.** It covers drafts, invitations, approvals and sent-back sets, but not Engage's staff queues or "Mark all read" (`NotificationsBell.jsx:20-21,127`).
15. **Suspend / Reinstate / Approve organisations** (`PlatformOrgsPanel.jsx:192-244`): no help anywhere. Suspend fires on one click with no confirm or reason, and personal spaces can't be suspended.
16. **Account disable and delete** (`UserManagement.jsx:436-452,566-594`): no help. Delete says sets and sessions are kept.
17. **Owner tags Yours/Team/Engage/Public** (`utils/setOwnerTag.js:40-51`, filter at `QuestionSetsPanel.jsx:419-439`): nowhere in the help.
18. **Destination picker "Save into"** (`DestinationField.jsx:55-66`): the help describes it without the label. The options are "Your space", "<team> (team)" and "Engage — the shared library (staff)". When the libraries list hasn't loaded, it shows a sentence with "Choose another" instead (`DestinationField.jsx:38-50`).

**Checked and accurate:**
- Drafts last 30 days, with a reminder 5 days before; discarded drafts restore for 7; accepted ones are kept 30 (`lambda-functions/admin/shared/generation-drafts.js:64-66`, `shared/notifications.js:50`; `admin.js:430`).
- A draft is private to its creator (`shared/generation-drafts.js:200,450`; `admin.js:415`).
- Accept switches the set on but needs a shelf, or you untick it (`DraftReview.jsx:528-536`; `admin.js:441`).
- Undo works only while the new version is still live (`lambda-functions/admin/generation-drafts.js:302-306`; `admin.js:442`).
- Regenerate states its token cost first (`DraftReview.jsx:400`); Stop keeps the pass already written (`DraftReview.jsx:169`); the "Review · N" list tag (`QuestionSetsPanel.jsx:635`).
- A name clash on accept is refused with "already exists", and the name field stays editable (`builder.js:171`).
- Version sources (Edited here … Before version history), Make live with two presses, and View / Compare with live (`PromptVersionsPanel.jsx:27-32,141-194`).
- Repo state labels and "Show only these" (`repoPromptMatch.js:35-38`, `PromptLibraryPanel.jsx:562`).
- Copy to archive vs Retire (`PromptLibraryPanel.jsx:813-824`).
- Settings has exactly three switches.
- Up to 6 options (A–F), the "Picture" field, and the 24-category cap (`utils/addQuestions.js:23`).