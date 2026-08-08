# engagedev question-set cleanup — 2026-08-08

Backup of every set taken before any change:
`backups/engagedev-sets-2026-08-08/` (814 `SET#` items + 29 index rows).

## Method

Audited the **live table**, not the repo CSVs — the two do not map 1:1.

One important correction along the way: a first pass reported *every* trivia set
as "unplayable, no options". That was wrong. Question attributes are stored
**lower-case** (`optionA`, `correctAnswer`, `difficulty`), not `OptionA` /
`CorrectAnswer`. Auditing on the capitalised names made 12 healthy sets look
broken. Anything scripted against these items must use the lower-case names.

Re-audited correctly: **9 of 29 sets had a real fault**, not 24.

## Deleted (3 sets, 49 rows)

Trivia with **no options at all** and a free-text `correctAnswer`. Unplayable —
the player gets a multiple-choice screen with nothing to choose — and
unrepairable, because the wrong answers do not exist anywhere to recover.

| Set | Questions |
|---|---|
| `genaitriviaforengineers` | 10 |
| `genaitriviaforsoftwareengineers` | 19 |
| `worldtraveltrivia` | 5 |

Deleted through the repaired `delete-question-set` lambda. Post-delete sweep:
26 index rows, 26 data partitions, **no orphans, no empty index rows**.

## Repaired, not deleted (1 set, 40 questions)

`americanhistorytriviaforallpeople` had options but stored the answer *text* in
`correctAnswer` ("The Spirit of St. Louis" instead of "OptionB"). Scoring
compares ``correctAnswer === `Option${answer}` ``, so **no answer could ever be
marked correct** — 40 questions that silently scored zero.

All 40 mapped unambiguously back to their option letter, so they were rewritten
in place rather than thrown away. Distribution afterwards: A 21, B 6, C 5, D 8.
The A-bias is a content issue, not a correctness one.

## Left alone — duplicates only, still playable

Worth cleaning, not worth deleting:

| Set | Duplicate questions |
|---|---|
| `completethissentencemoviesandmusic` | 3 of 50 |
| `genaiintrotriviatriviafortechprofessionals` | 2 of 20 |
| `listsfavoritesworkshop` | 2 of 20 |
| `historytriviaforgeneralaudience` | 1 of 20 |
| `sciencetriviaforeverybody` | 1 of 10 |

## Not a fault

The widespread `School = "Professional Development"` / `"School of …"` values and
missing `CustomInstructions` are cosmetic. They are fixed in `sets/cleaned/`,
which is the re-import path — deleting live sets over them would have destroyed
real content, including the 160-question Amazon set.

⚠️ Re-importing a cleaned set means deleting the live one first: there is still
no REPLACE path, and re-import of an existing id is a hard 400.
