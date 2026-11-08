# QA notes: Uffizi Art Titles

## History

1. **Author's second pass, 7 Nov 2026.** Installed as v1. The author could not start a
   subagent, so the first check was a deliberate second pass of their own. The v1 sections
   below record it.
2. **Independent review, 7 Nov 2026.** A separate reviewer formed their verdicts before
   reading these notes. They:
   - read all 60 stories against the 55 uffizi.it pages and Wikipedia;
   - viewed every image and zoomed the margins;
   - pulled all 61 Commons licences;
   - read the player-visible fields in `get-game-state.js`, `QuestionCard.jsx` and
     `PlayerPage.jsx`.

   They found 1 wrong fact, 2 leaks, 3 licence problems and 16 minor findings. They also
   confirmed that all 60 works are in the Galleria degli Uffizi and that all 60 images are
   correct and upright. The full table is outside the repo, at the coordinator's
   `scratchpad/uffizi-review/review.md`.
3. **Off-display check, 7 Nov 2026.** `pdf.uffizi.it` became reachable, and the Uffizi's
   list of works temporarily off display (dated 3 Nov 2026) was read. Three of the 60 were
   on it and were replaced.
4. **v2.** Everything below "v2 fixes" is in it.

## v2 fixes

| Q | Finding | What changed |
|---|---|---|
| 59 Artemisia | **Wrong.** "Painted in Florence": the Uffizi says it was finished in Rome, after her seven years in Florence, and paid for late, with Galileo's help. | Story rewritten from the Uffizi text. Title is now "THE MAID HOLDS HIM DOWN" (the old "TWO WOMEN, ONE TOUGH JOB" was glib). |
| 21–30, 51–60 | **Leak.** Players see the category during ASK, on the wall eyebrow and in the player bar. "Botticelli & His Circle" and "Mannerism & Caravaggio" named the painters. | Renamed "Florence, 1470–1500" and "Mannerism & the Baroque". No category names a painter now. |
| 30 → 33 | **Leak.** Filippino's story said it replaced the altarpiece Leonardo left unfinished, which is Q33. | That clause was cut. |
| 7, 28, 31 | **Licence.** These were CC BY-SA photographs, and the game shows no credit. | Replaced with public-domain files, each viewed by eye. Daddi is a WGA scan (894 px). The Cestello Annunciation file shows the painting only, so the frame inscription ECCE ANCILLA DOMINI ... is gone. The Baptism of Christ is a 3760 px photograph. |
| 8 Giottino | **On the off-display list** (in restoration). | Replaced by Ambrogio Lorenzetti, *The Miracle of the Grain Ships and St Nicholas Reviving a Boy* (room A6, 1890 n. 8349). |
| 51 Pontormo | **On the off-display list** (on loan to the Scuderie del Quirinale, Rome, until 7 Feb 2027). | Replaced by Annibale Carracci (attributed), *Man with a Monkey* (room E5, 1890 n. 799). The disputed attribution is in the story. |
| 60 Honthorst | **On the off-display list** (on loan to Villa Manin from 14 Nov 2026). | Replaced by Correggio, *Rest on the Flight into Egypt with St Francis* (room D8, 1890 n. 1455). |
| 18 → 22 | Charity's story pointed at the Botticelli Virtue, Q22. | Sentence dropped. |
| 24 | "Canvas, still unusual in Florence" overstated the point. | Now "a cheaper support than panel, often used for pictures for country villas". |
| 55 | The inscription is at the foot of the column, not on the step. | Fixed. |
| 52 | The Rosso sentence could be read as saying the name and date sit on top of the later background. | Reworded: they were found *under* the background. |
| 42 | The Mantegna's Mantua origin was stated as fact. | Now "probably". |
| 16 | "Without his workshop's help" could not be verified. | Dropped. |
| 57 | The Medusa is the second of two versions. | Added. |
| 33 | The story praised the 2017 restoration, but the image is the dark photograph from before it. | The story now says the image shows it before cleaning. |
| 35 | The story mentioned the original frame, which is not in the image. | Clause dropped. |
| 10 | Crop. | Tightened a little. The grey wall around the pinnacles follows the altarpiece's outline, so the rest stays. Q5 was left uncropped for the same reason: the top panel reaches the edge. |
| 60 (School) | "Utrecht Caravaggist" was a strong search term. | Moot: Honthorst was replaced. |

**Image names in v2:** the seven changed images (Q7, 8, 10, 28, 31, 51, 60) are new
files, `uffizi-61.jpg` to `uffizi-67.jpg`, in shuffled order. v1's URLs keep their old
content.

**Accepted, not changed:**

- **Repeated subjects.** Five RealAnswers are "Adoration of the Magi" (9, 19, 21, 30, 33,
  45; 60 is no longer one). There are three Coronations and four Annunciations. Each keeps
  its disambiguator where one exists (Strozzi Altarpiece, tondo). This is an honest picture
  of the Uffizi, but a bluff-round host may find "Adoration of the Magi" a popular guess.
- **Low resolution.** No larger public-domain file exists for Q7 (894 px), Q8 (585 x 1098),
  Q19 (948 px), Q26 (1097 px), Q38 (815 px) or Q51 (708 px). They will look soft on a
  projector.
- **Q42 Mantegna:** the black gaps between the three panels are left in.

**Re-checked after the fixes:**

- every changed image, on labelled sheets: right painting, upright;
- the word-overlap script over Title, Category and School against the real title: none;
- 60 unique titles;
- licences: 57 public domain and 3 CC0;
- the three new works' uffizi.it pages: each gives "The Uffizi" with a gallery room;
- the new works' inventory numbers are not on the 3 Nov list.

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
  temporarily off display (restoration or loan). The list of 3 Nov 2026 was read for v2.
  Three works were replaced (see v2 fixes), and none of the others is on it. It changes
  every two weeks.

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

- **What players see during ASK:** the image (its `alt` is the Title), the Title, the
  art-title prompt, and the **category**, on the wall eyebrow and in the player bar. v1's
  list left out the category, which hid a leak; see v2 fixes. Detail_lesson is blank on
  every row.
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

1. **The off-display list changes every two weeks.** This set was checked against the list
   of 3 Nov 2026. A work can go out on loan later, and the set stays correct, since the
   works belong to the Uffizi and normally hang there.
2. **Image URLs are absolute dev URLs**, as with What Is This Thing?. Promoting the set
   means uploading the images to the next tier's bucket and rewriting the 60 URLs.
3. **Leonardo's Adoration is the pre-restoration photograph.** It is public domain and much
   darker than the painting looks since the 2017 restoration. The post-restoration photo on
   Commons is CC BY-SA. The story says the image is from before the cleaning.
4. **The Rucellai Madonna's uffizi.it page gives no inventory number.** It does have a
   description, which v1 of these notes wrongly said it lacked. Its room (A4) is on the page.
5. **v1's images stay in the bucket.** `uffizi-NN.jpg` files that v2 no longer uses are
   still in `engagedev-media`, because v1 references them. Delete them only if v1 will never
   be restored.
