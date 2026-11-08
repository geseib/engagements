# Installed: Famous Art Titles, neutral-named images

## Round 2 (8 Nov 2026): prepared, NOT installed

The three swaps and prod's images (README, "Round 2") are ready as CSVs and images in this
package. They have not been written to any tier, because the AWS credentials had expired.
Nothing below this section has changed. The plan, in order, each tier verified before the next:

| Tier | Expected change | Upload to the tier's media bucket | CSV |
|---|---|---|---|
| dev | v5 → v6 | `fat-61`, `fat-62`, `fat-63` | `famous-art-titles-dev-v6.csv` |
| test | v2 → v3 | `fat-62` | `famous-art-titles-test-v3.csv` |
| prod | unversioned → v2 (v1 = snapshot of the legacy rows) | the 9 kept images plus `fat-62` (10 files) | `famous-art-titles-prod-v2.csv` |

For each tier:
1. Re-read the live active version and rebuild the CSV from it. If anything other than the
   intended fields differs from the committed CSV, stop and say so.
2. Upload, then fetch each URL. Each must return 200 `image/jpeg`, and the served bytes must
   equal the file.
3. Run `replace-question-set.js` as a dry run, then with `--apply`.
4. Read back. The only differences allowed are Image on every row, and on the swapped rows
   Title, AnswerDetails, Image (plus School on test; Category on test and prod; CustomInstruction
   on prod).

## Round 1 (7 Nov 2026)

7 Nov 2026. Platform Engage library (`SETS` partition), set id `famousarttitles` on dev and
test. Each tier got a new version from `scripts/replace-question-set.js`. The old version
is kept in the set's Versions. Nothing was pushed or deployed.

| Tier | Set | Old → new | Questions | Images uploaded | Served from |
|---|---|---|---|---|---|
| dev (`engagedev`) | Famous Art Titles | v4 → **v5** | 60 in 8 categories | 60 to `s3://engagedev-media/sets/famousarttitles/` | `https://engage.dev.seibtribe.us/sets/famousarttitles/fat-NN.jpg` |
| test (`engagetest`) | Famous Art titles | unversioned → **v2** (legacy rows first snapshotted to v1 by the script) | 10 in 8 categories | 10 to `s3://engagetest-media/sets/famousarttitles/` | `https://engage.test.seibtribe.us/sets/famousarttitles/fat-NN.jpg` |
| prod (`engageprod`) | Famous Art Titles (Imported 2026-08-15), `famousarttitlesimported20260815` | **not changed** | 10 | none | — |

**Why prod was not changed:** every prod row has an empty Image (`hasImages: false`), so
there is no URL to leak. Its rows also have no AnswerDetails and an empty School. Adding
images there would add content, not fix a leak.

**Copies elsewhere:** none. All three tables were scanned for `SET#` rows named like the
set, for question rows with the set's titles or "Mona Lisa" in AnswerDetails, and for any
Image containing `wikimedia` or `Special:FilePath`. Nothing turned up in `PUBLIC#SETS` or
any org partition. The only other Commons-linked rows are dev `SET#whatisthisthing#v1`,
the superseded version of the What Is This Thing? set. They were left alone.

## Commands

```bash
node scripts/replace-question-set.js engagedev famousarttitles \
  --csv sets/famous-art-titles-2026-11/famous-art-titles-dev-v5.csv \
  --note "Images re-hosted under neutral names (the Commons filenames named the paintings); The Nightmare now shows Fuseli's painting. No other field changed."
node scripts/replace-question-set.js engagetest famousarttitles \
  --csv sets/famous-art-titles-2026-11/famous-art-titles-test-v2.csv \
  --note "Images re-hosted under neutral names (the Commons filenames named the paintings). No other field changed."
```

Each was run as a dry run first (dev: 60 questions, 8 categories, 0 skipped; test: 10, 8,
0), then with `--apply`. The images were uploaded first, with `Content-Type: image/jpeg`,
and every URL was fetched before installing.

## Read-back

Each new version was compared row by row (same SK) with the version it replaced, on every
attribute.

- **dev v5 vs v4:** 68 rows each (60 questions, 8 categories). **0 mismatches** apart from
  Image, which changed on all 60 questions.
- **test v2 vs the legacy rows:** 18 rows each (10 questions, 8 categories). **0 mismatches**
  apart from Image, which changed on all 10. The importer adds empty `Tags`, `RoundKind`,
  `ClaudeGets`, `ClaudeNote` and `Source*` attributes to every row, and these were counted as
  equal to absent.
- **SETS rows:** on both tiers, only `activeVersion`, `versions`, `updatedAt` and
  `sourceFile` changed. Name, description, customInstruction, personaId (dev `comedian`),
  promptId (dev `mskc5h7boibe5abg15`), topic, tags, active, Quickstart and engagementType
  are as they were. Neither set has `bluffRound` or `roundNoun`, before or after.
- **Images:** every live Image is `https://<tier site>/sets/famousarttitles/fat-NN.jpg`.
  Each returned 200 `image/jpeg`, and the served bytes equal the files in `images/`
  (dev 60 of 60, test 10 of 10). See `image-check-*.json`.

## To undo

Make the old version live again from the set's Versions (dev v4, test v1). That brings back
the Commons URLs, and with them the leak. The uploaded files can stay: no URL names a painting.
