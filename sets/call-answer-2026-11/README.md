# What Is This Thing?

A Call & Answer set for Engage. Each round shows a public-domain patent drawing of a
strange or surprising invention. Players write what they think it does, vote for the
best guess, and at RESULTS Workie reveals the real answer and the story behind it.

24 questions in 6 categories of 4: Wearables, Kitchen & Home, Getting Around,
Pets & Animals, Fun & Games, Just Why?. The patents run from 1840 to 1923, and two
are not American (a German pigeon camera and a British golf tee).

## Files

| File | What it is |
|---|---|
| `what-is-this-thing.csv` | The set, in the art-title column layout plus `RealAnswer` |
| `what-is-this-thing.json` | Per question: Commons file and page, licence, patent, inventor, year, image URL, how it was verified |
| `images/*.jpg` | 17 drawings cropped to the figure, so the printed invention name is gone |
| `images/cropspec.json` | The crop box and blanked areas for each image, as fractions of the Commons thumbnail |
| `QA-NOTES.md` | What was checked, what was changed, and the known gaps |
| `INSTALLED.md` | Where it is installed and how it read back |

## Columns

- **Title**: a short teaser that is never the answer ("WEAR IT ON YOUR HEAD?").
- **Detail_lesson**: left blank. Players see Detail during ASK, so anything there
  would spoil the round.
- **School**: inventor and year. This is not shown while players answer. It appears
  only in the post-round report (`RoundReport`, `RoundReportSections`), after the reveal.
- **CustomInstruction**: the same player prompt on every row ("What does this invention
  do? ..."). Without it the player screen falls back to the art-title instruction
  ("Name this work of art"), because the rows carry an image.
- **AnswerDetails**: `Real answer: <what it is>, patented by <inventor>, <year>
  (<patent>). <story>`. Read only by Workie at RESULTS.
- **RealAnswer**: the answer in one plain sentence, for the bluff-round twist
  (`docs/design/bluff-round/README.md`). Like AnswerDetails, no player or host
  payload carries it.
- **Image**: 7 rows hot-link a Commons `Special:FilePath/...?width=900` URL, as the
  art set does. Those files are already figure-only. The other 17 point at
  `https://engage.dev.seibtribe.us/sets/whatisthisthing/<file>.jpg`, a crop served
  from the dev media bucket.

## Why most images are crops

A full US patent sheet prints the inventor and **the name of the invention** across the
top ("SALUTING DEVICE", "COW-TAIL HOLDER"). Many National Archives sheets also carry a
handwritten title in the margin or a pasted Gazette clipping. On the projector that
gives the answer away. So each sheet was cropped to the drawing, with any clipping
inside the crop blanked. The original Commons file for every crop is recorded in the
JSON sidecar.

## Install

Install with the app's own importer, on dev only:

```bash
node scripts/install-question-set.js engagedev sets/call-answer-2026-11/what-is-this-thing.csv \
  --type call-and-answer --title "What Is This Thing?" --topic science-technology \
  --description "Real patent drawings of strange and surprising inventions. Guess what each one does, vote for the best guess, then Workie reveals the real answer and its story." \
  --persona comedian --tags inventions,patents,history,icebreaker          # dry run; add --apply to write
```

Then upload `images/*.jpg` to `s3://<stack>-media/sets/whatisthisthing/` with
`Content-Type: image/jpeg`. Set `promptId`, `aiContextInstruction` and
`roundNoun` on the SETS row as `INSTALLED.md` records, because the importer does not
write them.

For another tier, the 17 crop URLs must be rewritten to that tier's domain, or turned
into bare filenames once keyed media renders correctly (see QA-NOTES, known gaps).
