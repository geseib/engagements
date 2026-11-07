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

Categories: Landmarks & the Duomo; The Medici & Renaissance People; Sculpture,
Art & Museums; Florentine Food & Drink; Curious Florence; Fashion, Football &
Modern Florence.

The JSON file keeps each question's sources. `florence-qa.md` is the content
review. It is the author's own two passes, not an independent review: no
subagent tool was available in the authoring session (see its first section).
Test and prod: not done. The earlier sets reached those tiers through the app's
Archive (export on dev, import on each tier), and that needs the owner's
say-so.

Command used:

```bash
node scripts/install-question-set.js engagedev sets/trivia-florence-2026-11/trivia-florence.csv --type trivia \
  --title "Florence: Ciao, Firenze!" --topic geography-travel \
  --description "<description from manifest.json>" --tags florence,italy,renaissance,travel [--apply]
```
