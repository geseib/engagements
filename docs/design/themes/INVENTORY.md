# Skins inventory: every stylesheet and every surface

**Measured 2026-10-13** on branch `working/build-room-host-redesign` (`16e8c3dd`) by the scripts in
`TOOLING-BRIEF.md` §1. Re-run them before trusting a number; they move with every commit.

How each number was taken (comments stripped first):

| Column | Meaning |
|---|---|
| Colour literals in rules | `#hex`, `rgb[a]()`, `hsl[a]()` inside an ordinary declaration — the work |
| Colour literals in token decls | the same inside a `--custom-property:` declaration (a scope's own palette) — cheap: re-pointed in Phase 0b |
| Literal font-family | a `font-family` whose value is not `var(…)`/`inherit` (almost all are monospace stacks) |
| var(--primary) | reads of `--primary`/`--primary-deep`; each is a decision: `--action` or `--accent` (SPEC §4.4) |
| Palette test(s) | `__tests__/*Palette.test.js` files that name this stylesheet |
| CSS-reading tests | every `__tests__` file that names this stylesheet (all must be updated with it) |
| Effort | S ≤ 8 rule literals and < 350 lines · M ≤ 30 and < 1000 · L otherwise |

## 1. Totals

| | Count |
|---|---:|
| Stylesheets under `src/src` | **100** (47,601 lines) |
| Colour literals in rules | **1,731** (889 of them in `styles.css`) |
| Colour literals in scoped token declarations | **514** in ~70 scope blocks (461 of them declare a colour directly) |
| Literal `font-family` | **40** (32 monospace stacks in 7 spellings; 1 Georgia; 7 system stacks) — fonts are already almost entirely `var(--font-display/-ui)` |
| `var(--primary…)` reads | **796** · `var(--secondary)` **153** |
| Hard-coded amber tints `rgba(246,169,76,…)` | **95** · blue tints `rgba(124,167,230,…)` **35** · literal `#F6A94C` **86** |
| Scoped roles redeclared per scope | `--*-rule` 39×`.20`, `--*-rule-strong` 34×`.34`, `--*-row-hover` 28×`.055`, `--*-success-text` 20+, `--*-on-accent` 13, `--*-tint-ok/-warn/-danger/-note` ~40 |
| `*Palette.test.js` | **67**; stylesheets with none: **21** |
| Frontend tests that read a stylesheet as text | **124** of 510 |
| Backend `tests/*.js` that read frontend source | **34** of 322 |
| JSX colour literals | **44** on 40 lines in 7 files (lines per file): `TermsOfServicePage.jsx` 14, `PrivacyPolicyPage.jsx` 9, `WordCloudTest.jsx` 9, `auth/AuthChrome.jsx` 4, `components/WavelengthBuilder.jsx` 2, `components/AIScenarioBuilder.jsx` 1, `AdminPage.jsx` 1 (+ `HostRemote.jsx`, `BrandMark.jsx`, `App.jsx` spinner `#e2e8f0`) |
| `data-theme` setters in JSX | **83** in 51 files (unchanged by this work) |

### By group

| Group | Sheets | Lines | Literals in rules | Literals in token decls | Literal font-family | var(--primary) | Sheets with no palette test |
|---|---:|---:|---:|---:|---:|---:|---:|
| A Marketing | 15 | 2338 | 63 | 37 | 0 | 5 | 7 |
| B Auth & legal | 1 | 1316 | 84 | 4 | 3 | 18 | 0 |
| C Admin: shell & org | 11 | 2547 | 27 | 57 | 0 | 29 | 2 |
| D Admin: sets & authoring | 21 | 8399 | 244 | 127 | 7 | 79 | 2 |
| E Admin: team, billing, platform | 16 | 3670 | 87 | 95 | 0 | 90 | 0 |
| F Admin: sessions & events | 4 | 1299 | 10 | 28 | 0 | 33 | 1 |
| G Host stage (all game types) | 8 | 3916 | 64 | 28 | 1 | 47 | 3 |
| H Remote | 1 | 862 | 15 | 0 | 0 | 11 | 0 |
| I Participant | 2 | 1991 | 5 | 11 | 2 | 33 | 0 |
| J Events: stage, agenda, attendee | 3 | 1259 | 0 | 7 | 0 | 23 | 0 |
| K Build Room | 5 | 3229 | 8 | 44 | 7 | 127 | 0 |
| L Reports | 6 | 2476 | 73 | 17 | 0 | 30 | 3 |
| M Help & feedback | 4 | 1371 | 147 | 0 | 3 | 3 | 3 |
| N Presentation | 1 | 540 | 1 | 9 | 0 | 0 | 0 |
| O Scoreboard | 1 | 379 | 14 | 14 | 0 | 5 | 0 |
| Z styles.css (split, see §3) | 1 | 12009 | 889 | 36 | 17 | 263 | 0 |
| **Total** | 100 | 47601 | 1731 | 514 | 40 | 796 | 21 |

## 2. Every stylesheet, by group

### A Marketing

Shared components needed: Ground, Heading, Eyebrow, Button, Card. The `--mk-*` palette (28 decls) ignores the global tokens today (0 `--primary` reads), so Phase 0b re-points `--mk-amber`/`--mk-blue`/`--mk-bg`/… to roles or marketing will not switch at all.

| Stylesheet | Lines | Colour literals in rules | Colour literals in token decls | Literal font-family | var(--primary) | Palette test(s) | CSS-reading tests | Effort |
|---|---:|---:|---:|---:|---:|---|---:|:-:|
| `components/JoinCodeEntry.css` | 173 | 16 | 0 | 0 | 0 | marketingPalette | 2 | M |
| `components/RootPage.css` | 237 | 4 | 7 | 0 | 0 | marketingPalette | 2 | S |
| `components/WelcomeScreen.css` | 590 | 6 | 2 | 0 | 5 | **none** | 1 | M |
| `marketing/BuildRoomPage.css` | 65 | 1 | 0 | 0 | 0 | **none** | 0 | S |
| `marketing/components/ClipFrame.css` | 3 | 0 | 0 | 0 | 0 | **none** | 0 | S |
| `marketing/components/ClipStill.css` | 75 | 5 | 0 | 0 | 0 | marketingPalette | 1 | S |
| `marketing/components/DeviceFrame.css` | 29 | 2 | 0 | 0 | 0 | **none** | 0 | S |
| `marketing/components/RidgeScene.css` | 99 | 15 | 0 | 0 | 0 | marketingPalette | 2 | M |
| `marketing/components/SampleReport.css` | 106 | 7 | 0 | 0 | 0 | marketingPalette | 1 | S |
| `marketing/HelpPage.css` | 279 | 0 | 0 | 0 | 0 | marketingPalette | 2 | S |
| `marketing/HomePage.css` | 274 | 5 | 0 | 0 | 0 | marketingPalette | 2 | S |
| `marketing/HowItWorksPage.css` | 51 | 1 | 0 | 0 | 0 | **none** | 0 | S |
| `marketing/MarketingShell.css` | 275 | 0 | 28 | 0 | 0 | marketingPalette | 3 | S |
| `marketing/ReportsPage.css` | 45 | 0 | 0 | 0 | 0 | **none** | 1 | S |
| `marketing/UseCasesPage.css` | 37 | 1 | 0 | 0 | 0 | **none** | 0 | S |


### B Auth & legal

Shared components needed: Heading, Eyebrow, Button, Notice. Plus 27 JSX literals in `TermsOfServicePage.jsx`, `PrivacyPolicyPage.jsx`, `AuthChrome.jsx`.

| Stylesheet | Lines | Colour literals in rules | Colour literals in token decls | Literal font-family | var(--primary) | Palette test(s) | CSS-reading tests | Effort |
|---|---:|---:|---:|---:|---:|---|---:|:-:|
| `auth/auth.css` | 1316 | 84 | 4 | 3 | 18 | adminTabsPalette, questionSetEditorPalette | 3 | L |


### C Admin: shell & org

Shared components needed: Heading, Eyebrow, Button, Chip, RowSelect, Modal styling.

| Stylesheet | Lines | Colour literals in rules | Colour literals in token decls | Literal font-family | var(--primary) | Palette test(s) | CSS-reading tests | Effort |
|---|---:|---:|---:|---:|---:|---|---:|:-:|
| `components/ActingAsBanner.css` | 65 | 0 | 2 | 0 | 3 | actingAsBannerPalette | 1 | S |
| `components/AdminShell.css` | 540 | 8 | 4 | 0 | 4 | adminShellPalette, adminTabsPalette, auditLogPalette, observabilityPalette, orgSwitcherPalette, platformOrgsPalette, privacyPanelPalette, promptEditorPalette, questionSetEditorPalette, questionSetsPalette, setMediaPalette, setShelfBrowsePalette, teamPanelPalette | 15 | M |
| `components/CreateOrgDialog.css` | 157 | 1 | 3 | 0 | 4 | **none** | 1 | S |
| `components/InviteDialog.css` | 250 | 4 | 2 | 0 | 5 | **none** | 1 | S |
| `components/OrgSwitcher.css` | 235 | 0 | 5 | 0 | 4 | orgSwitcherPalette | 1 | S |
| `components/OverviewPanel.css` | 294 | 3 | 4 | 0 | 3 | overviewPalette | 1 | S |
| `components/PendingInvites.css` | 129 | 0 | 6 | 0 | 0 | pendingInvitesPalette | 1 | S |
| `components/PlanLimitNotice.css` | 174 | 2 | 16 | 0 | 0 | planLimitNoticePalette | 1 | S |
| `components/ScopeTabs.css` | 278 | 8 | 10 | 0 | 2 | overviewPalette | 1 | S |
| `components/UsageMeter.css` | 151 | 0 | 0 | 0 | 2 | usageMeterPalette | 1 | S |
| `components/UsageStatsPanel.css` | 274 | 1 | 5 | 0 | 2 | usageStatsPalette | 1 | S |


### D Admin: sets & authoring

Shared components needed: Button, Chip, Card, RowSelect, Notice, Modal styling, Eyebrow. `BuilderPage.css` (158 rule literals) is the heaviest single file after styles.css; check it is still mounted (`/builder`, `AdminPage.jsx` imports it) before converting.

| Stylesheet | Lines | Colour literals in rules | Colour literals in token decls | Literal font-family | var(--primary) | Palette test(s) | CSS-reading tests | Effort |
|---|---:|---:|---:|---:|---:|---|---:|:-:|
| `BuilderPage.css` | 1441 | 158 | 0 | 1 | 1 | pollAIBuilderPalette, questionSetsPalette, surveyAIBuilderPalette | 4 | L |
| `components/AIPromptManager.css` | 2360 | 11 | 9 | 4 | 4 | promptEditorPalette, questionSetEditorPalette, surveyQuestionFieldsPalette | 6 | L |
| `components/AppendModeSwitch.css` | 16 | 6 | 0 | 0 | 3 | **none** | 0 | S |
| `components/BatchGuidanceField.css` | 54 | 0 | 1 | 0 | 0 | **none** | 1 | S |
| `components/CategoryPicker.css` | 213 | 0 | 0 | 0 | 3 | questionSetEditorPalette | 1 | S |
| `components/CountField.css` | 284 | 0 | 4 | 0 | 7 | countFieldPalette | 1 | S |
| `components/FileUploadPrompt.css` | 178 | 25 | 0 | 2 | 0 | questionSetEditorPalette | 1 | M |
| `components/GeneratedItemsTable.css` | 318 | 8 | 9 | 0 | 2 | surveyAIBuilderPalette | 3 | S |
| `components/GenerationJobPanel.css` | 258 | 4 | 9 | 0 | 1 | surveyAIBuilderPalette | 1 | S |
| `components/PollAIBuilder.css` | 124 | 0 | 6 | 0 | 3 | pollAIBuilderPalette | 1 | S |
| `components/PublicLibraryPanel.css` | 69 | 2 | 3 | 0 | 3 | publibPalette | 3 | S |
| `components/QuestionImageField.css` | 100 | 0 | 3 | 0 | 0 | setMediaPalette | 1 | S |
| `components/QuestionPreview.css` | 321 | 0 | 8 | 0 | 0 | QuestionPreviewPalette | 2 | S |
| `components/QuestionSetEditor.css` | 346 | 0 | 16 | 0 | 10 | hostQuestionSetsPalette, questionSetEditorPalette, questionsPanelPalette, setEditorChipsPalette, srevPalette, surveyQuestionFieldsPalette | 6 | S |
| `components/QuestionSetsPanel.css` | 911 | 22 | 23 | 0 | 21 | QuestionPreviewPalette, billingPanelPalette, hostQuestionSetsPalette, promptEditorPalette, questionSetEditorPalette, questionSetsPalette, setEditorChipsPalette, setMediaPalette, setShelfBrowsePalette | 12 | M |
| `components/RoundKindPicker.css` | 257 | 6 | 7 | 0 | 0 | questionSetEditorPalette | 2 | S |
| `components/SetMediaPanel.css` | 357 | 0 | 9 | 0 | 9 | setMediaPalette | 2 | M |
| `components/SetReviewBanner.css` | 91 | 1 | 3 | 0 | 2 | questionSetEditorPalette, srevPalette | 2 | S |
| `components/ShareSetDialog.css` | 59 | 1 | 3 | 0 | 3 | sharePalette | 1 | S |
| `components/SurveyAIBuilder.css` | 163 | 0 | 9 | 0 | 2 | surveyAIBuilderPalette | 1 | S |
| `components/SurveyQuestionFields.css` | 479 | 0 | 5 | 0 | 5 | surveyQuestionFieldsPalette | 1 | M |


### E Admin: team, billing, platform

Shared components needed: Button, Chip, RowSelect, Notice, Modal styling. Mostly the `.qsets` idiom already, so mostly Phase 0b token-block work.

| Stylesheet | Lines | Colour literals in rules | Colour literals in token decls | Literal font-family | var(--primary) | Palette test(s) | CSS-reading tests | Effort |
|---|---:|---:|---:|---:|---:|---|---:|:-:|
| `components/AdjustmentsLedger.css` | 49 | 3 | 4 | 0 | 3 | adjustmentsLedgerPalette | 1 | S |
| `components/ArchivePanel.css` | 448 | 12 | 8 | 0 | 9 | archivePalette | 1 | M |
| `components/AuditLog.css` | 220 | 3 | 3 | 0 | 2 | auditLogPalette | 1 | S |
| `components/BillingPanel.css` | 326 | 2 | 6 | 0 | 4 | billingPanelPalette | 1 | S |
| `components/ClaudeModelsPanel.css` | 188 | 4 | 6 | 0 | 2 | claudeModelsPalette | 1 | S |
| `components/DiscountCodes.css` | 80 | 4 | 6 | 0 | 6 | adjustmentsLedgerPalette | 1 | S |
| `components/InvoicePanel.css` | 108 | 3 | 8 | 0 | 5 | adjustmentsLedgerPalette | 1 | S |
| `components/LeavePlanDialog.css` | 159 | 6 | 9 | 0 | 5 | leavePlanPalette | 1 | S |
| `components/ModerationPanel.css` | 76 | 6 | 3 | 0 | 4 | modqPalette | 3 | S |
| `components/ObservabilityPanel.css` | 241 | 2 | 5 | 0 | 3 | observabilityPalette | 1 | S |
| `components/OrgBillingDrawer.css` | 59 | 4 | 5 | 0 | 8 | adjustmentsLedgerPalette | 1 | S |
| `components/PlanRequests.css` | 150 | 7 | 7 | 0 | 11 | planRequestsPalette | 1 | S |
| `components/PlatformOrgsPanel.css` | 220 | 3 | 7 | 0 | 3 | actingAsBannerPalette, countFieldPalette, pendingInvitesPalette, platformOrgsPalette | 4 | S |
| `components/PrivacyPanel.css` | 428 | 6 | 7 | 0 | 8 | privacyPanelPalette | 1 | M |
| `components/TeamPanel.css` | 506 | 9 | 7 | 0 | 9 | teamPanelPalette | 1 | M |
| `components/UserManagement.css` | 412 | 13 | 4 | 0 | 8 | adminTabsPalette, platformOrgsPalette, questionSetsPalette, teamPanelPalette | 4 | M |


### F Admin: sessions & events

Shared components needed: Button, Chip, RowSelect, Card, Modal styling.

| Stylesheet | Lines | Colour literals in rules | Colour literals in token decls | Literal font-family | var(--primary) | Palette test(s) | CSS-reading tests | Effort |
|---|---:|---:|---:|---:|---:|---|---:|:-:|
| `components/EventBuilder.css` | 286 | 0 | 12 | 0 | 12 | eventBuilderPalette, presentationSlidesPalette, sessionOptionsPalette | 4 | S |
| `components/EventsPanel.css` | 214 | 0 | 9 | 0 | 10 | eventsPanelPalette | 2 | S |
| `components/SessionHistoryPanel.css` | 406 | 2 | 3 | 0 | 6 | **none** | 1 | M |
| `components/SessionsPanel.css` | 393 | 8 | 4 | 0 | 5 | adminTabsPalette | 2 | M |


### G Host stage (all game types)

Shared components needed: TopLine (rail), Eyebrow (kicker), Heading (`.q`, `.hero`), Chip (phase), Pips/meter, NumberBadge, TallyRow, Ground (`.field`), Button (dock).

| Stylesheet | Lines | Colour literals in rules | Colour literals in token decls | Literal font-family | var(--primary) | Palette test(s) | CSS-reading tests | Effort |
|---|---:|---:|---:|---:|---:|---|---:|:-:|
| `components/FeedbackRoundPanel.css` | 278 | 0 | 4 | 0 | 1 | feedbackRoundPalette | 1 | S |
| `components/GameSetupDialog.css` | 1132 | 19 | 12 | 0 | 0 | gameSetupPalette, sessionOptionsPalette | 2 | L |
| `components/RemoteCategoryList.css` | 55 | 0 | 0 | 0 | 0 | **none** | 0 | S |
| `components/RemoteQuestionBrowser.css` | 419 | 1 | 2 | 0 | 4 | hostRemotePreviewPalette | 1 | M |
| `components/RemoteSessionPanel.css` | 281 | 4 | 0 | 0 | 3 | **none** | 1 | S |
| `components/stage/ModelCompare.css` | 172 | 6 | 1 | 0 | 0 | **none** | 1 | S |
| `components/survey/results/SurveyResults.css` | 228 | 0 | 1 | 0 | 6 | surveyResultsPalette, surveyWalkthroughPalette | 2 | S |
| `styles/stage.css` | 1351 | 34 | 8 | 1 | 33 | QuestionPreviewPalette, adminTabsPalette, buildRoomPalette, dockButtonsPalette, eventSurfacesPalette, hostRemotePreviewPalette, playerSurfacePalette, presentationSlidesPalette, questionSetsPalette, scoreboardPalette, surveyStagePalette, surveyWalkthroughPalette | 25 | L |


### H Remote

Shared components needed: TopLine, Eyebrow, Card + NumberBadge (responses), Button (one orange), Pips.

| Stylesheet | Lines | Colour literals in rules | Colour literals in token decls | Literal font-family | var(--primary) | Palette test(s) | CSS-reading tests | Effort |
|---|---:|---:|---:|---:|---:|---|---:|:-:|
| `HostRemote.css` | 862 | 15 | 0 | 0 | 11 | hostRemotePreviewPalette | 3 | M |


### I Participant

Shared components needed: TopLine, Eyebrow, Heading, Card + NumberBadge, Button (Send/Vote = the one orange), Pips, TallyRow. `--plr-amber-*` tints become accent tints.

| Stylesheet | Lines | Colour literals in rules | Colour literals in token decls | Literal font-family | var(--primary) | Palette test(s) | CSS-reading tests | Effort |
|---|---:|---:|---:|---:|---:|---|---:|:-:|
| `components/PlayerSurface.css` | 1897 | 0 | 8 | 2 | 32 | buildPlayerPalette, eventSurfacesPalette, playerSurfacePalette, presentationSlidesPalette, surveyPhonePalette | 7 | L |
| `components/ScoreCard.css` | 94 | 5 | 3 | 0 | 1 | scardPalette | 3 | S |


### J Events: stage, agenda, attendee

Shared components needed: TopLine, Eyebrow, Heading, Card, Chip, Ground.

| Stylesheet | Lines | Colour literals in rules | Colour literals in token decls | Literal font-family | var(--primary) | Palette test(s) | CSS-reading tests | Effort |
|---|---:|---:|---:|---:|---:|---|---:|:-:|
| `components/event/EventAttendeePage.css` | 265 | 0 | 0 | 0 | 6 | eventSurfacesPalette, playerSurfacePalette, presentationSlidesPalette | 3 | S |
| `components/event/EventStage.css` | 880 | 0 | 4 | 0 | 13 | eventSurfacesPalette, presentationSlidesPalette | 3 | M |
| `components/event/HostEventAgenda.css` | 114 | 0 | 3 | 0 | 4 | hostEventAgendaPalette | 1 | S |


### K Build Room

Shared components needed: Eyebrow, Heading, Button, Card, Chip, Pips, Ground. 127 `--primary` reads: the largest decision count after styles.css.

| Stylesheet | Lines | Colour literals in rules | Colour literals in token decls | Literal font-family | var(--primary) | Palette test(s) | CSS-reading tests | Effort |
|---|---:|---:|---:|---:|---:|---|---:|:-:|
| `buildroom/BuildCrew.css` | 257 | 0 | 9 | 0 | 14 | buildCrewPalette | 1 | S |
| `buildroom/BuildPlayer.css` | 1120 | 0 | 10 | 2 | 22 | buildPlayerPalette | 1 | L |
| `buildroom/BuildReport.css` | 156 | 0 | 5 | 1 | 0 | buildRoomPalette | 1 | S |
| `buildroom/BuildRoom.css` | 1628 | 7 | 20 | 4 | 86 | buildCrewPalette, buildRoomCodesPalette, buildRoomPalette | 5 | L |
| `buildroom/BuildWheel.css` | 68 | 1 | 0 | 0 | 5 | buildWheelPalette | 1 | S |


### L Reports

Shared components needed: Heading, Eyebrow, TallyRow, Card, Chip. `GameReport` is paper (`data-theme="light"`) and the PDF; skin applies to its print too (Q1).

| Stylesheet | Lines | Colour literals in rules | Colour literals in token decls | Literal font-family | var(--primary) | Palette test(s) | CSS-reading tests | Effort |
|---|---:|---:|---:|---:|---:|---|---:|:-:|
| `components/GameReport.css` | 1311 | 65 | 3 | 0 | 16 | **none** | 1 | L |
| `components/ReportShare.css` | 305 | 0 | 7 | 0 | 3 | reportSharePalette | 1 | S |
| `components/ReportsPanel.css` | 431 | 8 | 4 | 0 | 5 | **none** | 1 | M |
| `components/RoundReport.css` | 188 | 0 | 2 | 0 | 1 | roundReportPalette | 1 | S |
| `components/SurveyResultsPanel.css` | 201 | 0 | 1 | 0 | 4 | surveyResultsPanelPalette | 1 | S |
| `components/TalkingPointsReport.css` | 40 | 0 | 0 | 0 | 1 | **none** | 0 | S |


### M Help & feedback

Shared components needed: Heading, Eyebrow, Notice, Modal styling. 147 rule literals, 3 of 4 sheets have no palette test: write the test first.

| Stylesheet | Lines | Colour literals in rules | Colour literals in token decls | Literal font-family | var(--primary) | Palette test(s) | CSS-reading tests | Effort |
|---|---:|---:|---:|---:|---:|---|---:|:-:|
| `components/documentation/documentation.css` | 398 | 46 | 0 | 3 | 0 | **none** | 1 | L |
| `components/HelpButton.css` | 181 | 16 | 0 | 0 | 1 | **none** | 1 | M |
| `components/HelpSystem.css` | 552 | 57 | 0 | 0 | 2 | **none** | 0 | L |
| `components/IssueReportForm.css` | 240 | 28 | 0 | 0 | 0 | questionSetEditorPalette | 1 | M |


### N Presentation

Shared components needed: Every library component is first adopted here (it is the reference look). Already token-clean (1 literal: the html lock).

| Stylesheet | Lines | Colour literals in rules | Colour literals in token decls | Literal font-family | var(--primary) | Palette test(s) | CSS-reading tests | Effort |
|---|---:|---:|---:|---:|---:|---|---:|:-:|
| `present/present.css` | 540 | 1 | 9 | 0 | 0 | presentPalette | 3 | M |


### O Scoreboard

Shared components needed: Ground, NumberBadge, TallyRow. Three looks (departure/Olympic/tote) keep their own board palettes (`--sb-*`) — Q: do they skin? Recommend: only accents and the housing ground.

| Stylesheet | Lines | Colour literals in rules | Colour literals in token decls | Literal font-family | var(--primary) | Palette test(s) | CSS-reading tests | Effort |
|---|---:|---:|---:|---:|---:|---|---:|:-:|
| `components/stage/scoreboard/Scoreboard.css` | 379 | 14 | 14 | 0 | 5 | scoreboardPalette | 2 | M |


### Z styles.css (split, see §3)

Shared components needed: All of them. Split into eleven units below.

| Stylesheet | Lines | Colour literals in rules | Colour literals in token decls | Literal font-family | var(--primary) | Palette test(s) | CSS-reading tests | Effort |
|---|---:|---:|---:|---:|---:|---|---:|:-:|
| `styles.css` | 12009 | 889 | 36 | 17 | 263 | QuestionPreviewPalette, actingAsBannerPalette, adminShellPalette, adminTabsPalette, archivePalette, auditLogPalette, billingPanelPalette, buildCrewPalette, buildPlayerPalette, buildRoomCodesPalette, buildRoomPalette, buildWheelPalette, claudeModelsPalette, countFieldPalette, dockButtonsPalette, eventBuilderPalette, eventSurfacesPalette, eventsPanelPalette, feedbackRoundPalette, gameSetupPalette, hostEventAgendaPalette, hostQuestionSetsPalette, hostRemotePreviewPalette, leavePlanPalette, marketingPalette, modqPalette, observabilityPalette, orgSwitcherPalette, overviewPalette, pendingInvitesPalette, planLimitNoticePalette, platformOrgsPalette, playerSurfacePalette, pollAIBuilderPalette, presentPalette, presentationSlidesPalette, privacyPanelPalette, promptEditorPalette, publibPalette, questionSetEditorPalette, questionSetsPalette, questionsPanelPalette, reportSharePalette, roundReportPalette, scardPalette, scoreboardPalette, sessionOptionsPalette, setEditorChipsPalette, setMediaPalette, setShelfBrowsePalette, setTopicFieldPalette, setupAskPalette, sharePalette, srevPalette, surveyAIBuilderPalette, surveyPhonePalette, surveyQuestionFieldsPalette, surveyResultsPalette, surveyResultsPanelPalette, surveyStagePalette, surveyWalkthroughPalette, teamPanelPalette, usageMeterPalette, usageStatsPalette | 92 | L |

## 3. `styles.css`, split into owned units

`styles.css` is 12,009 lines and every surface reads some of it. Workers never share a line
range: each unit below owns its lines exactly. **Before converting a unit, prove each selector is
still rendered** (TOOLING-BRIEF §1.4, `deadSelectors.js`): the legacy remote, the old big-screen
and several "removed" blocks may be dead, and deleting dead rules is cheaper than converting them.

| Unit | Lines | What lives there | Literals in rules | var(--primary) | Literal font-family | Effort |
|---|---|---|---:|---:|---:|:-:|
| SC-00 | 1-230 | Token layer, reset, icons, body (**Phase 0 owns**) | 2 | 5 | 0 | S |
| SC-01 | 231-1483 | Host page shell, setup panel, players, categories, browser, queue | 98 | 23 | 0 | L |
| SC-02 | 1484-2521 | Legacy remote, set selection, QR tab, AI summary section | 88 | 29 | 1 | L |
| SC-03 | 2522-3833 | Answer navigator, desktop/mobile input, voting toggle, detailed voting | 84 | 44 | 2 | L |
| SC-04 | 3834-5282 | In-app reports: trivia/wavelength stats, report choices, enlarged question, set tabs | 151 | 35 | 0 | L |
| SC-05 | 5283-6631 | Quickstart, format cards, AI review banner, AI modal, prompt debug | 101 | 19 | 6 | L |
| SC-06 | 6632-7708 | AI insights, clipboard, player trivia buttons, category selection, primary action | 106 | 41 | 0 | L |
| SC-07 | 7709-8819 | Big-screen hero stage: lobby/question/voting/results, Field Notes, responsive | 40 | 19 | 0 | M |
| SC-08 | 8820-10038 | Big-screen QR, markdown, Wavelength game + results | 144 | 17 | 7 | L |
| SC-09 | 10039-11138 | Question browser table, set editor (`.qs-*`), versions, question fields | 26 | 16 | 1 | M |
| SC-10 | 11139-12009 | Session setup tail, anonymity, past rounds, answer spotlight | 49 | 15 | 0 | M |
| | | **Total** | **889** | **263** | **17** | |

Line ranges drift as units land; the worker re-derives its range from the banner comments named
in the "What lives there" column, never from the numbers above.

## 4. Every surface in scope

Stylesheets in **bold** are the surface's own; the rest are shared and owned by another unit
(adopt only after that unit lands). "Wave" refers to PLAN §4.

| Group | Surface (route / component) | Theme | Stylesheets | Components to adopt | Effort | Wave |
|---|---|---|---|---|:-:|:-:|
| Presentation | `/present` — `PresentPage.jsx`, `present/PresentStage.jsx`, `PresentMoments.jsx` | dark | **`present/present.css`** | all (reference) | M | 2 |
| Scoreboard | stage overlay + wall — `components/stage/scoreboard/*` | dark | **`Scoreboard.css`** | Ground, NumberBadge, TallyRow | M | 3 |
| Marketing | `/home`, `/how-it-works`, `/use-cases`, `/build-room`, `/reports`, `/help` — `marketing/*` | dark + paper bands | **`marketing/*.css`** (12) | Ground, Heading, Eyebrow, Button, Card | M | 3 |
| Marketing | `/join`, `/` signed out — `RootPage.jsx`, `JoinCodeEntry.jsx` | dark | **`RootPage.css`, `JoinCodeEntry.css`** | Heading, Button | S | 3 |
| Marketing | `/` signed in — `WelcomeScreen.jsx` | dark | **`WelcomeScreen.css`** | Heading, Eyebrow, Card, Button | M | 3 |
| Auth | `/auth*`, `/auth/callback`, pending approval — `auth/*` | dark chrome | **`auth/auth.css`** | Heading, Button, Notice | M | 3 |
| Legal | `/privacy`, `/terms` | paper | `auth/auth.css` + **27 JSX literals** | Heading | S | 3 |
| Invites | `/invite/*` — `InviteAcceptPage.jsx` | dark | **`PendingInvites.css`** | Card, Button | S | 3 |
| Admin shell | `/admin` chrome — `AdminShell`, `ScopeTabs`, `OrgSwitcher`, `ActingAsBanner` | dark | **`AdminShell.css`, `ScopeTabs.css`, `OrgSwitcher.css`, `ActingAsBanner.css`** | Heading, Eyebrow, Chip | M | 4 |
| Admin | Overview — `OverviewPanel` | dark | **`OverviewPanel.css`**, `UsageMeter.css` | Card, Chip | S | 4 |
| Admin | Question sets list + editor + preview + media + AI builders | dark (+ paper on host shelf) | **`QuestionSetsPanel.css`, `QuestionSetEditor.css`, `QuestionPreview.css`, `SetMediaPanel.css`, `SetReviewBanner.css`, `ShareSetDialog.css`, `CategoryPicker.css`, `RoundKindPicker.css`, `CountField.css`, `PollAIBuilder.css`, `SurveyAIBuilder.css`, `SurveyQuestionFields.css`, `GeneratedItemsTable.css`, `GenerationJobPanel.css`, `QuestionImageField.css`, `AppendModeSwitch.css`, `BatchGuidanceField.css`, `FileUploadPrompt.css`**, SC-09 | RowSelect, Chip, Button, Modal styling, Notice | L | 4 |
| Admin | Public library — `PublicLibraryPanel` | dark | **`PublicLibraryPanel.css`** | RowSelect | S | 4 |
| Admin | Sessions — `SessionsPanel`, `SessionHistoryPanel` | dark | **`SessionsPanel.css`, `SessionHistoryPanel.css`** | RowSelect, Chip | M | 4 |
| Admin | Reports — `ReportsPanel`, `ReportSavedDialog` | dark | **`ReportsPanel.css`**, `ReportShare.css` | RowSelect, Button | M | 4 |
| Admin | Prompts — `AIPromptManager`, `AIGenerationPromptEditor` | dark | **`AIPromptManager.css`** (2,360 lines) | RowSelect, Modal styling | L | 4 |
| Admin | Archive — `ArchivePanel` | dark | **`ArchivePanel.css`** | RowSelect, Notice | M | 4 |
| Admin | Accounts / Users — `UserManagement` | dark | **`UserManagement.css`** | RowSelect, Chip | M | 4 |
| Admin | Events list + builder — `EventsPanel`, `EventBuilder`, dialogs | dark | **`EventsPanel.css`, `EventBuilder.css`** | RowSelect, Card, Modal styling | M | 4 |
| Admin | Members / team — `TeamPanel`, `InviteDialog`, `CreateOrgDialog` | dark | **`TeamPanel.css`, `InviteDialog.css`, `CreateOrgDialog.css`** | RowSelect, Modal styling | M | 4 |
| Admin | Billing — `BillingPanel`, `InvoicePanel`, `DiscountCodesPanel`, `AdjustmentsLedger`, `OrgBillingDrawer`, `PlanRequests*`, `LeavePlanDialog`, `PlanLimitNotice`, `UsageMeter` | dark | **9 sheets** (`BillingPanel.css` … `UsageMeter.css`) | RowSelect, Notice, Button | M | 4 |
| Admin | Privacy — `PrivacyPanel` | dark | **`PrivacyPanel.css`** | Notice | S | 4 |
| Admin (staff) | Platform orgs, Observability, Moderation, Usage stats, Audit log | dark | **`PlatformOrgsPanel.css`, `ObservabilityPanel.css`, `ModerationPanel.css`, `UsageStatsPanel.css`, `AuditLog.css`** | RowSelect, Chip | M | 4 |
| Admin (staff) | Engage settings — `ClaudeModelsPanel` + new `SiteSkinPanel` | dark | **`ClaudeModelsPanel.css`** + new | Card, Button | S | 0 |
| Admin | `/builder` — `BuilderPage` | mixed | **`BuilderPage.css`** (158 rule literals, 0 token decls) | Button, Card | L | 4 |
| Host laptop | `GameHostPage` shell, setup, dock, rail, queue, dialogs (every game type) | dark | **`styles/stage.css`**, `GameSetupDialog.css`, SC-01, SC-07, SC-10 | TopLine, Eyebrow, Heading, Chip, Pips, Button, Ground | L | 5 |
| Host laptop | Call and Answer — answer navigator, spotlight, feedback round, model compare | dark | `FeedbackRoundPanel.css`, `ModelCompare.css`, SC-03, SC-10 | Card, NumberBadge, Pips | M | 5 |
| Host laptop | Trivia — podium, trivia buttons, category selection | dark | SC-06, `stage.css` podium | NumberBadge, TallyRow | M | 5 |
| Host laptop | Poll — `PollBoard` | dark | `survey/results/SurveyResults.css` | TallyRow, Chip | S | 5 |
| Host laptop | Survey — `SurveyWalkthrough`, `SurveyCollecting` | dark | `survey/results/SurveyResults.css`, `stage.css` | TallyRow, Pips | S | 5 |
| Host laptop | Wavelength — convergence, vocabulary, word cloud | dark | SC-08 | Heading, Chip | M | 5 |
| Host laptop | Remote-browser bits — `RemoteQuestionBrowser`, `RemoteCategoryList`, `RemoteSessionPanel` | dark | **those 3 sheets**, SC-02 | RowSelect | S | 5 |
| Events | Event stage `/host/event/{code}` | dark | **`event/EventStage.css`** | TopLine, Heading, Eyebrow, Ground | M | 5 |
| Events | Agenda `/host/event/{code}/agenda` | dark | **`event/HostEventAgenda.css`** | Card, Chip | S | 5 |
| Events | Attendee `/play?event=` | dark | **`event/EventAttendeePage.css`**, `PlayerSurface.css` | Card, Eyebrow | S | 6 |
| Remote | `/remote` — `HostRemote` (phone) | dark | **`HostRemote.css`**, `RemoteQuestionBrowser.css`, SC-02 | TopLine, Eyebrow, Card, NumberBadge, Button, Pips | M | 6 |
| Participant | `/play` — `PlayerPage`, `PlayerShell`, survey inputs, `ScoreCard` (phone, laptop, tablet) | dark | **`PlayerSurface.css`** (1,897 lines), **`ScoreCard.css`**, SC-03, SC-06 | TopLine, Eyebrow, Heading, Card, NumberBadge, Button, Pips, TallyRow | L | 6 |
| Build Room | `/build` host, projected screens, history, mockup viewer, wheel | dark | **`buildroom/BuildRoom.css`** (943 `var()`, 86 `--primary`), **`BuildWheel.css`, `BuildReport.css`** | all | L | 6 |
| Build Room | phones — `BuildPlayer`, `BuildCrew` | dark | **`BuildPlayer.css`, `BuildCrew.css`** | Card, Button, Pips | M | 6 |
| Reports | `GameReport` (in-app + PDF) | paper | **`GameReport.css`**, SC-04 | Heading, Eyebrow, TallyRow | L | 7 |
| Reports | `/shared-report` — `SharedReportPage` | dark | **`ReportShare.css`** | Heading, Button | S | 7 |
| Reports | `RoundReport`, `TalkingPointsReport`, `SurveyResultsPanel`, `SurveyOpenAnswersPanel` | dark | **those 3 sheets** | TallyRow, Card | S | 7 |
| Help | in-app help — `HelpSystem`, `HelpButton`, `DocRenderer`, `IssueReportForm` | paper/mixed | **`HelpSystem.css`, `HelpButton.css`, `documentation/documentation.css`, `IssueReportForm.css`** | Heading, Notice, Modal styling | M | 7 |
| Dev only | `/test/wordcloud` — `WordCloudTest.jsx` | — | 9 JSX literals | — | S | allowlisted permanently or deleted |

## 5. What is already close

| Already token-clean (≤ 1 rule literal) | Count |
|---|---:|
| Sheets with 0 colour literals in rules | 34 (44 with at most 1) |
| `present/present.css` | 1 (the `html.present-locked` ground) |
| `event/*` (3 sheets) | 0 |

Most admin panels built on the `.qsets` idiom keep their colours in a scope token block, so Phase
0b (re-pointing token blocks) switches them with no rule edits; their waves are then mostly
`--primary` decisions and test updates.
