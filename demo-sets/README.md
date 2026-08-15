# demo-sets — four call-and-answer demo sets, each with its own Workie

Four question sets built to be shown, not to be filed. Every one is a
**call-and-answer** set, every one declares a **round kind** deliberately, and
every one ships with a **1:1 analysis prompt** written for that round kind and
nothing else. The prompts are not variations on a house template — an Apply
round and a Judge round need different things read back to the room, and these
four say so.

Nothing here has been uploaded. Nothing here touches AWS. Everything has been
run through the real preflight and the real importer in-process; see
[Verification](#verification).

---

## The four sets

| Set | Round kind | Questions | Categories | Workie |
|---|---|---|---|---|
| Lessons from Different Schools | `apply` | 14 | 8 | The Transfer Reader |
| What We Should Be Known For | `produce` | 5 | 3 | The Direction Advisor |
| The Rules We Wrote Down | `improve` | 5 | 3 | The Redline Reader |
| Ready or Not | `judge` | 12 | 4 | The Verdict Board |

They pair up. Sets 1 and 3 are the same subject seen from opposite sides of the
**ownership** line that `lambda-functions/admin/shared/round-kinds.js` says is
the one distinction generators get wrong. Sets 2 and 4 are the same team
question at opposite ends of a decision: invention, then verdict.

### 1. Lessons from Different Schools — `apply`, 14 questions

Fourteen lessons curated from the eighty in the live `SET#lessons` set — two
each from Architecture, Law, Design, Psychology, Engineering and Medicine, one
each from Film and Culinary. The originals are Produce-shaped: they state a
principle and invite the room to reflect. These have been **rewritten as Apply
questions**, which is a different thing:

- The `Detail` now **carries the material and names its origin** — Christopher
  Alexander's *A Pattern Language*, Ron Mace at NC State, civil-procedure
  discovery, Deming, Edmondson's hospital-error study — because the room cannot
  apply what it has not been given.
- The ask is **the transfer and its friction**: where would this land here, and
  who or what would resist it. Never "what do you think of it".
- Every row carries a `SourceAttribution` cell. Nobody in the room wrote any of
  it, so nobody has to defend it, and the interesting answer is *"that would
  never survive contact with our release process."*

Categories are the schools, so a host can run one discipline or the lot.

### 2. What We Should Be Known For — `produce`, 5 questions

The business-advisor round for an engineering / architecture team: what our best
work actually is, what of it should go to market, and where to aim next. Five
questions across **Proof**, **Positioning** and **Direction**. `produce` is the
right kind and not a default — the room is handed a prompt and nothing else, and
every answer comes out of the room's own head. `Detail` is framing only and every
one sits inside the 350-character Produce ceiling, so no question smuggles in a
text to react to.

### 3. The Rules We Wrote Down — `improve`, 5 questions

The deliberate sibling of set 1, and the one that proves the distinction is real.
Same shape of round — a passage on screen, work to do on it — but the passage is
**ours**: an on-call handover step, a definition of done, a line in the code
review guide, the Alternatives Considered instruction in our ADR template, the
sentence on our team page. Each question **quotes the artefact verbatim** and
asks for the **replacement wording**, not a direction of travel. Its author is
probably in the room, so every question is about the text and never about the
person.

> **Before you demo this one, swap in your real wording.** The five artefacts are
> plausible house texts, not this company's. An Improve round is only honest when
> the words on screen are the words that are actually in the document — that is
> the entire difference between Improve and Apply. Edit the `Detail_lesson` cells
> and re-upload; nothing else changes.

**Why `improve` and not `apply`:** identical mechanics, opposite ownership. Apply
is safe because the material is foreign; Improve has an author in the room and
the interesting answer is the replacement sentence. A set that picked the wrong
one of these two would get the right-looking questions and the wrong round.

### 4. Ready or Not — `judge`, 12 questions

The deliberate sibling of set 2. Set 2 asks the team to invent its direction;
this one puts twelve things the team already has in front of it with an explicit
bar attached and asks for a **verdict, not a fix** — the demo, the architecture
diagram, the reliability figure we quote, the runbook for our noisiest alert, the
service only one person can change, the data model. Categories are the four bars:
**Ready to Show**, **Ready to Sell**, **Ready to Support**, **Ready to Scale**,
three questions each.

**Why `judge` and not `improve`:** a Judge round that collects fixes has collected
the wrong thing and the room never states its verdict. Every question here names
the thing *and* the criterion and closes on a yes/no, and the Workie is forbidden
from proposing a single repair. It is the round you run *before* anybody starts
mending anything — which is exactly what makes it a different session from set 2
rather than a longer one.

---

## The Workies

One per set, in `<set>.prompt.json`. Each is an **analysis** prompt in the
`instructions` + `outputFormat` shape the summary engine requires
(`get-ai-summary.js` accepts `template`, or `instructions` AND `outputFormat`,
and nothing else), plus a declared four-section `outputSections` shape.

What makes them 1:1 rather than four copies of one prompt:

| Workie | It hunts for | Its named failure mode |
|---|---|---|
| **The Transfer Reader** (apply) | Two lists the room made without noticing: *landing sites* and *resistance*. The resistance list is the thin one and the valuable one. | An answer that only judged the source material and never reached this organisation. |
| **The Direction Advisor** (produce) | Proof vs intent; the asset exactly one person named; the gap between what the team is proudest of and what it would lead with. | Answers that could have been written by any team in any company — and it is told to say so. |
| **The Redline Reader** (improve) | The winning wording, reproduced **verbatim**, plus the element every rewrite added that the original lacked. It is forbidden from composing any wording of its own. | An answer that gave a direction ("make it clearer") instead of words. |
| **The Verdict Board** (judge) | The three-way count — clears / does not / no verdict — the reason behind each side, and the fact cited on *both* sides, which means the room disagrees about the bar and not about the thing. | An answer that skipped the verdict and proposed a repair. And the prompt itself is barred from casting the deciding vote. |

All four share the same nine variables, each used **once**, each in field
position at the end of the prompt:

```
{eventTitle} {currentRound} {questionCategory} {questionInfo}
{responseCount} {voteCount} {scoringSystem} {consensusLevel} {responsesText}
```

`{responsesText}` is the one that carries what the room actually wrote; without
it a summary prompt has nothing to summarise, and `promptPreflight` blocks on
exactly that. Everything else is named in the rules by the **English label
printed beside it**, never by its token, because the substitution loop is a
global replace and a token used as a noun gets its value inlined into the middle
of the sentence.

Five catalogued variables are avoided on purpose — `{totalParticipants}`,
`{activeParticipants}`, `{topVotedAnswers}`, `{votingPattern}`,
`{resultsSummary}`. Each resolves cleanly and is wrong; see `UNSAFE_VARIABLES` in
`src/src/utils/promptPreflight.js`.

---

## Uploading

Two API calls per set, in this order, because the 1:1 binding is the set's
`promptId` attribute and you need the prompt's id before you can write it.

Both routes are real and both sit behind the Cognito authorizer
(`template-clean.yaml`): `POST /admin/ai-prompts` and `POST /admin/upload-questions`.
`authFetch` sends the Cognito **ID token** as `Authorization: Bearer …`.

```bash
# Dev. Swap the base URL for test or prod — see CLAUDE.md, and re-derive it
# rather than trusting any table.
API=https://ouv6fztlig.execute-api.us-east-1.amazonaws.com/dev
TOKEN=<your Cognito ID token>
```

### Step 1 — create the Workie

The `.prompt.json` file IS the request body; post it as-is.

```bash
curl -sS -X POST "$API/admin/ai-prompts" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @demo-sets/lessons-from-different-schools.prompt.json
```

Returns `201` with `{"promptId":"…","s3Key":"…","version":1,"status":"created"}`.
Keep that `promptId`.

### Step 2 — upload the set, wired to that Workie

`fileContent` is the whole CSV as a JSON string, so build the body with `jq`
rather than by hand. `roundKind` and `customInstructions` are what make the round
behave like its kind; `customInstructions` below is the house participant line
for that kind, straight out of `round-kinds.js`.

```bash
PROMPT_ID=<the promptId from step 1>

jq -n --rawfile csv demo-sets/lessons-from-different-schools.csv \
      --arg promptId "$PROMPT_ID" '{
  fileName:           "lessons-from-different-schools.csv",
  fileContent:        $csv,
  customTitle:        "Lessons from Different Schools",
  customDescription:  "Fourteen lessons from eight other professions, and where each one would land here.",
  customInstructions: "The material above is not ours. Say where it would land here, and who or what would resist it.",
  engagementType:     "call-and-answer",
  roundKind:          "apply",
  promptId:           $promptId
}' | curl -sS -X POST "$API/admin/upload-questions" \
       -H "Authorization: Bearer $TOKEN" \
       -H "Content-Type: application/json" \
       --data-binary @-
```

Returns `200` with `setId`, `questionCount`, `categoryCount` and — read this —
**`skippedRowCount`**. It must be `0`. A row missing either `Category` or `Title`
is dropped in silence and still returns a success message.

The other three, same two steps, with these values:

| CSV | `customTitle` | `roundKind` | `customInstructions` |
|---|---|---|---|
| `what-we-should-be-known-for.csv` | `What We Should Be Known For` | `produce` | `Answer from your own experience. Be specific — one real example beats a general principle.` |
| `the-rules-we-wrote-down.csv` | `The Rules We Wrote Down` | `improve` | `Rewrite it. Show the words you would use, not the direction you would go.` |
| `ready-or-not.csv` | `Ready or Not` | `judge` | `Give a verdict and your reason. Do not fix it.` |

Set ids are derived from the title by the importer
(`title.toLowerCase().replace(/[^a-z0-9]/g,'')`), so they come out as
`lessonsfromdifferentschools`, `whatweshouldbeknownfor`, `theruleswewrotedown`
and `readyornot`. Those are the ids already written into each prompt's
`questionSetIds`.

### Re-uploading after an edit

A plain upload **refuses** to overwrite a set that already exists. To publish a
new version of one that is already there, add `replaceSetId` (and optionally
`versionNote`) to the step-2 body and drop `customTitle`:

```bash
  replaceSetId: "lessonsfromdifferentschools",
  versionNote:  "swapped in our real handover wording"
```

That writes a new version and flips `activeVersion` in a single update; the set's
`promptId`, owner and instructions survive.

---

## Verification

```bash
node demo-sets/verify-demo-sets.js
```

No hand-written expectations. Each CSV goes through
`src/src/utils/csvPreflight.js` (what the console would say before sending) and
then through the **real** `lambda-functions/admin/upload-questions.js` handler
with only the AWS SDK stubbed, exactly as
`src/src/__tests__/questionCategories.test.js` does it — the category and
question rows reported are the rows the handler tried to write. Each prompt then
goes through the real `src/src/utils/promptPreflight.js`.

Current result — **all checks pass**:

| Set | Kind | Rows accepted | Rows skipped | Categories (questions each) | Longest `Detail` / ceiling |
|---|---|---|---|---|---|
| Lessons from Different Schools | apply | 14 | 0 | Architecture 2, Law 2, Design 2, Psychology 2, Engineering 2, Film 1, Medicine 2, Culinary 1 | 768 / 900 |
| What We Should Be Known For | produce | 5 | 0 | Proof 2, Positioning 2, Direction 1 | 230 / 350 |
| The Rules We Wrote Down | improve | 5 | 0 | Operating Rules 2, Standards 2, How We Say It 1 | 491 / 900 |
| Ready or Not | judge | 12 | 0 | Ready to Show 3, Ready to Sell 3, Ready to Support 3, Ready to Scale 3 | 337 / 600 |

The script also asserts, per set: the reported `roundKind` was stored on the set
row; no two categories fold to the same case-insensitive identity; the category
count is inside the 24-bit ceiling; no question has an empty `Detail`; and every
question's `Detail` is inside the ceiling its round kind declares.

Prompt preflight, all four: **zero blocking, zero silent findings, no duplicated
variables.** One advisory each — the assembled prompt lands at roughly 12.2–13.1 K
characters, over the 12 K mark at which `promptPreflight` warns that instruction
adherence decays with distance on a small model. That advisory's own recommended
fix is *"put the rules before the material"*, which all four prompts already do:
the numbered rules come first and the field list carrying `{responsesText}` is
the last thing in the instructions. The remaining size is rules, and trimming
them to hit a threshold would trade a working prompt for a smaller one.

---

## Files

```
lessons-from-different-schools.csv          apply,   14 questions, 8 categories
lessons-from-different-schools.prompt.json  Workie — The Transfer Reader
what-we-should-be-known-for.csv             produce,  5 questions, 3 categories
what-we-should-be-known-for.prompt.json     Workie — The Direction Advisor
the-rules-we-wrote-down.csv                 improve,  5 questions, 3 categories
the-rules-we-wrote-down.prompt.json         Workie — The Redline Reader
ready-or-not.csv                            judge,   12 questions, 4 categories
ready-or-not.prompt.json                    Workie — The Verdict Board
verify-demo-sets.js                         the check above; writes nothing
```

CSV columns follow `download-question-set.js` exactly, so any of these can be
downloaded from the console after import, edited, and uploaded back without a
column being silently dropped:
`Category,Question#,Title,Detail_lesson,School,CustomInstruction[,SourceAttribution],Tags`.
