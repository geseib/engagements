# Engage

Engage runs live sessions in a meeting room or on a video call. The host drives one
screen; everyone else answers on their own laptop, tablet or phone. People join by
scanning a QR code or typing a four-digit code. Players never sign in and install nothing.

## What a host can run

| Kind | What happens | Phases |
|---|---|---|
| **Call & Answer** | Everyone writes an answer, then the room ranks the best ones (3, 2, 1 points). | ASK → VOTE → RESULTS |
| **Trivia** | Multiple choice, usually four options and up to six, one right answer. Points plus a speed bonus. | ASK → RESULTS |
| **Poll** | One question at a time: pick, rate, yes/no or a short answer. The result goes up live. No points. | ASK → RESULTS |
| **Wavelength** | Word association. A word lands when everyone said it. No points. | ASK → RESULTS |
| **Survey** | Several questions answered at each person's own pace; the host opens and closes it. | COLLECTING → CLOSED |
| **Build Room** | The host's Claude Code builds something while the room suggests, chooses and rates. The host decides. | — |
| **Event** | One join code for an agenda of sessions, talks and breaks. On dev and test only for now. | — |

On two screens (the room watches a separate window on the projector), the host's laptop
shows a private console instead of a copy of the wall: the round's steps, who has
answered, responses as they land, and whether the room's window is really up. Two screens
is switched on per game type in `src/src/config/surfaces.js`; today that is Call & Answer.
In Chrome or Edge with a second display attached, "Room's window" opens the window on that
display and fills it (`src/src/present/roomWindow.js`); elsewhere it opens beside you to drag
across.

Call & Answer results show the ideas first, ranked by the room's votes, with the names as
a small credit; the standings are on the scoreboard, on demand. Nothing that arrives late
is lost: a late answer, a late answer to a question for the room, and a comment added after
its round are kept, labelled and listed for the host to review ("Late & not reviewed"), and
the report shows them under "Arrived late". Comments stay open until 24 hours after the
session ends (`lambda-functions/game/late-window.js`; the words are `src/src/config/lateWords.js`).

The first five are `src/src/config/gameTypes.js`, the single source of truth for types.
Build Room and Event are named in `src/src/config/engagementKinds.js`. After each round
the AI (named Workie on screen) writes a summary of what the room said. Every session
produces a report; a saved report is kept 90 days or a year.

## Environments

| Tier | Site | Stack |
|---|---|---|
| dev | https://engage.dev.seibtribe.us | `engagedev` |
| test | https://engage.test.seibtribe.us | `engagetest` |
| prod | https://engage.seibtribe.us | `engageprod` |

The pipeline is the only way to deploy, one CodePipeline per tier, and prod stops at the
owner's approval gate. There is no hand-deploy script. **Read the first two sections of
`CLAUDE.md` before you push**: they say what starts a deploy and who may start one.
`DEPLOYMENT.md` covers what a pipeline run does and how to recover from a broken one.

## Architecture

- **Frontend**: React, built with webpack, served from S3 and CloudFront.
- **Backend**: Node.js Lambda functions behind API Gateway, plus a WebSocket API for live updates.
- **Data**: DynamoDB, one table. See `docs/architecture/data-model.md`.
- **Auth**: Cognito. Hosts sign in with email or Google; players never sign in.
- **Infrastructure**: one SAM template, `template-clean.yaml`, parameterised per tier.

```
src/src/              React app (host stage, player screens, console, marketing pages)
src/src/config/help/  the in-app help guides, as data
src/public/           static files, including the Build Room plugin (engage-mcp.mjs)
lambda-functions/     game, websocket, admin, auth and archive handlers
tests/                backend tests, one standalone node script per file
cicd/                 the pipeline stack (applied by hand, not by a pipeline)
docs/                 design notes, specs, handoffs, architecture
```

## Running the tests

```bash
# Backend: standalone node scripts, no jest. Judge each by its exit code.
node tests/<file>.js

# Frontend
cd src
npm test
npm run lint
npm run build
```

`npm start` in `src/` runs a local dev server against the dev API.

`npm run build` first runs `scripts/build-repo-prompts.js` (the `prebuild` script), which
copies the repo's prompt files — `demo-sets/*.prompt.json`, `prompts/tier-defaults/*.prompt.json`
(the per-game-type defaults first curated on a tier) and `lambda-functions/admin/default-ai-prompts.json` — into `src/src/config/repoPrompts.json`.
The admin Prompts library compares each live prompt with that file ("Repo has a newer
version") and its Review saves the repo's text as a new prompt version. The output is
committed: after editing a prompt file, run `node scripts/build-repo-prompts.js` and commit
both, or `tests/repo-prompts-fresh.js` fails. Every prompt save is a version; see
`lambda-functions/admin/shared/prompt-versions.js`.

To do that Review → Save for every prompt on a tier at once, after the deploy has landed:

```bash
aws sso login --profile adminaccess
AWS_PROFILE=adminaccess node scripts/apply-repo-prompts.js --tier test --by you@example.com
AWS_PROFILE=adminaccess node scripts/apply-repo-prompts.js --tier test --by you@example.com --apply
```

It runs the real list and update handlers locally with the tier's Lambda environment, skips
prompts edited on the tier since they came from the repo (`--include-edited` to replace
them), and checks each saved prompt now matches. Prod also needs `--confirm-prod`.

## The Build Room plugin

A Build Room connects the host's Claude Code to the room through a Claude Code plugin.
Each tier serves its own: `engage` on prod, `engage-test` on test, `engage-dev` on dev,
so a laptop can hold more than one. The host installs it from the room's Connect window,
which shows the command to run in a terminal; the laptop needs Node 18 or later and git.
The plugin's source is `src/public/engage-mcp.mjs`; `tests/engage-plugin.js` and
`tests/engage-mcp.js` cover it, and `tests/engage-lan-gateway.js` runs its Wi-Fi share
against a real app. Share demo opens only the pages Claude linked (never a folder
listing); a project can name its demo and mockups in `.engage/share.json`, and each
session takes its Wi-Fi ports from a block set by its code (`ENGAGE_LAN_PORT` overrides). **Remote share** (off by default) opens the demo to people who are not on the Wi-Fi: the plugin runs a pinned, hash-checked `cloudflared` quick tunnel per session behind a key per person (design `docs/superpowers/specs/2026-10-16-build-room-remote-share-design.md`; `tests/engage-remote-gateway.js`, `tests/engage-cloudflared-fetch.js`).
Bump the plugin's `VERSION` with any change to it (`tests/engage-plugin-version.js`).

**Question sets in a Build Room** (plan `docs/superpowers/plans/2026-10-22-build-room-question-sets.md`):
Ask the room's ready questions list every Call & Answer or Poll set tagged `build-room`,
ordered by a `for-<kind>` tag once the room has said what it is making; Engage's starter sets
for a training site, game, document and dashboard are installed per tier with
`scripts/install-build-room-kind-sets.sh <table> --apply`. The opening's steps also follow the kind
(`build-store.js` `OPENING_BY_KIND`). **Ask Claude for
questions** (plugin 1.26.0) has Claude write a set into the project
(`build-room/questions/<kind>-<name>.json`), commit it and send it (`POST build/question-sets`,
kept as `BUILD#QSET#` rows, sealed for teams); **Save to my sets** turns it into AI drafts
through `POST /admin/generation-drafts/from-build`, which the host accepts from the bell.
An unsaved set puts a quiet entry in the host's bell that turns into a reminder two days
before the session ends (#45; `notifications.js`, copied identically into `game/`).

A Build Room's **room's window** is `/present?gameId=…&type=build&k=…` (opened from
Room's window ↗ on the host's header, or Two screens in "Where will the room watch?"; the
choice is `engage.surfaces`, shared with Call & Answer): public, read-only, no names
(`src/src/present/buildwall/`, read `GET …/build-play/wall`). Claude's posts and
screenshots reach the room only after the host releases them from the queue
(`POST …/build/posts`; the `reviewAgentPosts` setting, on by default). On two screens the laptop is the console (`buildroom/BuildConsole.jsx`, `buildConsole.js`,
reusing `components/console/*`). **Consider** (`POST …/build/consider`, `BuildConsider.jsx`)
queues an item for the room or sends it to Claude with a `why`; `sentMarks.js` marks what
reached Claude and links each mark to its History entry. What went to Claude last
(`sentView` in `build-store.js`) leads the Stage, the room's window and phones until the
next ask opens (`screens/SentStage.jsx`); a send with `hideFromRoom: true` reaches Claude
word for word, but every room read carries it with no words. The host's live typing
reaches the room's window only over a same-browser `BroadcastChannel`
(`buildroom/typingMirror.js`), never through the server or the socket.

Every Workie read is checked after writing (`lambda-functions/game/read-check.js`): numbers
not in the material, claims the vote does not support, next steps written as decided and
generic filler trigger one rewrite (`get-ai-summary.js`); what remains is stored as
`ReadCheck` and shown to the host only (`GET …/ai-summary/host`).

What every room screen shows, per moment and room screen size, is decided in one place:
`src/src/config/roomContent.js`: the title and the lesson lead, the question goes in "Your turn", voting shows every answer and results put the bars behind the answers (mockup: `docs/design/room-content-v2/`). Call says more.

## Documentation

- **Users**: the help guides inside the app. Every private screen has a **?** that opens
  the guide section for that screen; `/help` on the site has them all, with `#section`
  links. The content is `src/src/config/help/`, one file per area; `screens.js` maps each
  screen to its section. Never on a screen the room sees. Rules and the area map:
  `docs/help-refresh/STRUCTURE.md`. Checks: `helpContent.test.js`, `helpGuardrails.test.js`
  (retired words, labels, length) and `helpScreenWiring.test.jsx`; before a push to test,
  `node scripts/help-drift.js` lists guides whose code changed since they were written.
- **Reviewers**: `RELEASE_NOTES.md`, one entry per push to test: what changed, what was
  fixed, and what to look at. It is updated before every push to test, with the help
  and this README.
- **Engineers**: `CLAUDE.md` (deploy rules, environments), `DEPLOYMENT.md`,
  `docs/architecture/` (API, data model, auth), and `docs/handoff/` for the latest state
  of work in progress.
