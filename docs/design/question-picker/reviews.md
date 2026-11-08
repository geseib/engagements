# Desk reviews: Choose a question

Three reviews, written in role against `index.html` and the PNGs, then the revisions they produced. These are desk reviews,
not sessions with real people: they test the design against what each reader is known to want, and they do not stand in
for watching the owner use it on dev.

## 1. The owner

> "This is the thing. C, pick it, I'm back, and I can see it landed in the queue. Three questions:
> 1. If I click a row in the rail that's coming up, does Ask next *replace* it or push it down? I usually mean replace.
> 2. In results I'm often thinking about what's next. Is Change what's next there too, or only while they answer?
> 3. Don't make me confirm on the phone choice every single time on one screen if I've already got my phone connected."

- **R1 (replace vs push).** Opened from a planned rail row, Ask next pushes that row down to #5, and nothing is removed
  silently. **Revised:** opened from a row, the preview adds a third action, **Swap with #4**. It puts the pick in that slot
  and returns the old question to the set; it is not removed for the session. This is the only place the action appears, so
  every row still offers just Queue and Ask next.
- **R2 (results).** Yes. The line shows in every moment where a next round exists: Lobby, Answer, Vote, Results, What we
  heard. It is hidden once the session has ended, and on the last planned round with nothing left in the set. **Revised:**
  README D3 now states the rule.
- **R3 (asking every time).** Fork F5 stays at "ask every time" for showing the list *on this screen*. When a Remote is
  connected, though, the first option becomes **Open on my phone**, and Enter picks it, so the choice costs one key.
  Until the laptop can tell that a Remote is connected (it cannot today: `remoteConnected={false}`), it stays at Connect your
  phone. **Revised:** README D9 names the dependency, and `PrivateChoice` takes `remoteConnected` as the Q choice does.

## 2. A weekly host (runs a Call & Answer staff session every Monday, two screens, a clicker in hand)

> "I live on the clicker. While the picker is open, will my clicker still advance the room? And if I hit Space by
> accident while I'm looking at a question, does it ask it?"

- **R4 (clicker).** Yes. The clicker sends →, which is never captured by the picker, and Space advances unless focus is on
  a picker control. That is the same key-landed guard the Session menu already relies on (`HostActionBar.jsx:279`). Space
  never asks a question: Ask next is Enter, or a click. Kept as designed.

> "Ten seconds after I pick, the status line is gone. If I'm talking, I miss the Undo."

- **R5 (Undo lifetime).** **Revised:** the status line stays until the next phase change, or until the host acts again,
  rather than fading after about 8s. The row's ⋯ in the running order keeps Remove for as long as the row is queued.

> "The set would serve next — I like it, but I didn't know the set picks those. Say so."

- **R6.** The group head already says "· if you change nothing". **Revised:** its `title` explains the rule: "The set
  serves unasked questions from the categories that are on, in the set's order."

## 3. Accessibility reviewer (WCAG 2.1 AA, keyboard and screen reader)

- **A1 (focus on open).** Moving focus to the search on open would silently put a screen-reader user in an edit field. **Revised:**
  on open, focus goes to the picker's heading ("Choose a question, 23 not asked"), which has `tabindex="-1"`. `/` or Tab
  reaches the search. The picker is `role="region"` with `aria-labelledby` on that heading, not a dialog, because it does not
  trap focus (README note 3).
- **A2 (repeated names).** Twenty buttons all named "Ask next" are ambiguous in a buttons list. **Revised:** each row's
  buttons are named "Ask next: Pricing we would change" and "Queue: …" through `aria-label`. The visible text is unchanged.
- **A3 (list semantics).** The rows should be a `listbox`-free list (`ul` › `li`), with the selected row marked
  `aria-current="true"`. ↑/↓ moves a roving `tabindex` and the preview follows. The preview is a `role="region"`
  "Preview" with `aria-live="off"`, so reading a row does not double-announce. **Kept**, and added to note 4.
- **A4 (filters).** The category checkboxes are real checkboxes with their counts in the accessible name ("Pricing, 4"). A
  switched-off category reads "Product, off for this session, 2". The filter chips' ✕ buttons are named "Remove filter:
  Pricing". **Revised** (README note 1).
- **A5 (way back).** The crumb is a button whose accessible name is the destination ("Back to round 3, Answer"). Esc, Done
  and the crumb all restore focus to the opener. If the opener has gone (a phase change re-rendered the rail), focus moves to
  the Round queue's heading, never to `body`. **Revised** (README note 2).
- **A6 (contrast).** I measured the dusk pairings the frames use, composited on `--surface #1B2942`. `--muted #9BA8BE` text
  is 6.0:1, `--secondary #7CA7E6` links are 5.9:1 and `--text` on the blue-wash selected row is 9.75:1. On the amber
  one-screen line, text over `--amber-wash` is 10.0:1. The tightest pairing is the selected row's muted meta line, at 4.71:1 on
  the blue wash. It passes AA by a small margin, so the wash must not get stronger. The "off" tag is muted text with a dashed border, so the state is in
  words, not only colour. No text is under 12px (`shoot.js` checks this). **Pass.** The palette test in note 1 pins these.
- **A7 (phone targets).** Every phone control is at least 44px: the back is 44 inside a 52 bar, the selects are 44 and the row
  buttons are 44. **Pass.**
- **A8 (announcing the result).** "Next: Pricing we would change" goes in a polite `role="status"`. Undo is a real button
  next to it, and pressing it announces "Put back". **Kept.**

## Revisions made

| # | From | Change | Where |
|---|---|---|---|
| R1 | Owner | **Swap with #n** in the preview, only when the picker was opened from a planned rail row | README D4, note 6 |
| R2 | Owner | Change what's next shows in every moment that has a next round | README D3 |
| R3 | Owner | Open on my phone comes first and is the Enter default once a Remote is known to be connected | README D9 |
| R5 | Host | The status line with Undo stays until the phase changes | README D7, note 6 |
| R6 | Host | The "serve next" head explains its rule in `title` | README D5 |
| A1–A5 | Accessibility | Heading focus on open, region not dialog, row-specific names, roving list, focus fallback | README notes 1–4 |
