# Uffizi Art Titles

An art-title Call & Answer set for Engage, made from 60 paintings in the Galleria degli
Uffizi in Florence. Each round shows one painting. Players invent a title for it, vote for
the best one, and then Workie reveals the real title and a short story about the work.

The 60 paintings are in 6 categories of 10:

| Category | Painters |
|---|---|
| Gothic & Early Renaissance | Cimabue, Giotto, Duccio, Simone Martini, Ambrogio Lorenzetti (2), Pietro Lorenzetti, Bernardo Daddi, Gentile da Fabriano, Lorenzo Monaco |
| Early Renaissance Florence | Masolino and Masaccio, Fra Angelico, Uccello, Domenico Veneziano, Baldovinetti, Filippo Lippi (2), Piero della Francesca, Piero del Pollaiolo, Ghirlandaio |
| Florence, 1470–1500 | Botticelli (9), Filippino Lippi |
| High Renaissance | Verrocchio and Leonardo, Leonardo (2), Perugino, Michelangelo, Raphael (2), Albertinelli, Andrea del Sarto, Piero di Cosimo |
| Venice & the North | Hugo van der Goes, Mantegna, Giovanni Bellini, Giorgione, Dürer, Cranach, Holbein, Titian (3) |
| Mannerism & the Baroque | Annibale Carracci, Rosso Fiorentino, Bronzino (2), Parmigianino, Caravaggio (3), Artemisia Gentileschi, Correggio |

**Category names never name a painter.** Players see the category during ASK, on the wall
eyebrow (`QuestionCard.jsx`) and in the player bar (`PlayerPage.jsx`). A name like
"Botticelli & His Circle" would be a one-search answer. The painters are listed only here.

The mix is deliberate. About half are famous (Birth of Venus, Primavera, Doni Tondo,
Venus of Urbino, Medusa) and half are less well known (Lorenzetti's St Nicholas panel,
Daddi's 1328 triptych, Piero del Pollaiolo's Charity, Bellini's Sacred Allegory, Carracci's
Man with a Monkey).

**Content note for hosts:** the set includes classical nudes (Birth of Venus, Venus of
Urbino, Adam and Eve, Bacchus) and three violent scenes from myth and scripture (Medusa,
Sacrifice of Isaac, Judith Slaying Holofernes). All are standard museum works. A host can
leave out a category, or skip a round, if the room calls for it.

## Files

| File | What it is |
|---|---|
| `uffizi-art-titles.csv` | The set, in the Famous Art Titles column layout plus `RealAnswer` |
| `uffizi-art-titles.json` | One record per painting: artist, date, Commons file and page, licence, photo credit where the licence needs one, Uffizi verification (page, room, inventory number), image URL, output size, crop |
| `images/uffizi-NN.jpg` | All 60 images under neutral names in shuffled order. The sidecar maps each file to its question. |
| `QA-NOTES.md` | What was checked, what was changed, and the known gaps |
| `INSTALLED.md` | Where the set is installed and how it read back |

## Columns, and what players see before the reveal

- **Title**: a short teaser that never contains the real title ("THE DOG IS ASLEEP").
- **Detail_lesson**: left blank. Players see Detail during ASK, so anything in it would
  spoil the round.
- **School**: school and century, such as "Florentine, 15th century". The question
  payload carries this field during ASK (`get-question.js`, `get-game-state.js`), but the
  app draws it only in the post-round report (`RoundReport`, `RoundReportSections`).
  Famous Art Titles puts the artist's name here. This set leaves the artist out, so that
  even a player who reads the payload gets no search term that leads to the answer.
- **CustomInstruction**: left blank, as on Famous Art Titles. Image rounds then fall back
  to the art-title prompt ("Name this work of art").
- **AnswerDetails**: `Real title: <title>, <artist>, <date>, Uffizi Gallery, Florence.`
  followed by one or two sentences of story. Only Workie reads this, at RESULTS.
- **RealAnswer**: the real title, for the bluff-round twist
  (`docs/design/bluff-round/README.md`). It is withheld from the room until RESULTS. The
  one exception is by design: the bluff holder's own phone gets it. The set is installed
  with `bluffRound: false`, and a host can switch it on for a session.
- **Image**: `https://engage.dev.seibtribe.us/sets/uffiziarttitles/uffizi-NN.jpg`, served
  from the dev media bucket.

## Why the images are self-hosted under neutral names

The image URL is in the public question payload, and a player can open it in a new tab.
Wikimedia Commons filenames name the painting ("Tiziano - Venere di Urbino - ..."), so
every image was downloaded and given a neutral name, `uffizi-NN.jpg`. The numbers are
shuffled with a fixed seed, so they do not follow question order. v1 used `uffizi-01` to
`uffizi-60`. In v2 the seven images that changed got fresh names (`uffizi-61` to
`uffizi-67`), so that v1's URLs, and any cached copies, keep their old content. That
leaves seven numbers between 01 and 60 unused by v2.

Each image was:

1. downloaded from Wikimedia Commons, at 1280 px wide for portrait images and 1920 px
   wide for landscape ones, or at full size when the original was smaller;
2. turned upright, using its EXIF orientation;
3. cropped where it was a gallery photograph with wall or plinth around the work, or a
   scan with a black margin (5 images). Two stray marks were blanked: a faint watermark
   line in the margin of the Madonna of the Magnificat, and a printed page number in the
   corner of Ghirlandaio's tondo. Crops and blanks are recorded per image in the sidecar.
   Piero della Francesca's diptych is two Commons files, one per panel, set side by side as
   the panels hang (Battista on the left, Federico on the right);
4. resized so its long side is at most 1600 px, never enlarged;
5. saved as JPEG, quality 85, with no EXIF or comment metadata.

None of the images shows a museum label. A few altarpieces carry the painter's signature
or patron's inscription on the original frame or base. That text is part of the work and
names the artist or patron, never the title.

## Licences

The painters all died centuries ago. Commons treats a faithful photograph of a
two-dimensional public-domain work as public domain itself (`PD-Art`). Each file's Commons
licence label is recorded in the sidecar:

- 57 files are labelled public domain.
- 3 are CC0.
- None needs attribution. v1 had three CC BY-SA photographs (Daddi, the Cestello
  Annunciation and the Baptism of Christ). The game cannot show a credit, so v2 replaced
  them with public-domain files.

Commons also flags that Italian cultural-heritage law (the Codice dei beni culturali) can
restrict commercial reproduction of images of works in Italian state museums. That rule is
separate from copyright. It is worth a look before the set is used commercially outside
Engage's own sessions.

## Install

Installed on dev: v1, then v2. See `INSTALLED.md`.

**To update the installed set** (as v2 was), upload any new `images/uffizi-*.jpg`, then:

```bash
node scripts/replace-question-set.js engagedev uffiziarttitles \
  --csv sets/uffizi-2026-11/uffizi-art-titles.csv --note "..."     # dry run; add --apply
```

This writes a new version and keeps the set's settings.

**A first install** on an empty table, using the app's own importer:

```bash
# 1. upload the images (key prefix sets/uffiziarttitles/, Content-Type image/jpeg)
#    to s3://engagedev-media/sets/uffiziarttitles/

# 2. dry run, then the same with --apply
node scripts/install-question-set.js engagedev sets/uffizi-2026-11/uffizi-art-titles.csv \
  --type call-and-answer --title "Uffizi Art Titles" --topic arts-culture \
  --description "Sixty paintings from the Uffizi Gallery in Florence, from Cimabue to Caravaggio. Give each one a better title, vote for the best, then Workie reveals the real one and its story." \
  --persona comedian --tags art-history,painting,uffizi,renaissance
```

3. On the SETS row (`PK=SETS`, `SK=SET#uffiziarttitles`), set
   `promptId = mskc5h7boibe5abg15` (the "Art & Creative Titles - Naming Celebration" prompt
   that Famous Art Titles uses) and `bluffRound = false`. The importer writes neither.
   Famous Art Titles has no `roundNoun` and an empty `aiContextInstruction`, so this set
   sets neither.

The installer refuses an id that already exists. To change the set once it is installed,
use `scripts/replace-question-set.js engagedev uffiziarttitles --csv ...`. That writes a
new version and keeps the set's other settings.

To install on another tier, upload the images to that tier's media bucket and rewrite the
60 URLs to its domain. The Image column holds absolute URLs because bare keys do not yet
render correctly; see the What Is This Thing? QA notes.

## Credits

No image needs attribution. The CC0 photographs, which need no credit, are by Gleb Simonov (Simone Martini), Oursana
(Pietro Lorenzetti) and Fabrizio Garrisi (Baldovinetti). Every file's Commons page is in
the sidecar.
