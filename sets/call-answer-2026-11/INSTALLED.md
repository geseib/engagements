# Installed: What Is This Thing?

**Dev only** (`engagedev`), 7 Nov 2026, in the platform Engage library (`SETS`
partition). Nothing was installed on test or prod, and nothing was pushed or deployed.

| | |
|---|---|
| set id | `whatisthisthing` (version 1) |
| name | What Is This Thing? |
| type | call-and-answer, active |
| topic | `science-technology` |
| tags | inventions, patents, history, icebreaker |
| persona | `comedian` (The Comedian), as on Famous Art Titles |
| prompt | `mskc5h7boibe5abg15`, "Art & Creative Titles - Naming Celebration", as on Famous Art Titles |
| aiContextInstruction | Tells Workie these are patent drawings: "title" means guess, "real title" means real answer |
| roundNoun | `Invention`, so screens say "Invention 3" rather than "Artwork 3" |
| questions | 24 in 6 categories (4 each), 0 skipped rows |
| media | 17 crops at `s3://engagedev-media/sets/whatisthisthing/*.jpg`, served at `https://engage.dev.seibtribe.us/sets/whatisthisthing/` |

## How it was installed

1. Dry run of `scripts/install-question-set.js`: 24 questions, 6 categories, 0 skipped.
   The persona was found and active.
2. Uploaded `images/*.jpg` to `engagedev-media` with `Content-Type: image/jpeg`.
3. Ran the same command with `--apply`. The script wrote `personaId`.
4. Wrote `promptId`, `aiContextInstruction` and `roundNoun` on the `SETS` /
   `SET#whatisthisthing` row. The importer writes none of these three.

## Read-back

- **SETS row**: `active=true`, `engagementType=call-and-answer`,
  `topic=science-technology`, the 4 tags, `personaId=comedian`,
  `promptId=mskc5h7boibe5abg15`, `roundNoun=Invention`, `questionCount=24`,
  `categoryCount=6`, `hasImages=true`, no `ttl`.
- **Questions**: all 24 rows of `SET#whatisthisthing#v1` were compared with the CSV on
  Category, Title, School, CustomInstructions, AnswerDetails, RealAnswer, Image and
  Detail. **0 mismatches.**
- **Images**: 22 of 24 URLs returned `image/*`. The other 2 were Wikimedia rate limits
  (HTTP 429), not missing files; see QA-NOTES.

## To undo

Delete the set in the console (Question sets, What Is This Thing?, Delete). Then remove
`s3://engagedev-media/sets/whatisthisthing/`.
