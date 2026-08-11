# Dry run — "Reimagining the SDLC with agentic workflows"

**Written BEFORE the set, the prompt, or the simulation existed.** That is the
point: an evaluation written after the output is a description, not a test.

**Subject:** a 6-question call-and-answer session, plus a Workie advisor that
reads back what was said and voted, names discussion topics, and proposes next
steps.

---

## Part 1 — The hypothesis: what good looks like

Every criterion below is **falsifiable against the artefacts**, and each names
what would refute it. Anything I cannot check from the files is marked as owed
to a human.

### The session's purpose

> A session succeeds if it produces something **the group could not have
> written alone**, and that **survives contact with Monday**.

Everything else is a proxy for those two.

### A. The question set

| # | Criterion | Refuted by |
|---|---|---|
| **H1** | Each question produces genuine **divergence** — the vote spreads, rather than 80%+ converging on one answer. | A question where the room agrees immediately. That question told us something we already knew. |
| **H2** | The set **escalates**. Early questions are answerable from experience; later ones force a trade-off, a cost, or a commitment. | Q6 being no harder to answer than Q1 — the room's warmed-up state was wasted. |
| **H3** | **No question is answerable with a tool or vendor name.** "Which agent framework" is a shopping question; "what do you stop doing once review is cheap" is a design question. | Any question whose best answer is a product. |
| **H4** | Each question is **answerable in 2–3 sentences by a practitioner**, not only by an architect or only by a manager. | A question that requires org-chart authority to have an opinion on. |
| **H5** | The set covers **more than code generation**. Agentic SDLC touches planning, review, testing, deploy, on-call, and what humans are now for. A set that is six flavours of "AI writes code" is one question asked six times. | Two questions that would attract the same answers. |

### B. The advisor's report

| # | Criterion | Refuted by |
|---|---|---|
| **H6** | It names **at least one thing the room disagreed about, and does not resolve it.** | A report that manufactures consensus. This is the dominant failure mode of AI meeting summaries and the most valuable thing to get right. |
| **H7** | **Every claim traces to an actual response.** No invented statistics, no "the team felt", no percentage the system cannot compute. | Any number not derivable from the answers and votes — specifically the `participationRate` defect fixed in `78df15ca`, where the model was told participation was 100% on every round by construction. |
| **H8** | **Next steps are assignable.** Each has an owner-shaped subject and a first action doable inside a week. | "Invest in agentic tooling." Passes: "Run one real PR through agent review and compare against the human reviewer's findings." |
| **H9** | It surfaces the **load-bearing minority** — the answer that got few votes but that the room will regret ignoring. | A report that only echoes the top-voted answer. The tally already says what won; the advisor's job is what the tally hides. |
| **H10** | It is **legible to someone who was not in the room.** | Pronouns with no referent, in-jokes, "as discussed". |
| **H11** | It is **readable aloud in under three minutes** (~450 words). | A wall of text on a projector. |

### C. The mechanics

| # | Criterion | Refuted by |
|---|---|---|
| **H12** | The set **imports through the real importer** with zero skipped rows. | Any row silently dropped — the exact class of defect that made every AI-generated poll set import with no options. |
| **H13** | The prompt uses **only variables the system actually emits**, and every variable it references resolves to real data. | A `{token}` with no key, which renders literally on the projector. |
| **H14** | The report degrades honestly when data is thin — a round nobody answered must not read like a round with nothing interesting in it. | The `buildFallback()` path being indistinguishable from a real summary (the defect behind `fb39b9c8`). |

### D. What this dry run CANNOT establish

Stated up front so the evaluation cannot quietly claim it:

1. **The model gap.** Production summaries run on **Haiku 4.5**
   (`get-ai-summary.js:2255`). This simulation runs on Opus. A prompt that
   produces a disciplined report here may ramble or manufacture consensus
   there. **Refuting H6–H11 on Opus is decisive; confirming them is not.**
2. **Real humans.** Simulated answers are written by one mind and will be more
   coherent, more on-topic, and more evenly distributed than a real room's.
   In particular they will **understate** how much of a real session is
   near-duplicates and one-word answers.
3. **The projector.** Nothing here checks legibility at 25 feet.
4. **No Bedrock call is made.** The prompt is rendered for real; the completion
   is produced by a model reading that rendered prompt, not by the deployed
   lambda.

---

## Part 2 — Evaluation

*(Filled in after the simulated run. Empty on purpose until then.)*

## Part 3 — What to improve

*(Filled in after the evaluation.)*
