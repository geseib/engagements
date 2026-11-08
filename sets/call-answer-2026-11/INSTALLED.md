# Installed: What Is This Thing?

**Dev only** (`engagedev`), in the platform Engage library (`SETS` partition).
Nothing was installed on test or prod, and nothing was pushed or deployed.

| | |
|---|---|
| set id | `whatisthisthing` |
| live version | **v2** (7 Nov 2026, independent-review fixes). v1 is kept in the set's Versions. |
| name | What Is This Thing? |
| type | call-and-answer, active, `bluffRound: true` |
| topic | `science-technology` |
| tags | inventions, patents, history, icebreaker |
| persona | `comedian` (The Comedian), as on Famous Art Titles |
| prompt | `mskc5h7boibe5abg15`, "Art & Creative Titles - Naming Celebration", as on Famous Art Titles |
| aiContextInstruction | Tells Workie these are patent drawings: "title" means guess, "real title" means real answer |
| roundNoun | `Invention` |
| questions | 24 in 6 categories (4 each), 0 skipped rows |
| media | `s3://engagedev-media/sets/whatisthisthing/witt-01.jpg` to `witt-24.jpg`, served at `https://engage.dev.seibtribe.us/sets/whatisthisthing/` |

## v1 (7 Nov 2026)

1. Ran `scripts/install-question-set.js` with `--persona comedian`, the four tags and
   `--apply`.
2. Uploaded 17 crops.
3. Set `promptId`, `aiContextInstruction` and `roundNoun` on the SETS row.

## v2 (7 Nov 2026)

1. Uploaded the 24 neutral-named images.
2. Ran `scripts/replace-question-set.js engagedev whatisthisthing --csv
   sets/call-answer-2026-11/what-is-this-thing.csv --note "Independent review fixes:
   ..."`, first as a dry run (24 questions, 6 categories, 0 skipped), then with
   `--apply`. The script left the set's details untouched.

## Read-back of v2

- **SETS row**: `activeVersion=2`, `active=true`, `bluffRound=true`,
  `engagementType=call-and-answer`, `topic=science-technology`, the 4 tags,
  `personaId=comedian`, `promptId=mskc5h7boibe5abg15`, `roundNoun=Invention`,
  `questionCount=24`, `categoryCount=6`, `hasImages=true`, no `ttl`.
- **Questions**: all 24 rows of `SET#whatisthisthing#v2` were compared with the CSV on
  Category, Title, School, CustomInstructions, AnswerDetails, RealAnswer, Image and
  Detail. **0 mismatches.**
- **Images**: 24 of 24 URLs returned 200 `image/jpeg`. Every URL is a neutral
  `witt-NN.jpg`.

## To undo

Make v1 live again from the set's Versions, or delete the set in the console. Then
remove `s3://engagedev-media/sets/whatisthisthing/`.
