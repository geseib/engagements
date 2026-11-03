# Desk reviews of the experience plan

*1 Nov 2026. Three reviewers read the first draft of `PLAN.md` and the five mockups
(`p-*.png`). They were role-played by the designer, each against a brief. What changed
because of each review is listed at the end. Revision 2 of the plan has all the changes.*

---

## 1. The owner: wants it simple and good-looking, and hates things moving

**Brief:** read it as the person who will check it on dev. Does it answer the takeover
complaint? Is it simple? Does anything move?

| # | Finding | Severity |
|---|---|---|
| O1 | **The strip moves everything.** In frame 1 the Needs-you strip pushes People, the pulse and the responses down about 60px the moment Sam asks. Then it all jumps back up when I answer. That is exactly what I said I hate, and it happens mid-round while I am reading a response. | High |
| O2 | Frame 1 answers my complaint directly: the request is with the bell, under the main button, and on Sam's name. Good. I'd check that on dev first. | — |
| O3 | Frame 2 makes the point that nothing moves between Call & Answer and Trivia. I'd like the plan to say in one line what I will notice in the first week, before the phase tables. | Low |
| O4 | The top bar now has text on every button ("Needs you", "Session menu", "Main menu"). That is calmer than today's icons-and-words mix. Keep it. | — |
| O5 | Frame 5 says "one orange per screen" next to a column of orange buttons. Say it is a specimen. | Low |

## 2. A weekly facilitator: runs a 25-person session every Thursday, often on one screen

**Brief:** you have run 30 sessions. What would trip you up in a real room?

| # | Finding | Severity |
|---|---|---|
| F1 | **Late comments will keep the bell lit all session.** In a chatty round I get a late comment every couple of minutes. If each one counts on the bell, the bell is never zero, and I'll stop looking at it, including when someone is actually waiting to get in. The number has to mean "a person is waiting on you". | High |
| F2 | **"Let them" can hand a name to the wrong person.** If Sam's first device is still answering, a second "Sam" asking is more likely a different Sam, or a prank. The line says "first device away" in the mockup; it should change what the button does when the first device is still active. | Medium |
| F3 | On one screen I rarely have a hand free for my phone. The sheet that opens from the bell is fine because it shows kinds, not names. For a name request I'd usually just say "Sam, I'll let you in" and press it. The plan's per-item reveal supports that. Keep it. | — |
| F4 | Sam jumping to the top of People is movement too, but it is the one row I need, and nobody else's row moves. Acceptable. | Low |
| F5 | Ten minutes before a request lapses is right for a training room. In a 200-person all-hands I'd want shorter. Leave it as the owner's decision, as drafted. | — |
| F6 | The participant screens (frame 4) are the first time I've seen the takeover explained to the person on their own screen. "That's me" as the main button is right: in my rooms it is the same person 9 times in 10. | — |

## 3. An engineer estimating the work

**Brief:** is each step really one or two days on this codebase? What is risky? What is
missing?

| # | Finding | Severity |
|---|---|---|
| E1 | **1d is two jobs of very different risk.** The server refusing answers and votes from a device that no longer holds the name is the safety fix: the websocket answer path checks no device id today. Pushing a "your name moved" frame to the *old* connection needs the server to find that connection by player, which the connection rows may not support cleanly. Ship the refusal first; the old device can learn from the refusal on its next answer or reconnect. Make the push a separate, optional step. | High |
| E2 | **1c needs one server change it does not list.** A ten-minute lapse worked out on the client is not enough: a grant pressed after the lapse must be refused by `grant-handover.js`, or a stale "Let them" opens a name nobody is waiting for. Small, but say it. | Medium |
| E3 | **2a and 2d are under-sized.** `GameHostPage.jsx` is about 9,800 lines and holds both the console and the stage. A shared top bar on the console is a day. Moving the stage's main action to the top changes what the fitter measures, at four sizes and four display profiles. That is its own step of two to three days, and event items moving onto the console is a separate day (the AGENDA and "Bring everyone here" controls need homes in the console's slots). | Medium |
| E4 | **4a is three days, not two.** The two session lists have different row actions (Invite, Results, Edit as an early return on one side; console-only actions on the other). Split: one list component first, then switch Home to it. | Medium |
| E5 | **The Remote has no socket.** Its Needs-you list must be worked out from what it polls: players every 6 s and host state every 2 s. Name requests and the read's state are there; the late count is not in host state. Say the Remote starts with the subset it can see, and adds late items when host state carries the count. | Low |
| E6 | Phase 0 first is right: otherwise the migration itself adds drift while it runs. The banned-words guard needs an allow-list for tests, comments and the help's "what changed" notes, or it will fail on the plan's own vocabulary table. | Low |
| E7 | The privacy guard needs a list to start from, not a tag on every component on day one. Seed it with audit B's eight hazards. | Low |
| E8 | Overall: Phases 0–1 about a week and a half, Phase 2 two to three weeks (more with Trivia and Poll on two screens), Phases 3–5 a week or so each. The plan's totals were optimistic by a few days, not by weeks. | — |

---

## What changed in the plan and the mockups

| Finding | Change |
|---|---|
| O1 | **The Needs-you line is always there on a private laptop.** When nothing is urgent it is one calm line ("Nothing needs you now" or "1 to review when you can"); when something is, the same line turns amber and carries the buttons. Its height never changes, so nothing below it moves. Principle 1, §3.2, §4.3; frame 2 now shows the calm state. |
| O3 | A "What you will notice first" list opens §6. |
| O5 | Frame 5 labels the system column a specimen sheet. |
| F1 | **The bell's number counts Now items only** (a person waiting, something broken). Soon items show as a small dot on the bell and in the list, never as a number, and all late arrivals are one list item, however many there are. §4.1, §4.3; frame 2's bell shows the dot. |
| F2 | **"Let them" arms in place when the first device is still active:** the first press changes it to "Let them anyway" with "Sam is still answering on their first device"; a second press within six seconds goes ahead (host standards §3's press-twice rule). §4.4. |
| E1 | 1d split into **1d** (server refuses the old device; the old device shows the stopped screen when its next answer is refused or it reconnects) and **1f** (push the frame to the old device at once, optional). |
| E2 | 1c now lists the `grant-handover.js` refusal after the lapse. |
| E3 | 2a is the console's top bar only (1 day). 2d split into **2d** (event items on the console, 1 day) and **2h** (the one-screen stage takes the top bar and the main action under it, 2–3 days, measured). |
| E4 | 4a split into **4a** (one list component, 2 days) and **4b** (Home uses it). |
| E5 | 1b states what the Remote can show from its polls, and what waits. |
| E6, E7 | §5.3 notes the allow-list and the seeded privacy list. |
| E8 | §6's totals corrected. |

Declined: F4 (keep lifting the asker; it is the one row that needs the eye) and F5 (left as
owner decision 5).
