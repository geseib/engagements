# Installed: Famous Art Titles, neutral-named images

## Round 3 (8 Nov 2026): dev v6 → v7, teaser Titles

Dev only. The 60 Titles changed from artist and date to short teasers (README, "Round 3").
Test and prod were not touched.

1. Re-read the live dev set (v6) and wrote `famous-art-titles-dev-v7.csv` from it. Every
   column is as stored except Title.
2. Ran `node scripts/replace-question-set.js engagedev famousarttitles --csv
   sets/famous-art-titles-2026-11/famous-art-titles-dev-v7.csv --note "..."`, first as a dry
   run (60 questions, 8 categories, 0 skipped), then with `--apply`. The live version is
   now **v7**, and v6 is kept.
3. **Read-back, v7 against v6, all 68 rows on every attribute:** exactly 60 differences,
   all of them Title, one per question. Image is unchanged on every row. On the SETS row only
   `activeVersion`, `versions`, `updatedAt` and `sourceFile` changed.

## Round 2 (8 Nov 2026): installed on dev, test and prod

The owner approved the three swaps, prod's images, the category rename on test and prod
(Ukiyo-e → Asian Art) and prod's new hint and reveal for the Tōhaku row. See README,
"Round 2". The tiers were done in order, each verified before the next.

| Tier | Set | Old → new | Images in the CSV (uploaded to `<stack>-media/sets/famousarttitles/`) | CSV |
|---|---|---|---|---|
| dev | `famousarttitles` | v5 → **v6** | 60, including new `fat-61`, `fat-62`, `fat-63` | `famous-art-titles-dev-v6.csv` |
| test | `famousarttitles` | v2 → **v3** | 10, including new `fat-62` | `famous-art-titles-test-v3.csv` |
| prod | `famousarttitlesimported20260815` | unversioned → **v2** (the script first snapshotted the 18 legacy rows to v1) | 10, served from `https://engage.seibtribe.us/sets/famousarttitles/` | `famous-art-titles-prod-v2.csv` |

For each tier:
1. Re-read the live active version and rebuild the CSV from it. All three rebuilt CSVs
   matched the committed ones byte for byte.
2. Upload, then fetch each URL in the CSV. Every one returned 200 `image/jpeg`, and the
   served bytes equal the file (`image-check-*.json`).
3. Run `replace-question-set.js` as a dry run, then with `--apply`. 0 rows were skipped on
   any tier.
4. Read back, comparing the new version with the old one on every attribute of every row.

### Read-back

| Tier | Image changed | Other differences (all intended) |
|---|---|---|
| dev v6 vs v5 | 3 rows (the swaps) | Title and AnswerDetails on `c002#011` (Caillebotte), `c003#001` (Tōhaku) and `c004#011` (Gainsborough). Nothing else. |
| test v3 vs v2 | 1 row | On `c003#001`: Title, School, AnswerDetails, Category. On the `CATEGORY#c003` row: Name and Description (Ukiyo-e → Asian Art). Nothing else. |
| prod v2 vs legacy | 10 rows (blank → image) | On `c003#001`: Title, CustomInstructions, Category, and AnswerDetails (added). On `CATEGORY#c003`: Name and Description. Nothing else. |

- **SETS rows:** besides `activeVersion`, `versions`, `updatedAt` and `sourceFile`, the only
  change is prod's `hasImages`, which went from false to true. Name, description, persona,
  prompt, topic, tags, active and the instructions are unchanged on all three tiers.
- **Live Images:** every one is a neutral `fat-NN.jpg` on the tier's own site and serves
  image/jpeg. Dev has 60 distinct, test 10 and prod 10.

To undo round 2: make dev v5, test v2 or prod v1 live again from the set's Versions. Prod
v1 has no images.

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
