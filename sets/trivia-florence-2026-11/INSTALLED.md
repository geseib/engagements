# Florence trivia, November 2026

Installed into the platform "Engage" library (`SETS` partition) on **dev only**
(table `engagedev`), using `scripts/install-question-set.js`, which runs the
app's own `admin/upload-questions.js`. A dry run came first: 60 questions,
6 categories, 0 skipped rows, 67 rows to write. Settings: active, topic from
`manifest.json`, no persona (so the default trivia prompt,
`AIPROMPT#msnyftpytpylfb3i9c9`, "Trivia - Round Call"), no quickstart, the tags
below, no ttl on the row.

| id | title | topic | tags | dev | test | prod |
|---|---|---|---|---|---|---|
| `florenceciaofirenze` | Florence: Ciao, Firenze! | geography-travel | florence, italy, renaissance, travel | 7 Nov 2026 | not installed | not installed |

Read back from the table on 7 Nov 2026. The SETS row has name, description,
topic, tags, `active=true`, `engagementType=trivia`, `questionCount=60`,
`categoryCount=6` and `activeVersion=1`. It has no `personaId`, no `quickstart`
and no `ttl`. Under `SET#florenceciaofirenze#v1` there are 60 QUESTION rows and
6 CATEGORY rows. Each question was compared with `florence-trivia.json` on
title, the four options, correct answer, difficulty, category and answer
details, and checked for being active with no ttl. Result: **0 mismatches**.

**Version 2, same day.** The independent review's 10 minor fixes (see
`florence-qa.md`) were installed as a new version with
`scripts/replace-question-set.js engagedev florenceciaofirenze --csv <file> --note "..."`.
Dry run first (60 questions, 6 categories, 0 skipped, 67 writes held), then
`--apply`. The set is now on `activeVersion` 2 (`SET#florenceciaofirenze#v2`).
v1 is kept and can be made live again from the set's Versions. There is still
one SETS row, with name, description, topic, tags and active unchanged, and no
persona, quickstart or ttl. The read-back of v2 against the JSON found 60/60
questions, 6 categories and **0 mismatches**. The importer printed
"CHECK_FUNCTION_NAME is not set", which is expected when running from a
script; no content check ran.

Categories: Landmarks & the Duomo; The Medici & Renaissance People; Sculpture,
Art & Museums; Florentine Food & Drink; Curious Florence; Fashion, Football &
Modern Florence.

The JSON file keeps each question's sources. `florence-qa.md` is the content
review: the author's two passes (no subagent tool was available in the
authoring session), then a separate reviewer's pass (0 wrong, 0 ambiguous,
10 minor, all applied in v2).
Test and prod: not done. The earlier sets reached those tiers through the app's
Archive (export on dev, import on each tier), and that needs the owner's
say-so.

Command used:

```bash
node scripts/install-question-set.js engagedev sets/trivia-florence-2026-11/trivia-florence.csv --type trivia \
  --title "Florence: Ciao, Firenze!" --topic geography-travel \
  --description "<description from manifest.json>" --tags florence,italy,renaissance,travel [--apply]
```
