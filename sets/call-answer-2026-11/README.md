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
| `images/witt-NN.jpg` | All 24 drawings, cropped to the figure, under neutral shuffled names (the sidecar maps each to its question) |
| `images/cropspec.json` | The crop box, blanked areas and rotation for each image (keyed by an internal crop name), as fractions of the source |
| `image-check.json` | The last URL check: each image URL, HTTP status and content type |
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
  (`docs/design/bluff-round/README.md`). It is withheld from the room until RESULTS.
  The one exception is by design: `get-question` sends it to the bluff holder's own
  phone.
- **Image**: every row points at
  `https://engage.dev.seibtribe.us/sets/whatisthisthing/witt-NN.jpg`, a crop served
  from the dev media bucket.

## Why every image is a neutral-named crop

The Image URL is in the public question payload. A player can see it by long-pressing
the picture or opening it in a new tab. So the URL must not name the answer: no
descriptive Commons filenames, and no descriptive crop names. The numbers are shuffled,
so they do not follow question order either.

The picture itself must not name the answer either. A full US patent sheet prints the
inventor and **the name of the invention** across the top ("SALUTING DEVICE",
"COW-TAIL HOLDER"). Many National Archives sheets also carry a handwritten title in the
margin, a pasted Gazette clipping, or a classification stamp with the patent number.
So each sheet was cropped to the drawing, and anything naming or numbering the
invention inside the crop was blanked. The source of every image (Commons file, or
Google Patents' full-size sheet for two of them) is recorded in the JSON sidecar.

## Install

Install with the app's own importer, on dev only:

```bash
node scripts/install-question-set.js engagedev sets/call-answer-2026-11/what-is-this-thing.csv \
  --type call-and-answer --title "What Is This Thing?" --topic science-technology \
  --description "Real patent drawings of strange and surprising inventions. Guess what each one does, vote for the best guess, then Workie reveals the real answer and its story." \
  --persona comedian --tags inventions,patents,history,icebreaker          # dry run; add --apply to write
```

Then upload `images/witt-*.jpg` to `s3://<stack>-media/sets/whatisthisthing/` with
`Content-Type: image/jpeg`. Set `promptId`, `aiContextInstruction` and
`roundNoun` on the SETS row as `INSTALLED.md` records, because the importer does not
write them.

To change an installed set, use `scripts/replace-question-set.js <table> whatisthisthing
--csv ...`. It writes a new version and keeps the set's other settings.

For another tier, upload `images/witt-*.jpg` to that tier's bucket and rewrite the 24
URLs to its domain. Or turn them into bare filenames once keyed media renders correctly
(see QA-NOTES, known gaps).
