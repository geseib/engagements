# Installed: What Is This Thing?

## Test (8 Nov 2026): Image URLs moved to engage.test

The set was promoted to **test** (`engagetest`, platform `SETS`) through the Archive
(archive `2a3cdb83-5ef7-4f00-8c32-e8ef25b85e06`, exported from dev at 2026-11-08T11:17:22.251Z). The restore
created v1, but every Image still pointed at `https://engage.dev.seibtribe.us/sets/whatisthisthing/`,
because the restore copied no media.

1. Copied all 24 images from `s3://engagedev-media/sets/whatisthisthing/` to
   `s3://engagetest-media/sets/whatisthisthing/`, keeping the same neutral names, with
   `Content-Type: image/jpeg`.
2. Fetched each `https://engage.test.seibtribe.us/sets/whatisthisthing/<file>`. All 24 returned 200
   `image/jpeg`, with the same bytes as the dev copy (`image-check-test.json`).
3. Wrote `what-is-this-thing-test-v2.csv` from the **live test v1** rows. Every column (RealAnswer included) is
   as stored. Only the Image host changes.
4. Ran `node scripts/replace-question-set.js engagetest whatisthisthing --csv sets/call-answer-2026-11/what-is-this-thing-test-v2.csv
   --note "Image URLs moved from engage.dev to engage.test ..."`: first as a dry run
   (24 questions, 6 categories, 0 skipped), then with `--apply`. The live version is now **v2**,
   and v1 is kept.

**Read-back:**
- v2 was compared with v1 on every attribute of all 30 rows. **0 mismatches** apart from
  Image, which changed on all 24 questions.
- On the SETS row only `activeVersion`, `versions`, `updatedAt` and `sourceFile` changed.
  `promptId` `mw6p9gjq5wzczhymlke`, `bluffRound: true`, `roundNoun` `Invention`, `personaId` `comedian`, topic, tags, instructions and `active` are as restored.
- Every live Image is on engage.test and serves image/jpeg.

Dev and prod were not touched. Nothing was pushed or deployed.

**Dev only** (`engagedev`), in the platform Engage library (`SETS` partition).
(This section was written on 7 Nov, when the set existed only on dev. For test, see above.)

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
