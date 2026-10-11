# Follow-up asks: the prototype runs

2026-10-11. Eight model calls, all Bedrock `converse`, read-only, through `AWS_PROFILE=adminaccess`. No product code ran, nothing was written to AWS, and the Anthropic API was not called (no credentials here), so **the 5.5 models were not measured**. The raw replies are in `prototype/prototype-runs.json`; the scripts that built every prompt and checked every reply are beside it, and they reproduce the prompts byte for byte.

## The round material

One question set from the repo: `sets/agentic-sdlc-call-and-answer.csv`. Two of its questions, with answers written for this test (in `prototype/rounds.json`), because the round needed both a real disagreement and a round where there is none.

| Round | Question | Answers | Voters | Names | What it tests |
|---|---|---|---|---|---|
| r3 | 3, "The machine wrote it and the machine reviewed it. What are you reviewing?" | 9 | 9 | shown | A real split: one answer stops reading diffs and watches production; another reads every test; one keeps reading everything. One low-voted answer (backfills cannot be rolled back) worth rescuing. |
| r2 | 2, "If an agent can build it from the ticket, who writes the ticket?" | 7 | 7 | hidden ("a participant") | Mostly agreement (heavier specs), so the read should say No split. Two answers drift the other way. |

Points are 3/2/1 from the votes; the per-author lines and the ranked list are built the way `get-ai-summary.js` builds them (`author-tally.js`, the medal list). The voice is The Session Advisor, the read-back prompt is the repo's current `sets/prompt-callandanswer-workie-advisor.json`, and the output contract and voice directive come from `lambda-functions/game/personas.js` itself. The opening move is fixed (move 2 of 10) so the runs compare.

**The prompts were sent with no assistant prefill and no "begin with this line" instruction.** That is a gap in the harness, not the product: production Haiku 4.5 prefills `## What the room said`, and every model that refuses a prefill (Sonnet 4.6, the 5.5 route) is asked for the heading in words and has any preamble cut off by `ensureLeadingHeading` (`get-ai-summary.js:3548-3572`; the route's own rewrite is `claude-route.js:188-205`). It matters only to the preamble note below.

## Two shapes, four calls each

| | A: in-band | B: separate call |
|---|---|---|
| What | The read gains a fifth heading, "Follow-up asks", whose body is one fenced json block. The parser would strip it before `markdownResponse` is stored. | After the read is written, a second, small call: the answers (numbered, no names) and the read text in; a `suggest_follow_up_asks` tool call out. |
| Rules | v1 (`prototype/prompt-draft-v1.json`, `inBandVariant`) | v2 (`prompt-draft.json`, `followUpAsks`): numbered answers, `statement` and options copied from a cited answer number |
| Output channel | Text: a fenced json block | Tool use, with `toolChoice: auto` (not forced) |
| Runs | Haiku 4.5 and Sonnet 4.6, on r3 and r2 | Haiku 4.5 and Sonnet 4.6, on r3 and r2, each given run A's read of the same round and model |

Why `toolChoice: auto` in B: the 5.5 route cannot force a tool. Sonnet 5.5 answers a forced `tool_choice` with a 400, so `claude-route.js` sends `auto` plus "Answer by calling one of the tools", and treats a reply without the call as a failure that falls back to Bedrock with the original, forced request (`claude-route.js:38-40`, `202-205`, `258-260`). Testing B with `auto` on 4.x measures the harder case.

## Did it parse?

| Run | Model | Round | Parsed | Asks | Latency | Tokens in / out |
|---|---|---|---|---|---|---|
| A | Haiku 4.5 | r3 | yes, json block | 2 | 12.8 s | 5006 / 954 |
| A | Sonnet 4.6 | r3 | yes | 3 | 14.9 s | 5006 / 1090 |
| A | Haiku 4.5 | r2 | yes | 2 | 12.2 s | 4637 / 906 |
| A | Sonnet 4.6 | r2 | yes | 3 | 14.2 s | 4637 / 1062 |
| B | Haiku 4.5 | r3 | yes, one tool call, no stray text | 3 | 5.6 s | 2791 / 355 |
| B | Sonnet 4.6 | r3 | yes | 3 | 6.5 s | 2859 / 432 |
| B | Haiku 4.5 | r2 | yes | 3 | 5.3 s | 2729 / 379 |
| B | Sonnet 4.6 | r2 | yes | 3 | 6.1 s | 2722 / 358 |

**8 of 8 parsed.** Every A reply closed its fence and stopped at `end_turn` inside the 2048-token budget; every B reply called the tool exactly once, with `auto`. Parsing does not decide between the shapes.

Two side notes from A:
- **All four A reads opened with prose before the first heading** (a quoted line and a sentence). This is the harness's missing heading instruction (above); production cuts such a preamble off. It does not bear on the asks.
- **The A reads ran 453 to 519 words** against the prompt's "about 300". There is no control run without the fifth section, so this does not show the asks made the read longer; the relay pilot already measured 520 to 570 for Sonnet on this prompt family.

In A, Haiku left out the `statement` field on both agree asks and put the statement in `prompt`; Sonnet filled it. v2 removed `prompt` from agree asks entirely (the screen adds "Do you agree?").

## The asks, in full

`answers` and `answer` are the numbers in the ranked list the B call was given (1 is the top-voted answer). **CHECK** is the server check the SPEC proposes (`prototype/check.py`): an agree statement must be words copied in order from its cited answer, at most 20 words; each option words copied in order from its cited answer, at most 8 words, each from a different answer; a question at most 110 characters; no roster name in anything the room sees.

### Run B (recommended shape), round r3: a real split

**Haiku 4.5**

1. agree, from answer 6: *"Code can be rolled back; a bad backfill cannot."* Why: "Tests whether the room's consensus on general review strategy holds for migrations and irreversible changes, or if this answer should move higher." **CHECK: pass.**
2. choice, from answers 4 and 7: "When should a risky change go live: before human review or after production monitoring?" A "Stop the change before it ships" (4), B "Ship it to one percent and review dashboards" (7). **CHECK: both options not copied.** Option A is not in answer 4 at all: it is the framing of Haiku's own read ("whether you stop the change before it ships"). Option B is answer 7 with "the" dropped.
3. open, from answer 2: "What else besides auth, IAM, and payments would you always require human review?" **CHECK: pass.** Its `why` names a participant ("Aisha Rahman's security-sensitive list"); `why` is host-only, but rule A5 says no names anywhere.

**Sonnet 4.6**

1. agree, from answer 3: *"if the agent wrote both the code and the tests, the tests are the only place the human can check whether the right problem was solved."* **CHECK: 26 words, and not in answer 3**: the second half is Sonnet's own read, not the room.
2. choice, from answers 1, 2, 4: "Which should determine how deeply you review an agent PR?" A "interface diff, test assertions and the rollback plan", B "security-sensitive files: auth, IAM, payments, personal data", C "blast radius: what else imports this, and who gets paged". **CHECK: none copied exactly; C is 10 words.** But every content word of every option is in its answer (dropped articles, a colon for "only").
3. open, from all nine answers: "What is one type of agent PR where you would not trust any of the stopping rules from this session?" **CHECK: pass**, though citing all nine answers is no citation.

### Run B, round r2: no split, names hidden

**Haiku 4.5**

1. choice, from answers 1, 2, 3: "When specs are heavier now, who has taken on the extra work?" A "Product and engineers writing what-if cases", B "Senior engineers writing tickets, juniors reviewing output", C "Engineers writing acceptance criteria as examples". **CHECK: all three reworded** (60 to 83 per cent of their content words are in the answer).
2. agree, from answer 2: *"Senior engineers write the tickets now and juniors review the agent's output."* **CHECK: pass.**
3. open, from answers 6 and 7: "What is one area of the codebase where specs should stay disposable?" **CHECK: pass.**

**Sonnet 4.6**

1. agree, from answer 2: *"senior engineers write the tickets now and juniors review the agent's output"*. **CHECK: pass.**
2. choice, from answers 1, 3, 6: "When the agent builds from a vague ticket, what does your team do next?" A "engineers now write the what-if cases before anything runs", B "acceptance criteria written as examples", C "two versions and we pick one in the demo". **CHECK: A and C over 8 words**; all three copied in order.
3. open, from answer 2: "What is one ticket-writing decision a junior engineer used to make that has now moved to someone or something else?" **CHECK: 115 characters** (the limit is 110).

### Run A (in-band, v1 rules), for comparison

| Run | Ask | Note |
|---|---|---|
| Haiku r3 | agree "If the tests would still pass with the function body deleted, the code goes back." | Keeps the "If". In `prompt`, no `statement`. |
| Haiku r3 | choice "When do you catch the problem: before the code ships, or after it runs in production?" (2 options) | The split Haiku's read named. `source` is 47 words. |
| Haiku r2 | agree "Senior engineers writing tickets and juniors reviewing agent output is healthy for the juniors." | Not the room's words: it turns one writer's doubt into a claim for the room to judge. Arguably a good question, but the room is told it is theirs. |
| Haiku r2 | choice "When specs get heavier, who should write the what-if cases?" A Engineers, B Product, C "The agent, from the ticket" | Option C is in no answer. |
| Sonnet r3 | agree *"If the tests would still pass with the function body deleted, it goes back."* | Verbatim, keeps the condition. |
| Sonnet r3 | choice "When an agent PR touches IAM, what should trigger human review?" | The options (file type, blast radius, migrations) do not answer a question about IAM. |
| Sonnet r3 | open "What is one thing a human reviewer can catch in an agent PR that a second agent cannot?" | The best open ask of the eight runs; used in the mockups. |
| Sonnet r2 | agree, prompt "Do you agree: specs are heavier because the agent made ambiguity costly, not because the team chose rigour?" | Statement verbatim, but the prompt adds a claim of Sonnet's own ("not because the team chose rigour"). Leading. |
| Sonnet r2 | choice "Where does your team sit right now on ticket weight?" (4 options) | Options are not alternatives: three are practices a team can do at once. |
| Sonnet r2 | open "What is one thing a junior engineer no longer decides because a senior writes the ticket first?" | Good: specific, grounded in the one answer that raised the doubt. |

## Judgement

**Specific and grounded?** Mostly yes. Every ask in every run points at something the room actually wrote, and the best ones do what a facilitator would: rescue a low-voted line for a room-wide test (the backfill agree, 5 points), or ask the room for the thing an answer raised and did not supply (what a junior no longer decides; what a human reviewer still catches). No ask in eight runs was generic enough to fit another session.

**Non-leading?** Not reliably, and the failures have one shape: **the model's own words slip in**. The leading cases are an agree prompt with an added clause (Sonnet A r2), a statement lifted from the model's read instead of the answer (Sonnet B r3), an option taken from the read's framing (Haiku B r3), and an option no one wrote (Haiku A r2). Each of these is caught by a mechanical check against the answers. That is why v2 cites answer numbers and why the SPEC makes the check a server rule, not a prompt hope.

**By type:**
- **Agree** asks are the strongest: 3 of 4 v2 statements are verbatim, one-line, and arguable. The one failure was caught by the check. One caution: a statement that describes one team's practice ("senior engineers write the tickets now…") makes a weak agree, because "agree" then means "true here too", which a pick-one asks better. The prompt now says to pick a statement people could reasonably disagree with (A4); a further line for "a claim, not a description" is worth testing.
- **Choice** asks are the weakest. Good questions, but in 0 of 4 v2 runs did every option pass the strict copy rule, and in 2 of 4 the options were not true alternatives. The fix is partly the check (flag a reworded option to the host, F2) and partly the host's edit (F3), which is why the editor exists.
- **Open** asks were good in 4 of 4 v2 runs and in both Sonnet A runs; the only fault was 5 characters over the length limit.

**Haiku 4.5 against Sonnet 4.6.** Both parse every time and take about the same time on the separate call (5.3 to 6.5 s). Sonnet copies the room's words more faithfully (every content word of 6 of 6 options is in its answer, against 1 of 5 for Haiku) and keeps three asks; it also runs long (a 26-word statement, a 10-word option, a 115-character question). Haiku stays short but borrows framing from its own read, which matters most when the read has invented a split, as the relay pilot found it does. At list prices (check current Bedrock pricing) a B call costs about half a cent on Haiku and about one and a half cents on Sonnet. **Recommendation: Sonnet for the asks call**, whichever model wrote the read, because grounding is the property the check cannot repair, only reject.

**What was not measured.** Haiku 5.5 and Sonnet 5.5 (no credentials here; the route's `auto` tool choice was tested on 4.x instead). A thin round (1 or 2 answers) and an empty one; rule A8 covers them and is untested. More than one read per round (the opening move and temperature vary the read, and the asks follow the read). How often a real host edits before sending. A first dev run should cover all four.
