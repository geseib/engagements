# Workie grounding, step 0: why the read invented a "15-minute hold"

Review: [geseib/engagements#38](https://github.com/geseib/engagements/issues/38), test
`5b908b65`, session 7360, round 1. Owner, 19 Oct: "explain the plan … perhaps there is a
deterministic aspect to get the model specific info … I do worry about language like
'strongest resistance' being too over the top … we dont want that just injected as part of a
fluffy GenAI language." Then: "go with your recommendations, start with step 0."

## What Workie was given

The set's prompt is **Workie - The Transfer Reader** (S3
`prompts/call-and-answer/imported-1786821015768-stzi77twk/v1.json`, imported 15 Aug). Its
source is `demo-sets/lessons-from-different-schools.prompt.json`. The S3 copy could not be
byte-compared from the container (no AWS access); the owner can confirm it in Admin › Prompts.

The material block (`get-ai-summary.js` template variables) carries every answer **ranked,
with its vote points** (`responsesText`), the counts answered and voted, the scoring system,
and a computed agreement label (`consensus.js`: round 2's 12/8/4/0 reads "Mixed opinions").
**The vote facts were there.** Missing data is not the main cause.

## What the prompt asked for

1. **Rule 11 and the Next steps section require an owner and "the first action one person can
   finish inside a week"** for every step, traced to an answer. Four answers about a van pilot
   contain no such action. To obey rule 11 the model has to make one up, which breaks rule 2
   ("Do not use a number you cannot copy from that material"). The prompt contradicts itself;
   the model settled it by inventing "run one Friday with a 15-minute hold".
2. **"Strongest resistance" is the prompt's own wording**: Discussion topics, "One question
   must be the strongest piece of resistance from the second section." Workie used the words it
   was given. Nothing says how "strongest" is measured, so it reads as a judgement the vote
   never made. It is not generic AI fluff, though the effect on the room is the same.

## The same rule elsewhere

| Prompt | Next-step rule |
|---|---|
| `demo-sets/lessons-from-different-schools` (Transfer Reader) | bare "EVERY NEXT STEP IS ASSIGNABLE" |
| `lambda-functions/admin/default-ai-prompts.json` (two entries) | bare |
| `demo-sets/what-we-should-be-known-for` | bare |
| `demo-sets/the-rules-we-wrote-down` | bare |
| `demo-sets/ready-or-not` | already "IS ONLY A SUGGESTION… The room has not agreed", steps start **Suggested** |
| `sets/prompt-callandanswer-workie-advisor.json` | already "did not agree to them, so never write one as if it had" |

Two prompts already carry the fix in their own words; four still have the bare rule.

## So the plan changes

- **Prompts first (the cause).** In the four prompts with the bare rule, next steps become
  suggestions the room has not agreed to, in the form `ready-or-not` already uses, and a step
  may use a number, duration or limit only if it appears in an answer. "The strongest piece
  of resistance" becomes "the resistance named by the most answers (if tied, the
  highest-ranked)", and the read says it that way ("named by three answers"). The repo files
  are the source; the live copies in S3 change only by re-import or an edit in Admin ›
  Prompts, which is a separate step to agree with the owner.
- **The check after writing (the backstop).** Numbers not in the material, and claim words
  about the room ("strongest", "unanimous", "everyone", "the room agreed") that the vote does
  not support, trigger one rewrite naming the exact words; a host-only note if it still
  fails. Anything in the persona's own voice text is exempt.
- **The fact sheet (smaller than planned).** The vote facts already reach Workie. One line is
  added: what a ranking measures (preference among these answers, not agreement to a plan).
