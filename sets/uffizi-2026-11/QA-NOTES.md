# QA notes: Uffizi Art Titles

## Who checked it

**No independent reviewer.** This session could not start a subagent, so there was no
separate reviewer. Instead the author did a second, deliberate pass over every fact,
location, image and leak path, after writing the content and before installing. The
results are below. An independent review, like the one What Is This Thing? had, is still
worth doing; see Known gaps.

## Location: is each work in the Galleria degli Uffizi itself?

- **55 of 60: the Uffizi's own artwork page.** Each page on uffizi.it gives Museum "The
  Uffizi" (or "Gli Uffizi") and a gallery room. The sidecar records the page URL, the
  room (for example "A4. Giotto - Cimabue" or "D32. Caravaggio - The Bacchus") and the
  inventory number. The pages were found through the site's sitemap.
- **5 of 60: Wikipedia and Commons.** uffizi.it has no artwork page for the Portinari
  Altarpiece, Giorgione's Moses, Cranach's Adam and Eve, Holbein's Southwell or Caravaggio's
  Medusa. For these the English Wikipedia infobox gives the Uffizi, and none of the five
  articles mentions the Pitti. The Medusa is also confirmed by the Uffizi's own room name,
  "E4. Caravaggio (The Medusa) e Artemisia".
- **Candidates rejected on location:**
  - in storage ("Depots" or "Deposito" on their uffizi.it page): Pollaiolo's *Hercules and
    Antaeus* and *Hercules and the Hydra*, Botticelli's *Return of Judith* and *Portrait of a
    Man with a Medal*, and Taddeo Gaddi's *Madonna Enthroned*;
  - at the Pitti: Raphael's *Young Man with an Apple* and *Cardinal Bibbiena*, and Barocci's
    *Madonna della Gatta*.
- **Two works have a Pitti-era inventory number but hang in the Uffizi.** Parmigianino's
  Madonna with the Long Neck (Palatina n. 230) is in room D4, and Botticelli's Pallas and
  the Centaur ("Pitti Objects of Art 1911 n. 752") is in room A11. Both are kept.
- **Not on display at the moment:** the Uffizi publishes a fortnightly list of works
  temporarily off display (restoration or loan). The current list, dated 3 Nov 2026, is a
  PDF on `pdf.uffizi.it`, a host this session's network could not reach. See Known gaps.

## Facts

- **Titles, artists and dates** follow the uffizi.it page where there is one, otherwise
  Wikipedia.
- **Stories** were written from the uffizi.it description of each work, Wikipedia (intro
  extracts were fetched for the less familiar claims) and standard art-historical sources.
  Claims that cannot be proved are worded as such:
  - Lippi's model ("tradition identifies")
  - the Maringhi Coronation self-portrait, with the patron Maringhi named instead of Lippi
  - Giottino's attribution and date (Uffizi c. 1350–55, others the 1360s)
  - Giorgione's attribution
  - Masolino and Masaccio's shares of the Sant'Anna Metterza
  - Strozzi as the falconer
  - the Primavera's meaning
  - Flora's identity
  - the Medusa self-portrait
  - Vasari's legends (Verrocchio's vow, Piero di Cosimo's eggs, Albertinelli's tavern)
- **Changes made in the second pass:**
  - Bartolomeo Panciatichi was described as "scholar and banker"; now "banker", the
    Uffizi's word.
  - The Cosimo II commission of Artemisia's Judith is now "probably".
  - The Portinari Altarpiece is dated 1475–1476 and the Medusa c. 1597, as on Wikipedia.
  - Two stories named the answer of another round: Charity named "Fortitude", and Filippino
    named Leonardo's Adoration as "also in this set". Both were reworded so that no reveal
    spoils a later round.

## No pre-reveal leak

- **What players see during ASK:** the image (its `alt` is the Title), the Title, and the
  art-title prompt. Detail_lesson is blank on every row.
- **Titles:** a script checked every Title against its real title and artist for shared
  words. Three titles failed and were rewritten: "THE PROPHETS LIVE DOWNSTAIRS" (it shared
  "Prophets"), "FAMILY PHOTO..." ("Family", in Holy Family) and "THE LUTE IS BIGGER..."
  ("Lute"). The check now passes for all 60. All 60 titles are unique.
- **School:** this field is in the unauthenticated question payload (`get-question.js`
  sends `school`), though only `RoundReport` and `RoundReportSections` draw it, after the
  reveal. It holds school and century only ("Florentine, 15th century"), never the artist.
- **Image URLs:** every image is `https://engage.dev.seibtribe.us/sets/uffiziarttitles/uffizi-NN.jpg`.
  The NN numbers are shuffled with a fixed seed, so they do not follow question order. No
  Commons filename appears anywhere in the CSV or on the table.
- **Inside the images:** no museum label appears in any image. Some altarpieces carry an
  original signature or a patron's inscription on the frame or base: Simone Martini, Ambrogio
  Lorenzetti, Daddi, Gentile and Lorenzo Monaco, plus Holbein's dated inscription and
  Titian's signature. That text names an artist, a patron or a date, never the title.
- **RealAnswer and AnswerDetails** do not reach the room before RESULTS. The bluff holder's
  phone gets RealAnswer by design. The set is installed with `bluffRound: false`.

## Images

- **Mapping:** every final image was viewed by eye on labelled contact sheets showing
  question number, file and real title. All 60 are the right painting and upright.
- **Wrong images caught and fixed:**
  - **M02 Rosso, Musician Angel.** The first file, "Rosso Fiorentino - Angelo musicante -
    Google Art Project.jpg", is a different Rosso painting: a Madonna and saints, with two
    putti reading at the bottom. It was replaced by the WGA file, which is the lute-playing
    angel.
  - **E07 Piero, Duke and Duchess of Urbino.** The first file showed only Federico's panel.
    The image is now both panels side by side: Battista from one Commons file, Federico from
    another.
  - **B06 Madonna of the Pomegranate.** The high-resolution PNG is CC BY-SA and is a
    colour-corrected derivative of another upload, so its credit chain is unclear. It was
    replaced by a public-domain file (1097 px).
- **Corrections to image and title:**
  - Crops, to remove wall, plinth or a black scan margin: G04, G06, G10, B08, E05, V02.
  - Blanks: a faint watermark line on B05, and the page number "72" on E09.
  - The V02 Mantegna title no longer mentions a frame, since the photo shows the panels
    unframed.
- **Format:** every file is JPEG, quality 85, at most 1600 px on the long side, with no
  EXIF. The smallest are Ghirlandaio (948 px), Albertinelli (815 x 1246), the Pomegranate
  (1097 px), Cranach (1099 x 1524) and Rosso (1195 x 999). Their sources are no larger, and
  nothing was enlarged. The total is 27 MB.
- **Served:** 60 of 60 URLs returned 200 `image/jpeg` from dev (`image-check.json`).
  CloudFront answers 200 `text/html` for a missing key, so the content type is the real test.

## How the images were fetched

`upload.wikimedia.org` answered 429 at its edge for this session's shared proxy address,
even at one request every 8 seconds. Commons' own `w/thumb.php` serves the same scaled
file from `commons.wikimedia.org`, and that worked. `downloadedFrom` in the sidecar records
which URL each image came from. The User-Agent named the project site and contained no
personal email.

## Known gaps

1. **No independent review.** A separate reviewer should re-read the 60 stories against
   the uffizi.it pages and Wikipedia, and look at the 60 images.
2. **Not-on-display list unchecked.** `pdf.uffizi.it` was blocked, so the 3 Nov 2026 list
   of works temporarily off display (restoration or loan) was not read. Any of the 60
   could be off the walls this fortnight. The set is still correct, since the works belong
   to the Uffizi and hang there normally.
3. **Image URLs are absolute dev URLs**, as with What Is This Thing?. Promoting the set
   means uploading the images to the next tier's bucket and rewriting the 60 URLs.
4. **Leonardo's Adoration is the pre-restoration photograph.** It is public domain and much
   darker than the painting looks since the 2017 restoration. The post-restoration photo on
   Commons is CC BY-SA.
5. **The Rucellai Madonna's uffizi.it page has no inventory number or description.** Its
   location (room A4) is on the page.
