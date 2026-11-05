# Independent geography and music/pop-culture QA

Reviewed 2026-11-02 UTC. Editorial audit of all 120 questions and all 100 existing 80s question prompts in `trivia-80s-source.csv`. No service writes or deployment performed.

## Result
Both JSON sets pass content-structure checks: 60 unique question prompts each; six categories of 10; four distinct options per question; one in-range correctIndex; source URLs present for every question. Answer keys each contain exactly 15 A, 15 B, 15 C, 15 D answers. Geography's repeating ABCD pattern was replaced by a seeded balanced shuffle; music already had a randomized balanced distribution. Correct answer text preserved during shuffling.

No direct repeated questions found against the existing 80s prompts. Reused artists and broader subjects ask different facts. The movies set was not available to this reviewer, so no claim of comparison against all existing movie questions.

## Corrections and improvements
- Music Q5: original broad 'lyrics for many Elton John songs' admitted Tim Rice as a plausible second answer. Narrowed to the partnership beginning in 1967; Bernie Taupin is uniquely supported by Elton's official account.
- Music Q19: used precise 'vibrating cane blades' rather than counting pieces of cane before construction. Yamaha confirms two blades; answer remains 2.
- Music Q41: removed 'pyramid-shaped' from the prompt, which gave away Pyramid Stage.
- Music Q59: replaced software/menu-action distractors with game-action distractors.
- Music Q55: original Smithsonian source returned a fetch error in this pass despite being indexed with the correct fact; added Mattel's own anniversary source confirming 1959.
- Geography Q18,49,51,52,54,56,58,59,60: strengthened distractors. Removed especially implausible sandstorms/auroras/Jupiter distractions in favor of geographically or physically relevant alternatives.
- Geography Q54: hotspot described as beneath a plate, not inside it.
- Geography Q50: source replaced with USGS's map-symbol guide, which explicitly supplies both 1:24,000 and 2,000 feet per inch.

## Independent primary-source spot checks
This is an all-question editorial audit plus targeted source verification, not a second exhaustive visit to every source.

- USGS map guide confirms intermittent blue dashed-and-dotted streams, contour spacing and map-scale arithmetic: https://www.usgs.gov/ngp-standards-and-specifications/us-topo-cartographic-specifications-map-symbol-guide
- UNESCO confirms Pamukkale translation variants (Cotton Palace/Cotton Castle), mineral springs and terrace formation: https://whc.unesco.org/en/list/485
- NPS confirms wind and water break gypsum crystals into White Sands grains: https://home.nps.gov/whsa/learn/geology-of-white-sands.htm
- Yamaha confirms oboe's two vibrating cane blades: https://www.yamaha.com/en/musical_instrument_guide/oboe/mechanism/mechanism002.html
- Elton John official account dates the Taupin partnership to 1967: https://www.eltonjohn.com/stories/happy-birthday-to-bernie-taupin-2019
- Glastonbury confirms Pyramid Stage first built in 1971: https://www.glastonburyfestivals.co.uk/areas/pyramid-stage/
- Sanrio confirms Hello Kitty born in London suburbs; the unusual `hello_kity` URL is valid: https://corporate.sanrio.co.jp/en/business-info/brands/hello_kity/
- Metropolitan Museum confirms non-contact theremin playing: https://www.metmuseum.org/art/collection/search/739621
- American Musical Instrument Society confirms the common 21-string kora: https://www.amis.org/post/on-the-organology-of-the-kora
- Mattel confirms Barbie debut in 1959: https://creations.mattel.com/blogs/inside-look/barbie-65th-anniversary-inspiration-through-the-decades

## Editorial observations, not blockers
Geography uses a few intentional callbacks (atolls, Crater Lake, Pamukkale, White Sands) but tests distinct location/material/process facts. Music includes a few artist callbacks as well. World-music geography remains musically focused. Difficulty labels are subjective: geography is harder overall (11 easy/38 medium/11 hard) than music (24 easy/24 medium/12 hard). No live projector/UI/layout checks performed by this reviewer.
