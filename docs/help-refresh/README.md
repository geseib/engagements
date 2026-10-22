# Help refresh: scope and plan (22 Oct 2026)

The owner, 22 Oct 2026: *"we need a series of subagent updating the help pages as a lot
has changed. first lets get a list of the screens an the parts of those … there is a large
scope so lets get down what that scope is first and then create a plan to update and
improve the help experience throughout the system."*

Five read-only inventories were run against the code on `dev` at `252a3623`. Their full
reports, with file:line citations, are in [`inventory/`](inventory/):

| Report | Covers |
|---|---|
| [`host.md`](inventory/host.md) | The host side of Call & Answer, Trivia, Poll, Wavelength and Survey: start screen, Create engagement, Quick start, sessions and reports, events, the one-screen stage per phase and type, dock, Session panel, two-screen console, room's window placement, phone remote, report |
| [`admin.md`](inventory/admin.md) | The admin console for a personal space, team owners/admins/members and Engage staff |
| [`player-room.md`](inventory/player-room.md) | Joining, every player state per type, surveys, events for attendees, and every moment the room sees (room's window and one-screen stage) |
| [`build-room.md`](inventory/build-room.md) | Build Room for the host, the room, participants and Claude Code (the plugin) |
| [`help-system.md`](inventory/help-system.md) | How help is built, reached, searched and tested; public pages; where the code changed most |

## 1. The scope

### Surfaces

| Surface | Who | Screens and parts (approx.) | Help today |
|---|---|---|---|
| Host: classic types (C&A, Trivia, Poll, Wavelength, Survey) | host | ~35: start screen, Create engagement (+ Advanced), Quick start, question sets dialog, sessions, reports, invite, lobby, room-screen chooser, ASK/VOTE/RESULTS per type, What we heard, feedback round, Ask the room, scoreboard, ended, survey collect/close/walk-through, dock, Session panel (Players, Questions, Rounds, Settings), two-screen console, step view, QR side panel, spotlight, dialogs, phone remote, session report | 6 host guides; 2 help buttons (both open the role list) |
| Events | host, attendee, room | ~12: Run an event, event details, agenda builder, item dialog, event stage, slides, attendee page (name step, agenda, Back to live, paused, break, talk), event item join | **none** |
| Admin console | personal space, team owner/admin/member, Engage staff | ~35: shell and scope row, bell, Overview, Question sets list + filters, AI drafts strip, Review AI draft, New set (template, AI prompt, upload), 4 AI builders, set editor + questions panel + versions, share/publish, public library, sessions, events, prompts (2 libraries, versions, repo review), members, activity, plan & usage, plan request / leave plan, data & privacy, settings; staff: organisations, observability, plan requests, discount codes, shared library, staff public library + score card, moderation, accounts, archive, Engage settings | 6 admin + 2 builder guides; 4 help buttons |
| Players | participants | ~30 states: join (code, form, private, rejoin, name taken/handover, errors), lobby, between rounds, answer per type, offline-held, submitted, ballot, spotlight, vote submitted, results per type, feedback, question for the room, held follow-up, banners, end screen; survey (6 states); event attendee | 4 player guides; help button on every phone screen (opens the role list) |
| The room (what is projected) | the room | ~16 moments on the room's window (C&A and Build only) and the one-screen stage per type; 4 display sizes; placement and click-to-fill | spread across host guides |
| Build Room | host, room, participants, Claude | ~35 parts: create, header, Host screen (Now, Waiting for you, ask path, decide/send, composer, What's next, voting, wheel, Consider, talking points, run list, Later, opening, room brief, crew, share demo, codes panel, host alert), Session panel (Players, Settings), chooser, two-screen console, Connect, wrap up/end, report, Stage/Build/History, room's window, player page, the Claude Code plugin | 1 guide of 1,630 words in 4 blocks; **no help button anywhere on the host side**; 4 InfoTips (hover only) |
| Help itself and public pages | everyone | help modal, `/help` pages, search, aliases, marketing pages, Privacy, Terms | 22 guides, ~12,300 words |

### What is wrong today (headline numbers)

- **~52 claims are wrong against the code**: host 12, admin 18, players 14, Build Room 8.
  Examples: "use the SETUP control" (the dock says SESSION); "New version" / "Fork" buttons
  that do not exist; "you cannot vote for yourself" (you can); "you can change your answer
  until the round closes" (it locks on submit); a "Reports" console section that cannot be
  reached; "the room's window never shows a name" (it does with List names on).
- **Whole areas have no help**: events; surveys beyond one line; Engage staff screens;
  team admin screens (members, plan, data & privacy); most of Build Room's host flow
  (composer, voting, wheel, talking points, run list, crew, opening, Later) and its
  participant page; per-type stages (poll board, trivia reveal, wavelength results).
- **Help never opens where you are**: every host and player button opens a role list; only
  two admin buttons are contextual. No help on the two-screen console, the phone remote,
  the Build Room host page, the event screens, or the host stage outside the Session panel.
- **The help modal** is not an accessible dialog (no `role="dialog"`, no Escape, no focus
  trap) and is drawn in hard-coded light colours on dark screens.
- **Words drift**: the room display has six names (wall, projector, Stage, big screen,
  room's window, PRESENT) and the Dock's label still says "Presentation"; Workie and Field
  Notes are never introduced; "session" vs "engagement"; "Your space" vs "Personal".
- **The same fact lives in four places** (session expiry, WebSocket/polling) and has already
  drifted.
- **Tests cannot see drift**: ~30 phrases are pinned, but nothing checks that a UI label
  quoted in help still exists, caps a guide's length, bans retired terms, or flags code
  churn without a help change.
- **Privacy and Terms contradict the product**: "we do not share your personal data with
  anyone" (Cloudflare and the AI model see content), "typically 90 days" retention, and an
  effective date that is always today.

### Product defects the inventory found in passing (not help, listed so they are not lost)

1. Build Room two-screen console: Join only shows the codes (no toggle; Esc does nothing there).
2. "← All sessions" in the console goes to the start screen, not the sessions list.
3. The console's "Reports" section is unreachable (not in `sectionsFor`).
4. Suspend an organisation fires on one click with no confirm or reason (see issue #40).
5. The phone shows "This round +0" for Wavelength, which scores nobody.
6. Session expiry is worded three different ways in the console (help, page subtitle, nav).
7. Quick start's empty state tells hosts to use "Admin → Question Sets → Quickstart".
8. InfoTips only show on hover, so touch users never see them.
9. The Dock's accessible label still says "Open the Presentation".
10. Privacy/Terms effective date is `new Date()`.

## 2. The plan

### Principles

- **Help opens where you are.** Every private screen has a help entry that opens the guide
  section for that screen. No help on anything the room sees.
- **One fact, one place.** A fact is written once and linked, never restated.
- **Task first, short.** Guides are organised by what a person is trying to do, sections
  fit on a screen, and nothing quotes a UI label that does not exist.
- **Plain words, one vocabulary**, from a glossary the tests enforce.
- **Every claim is checked against the code**, and the tests make drift visible.

### Phase 0: foundations (one agent, sequential; everything else depends on it)

1. **Decisions from the owner** (section 3 below): terminology, structure.
2. **Split the corpus by area** so writing agents never edit the same file:
   `config/help/` becomes one file per area (player, player-events, player-surveys,
   host-setup, host-running, host-two-screens, host-events, host-surveys, host-reports,
   build-room-host, build-room-participant, build-room-claude, admin-console, admin-team,
   admin-staff, ai-builders-drafts, prompts-workie, technical, glossary), still assembled by
   `index.js` with the same ids or aliases so no link breaks.
3. **Contextual help mechanism**:
   - `HelpButton` takes a guide id and a section anchor; the modal opens at that section
     and the `/help` page gains `#section` deep links.
   - A `HELP_FOR_SCREEN` map (screen id → guide#section) is the one list call sites read.
   - The help modal becomes a real dialog (role, Escape, focus trap, return focus) on dusk
     tokens.
   - InfoTip works on touch (tap to open), keeps its hover.
4. **Guardrail tests**:
   - every screen id in `HELP_FOR_SCREEN` resolves to a real guide section;
   - a banned-terms list (Presentation, SETUP control, New version, Fork, codes card,
     display profile, word cloud, …);
   - UI labels quoted in help are marked and must exist in `src/` (a `ui('Show results')`
     marker in the corpus, checked by a test);
   - section length caps;
   - a churn report script (`scripts/help-drift.js`): for each guide, the code areas it
     covers and the commits since the guide last changed. Advisory, run before every test push.
5. **Glossary guide** ("Words we use"): room's window, the stage, Session panel, Workie,
   What we heard, Your space, session, question set, draft, Build Room, Claude Code plugin.

### Phase 1: make it true (parallel agents, one per area, low risk)

Correct every wrong claim listed in the inventories, nothing more. One agent per report
(host, admin, player-room, build-room). Each edits only its area files, cites the code for
every change, runs `helpContent.test.js`, and returns a diff summary.

### Phase 2: fill the gaps and restructure (parallel agents, one per workstream)

| # | Workstream | New or rewritten guides | Main sources |
|---|---|---|---|
| W1 | Players | Joining (all join states), Playing per type, Voting, Feedback and "Something to add?", When something goes wrong (offline, late, missed) | player-room.md §1, §4 |
| W2 | Host: setting up | Create engagement incl. Advanced, Quick start, choosing one or two screens, question sets from the host side, sessions and reports lists | host.md |
| W3 | Host: running the room | the stage per phase and per type (C&A, Trivia, Poll, Wavelength), dock and keys, Session panel tabs, What we heard, Ask the room, feedback round, scoreboard, ending | host.md |
| W4 | Two screens | the room's window (placement, click to fill, sizes, what it shows per moment), the console, QR side panel, the phone remote | host.md, player-room.md §2 |
| W5 | Surveys | host flow (open, two-minute warning, close, results, walk through) and respondent flow (names promise, required/optional, rank, autosave, review, closing, feedback) | host.md, player-room.md |
| W6 | Events | host (event, agenda, items, talks/slides, stage) and attendee (join, agenda, live, breaks) | host.md, player-room.md |
| W7 | Build Room | split the one guide into: What it is and setup; Connecting Claude Code (plugin, commands, hooks, versions); Running a Build Room (ask path, composer, voting, wheel, decide/send, Consider, points, run list, Later, opening, brief, crew); Sharing the demo; Two screens; Wrap up and report; For participants | build-room.md |
| W8 | Admin: your space and teams | console tour, Overview, question sets (list, filters, owner tags, editor, versions, upload/templates, publish, public library), sessions, events list, members, plan and billing, data and privacy | admin.md |
| W9 | AI | builders and Save into, drafts/bell/review/accept/undo, prompts (two libraries, versions, repo review), Workie (introduced properly), generation prompts | admin.md |
| W10 | Engage staff | organisations (approve, suspend, reinstate, billing), accounts, moderation and score cards, plan requests, discount codes, shared library, archive, observability, Engage settings | admin.md |
| W11 | Technical and public | requirements (incl. Build Room's Node, git, plugin, cloudflared), troubleshooting by symptom, video calls; proposed Privacy/Terms corrections for the owner (not published without the owner) | help-system.md |

Each workstream agent gets: its inventory, the glossary, the style rules, its file
boundary, the ids it must keep, and must (a) cite code for every claim, (b) run the help
tests, (c) for its main screens, check the words against a screenshot on dev (QA account),
and (d) return a list of anything it could not verify.

### Phase 3: wire help into every private screen (one agent, after Phase 2's ids settle)

Add or retarget help buttons using `HELP_FOR_SCREEN`: start screen, Create engagement,
Quick start, the host stage (dock), Session panel tabs, two-screen console, phone remote,
event builder and stage, every admin section, the AI builders and draft review, every
Build Room host screen and its Session panel, the player page per state. Never on the
stage, the room's window or the Build wall (a test already pins this for the bell).

### Phase 4: review and ship

1. An adversarial review agent reads every changed guide against the code and the
   inventories, and walks the top 20 screens on dev against their help.
2. Gates (backend, frontend, lint, build), push to dev, walk.
3. Release notes ("Help, rewritten"), README pointer, push to test for the owner's review.

### Order and parallelism

```
Phase 0 (one agent) → Phase 1 (4 agents in parallel) → Phase 2 (W1–W11, in two waves of
5–6, by file boundary) → Phase 3 (one agent) → Phase 4 (review agent, then ship)
```

The product defects above are filed or fixed separately, so help describes the product as
it is and is not held up by it.

## 3. Decisions for the owner

**Decided 22 Oct 2026: all six yes** (owner: "go, all six yes"). Tracking: issue #44 (the refresh), issue #43 (the product defects).

1. **The room display**: call the second-screen window "the room's window" and the
   one-screen view "the stage", everywhere, and retire wall / projector / big screen /
   PRESENT / Presentation? (Recommended.)
2. **Workie**: introduce Workie once ("Workie, Engage's AI, writes What we heard…") and
   use it consistently; retire "Field Notes" and "the AI summary" in help? (Recommended.)
3. **Session vs engagement**: keep "Create engagement" as the button and "session"
   everywhere else, explained once in the glossary? (Recommended.)
4. **Structure**: move from five role lists to task-first guides under the same five
   roles, with the help button opening the exact section? (Recommended.)
5. **Privacy and Terms**: rewrite as proposed text for you (or counsel) to approve, rather
   than editing published legal pages directly? (Recommended.)
6. **Product defects found in passing** (section 1): file them as issues now and keep the
   help refresh to describing the product as it is? (Recommended.)
