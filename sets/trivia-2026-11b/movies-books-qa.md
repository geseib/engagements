# 80s Movies / Greatest Books trivia QA

Reviewed 2026-11-07 UTC. Both JSON artifacts were read in full: all 120 questions,
all 480 options, every answer key, explanation and source URL. Review done before
install; the CSVs are generated from the same data as the JSONs.

## How this review was done, and its limits
- **Not a fresh-reviewer pass.** No subagent tool was available in the authoring
  session, so this is a separate second read by the author, question by question,
  against the source each one cites and a "could a second option be argued
  correct?" test. Treat it as weaker than the 2026-11-02 independent reviews.
- **No source URL was fetched.** The session's network blocks wikipedia.org,
  oscars.org and nobelprize.org. Every claim was checked against well-established,
  long-fixed facts (release years, ceremony results, authorship, opening lines);
  the URLs are the canonical pages for those facts but have not been re-opened in
  this pass. A reviewer with web access should spot-check them, especially the
  Wikipedia slugs.

## Result
Both sets: 60 unique questions, six categories of 10, four distinct options per
question, one supported correct answer, an explanation and at least one source.
Answer keys are 15 A / 15 B / 15 C / 15 D in each set, from a seeded balanced
shuffle with no three consecutive identical positions.

| Set | easy | medium | hard |
|---|---|---|---|
| 80s Movies: Be Kind, Rewind | 15 | 34 | 11 |
| Greatest Books: Page Turners | 16 | 32 | 12 |

Difficulty labels are editorial estimates, not audience-tested.

## Checked against what is already live on dev
The live `80strivia` (100 questions) and `greatestmoviesofall…` (80 questions)
sets were read from engagedev and compared fact by fact. Six draft 80s-movies
questions repeated a live `80strivia` question and were **replaced**:

| Draft question (removed) | Replacement |
|---|---|
| Who directed E.T.? | Which studio made The Little Mermaid (1989)? |
| Who sang the Ghostbusters theme? | "Stand by Me" (1986): whose story was it adapted from? |
| Who directed The Empire Strikes Back? | Who directed the 1986 remake of The Fly? |
| Who wrote and directed The Breakfast Club / Ferris Bueller? | Who directed Raging Bull (1980)? |
| Who directed The Terminator and Aliens? | Who directed Batman (1989)? |
| Which actress starred in Sixteen Candles, The Breakfast Club and Pretty in Pink? | Who played Princess Leia in Return of the Jedi? |

Also kept clear of the live set's Top Gun, Last Crusade casting, Blade Runner
source, Say Anything, Dirty Dancing, Purple Rain and Fame questions. Films that
appear in both sets (Back to the Future, Ferris Bueller, Ghostbusters) are asked
about different facts here.

## Corrections made during review
- **Books 34 (The Kite Runner):** drafted as "opens in which country?". The novel
  in fact opens in San Francisco in 2001 before flashing back to Kabul, so the
  key would have been wrong. Reworded to where Amir and Hassan grow up
  (Afghanistan).
- **Books 9 (The Stranger):** the quoted opening line was one translation's
  wording presented as the line. Reworded to the narrator not knowing whether his
  mother died "today" or "yesterday", which holds in every translation.
- **Movies 12 (Scarface):** "ends with the line" was not literally true (it is in
  the climactic shoot-out, not the last line). Reworded.
- **Movies 15 (The Shining):** "bursting through a door" changed to pushing his
  face through the door he has axed open, which is what happens on screen.
- **Movies 22 (Beetlejuice):** prompt named Tim Burton, which gave away the Batman
  question in the same set. Director moved to the explanation.
- **Movies 32 (Eric Stoltz):** "about five weeks" softened to "several weeks"
  (accounts give five or six).
- **Movies 26 (Lethal Weapon):** dropped "four films", which a future sequel would
  make wrong.
- **Movies 50 (Ordinary People):** removed Kevin Costner as a distractor; he also
  won Best Director for a debut (Dances with Wolves, 1990), which made the option
  arguable for anyone who skipped the film title.
- **Books 51 (Dickens):** "three-volume hardbacks" changed to "three-volume sets"
  to avoid an anachronism.
- **Books 53 (George Eliot):** explanation no longer claims a single motive for the
  pen name.

## Ambiguity checks that passed
- Movies 19: "Go ahead, make my day" is only in Sudden Impact among the four
  Dirty Harry options; Sudden Impact is the only one Eastwood directed.
- Movies 41: E.T. is the decade's top grosser domestically and worldwide.
- Movies 42, 49: distractors Tootsie and John Lithgow were nominees that lost,
  not co-winners.
- Movies 51: "written for" Rocky III, so a later reuse of the song does not make
  Rocky IV arguable.
- Books 15: Virgil is the guide in the poem, not its author (stated in the
  explanation).
- Books 52: Percy Shelley was present at the Villa Diodati, but the challenge is
  consistently attributed to Byron.
- Books 59: "while he was a professor" at Oxford; Tolkien's earlier Leeds post is
  not among the options.
- Spoilers: limited to premises and famous long-public turns (Holmes's apparent
  death, phrased as "apparent").

## Coverage of "not only Anglo-American" (books)
About a third of the books set is from outside the English-language canon:
Spanish, Colombian, Russian, French, German, Czech, Italian, Nigerian, Indian,
Turkish, Egyptian, Japanese, Chinese, Mesopotamian, Sanskrit and Arabic works.

## Independent review, 2026-11-07 (separate reviewer)

A separate reviewer checked all 120 questions after this review was written. They
did not read this file before reaching their verdicts. They worked **from knowledge
only**: wikipedia.org does not resolve from that session either, so no source was
fetched. They found the CSV and JSON identical, and also checked the exact wording
of every quote and first line.

| Set | wrong | ambiguous | minor |
|---|---|---|---|
| 80s Movies | 0 | 0 | 6 (7 questions) |
| Greatest Books | 0 | 0 | 2 |

All eight were applied to the CSV and the JSON together. No answer key or answer
position changed.
- **Year giveaways.** In a set billed as "every film released 1980 to 1989", a year
  in the prompt or options gave the answer away. movies80s-11, -12 and -16 had the
  year dropped from the prompt; movies80s-19 had the years dropped from the four
  Dirty Harry options.
- **movies80s-22:** the explanation ("a year before the two made Batman") gave
  away movies80s-34. It now names Tim Burton's ghost comedy and its cast instead.
- **movies80s-20:** Katz's is a deli, not a diner. The prompt now says "deli customer".
- **movies80s-46:** Tandy is now described as setting the record as the oldest
  Best Actress winner. That stays true whether or not she still holds it; I could
  not check the most recent ceremony.
- **books-12:** the explanation ("The Nigerian writer…") gave away books-40. It now
  describes Okonkwo and the arrival of colonial rule instead.
- **books-04:** Anna Karenina was serialized 1875–77 and appeared as a book in 1878.
  The explanation now gives both dates.

Not changed: the design note about works that come up more than once (Don
Quixote ×3 and several ×2). Only the 12→40 repeat gave an answer away, and that
is fixed.
