# Desk review: session start and live stats

Three readers walked the first draft of `index.html` (1 Nov 2026), frame by frame,
as the person they stand for. Each finding gives the frame, what the reader hit, and
what changed. **Revised** means the mockup and PNGs were changed; **Kept** means the
draft stands, with the reason.

---

## 1. Maya: first-time facilitator

Runs a quarterly offsite. Has a laptop, an HDMI cable and a projector she has never
seen. Has not used Engage on two screens.

| # | Frame | What she hit | Outcome |
|---|---|---|---|
| M1 | A1 | "I don't know if my projector is extended or mirrored. Help me pick was a small blue link in the far corner; I nearly missed it." | **Revised.** *Not sure? Help me pick* now sits under the two cards, where her eye ends after reading them (where the shipped chooser has it, `RoomScreenChooser.jsx:144-148`). |
| M2 | A2 | "I pressed Open and the window came up on my laptop, not the projector. Nothing told me what to do." The checklist only covered Open and Full screen. | **Revised.** A line under the checklist: *Opened on this screen? Drag it onto the projector, then click it once.* It is the one case `willPlace()` cannot handle (no Window Management API, or the permission was refused). |
| M3 | A1 | Saw the dimmed join screen in the preview and asked whether the room could already see the code. | **Kept.** The note under it says "Nothing yet". The preview is the clearest way to show what step 3 will put up. The dim and dashed border are the same "not yet" style the steps use. |
| M4 | A3 | "Do I have to set a time?" | **Kept.** The chip reads *No time limit*. That is a real choice, and the default. Nothing asks her to change it. |
| M5 | B1 | "Since round 2 opened: +2 joined." She understood it. "1 late answer from round 1" she did not: late from what? | **Kept, wording noted.** *Review* opens the late list, which explains each item (`LateList`, owner's labels). The tile does not try to explain a concept the list already owns. Open question Q6 in the README. |
| M6 | A5 | "Check the room can read this screen: how?" | **Revised.** The step now says how: *Look at the projector: can you read this line from the back of the room?* That uses the size choice right beside it. |

## 2. Raj: weekly facilitator, always two screens

Runs a Monday ops review in the same room every week, with a clicker. Wants the
fewest presses.

| # | Frame | What he hit | Outcome |
|---|---|---|---|
| R1 | A7/A8 | "One click from the list to the room joining is what I wanted." He asked what happens on a borrowed laptop. | **Kept.** The choice is stored per browser (`config/roomScreen.js` `storedRoomScreen`), so a new browser gets A1 once. It is written down under A7 and in the help step. |
| R2 | B1, C6 | At 1280×720 the pulse row pushed the response list down to two cards. "I want to see the answers too." | **Revised.** The tiles are tighter: 10/14px padding, the bar inside the numeral row's height, one line of sub-text. At 1280×720 C6 now shows three responses. |
| R3 | B1, B3 | "+1 min with the mouse means walking back to the laptop. Give me a key." | **Revised.** *+1 min* shows its key, `+` (`=` works too, the unshifted key). Neither key is taken today (`J` join code, `S` scoreboard, `F` fill, Space and arrows advance). The Remote has the same button. |
| R4 | B4 | The draft said "14 votes cast · 2 each" under Voted. Raj's ballots are ranked, not "2 each". | **Revised.** The number of picks per person is not a fixed fact of Call & Answer voting (`submit-vote.js` takes a `votes` list). The tile says *Voted 7 of 12 · 5 still voting*: people, not ballots. "Votes cast" now means people who have voted, which is what the owner asked to see. |
| R5 | B6 | Wanted the time shown on the wall by default. | **Kept as the recommendation.** *Show the time on the room's window* is ticked by default (README fork F3). |
| R6 | B2 | "Everyone's in. Will it move on by itself?" | **Kept.** Only if Auto is on (Session › Settings, `autoMode.js:110`). The tile says what is true, and Your part now names the move. Auto's grace countdown, when on, already shows in the bar (`HostActionBar`). |

## 3. Lin: accessibility reviewer

Reviews against WCAG 2.2 AA and the engage-design hard rules. Screen reader and
keyboard user herself.

| # | Frame | What she hit | Outcome |
|---|---|---|---|
| L1 | A3, A8, C1, C5 | New joiners were marked **only** by a green chip border: colour as the only signal (1.4.1). | **Revised.** The sub-line names them, *2 in the last minute: Priya, Tom*, and the chips keep the border as decoration. |
| L2 | B1–B4 | A ticking timer in a live region would announce every second. | **Specified (README §Implementation).** The time tile's text is not live. A separate polite region speaks at 1:00, 0:30 and Time's up only. The answered count is polite and throttled to one announcement every 5 s, plus "Everyone's in" at once. |
| L3 | B1–B4 | The ring and bar must not be the only carriers. | **Already met.** Ring `aria-hidden`; bar `role="img"` with "9 of 12"; the numbers are text. Filled segments against the track: info 4.81:1, success 4.54:1 (non-text 3:1 met). The empty track against the tile is 1.54:1. That is allowed, because the empty part carries no information the numeral does not. |
| L4 | A1, A5 | The chooser's drawings used 10px labels: under the 12px floor. | **Revised.** 12px. They stay `aria-hidden`, because each card's heading and text say the same thing. |
| L5 | A1–A8 | A step's state was drawn as a ✓ in a circle. | **Specified.** Each step is an `<li>` whose state is in its accessible name ("Where the room watches, done: Two screens"). The ✓ is `aria-hidden`. *Change* reads "Change where the room watches". |
| L6 | B6 | The time list must behave like a control, not a pile of buttons. | **Specified.** The chip is a button (`aria-haspopup="dialog"`, `aria-expanded`). Inside, the presets are a `radiogroup` (arrows move, Space picks), then the two checkboxes. Escape closes and focus goes back to the chip. Space on the page still presses the main move, as today. |
| L7 | B3, B7, C3 | A timer that ends answering penalises people who need more time (2.2.1 Timing Adjustable). | **Kept as the recommendation.** The timer is advisory by default (*Close answering when time is up* is off), and +1 min is one press. The wall and phones say it in words ("About a minute left"), never with a red countdown. |
| L8 | B1–B4 | The ring drains every second. | **Specified.** Under `prefers-reduced-motion` the ring and the wall bar move in 10 s steps, not continuously. |
| L9 | all | Contrast. | **Measured** (composited onto the real surface, the classic skin's dark tokens): text/surface 12.53, muted/surface 6.06, muted/surface-2 4.93, info/surface 5.91, accent-text/surface 7.42, on-accent/accent 7.42, success-text on the green-tinted tile 6.59, muted on that tile 5.13. All pass AA. |
| L10 | B3 | Three ambers at once: Your part now's emphasis, the Time tile's border and "Time's up", and the orange button. | **Kept, reasoned.** The skin separates them: `--warn` is "a status, not the accent" (`classic.css:70`). The button is the one *action* in orange. The word *Time's up* also carries the meaning in text. |

---

## What changed between the draft and this version

1. *Help me pick* moved under the cards (M1).
2. A line for a window that opened on the laptop screen (M2).
3. A5 says how to check the projector (M6).
4. Tighter pulse tiles: three responses at 1280×720 (R2).
5. A `+` key for +1 min (R3).
6. The vote tile counts people, not ballots (R4).
7. New joiners are named in text, not only by colour (L1).
8. The drawings' labels are 12px (L4).

Specified in the README, not drawn: live-region timing (L2), step names (L5),
the time list as a radiogroup (L6), reduced motion (L8).
