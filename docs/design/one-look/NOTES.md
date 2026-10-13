# One look: the wall, the host and the room

**Status: PROPOSED, 2026-10-13. Not built.** Mockups: `prototype.html` (this folder). Owner's ask:
"i like the style of the presenting screen. but now the participant and the host screens dont match
the style." Owner chose option C: every surface side by side for every moment, then build the
participant page first, the Remote second, and the laptop page with Phase 3.

## What carries over from the Presentation (the "one look")

| Element | On the wall | On the laptop, the Remote and the participant's device |
|---|---|---|
| Ground | dusk `--bg` with the top-right glow | the same dusk ground; no paper theme on any session surface |
| Top line | **Session** · Round 5, moment word on the right | the same line as each surface's header |
| Eyebrow | small blue capitals above a title ("STRATEGY", "VOTE") | the same eyebrow above every title |
| Titles | Archivo 800/700 | Archivo for titles, Inter for everything else |
| Progress | pips and "6 of 9 answered" at the foot | the same pips and words wherever progress is shown |
| A response | numbered badge, the card with the blue border, "Response 3 · name hidden" | the same card and badge, at phone or laptop size |
| A list of responses | mini cards and a range chip | rows with the same number badge |
| Workie's read | section heading, page pips, "Page 2 of 4" | the same heading and pips; a phone scrolls its own copy |
| Colour of action | none on the wall | **one orange per screen**: the host's next step, or the participant's Send / Vote |

## Rules kept

- The wall never scrolls; phones and laptops may scroll their own panels.
- One orange per screen (R3). Blue `--secondary` for state, selection and "showing".
- Words from `config/roundWords.js`; "phone, laptop or tablet" for the room's devices.
- During voting nothing anywhere names an author or shows points; "Response N" is the same number
  on the wall, every ballot, the laptop and the Remote.
- Measure every dialog and sheet at 660 px and 375 px.

## Open questions (each with a recommendation)

1. **Participant theme.** Recommend dusk everywhere in a session (matches the wall the room is
   looking at). Alternative: paper on phones for daylight readability.
2. **Counts on the participant's device.** Recommend "6 of 9 answered" under the participant's own
   confirmation, as on the wall. Alternative: only "Your answer is in".
3. **The participant's result.** Recommend the tally rows as on the wall, with the participant's own
   response marked "Yours". Alternative: only their own place and points.
