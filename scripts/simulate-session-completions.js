/**
 * Advisor completions for scripts/simulate-session.js.
 *
 * NO BEDROCK CALL IS POSSIBLE IN THE HARNESS. Each entry here was written by a
 * model (Opus) reading the prompt the harness assembled for that round — the
 * exact string recorded in `prompts[n]` and printed verbatim in the transcript
 * — and following every rule in it, including the ones that produced awkward
 * results. Nothing was improved on the prompt's behalf; the friction is
 * recorded in the review document instead.
 *
 * Kept in a separate file from the harness so no hand-written prose sits in the
 * file that claims to be driving real code, and so it is obvious which text is
 * generated-standing-in and which is machinery.
 *
 * Production runs Haiku 4.5 (get-ai-summary.js:2255). A rule followed here is
 * no evidence at all that Haiku would follow it.
 *
 * Rounds with no entry fall back to the harness's placeholder, which is
 * deliberately marked as not-generated so it can never be mistaken for output.
 */
module.exports = {
  4: `## What the room said

- **Mutation testing was the common instinct**: four of the answers name mutation testing, one calling it *the only one that does not need a person to have been right first*.
- **The prices are named**: the costs include *four times our current suite runtime*, *it caps us at what I can write in a day*, and *users find the bug first*.
- **One answer refused the menu**: it says *none of the four* and would pay by *deleting tests*, because *a suite that passes by construction is worse than no suite*.
- **Not settled**: one answer keeps *human-authored expectations* and accepts *I am the bottleneck on every new test*; another goes *regression-only* and accepts *users find the bug first*.

## What the room voted

- **Two agents from opposite ends took it**: Ruth's answer, *two agents from opposite ends... double the compute and a genuine spec*, collected **20 vote points**.
- **The vote did not follow the writing**: four of the answers name mutation testing, and the strongest of those finished on 17 vote points.
- **Worth keeping**: an answer at 0 vote points says *the cost lands on on-call and I am not the one carrying it*, and ignoring it sets a testing policy whose bill is paid by whoever holds the pager.

## Discussion topics

1. The answer that would pay by *deleting tests*, down to *the twenty tests we would actually cry about*, earned 3 vote points — what would make that the cheapest option?
2. One answer says the real cost of mutation testing is that *someone has to triage surviving mutants every week forever* — who does that triage here, and what does that person stop doing?
3. One answer keeps *human-authored expectations* and accepts being *the bottleneck on every new test*, another goes *regression-only* and accepts *users find the bug first* — which delay does this group own?

## Next steps

1. Ruth: run the two-agent experiment on one ticket this week, one agent writing tests from the spec and one the implementation, and count the disagreements.
2. Whoever owns the CI budget: measure mutation-testing runtime on one module, so *four times our current suite runtime* becomes a measurement.
3. Whoever runs the on-call rotation: ask the next two engineers on the pager whether they accept that *users find the bug first* before that answer becomes policy.`,

  6: `## What the room said

- **What people keep is decisions, not tasks**: the list is *production access*, *interface decisions*, *deciding what not to build*, *what counts as a bug*, *naming things*, and *build and release*.
- **Some prices are exact**: the costs written down include *eleven minutes* of extra time to recovery and *about six hours a week*.
- **Two answers priced themselves in careers**: one says *it shows at review time*, the other *there is no dashboard on which it looks like anything but waste*.
- **Not settled**: one answer keeps *production access* human at a measured cost of *eleven minutes*; another keeps *giving junior engineers the work that used to make them senior*, whose *payoff is five years out*.

## What the room voted

- **Production access stays human took it**: Marcus's answer, *I am paying eleven minutes to keep a person in the loop*, collected **18 vote points** on 6 first-place votes.
- **The vote picked the answer carrying a number**: that answer alone names a measured cost and finished on 18 vote points against 7 vote points for the next answer.
- **Worth keeping**: an answer at 0 vote points keeps *giving junior engineers the work that used to make them senior* and says *there is no dashboard on which it looks like anything but waste*; dropping that answer loses the commitment that refills the people able to make the others.

## Discussion topics

1. The winning answer prices human production access at *roughly eleven minutes longer* time to recovery — who here signs that number off at the next incident review?
2. One answer keeps *deciding what not to build* and pays on *a dashboard that counts merged PRs* — whose dashboard is that?
3. The answer naming *eleven minutes* collected 18 vote points and the answer whose *payoff is five years out* collected 0 vote points — will this group fund only what it can measure?

## Next steps

1. Marcus: draft the one-page exception rule for production access, naming who may run a runbook without a human, and take it to the next incident review.
2. Whoever books design reviews: count the reviews in the next two weeks against the *about six hours a week* the interface-decisions answer names.
3. Whoever assigns next sprint's tickets: try handing one ticket an agent could finish in an hour to the least experienced engineer.`,
};
