# Installed: Uffizi Art Titles

## Prod (8 Nov 2026): installed as a new set

Owner-approved. Installed on **prod** (`engageprod`, platform `SETS` library) as a new set
`uffiziarttitles`, at **v1**. No set with that id existed on prod beforehand. Prod's Archive cannot
copy images on its older code, so this was done by hand, the same way as prod's Famous Art
Titles.

1. Re-read the **live dev** set (its active version, v2) and wrote `uffizi-art-titles-prod.csv` from it. Every
   column (RealAnswer included) is as stored on dev. Only the Image host changes, to
   `https://engage.seibtribe.us/`.
2. Copied all 60 images from `s3://engagedev-media/sets/uffiziarttitles/` to
   `s3://engageprod-media/sets/uffiziarttitles/` under the same neutral names, with
   `Content-Type: image/jpeg`. Each prod URL returned 200 `image/jpeg`, with the same bytes as
   dev (`image-check-prod.json`).
3. Ran `node scripts/install-question-set.js engageprod sets/uffizi-2026-11/uffizi-art-titles-prod.csv --type call-and-answer
   --title "Uffizi Art Titles" --topic arts-culture --description "..." --persona comedian --tags art-history,painting,uffizi,renaissance`, first
   as a dry run (60 questions, 6 categories, 0 skipped), then with `--apply`.
4. Set `bluffRound: false` and `promptId` on the SETS row, because the installer writes none of them.

**Read-back against dev:**
- All 66 rows (questions and categories) were compared by SK on every attribute, with
  Image compared after the host swap: **0 mismatches**. RealAnswer is stored on every row.
- The SETS row matches dev on name, description, type, active, topic, tags, persona,
  `bluffRound: false`, instructions, question and category counts and hasImages. It has no ttl. Only
  `promptId` differs, as described below.
- Every prod Image is on engage.seibtribe.us and serves image/jpeg.

**What prod's older code does with these fields:** `bluffRound` and RealAnswer are stored,
but prod's code from before the bluff round may ignore them until its next deploy.

**Prompt.** The set points at prod's **"Art & Creative Titles - Naming Celebration"**
(`mvru8w1qz3hhl8oqlqn`). That is prod's copy of the art prompt. On dev the set uses `mskc5h7boibe5abg15`, the dev copy of the
same prompt (matched by name, as the Archive matched it on test).

Dev and test were not touched. Nothing was pushed or deployed.

## Test (8 Nov 2026): Image URLs moved to engage.test

The set was promoted to **test** (`engagetest`, platform `SETS`) through the Archive
(archive `0363c9a8-e34e-4a49-87f7-24d25544fef1`, exported from dev at 2026-11-08T11:17:22.471Z). The restore
created v1, but every Image still pointed at `https://engage.dev.seibtribe.us/sets/uffiziarttitles/`,
because the restore copied no media.

1. Copied all 60 images from `s3://engagedev-media/sets/uffiziarttitles/` to
   `s3://engagetest-media/sets/uffiziarttitles/`, keeping the same neutral names, with
   `Content-Type: image/jpeg`.
2. Fetched each `https://engage.test.seibtribe.us/sets/uffiziarttitles/<file>`. All 60 returned 200
   `image/jpeg`, with the same bytes as the dev copy (`image-check-test.json`).
3. Wrote `uffizi-art-titles-test-v2.csv` from the **live test v1** rows. Every column (RealAnswer included) is
   as stored. Only the Image host changes.
4. Ran `node scripts/replace-question-set.js engagetest uffiziarttitles --csv sets/uffizi-2026-11/uffizi-art-titles-test-v2.csv
   --note "Image URLs moved from engage.dev to engage.test ..."`: first as a dry run
   (60 questions, 6 categories, 0 skipped), then with `--apply`. The live version is now **v2**,
   and v1 is kept.

**Read-back:**
- v2 was compared with v1 on every attribute of all 66 rows. **0 mismatches** apart from
  Image, which changed on all 60 questions.
- On the SETS row only `activeVersion`, `versions`, `updatedAt` and `sourceFile` changed.
  `promptId` `mupjs2kx1yhsr6kgenz`, `bluffRound: false`, `personaId` `comedian`, topic, tags, instructions and `active` are as restored.
- Every live Image is on engage.test and serves image/jpeg.

Dev and prod were not touched. Nothing was pushed or deployed.

**Dev** (`engagedev`), in the platform Engage library (`SETS` partition). (This section was written on 7 Nov, when the set existed only on dev. For test, see above.)

| | |
|---|---|
| set id | `uffiziarttitles` |
| live version | **v2** (7 Nov 2026, independent-review fixes and off-display swaps). v1 is kept in the set's Versions. |
| name | Uffizi Art Titles |
| type | call-and-answer, active, `bluffRound: false` (a host can switch it on per session) |
| topic | `arts-culture` |
| tags | art-history, painting, uffizi, renaissance |
| persona | `comedian` (The Comedian), as on Famous Art Titles |
| prompt | `mskc5h7boibe5abg15`, "Art & Creative Titles - Naming Celebration", as on Famous Art Titles |
| roundNoun / aiContextInstruction | none / empty, as on Famous Art Titles |
| questions | 60 in 6 categories (10 each), 0 skipped rows |
| media | `s3://engagedev-media/sets/uffiziarttitles/uffizi-NN.jpg` (`image/jpeg`), served at `https://engage.dev.seibtribe.us/sets/uffiziarttitles/`. v2 uses 53 of v1's files plus `uffizi-61` to `uffizi-67`. |

## v1 (7 Nov 2026)

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

## v2 (7 Nov 2026)

1. Uploaded the 60 images to `engagedev-media` under `sets/uffiziarttitles/`. Seven are new
   (`uffizi-61` to `uffizi-67`); the other 53 were re-put with identical bytes.
2. Ran `scripts/replace-question-set.js engagedev uffiziarttitles --csv
   sets/uffizi-2026-11/uffizi-art-titles.csv --note "Independent review fixes: ..."`:
   - first as a dry run, which reported 60 questions, 6 categories, version 2 and 0 skipped;
   - then with `--apply`.

   The set's other settings were left untouched. The script reported that
   `CHECK_FUNCTION_NAME` is not set, so its optional content check did not run. The same
   happened in What Is This Thing?'s run.

## Read-back of v2

- **SETS row:**
  - `activeVersion=2`, `active=true`, `bluffRound=false`
  - `engagementType=call-and-answer`, `topic=arts-culture`, the 4 tags
  - `personaId=comedian`, `promptId=mskc5h7boibe5abg15`
  - `aiContextInstruction=""`, `customInstruction=""`
  - `questionCount=60`, `categoryCount=6`, `hasImages=true`, no `ttl`
- **Questions:** all 60 rows of `SET#uffiziarttitles#v2` were compared with the CSV on
  Category, Title, School, CustomInstructions, AnswerDetails, RealAnswer, Image and Detail.
  **0 mismatches.**
- **Images:** 60 of 60 URLs returned 200 `image/jpeg` (`image-check.json`). Every URL is a
  neutral `uffizi-NN.jpg`, and the seven new ones are numbered 61 to 67.

## To undo

Make v1 live again from the set's Versions. To remove the set entirely, delete it in the
console (or delete `PK=SETS, SK=SET#uffiziarttitles` and the `SET#uffiziarttitles#v1` and
`#v2` partitions), then remove `s3://engagedev-media/sets/uffiziarttitles/`.
