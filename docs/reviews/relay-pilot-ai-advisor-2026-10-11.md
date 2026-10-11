# Relay pilot: why the AI Advisor went wrong, and what to change

Session 6497 on test, 11 October 2026. Test runs `f59cbeb5`; `lambda-functions/game/get-ai-summary.js` is identical there and on this branch.
This was an investigation only. No source changed and nothing was written to AWS.

## Summary

- The model was **Claude Haiku 4.5** (`us.anthropic.claude-haiku-4-5-20251001-v1:0`), hard-coded. No prompt, persona or environment variable can change it.
- I rebuilt the exact prompt for rounds 1, 2, 3 and 6 by running the test code locally against test's own rows. Every rebuilt prompt matches the logged length to the character (17288, 17865, 17736, 18191).
- **Verdict: mostly prompt design, one code gap, one model slip.**
  - **Prompt design (main cause).** The template and the Session Advisor voice *require* a disagreement in every round. When the answers agree, the model invents one. That explains the round 2 and round 3 findings. All three models I tried did the same on the current prompt. With the requirement softened, Haiku 4.5 correctly said "No split" in 2 of 2 runs.
  - **Code gap.** The task the room answered (the question's `CustomInstructions`, for example "What change does our team need to introduce…") never reaches the model. The prompt tells it the room answered the story title.
  - **Model slip.** The round 1 score error was Haiku misreading correct data. The prompt listed Lena 6 and Omar 6; the model wrote "Theo … and Omar … both earned 6". It did not recur when I re-ran the prompt. Sonnet 4.6 and Opus 4.6 got it right.
  - **Round 6 (hypotheses written up as facts)** happens on every model. The prompt asks for "a few words" of quotation, and all three models drop the "If".
- A bigger model alone fixes only the rarest error, at about three times the cost. Fix the prompt first.

## Model used, with evidence

| Where | What it says |
|---|---|
| Code, `get-ai-summary.js:3268` (same at `f59cbeb5`) | `inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0`, `max_tokens` 2048, `temperature` 0.7, assistant prefill `## What the room said`. No other model, no override path. |
| Lambda `engagetest-get-ai-summary` configuration | The environment has no model variable (`TABLE_NAME`, `ACCOUNT_ID`, `AI_PROMPTS_BUCKET`, guardrail ids, and similar). Last modified 2026-10-10 14:22 UTC. |
| Prompt row `AIPROMPTS / AIPROMPT#mt1gd1v7n1ehpagp07` and `s3://engagetest-ai-prompts/prompts/call-and-answer/mt1gd1v7n1ehpagp07/v1.json` | No model field on any of the 69 `AIPROMPTS` rows or in the S3 prompt. |
| CloudWatch `/aws/lambda/engagetest-get-ai-summary`, 11:06–11:19 UTC | Six worker runs for game 6497. Each logs `🤖 BEDROCK: Calling Claude Haiku 4.5 (primary)… arn:aws:bedrock:us-east-1:239601476690:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0`, then `stop_reason end_turn`. No fallbacks, no truncation. |

How the prompt was chosen. The session named no prompt and the set named none, so the call-and-answer default was used: `mt1gd1v7n1ehpagp07`, "Call & Answer — Advisor Read" (the repo copy is `sets/prompt-callandanswer-workie-advisor.json`). That is the right prompt for this game type. The repo memory warning about the poll default with `{votes}` does not apply here: this was not a poll, and 0 template variables were left unfilled in any round.

The voice. Round 1 used the adaptive default ("inferred"). At 11:07:09, after round 1's summary was written, the host chose The Session Advisor (`engagetest-update-game-persona` logs "persona set to session-advisor — applies from the next question"). Rounds 2–6 used it.

The stored summary row does not record the model. `result.model` is set in the code but never written to the `AISummary` row.

## What the prompt actually received (round 1, rebuilt)

Every input was present and correct. I found no decrypt failure, no truncation, no wrong round, no stale cache and no wrong attribution in the data.

- The voice block, the 14-rule template, and the four sections with `outputSections`.
- `The question the room answered: Catherine the Great Modernizes a Resistant Empire`. **This is the title, not the task.**
- The question's Detail (the Catherine story).
- Counts: 4 answered, 4 voted. Scoring 3/2/1.
- The top three answers with first/second/third counts, keyed by answer text only, without names.
- Every answer ranked with name and points: Theo 7, Lena 6, Omar 6, Maya 5. Correct.
- The angle line ("event"), the opening move, the honesty rule, and the full Briefing (decrypted; `BriefingUsed: true`).
- **Missing:** the question's `CustomInstructions`. The row has the field (the log lists `'CustomInstructions'` among the question's fields), but `get-ai-summary.js` reads only Title, Detail, Background and AnswerDetails. A grep for `customInstructions` in that file finds nothing.
- Answers and votes are read by Query in `SK` order (alphabetical by player name). Tallies are indexed by that same order, so the scores line up. Answer and vote rows were decrypted with the session org (`org_KW4dzCH6jmFXeV4q61GgqP`). The set is a platform set and is not encrypted.

The prompt asks for "under 400 words". The six stored replies ran 583–760 words. Every model I tried also went over.

## Findings table

Categories: (a) code or data bug, (b) prompt design, (c) model capability, (d) review incorrect, (e) UX presentation.

| # | Finding | Review page | Cat. | Evidence | Fix |
|---|---|---|---|---|---|
| 1 | Round 1: "Theo's answer and Omar Patel's answer both earned 6 points" (it was Lena and Omar). Repeated in discussion topic 2 and in the report. | 4 (High) | c, plus b | The rebuilt prompt lists Lena 6 and Omar 6 correctly. Re-running Haiku on the same prompt gave the right pair, so the slip is random. Sonnet 4.6 and Opus 4.6 were right. The top-three split is keyed by answer text without names, which makes the model join text to names itself. | Add one "vote points by author" line. Add a post-generation check that every name-plus-points pair in the reply matches the tally; regenerate once on a mismatch. |
| 2 | Round 2: an invented split ("decides reliability evidence after the pilot runs") when both answers say *agree now*. | 4 (High) | b | Template rule 5, the "What the room said" guidance ("The last bullet must start **Not settled**") and the discussion guidance ("One question must be the split…") all require a split. The Session Advisor's required addition ("the reply must include the disagreement…", "a reply without it is malformed") overrides rule 5's "No split" escape. Haiku, Sonnet and Opus all invented a split on the current prompt. With the requirement made conditional, Haiku said "No split" in 2 of 2 runs. | Make the split conditional in the template and in `personas.js`. Define a conflict as "doing one rules out the other". |
| 3 | Round 3: "You cannot freeze both" (scope versus CRM subset). | 4 (High) | b, then c | The same forced split. Haiku repeated it on a re-run ("you cannot do both in eight weeks"). Sonnet 4.6 avoided claiming incompatibility. | As 2. |
| 4 | Round 6: conditional grievances became facts ("Past rollout failures are the first barrier"; "Map the current failure points…"). | 4 (Medium) | b, then c | Every answer begins "If…". The prompt says to quote "a few words". All three models clipped the "If" (Sonnet: *past rollout feedback was ignored*). A patched rule cut the problem in Haiku but did not remove it. | Add a rule to keep "if", "might" and "could" inside quotes and never build a heading or step on a condition. Consider a check that flags a reply quoting a conditional answer without its condition. |
| 5 | Long replies: 9–11 screens per round. | 2, 5 (Low) | b, e | The prompt asks for under 400 words. Stored replies ran 583–760. Sonnet ran 520–570 and Opus 571–694. Four required sections with 2–4 bullets each, plus quoting whole answers, do not fit in 400 words. | Fewer bullets, quotes of 15 words or fewer, a 300-word target. Show a short synthesis first, details on demand. |
| 6 | Next steps read as commitments: named owners for actions nobody agreed. | 2, 6 | b, e | Rule 11 requires each step's owner to be "a person named in the material", so the model assigns participants. | Title the section "Suggested next steps". Allow role owners; let the host edit or dismiss. |
| 7 | Briefing facts appear publicly (8 weeks, team size). | 2 | e (by design) | `ContextUsed.briefing: true`. The briefing layer says to use it "where it sharpens a point". | Make the briefing setting say plainly that its facts may be quoted on screen. |
| 8 | "Lena Ortiz::" in round 6 next steps. | not raised | e | The model wrote `**Lena Ortiz:**`. `MarkdownRenderer.jsx` `formatListItem` keeps the colon inside the lead, and `styles.css:9028` `.md-lead::after { content: ': ' }` adds a second one. Rounds 4 and 6 show it. | Strip a trailing colon from `m[1]` in `formatListItem`. |
| 9 | The voice changed after round 1. | 2 | not a fault | The host changed it at 11:07:09. | None. |
| 10 | Voting screen omits the task. | 5–7 (Medium) | e | `PlayerPage.jsx` shows `taskBlock` ("Your task") only on the answer screen. | Show the task on the vote screens. |
| 11 | Quick Vote truncates answers at about 70 characters. | 5 | e | Not checked in code. | Show the full text, or make Detailed Vote the default when answers are long. |
| 12 | Participants see only their own result; advisor and discussion are main-screen only. | 5 | e | By design. | A participant results view. |
| 13 | The report omits the task wording; "About" lists Negotiation although it was excluded. | 5 (Medium) | a/e | No instruction field is used in `GameReport.jsx` or `RoundReport.jsx`. "About" is the set description. | Print each round's task. Describe the categories actually asked. |
| 14 | Anonymous numbering stayed 1 Lena, 2 Maya, 3 Omar, 4 Theo. | 3 | a | The order is not random. `get-answers.js` returns answers in `SK` order, which is alphabetical by player name, and the ballot is positional. Anyone who knows the roster can map numbers to people. | A seeded per-round shuffle, applied the same way in `get-answers.js`, the vote tally and `get-ai-summary.js`. |
| 15 | Every ballot ranked the voter's own answer. | not raised | a or rule gap | I decrypted rounds 1, 2 and 6: 12 of 12 ballots include the voter's own answer, and Lena put herself first in all three rounds. No self-vote guard exists. The advisor then reports these points as "what the room chose". | Decide the rule. Either exclude your own answer from your ballot, or say on screen that self-votes count. |
| 16 | Queue: one reorder converts the whole preview into explicit picks. | 3 | e | Not investigated here (not the advisor). | Warn before the action. |

## Where the review is wrong or incomplete

The review is accurate on every advisor claim I could check. The quotes, tallies and round attributions all match the report and the stored data. Where it falls short:

1. **Anonymous numbering (p.3).** It says stable numbering "could let participants learn identity patterns" and makes "no broader randomness claim". It understates the problem. There is no randomness at all: the numbers are alphabetical by name in every round. That is a real anonymity leak, not a risk.
2. **"Bind author/score statements to structured tally" (p.4).** The structured tally was already in the prompt, correct and with names. The model misread it. The fix is a check on the output, not better input.
3. **Cause, not visible to the reviewers.** The review treats rounds 2, 3 and 6 as the model going "beyond the evidence". Rounds 2 and 3 are mostly the prompt demanding a split. The review could not see the prompt, so this is a gap rather than an error. It also could not see that the task wording never reaches the model.
4. **Missed:** the "::" rendering bug, self-votes on every ballot, and replies roughly 50–90% over the prompt's own length limit. Smaller misses: round 2's "Worth keeping" names Maya although rule 6 forbids naming, and round 3 says "Three answers propose stopping something" when all four do.

## Model comparison (measured)

Prompts were the exact rebuilt ones. Haiku used prefill as production does. Sonnet 4.6 and Opus 4.6 reject assistant prefill, so they ran without it. Newer models (Haiku 5.5, Sonnet 5/5.5, Opus 4.7/4.8/5/5.5, Fable 5) are listed in us-east-1 but return AccessDenied for this account. Opus 4.6 was the newest I could call.

| Model | Rounds | Latency | Input tokens | Output tokens | Words |
|---|---|---|---|---|---|
| Haiku 4.5 (production) | 1, 2, 3, 6 | 11.0–15.1 s (production Lambda: 11.7–13.7 s) | 4.1–4.3k | 746–1112 | 551–765 |
| Sonnet 4.6 | 1, 2, 3, 6 | 11.1–12.1 s | 4.1–4.3k | 703–773 | 520–570 |
| Opus 4.6 | 1, 2, 3, 6 | 19.3–21.9 s | 4.1–4.3k | 772–922 | 571–694 |
| Haiku 4.5, patched prompt | 1, 2 (twice), 6 | 10.9–13.0 s | 4.4–4.6k | 723–945 | 519–668 |

Against the reviewers' complaints:

- **Round 1 score attribution.** All three were correct on this run. The original Haiku error is a random slip. Opus broke rule 6 by naming the author of "Worth keeping".
- **Round 2 invented split.** All three invented one on the current prompt: Haiku "controlled experiment versus stepping stone" (and credited Maya's words to Theo), Sonnet "drill first or decision framework first", Opus "tool versus human check". With the patched prompt, Haiku said **No split** in both runs.
- **Round 3 "cannot freeze both".** Haiku repeated it. Opus invented a softer tension. Sonnet was the best: it said the two are "not the same problem" and asked whether they are separate decisions.
- **Round 6 conditionals.** All three dropped the "If". The patched rule helped Haiku in the vote section but not in the first section.
- **Length.** Every model exceeded 400 words. This is a prompt problem.

Cost per round at list prices (check current Bedrock pricing): Haiku about $0.008, Sonnet 4.6 about $0.025, Opus 4.6 about $0.04. Sonnet 4.6 was no slower than Haiku here. Opus was about 8 seconds slower.

The patched prompt I tested changed only text: rule 5 made conditional; two new rules (keep "if" in quotes; copy points from a per-author line); the task line added; the "Not settled" and discussion requirements made conditional; the voice's required addition softened. It is a test, not a finished prompt.

## Recommended changes, ranked by value for effort

1. **Make the disagreement conditional** (high value, small effort). Rewrite rule 5 and the "What the room said" and "Discussion topics" guidance in `sets/prompt-callandanswer-workie-advisor.json`, then install with `scripts/install-ai-prompt.js --apply`. In `lambda-functions/game/personas.js` (session-advisor `requiredAddition` and voice "FIRST, report the disagreement"), change the requirement to "any genuine disagreement, or say plainly there was none". Check the `PERSONA#session-advisor` row on each tier. Measured: R2 went from an invented split to "No split" in 2 of 2 runs.
2. **Send the task to the model** (high value, small effort). In `lambda-functions/game/get-ai-summary.js`, read `question.CustomInstructions`. Fall back to the set's `customInstruction` and then the game-type default, mirroring `src/src/config/instructions.js` `resolveInstruction`. Expose it as a new `{task}` variable and inside `questionInfo`. In the prompt file, replace "The question the room answered: {title}" with "The task the room answered: {task}" and "The story it was set against: {title}".
3. **One authoritative tally line plus an output check** (high value, medium effort). Add `{voteTallyByAuthor}` (name, points, first/second/third) in `get-ai-summary.js`, and use it in the prompt. After `parseAIResponse`, check each "Name … N points" against the tallies; on a mismatch, regenerate once, then fall back to a sentence built from the data. Add a test beside `tests/ai-summary-*.js`.
4. **Keep the writer's conditions, and shorten** (medium value, small effort). In the prompt file: keep "if", "might" and "could" in quotes; never build a heading or step on a condition; quotes of 15 words or fewer; 2–3 bullets per section; a 300-word target. Also rename the section to "Suggested next steps" and let an owner be a role.
5. **Fix the small presentation bugs** (medium value, tiny effort). Strip the trailing colon in `src/src/components/MarkdownRenderer.jsx` `formatListItem`. Store `Model` on the `AISummary` row in `get-ai-summary.js` so reports can say which model wrote each read.
6. **Call & Answer fairness** (high value, medium effort, not the advisor). Shuffle the anonymous answer order per round in `lambda-functions/game/get-answers.js`, mapped back consistently in results and in `get-ai-summary.js`. Decide on self-votes (`submit-vote` path). Show the task on the vote screens (`src/src/PlayerPage.jsx`). Print each task in the report (`GameReport.jsx` / `RoundReport.jsx`).
7. **Model choice, after 1–4** (medium value, medium effort). Rerun the same four rounds on Haiku 4.5 and Sonnet 4.6 with the fixed prompt. If Haiku still drops conditions, move to Sonnet 4.6: same latency, about three times the cost. Sonnet does not accept prefill, so remove the prefill in `get-ai-summary.js` and make sure `parseAIResponse` tolerates a missing first heading. Opus 4.6 is not worth its extra 8 seconds here. Ask for Bedrock access to the 5.x models if a newer comparison is wanted.

## What to verify on test next

- After changes 1–4, rerun game 6497's rounds through the read-only rebuild (see below) and check: R1 names and points match; R2 and R3 say "No split" or name a real conflict; R6 keeps every "If"; each reply is under about 350 words.
- Run one new live Call & Answer session on test where the answers truly conflict, to confirm the advisor still names a real split.
- Confirm the `PERSONA#session-advisor` row on test matches `personas.js` after the change. The row shown on test today has no `requiredAddition` field; the prompt text comes from code.
- After the shuffle change, check that ballots, tallies, the report and the advisor still attribute every answer to the right person.
- Check the double colon is gone on the projector and in the PDF.
- Check `get-ai-summary` logs show no new unresolved variables after `{task}` is added.

Method note: the rebuild ran the `f59cbeb5` code locally. Reads were allowed; every DynamoDB write, Lambda invoke, socket post and the Bedrock call were intercepted and never sent (only a `PutCommand` was attempted, and it was blocked). Score rows were set back to each round's totals, and round 1 was run without the later voice choice. The opening move and angle were matched to the logs. Decryption used the repo's `tenant-crypto.js` (GetItem plus KMS Decrypt only). The scripts and outputs are in the session scratchpad, not in the repo.
