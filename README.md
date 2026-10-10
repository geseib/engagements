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

## The Build Room plugin

A Build Room connects the host's Claude Code to the room through a Claude Code plugin.
Each tier serves its own: `engage` on prod, `engage-test` on test, `engage-dev` on dev,
so a laptop can hold more than one. The host installs it from the room's Connect window,
which shows the command to run in a terminal; the laptop needs Node 18 or later and git.
The plugin's source is `src/public/engage-mcp.mjs`; `tests/engage-plugin.js` and
`tests/engage-mcp.js` cover it.

## Documentation

- **Users**: the help guides inside the app (the Help button, and `/help` on the site).
  Their content is `src/src/config/help/`; `src/src/__tests__/helpContent.test.js` checks it.
- **Engineers**: `CLAUDE.md` (deploy rules, environments), `DEPLOYMENT.md`,
  `docs/architecture/` (API, data model, auth), and `docs/handoff/` for the latest state
  of work in progress.
