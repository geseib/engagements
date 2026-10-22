I've finished the read-only audit; nothing was changed. The help content is in much better shape than the docs around it suggest: guide counts come from the data, search works, there's a public `/help` route, and the content tests are strong. The main problems are about reach and fit: big features have no guide, most host screens have no help button, help never opens at the topic you're on, and the help modal itself has accessibility gaps. The privacy page also contradicts what the help and the product say.

## 1. The corpus

**Structure.** `config/help/index.js:27` lists the five roles in this order: player, host, admin, builder, technical. Guide lookups, search and the role cards are all built from that one list. Roles have an `id`, `title`, `icon`, `blurb` and `guides`. There is **no `audience` field**; the blurb does that job.

**Size.** 22 guides, 2,287 lines and about 12,300 words of prose (counted with node over the files).

| Role (id / title / blurb) | Guide id: title (sections, blocks, words) |
|---|---|
| `player` / For players / "You scanned a code and you are in the room." | `player-getting-started`: Getting started (3, 7, 302) · `player-joining`: Joining a session (4, 11, 515) · `player-playing`: Playing (4, 15, 727) · `player-scoring`: Scoring (2, 5, 313) |
| `host` / For hosts / "Running a session in front of a room." | `host-quick-start`: Quick start (6, 21, 919) · `host-game-setup`: Setting a session up (4, 15, 764) · `host-running-engagements`: Running the room (5, 23, 1149) · `host-late-items`: Late answers and comments (3, 4, 292) · `host-player-management`: Managing players (3, 15, 520) · `host-reporting`: Results and reports (3, 9, 386) · **`host-build-room`: Build Room (4, 4, 1630)** · `host-plan`: What counts toward your plan (4, 6, 298) |
| `admin` / For admins / "The console: question sets, members, plans, prompts…" | `admin-getting-started` (3, 5, 307) · `admin-question-sets` (5, 12, 436) · `admin-ai-prompts`: Prompts (8, 24, 1019) · `admin-ai-builders` (5, 10, 709) · `admin-game-management`: Sessions (2, 3, 172) · `admin-settings` (3, 3, 158) |
| `builder` / For builders | `builder-manual`: Writing questions (5, 12, 512) · `builder-ai`: Building with AI (4, 9, 445) |
| `technical` / Technical | `technical-troubleshooting` (5, 7, 500) · `technical-requirements` (4, 5, 243) |

**Block types.** The 13 supported types are listed at `components/documentation/DocRenderer.jsx:46`. How often each is used: `p` 91, `note` 51, `list` 29, `h` 17, `table` 11, `steps` 9, `faq` 5, `gameTypes` 3, `keys` 3, `phases` 2, `variables` 2, `features` 1, `code` 1.
- `phases`, `gameTypes` and `variables` are filled in from code (`config/gameTypes.js`, `config/templateVariables.js`), so they can't drift from it.
- An unknown block type renders nothing (`DocRenderer.jsx:293`).

**Renderers.** The same `DocRenderer` is used in two places:
- the modal, `components/HelpSystem.jsx`, opened by `components/HelpButton.jsx`;
- the public page, `marketing/HelpPage.jsx`.

## 2. How help is reached

**HelpButton call sites (8 in total):**

| File:line | `section` | Resolves via alias? | Has report menu? |
|---|---|---|---|
| `AdminPage.jsx:1883` | `admin` | no (role id) | yes |
| `AdminPage.jsx:1998`, `:2024` | `ai-prompts` | yes, to `admin-ai-prompts` | no |
| `AdminPage.jsx:2430` | `websocket-settings` | yes, to `admin-settings` | no |
| `components/PlayerShell.jsx:90` | `player` | no (role id) | yes |
| `components/stage/SessionSetupPanel.jsx:520` | `host` | no (role id) | yes |
| `components/WelcomeScreen.jsx:156` | `host` | no (role id) | yes |

- When `reports` is passed, the button becomes a four-item menu: "Read the guides", then Report a bug / Request a feature / Ask for help (`HelpButton.jsx:11-15, 141-155`).
- **Only the admin screen has contextual help** (the two inline buttons). Every player and host button opens a role index, never the guide for the screen you're on.

**Routes and deep links**
- `/help`, `/help/<role>` and `/help/<role>/<guide>` (`App.jsx:392`, `marketing/HelpPage.jsx:24-38`). Aliases and bare guide ids also work in the URL.
- `BillingPanel.jsx:280` links to `/help/host-plan`. That is the only in-app link to a specific guide.
- The marketing header and footer both link to Help (`marketing/MarketingShell.jsx:13`, `:191`).

**Search** (`config/help/index.js:117`)
- Plain case-insensitive substring match. It indexes every string in a guide, including table cells.
- Title or summary matches sort first. There is no ranking within each group, no snippet of where the match is, and no synonyms.
- The modal says "Try a shorter word…" when nothing matches. The page says "No guides match that search."

**Aliases** (`index.js:54`)
- Used by code: `ai-prompts` and `websocket-settings`.
- **Unused in code:** `question-sets`, `quick-start`, `billing`, `players`, `troubleshooting`. They exist only for URLs; `/help/billing` is pinned by tests.
- All seven resolve to real guides.

**Inline help**
- `buildroom/InfoTip.jsx` is used 4 times, all in `buildroom/BuildRoomPage.jsx` (2376, 2531, 2598, 3575). The text only shows as a hover `title` plus screen-reader text, so **a touch user never sees it**.
- About 216 static `title="…"` hints across the app.
- The "Help me pick" helper in `components/stage/RoomScreenChooser.jsx`.

**Screens with no way into help:**
- `/builder` (`BuilderPage.jsx`)
- `/remote` (`HostRemote.jsx`), even though the help documents the phone remote
- the Build Room host page and console (`buildroom/BuildRoomPage.jsx`, `BuildConsole`, `BuildSessionPanel.jsx`)
- the two-screen console (`components/console/*`)
- the event builder and host agenda (`components/EventBuilder.jsx`, `components/event/HostEventAgenda.jsx`)
- the host stage outside the session panel (`GameHostPage.jsx`; help is only reachable once the panel is open)
- `/join`, `/auth`, `/invite/*`, `/shared-report`
- `/privacy` and `/terms`, which don't use the marketing shell

## 3. Tests

**`__tests__/helpContent.test.js`** (318 lines, sections §1–§8) checks:
- **Structure:** 5 roles with at least 2 guides each; every guide has a title, summary and blocks; each guide has more than 600 characters of text; ids are unique and resolve; no "under development / coming soon" wording.
- **Block types:** the corpus uses exactly the types the renderer handles, in both directions.
- **Computed blocks:** they name real game types and real placeholders; three made-up placeholders are banned.
- **Routing and search:** every alias resolves; specific aliases are pinned; unknown ids go to the help home; the issues link is the real repo URL; search behaviour is pinned (empty query, matches in the body, title-first ordering, case).
- **15 regexes for shipped features.**
- **Plan rule:** the billing rule's exact wording, and no "7 days after last played".
- **Matches the product:** no emoji; "Create engagement"; poll and Wavelength score nobody; trivia allows up to six options; reports kept 1 year; the Build Room guide mentions Node 18 and git; the console sections are named.
- **Not checked:** length caps, a list of banned old labels, links between guides, or whether a quoted UI label still exists.

**Other tests that pin help:**
- `helpSystem.test.jsx`: the modal opens every guide, navigation works, the footer and computed tables render.
- `helpPage.test.jsx`: canonical URLs, a single `h1`, the mobile toggle.
- `helpEntryPoints.test.jsx`: the player and host buttons exist and are styled correctly.
- `helpButtonMenu.test.jsx`: the four-item menu, Escape and click-outside closing, 44px tap targets.
- `scoreboardHostKeys.test.jsx:149` (S and V keys), `sessionPanelOpenKey.test.jsx:160` (the `\` key), `settingsConsolidation.test.jsx:198` (three phone-remote phrases) and `billingPanel.test.jsx:322` all pin wording in the host guide.

**`tests/release-notes.js`** checks the shape of the newest entry only: date first, `### New`, `### Fixed`, `### What to look at` (a numbered list), `### Known gaps`, and a `dev \`sha\`` reference.

**CLAUDE.md:35-50** ("notes, help, README" before every push to test) is followed in practice: every test-push commit since 16 Oct says so. But nothing ties a code change to a help change, so it is enforced by habit only.

## 4. Quality signals

**Repeated topics**
- Session expiry is restated four times: `admin.js:61`, `admin.js:506`, `host.js:653`, `technical.js:95`.
- WebSocket and polling are covered four times: `admin.js:518`, `admin.js:552`, `technical.js:47`, `technical.js:144`.
- "Quickstart" is covered twice: `host.js:205` and `admin.js:113`. Separately, `host-quick-start` is an unrelated guide with the same name.
- Where an AI-built set gets saved: `admin.js:402` and `builder.js:165`.
- Question sets are spread across three guides: host-game-setup, admin-question-sets and builder-manual.
- Two guides are both titled "Getting started" (player and admin).

**Very long guides**
- `host-build-room` is 1,630 words in only 4 blocks. One list item, "Two screens: your laptop console" (`host.js:805`), is about 330 words; the item at `:804` is about 170.
- Also long: `host-running-engagements` (1,149) and `admin-ai-prompts` (1,019).

**Internal details in the prose**
- Dates, "the owner said" and file names appear only in code comments (e.g. `host.js:732-748`, `admin.js:327`), not in user-facing text.
- But users do see:
  - plugin version numbers: "plugin 1.20.0" (`host.js:802`), "plugin 1.21.0" (`host.js:811`);
  - internal site names: `engage-test` / `engage-dev` (`host.js:774`);
  - the "AI-ify dialog" (`admin.js:562`).

**Inconsistent terms**
- **Room display** has six names: "the wall" (13 uses), "projector" (9), "the Stage" (5), "big screen" (4), "Room's window", and "PRESENT" (`host.js:804`). Meanwhile the UI's accessible label still says "Open the **Presentation** in a new window" (`components/stage/Dock.jsx:220`).
- **The AI** is "AI summary", "the AI", or "Workie's read" (`host.js:317`). **"Workie" is never introduced**, even though it appears in about 84 UI files and the README.
- **Session vs. engagement:** the button is "Create engagement", but everything else says "session". The guide id is still `host-running-engagements`, and admin ids still use "game".
- **"Your space"** is used in the help (`admin.js:402, 450`; `builder.js:165`), but the org switcher calls it "Personal" (`components/OrgSwitcher.jsx:62`).

**Removed features and old labels**
- The help is clean: no "Back to menu", "Presentation", "Field Notes", "codes card" or "arrives switched off".
- **But some live features have no guide:**
  - "Field Notes" (`components/AISummaryStatus.jsx`) is the UI's name for the AI-summary panel; the help never uses it.
  - The Build Room "codes card" isn't described.
  - **Events** (agenda, slides, attendee page) have only a passing mention (`host.js:123`). The README says Events are on dev and test only.

**Wrong links and stale comments**
- The home screen's "My name is taken" quick link goes to the **host** guide `host-player-management` (`HelpSystem.jsx:181`), not to `player-joining`'s "When your name is taken" section.
- The comment at `marketing/content/help.js:7-10` says "Playing" and "Joining a session" don't exist in the corpus. They do now.

## 5. Public pages

- **Marketing:** `HomePage`, `HowItWorksPage`, `UseCasesPage`, `BuildRoomPage` (`/build-room`), `ReportsPage` and `HelpPage`, with copy in `marketing/content/*.js`. **There is no pricing page.** Plans are only explained in-app (BillingPanel plus the `host-plan` guide).
- **`/help` page:** its own copy is just the 7 strings in `marketing/content/help.js`. It promises "the same guides the in-app help button shows". True, but the in-app button never opens a specific guide.
- **`TermsOfServicePage.jsx` and `PrivacyPolicyPage.jsx`:**
  - Generic boilerplate, outside the marketing shell, with hard-coded light-theme colours.
  - The **"Effective Date" is `new Date().toLocaleDateString()`**, so it shows today's date on every visit (`Terms:29`, `Privacy:29`).
  - Contact is "support channels or administrator", with no address.
  - **Privacy says "We do not share your personal data with anyone"** (`:56`). But the help itself says the demo share goes through Cloudflare, "who can see the demo" (`host.js:803`), and room answers are sent to an AI model (implied by the prompts guide; I didn't trace the provider).
  - Privacy says retention is "typically 90 days" (`:67`). The help says 7 days once a session starts, and saved reports are kept up to a year.
- **`README.md`:** the user-facing part is lines 1-38 (types table including Build Room and Event, two-screen mode, late items, Workie, report retention). It points users to the help (`:120-123`).
- **`RELEASE_NOTES.md`:** the top entry is "19 Oct 2026: Build Room on two screens…". It has a dev `156265f6` reference, New / Fixed / What to look at (8 steps) / Known gaps, and is very dense with feature names.

## 6. Recent change velocity (since 2026-10-01)

159 commits touched `src/src`. Commits per area:

| Area | Commits |
|---|---|
| `__tests__` | 115 |
| `config` (excluding help) | 48 |
| `GameHostPage.jsx` | 35 |
| `buildroom` | 31 |
| `components` (top-level files) | 30 |
| `components/console` | 29 |
| **`config/help`** | **25** |
| `present` | 24 |
| `components/stage` | 19 |
| `styles` | 14 |
| `utils` | 11 |
| `PlayerPage.jsx` | 11 |
| `HostRemote.jsx` | 8 |
| `PresentPage.jsx` | 7 |
| `AdminPage.jsx` | 4 |
| `hooks` | 4 |
| `marketing`, `components/event`, `components/survey`, `components/documentation` | 1 each |

**Help log:** 31 entries from 15 to 21 Oct 2026, the latest being `252a3623` (21 Oct, "The bell on the host's own screens"). Most are tied to test pushes, and nearly all concern the Build Room, the room's window or two-screen mode. The newest features are covered: the bell, prompt versions, AI drafts.

**Most likely to be stale:**
- `components/console` and `present`: lots of churn, covered only by long paragraphs in `host-running-engagements` and `host-build-room`.
- Events: changed and undocumented.
- The modal's code (`HelpSystem.jsx` and its CSS) hasn't changed since 15 Oct.

## The 10 most important problems

1. **Help never opens at the topic you're on.** Every player and host button opens a role index; only the admin page has contextual buttons. Mid-session, a player who hits "That name is taken" has to scroll through a list to find the answer.
2. **Many host screens have no help at all:** `/builder`, `/remote`, the Build Room host page and console, the two-screen console, the event builder and agenda, and the host stage until the session panel is opened.
3. **The modal isn't a proper dialog** (`HelpSystem.jsx:248-294`): no `role="dialog"` or `aria-modal`, no Escape to close, no focus trap. It also uses hard-coded light-theme colours (47 hex values in `HelpSystem.css`, 42 in `documentation.css`) on screens that are otherwise dark.
4. **The Build Room guide is a wall of text:** 1,630 words in 4 blocks, with single items of about 330 words (`host.js:805`). It's the fastest-changing area and the hardest guide to update or scan.
5. **The room display has six names** (wall, projector, Stage, big screen, Room's window, PRESENT), and the UI's accessible label still says "Presentation" (`Dock.jsx:220`).
6. **Important names are never explained:** "Workie" and "Field Notes"; "Personal" vs. "your space"; "session" vs. "engagement".
7. **Shipped features with no guide:** Events (agenda, slides, attendee page) and the codes card. Build Room players get only one sentence (`player.js:199`), though they land on the player help.
8. **Privacy and Terms contradict the product:** "We do not share your personal data with anyone" despite Cloudflare and AI processing; 90-day retention vs. 7 days or 1 year; an effective date that changes every day.
9. **Duplicated facts will drift:** expiry is stated four times, WebSocket/polling four times, Quickstart twice, where AI sets are saved twice. Troubleshooting also tells hosts and players to use an admin-only, browser-local polling switch (`technical.js:47`, contradicted by `admin.js:542`).
10. **The tests can't catch drift from the UI.** They pin about 30 phrases and block a few old phrasings, but don't check that quoted UI labels still exist, cap guide length, ban retired terms like "Presentation", or flag when a high-churn area changes without help changing. The "notes, help, README" rule relies on discipline. Smaller issues: the "My name is taken" quick link goes to the host guide (`HelpSystem.jsx:181`), version numbers and internal site names appear in user text, and InfoTips are invisible on touch screens.