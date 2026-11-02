# Desk reviews: your own question, queued

*2 Nov 2026. Three desk reviews of `index.html` and `README.md`, each written in the voice of
the role. Each finding states what was changed. "Drawn" means the mockup changed; "Spec" means
README changed.*

## 1. A facilitator who improvises

*Runs strategy offsites; abandons the plan by round 3 most days.*

- **F-1. "The question I write is usually a reaction to the read. The read is up, I'm talking,
  and I need to get it in before I lose the room."** The rail link and the Session menu are two
  clicks. The phone is one tap away if it's in my hand.
  *Kept as is.* Adding a third door (the dock, a key) would break the one-orange,
  one-place rule. The rail link opens the composer with the cursor in *The question*, so it is
  one click and type. **Spec**: focus lands in the question field on open.
- **F-2. "When I press Next round I must be sure it's mine that comes up, not the set's."**
  *Revised (R1, drawn in frame 3)*: Your part now names it: "Next round asks your question:
  '…'". The rail and Rounds both mark it *Next · Yours*.
- **F-3. "Sometimes I want it right now, the read is done and I don't want another set question
  first."** *Kept*: **Now** is allowed at results, the read and feedback. *Revised (R3)*: the
  Now cell says what it does ("Ends the read and starts it"), and mid-answer it says why it is
  unavailable ("Answers are still coming in") instead of vanishing.
- **F-4. "I'd like Workie to know why I asked."** *Kept, already in*: *For Workie only*. The
  facilitator asked whether the room sees it. *Revised (R4)*: the lock and "Never shown to the
  room or on any phone" sit right under the field, not in help.
- **F-5. "Will people see it's my question and think the plan's off?"** That is fork F6:
  no label for the room. The facilitator agreed and said they would say it aloud when it helps.

## 2. A weekly host

*Runs the same team retro every Monday from one C&A set.*

- **W-1. "Two orange buttons."** The first draft made the composer's commit orange while Your
  part now's Next round was orange beside it. *Revised (R2, drawn in frame 2)*: on the laptop
  the commit is a strong plain button with a check. The orange stays the room's next step. On
  the phone Remote the sheet covers the screen, so its commit is the only orange there.
- **W-2. "Every Monday I ask the same warm-up that isn't in the set."** That is F4 (keep the
  question) and F8 (write it in Setup before round 1). *Revised (R5, drawn in frame 3, side
  crop)*: First up shows **Yours**, so the composer is reachable from Setup. F4 stays phase 2,
  after the session, as a new set version. This host would use it weekly, which is the
  argument for doing F4 soon after.
- **W-3. "Will my scores be off if I add a round?"** It scores like any round (D10). The host
  was fine with that. *Spec*: the help line says so.
- **W-4. "I typed it wrong and it's queued."** **Edit** on the row until it runs. *Revised (R6)*:
  after it runs, Edit is gone and the row says "Already asked. It's round 4". The first draft
  left Edit visible and refused it with an error.
- **W-5. "Removing should not be a big dialog."** *Kept*: Remove arms in place in the row,
  once. Undo sits on the status line.

## 3. An accessibility reviewer

- **A-1. Colour alone.** The Yours mark is violet, the Next mark amber. *Kept*: both are words
  ("Yours", "Next") with an icon on Yours. Measured: `#C9B6FF` on its wash is 6.19:1 on
  `--surface` and 5.13:1 on `--surface-2`; paper `#5B3FB0` on `#EFEAFB` is 6.41:1 (README §7).
  *Spec*: the production token is scoped (`--hc-yours`, `--hc-yours-wash`), never a raw hex
  outside the token block (engage-design §0.4). In the mockup only, the annotation pins are
  also violet; they are numbered circles and sit outside the product UI.
- **A-2. The "Where it goes" control.** Three tiles that look like a segmented button.
  *Spec (R7)*: a `radiogroup` labelled "Where it goes". Each option is a radio with its line as
  `aria-describedby`; arrow keys move between them. The disabled Now is `aria-disabled` with
  its reason still read out, not `disabled` (which would drop it from the tab order and hide
  the reason).
- **A-3. The commit label changes with the choice.** *Kept*. A button whose label follows a
  choice is fine as long as the change is announced. *Spec*: the label is the button's
  accessible name, and no live region is needed because focus is on the radio being changed.
- **A-4. The private field.** *Revised (R4)*: "Never shown to the room or on any phone" is the
  field's `aria-describedby`, so a screen reader hears it before typing.
- **A-5. One screen.** A screen-reader host on one screen must also be told the room sees the
  laptop. *Kept*: the choice sheet's first line is text ("The room can see this screen…"),
  first in reading order, and focus starts on **Open on my phone**.
- **A-6. Exits.** X, Cancel, ← Running order and Escape all go through one `requestClose()`
  that asks first when something is typed (engage-design hard rule 2). Focus returns to the
  button that opened the composer. *Spec*, as above.
- **A-7. Text sizes.** `shoot.js` reports nothing below 12px in any frame. The body inputs are
  15px on the laptop and 16px on the phone. The row actions are 30px icon buttons on the
  laptop (with `aria-label`s "Move later", "Remove", matching `QueueList`'s), and 44px on the
  Remote's touch variant.

## Revisions, in one list

| # | Change | Where |
|---|---|---|
| R1 | Your part now names the queued own question | frame 3 |
| R2 | Laptop commit is strong plain, not orange; Remote commit stays orange | frames 2, 5 |
| R3 | Now says what it does, and why it is unavailable mid-answer | frame 2 (crop) |
| R4 | The private note's "never shown" line sits under the field and is its description | frames 2, 5; README D3 |
| R5 | First up shows Yours; Setup is a way in (F8) | frame 3 (crop); README F8 |
| R6 | After it runs: "Already asked. It's round 4", no dead Edit | README F3 |
| R7 | Where it goes is a radiogroup; disabled Now stays focusable with its reason | README §7 |
