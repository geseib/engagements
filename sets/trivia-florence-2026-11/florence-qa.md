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
