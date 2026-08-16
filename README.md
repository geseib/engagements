# Engagements Platform 🎯

A serverless, real-time platform for running interactive sessions — trivia, polls, open-answer
discussion and word-association rounds — in a meeting room or on a video call. Players join by
scanning a QR code. Nobody installs anything and nobody but the host signs in.

## 🚀 Live environments

| Env | Site | Stack | Pipeline |
|---|---|---|---|
| **dev** | https://engage.dev.seibtribe.us | `engagedev` | `engagecicd-pipeline-dev` |
| **test** | https://engage.test.seibtribe.us | `engagetest` | `engagecicd-pipeline-test` |
| **prod** | https://engage.seibtribe.us | `engageprod` | `engagecicd-pipeline-prod` |

> Every URL and pipeline name in this section was wrong until 2026-08-16. The sites listed
> (`engagedev.sb.seibtribe.us` and friends) do not resolve and never did, and the pipeline names
> were `engagements-cicd-*-pipeline` rather than `engagecicd-pipeline-*`. Verify against live AWS
> rather than trusting this table:
>
> ```bash
> aws cloudfront list-distributions \
>   --query 'DistributionList.Items[].{Alias:Aliases.Items[0],Origin:Origins.Items[0].DomainName}' \
>   --output table
> ```
>
> Note also that `eng.dev.seibtribe.us` is **not** the dev site. It is the retired off-pipeline
> `engdev` stack, frozen at a July 2026 bundle. See `DEPLOYMENT.md`.

## 🔄 Deploying

**`DEPLOYMENT.md` is the single source of truth.** It is accurate; this section is a summary and
deliberately does not restate its tables, because duplicating them is how the ones above came to
be wrong.

- **A push to `dev`, `test` or `prod` deploys that tier.** So does a `<tier>-v*` tag. Both
  trigger, so do one or the other — never both for the same commit.
- **`main` has no pipeline** and triggers nothing.
- **prod halts at a manual approval gate** (`ApprovalForProd`) and goes no further without a human.
- The `eng*` / `engdev` stacks are an off-pipeline duplicate being retired. `./deployall`,
  `scripts/deploy-clean.sh` and `scripts/deploy-frontend-eng.sh` target those, **not** the CI/CD
  tiers.

## 🏗️ Architecture

- **Frontend** — React SPA, WebSocket for live updates, built with webpack, served from S3 +
  CloudFront.
- **Backend** — AWS Lambda (Node.js) behind API Gateway, plus a WebSocket API.
- **Database** — DynamoDB, single-table design (`GAME#`, `PLAYER#`, `GAMES` key prefixes).
- **Auth** — Cognito. Hosts and admins sign in; players never do.
- **Infrastructure** — one SAM template, `template-clean.yaml`, parameterised per tier.

## 📁 Layout

```
engagements/
├── src/src/                 # React frontend
│   ├── config/help/         # the in-app help corpus (see below)
│   └── components/          # UI
├── lambda-functions/        # game, admin, websocket, auth, archive handlers
├── cicd/pipeline-clean.yaml # the CodePipeline stack (applied by hand, not by a pipeline)
├── template-clean.yaml      # the application infrastructure
├── DEPLOYMENT.md            # canonical deployment guide
└── docs/                    # design notes, specs, reviews
```

## 🎮 Engagement types

Derived from `src/src/config/gameTypes.js`, which is the single source of truth — do not add a
type here without adding it there.

| Type | What it is | Phases |
|---|---|---|
| **Call & Answer** | Open responses, then the room votes on the best ones. | ASK → VOTE → RESULTS |
| **Trivia** | Multiple choice with one correct answer and a scoreboard. | ASK → RESULTS |
| **Poll** | Gauge opinion — no right answer, distribution is the result. | ASK → VOTE → RESULTS |
| **Wavelength** | Word association — the room converges on a shared cloud. | ASK → RESULTS |
| **Survey** | Structured multi-question feedback. **Not playable** — the importer rejects survey uploads, so a survey set can be authored but never run. | ASK → VOTE → RESULTS |

> The list this replaced named "Prioritization", a type that does not exist anywhere in the
> codebase, gave Surveys as a working feature, and omitted Wavelength entirely.

## 📚 Documentation

**User-facing documentation lives in the app**, not in this repo — the help modal, reachable from
the player screen's header, the host session panel's Settings tab, and the admin console header.
Its content is `src/src/config/help/`, as data: five roles, nineteen guides.

It is written as data rather than as components so that the table of contents can be *derived*
from it. The previous help system hand-wrote a contents listing 18 guides and a `switch` that
could render 2; the other 16 opened a box saying the documentation was "currently under
development". `src/src/__tests__/helpContent.test.js` now asserts that every advertised guide
exists, carries real prose, and only uses placeholders that exist in the template catalogue.

Engineering notes are in `/docs`. `DEPLOYMENT.md` covers deployment; `DATABASE_DESIGN.md` and
`API_DOCUMENTATION.md` cover the data and API layers.

## 🧑‍💻 Getting started

```bash
git clone https://github.com/geseib/engagements.git
cd engagements/src
npm install

npm start          # dev server
npm test           # jest suite
npm run lint       # eslint
npm run build      # production bundle
```

Backend tests run from the repo root with `node tests/<file>.js`.

To ship a change: work on a branch, get the suites green, then push to `dev` — which deploys it.
Read `DEPLOYMENT.md` first; a branch push to a tier branch is not a way to share code.
