# Florence trivia QA

Reviewed 2026-11-07 UTC, before install. `florence-trivia.json` was read in full:
all 60 questions, all 240 options, every answer key, explanation and source URL.
The CSV is generated from the same data as the JSON, so the two cannot drift.

## How this review was done, and its limits
- **Not a fresh-reviewer pass.** The brief asked for an independent subagent.
  This authoring session had no Agent (subagent) tool, so none could be
  started. What follows is the author's own two passes. Treat it as weaker
  than the 2026-11-07 independent review of the 80s Movies / Greatest Books
  sets. A fresh reviewer should re-check it before the set goes to test.
- **Sources were fetched, not remembered.** Unlike the 2026-11b sets, this session
  could reach en.wikipedia.org. The raw wikitext of 70 pages was downloaded
  (`action=raw`, a few seconds apart; the REST API returned HTTP 429). Every
  number, date and name in a prompt, key or explanation was matched against
  that text. The few claims that were not, or that rest on a thin source, are
  listed under "Weak spots".

## Result
60 unique questions in six categories of 10. Every question has four distinct
options, one supported correct answer, a short explanation that adds a fact,
and at least one source. Answer keys are 15 A / 15 B / 15 C / 15 D, placed by a
seeded balanced shuffle with no letter three times running. Distractor order is
shuffled as well.

| easy | medium | hard |
|---|---|---|
| 23 | 29 | 8 |

That leans easier than the 2026-11b sets (15/34/11), as the brief asked ("light
and fun"). The labels are editorial estimates; nobody has played the set yet.

Categories: Landmarks & the Duomo; The Medici & Renaissance People; Sculpture,
Art & Museums; Florentine Food & Drink; Curious Florence; Fashion, Football &
Modern Florence.

## Checked against what is already live on dev
All 36 platform `SETS` rows on engagedev were listed. There is no other Florence
or Italy trivia set. *Uffizi Art Titles* (call-and-answer, 60 Uffizi paintings)
is the nearest. This set has **no painting questions**. Its art category is
sculpture, buildings and museums: David, the Baptistery doors, Perseus,
Orsanmichele, the Uffizi's name, San Marco, the Bargello, the New Sacristy and
the Opificio. The live geography set has one Italian-city question (Venice) and
none on Florence.

## Pass 1: corrections while drafting (against the fetched text)
- **Ponte Vecchio butchers:** the date was dropped. One Wikipedia page gives a
  1565 decree; another says the goldsmiths were "established by 1593". The
  question and explanation now just say "in the 1500s".
- **Fiorentina's purple:** a planned "laundry accident" origin story was dropped.
  No source supports it.
- **Galileo's finger:** the tooth was kept out of the options. A tooth was taken
  from his body too, and it is also in the museum, so "a tooth" would have been
  a second right answer.
- **Florence's coat of arms (red lily):** the question was dropped. The page did
  not load, so the iris-or-lily detail could not be checked. Florentia's
  meaning replaced it.
- **Tuscan bread:** "yeast" and "olive oil" were dropped as distractors. Pane
  sciocco is often made with sourdough and has no oil, so either could have been
  argued. The options are now salt / crust / flour / water.
- **Florentine (menu term):** "Parmesan crust" was replaced by "Mushrooms". The
  classic dish is finished with grated cheese.
- **Chianti grape:** Merlot was swapped for Barbera, because Merlot is allowed in
  the blend.
- **Porcellino:** "A pig" was swapped for "A badger", because a wild boar is
  itself a pig, which made the option arguable.
- **Bonfire of the Vanities:** Fra Angelico and Fra Filippo Lippi were removed as
  distractors. The San Marco question shows they were painters, which would have
  ruled them out. The year 1497 also matters: Bernardino of Siena held earlier
  bonfires, but he died in 1444.
- **San Marco frescoes:** Fra Bartolomeo was not used as a distractor. He was
  also a friar-painter at San Marco.
- **Dome record:** "though St Peter's rises higher" was removed. It was not in
  the fetched text.

## Pass 2: giveaways and cross-question leaks
A script searched every question and explanation for every other question's
answer. Two kinds of hit came back. The word "Florence" is everywhere, which only
matters for the deliberate freebie "Modern Italian grew from the dialect of which
city?". "Wine" appears in the Chianti question, which gives nothing away about
the wine windows. Leaks found by reading and fixed:
- Santa Croce (Q7) was kept out of the Dante, Galileo and Calcio Storico
  explanations. Dante's empty tomb, Galileo's reburial and the Calcio square are
  all at Santa Croce.
- The Vasari Corridor (Q3): Vasari is not named in the Uffizi explanation, and
  the butchers explanation says only "the corridor overhead".
- The Boboli/Pitti question was replaced by the Loggia dei Lanzi. "Pitti Uomo"
  would have given it away. The Perseus prompt then dropped "Loggia dei Lanzi".
- *The Prince* explanation: "grandson of Lorenzo the Magnificent" was removed,
  because it gave away the nickname question. The Dante question no longer
  lists The Prince as a distractor.
- The Medici arms: "black rooster" was replaced by "a crowned eagle", so the
  arms question does not hint at the Chianti seal.
- Piazzale Michelangelo: its explanation does not mention the Times of Day
  copies, which would give away the New Sacristy question.

## Weak spots (for a fresh reviewer)
- **Q10, "largest masonry dome ever built"**: Wikipedia states it twice, but one
  instance is tagged "citation needed" and a footnote says "figures vary". It is
  the standard claim; no other option is close.
- **Q50, Rome took over as capital in 1871**: the fetched pages give
  "capital 1865–1871" but do not name Rome. This is a well-known fact.
- **Q23, "Gates of Paradise"**: phrased "is said to have", because the source for
  Michelangelo's remark is Vasari.
- **Q35, Buontalenti and gelato**: phrased as Florentine tradition. Wikipedia
  credits him with "the precursor to modern Florentine gelato".
- **Q60, the pharmacy opening in 1612**: phrased "is said to have", as the page
  calls 1612 the traditional date.
- **Q41, wine windows reopening in 2020**: supported by a 2020 CNN article cited
  on the page ("re-emergence", "coronavirus"), not by the page text itself.
- Wikipedia is the only source for most questions. Only Q3 also cites
  uffizi.it.

## Independent review, 2026-11-07 (separate reviewer)

After this file was written, a separate reviewer checked all 60 questions. They
did not read this file before reaching their verdicts. They found the CSV and
JSON identical. Some pages were rate-limited, so they judged 14 questions (and
parts of three explanations) from knowledge only.

| wrong | ambiguous | minor |
|---|---|---|
| 0 | 0 | 10 |

All ten were applied to the CSV and the JSON together. No answer key changed,
and no answer letter moved: the set is still 15 A / 15 B / 15 C / 15 D, with no
letter three times running.
- **03 Vasari Corridor:** "about a kilometre" became the Uffizi's own figure,
  760 m from the Uffizi to the Boboli Gardens. The Uffizi page, fetched for this
  fix, also says it was built in just five months. Wikipedia's figure of about a
  kilometre starts from the Palazzo Vecchio.
- **06 Piazzale Michelangelo:** "home to a bronze copy of David" was taken out of
  the prompt, because it pointed at Michelangelo. It moved to the explanation.
- **25 Orsanmichele:** the explanation now separates the two buildings: the
  first grain loggia (1290) burned in 1304, and its replacement was begun in
  1337. The 1304 fire is confirmed in the fetched text.
- **29 New Sacristy:** the key now reads "The four times of day", matching the
  other three options, so it no longer stands out by its wording.
- **30 Opificio** (optional, applied): the key changed from "Pictures made of
  inlaid stone", which is close to a translation of the institute's name, to
  "Stone mosaics (commesso)".
- **37 black rooster:** the explanation no longer says the seal marks Consortium
  membership. Since about 2005 the gallo nero has been the official mark of all
  Chianti Classico. It also gains the border-legend fact. This rests on the
  reviewer's knowledge; Wikipedia still has the older wording.
- **38 Sangiovese:** the prompt now says "at least 80% of a Chianti Classico".
  Plain Chianti DOCG needs 70%. The explanation no longer says Ricasoli became
  prime minister "later", since he first held the post in 1861, in the middle of
  his work on the blend.
- **57 Nightingale:** "named after Florence" was taken out of the prompt, which
  had given the answer away. It moved to the explanation. The prompt now uses
  "the Lady with the Lamp" (confirmed in the fetched text). The reviewer's draft
  said Parthenope was born in Naples; that was not in the fetched text, so the
  existing "partly after the old Greek settlement" wording was kept.
- **59 UNESCO:** a flat explanation was replaced by a livelier one: the list
  itself only started in 1978. That date is from the reviewer's knowledge.
- **15 Galileo** (optional, applied): the explanation now adds that his thumb,
  index finger and a tooth, taken at the same time, were lost for about a
  century and are now in the museum too. The fetched text says they disappeared
  after 1905 and were found at auction in 2009.

The reviewer found no cross-question giveaways.
