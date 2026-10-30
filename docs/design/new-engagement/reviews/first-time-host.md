# Review: first-time host ("Dana")

*30 Oct 2026. A role-play review of the new-engagement mockups (frames 01–11, `index.html`,
README), compared with today's modal (`ux/baseline/01-modal-1440.png`). Persona: Dana, a team
lead who has never used Engage. A colleague told her to "use it for our retro next week". She
has 10 minutes before a meeting, she is not technical, and a screen that asks for things she
doesn't understand makes her anxious.*

---

## 1. Think-aloud walkthrough

**Today's modal (baseline), for comparison.** "Event title, format, question set." Call &
Answer is already orange, so I'd assume that's the normal one and leave it. Then I hit a big
box about "Workie's briefing" and "Choose a document" and freeze: do I need a document? Is
Workie a person who'll read it? I'd probably close the dialog and message my colleague.

**Frame 1 (first time).** This one is much bigger and calmer. The subtitle says "Three
decisions. Everything else has a sensible default." That's the most reassuring line on the
screen. **1 Name it**: easy. "The room sees this on the main screen and on their phones." Good,
so I won't type "ugh, retro again". I type "Team retro — October".

**2 Pick a format**: I look at the chips first, because they're in my words. "What do you want
from the room?" My answer is "a retro", and it isn't there. Three chips half-fit:
*Ideas and priorities*, *See if we're aligned*, *Feedback in their own time*. I hover
*Ideas and priorities*, and Call & Answer lights up. The side pane says "Answers an open
question on their phones, then votes for the answers that matter." OK, that does sound like a
retro: "what went well", then everyone votes. But the example on the right is
"Build a Threshold, Not a Door … Round 1 · Architecture", which means nothing to me. I can't
tell if that's what *my* screen will say. And "Workie's 'What we heard'". Who's Workie?

I also see *Feedback in their own time → Survey*. Feedback is literally what a retro is. Now I'm
torn. I scroll the cards. Survey is cut off at the bottom ("Structured feedback, …"). I'd click
**Not sure? / Compare the formats**.

**Frame 2 (compare).** This table is the first thing that actually helps me decide. Reading
across "The room" and "You get", Call & Answer gives me "the room's answers ranked". That's my
retro. Survey is "in their own time", and we'll be in a room together, so not that one. Two
things worry me, though. The **Needs** row says "A Call & Answer set". I don't have one. What is
a set? And Survey's **Starts** row says "Opens as you create it", while the foot of frame 1
promised nobody can join until I start. Which is it? I click **Use Call & Answer**.

**Step 3 (frames 1, 4, 5a).** In frame 1 step 3 is below the fold. I only learn it exists
from the foot ("3 things to decide…"). Once I've picked a format I get a search box: "Search 15
Call & Answer sets". I type "retro". The mockups don't show what happens next. The sets I can
see are *Ready or Not*, *The Rules We Wrote Down*, *Lessons from Different Schools* and
*What We Should Be Known For*. None of them is a retro. Tabs say "Yours 3 · Team 2 · Engage 10".
I have no sets, so is "Yours 3" someone else's? There's no "write my own questions" anywhere.
**This is where I'd give up**, or pick *Ready or Not* because it's highlighted and hope.

**Frame 4 (set chosen).** Categories appear: Architecture, Law, Design, Film, Medicine. Do I
have to choose these? Three are switched off. Did I do that? "5 of 8 categories · 10
questions". Ten questions at "10–15 min a round": is that 2 hours? My retro is 45 minutes.
Nothing tells me how long *my* session will take.

The optional box is clearer than today: one line, "People who join never see it". I'd skip it.
But on the right, "Workie's briefing: None — optional" and "Advanced: Defaults" have **empty
circles** next to them, like unchecked to-dos. My instinct is that I haven't finished.

**Advanced** line: "answers anonymous until voting closes". *Until?* So after voting, everyone
sees who said "our manager doesn't listen"? For a retro that's the most important setting on
the page, and it's hidden in a grey sentence under a fold called Advanced.

**Frames 5a/5b (changing the set).** Fine, as far as I can follow. "Keep the set I had" is a
nice escape. The amber "Your earlier picks belonged to the other set and were cleared" is
honest, though I'd have to read it twice.

**Frames 6–8 (Trivia, Build Room, Event).** Not for me. I appreciate that Build Room says up
front "You need Claude Code installed" and Event says "$2.00 an event" *before* I click, so I
wouldn't wander in by accident. The "Continue to … setup →" button makes it obvious I'm not
creating something yet.

**Frame 9 (ready).** "What happens next: Create → Start → Run → Report" with "Nobody can join
yet — you can still edit it." This is what lets me press the button without fear. I'd press
**Create engagement**.

**Frame 10 (phone).** Clean. Only three formats show, so I'd never see Survey or Wavelength
unless I opened "Wavelength, Survey, Build Room, Event". That's fine for me. "12 qs" is a little
cryptic.

**Frame 11 (light).** Same as frame 4. The dark room preview inside a light dialog looks
deliberate. No new confusion.

**Net:** I'd get through steps 1 and 2 with some wobbling, and stall at step 3 because no set
fits a retro and there's no visible "make my own".

---

## 2. Confusions, ranked by how likely they are to make me give up or pick wrong

| # | Frame | Exact words / element | What went wrong in my head | Risk |
|---|---|---|---|---|
| 1 | 4, 5a (step 3) | Set list *Ready or Not / The Rules We Wrote Down / Lessons from Different Schools / What We Should Be Known For*; search "Search 15 Call & Answer sets" | None of them is a retro, and there's no "write my own questions" or "start from a blank set". The empty-search state isn't designed. I either quit or pick an unrelated set and get Architecture/Law/Film questions in my retro. | **Give up / pick wrong** |
| 2 | 1, 2 | Goal chips "Ideas and priorities", "See if we're aligned", "Feedback in their own time" | My task is "retro", and three chips each half-match it, pointing to three different formats. "Feedback" (→ Survey) is the closest *word* but the wrong format for a live meeting. | **Pick wrong** |
| 3 | 4, 9, Advanced line | "answers anonymous until voting closes" / side pane "Names stay hidden until voting closes" / phone "Your answer is anonymous" | Does "until" mean names are revealed afterwards? The phone says just "anonymous". For a retro this decides whether people speak honestly, and it's under **Advanced**. | **Pick wrong (or cancel)** |
| 4 | 2 | Needs row: "A Call & Answer set", "A Trivia set"… | It tells me I need a thing I don't have and haven't heard of. Reads as a prerequisite, like Build Room's "Claude Code". | High |
| 5 | 2 vs 1 foot | Survey "Starts: Opens as you create it" vs "Nobody can join until you start it" | Contradiction. If I picked Survey by mistake, people could join immediately. That frightens me about every format. | High |
| 6 | 1, 4, 6, 9 | "Workie's 'What we heard'", "Workie's briefing", "Workie adapts its voice", "give Workie a report… so its read of the room is informed" | Never introduced. Person? Bot? Will it read my files or talk to my team? "People who join never see it" helps, but I still don't know what Workie *is*. | High (anxiety) |
| 7 | 4, 9 | "5 of 8 categories · 10 questions" next to "10–15 min a round" | I can't work out the session length. Is a round a question? 10 rounds would be 2 hours. | Medium–high |
| 8 | 4, 5b, 6 | Side pane: empty circles for "Workie's briefing — None — optional" and "Advanced — Defaults" | They look like unfinished checklist items. Makes me think I've missed something before Create. | Medium |
| 9 | 1, 4 | Preview "Build a Threshold, Not a Door", "Round 1 · Architecture", "Preview · sample" | Before I've chosen a set the example has nothing to do with my meeting. The tiny "sample" label is easy to miss, so I think this is what my room will show. | Medium |
| 10 | 4 | Categories with three already **off** (Film, Medicine, Culinary) | Did I turn them off? Must I choose? Nothing says "leave them all on if unsure". | Medium |
| 11 | 1 | Step 3 below the fold; only "3 things to decide…" in the foot | I didn't know there was a third step until I scrolled. | Medium |
| 12 | 1 | "SEVEN FORMATS — the first five play a question set live; Build Room and Event are set up on their own screen, and your title goes with you" | One sentence carrying four ideas, two of them jargon ("question set", "own screen"). I skipped it. | Medium–low |
| 13 | 2, 1 | Wavelength: "Word association: a word counts when everyone says it" under the chip "See if we're aligned" | The chip promised alignment and the card describes a word game. I can't connect them. | Medium–low |
| 14 | 5a, 4 | Tabs "Yours 3 · Team 2 · Engage 10"; badge **Engage** on a set; column **QS** | I've never made a set, so how do I have 3? "Engage" is the product name, so is it a tag or a type? QS = questions? | Low–medium |
| 15 | 9 | Advanced "Changed: goal 8 questions" / side pane "Goal" | "Goal" already meant "What do you want from the room?" in step 2 (and is a Build Room step in frame 7). Three meanings of one word. | Low |
| 16 | 1, header | "New engagement", "Sessions list", "Event" (a format), "the room" | Engagement, session, event, room. Are these four different things? | Low |
| 17 | 4, 6, 9 | Create button with keycaps `Ctrl` `↵` | Noise for me. Harmless, but it makes the main button look technical. | Low |
| 18 | 10 | "12 qs" | Abbreviation. | Low |

---

## 3. Words I didn't understand, and what I'd expect

| Word on screen | Where | What I thought | What I'd expect instead |
|---|---|---|---|
| **Engagement** | header, button | A marketing word. Is it a meeting? | "New session" or "Set up a session" (and use one noun everywhere). |
| **Format** | step 2 | Fine, roughly "type of activity". | OK. "Activity type" or "How the room takes part" would be warmer. |
| **Call & Answer** | everywhere | Sounds like a church thing or a call centre. | Keep the name but always show its plain line beside it: "Everyone answers, then votes". |
| **Wavelength** | gallery, compare | No idea. | "Word match" or keep the name with the subtitle "Are we on the same wavelength?" |
| **Set / question set** | step 3, compare Needs row | A bundle I have to own first? | "Questions". "Pick ready-made questions, or write your own." |
| **Category** | frame 4 | Filters? Topics I must choose? | "Topics in these questions (all on — switch off any you want to skip)". |
| **Round** | "10–15 min a round" | A question? A section? | Say it once: "a round = one question: answers, then the vote". |
| **Workie** | briefing, You get, Advanced | A colleague? A bot? | First mention: "Workie (Engage's AI assistant)". Then "Workie" is fine. |
| **Briefing** | optional box | Instructions for me? | "Background for Workie (optional)". |
| **Build Room / Claude Code** | gallery | Something for developers. | It's fine that I don't get it; the tag "Own setup screen" plus "needs Claude Code" told me to stay away. Maybe tag it "For software teams". |
| **Engage** (badge) | set rows | The product? | "Ready-made" or "From Engage". |
| **QS** | chooser column | ? | "Questions". |
| **Goal** (Advanced) | frame 9 | Clashes with "What do you want from the room?" | "Stop after 8 questions". |
| **Own setup screen** | Build Room / Event cards | Will I lose my work? | "Continues on its own page" (frames 7–8 explain this well once clicked). |

---

## 4. What I liked, and must be kept

1. **"Three decisions. Everything else has a sensible default."** and **"Optional — every one
   has a safe default."** These lines lowered my anxiety more than anything else. Keep both, word
   for word.
2. **The compare table (frame 2).** It's the one place I could actually decide. The rows
   "The room / You get / Typical length / Group size" are the right questions. Keep it a table,
   and keep the "Use …" button at the foot of each column.
3. **"What happens next: Create → Start → Run → Report"** with **"Nobody can join yet — you can
   still edit it."** (frames 3, 9). It's the reason I'd press Create. Keep it, and keep the lock
   line in the foot.
4. **Goal chips in plain language** ("A quick show of hands", "Test what they know"). The idea
   is right even though my case wasn't covered (see §5.2).
5. **The side pane's three lines, *The room / You get / Takes*** (frame 1). Short and concrete.
6. **"The room sees this on the main screen and on their phones"** under the title field.
7. **Build Room and Event say what they need *before* I leave** ("You need Claude Code
   installed", "$2.00 an event", "Nothing is created yet"), with **Continue to … →** instead of
   Create. I'd never stumble into a paid or technical flow.
8. **The briefing shrinks to one line marked optional**, with "People who join never see it".
   Compared with today's big dashed box, this is the single biggest improvement for me.
9. **Nothing pre-selected for a first-timer.** In today's modal I'd have left Call & Answer on
   just because it was orange. Here I made a real choice.
10. **"Keep the set I had"**: a visible undo.
11. **The dialog doesn't jump or resize** when I change things.

---

## 5. Concrete suggestions

1. **Give step 3 a way out when no set fits.** At the top of the set list, or as the
   empty-search result, add: **"Write my own questions"** (opens a short inline editor or the set
   editor with this format preset) and **"Start from a template"**. Design the empty search
   state: *"No sets match 'retro'. Write your own, or try: [Retro starter]."* Without this, the
   novice path dead-ends.
2. **Add meeting-type chips that people actually say** alongside the goal chips: *Retro*,
   *Brainstorm*, *Kick-off*, *Team check-in*, *Quiz*. Each one highlights a format **and**
   pre-filters step 3 to matching sets (for Retro: Call & Answer plus any set tagged retro).
   If keeping goals only, rename *Feedback in their own time* to **"Feedback by form, not
   live"** so it stops capturing live retros.
3. **Bring anonymity forward and make it unambiguous.** Add a one-line visible setting under
   Questions for Call & Answer: **"Names: hidden from everyone (always) / revealed after voting"**.
   Mirror the exact wording on the phone preview. If names really are revealed after voting by
   default, say so in plain words, not "until voting closes".
4. **Replace "Needs: A Call & Answer set" with "Questions: 15 ready-made, or write your own"**
   in the compare table. Make it an offer, not a prerequisite.
5. **Fix the Survey contradiction.** Either the Survey row reads "Starts: open as soon as you
   create it (no Start button)" **and** the foot line changes for Survey to "People can answer
   as soon as you create it", or it behaves like the others. Never show the lock line next to a
   format that ignores it.
6. **Introduce Workie once.** First appearance in each frame: "Workie, Engage's AI assistant,
   writes a 'What we heard' summary after each round." Add a small (?) next to Workie that says
   what it reads and who sees its output.
7. **Show an estimated length in "What you're creating"**, for example "10 questions ·
   about 45–60 min", and update it when categories are toggled. Define "round" once in the
   side pane.
8. **Don't use empty circles for optional rows.** Use a grey dash or "Skipped — that's fine"
   for the briefing and "Using defaults" with a neutral icon for Advanced, so only required
   rows look like a checklist.
9. **Before a set is chosen, label the preview clearly**: a banner across the stage,
   "Example from another session. Yours will show your questions." Swap it out as soon as a set
   is chosen (the README already plans this).
10. **Start every category ON for a new pick, and say so**: "All topics are on. Switch off any
    you want to skip." Frame 4's mixed on/off state shouldn't be the first thing a novice sees.
11. **Keep step 3 visible in frame 1.** Shorten the gallery (e.g. 2 rows of 4 with smaller
    previews) or show a collapsed "3 Choose the questions — pick a format first" stub above the
    fold, so all three decisions are visible without scrolling.
12. **Cut the "SEVEN FORMATS — …" sentence** to "Pick one. Build Room and Event continue on
    their own page." The tag on those two cards already does the rest.
13. **Rename the chooser tabs** for someone with nothing: "Ready-made 10 · My team 2 · Mine 0".
    Hide empty tabs. Spell out "Questions" instead of QS, and "Ready-made" instead of the
    **Engage** badge.
14. **Rename the Advanced "Goal"** to "Stop after N questions" to free "goal" for step 2.
15. **Pick one noun.** If the button says "Create engagement", the next step shouldn't say
    "Sessions list". Use "session" throughout, or explain "an engagement is one session".
16. **Hide the `Ctrl ↵` keycaps until compact mode** (or until the host has created once). They
    help experts and add noise for novices.
