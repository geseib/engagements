# Running the agentic-SDLC session — what is still required

**Status: NOT runnable yet.** Everything is authored, tested and committed. Nothing
is installed to a live table and nothing is deployed. This is the gap, in order.

Every `--apply` below writes to a live environment, and every deploy is a tag push.
Per `CLAUDE.md` both are the owner's to run. Nothing in this repo does either for you.

---

## What exists, and where it stops

| Artefact | State |
|---|---|
| `sets/agentic-sdlc-call-and-answer.csv` | file in the repo. **Not installed** to any table. |
| `sets/prompt-callandanswer-workie-advisor.json` | file in the repo. **Not installed** — no DynamoDB pointer, no S3 body. |
| `session-advisor` persona | in the `SEED_PERSONAS` array in `personas.js`. **Not seeded** to DynamoDB. |
| The two AI fixes (`consensusLevel`, `votesGiven`) | committed on `claude/handoff-doc-review-78cj8d`. **Not deployed** to any tier. |

A host opening the app today sees none of this.

---

## Step 0 — decide the tier, and land the code

Everything below is **per tier**. `engagedev`, `engagetest` and `engageprod` are three
separate tables and three separate prompt buckets; installing into one does nothing
for the others.

The code fixes have to reach that tier first, or the session runs with the bugs the
dry run just removed — `{consensusLevel}` reporting *"No votes cast"* on every round,
and `votesGiven` at 0 for everyone in the report.

1. Merge `claude/handoff-doc-review-78cj8d` into `dev`.
2. Push a `dev-v*` tag. **A tag is the deploy** — a branch push is not (see
   `DEPLOYMENT.md`; confirm which rule is live with
   `aws codepipeline get-pipeline --name engagecicd-pipeline-dev --query 'pipeline.triggers'`).

---

## Step 1 — seed the persona

The set's install pre-flight refuses a persona that does not exist, so this comes
first.

```bash
AWS_PROFILE=adminaccess node scripts/seed-personas.js engagedev            # dry run
AWS_PROFILE=adminaccess node scripts/seed-personas.js engagedev --apply
```

Never overwrites without `--overwrite`, so it is safe to re-run.

**Verify:** the output names `session-advisor`. If it does not, the deploy in step 0
did not include the `personas.js` change.

---

## Step 2 — install the advisor prompt

```bash
AWS_PROFILE=adminaccess node scripts/install-ai-prompt.js \
  engagedev engagedev-ai-prompts \
  sets/prompt-callandanswer-workie-advisor.json            # dry run
# then the same line with --apply
```

**Why this script and not the console.** A prompt is two records in two stores — a
pointer at `PK=AIPROMPTS / SK=AIPROMPT#<id>` carrying an `s3Key`, and the body in the
bucket. A pointer whose S3 object is missing is **not a loud failure**:
`get-ai-summary.js` falls through to `buildFallback()` and the round gets canned text
with no Bedrock call and nothing in the logs. That exact state was found live on
engagedev with trivia and poll both dead. This script verifies both halves landed.

### ⚠️ Read this before `--apply`: it changes every call-and-answer session

The prompt ships `isDefault: true` with `category: 'lessons-learned'`, and
`PREFERRED_DEFAULT_CATEGORY['call-and-answer']` is `'lessons-learned'` — so it wins
the default tie-break and becomes the summary prompt for **every** call-and-answer
set in that tier, not just this one.

That may be what you want. If it is not, there are two safer routes:

- **Attach it to this set only.** The `SETS` row carries a `promptId` field ("AI
  summary prompt" in the editor), and clearing it falls back to the game-type
  default. Install the prompt with `isDefault: false`, then set `promptId` on the
  agentic-SDLC set — the set editor's Details tab does this, or the same
  `UpdateCommand` the install script already uses for `--persona`.
- **Install to `engagedev` only** and leave test/prod on the existing default until
  a real room has run it.

**Recommendation: attach it to the set.** Nothing about this prompt has been
confirmed on Haiku 4.5 yet (see "What is still unknown"), and making it the tier-wide
default puts an unvalidated prompt in front of every existing call-and-answer set.

---

## Step 3 — install the question set

```bash
node scripts/install-question-set.js engagedev sets/agentic-sdlc-call-and-answer.csv \
  --type call-and-answer --title "Agentic SDLC"                       # dry run, NO credentials needed
```

The dry run parses the file for real and reports skipped rows. Expect
`questions: 6, categories: 6, rows that would be written: 13, skipped: 0`.

Then, with credentials:

```bash
AWS_PROFILE=adminaccess node scripts/install-question-set.js \
  engagedev sets/agentic-sdlc-call-and-answer.csv \
  --type call-and-answer --title "Agentic SDLC" \
  --persona session-advisor \
  --quickstart \
  --apply
```

- `--persona session-advisor` sets the voice. Without it the round falls to the
  adaptive default, and the advisor's voice — which is half of what was designed —
  is simply absent.
- `--quickstart` puts it in the host's Quickstart menu. Drop it if you would rather
  it only appear in the full picker.
- The importer writes neither of those itself; the script applies them after.

---

## Step 4 — verify before a real room sees it

```bash
# the set exists, is active, and carries its persona
AWS_PROFILE=adminaccess aws dynamodb get-item --table-name engagedev \
  --key '{"PK":{"S":"SETS"},"SK":{"S":"SET#agenticsdlc"}}' \
  --query 'Item.{active:active.BOOL,persona:personaId.S,type:engagementType.S,q:questionCount.N}'
```

Then **host one round yourself** before handing it to anyone. The single thing worth
watching: after the first round closes, does the results screen show a real advisor
report with four sections, or the generic fallback? If it is the fallback, the prompt
body did not land — go back to step 2.

Nothing in the dry run can tell you this. It is the one check that requires the real
Bedrock call.

---

## What is still unknown, and should be said out loud to whoever runs it

The dry run established that the mechanics work and the question set holds up on its
text. It did **not** establish that the report is good, and the reasons are recorded
in `docs/superpowers/reviews/2026-08-11-agentic-sdlc-dry-run-hypothesis.md` §D:

1. **The report has never run on Haiku 4.5.** The simulation ran on Opus. Four of the
   report criteria (names a disagreement, assignable next steps, the load-bearing
   minority, legible to an outsider) are recorded as *satisfied on Opus, unconfirmed
   on Haiku*. Production is Haiku at `max_tokens: 1024`. **The first real session is
   the first test of this.**
2. **Three prompt rules arrive damaged.** Rules 4, 5 and 10 name variables in prose,
   and substitution inlines their values — rule 10 renders as *"If 11 is 0"*. Opus
   read through it; a smaller model may not. This is open defect D2.
3. **The advisor cannot see the round's own `CustomInstruction`** (D6). In the
   simulated round 3 a player explicitly refused their round's instruction and the
   advisor had no way to know.
4. **Nobody has watched this on a projector.**

None of these block a first run on `engagedev`. All of them are worth saying to the
first host, so a poor report is read as data rather than as a surprise.

---

## If you want the rehearsal instead of the room

The whole session replays offline, deterministically, with no AWS and no Bedrock:

```bash
node scripts/simulate-session.js
```

That is the cheapest way for someone to see what the set and the advisor do before
committing a real room to it.
