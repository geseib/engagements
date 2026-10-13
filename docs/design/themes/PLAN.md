# Site skins: implementation plan

**Status: PROPOSED, 2026-10-13.** Reads `SPEC.md` (the design) and `INVENTORY.md` (the counts).
The tooling every unit uses is specified in `TOOLING-BRIEF.md` and is built **before** Phase 0b.

```
Phase T  tooling (TOOLING-BRIEF)                          1 agent
Phase 0  site switchable: values, roles, setting, gate     0a -> {0b x4, 0c, 0d} -> 0e
Phase 1  component library, built in parallel              13 units, one file pair each
Phase 2  the Presentation adopts the library (reference)   1 unit
Waves 3-7  per-surface adoption                            parallel units, disjoint files
Phase 8  remove aliases, allowances to zero, flip on test  1 agent, then the owner
```

Owner sign-off points: after Phase 0 on dev (flip to Present and back), after Phase 2 (the
Classic Presentation), and before Phase 8's flip on test.

---

## 1. The gates every unit passes

Run from the worktree root. A unit is not done, and is not merged, until every line is green.
Judge suites by **exit code and suite count** (a suite that silently matched nothing is a fail).

```bash
# 0. clean
rm -rf .aws-sam

# 1. the unit's own tests, fast loop
cd src && npx jest <pattern-for-this-unit> && cd ..

# 2. full frontend gate
cd src && npm test && npm run lint && npm run build && cd ..

# 3. every backend suite — 34 of them read frontend source
for f in tests/*.js; do node "$f" >/dev/null 2>&1 || echo "FAIL $f"; done   # must print nothing

# 4. the skins gate and the visual check (TOOLING-BRIEF §4-§5)
cd src && npx jest skinPalette skinLiteralsPalette && cd ..
node scripts/skins/classicEquivalence.js --base <wave-start-ref> --unit <ID>   # 0 differences
node scripts/skins/shoot.js --unit <ID>           # 375/660/1280 x classic/present x the unit's routes
node scripts/skins/diff.js  --unit <ID> --skin classic   # must report 0 changed pixels (or listed deltas)
```

Rules that apply to every unit:

| Rule | Why |
|---|---|
| **Classic is zero-diff.** Any changed Classic pixel is either fixed or recorded as an *accepted Classic delta* in the unit record with the reason; deltas are batched to the owner. | "Nothing changes for anyone until staff flip it." |
| Edit only the files the unit owns (table per wave). A shared test file has exactly one owner; others ask it. | Parallel units must never conflict. |
| Lower the file's `skin-allowance` pragma to the new count in the same change. | the ratchet (SPEC §7) |
| No `npm install` in a worktree (it prunes 85 packages); resolve deps from the main checkout. | `engage2-running-the-suites` memory |
| Never name a file with `token` in it. | `.gitignore:35` |
| jest runs on Node 18 in the pipeline: no Node 20+ APIs in tests or tools. | |
| No layout change. A diff in Present that moves a box is a bug. | SPEC §1 |
| Commit per unit; never push a tier branch from a unit. Units drain through **one integration branch** (`working/skins-integration`), merged serially, gates re-run after each merge. | CLAUDE.md: a branch push is a deploy |

---

## 2. Phase 0 — site switchable

Ends with: on dev, staff flip **Engage settings → Site look → Present**, and every surface whose
colours come from tokens (global or scoped) changes; flip back and Classic is pixel-identical to
today. Rule-level literals still render Classic until their wave — that is expected and listed.

| Unit | Owns (files) | Work | Tests added/updated | Done when |
|---|---|---|---|---|
| **0a Values and roles** | new `src/src/styles/skins/classic.css`, `present.css`, `src/src/styles/roles.css`; `styles.css:1-82` (SC-00 token blocks); `src/src/index.jsx` (import skins + roles before `styles.css`) | Move every value from `styles.css:9-79` into `classic.css` as `--sk-*`; write `present.css` from SPEC §4; `roles.css` maps theme × values → roles (SPEC §3); `styles.css` `:root`/`[data-theme]` blocks shrink to role aliases kept for migration (`--primary`, `--secondary`, `--hairline`). | new `skinPalette.test.js`; update every palette test's `token(GLOBAL_CSS, …)` reads to the new helper `resolveRole()` (TOOLING-BRIEF §2) — this touches ~60 test files, **mechanically, by the codemod, in this one unit** | Classic zero-diff on the 12 reference routes; `document.documentElement.dataset.skin='present'` in devtools changes `--accent`; all gates green |
| **0b-1 Scope blocks: marketing, auth, entry** | token blocks only (no rules) in group A + B sheets (INVENTORY §2) | Re-point each scoped colour declaration that equals a role exactly to `var(--role)`; near-variants to channel form `rgb(var(--slate-rgb) / .22)`; `--mk-amber`→`var(--action)`, `--mk-blue`→`var(--info)` | the palette tests that read these sheets | the codemod's report shows 0 unmapped declarations or each listed with reason; Classic zero-diff |
| **0b-2 Scope blocks: admin** | token blocks in groups C, D, E, F | same | same | same |
| **0b-3 Scope blocks: session surfaces** | token blocks in G, H, I, J, K, O + `styles/stage.css` token lines | same; `--plr-amber-*` → `rgb(var(--accent-rgb) / a)` | same | same |
| **0b-4 Scope blocks: reports, help** | token blocks in L, M | same | same | same |
| **0c The Presentation on roles** | `present/present.css` only | `--secondary`→`--accent`/`--accent-text`; `--present-canvas`/`--present-glow` → `--wall-canvas`; eyebrow → `--eyebrow-*`; wipe → `--phase-*`; add `data-surface="wall"` in `PresentStage.jsx:133` (one attribute; the unit owns that line) | `presentPalette.test.js` rewritten: both skins AA; "no orange" becomes "under Present, every accent on the wall resolves blue" | Present skin: pixel-identical to today's `/present`. Classic skin: the SPEC §4.5 table, screenshot set attached for the owner |
| **0d The setting** | backend: new `lambda-functions/admin/shared/site-skin.js` + guarded copy `lambda-functions/websocket/site-skin.js`; `admin/orgs/platform-settings.js` (dispatch on `{name}`); `websocket/events/resolve-code.js` (`/site` branch); `template-clean.yaml` (replace the two claude-models events at `:1765-1780` with `{name}` events; add `GET /site` to `ResolveJoinCodeFunction` at `:717`); `auth/authorizer.js:545`. Frontend: new `config/skins.js`, `components/SkinProvider.jsx`, `components/SiteSkinPanel.jsx` + `.css`; `App.jsx` (mount provider); `AdminPage.jsx:2094` (second panel); `config/consoleSections.js:327-333` (icon, subtitle); `public/index.html` (boot script) | per SPEC §5 | new `tests/site-skin-registry.js`, `tests/site-skin-routes.js` (handler: staff-only POST, audit-first, 503 when audit fails, public GET shape and cache header); update `tests/claude-55-switch.js` for the `{name}` route; new `__tests__/skinBoot.test.js`, `__tests__/siteSkinPanel.test.jsx`, `__tests__/siteSkinPanelPalette.test.js` | a staff POST on dev changes `GET /site`; a fresh private window loads Classic then Present; a reload paints Present first; resource count up by exactly 1 |
| **0e The gate** | new `__tests__/skinLiteralsPalette.test.js`; adds a `skin-allowance` pragma to every stylesheet at its measured count (codemod, TOOLING-BRIEF §3) | SPEC §7 | itself | fails if any literal is added anywhere; passes at today's counts |

Order: **0a** first (everything reads roles). Then **0b-1..4, 0c, 0d in parallel** (disjoint
files; 0d's frontend files are new or one-line edits nobody else owns). **0e** last, after a
re-measure, so the pragmas carry post-0b counts.

---

## 3. Phase 1 — the component library

13 units, **fully parallel**: each owns `src/src/components/ui/<Name>.jsx`, `<Name>.css` and
`__tests__/ui<Name>Palette.test.js` + `__tests__/ui<Name>.test.jsx`. No unit edits a screen.

| Unit | Component | Props (SPEC §6) | Must prove in its test |
|---|---|---|---|
| L1 | `Eyebrow` | `as`, `tone`, `children` | uppercase, tracking/weight/colour from `--eyebrow-*`; AA in 2 skins × 2 themes |
| L2 | `Heading` | `level`, `size`, `balance` | reads the caller's ladder var, never a px |
| L3 | `Button` | `variant`, `size`, `as` | `action` uses `--action`/`--on-action`; under `[data-surface=wall]` Present resolves blue; focus ring; danger uses `--danger-deep` |
| L4 | `NumberBadge` | `n`, `size`, `tone` | ink on accent ≥ 4.5 both skins |
| L5 | `Card` | `selected`, `badge`, `as` | `--select-mark` applied only when selected |
| L6 | `Pips` | `variant`, `done`, `of`, `seen` | port of `Meter`/pages/track from `PresentMoments.jsx:34-46,176-190`; caps at 24 |
| L7 | `TopLine` | `left`, `right` | `--hair` honoured (Call = 2px) |
| L8 | `Chip` | `tone` | every tone AA on `--bg` and `--surface` |
| L9 | `Ground` | `variant` | flat under `:root.d-call` in both skins |
| L10 | `TallyRow` | `rank`, `label`, `sub`, `share`, `points` | tabular figures; bar min 3% |
| L11 | `.ui-row` (CSS only) | — | hover/selected composited AA |
| L12 | `Notice` | `tone` | tints composited AA; replaces `StatusMessage` styling only (behaviour untouched) |
| L13 | Modal look (`.ui-dialog`, `.ui-scrim`) | class only | scrim `align-items:flex-start; overflow-y:auto` (hard rule 10) — asserted as text |

Done for each: component + test green; renders in the skin gallery (TOOLING-BRIEF §5.3) in both
skins at 375/660/1280; no screen edited.

---

## 4. Phase 2 — the Presentation adopts the library

One unit, `P2`: owns `present/PresentMoments.jsx`, `present/PresentStage.jsx`,
`present/present.css`, `PresentPage.jsx`. Replace the hand-rolled top line, eyebrow, hero, meter,
badge, card, tally, pages with L1-L10; delete the rules they replace from `present.css`. Done:
Present skin pixel-identical to the Phase 0c baseline; Classic per SPEC §4.5; `fitcheck=1`
reports no new misses at all four profiles; owner reviews the Classic wall.

---

## 5. Waves 3-7 — per-surface adoption

Each row is one unit = one subagent. **Units in the same wave run in parallel**; a wave starts
when the previous wave is merged (later waves read components and shared sheets the earlier
waves settled). File ownership is exclusive across a wave; the `styles.css` units own line ranges
(INVENTORY §3) re-derived from banners at start.

Every unit's work, in order: (1) prove selectors live, delete dead ones; (2) run the codemod on
its files in *report* mode, decide every `--primary`/`--secondary` and every literal (SPEC §4.4);
(3) adopt the listed components where the markup already has that element (no layout change);
(4) update/add the palette test so it asserts AA for both skins; (5) lower the allowance pragma,
target 0; (6) gates; (7) record (TOOLING-BRIEF §6).

### Wave 3 — public and wall surfaces (5 units)

| Unit | Files owned | Components | Tests |
|---|---|---|---|
| W3-a Marketing | `marketing/**/*.css`, `marketing/**/*.jsx` | Ground, Heading, Eyebrow, Button, Card | `marketingPalette`, `marketingShell.test.jsx`; add palettes for the 7 sheets without one |
| W3-b Entry | `RootPage.css/.jsx`, `JoinCodeEntry.css/.jsx`, `WelcomeScreen.css/.jsx` | Heading, Button, Card | `welcomeScreen.test.jsx`, `marketingPalette` (entry half — **owner of the shared test: W3-a**; W3-b sends its assertions to W3-a) |
| W3-c Auth and legal | `auth/*`, `PrivacyPolicyPage.jsx`, `TermsOfServicePage.jsx`, `PendingInvites.css`, `InviteAcceptPage.jsx` | Heading, Button, Notice | new `authPalette.test.js`; remove 27 JSX literals |
| W3-d Scoreboard | `components/stage/scoreboard/*` | Ground, NumberBadge, TallyRow | `scoreboardPalette` |
| W3-e Help | `HelpSystem.*`, `HelpButton.*`, `documentation/*`, `IssueReportForm.*`, `marketing/HelpPage.*` (**moved here from W3-a**) | Heading, Notice, Modal look | new `helpPalette.test.js` first (3 sheets have none) |

### Wave 4 — admin console (8 units)

| Unit | Files owned | Notes |
|---|---|---|
| W4-a Shell | `AdminShell.*`, `ScopeTabs.*`, `OrgSwitcher.*`, `ActingAsBanner.*`, `OverviewPanel.*`, `UsageMeter.*` | owner of `adminShellPalette`, `adminTabsPalette` |
| W4-b Sets list + dialogs | `QuestionSetsPanel.*`, `QuestionSetDeleteDialog`, `HostQuestionSetsDialog`, `QuestionSetUploadPanel`, `PublicLibraryPanel.*`, `ShareSetDialog.*` | owner of `questionSetsPalette` |
| W4-c Set editor | `QuestionSetEditor.*`, `QuestionPreview.*`, `SetMediaPanel.*`, `SetReviewBanner.*`, `CategoryPicker.*`, `RoundKindPicker.*`, `CountField.*`, `QuestionImageField.*`, `AppendModeSwitch.*`, `BatchGuidanceField.*`, `FileUploadPrompt.*` + **SC-09** | `CategoryPicker.css` uses literals on purpose (component-library.md) — move it to roles and give its tests a roles stub |
| W4-d AI authoring | `PollAIBuilder.*`, `SurveyAIBuilder.*`, `SurveyQuestionFields.*`, `GeneratedItemsTable.*`, `GenerationJobPanel.*`, `AIPromptManager.*`, `AIGenerationPromptEditor` + **SC-05** | 2,360-line `AIPromptManager.css`; may split into two units if the codemod report exceeds 150 decisions |
| W4-e Sessions, reports list, events | `SessionsPanel.*`, `SessionHistoryPanel.*`, `ReportsPanel.*`, `EventsPanel.*`, `EventBuilder.*`, `EventDetailsDialog`, `EventItemDialog` | |
| W4-f Team and billing | `TeamPanel.*`, `InviteDialog.*`, `CreateOrgDialog.*`, `BillingPanel.*`, `InvoicePanel.*`, `DiscountCodes.css`, `AdjustmentsLedger.*`, `OrgBillingDrawer.*`, `PlanRequests.css` + dialogs, `LeavePlanDialog.*`, `PlanLimitNotice.*`, `PrivacyPanel.*` | |
| W4-g Platform | `PlatformOrgsPanel.*`, `ObservabilityPanel.*`, `ModerationPanel.*`, `UsageStatsPanel.*`, `StaffStatsDrill`, `AuditLog.*`, `ArchivePanel.*`, `UserManagement.*`, `ClaudeModelsPanel.*` | |
| W4-h Builder | `BuilderPage.css/.jsx` | prove `/builder` is live first; 158 literals |

### Wave 5 — host laptop, every game type (7 units)

| Unit | Files owned | Game types covered |
|---|---|---|
| W5-a Stage chrome | `styles/stage.css` (rules), `components/stage/{Rail,Dock,PhaseBar,RoomMeter,CompletionFlag,Pager,Podium,QueueList,PlayersList,StageGathering,Stage}.jsx` | all |
| W5-b Setup | `GameSetupDialog.*`, `SessionOptions`, `components/stage/{SessionSetupPanel,WorkieSettings}.jsx` + **SC-01** | all |
| W5-c Call and Answer | `FeedbackRoundPanel.*`, `components/stage/{FeedbackWall,ModelCompare}.*` + **SC-03** | C&A |
| W5-d Trivia + categories | **SC-06**, `components/stage/Podium` styles (in stage.css → coordinate: **W5-a owns stage.css**, W5-d sends the podium change to W5-a) | Trivia |
| W5-e Poll + survey | `components/survey/results/*`, `components/stage/{PollBoard,SurveyWalkthrough,SurveyCollecting}.jsx` | Poll, Survey |
| W5-f Wavelength + big screen | **SC-07**, **SC-08**, `components/stage/Wavelength*.jsx`, `WavelengthBuilder.jsx` | Wavelength |
| W5-g Events host | `components/event/EventStage.*`, `components/event/HostEventAgenda.*`, **SC-10** | events |

### Wave 6 — phones and the Build Room (5 units)

| Unit | Files owned |
|---|---|
| W6-a Participant | `PlayerSurface.css`, `PlayerPage.jsx`, `PlayerShell.jsx`, `components/survey/*Input.jsx`, `ScoreCard.*` |
| W6-b Attendee | `components/event/EventAttendeePage.*` (reads `PlayerSurface.css` → after W6-a merges, or W6-a owns both; **recommended: W6-a owns both**) |
| W6-c Remote | `HostRemote.css/.jsx`, `RemoteQuestionBrowser.*`, `RemoteCategoryList.*`, `RemoteSessionPanel.*` + **SC-02** |
| W6-d Build Room host | `buildroom/BuildRoom.css`, `BuildWheel.*`, `BuildReport.*`, every `buildroom/*.jsx` except the phone two |
| W6-e Build Room phones | `buildroom/BuildPlayer.*`, `BuildCrew.*`, `BuildPlayerCrew.jsx`, `BuildPlayerPoints.jsx` |

### Wave 7 — reports and the rest (3 units)

| Unit | Files owned |
|---|---|
| W7-a Game report | `GameReport.css/.jsx`, **SC-04** (paper; also check the html2pdf output in both skins) |
| W7-b Shared + round reports | `ReportShare.*`, `SharedReportPage`, `RoundReport.*`, `TalkingPointsReport.*`, `SurveyResultsPanel.*`, `SurveyOpenAnswersPanel` |
| W7-c Sweep | every remaining allowance > 0 (re-measure), JSX literals in `App.jsx`, `BrandMark.jsx`, `HostRemote.jsx`; decide `WordCloudTest.jsx` (delete or permanent allowance) |

---

## 6. Phase 8 — close

| Step | Done when |
|---|---|
| Remove aliases `--primary`, `--primary-deep`, `--secondary`, `--hairline` from `styles.css`; gate forbids them everywhere | `grep -r "var(--primary" src/src --include=*.css` is empty |
| Every `skin-allowance` pragma is gone or `colour=0 font=0`; the gate switches to "no pragma allowed" | gate green |
| Push the integration branch to `dev` (a branch push is a deploy — CLAUDE.md), staff flip on dev, walk every surface in INVENTORY §4 in both skins | owner walk |
| Promote to `test` (merge, never fast-forward — memory "Promoting to test"), owner flips on test | owner approval |
| Prod: fast-forward of test; halts at the owner's gate; the setting defaults Classic so prod is unchanged until staff flip it there | owner |

---

## 7. How units avoid colliding

| Shared thing | Owner | Others |
|---|---|---|
| `styles.css` | one unit per SC range; SC-00 only Phase 0a | never touch another range; re-derive range from banners |
| `styles/stage.css` | 0a (token lines), 0b-3 (token blocks), then W5-a (rules) | send changes to W5-a |
| `PlayerSurface.css` | W6-a | W6-b asks W6-a |
| A palette test that reads several sheets (`adminTabsPalette`, `questionSetEditorPalette`, `marketingPalette`, `presentationSlidesPalette`, …) | the unit that owns the first sheet it reads (listed in the wave tables) | send assertions to the owner; never edit |
| `skin-allowance` pragmas | in each file; owned with the file | — |
| `components/ui/*` after Phase 1 | frozen; a needed change is a new mini-unit run alone between waves | — |
| Records (`docs/design/themes/records/<unit>.md`) | one file per unit | — |
