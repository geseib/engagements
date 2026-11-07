# Installed: Uffizi Art Titles

**Dev only** (`engagedev`), in the platform Engage library (`SETS` partition). Nothing was
installed on test or prod, and nothing was pushed or deployed.

| | |
|---|---|
| set id | `uffiziarttitles` |
| live version | v1 (7 Nov 2026) |
| name | Uffizi Art Titles |
| type | call-and-answer, active, `bluffRound: false` (a host can switch it on per session) |
| topic | `arts-culture` |
| tags | art-history, painting, uffizi, renaissance |
| persona | `comedian` (The Comedian), as on Famous Art Titles |
| prompt | `mskc5h7boibe5abg15`, "Art & Creative Titles - Naming Celebration", as on Famous Art Titles |
| roundNoun / aiContextInstruction | none / empty, as on Famous Art Titles |
| questions | 60 in 6 categories (10 each), 0 skipped rows |
| media | `s3://engagedev-media/sets/uffiziarttitles/uffizi-01.jpg` to `uffizi-60.jpg` (`image/jpeg`), served at `https://engage.dev.seibtribe.us/sets/uffiziarttitles/` |

## Steps (7 Nov 2026)

1. Uploaded the 60 images to `engagedev-media` under `sets/uffiziarttitles/`, with
   `Content-Type: image/jpeg`. Each upload was confirmed with HeadObject.
2. Ran `scripts/install-question-set.js engagedev sets/uffizi-2026-11/uffizi-art-titles.csv
   --type call-and-answer --title "Uffizi Art Titles" --topic arts-culture --description
   "..." --persona comedian --tags art-history,painting,uffizi,renaissance`:
   - first as a dry run, which reported 60 questions, 6 categories, 67 rows and 0 skipped,
     and found the comedian persona active;
   - then with `--apply`.
3. Set `promptId = mskc5h7boibe5abg15` and `bluffRound = false` on the SETS row. The
   importer writes neither. The prompt id was read from Famous Art Titles' row at the time.

## Read-back

- **SETS row:**
  - `activeVersion=1`, `active=true`, `bluffRound=false`
  - `engagementType=call-and-answer`, `topic=arts-culture`, the 4 tags
  - `personaId=comedian`, `promptId=mskc5h7boibe5abg15`
  - `aiContextInstruction=""`, `customInstruction=""`
  - `questionCount=60`, `categoryCount=6`, `hasImages=true`, no `ttl`
- **Questions:** all 60 rows of `SET#uffiziarttitles#v1` were compared with the CSV on
  Category, Title, School, CustomInstructions, AnswerDetails, RealAnswer, Image and Detail.
  **0 mismatches.**
- **Images:** 60 of 60 URLs returned 200 `image/jpeg` (`image-check.json`). Every URL is a
  neutral `uffizi-NN.jpg`.

## To undo

Delete the set in the console (or delete `PK=SETS, SK=SET#uffiziarttitles` and the
`SET#uffiziarttitles#v1` partition). Then remove `s3://engagedev-media/sets/uffiziarttitles/`.
