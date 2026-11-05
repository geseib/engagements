# Handoff, 5 Nov 2026: player identity, the noise review, and what needs AWS

Written for an agent that has AWS access (this session had none: no `aws` credentials,
and the network proxy refuses `*.amazoncognito.com` and real Lambda calls).

## Where things stand

| | Commit | State |
|---|---|---|
| `dev` | `9149c060` | **Pushed 5 Nov as a branch push (no tag). The pipeline run was NOT verified.** |
| `working/optimistic-newton-c76s3n` | this doc on top of `9149c060` | pushed; continue from here |
| `test`, `prod` | untouched | nothing here has been on test |

First thing to do with AWS access:

```bash
aws codepipeline list-pipeline-executions --pipeline-name engagecicd-pipeline-dev --max-items 3
aws codepipeline get-pipeline --name engagecicd-pipeline-dev --query 'pipeline.triggers'
```

Confirm an execution for `9149c060` Succeeded, then look at https://engage.dev.seibtribe.us
(NOT eng.dev — see CLAUDE.md). If the triggers have come back tags-only, the CLAUDE.md
deploy section needs rewriting and the branch push did nothing.

Gates the `dev` push passed (on exactly `9149c060`):
- frontend: 717/717 suites, `npm run lint` 0 errors, `npm run build` ok,
  `node scripts/drift-baselines.js` every allowance matches;
- backend: 389/395 `tests/*.js` pass once the undeclared packages below are installed. The
  6 that fail fail identically on `bee91ab9` (the previous dev) — see "Backend tests".

## What shipped to dev (bee91ab9..9149c060), one line each

1. `316f5408` PlayersList deleted; People rows are `components/people/PersonRow` everywhere.
2. `95e3133c` **Event join identity** (owner: "a new name is ignored and the previous name is
   used"). The attendee token lived only in localStorage, so every tab and every person on a
   browser resumed as the last attendee. Now `utils/attendeeApi.js` keeps this tab's identity in
   sessionStorage too; a new tab with only the browser's copy is asked "Are you Ges?" (Continue /
   I'm someone else) in `components/event/EventAttendeePage.jsx`; `/play`'s form carries a typed
   name as `?name=`. Also the **laptop answer screen** is two columns at ≥1024px landscape
   (`PlayerShell wide`, `PlayerSurface.css` §2b, `hooks/useMediaQuery.js`).
3. `11cdc13a` One-screen People show/hide is remembered for the session
   (`PrivateReveal remember`, key `engage.reveal.<gameId>.people`); the phone-remote QR is 256px
   with a 4-module quiet zone (Google Lens could not read the old 160px one).
4. `37faa34f` Google sign-out really reaches Cognito `/logout` (callers' own navigation used to
   cancel it); "Use a different Google account" link on the sign-in form.
5. `26b2649e` Console "Took 10:30:37" fixed: the phase already under way at page load is not
   treated as witnessed.
6. `5f670f4f` `docs/design/host-attention/PLAN.md`: the trace of every count on the console and
   the `roomProgressFor` design.
7. `4d4b9971` + `9149c060` **The nine noise cuts** the owner approved from the review
   (https://claude.ai/artifact/5Uo139hztJTChZXyHwEaAB):
   - phone: question is the headline, brief is body; vote screen is question line → ballot,
     Detailed vote is a link; lobby's recovery card is a "Lost this page?" disclosure;
   - console: one room tile from `config/roomProgress.js` (`roomProgressFor`) with "Waiting on …"
     names (≤6, else a count; away listed apart); calm Needs-you is a quiet line, amber only when
     something waits; People rail sorts outstanding first, ⋯ on hover/focus (always on touch),
     Score and "Late & not reviewed" hidden until they have content; Room's window is one
     control; Ask/Scores steps only once reachable; Skip this round behind a ⋯;
   - one screen: the calm Needs-you line and "Goal n" are not projected.

## Open items, in the order I would do them

### Needs AWS (the reason for this handoff)

1. **Verify the dev deploy** (commands above). Then drive it on engage.dev with two browsers.
2. **Safari cannot pick a different Google account.** Root cause (AWS docs, authorization
   endpoint): `prompt=select_account` is forwarded to the IdP only by *managed login*, not the
   classic hosted UI, and `UserPoolDomainV2` in `template-clean.yaml` (~line 7004) sets no
   `ManagedLoginVersion`. Check first:
   ```bash
   aws cognito-idp describe-user-pool-domain --domain engagedev-auth-v2 \
     --query 'DomainDescription.ManagedLoginVersion'
   aws cognito-idp describe-identity-provider --user-pool-id us-east-1_7VC2YyGnU --provider-name Google
   ```
   Fix (template, deploy dev first, owner's call because the sign-in pages change look): set
   `ManagedLoginVersion: 2` on `UserPoolDomainV2` and add an `AWS::Cognito::ManagedLoginBranding`
   (`UserPoolId`, `ClientId: !Ref UserPoolClient`, `UseCognitoProvidedValues: true`); without the
   branding resource managed-login pages error. Verify with `curl -sI` on the authorize URL with
   `identity_provider=Google&prompt=select_account`: `Location` should go to accounts.google.com
   carrying `prompt=select_account`.
3. **Backend tests in the pipeline.** `buildspec-dev.yml` runs only the frontend suite, so a
   backend break deploys unchecked. Proposed: install the packages below and run `tests/*.js`,
   skipping the six that need AWS or a browser. Not done; ask the owner.

### Needs the owner's eyes on dev

4. One screen still has two host rows (top bar + Your part now). The host agent kept them so the
   main button stays where it is on two screens. Owner may want them merged.
5. The phone's quick vote is three dropdowns ("Choose a response…"), so responses are not
   readable without opening one, and the dock repeats 1st/2nd/3rd. Obvious next cut.
6. New privacy line on the vote screen: "Only names are hidden, from the host too, until voting
   closes." (was "This hides names, not identities."). Owner to confirm the wording.
7. The QR change is untested with Google Lens.

### Known gaps in code

8. The host's vote count resets to 0 on a reload during/after voting (`GameHostPage.jsx`, vote
   count held only in page state). After the round a 0 is left out rather than shown wrongly.
   Real fix: the backend returns voter ids/counts at Results.
9. The room's follow-up "Ask" step shows "1 still answering", not names: the server sends a count.
10. The People rail computes "outstanding" with its own check, not `roomProgressFor`.
11. Before any push to **test**: RELEASE_NOTES.md entry, in-app help, README (CLAUDE.md
    "Before every push to test"). Help was updated with each change; the notes and README were
    not.

## Tools left behind

- **Screenshots of the real app against a fake API** (no AWS, no login):
  `scripts/qa-shots/harness.js` (+ `fake.js` scenario data, `jobs.js` shot list, `contact.js`).
  ```bash
  cd src && npm run build && cd ..
  node scripts/qa-shots/harness.js            # all shots + contact.html
  node scripts/qa-shots/harness.js --only host-04
  ```
  Output goes to `$SHOTS_OUT` (default `<tmpdir>/engage-shots`). Host auth is faked with unsigned
  Cognito tokens in localStorage; the WebSocket is answered locally so pages are not "offline".
  Shots: host lobby/answering/voting/results at 5 and 15 people, one-screen host, `/present`,
  participant phone (iPhone 15) and laptop for join/lobby/answer/sent/vote/results.
- **The review page** with before-shots and the nine cuts:
  https://claude.ai/artifact/5Uo139hztJTChZXyHwEaAB (owner's account, private).

## Backend tests: the environment they need

395 standalone scripts (`node tests/<file>.js`, judge by exit code). A fresh checkout lacks the
Lambda packages; install them all in ONE command (a second `npm install --no-save` prunes the
first):

```bash
npm install --no-save --no-audit --no-fund axios jwk-to-pem uuid jsonwebtoken \
  @aws-sdk/client-cognito-identity-provider @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb \
  @aws-sdk/client-lambda @aws-sdk/client-apigatewaymanagementapi @aws-sdk/client-bedrock-runtime \
  @aws-sdk/client-s3 @aws-sdk/s3-request-presigner @aws-sdk/client-ses @aws-sdk/client-sesv2 \
  @aws-sdk/client-ssm @aws-sdk/client-kms @smithy/signature-v4 @aws-crypto/sha256-js
npm ci --prefix scripts/ci          # esbuild, for tests/ci-bundle-lambdas.js
for f in tests/*.js; do timeout 60 node "$f" >/dev/null 2>&1 || echo "FAIL $f"; done
```

Expected failures without AWS (identical on `bee91ab9`): `generated-set-creation.js`,
`poll-generation-job.js`, `question-generation-job.js`, `scenario-generation-job.js`,
`survey-generation-job.js` (they dispatch a real Lambda and hang) and
`verify-question-set-ui.spec.js` (a Playwright spec, run with `npx playwright test`).

Frontend: `cd src && CI=true npm test -- --watchAll=false --maxWorkers=2`. Some files fail when
run ALONE (e.g. `presentationSlidesStage`, `playerNameMove`) but pass in the full run; judge by
the full run.
