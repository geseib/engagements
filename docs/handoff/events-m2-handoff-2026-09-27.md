# Handoff — Events M2 (attendees join an event), 27 Sep 2026

This hands the work to a new instance, such as a cloud session. Read `CLAUDE.md` first: its deploy rules
at the top are binding.

## Where things stand

| Tier | Head | What is on it |
|---|---|---|
| **dev** | `61bf416b` | Everything below. |
| **test** | earlier bug-sweep merge | NOT the feature sweep, the walk-through, `\`, M1, M1b or the category fix. |
| **prod** | unchanged today | halts at the owner's gate |

What is on dev, oldest first:
- the 26 Sep bug sweep and feature sweep;
- the survey walk-through (`6076134b`);
- the `\` key that opens the Session panel (`0a58a5df`);
- Events M1 (`8abe3d83`);
- Events M1b (`a7c29924`);
- the item-dialog category-chip fix (`61bf416b`).

`EVENTS_ENABLED` is `!If [IsDev,'on','off']` (template Globals), so Events exists on dev only. The owner
created event **1124** on dev.

**Asked of the owner and not yet answered:** promote dev to test? The recommendation is to merge dev as
it was before events (`0a58a5df`), or the current head with the events code carried but switched off.
Test is MERGED into, never fast-forwarded.

## The job: Events M2

The owner's words: *"start M2 so attendees can join event 1124"*, then *"go ahead, and show the joined
count in the builder"*.

- **Spec.** `docs/superpowers/plans/2026-09-26-events-roadmap.md` §4 M2, with §3, §5 and §6. The
  mockups are the design: `docs/design/agenda-redesign/10-join.html`, `p-05a-before.html` and
  `p-05-agenda.html` (serve that folder and look).
- **Requirements and the controller's binding rulings.** They are in
  `docs/superpowers/plans/2026-09-27-events-m2-requirements.md` (this branch). They include the owner's
  "joined count is required" addition. The owner approved them as described:
  - opaque random token, hashed at rest, no new secret;
  - sealed attendee name;
  - joining is not billed;
  - open events only;
  - polling, not WebSocket;
  - phone, tablet and laptop layouts;
  - no new Lambda function.
- **No plan exists yet.** The plan drafter stalled before saving one.

**The drafter's trial code** is on branch **`wip/events-m2-trial`** (based on `a7c29924`). It is
UNREVIEWED and UNGATED.

| Commit | What it holds | State |
|---|---|---|
| `e2449128` | T1+T2: `events/attendee-store.js`, `events/attendees.js`; `POST /events/{code}/attendees` and `GET /events/{code}/me` as routes on the EXISTING agenda function; `tenant-crypto` `attendee` entity (three copies); tests `event-attendee-token.js`, `event-attendees.js` | its own suites pass |
| `27ced927` | T3: attendee rows follow the event (a date move rewrites their ttl; delete removes them), `tests/event-attendee-lifecycle.js` | passes |
| `e2077a68` | T4: `useJoinCode`, `PlayerPage` and `utils/joinCode.js` learning event codes | **half-written, redo it** |

Review items for the trial:
- The agenda function's policy went from `DynamoDBReadPolicy` to `DynamoDBCrudPolicy`, because the
  PUBLIC agenda function now writes attendee rows. Justify or narrow it.
- Check the count/row ordering and rollback in `attendees.js`.
- Check that a switched-off tier and an unknown code give the same 404.

### Recommended next steps

1. Write the plan with the superpowers `writing-plans` skill, from the requirements file. The plan must
   carry the Decisions section, a routes delta and a file map. Model it on
   `docs/superpowers/plans/2026-09-26-events-m1b-richer-agenda.md`. Reuse the trial code where it
   survives review.
   - Task order: attendee store and token → routes → the event lifecycle → the player join resolver
     (session joins, the survey share link and the remote's "Enter a different code" must NOT break;
     regression tests first) → the attendee shell (p-05a, p-05) → reload and "Not you?" → the builder's
     "N joined" (required) and the Events list count.
2. Execute maker/checker (superpowers `subagent-driven-development`): one implementer per task, a task
   review, fix rounds, then a final whole-branch review, one fix wave and a re-review.
3. Merge `origin/dev` into the branch first. It has `61bf416b` on top of `a7c29924`.
4. Run the full gate (below), then push to `dev`: the BRANCH, never also a tag. Confirm it is live.
5. Walk it: join 1124 at 375, 768 and 1280 widths; reload; "Not you?"; check the builder's count.

## Running the suites (fresh checkout)

- **Installs.** In a fresh clone, run `npm install` in `lambda-functions/` and `src/`. The backend
  tests also need packages `lambda-functions/package.json` does not declare. Install them in ONE command
  with `--no-save`:

  ```bash
  npm install --no-save @aws-sdk/client-s3 @aws-sdk/client-cognito-identity-provider \
    @aws-sdk/s3-request-presigner @aws-sdk/client-kms @aws-sdk/client-cloudwatch \
    @aws-sdk/client-sesv2 @aws-sdk/client-sns @aws-sdk/client-ssm jsonwebtoken jwk-to-pem axios
  ```

  - Derive the current list rather than trusting this one:

    ```bash
    git grep -hoE "(require|stub|moduleStubs\.set)\(['\"]((@aws-sdk/|@?[a-z][a-z0-9-]*)[^'\"]*)['\"]" -- tests | grep -oE "'[^']+'" | tr -d "'" | grep -v '^\.' | sort -u
    ```

  - A second `--no-save` install prunes the first one's packages.
  - Never `npm install` into an already-populated worktree: it prunes. Stage into a temp prefix and
    `rsync --ignore-existing` instead.
- **Backend.** Standalone scripts, judged by exit code and suite count; skip `*.spec.js` (Playwright):

  ```bash
  rm -rf .aws-sam lambda-functions/dist lambda-functions/admin/.aws-sam
  pass=0; fail=0; for f in tests/*.js; do case "$f" in *.spec.js) continue;; esac; node "$f" >/dev/null 2>&1 && pass=$((pass+1)) || { fail=$((fail+1)); echo "FAIL $f"; }; done; echo "suites=$((pass+fail)) fail=$fail"
  ```

- **Frontend, lint, build:** `cd src && npm test`, then `npm run lint` (0 errors; 10 warnings is the
  baseline), then `npm run build`. Never `npx jest`.
- **API doc:** `node scripts/generate-api-doc.js --check`. Regenerate it with the same script when
  routes change.
- **Baselines at dev `61bf416b`:** backend 261 suites, 0 failed; frontend 388 suites, 9403 tests; api.md
  164 routes.
- **Traps:**
  - `git add` new files before the backend loop (`tests/no-retired-twin-references.js` reads
    `git ls-files`).
  - Never write the twin guard's banned deploy phrases in any tracked file. Say "nothing is deployed".
  - The pipeline runs jest on Node 18, so no Node 20+ APIs.
  - Copies that must stay identical, each held by a guard test: `tenant.js`, `tenant-crypto.js`,
    `session-ttl.js`, `set-version.js`, `session-goal.js`.
  - Nothing outside `tenant.js` writes a bare partition literal.
  - The stack is at about 440 of CloudFormation's 500 resources: add routes to existing functions, never
    new functions.

## Watching a deploy

- **Pipeline:** `AWS_PROFILE=adminaccess aws codepipeline list-pipeline-executions --pipeline-name
  engagecicd-pipeline-dev --max-items 3`. SSO expires; the owner runs `aws sso login --profile
  adminaccess`.
- **Without AWS:** the dev bundle `https://engage.dev.seibtribe.us/bundle.js` changes its ETag. A new
  route flips from `{"message":"Not Found"}` to the app's own answer or a 401.

## Open with the owner (not blocking M2)

- Promote dev to test (see above).
- Two stage choices, each a one-line change if the owner objects:
  - the goal notice sits in the stage's dock line, where the room can read it;
  - the custom kind is named "Activity".
- On the dev walk, check whether the 62-character goal notice wraps past two lines in `.dock .status`
  (at 1280 and on the Table profile).
- Carried into M3:
  - `delete-set-version` should warn about event items pinned to that version;
  - `clear-all-games` has a re-drawn stale-code edge;
  - M3 must refuse `decryptFailed` items before `sessionFormOf`;
  - the item → `createGameBody` mapping is in the M1b plan and pinned by `itemSessionMapping.test.js`.
- A separate session was started on "Add an ownership check to the session delete route" (a pre-existing
  hole: any host can delete any org's session through `POST /admin/clear-game/{gameId}`). Check `dev`
  for its result before merging.
- Before M3 and M4 code: the M0 mockups, and the owner's answers to roadmap D1–D5.
