# QA notes: What Is This Thing?

Checked 7 Nov 2026 by the author. **No independent review was done.** This session had
no tool for starting a subagent, so the review the brief asked for is still owed (see
the end of this file).

## Patents: 24 of 24 verified

Each patent was checked in at least two places:

1. **The drawing itself.** Each sheet prints its number, inventor and date, and these
   were read off the image. For the seven hot-linked figure-only files, the Commons
   description or file name gives the patent instead.
2. **Google Patents** (`patents.google.com/patent/US<number>`). The title and grant date
   matched for all 22 US patents. Where Google's OCR mangled the inventor name, the sheet
   was used. For US 269,766 the patent text was read to confirm "James A. Williams, of
   Fredonia, Texas".
3. **Commons.** Every file was read from its description page: public domain (PD-US,
   PD US Government, or the Public Domain Mark), with the mime type and size recorded.

The two patents that are not US were checked on Commons only:

- **DE 204,721** (Neubronner's pigeon camera). The drawing page prints the number;
  Commons names Neubronner.
- **GB 12,941 of 1889** (Bloxsom & Douglas's golf tee). The sheet header prints the
  number and date; Commons names both inventors.

The `verification` field of `what-is-this-thing.json` gives the evidence for each row.

## Images: 22 of 24 verified, 2 pending

**The 17 crops.** Each URL on `engage.dev.seibtribe.us/sets/whatisthisthing/` returned
200 `image/jpeg`. CloudFront answers 200 `text/html` (index.html) for a missing key, so
the content type is the real test.

**The 7 Commons hot-links.** Each redirect was followed from `Special:FilePath`:
FilePath, then `Special:Redirect/file`, then a 960 px thumbnail on
`thumb.wikimedia.org`. A file narrower than 900 px resolves to the original on
`upload.wikimedia.org` instead. This sandbox cannot reach `thumb.wikimedia.org`, so the
same path was fetched from `upload.wikimedia.org`, which serves the same files.

- 5 of the 7 returned `image/*`.
- 2 (Q14 pigeon camera, Q18 golf tee) got HTTP 429 rate limits from Wikimedia at check
  time. Both files had already downloaded fine as 960 px PNGs earlier in the session,
  while the crops were being chosen.

Wikimedia only serves standard thumbnail widths. `?width=900` snaps to 960, as it
already does for the art set.

## Spoilers on screen

- **Printed titles.** A full patent sheet names the invention in its header, which would
  end the round the moment it appeared. So 17 sheets were cropped to the drawing. Three
  pasted Gazette clippings that named the invention were blanked inside the crop
  (signal chair, cow-tail holder, dog-power), as were the creeping doll's clipping and
  its "Patented" line. Every crop was then looked at again for leftover text. What
  remains is figure letters, the inventor's signature, or a classification stamp. The
  rocking chair crop shows its stamp "5231", which is the patent number and harmless.
- **Detail** is blank on every row.
- **School** (inventor and year) is projected to clients but drawn only in the
  post-round report, after the reveal. None of the inventor names hints at what the
  invention does.
- **Titles** are teasers, never the answer. Two lean towards it on purpose, because the
  drawing already does: "UP AND DOWN, ROUND AND ROUND" (yo-yo) and "A BOARD OF RENTS"
  (the Landlord's Game).
- **AnswerDetails and RealAnswer** are not in the get-question or get-game-state
  projections (`tests/art-title-flow.js`, and the bluff-round design for RealAnswer).

## Content choices

- The set mixes puzzling drawings (dog-power, vote counter, Lincoln's bellows boat) with
  fair ones you can read (chicken spectacles, gun mousetrap, yo-yo), so every room gets
  a few wins.
- The patents run from 1840 to 1923. 5 of the 24 inventors are women (Goode, Benjamin,
  Anderson, Magie, Read).
- Stories were kept to what the patent, the drawing or well-documented history supports:
  - Morgan and the 1916 Lake Erie tunnel rescue
  - Parker Brothers buying Magie's patent in 1935
  - Anderson's streetcar ride
  - Benjamin's chair and the House page signal
  - London's window baby cages in the 1930s
  - Edison's 1869 vote recorder

  Where the mechanism is shown rather than described, the wording stays close to the
  drawing (the 1840 drowning hat, Horst's rocking-chair fan).

## Known gaps

1. **No independent review yet.** A reviewer should re-verify a sample of patents (say
   Q2 White, Q7 Horst, Q16 Pangburn, Q24 Monaghan, the older and thinner ones) and
   re-read the crops for leftover text.
2. **The crops are absolute dev URLs.** `toMediaKey` would store a bare filename as
   `sets/whatisthisthing/<file>`. But `get-question` and `get-game-state` pass `Image`
   through unchanged, and `PlayerPage`, `GameHostPage` and `QuestionCard` use it as the
   `<img src>` directly, with no `<base href>` in the page. So a bare key would resolve
   relative to the current route (for example `/host/sets/...`) and land on index.html.
   No set on dev uses keyed media yet: `engagedev-media` had no `sets/` objects before
   this install. Absolute dev URLs are what works today. To promote to test or prod,
   re-upload the 17 files to that tier's bucket and rewrite the URLs, or fix the
   relative key first.
3. **Q6 (ice-cream scoop) is a low-resolution file.** The Commons original is 378 px
   wide, so it is upscaled at 900 px. It is still legible, but soft.
4. **The cow-tail holder crop has a plain block** where its Gazette clipping was
   blanked. The block clips the end of the Fig. 2 bar. The drawing still reads.
5. **Workie's prompt is the art-title prompt** (`mskc5h7boibe5abg15`), matching the art
   set as asked. A set-level `aiContextInstruction` tells it to read "title" as "guess"
   and "real title" as "real answer". Its section headings still say "The Winning Title"
   and "The Real Title". A dedicated "What Is This Thing?" prompt would fit better.
