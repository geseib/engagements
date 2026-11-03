# Desk reviews

Three desk reviews of the first draft of `index.html`. These were done by reading the rendered frames as each persona, not by testing on a phone. Each finding records what was changed, or why nothing was. The PNGs show the revised draft.

Severity: **H** = would still produce the owner's complaint, **M** = slows or misleads, **L** = polish.

---

## Reviewer 1: a first-time participant

*Never used Engage before, on their own phone at a conference table. They tapped **Comment on this round** after round 3's results and had never seen the panel.*

| # | Sev | Finding | Outcome |
|---|---|---|---|
| 1.1 | H | "In the first draft the round number sat in a circle: 2, 5, 1, 4, 6, 3. I read it as the ranking and thought the list was broken, because it wasn't in order." | **Revised.** The circle is gone. Each card reads its author's name, then "Response 2 · 6 votes, the most" in words. The order says the rank, and the number is just a name for the response (README D8). |
| 1.2 | H | "The **Comment on Workie's read** button came after Workie's comments, below the fold. I scrolled past other people's comments looking for a way to add mine." | **Revised.** The action now sits directly under the read, inside the card, and the comments are behind "Show 2 comments". That is the same pattern as a response card: content, action, thread. |
| 1.3 | M | "'Most votes · 6' read like 'the most votes is six'." | **Revised** to "6 votes, the most". |
| 1.4 | M | "I wasn't sure whether the question at the top could take comments. It looks like the other cards." | **Kept, made distinct.** The question is not a card. It has a plain "THE QUESTION" label and a rule under it, with no border, no surface and no action. Commenting on the prompt remains out of scope (`config/comments.js:10-15`). |
| 1.5 | L | "'Anything else about this round?' — anything else than what?" | **Kept.** The line under it answers that: "For a comment that is not about Workie's read or any one response." Read top to bottom the page makes sense, and the jump links name the three sections in order. |
| 1.6 | — | "The sheet heading 'Reply to Priya Shah's response' plus the quote made it obvious what I was replying to. I didn't need the card behind it." | Confirms D4. |

## Reviewer 2: a talkative participant

*Has opinions on everything. Replies to five of fourteen responses, comments on Workie's read, then wants to find their own comments again.*

| # | Sev | Finding | Outcome |
|---|---|---|---|
| 2.1 | H | "I typed half a reply, saw a better response further down and tapped Reply there. In the shipped panel my text vanished." | **Revised.** "Move your reply to Marcus Lee's response? Your words come with it." with **Move it** / **Keep it here** (README D5). |
| 2.2 | M | "With threads collapsed I have to open every card to read the discussion. I want to read all of it." | **Revised.** **Open all replies** on the responses heading, which stays pinned while the list scrolls (frame 1-07). Threads stay collapsed by default for everyone else (fork 6). |
| 2.3 | M | "Which ones have I replied to? I lose track at fourteen." | **Revised.** Cards I replied to read "Show 1 reply (yours)". Once I have posted, a banner at the top lists every place, each item a link (frame 1-06 notes). |
| 2.4 | M | "In the first draft 'Reply to this response' and '2 replies · 1 yours' fought for one row and wrapped unevenly." | **Revised.** The thread toggle has its own row under the action, as "Show 2 replies (1 yours)", and nothing wraps at 360. |
| 2.5 | M | "I posted something sharp and want to take it back." | **Not done; open fork 8.** There is no edit or delete route for participants. The sheet already states the name rule before posting. Adding "can't be edited after posting" would make the one required line longer, so it is left for the owner to decide with the fork. |
| 2.6 | L | "After posting, focus going back to Reply on the same card is good for a follow-up. When I'm done with that card I'd like Next." | **Kept.** The next card's Reply is one swipe and one tap away. A "next response" control would be a second way to move through the list. |

## Reviewer 3: an accessibility reviewer

*WCAG 2.1 AA. Phone with VoiceOver, keyboard on a laptop, 200% text.*

| # | Sev | Finding | Outcome |
|---|---|---|---|
| 3.1 | H | **Label in name (2.5.3).** The draft's reply button had the visible text "Reply to this response" and the accessible name "Reply to: The handoff…". A voice-control user saying "tap Reply to this response" would miss it. | **Revised.** The name is now "Reply to this response: The handoff from sales to implementation… (Priya Shah, response 2)". It begins with the visible label and keeps the brief's "reply to" plus the start of the response. Workie's is "Comment on Workie's read", the same as its visible text. |
| 3.2 | H | **Non-text contrast (1.4.11).** The outlined section actions used `rgba(182,194,212,.34)`, which is 2.19:1 against `--surface`. The outline is what marks the button. | **Revised.** `--pc-edge` is `rgba(182,194,212,.55)`: 3.49:1 on `--surface` and 3.79:1 on `--bg`. It applies to every outlined control (actions, Cancel, X, jump links, Close). |
| 3.3 | M | Decorative icons would be read out ("image") or announced twice. | **Revised.** Every icon carries `aria-hidden="true"`. Each control's name is its text. |
| 3.4 | M | Thread toggles need state. | **Revised.** `aria-expanded` and `aria-controls`, and the label flips between "Show 2 replies" and "Hide 3 replies", so the state is in words as well as in an attribute. |
| 3.5 | M | Is the sheet a dialog? Without a focus trap, `role="dialog"` would promise something false. | **Kept as `role="region"`**, labelled by its heading, with focus moved into the box. The box's accessible name is the heading and its description is the name rule, so VoiceOver reads "Reply to Priya Shah's response, text field, Your name is shown with this reply…". Escape, the X and Cancel all go through one `requestClose()`. On close, focus returns to the control that opened the sheet. This matches the shipped reasoning against a modal (`FeedbackRoundPanel.jsx:196-202`). |
| 3.6 | M | 200% text: the sheet's height plus the keyboard exceed the viewport on a 360 phone. | **Specified.** The sheet is capped at the space above the keyboard and scrolls inside. The quote shrinks first, and the name rule and the actions are never cut (README D10). Frame 1-09 shows 100% text, and its note says the outlined card disappears at 200%. |
| 3.7 | M | The amber "target" outline and the white focus ring must not be confused. | **Kept and stated.** The target is a 2px amber outline on the card. Focus is a 2px `--text` ring on a control. They sit on different elements and differ in colour. Frame 1-06 shows both rules apart. |
| 3.8 | L | The sent confirmation must be announced. | Already `role="status"`. It fades after 6 seconds, which is not timed content in WCAG terms because the comment itself stays on the page. |
| 3.9 | L | Type floor. | The smallest text is 13px (the phone's floor, `PlayerSurface.css:115`), above the house 12px floor. The box is 19px. |
| 3.10 | — | Contrast of text pairs. | Every text pair is 6.3:1 or better (README section 2 table). Removing the circle (1.1) also removes the shipped white-on-amber podium number at 1.96:1. |

---

## What the revision changed, in one list

1. The response number became words ("Response 2 · 6 votes, the most"), no longer a rank-like circle.
2. Workie's action moved directly under the read, and its comments went behind "Show 2 comments", matching the response cards.
3. The thread toggle got its own row, so the action never shares a row and nothing wraps.
4. **Open all replies** was added to the pinned responses heading, and "(yours)" to the counts.
5. A "Move your reply?" confirmation was added for switching target with text in the box.
6. Accessible names now begin with the visible label, and control outlines went to 3.49:1.
7. Icons are `aria-hidden`, and the toggle state is in words and `aria-expanded`.
8. The 360 compose frame now shows the outlined target above the sheet, with an honest note about 200% text.
9. The sent frame is drawn scrolled to the card, so the new reply is visible.
10. Fault 7 was corrected (an empty list now means nobody answered, not nobody voted), and backend B2 was withdrawn.
