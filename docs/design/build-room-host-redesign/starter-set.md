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

Categories group the questions in the host's picker (C13): **Start**, **While building**,
**Before wrapping up**.

`ClaudeGets` is one of `do-now`, `keep`, `later` or `ask` (RATIONALE §10b). `ClaudeNote`
is how Claude should use the decided answer; it is never shown to the room. `School`
holds where a question comes from, for the host's eyes only.

Copy rules: plain words, concrete, no emoji, and phone, laptop or tablet when devices are
named. Every attribution was checked:

- **Working backwards:** Amazon starts a product by writing the press release first.
- **Pre-mortem:** Gary Klein, "Performing a Project Premortem", *Harvard Business
  Review*, September 2007.
- **Saint-Exupéry:** *Terre des hommes* (1939, in English *Wind, Sand and Stars*):
  perfection is reached "not when there is nothing more to add, but when there is
  nothing left to take away". On the wall the question cites no one; the detail
  paraphrases the line.

## Build Room starters (Call and Answer)

| # | Category | Question | Claude gets | Note for Claude |
|---|---|---|---|---|
| 1 | Start | Who is this for, in one sentence? | keep | Treat the winning answer as the audience for every screen and every word on it. |
| 2 | Start | What does done look like by the end of today? | keep | Use this as the finish line. When it is true, say so and suggest wrapping up. |
| 3 | Start | What must it never do? | keep | Treat the winning answers as hard rules. If a later direction would break one, say so before you build. |
| 4 | Start | It is launch day. Write the headline. | keep | Read the winning headline as the promise the product has to keep, and build toward it. |
| 5 | While building | What would stop someone using it? | do-now | Fix the top answer first. Say in one line what you changed. |
| 6 | While building | What is confusing on the screen right now? | do-now | Treat each answer as a specific problem. Fix the top one and show it before and after. |
| 7 | While building | What should we cut? | do-now | Remove the winning item unless it breaks a Keep in mind rule. Say what you removed. |
| 8 | Before wrapping up | A month from now, nobody uses it. Why? | later | Add the top reasons to the Later list as risks. Say which ones today's build already causes. |
| 9 | Before wrapping up | What should we build next time? | later | Put the winning answers on the Later list for the next session. |

```csv
Category,Question#,Title,Detail_lesson,School,CustomInstruction,ClaudeGets,ClaudeNote
"Start",1,"Who is this for, in one sentence?","Name a real kind of person and the moment they would use it. ""Busy volunteers on a Saturday morning"" helps Claude more than ""everyone"".","Engage","One sentence: a person and a moment.","keep","Treat the winning answer as the audience for every screen and every word on it."
"Start",2,"What does done look like by the end of today?","Not everything it could become. What could someone do with it when this session ends?","Engage","Start with ""Someone can..."".","keep","Use this as the finish line. When it is true, say so and suggest wrapping up."
"Start",3,"What must it never do?","Lose someone's details? Ask for a password? Take more than a minute? Name the line it must not cross.","Engage","One rule per answer.","keep","Treat the winning answers as hard rules. If a later direction would break one, say so before you build."
"Start",4,"It is launch day. Write the headline.","Some teams start a product by writing the news story first, then build what the story promises. Write the headline a local paper would run on the day this goes live.","Working backwards (Amazon)","Under 12 words.","keep","Read the winning headline as the promise the product has to keep, and build toward it."
"While building",5,"What would stop someone using it?","Think of the busiest person you know, on an old phone, in a hurry. Where do they give up?","Engage","Name the moment they give up, not a feature you want.","do-now","Fix the top answer first. Say in one line what you changed."
"While building",6,"What is confusing on the screen right now?","Look at what is on the wall. What did you have to read twice?","Engage","Point at one thing on the screen.","do-now","Treat each answer as a specific problem. Fix the top one and show it before and after."
"While building",7,"What should we cut?","A thing is finished not when nothing more can be added, but when nothing more can be taken away. What on the screen could go?","Saint-Exupéry, Terre des hommes (1939)","One thing per answer.","do-now","Remove the winning item unless it breaks a Keep in mind rule. Say what you removed."
"Before wrapping up",8,"A month from now, nobody uses it. Why?","Imagine it launched and failed. People find risks faster when they explain a failure that has already happened than when they guess at one that might.","Pre-mortem (Gary Klein, 2007)","Give the reason, as if it had happened.","later","Add the top reasons to the Later list as risks. Say which ones today's build already causes."
"Before wrapping up",9,"What should we build next time?","The one thing you would want on the screen at the start of the next session.","Engage","One thing.","later","Put the winning answers on the Later list for the next session."
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
