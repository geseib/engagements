# Build Room starter sets (draft for review)

Owner, 2026-10-05: **"yes build-room tag and ship the starter set."**

These sets are drafted here, not in `sets/`. Two reasons:

- The two Build Room columns (`ClaudeGets`, `ClaudeNote`) do not exist in the importer
  yet. PLAN step 7b adds them.
- A set reaches a tier only through the normal upload path.

When step 7b lands, the CSVs below move to `sets/build-room-starters.csv` and
`sets/build-room-pulse.csv`, with this file as their companion notes. They are then
uploaded to the **platform** library on each tier.

The starters come as **two sets**, because a set has one engagement type:

| Set | Type | Becomes in a Build Room | Tags | Topic |
|---|---|---|---|---|
| Build Room starters | Call and Answer | Ideas asks (everyone answers, then votes) | `build-room` | `business-work` |
| Build Room pulse | Poll (rating, 1–5) | Rate asks | `build-room` | `business-work` |

Categories group the questions in the host's picker (C13): **Who it is for**, **Start**,
**Think differently**, **While building**, **Before wrapping up**.

`ClaudeGets` is one of `do-now`, `keep`, `later` or `ask` (RATIONALE §10b). `ClaudeNote`
is how Claude should use the decided answer; it is never shown to the room. `School`
holds where a question comes from, for the host's eyes only.

Copy rules: plain words, concrete, no emoji, and phone, laptop or tablet when devices are
named. Every attribution was checked:

- **Working backwards:** Amazon starts a product by writing the press release first.
- **Pre-mortem:** Gary Klein, "Performing a Project Premortem", *Harvard Business
  Review*, September 2007.
- **Jobs to be done:** Clayton Christensen, Taddy Hall, Karen Dillon and David Duncan,
  "Know Your Customers' 'Jobs to Be Done'", *Harvard Business Review*, September 2016.
- **Inversion:** Charlie Munger's "Invert, always invert", which he took from the
  mathematician Carl Jacobi.
- **Ten times, not ten percent:** Astro Teller, head of Google X, "Google X Head on
  Moonshots: 10X Is Easier Than 10 Percent", *Wired*, February 2013.
- **Saint-Exupéry:** *Terre des hommes* (1939, in English *Wind, Sand and Stars*):
  perfection is reached "not when there is nothing more to add, but when there is
  nothing left to take away". On the wall the question cites no one; the detail
  paraphrases the line.

## Build Room starters (Call and Answer)

Five groups. Two of them were added at the owner's request (2026-10-05): "asking who is
this for, how could we accomplish the same goal with a completely different approach
type questions". The **Think differently** group exists to make the room reframe the
problem rather than react to the screen. Most of its answers go to Claude as **Ask
Claude**: Claude says what the winning approach would take next to the current one, and
switches only on a Do now.

| # | Category | Question | Claude gets | Note for Claude |
|---|---|---|---|---|
| 1 | Who it is for | Who is this for, in one sentence? | keep | Treat the winning answer as the audience for every screen and every word on it. |
| 2 | Who it is for | Who is this not for? | keep | Do not build for these people. If a later direction would serve them, say so first. |
| 3 | Who it is for | Who did we forget? | keep | Check the build works for the winning answer, say what fails for them, and keep them in mind from now on. |
| 4 | Who it is for | What job is someone hiring this to do? | keep | Use the winning job as the test for every feature: does it help with this job? |
| 5 | Start | What does done look like by the end of today? | keep | Use this as the finish line. When it is true, say so and suggest wrapping up. |
| 6 | Start | What must it never do? | keep | Treat the winning answers as hard rules. If a later direction would break one, say so before you build. |
| 7 | Start | It is launch day. Write the headline. | keep | Read the winning headline as the promise the product has to keep, and build toward it. |
| 8 | Think differently | How could we reach the same goal a completely different way? | ask | In a few lines, say how you would build the winning approach and what it would cost next to the current one. Do not switch unless a Do now says so. |
| 9 | Think differently | How would we do this with no app at all? | ask | Say which part of the winning answer the build could borrow, if any, and what it would replace. |
| 10 | Think differently | Who has solved this already, in a different field? | ask | Say what you would borrow from the winning example and where it would go on the screen. |
| 11 | Think differently | How would we make sure nobody ever used it? | keep | Turn each winning answer into a rule in the brief: the opposite of how to fail. |
| 12 | Think differently | What would make this ten times better, not ten percent? | later | Put the winning idea on the Later list, and say what the first small step toward it would be. |
| 13 | While building | What would stop someone using it? | do-now | Fix the top answer first. Say in one line what you changed. |
| 14 | While building | What is confusing on the screen right now? | do-now | Treat each answer as a specific problem. Fix the top one and show it before and after. |
| 15 | While building | What should we cut? | do-now | Remove the winning item unless it breaks a Keep in mind rule. Say what you removed. |
| 16 | Before wrapping up | A month from now, nobody uses it. Why? | later | Add the top reasons to the Later list as risks. Say which ones today's build already causes. |
| 17 | Before wrapping up | What should we build next time? | later | Put the winning answers on the Later list for the next session. |

**From an Ask Claude answer to a vote.** When Claude has answered "how would you build
the different approach", the host can put "keep going" against "switch" to a Pick one
vote, with mockups first (C3, C3b). The room then sees both before it chooses.

```csv
Category,Question#,Title,Detail_lesson,School,CustomInstruction,ClaudeGets,ClaudeNote
"Who it is for",1,"Who is this for, in one sentence?","Name a real kind of person and the moment they would use it. ""Busy volunteers on a Saturday morning"" helps Claude more than ""everyone"".","Engage","One sentence: a person and a moment.","keep","Treat the winning answer as the audience for every screen and every word on it."
"Who it is for",2,"Who is this not for?","Saying who it is not for is how a small thing stays small and good.","Engage","Name a kind of person, not a feature.","keep","Do not build for these people. If a later direction would serve them, say so first."
"Who it is for",3,"Who did we forget?","Someone who cannot read small text, someone new to the language, someone who has never used an app like this, someone in a hurry.","Engage","Name one person and what gets in their way.","keep","Check the build works for the winning answer, say what fails for them, and keep them in mind from now on."
"Who it is for",4,"What job is someone hiring this to do?","People do not want a sign-up form. They want to know where to be on Saturday. What are they really trying to get done?","Jobs to be done (Clayton Christensen, Harvard Business Review, 2016)","Start with ""Help me..."".","keep","Use the winning job as the test for every feature: does it help with this job?"
"Start",5,"What does done look like by the end of today?","Not everything it could become. What could someone do with it when this session ends?","Engage","Start with ""Someone can..."".","keep","Use this as the finish line. When it is true, say so and suggest wrapping up."
"Start",6,"What must it never do?","Lose someone's details? Ask for a password? Take more than a minute? Name the line it must not cross.","Engage","One rule per answer.","keep","Treat the winning answers as hard rules. If a later direction would break one, say so before you build."
"Start",7,"It is launch day. Write the headline.","Some teams start a product by writing the news story first, then build what the story promises. Write the headline a local paper would run on the day this goes live.","Working backwards (Amazon)","Under 12 words.","keep","Read the winning headline as the promise the product has to keep, and build toward it."
"Think differently",8,"How could we reach the same goal a completely different way?","Forget what is on the screen. If we started again with the same goal, what would we build instead?","Engage","Describe the other way in one or two sentences.","ask","In a few lines, say how you would build the winning approach and what it would cost next to the current one. Do not switch unless a Do now says so."
"Think differently",9,"How would we do this with no app at all?","A paper sheet on a door, a text message, a phone call round. What would work, and what would we lose?","Engage","Name the low-tech way and what it does well.","ask","Say which part of the winning answer the build could borrow, if any, and what it would replace."
"Think differently",10,"Who has solved this already, in a different field?","A restaurant booking, a doctor's appointment, a parcel on its way. What do they do that we could borrow?","Engage","Name the example and the one thing worth borrowing.","ask","Say what you would borrow from the winning example and where it would go on the screen."
"Think differently",11,"How would we make sure nobody ever used it?","Turn the problem around: list the surest ways to make it fail. Then we avoid them.","Inversion (Charlie Munger)","One sure way to fail per answer.","keep","Turn each winning answer into a rule in the brief: the opposite of how to fail."
"Think differently",12,"What would make this ten times better, not ten percent?","Small improvements come from polishing. Ten times better usually means doing it a different way.","Ten times, not ten percent (Astro Teller, Wired, 2013)","Be bold; say what would have to be true.","later","Put the winning idea on the Later list, and say what the first small step toward it would be."
"While building",13,"What would stop someone using it?","Think of the busiest person you know, on an old phone, in a hurry. Where do they give up?","Engage","Name the moment they give up, not a feature you want.","do-now","Fix the top answer first. Say in one line what you changed."
"While building",14,"What is confusing on the screen right now?","Look at what is on the wall. What did you have to read twice?","Engage","Point at one thing on the screen.","do-now","Treat each answer as a specific problem. Fix the top one and show it before and after."
"While building",15,"What should we cut?","A thing is finished not when nothing more can be added, but when nothing more can be taken away. What on the screen could go?","Saint-Exupéry, Terre des hommes (1939)","One thing per answer.","do-now","Remove the winning item unless it breaks a Keep in mind rule. Say what you removed."
"Before wrapping up",16,"A month from now, nobody uses it. Why?","Imagine it launched and failed. People find risks faster when they explain a failure that has already happened than when they guess at one that might.","Pre-mortem (Gary Klein, 2007)","Give the reason, as if it had happened.","later","Add the top reasons to the Later list as risks. Say which ones today's build already causes."
"Before wrapping up",17,"What should we build next time?","The one thing you would want on the screen at the start of the next session.","Engage","One thing.","later","Put the winning answers on the Later list for the next session."
```

## Build Room pulse (Poll, rating 1–5)

| # | Category | Question | 1 means | 5 means | Claude gets | Note for Claude |
|---|---|---|---|---|---|---|
| 1 | While building | How close is this to something you would use? | Not yet | I would use it today | keep | Use the average and the reasons to decide whether to keep polishing or move on. Say which. |
| 2 | While building | How clear is the main screen? | I was lost | It was obvious | keep | If the average is under 4, fix the reason given most often before adding anything. |
| 3 | Before wrapping up | Would you use this tomorrow? | No | Yes, for real | keep | Put this score and its top reason in the wrap-up summary. |

Poll rows follow the poll importer's header: the base columns, then the typed-poll
columns (`Kind`, `Scale`, `LowLabel`, `HighLabel`; the others are left empty), then the
two Build Room columns. Each row has `Kind` = `rating` and `Scale` = `1-5`. The exact
column order is the one `SURVEY_CSV_HEADER` writes (`admin/shared/survey-kinds.js`);
step 7b generates the file with the exporter rather than by hand.

## Notes on the choices

- **Why Ideas for most.** A Build Room learns most from the room's own words. A vote then
  turns many answers into one sentence Claude can act on.
- **Why the Start questions are Keep in mind.** They set the audience, the finish line and
  the rules. Claude needs them on every call, not once.
- **What is left out.**
  - "Which should Claude build next?" is not a stored question. It is the built-in
    "Put Later to a vote" (C14), whose options are the room's own Later list.
  - Team-specific questions belong in a team's own `build-room` sets.
