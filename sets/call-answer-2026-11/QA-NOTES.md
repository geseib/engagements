# QA notes: What Is This Thing?

## History

1. **Author's check, 7 Nov 2026.** Installed as v1.
2. **Independent review, 7 Nov 2026.** A separate reviewer read every US patent and
   DE 204,721 on Google Patents, opened the crops and Commons pages, and read the player
   payload code. It found:
   - 4 wrong answers or stories
   - 1 set-wide leak
   - 16 minor findings

   The full table is outside the repo, at the coordinator's
   `scratchpad/patent-review/review.md`. Its findings and what was done about each are
   summarised below.
3. **v2, 7 Nov 2026.** Every fix below is installed. Read back with 0 mismatches.

## Fixes from the independent review

| Q | Finding | What changed |
|---|---|---|
| 2 drowning hat | **Wrong.** US 1,826 has no tube and no inflation. Buoyancy comes from a sealed air space in the crown, plus a waterproof lining you pull out by a cord into an air bag. | RealAnswer and story rewritten to follow the patent. Added that White was an Englishman (Dorset). |
| 11 loop bicycle | **Wrong.** The patent is for a broken loop: the rider leaps the gap upside down and rides out on the two upper wheels. | RealAnswer and story rewritten to match. |
| 17 Landlord's Game | **Wrong.** US 748,626 had expired by 1935. Parker Brothers bought her later 1924 patent, for $500. | Story corrected. Title softened from "A BOARD OF RENTS" to "ROUND AND ROUND THE BOARD". |
| 23 gun trap | **Wrong.** The patent is a trap for burrowing animals, not a mousetrap, and the shot doubles as an alarm to reset the trap. "Very effective" was unsupported. | RealAnswer and story rewritten. The image file is no longer named "mousetrap". |
| all | **Leak.** Image URLs named the answer. The crops had descriptive names (`saluting-hat.jpg` ...) and the Commons links had descriptive filenames (`Patente_sacabolas_de_helado`, `Gun-Powered_Mousetrap` ...). | All 24 images are now self-hosted as `witt-01.jpg` ... `witt-24.jpg` in shuffled order. That includes the 7 that had been Commons links. No URL depends on Wikimedia any more. |
| 10 steam man | Minor in the review: the face can read as a racial caricature. The coordinator asked for a replacement. | **Replaced** with Garrett A. Morgan's traffic signal (US 1,475,024, 1923), which is in the same category. Morgan's Q4 story no longer mentions the signal, so it does not spoil Q10. |
| 7 rocking-chair fan | The "5231" classification stamp in the crop is the patent number, and can be searched. | Stamp blanked. |
| 24 vote counter | The crop was sideways. | Rotated upright. |
| 13 chicken spectacles | Described as "hinged glasses over the beak". | Now "two lens frames held on by a springy band over the head", as in the patent. |
| 20 yo-yo | "Granted in Cincinnati" was wrong, and "patented" appeared twice. | Now "two Cincinnati men". Uses the patent's own word, bandelore. |
| 22 baby cage | "London tower blocks in the 1930s" is an anachronism. | Now "London flats". |
| 6 ice-cream scoop | The 378 px Commons file was soft at 900 px. | Re-cropped from Google Patents' 2320 px sheet, with the header removed. |
| 9 Lincoln | The title nearly described the mechanism. | Title is now "THIS BOAT HAS A PLAN". |
| 12 wiper | The title nearly named it, and the streetcar story was stated as fact. | Title is now "WINTER, SOLVED?". The story now opens "the story goes that...". |
| 14 pigeon camera, 18 golf tee | Licence labels were wrong, the images were never viewed, and "first recorded tee patent" was unhedged. | Labels fixed (PD-old-75; PD-old). Both images viewed by eye (see below). The tee story now says "earliest known tee patent". |
| 4 Morgan | The licence label should say CC0. | Label fixed. |
| README | Said no payload carries RealAnswer, but the bluff holder's phone gets it by design. | Reworded. |

## Minor findings accepted, not changed

- **School** (inventor and year) is in the unauthenticated question payload during ASK,
  though it is only drawn after the reveal. A determined player could search it.
  Accepted, as the review allowed.
- **Q16 dog-power**: the drawing shows no dog, so the round leans on its title.
  Acceptable per the review.
- **Q17 and Q20 are easy wins**: the board's words and the yo-yo drawing give them away.
  Kept on purpose.
- **Q24 is hard.** It is kept as the "Just Why?" head-scratcher.

## Verification after the fixes

- **Patents**: the review re-confirmed all 22 US patents and DE 204,721 against Google
  Patents. The new Q10 was checked on its sheet (G. A. Morgan, Traffic Signal,
  1,475,024, Nov. 20, 1923) and on Google Patents (inventor Garrett A Morgan,
  1923-11-20). GB 12,941 is still checked only through Commons and its printed sheet
  header.
- **Images**: all 24 URLs returned HTTP 200 `image/jpeg` from
  `engage.dev.seibtribe.us/sets/whatisthisthing/` (`image-check.json`). CloudFront
  answers 200 `text/html` for a missing key, so the content type is the real test. The
  files are written by Pillow and carry no EXIF or comment metadata.
- **Q14 and Q18, viewed by eye**:
  - Q14 is the drawing sheet of the pigeon camera's harness and mechanism. The
    "Zu der Patentschrift No 204721" line at the foot was cropped off.
  - Q18 is three figures of a ball on a small stand. The sheet header carrying the
    number was cropped off.
- **What the player and host screens show before the reveal**:
  - the image, whose `alt` is the Title teaser
  - the Title
  - the CustomInstruction prompt

  Detail is blank. AnswerDetails and RealAnswer are not projected to the room (RealAnswer
  goes only to the bluff holder). No Title names its answer, and no image URL does.

## Known gaps

1. **Crop URLs are absolute dev URLs.** A bare key (`sets/whatisthisthing/<file>`) is
   passed to `<img src>` unchanged, with no `<base href>` in the page. So it would
   resolve relative to the current route and land on index.html. To promote, re-upload
   to the tier's bucket and rewrite the URLs, or fix keyed-media rendering first.
2. **v1's descriptively named crops are still in `engagedev-media`** (`saluting-hat.jpg`
   and so on). v1 references them. v2, which is live, does not. Delete them if v1 will
   never be restored.
3. **Workie uses the art-title prompt plus a set-level context note**, as the art set
   does. Its section headings still say "The Winning Title" and "The Real Title". The
   host's vote cue for image rounds also says "Vote for the best title"
   (`GameHostPage.jsx`). A dedicated prompt, and an image-round cue that does not assume
   art, would fit better.
4. **The cow-tail crop has a plain block** where its Gazette clipping was blanked.
