# Release notes

One entry per push to **test**, newest first. Each entry says what changed, what was
fixed, and what the reviewer should look at. The rule, from the owner on 16 Oct 2026:
before every push to test, the release notes, the in-app help and the README are
brought up to date (see `CLAUDE.md`, "Before every push to test").

Entries name the dev commit that was merged, so the review can be matched to the code.

---

## 23 Oct 2026 (Organisations): every team's Billing… button shows

**Test:** merge of dev `DEVCOMMIT`. Everything below this entry is already on test; this push adds only what is here.

### Fixed

- **Billing… was cut off on team rows** in Admin › Organisations ([#40](https://github.com/geseib/engagements/issues/40)): a team row has three buttons (Billing…, Activity…, Suspend, or Reinstate when suspended), the column was 168px wide, and the first one, Billing…, was clipped out of sight, even at 1920px. The column now fits all three, and that cell never hides a button.

### What to look at

1. As Engage staff, open Admin › Organisations: every team row shows **Billing…**, **Activity…** and **Suspend** (or **Reinstate**); personal rows show Billing… and Activity…. **Billing…** opens the team's billing drawer.

### Known gaps

- On narrow windows the list scrolls sideways rather than squeezing the buttons (as before, it was already 620px wide at least; now 700px).

---

## 23 Oct 2026 (staff help): the Engage staff guides checked on the real screens

**Test:** merge of dev `32c473c1`. Everything below this entry is already on test; this push adds only what is here.

### New

- **Applying the repo's prompts to a tier in one go** (another session): `scripts/apply-repo-prompts.js --tier <tier>` does what Admin › Prompts' *Review* → *Save as version N* does, for every prompt with a newer version in the repo. Dry run by default, `--apply` to save; prompts edited on the tier are skipped unless asked; prod needs `--confirm-prod`. It is an engineer's tool: nothing changes in the app.

### Fixed

- **The Engage staff guides now match the staff screens.** They were written from the code while the QA account could not see Engage's sections; it now can (dev), and every staff section was read against its guide. Corrected or added:
  - the *You are acting as Engage* banner, and the Overview's **Right now** tiles;
  - Organisations: what the Plan column means (Team is the Organisation plan), what **Staff activity…** covers (organisations, accounts, discount codes and Engage settings, kept a year), and that billing is a simulation (no card is charged);
  - Plan requests come from personal spaces too, read "Free → Organisation plan", and a decided row's note starts with the decision;
  - Discount codes: only a live code has **Retire**; Accounts: a row's moves appear when you point at it;
  - Observability: the month stepper, the five month tiles, the by-type table, and that it lists teams and personal spaces with numbers that month;
  - Engage settings: the apply button is greyed out for the look already in use;
  - Prompts: a retired prompt stays in the list, marked Archived; each results prompt has **Improve**.

### What to look at

1. Signed in as Engage staff on test, open **Help** › *For admins* › *Engage staff: organisations* and the other staff guides, beside Admin › Organisations, Plan requests, Discount codes, Observability and Prompts: each guide describes what the screen shows.

### Known gaps

- Every staff queue on dev was empty, so these are still checked only against the code: the Overview's queue boxes, accounts waiting for approval, **Decide…**, Moderation's rows, **Leave it serving**, and the bell's staff entries.
- Product bugs the check found are listed on [#43](https://github.com/geseib/engagements/issues/43) (among them: a team's **Billing…** button is clipped out of the Organisations row, [#40](https://github.com/geseib/engagements/issues/40)); the guides describe what the screens do today.

---

## 23 Oct 2026 (late night): searching Quick start and Your question sets, several tags and a date filter in the console, and three Build Room ideas features the last entries missed

**Test:** merge of dev `183fb769`. Everything below this entry is already on test; this push adds only what is here.

### New

- **Quick start has a search box** (owner, 23 Oct: "add search to Quick start"). It finds a word in a set's name, description or tags; each format's carousel shows only its matches ("2 of 6"), starts again at its first page, and a format with none drops out. Nothing matching says so, with **Clear the search**; Esc clears the box before it closes the sheet.
- **Your question sets has a search box** over both lists. Each list says how many of its sets match ("1 of 3"); nothing matching says what was searched, with **Clear the search**; Esc empties the box without closing the dialog. A set you are renaming or editing never disappears under a search.
- **The console's Question Sets list takes several tags at once and filters by date.** In *Browse topics and tags*, clicking more tags shows the sets carrying any of them; clicking a tag again lets it go. A new **Updated** filter: this week, this month, or older than 3 months. Both join the "nothing matches" ways out and *Clear all*. The same rules as the set chooser in New engagement.
- **Build Room, from the ideas flow** (on test since this afternoon, missing from the notes):
  - **Reply to Joe:** an idea's card has *Reply to <name>*, a private conversation only the host and that person see (never the room, the big screen or Claude). Their phone says *The host replied*; they answer from Ideas; the card says *<name> answered*. *Got it, thanks* in one press.
  - **Your vote (optional):** under an open Choose, Rate or Ideas vote, the host can vote as one person, change it or take it back. The room's screens say only "includes the host".
  - **What happened to your idea:** the sender's phone says how it went, in counts and never names: "The room voted yes, 9 to 4. The host sent it to Claude." Once decided, Now shows it for 15 minutes, until *Got it*.

### Fixed

- Quick start's "nothing matches" line is read out by a screen reader without the button beside it.
- `scripts/apply-repo-prompts.js` (another session): applies the repo's prompt versions on a tier in one go, for the prompt updates the previous entry asks an admin to apply.

### What to look at

1. **Quick start** (start screen › Quick start): type a word from one set's name; only its format's carousel keeps it, with "1 of N". Type nonsense: the sheet says nothing matches; **Clear the search** brings everything back. Press Esc with text in the box: it clears; Esc again closes the sheet.
2. **Your question sets** (start screen › Question sets): search a word that is in one of your sets and one other set; both lists narrow with "N of M". Start a rename, then search something it does not match: the set being renamed stays. Esc clears the search and the dialog stays open.
3. **Console › Question Sets › Browse topics and tags:** click two tags; the list shows sets with either, each tag named with its own ×. Set **Updated** to *This week*; then filter to nothing and use a way out from the "nothing matches" list.
4. **Build Room, Reply to Joe:** as a player, send an idea; as host, *Reply to <name>* on its card; the phone shows *The host replied*; answer; the host card says *<name> answered*.
5. **Build Room, Your vote:** open a Choose ask, vote as host under *Your vote (optional)*; the Stage's count says "includes the host".
6. **Build Room, what happened to your idea:** put a player's idea to the room as a yes/no (Consider › Queue for the room), close it, decide; that player's phone says the result and what the host did.

### Known gaps

- Quick start and Your question sets search only; their owner, tag and date filters are the set chooser's and the console's.
- The console has no "used by me lately" (it loads no sessions).
- A set's owner label in the console still has two tones, as before.

## 23 Oct 2026 (night): finding a question set when you create a session, the room sees what Claude was told, live typing on the room's window, Claude's mockups where you are looking, and the wheel fix

**Test:** merge of dev `2d68fe70`. Everything below this entry is already on test; this push adds only what is here.

### New

- **Finding a question set when you create a session** (another session, [#41](https://github.com/geseib/engagements/issues/41)). Create engagement's question set is no longer a long drop-down: one line with a search box and the sets you used lately, opening in place to search and filter by **Whose sets** (All, Yours, your team by name, Engage, Public, each counted), **Topic**, **Tag** (any of several), **Updated** (used by me lately, this week, this month, older) and **Sort**, with the keyboard and a *nothing matches* line that counts every way out. Hosts in several teams can switch team from it. The event agenda's item dialog uses the same chooser. Help: *Finding a question set*.
- **Sent to Claude leads the Stage** (owner, 23 Oct: "nobody can see what Claude was actually told"). From the moment you send until the next ask opens, the Stage, the room's window and the phones' Now lead with a **Sent to Claude** card: the words Claude got, and the room's pick they came from (*The room chose B · Calm photo*). Claude's status sits under it instead of replacing it. Every kind of send counts: a decided ask (reworded or not), Consider's Send to Claude, Add something, an idea sent from Waiting for you, Send now from the Later list, and What's next's Combine. Your Why is never on the card.
- **Don't show the room**, unticked, beside every Send to Claude (the decide panel, Change before sending, the one-press Send at Settle, Consider, Add something, and once over Waiting for you and over the Later list). Ticked, Claude gets every word as before; the Stage, the room's window and phones say only *The host sent Claude a direction*, and the room's History reads *Sent to Claude, not shown*. Your Host screen, console, Timeline and History keep the words, marked *not shown to the room*.
- **Show my typing to the room** (two screens only, off by default, remembered per session in this browser). While it is on, the room's window opened from this laptop shows *The host is writing to Claude…* with your words and a caret as you type a direction, never the Why. It goes when you send (the card takes over), on an empty box, or after 10 seconds without typing. The words never go through the server, so a room's window on another device does not see them.
- **Claude's mockups are ready**, where you are looking (owner, dev game 2550: "Claude made three mockups for a vote, but I couldn't readily put them up"). When every picture of one of Claude's Choose questions is in, a card shows the question and the A/B/C pictures (click one to look closer) above whatever you are running on the Host screen, and under the main button in **Your part now** on the console, never in its place. **Put to the room now** opens it, asking *Close ask 2 and open this?* first if an ask is open; **Next, after this ask** lines it up to open when the open ask closes (the existing Open next), and is the main button during the opening, so the mockups follow the step the room is on. Lined up, the card reads *Opens after ask N*, with **Not next**. More than one ready: the oldest, with *+N more in Waiting for you*. On the Stage the dock shows **Mockups ready** beside HOST; the room's window never does.
- **Waiting for you lists ready mockups first** among Claude's questions, so a set of pictures no longer sits under Claude's Ideas question.

### Fixed

- **Spin the wheel with only one idea** (dev game 2550): an Ideas vote with a single idea offered **Spin the wheel**, which the server refuses (a wheel needs two options), so pressing it ended in an error. The wheel is now offered only with two options or more, on the Host screen, the console and the Stage.
- After a send, the room's window kept the last question up with "Claude is building", and a direction sent without an ask never showed at all.
- Mockups Claude made during the opening, with an ask open, could only be reached through their card in Waiting for you, and nothing pointed at them.

### What to look at

1. **Create engagement**, Call & Answer: the question set is one line with a search box and your recent sets; open it, filter by **Whose sets** › Engage and a **Topic**, search a word, pick one, then **Change**. In an event's agenda, **Add item** › a session uses the same chooser.
2. On two screens, with a phone joined: run a Choose ask to results and press **Send B to Claude**. The room's window and the phone's Now show **Sent to Claude** with the words and *The room chose B · …*; when Claude says what it is doing, its status shows under the card, and the card stays until you open the next ask.
3. In Add something, type a direction, tick **Don't show the room** and **Send to Claude**. The room's window and the phone say *The host sent Claude a direction*; the phone's History says *Sent to Claude, not shown*; your Host screen and Timeline show the words with *not shown to the room*; Claude gets the words.
4. Tick **Show my typing to the room** beside Add something and type: the room's window opened from this laptop shows *The host is writing to Claude…* and the words as you type. Type in the Why: nothing new shows. Send: the card replaces it. Turn the toggle off and reload: it stays off for this session.
5. On one screen, the typing toggle is not offered.
6. In the opening, with a step's question open, have Claude propose a Choose question with mockups (or answer its Ideas question first so it sits above): once the pictures are in, **Claude's mockups are ready** shows above the open step on the Host screen (on two screens, under Your part now), with **Next, after this ask** as the main button. Press it: the card reads *Opens after ask N*; close the step's question and the mockups open to the room. In Waiting for you the mockups are listed above Claude's other questions.
7. Again with an ask open, press **Put to the room now**: it asks *Close ask N and open this?*; **Keep it open** changes nothing. On the Stage (press 2) the dock shows **Mockups ready**; pressing it goes to the Host screen.

### Known gaps

- Live typing shows on the Stage screen of the room's window only (not Build or History), and only while no ask is open. The words are shown as you type them: the room's window cannot hide a name you type.
- A send with no box of its own (points sent together, run-list items) always shows its words on the card; the instructions Preview the work, the brief request and the mockups request never do. While a run list is going, the Stage keeps the list, not the card.
- History still shows the room your Why for a decision or a Consider send (as before); Don't show the room hides that too.
- With nothing open between the opening's steps, the mockups card offers only **Put to the room now**: Open next has nothing to wait behind, so it would open at once.

---

## 23 Oct 2026 (late evening): review #46 and #47 fixes, before prod

**Test:** merge of dev `788546cf0` (and the commit naming it). This push also carries the entry below it (Connect Claude Code confirms the connection; the side boxes scroll on). Reviews: [geseib/engagements#46](https://github.com/geseib/engagements/issues/46), [geseib/engagements#47](https://github.com/geseib/engagements/issues/47).

### New

- **Ask Claude for mockups or a walkthrough** (another session, Build Room ideas flow E, plugin **1.27.0**): from Points' *Mockups…* or an idea's *Ask the room* menu, Claude draws two or three distinct quick screens as one Choose ask that comes back to the host first (*Mockups you asked for*; *Ask for new mockups* sets them aside and asks for different ones), or steps the room through the demo. An older plugin says to update.

### Fixed

- **Workie's check caught too little** (review #46, on a build that had the check). It now also catches:
  - **a number with the wrong unit**: "two branches" in the answers no longer lets "two Friday runs" or "a two-week pilot" through; "4pm Friday" still passes;
  - **an owner nobody named**: "Whoever runs the weekly release" when no answer mentions a release, and any owner copied from the prompt's own examples; "route lead", "driver", "growth sponsors" pass;
  - **claims about what the organisation already does**: "the current habit is to…" when the answers only proposed it;
  - **next steps handed out as tasks**: "Route lead: count…" is rewritten to start **Suggested**, even under the old prompts.
  Every prompt now also says never to describe current practice, or name an owner, the answers did not give. The repo's prompts lose their example owners, and the survey and poll defaults ask for **Suggested** steps too.
- **Going back to a round showed no lesson** (review #47). The end screen's "Something to add?" lists each round with its title ("Lesson 2 · Form Follows Function"; "Round 3" when it has none), and an opened round shows its lesson and "Your turn" above its responses. A comment started in one round stays with that round when you switch.

### What to look at

1. **Apply the prompt updates on test first** (they have never been applied there; review #46 ran on v1): Admin › Prompts shows "*N* prompts have a newer version in the repo". **Review** *Workie - The Transfer Reader* and **Save as version 2**; do the same for the others marked.
2. **Run review #46's round 1** with the same four answers (Lessons from Different Schools, Threshold): next steps start **Suggested**, with no "two Friday runs", "two-week", "weekly release" owner or "current habit". If a read still has one, the console and the phone show the host note.
3. **Repeat with the prompt left on v1** (or before applying it, on another set): next steps still come out as suggestions after the check's rewrite.
4. **Build Room** (update the plugin to 1.27.0 first): from an idea's *Ask the room* menu, ask Claude for mockups; the Choose ask comes back to you marked *Mockups you asked for* before the room sees it.
5. **As a player, at the end:** open "Something to add?": each round shows its title; open one: its lesson and "Your turn" show above the responses; start a comment, switch rounds, come back: the comment is still there and posts to its own round.

### Known gaps

- The check can still flag a real count stated in other words (for example "two separate policies" when the answers never counted them); the rewrite usually just rewords it.
- Drafts in "Something to add?" live in the page's memory; a reload loses them.
- The prompt updates reach prod only when an admin applies them there after the prod deploy.

## 23 Oct 2026 (evening): Connect Claude Code says when you are connected, and the side boxes scroll on

**Test:** merge of dev `323a6588`.

### New

- **Step 3 of Connect Claude Code confirms the connection** (owner, 23 Oct: "this screen doesnt turn step 3 green and indicate hey, you are done and connected"). After you mint a key, step 3 says *Waiting for Claude Code to call in…*; once Claude Code calls in with that key, the step turns green, reads **Connected**, gives the time and folder, says whether Claude has started, and **Done** becomes the main button. An older key calling in does not count.
- **The "already in Claude Code" line moved to step 3.** Step 2 is now only the folder, the key and the start command; step 3 holds both ways to start: paste the start command into a terminal, or type the kickoff line into a Claude Code already open in that folder.
- **Nothing after 45 seconds?** Step 3 says where to look: the first time in a folder, Claude Code may be asking in the terminal to trust it or to allow Engage.

### Fixed

- Step 3 never showed as done, even while the phones already said Claude Code was connected.
- **Scrolling the right-hand boxes** (Waiting for you, Decided, Timeline, History…) on the Build Room console and Host screen: the wheel over an open box scrolled only that box and stopped at its end, so moving the column needed the pointer on the gap between boxes. Now a box scrolls to its end and the wheel carries on to the column.
- The 23 Oct entry's known gap about the starter sets: they are installed on dev and test.

### What to look at

1. On a Build Room with no Claude yet, open **Connect Claude Code**, **Mint a key and copy the command**. Step 2 turns green; step 3 shows the kickoff line for an open Claude Code and *Waiting for Claude Code to call in…*.
2. Paste the start command into a terminal. When Claude Code connects, step 3 turns green with **Connected at …, in ~/build-room/…**, and **Done** is highlighted.
3. Leave it 45 seconds without pasting: the hint about the terminal's trust and allow questions appears.

### Known gaps

- If you close the window before Claude calls in, reopening it shows the "Connected now" view instead, which says the same thing in its own words.

---

## 23 Oct 2026 (later): AI question sets arrive with a topic, and an idea's doors all open

**Test:** merge of dev `0fa2edee2` (and the commit naming it).

### New

- **AI-generated sets arrive with a topic** (owner: "right now the user gets an error activating sets because they dont have a tag"). Every AI run picks one topic from the shelf's fifteen, plus up to five tags, in the call it already makes; code checks the pick against the list, and a keyword match on the title, description and questions stands in when the model leaves it out. The draft review shows it pre-filled as *(suggested)* and changeable, so **Switch it on now** works without choosing. Adding to a set that has no topic offers one for that set too.
- **Switching on a set with no topic asks for one in its row**, with a suggestion pre-selected, and **Save topic and switch on** does both, instead of the server's error.
- **An idea in Waiting for you has every door open** (another session, Build Room ideas flow A): *Put to a vote with other ideas* is always offered and adds ideas from the queue (two needed); with no Ideas ask open, *Ask the room for ideas about this* opens the composer with the idea in it; *Show on the wall now* fills the Stage; each idea's fate (acknowledged, shown, dismissed, later, restored) goes on the host's timeline.

### Fixed

- Accepting an AI draft with *Switch it on now* and no topic chosen no longer stops at "Choose a shelf".

### What to look at

1. **Generate a question set with AI** and open the draft: the Shelf is pre-filled *(suggested)* with tags; accept with **Switch it on now** and no change: the set is live and filed.
2. **Question sets:** switch on an older set with no topic: a picker opens in its row with a suggestion; **Save topic and switch on**.
3. **Build Room, Waiting for you:** on an idea, **Put to a vote with other ideas** with one other idea from the queue; on another, **Show on the wall now**: the Stage shows it full screen; the host's Timeline names each idea's fate.

### Known gaps

- A draft's suggested tags are stored unencrypted, as set tags already are for team sets.
- The keyword fallback picks General Knowledge when nothing matches; the review is where to change it.

## 23 Oct 2026: The opening follows the kind of build, starter sets per kind, and a reminder before Claude's unsaved question set goes

**Test:** merge of dev `a66a7b49`. Issue: [geseib/engagements#45](https://github.com/geseib/engagements/issues/45); plan `docs/superpowers/plans/2026-10-22-build-room-question-sets.md` (steps 5 and 6, another session); notes `docs/design/build-room-host-redesign/starter-sets-by-kind.md`.

### New

- **The opening follows what you are making** (another session, plugin **1.26.1**). Once the room answers *What are we making?*, a game, a training site, a document or a dashboard asks the next steps in its own words ("Who is playing, and where are they when they play?" instead of who it is for), and each done step offers follow-up questions that fit. Your own sets can add follow-ups: an Ideas question in a category named "Opening: <step>" is offered after that step, and Claude sees them too.
- **Starter sets for each kind of build** (another session): for a training site, a game, a document and a dashboard, two sets each in Engage's library: *Build Room: <Kind> questions* (14 Ideas questions across the five sections) and *Build Room: <Kind> pulse* (two 1 to 5 ratings and one choice), tagged `build-room` and `for-<kind>`, so a room making that kind sees them first.
- **The bell reminds you about Claude's unsaved question set** (#45). A set Claude writes in a Build Room lives only as long as the session, seven days from its start, unless you press **Save to my sets**. When the set arrives, the host's bell gets an entry for it, already read (you are looking at it in the room). Two days before the session ends it turns unread: *Claude's question set is not saved: …*, with **Reminder · 2 days left**. Pressing it opens the Build Room. Saving or removing the set clears the entry; it ends with the session.

### Fixed

- Claude's question set could vanish with its session without the host being told.

### What to look at

1. **Update the plugin** from Connect Claude Code (1.26.1). Start a Build Room and answer *What are we making?* with a game: the next steps ask in a game's words, and a done step offers follow-ups for a game.
2. In Ask the room's ready questions, *Build Room: Game questions* and *Build Room: Game pulse* come first (once the starter sets are installed on test; see Known gaps).
3. In the same Build Room, use **Ask Claude for questions** and let the set arrive. Open the bell (start screen or console): the entry is there, read, with "7 days left".
4. Press **Save to my sets**: the entry goes, and the draft's own entry appears. Ask for a second set and **Remove** it: its entry goes too.
5. The reminder itself shows two days before the session ends; to see it sooner, ask an engineer to set a test session's end date near (there is no switch in the app).

### Known gaps

- **The starter sets are installed by hand per tier** (`scripts/install-build-room-kind-sets.sh <table> --apply`): done on dev and test on 23 Oct; prod will need it when this ships there.
- The reminder shows when you next open a page with the bell (the start screen, the console, the two-screen console, the phone remote); there is no email, by design.
- A set that arrived before this change has no entry until `scripts/backfill-claude-set-reminders.js` is run on the tier (dry run by default; `--apply` writes; a team room's set needs the tier's tenant key). Only dev and test can have such sets.

## 22 Oct 2026 (later): Ask Claude for questions in a Build Room

**Test:** merge of dev `15fd6c0d`. Plan: `docs/superpowers/plans/2026-10-22-build-room-question-sets.md` (step 7). Everything in the entry below is already on test; this push adds only what is here.

### New

- **Ask Claude for questions** (plugin **1.26.0**). In a Build Room, Ask the room's ready questions has **Ask Claude for questions**: say what they should cover, or leave it blank, and **Ask Claude**. Claude writes a question set for this kind of build, section by section, keeps it in the project under `build-room/questions/`, commits it and sends it. It appears first in the ready questions, marked **From Claude**, and you can ask from it at once.
- **Save to my sets** turns Claude's set into drafts in your bell: a Call & Answer set for its Ideas questions and a Poll set for its Choose and Rate ones, tagged `build-room` and for its kind. Review and accept them like any AI draft; nothing reaches your library until you do.
- The help's Build Room guides have a section on it (*Running a Build Room › Ask Claude for questions*).

### Fixed

- Claude's set now takes its name from its **Title**, which a team's room keeps sealed like its other content; it used a field that is never sealed.

### What to look at

1. **Update the plugin** from Connect Claude Code (1.26.0) and restart Claude Code.
2. In a Build Room, after the opening's first step, open **Ask the room**; in the ready questions press **Ask Claude for questions**, type a topic, **Ask Claude**. The line says Claude is writing; the set appears first, marked **From Claude**. Ask one of its questions.
3. Press **Save to my sets**: the bell shows the drafts. Open one, accept it, and find the set in your question sets tagged `build-room`.
4. In the project folder, `build-room/questions/` holds the file and git shows Claude's commit.

### Known gaps

- Claude's set lives with the session until it is saved; a set not saved is gone when the session expires (its file stays in the project). The bell now reminds the host first (see 23 Oct, [#45](https://github.com/geseib/engagements/issues/45)).
- Everything in the entry below, including the help gaps, still applies.

## 22 Oct 2026: Help rewritten with a ? on every screen, Workie grounded in what the room said, prompt versions, AI drafts and the bell, and the review #38 fixes

**Test:** merge of dev `d1564358` (help refresh, ready questions by kind of build, and the Workie, prompts and drafts work from `1225bdf2`). Plans and reviews: [geseib/engagements#44](https://github.com/geseib/engagements/issues/44) (help), `docs/help-refresh/`, [geseib/engagements#38](https://github.com/geseib/engagements/issues/38), `docs/design/workie-grounding/STEP0.md`, `docs/design/prompt-versions/`, `docs/design/ai-generation-review/`.

### New

- **The help, rewritten and on every screen** (owner, 22 Oct: "a lot has changed"). Every guide was checked against the code and rewritten by task: about 50 wrong claims corrected, then new guides for voting, comments, when something goes wrong, the Session panel, each type on the stage, What we heard and Ask the room, two screens (16 sections), surveys (host and phone), events (building, the day, attendees), Build Room in seven guides (including Connecting Claude Code and one for participants), members, plan and usage, data and privacy, the public library, Drafts and the bell, Workie, Engage staff, and troubleshooting by symptom. One vocabulary from the glossary ("the room's window", "the stage", "What we heard"); "the wall", "projector", "big screen" and the rest are gone from the help.
- **A ? on every private screen** opens the section for that screen: the start screen, Create engagement and Advanced, Quick start, your question sets, sessions and reports, the dock (What we heard while the read is up), each Session panel tab, the console and the phone remote, the event builder and stage, every admin and staff section, the AI builders, draft review and the bell, every Build Room host screen, and the player's **?** by what the phone is showing (lobby, voting, results, end, survey, event, Build Room). Never on the stage itself, the room's window or the Build wall. The help window is a real dialog (Escape, focus, back where you were), and `/help` links go straight to a section.
- **Ready questions by kind of build** (another session, plugin **1.25.1**): tag a build-room set `for-game`, `for-app`… and once the room says what it is making, those sets come first and Claude asks from them first.
- **Workie checks its read before the room sees it** (owner: "we dont want that just injected as part of a fluffy GenAI language"). After Workie writes, code compares the read with what the room was given and said. It looks for numbers that are not in the material ("15-minute"), claims the vote does not support ("strongest", "unanimous", "the room agreed"), next steps written as already decided, and generic filler. Anything in the persona's own voice is exempt, so a character keeps its catchphrases. If something trips, Workie rewrites once with the exact words named; the extra call happens only then. Whatever survives shows the host a note, never the room: *Workie used words the room's answers don't support: …* (two-screen console, the Session panel's Workie section on one screen, the phone remote). Every prompt now also says that a ranking shows which answers people preferred, not that the room agreed to a plan.
- **Next steps are suggestions.** Step 0 of the grounding work found the cause of the review's invented "15-minute hold": the prompts' own rule demanded an owner and a concrete action for every step, which four answers could not supply. In the repo, the demo sets' prompts and the built-in defaults now ask for steps starting **Suggested**, never written as decided, with no number, duration or limit an answer did not give; "the strongest piece of resistance" becomes "the resistance named by the most answers". Live prompts change only when an admin applies the repo's version (next item).
- **Prompt versions, as question sets have them.** Admin › Prompts shows a Version column. The library says which prompts have a newer version in the repo (the prompt files ship with each deploy); **Review** shows each changed part word by word and **Save as version N** makes it live while the old one stays. The editor's **Versions** tab lists every version with when, who and how; **Compare with live** and **Make live** (press twice) put any earlier one back. Every save that changes a prompt's content is now a new version (before, edits overwrote the text in place), and Populate defaults no longer overwrites an edited default.
- **AI drafts and the bell** (another session). Every AI builder run now writes a draft in the library it will be saved into; nothing touches a set until its owner accepts it. The draft review keeps, leaves or edits each question, regenerates a category or the rest, and accepts as a new set (switched on, with a shelf) or as one new version of an existing set, with Undo and a 7-day restore after discard. **The bell** collects drafts, invitations and flagged sets in one inbox on the admin console, the host's start screen, the two-screen console and the phone remote; never on a screen the room sees.
- **Connect window by case** (another session, plugin **1.25.0**): one paste for the first time, coming back, an out-of-date plugin, or another laptop; Claude Code resumes a room that already has work.
- **Share demo says who is here and who is elsewhere** while remote share is on (plugin 1.24.2): counts per person, "on this network" or "elsewhere".

### Fixed

- **The host page went blank on an early Show results** (review #38, P2): pressing early asked for a second press; when the last ballots landed the button stopped needing it and the bar read a warning that was gone. It now lets go.
- **One screen flipped back to Two** (review #38, P2): the host page re-read a choice that every tab in the browser shares. It now keeps the choice made on it.
- **"The wall shows this page" beside an empty read** while Workie is writing (review #38): said only once there is a read.
- AI drafts: the bell's link landed on the bare list; accepting saved a new set switched off unasked.
- Screen words the new help would have contradicted: the Sessions subtitle now says "90 days from creation, or 7 days from the start once started" (it said "7 days after last play"); Plan & usage says a limit stops you **creating** a session (it said starting). Quick start and the bell no longer close under the help window they open.

### What to look at

1. **Help on a screen:** on the start screen press **?**: it opens *Your first session* at the start screen. Open Create engagement and Advanced; each **?** opens its own section. Start a Call & Answer on one screen: the dock's **?** opens *The dock and the keys*, and while Workie's read is up, *What we heard*. Open the Session panel, switch tabs; its **?** follows the tab.
2. **Help on a phone:** join that session on a phone; the **?** menu's help opens the lobby section, then voting, then results as the round moves. The room's window and the stage show no **?**.
3. **The help itself:** open `/help`; read *Two screens and your phone* and *Drafts and the bell*. Anything that names a button you cannot find, or says something the screen does not do, is a finding.
4. **Update the plugin** from Connect Claude Code (1.25.1) and restart Claude Code.
5. **Prompts:** Admin › Prompts shows "*N* prompts have a newer version in the repo". Open **Review** on *Workie - The Transfer Reader*: rule 11 and the sections now ask for **Suggested** steps; **Save as version 2**. Its **Versions** tab lists v1 and v2; **Compare with live**, then **Make live** on v1 and back to v2.
6. **Workie's read:** run a round of *Lessons from Different Schools* (or Redo one). Next steps start **Suggested** and carry no number the answers did not give. If a read still uses an unsupported word, the console's read and the phone remote show the note; the room's window and the stage never do.
7. **Review #38's repro:** with 2 of 4 voted press **Show results**, then let the last ballots land: the host stays up. Choose **One screen**, keep a second host tab open, run a round: it stays on One screen.
8. **AI drafts:** generate questions into a set, leave, come back through **the bell**, review, accept into the set as a new version, then **Undo**.

### Known gaps

- **Help:** the Engage staff guides were written from the code; the QA account is not staff on dev, so they were not checked on screen. Privacy and Terms are unchanged: they say things that are not true (no data shared, 90-day retention, export and delete), and the proposed corrections wait for the owner in `docs/help-refresh/privacy-terms-proposals.md`. Product gaps the help work found are on [#43](https://github.com/geseib/engagements/issues/43) (Suspend sets a status nothing checks; Export and Delete are not wired; Ask the room is off on prod, and the help says so).
- The public code-entry page (`/join`) has no **?** yet; the player's help starts once the code is in (the name page and everything after).
- Reports do not yet record which prompt version wrote a read.
- The check compares numbers by value: a "2" anywhere in the material lets "two weeks" pass. Commitments are checked only under a Next steps heading.
- The prompt fixes reach a tier only when an admin applies the repo's version there.
- Earlier gaps still open: *Talk about it* is a fixed line; Call keeps one column; the room's window cannot page a long Build Room ask.

## 19 Oct 2026: Build Room on two screens, Consider with Sent to Claude marks, and fixes on both room types

**Test:** merge of dev `156265f6` (notes in the same commit). Plans: `docs/design/parity/PLAN.md` §2 (B8, B9, §2.9b); mockups `docs/design/build-room-console/` and `docs/design/build-room-consider/`; QA walk `docs/qa/2026-10-18-build-room-walk/`.

### New

- **Build Room on two screens, easy to find** (owner, 19 Oct: "a very difficult experience finding the 2 screen capability or emulating it"):
  - **Room's window ↗ and its status on the header** (Not open / Open, not full screen / On, full screen), shared with Call & Answer's console; PRESENT on the Stage's dock.
  - **Where will the room watch?** is asked on the Host screen until you choose, with Help me pick, as Call & Answer asks. Two screens opens the room's window in the same click; Session › Settings › Screens shows and changes it.
  - **One laptop, no second display:** **Open as a tab** opens the window in a tab that shows *Click anywhere to fill the screen*, with one line saying so: share that tab on a call, or press F. The same for Call & Answer.
- **The Build Room console** (the laptop on two screens, as approved): "← All sessions", Join, Share demo, Room's window and **The room sees: Stage · Build · History** on the top line (2, 3, 4 and P change only the room's window; See it here shows it on the laptop); the strip of steps, dimmed with a plain label between asks; **Your part now** at the top of the centre with the main button (empty between asks: "No main move now"; on a result, Spin the wheel beside Send); four sections on the left (Waiting for you, People, Later with Points, Session); Now and the folds on the right (Decided, Timeline, Asks, Screenshots, Room brief, History). People ticks who has answered, by name, never what they chose. One screen is unchanged.
- **Consider, any time** (owner: "have the ability to consider an item where you get a choice to queue up to the room, or send to claude at any time"): on every idea as it arrives, on the reasons people give with a pick or rating, on every option once a vote closes, and in Waiting for you. **Queue for the room** (a yes/no or feedback round that waits until you open it, or Queued for the room until a vote) or **Send to Claude** with the words you choose and a **Why** that Claude reads and History keeps. The normal ask flow is unchanged.
- **Sent to Claude marks** (owner: "mark any ideas, votes, in history as having been sent to claude… this mark could actually link to the history log"): *Sent to Claude*, *…reworded*, *…for later* and *Queued for the room* on ideas, Waiting for you, vote options, Asks and Decided. Click one: History opens at that entry, highlighted, with the room's words struck through, what Claude got, the why, and how many liked it. Phones show the same entry ("yours" on your own idea), never a name.
- **Why on Send B:** Direction for Claude (Host screen) and Change before sending (Stage) have the same Why line; changing the room's words suggests one.
- **Join puts the codes beside the Stage** in Build Room, on the laptop and the room's window, as on Call & Answer (another session's work).

### Fixed

- **The opening ended after its first question** (QA B1): a new room never recorded that it was in its opening. It now runs through every step, and rooms already caught go back to their opening.
- **The Host page scrolled into a blank band** (QA B2).
- **Open voting with no ideas** now says why it waits instead of opening an empty vote; **Show results with nobody in** asks you to press again (QA C2, C3).
- **Call & Answer, two screens:** the console says *All answers · On the wall now* when every answer is on the window (it marked Response 1); the window's end shows rounds played, the room count and the podium, as the stage does; a comment put up during results or the read now shows on the window; ↑ ↓ on the window step through a long answer's parts and never jump to the next answer.
- The join panel's address wraps before its path, never inside the domain.

### What to look at

1. **A new Build Room** on engage.test: the Host screen asks **Where will the room watch?** Choose **Two screens**: the room's window opens; drag it to the projector and click it once to fill the screen.
2. **The console:** the laptop shows the top line with *The room sees*, the strip and *Your part now*. Press **3**: the room's window shows Build and the laptop stays put. **See it here** shows it on the laptop; **1** comes back.
3. **One laptop:** with no second display, **Open as a tab**; the tab says *Click anywhere to fill the screen*.
4. **The opening:** answer the first question; the opening goes on to the second.
5. **Consider:** open an Ideas ask; on an arriving idea press **Consider › Send to Claude**, change the words, write a **Why**, send. The idea now says *Sent to Claude, reworded*; click it: History opens at the entry with the old words struck through, the new words and the why. A phone's History shows the same, marked *yours*.
6. **Queue for the room** on another idea: it waits in Waiting for you as *Queued for the room*.
7. **Send B with a why:** at a result, open Change before sending, change the words, write a why, send; History shows it.
8. **Call & Answer, two screens:** voting with all answers on the window, the console says *All answers · On the wall now*; at the end the window shows rounds played and the podium.

### Known gaps

- The room's screens show no Sent to Claude marks (the host's screens do); History on phones and the window shows the entries.
- The server still accepts opening a vote with no ideas; only the button waits.
- The Host screen's own ask path (outside the console) still does not arm in place for early moves.
- The console was checked in Chromium against a local harness at 1366×768 and 1920×1080; not yet walked on a deployed tier.
- Earlier gaps still open: *Talk about it* is a fixed line; Call keeps one column; the room's window cannot page a long Build Room ask.

## 18 Oct 2026: room screens redrawn, Claude's posts wait for the host, and remote share

**Test:** merge of dev `8b39973e` (and the notes, help and README commit after it). This is the first push to test since 17 Oct's third; it carries everything dev gained since, from several sessions. Plans: `docs/design/parity/PLAN.md` §2c and §2d; room screens mockup `docs/design/room-content-v2/`; remote share `docs/superpowers/specs/2026-10-16-build-room-remote-share-design.md`.

### New

- **Room screens show what the room reads and takes away** (owner, 18 Oct: "you provided the biggest text with the generic room instructions, not the changing lesson… the instructions is the optional one. the title often is nice to have big too"; and "nice to see a bar chart results but not at the expense of seeing what was voted on"). One rule (`config/roomContent.js`) for the one-screen stage and the room's window, on every size:
  - **A question or lesson is up:** the **title** is the biggest text and the **lesson** sits under it, never dropped. The question to answer is one **Your turn** band: the question's own instruction, or the question pulled from the front of the lesson when it opens with one ("Describe how you…"). A general instruction ("answer on your phone") is left off Room, TV and Table; Call keeps it small. ALL-CAPS titles show in title case.
  - **Voting:** every answer whole and numbered when they fit on one screen; otherwise answer 1, as before. The title stays as the reminder. No tally while voting.
  - **Results:** the room's pick in full, the runners-up with their text, the bar the fill behind each answer measured against the pick. **No counts or percentages while names are hidden**; a named round keeps the credit and points. A *Talk about it* line at the foot never asks who wrote anything.
  - **Put one up:** click an answer or a result, or step with → and ←; chips (voting) or a ladder of bars (results) show where it sits; Esc goes back to all of them.
  - **Show QR is a panel beside what is up**, not a cover, on one screen and on the room's window, from J, the rail, the Presentation's strip or the phone remote. It is now its own fact on the server (`stageFocus.join`), so the answer on the wall stays up with it.
  - **Build Room:** each option shows its detail on every size; **no tally while the ask is open**; on the result the votes rise inside the options, the pick is marked *The room's pick* with the room's best reason, and the Stage shows *Sent to Claude* with the direction until Claude says what it is doing.
- **Remote share** (owner, 16 Oct design; walked by the owner on dev 18 Oct). Share demo has a switch, **Also open it to people who are not here** (off by default). People on Zoom or another network get the same **Open the demo** button, each with their own key. The panel lists who opened it and on how many devices, with **Remove**; starting and failed states say why. The plugin downloads a pinned, hash-checked Cloudflare tool on first use, runs one tunnel per session, goes live only once reachable, and never leaves it running. The tunnel forwards to the demo and keeps the Wi-Fi share's folder rules. Phones see *Not here? Opening soon.* while it starts.
- **Claude's posts wait in the host's queue** (owner: "have things get to the host queue to release to the room"). Claude's updates, showings, answers and screenshots arrive in **Waiting for you** with **Release to the room**, **Keep to myself** and **Release all**; nothing reaches phones or room screens until released, and a released post takes its place at the time it happened. Claude's live status is never held. Switch: Session › Settings › Claude › *Check Claude's posts before the room sees them* (on by default).
- **The Stage while Claude works** (I9, I10): *Sent to Claude* until Claude picks it up, then a row (Building / Testing / Fixing / Checking / Saved), the last test counts, and the last four things Claude's tools did (file and program names only). These tool lines now reach the room's window.
- **Which plugin is running, everywhere:** Claude Code says it on connect; Settings › Claude always shows it and whether it is the latest.
- **Plugin 1.24.1** carries all of the Build Room changes above (1.21 release gate, 1.22 remote share, 1.23 version everywhere, 1.24 the work row, 1.24.1 tunnel errors).
- **Room's window lobby:** the session title large with the event details under it; the QR on the right with the address and code. Quick start writes the set's description into Event Details.
- **Quick start shows Where the room watches** (one screen or two) and, on two, opens the room's window on the other display in the same press; a placed window says *Click anywhere to fill the screen*.
- **Two-screen console:** the next step is a *Your part now* card at the top of the centre; leaving is *← All sessions* on the top line.

### Fixed

- The visitor pages name the real button (*press Open the demo*) and no longer say the demo is only for people in the room.
- The console's first row read *The question · On the wall now* while the wall showed the results; it now says *The results*. The strip draws its dot (*What we heard · results*).
- A Workie read landing after *Workie is writing* no longer replays *Results · Look up* over its first page; the read on the wall is larger.
- The laptop's codes card now follows the server when an ask opens; the stage refits once web fonts load.

### What to look at

1. **Update the plugin** from Connect Claude Code and restart Claude Code; Session › Settings › Claude says **1.24.1, the latest**.
2. **A lesson round** (a Call & Answer lesson set, Room size): the title is the big text, the lesson under it, the question in *Your turn*; no "answer on your phone" line. Switch to **Call**: the general instruction appears, small.
3. **Voting** with up to six short answers: all of them numbered on screen. Click one: it fills the screen with chips; → steps, Esc goes back.
4. **Results:** *The room's pick* in full, bars behind the answers, no numbers while names are hidden. Open one: its place and the ladder.
5. **Show QR** (J) during answering, then during voting with an answer up: the QR panel comes in beside the content and the answer stays up. Do the same from the phone remote and on the room's window (two screens).
6. **Build Room, a Choose ask:** each option's detail on Room, no counts while open. Show results: bars inside the options, *The room's pick* with a quoted reason; send it: *Sent to Claude* until Claude picks it up.
7. **The queue:** ask Claude to post progress and a screenshot; both wait in *Waiting for you*; release one, keep the other.
8. **Remote share:** turn on *Also open it to people who are not here*; a phone on mobile data opens the demo from *Open the demo*; the panel lists it; **Remove** ends it; turning it off closes the address.

### Known gaps

- *Talk about it* is always the fixed line; Workie's discussion topic is not wired in yet.
- Call keeps one column (the mockup's two-column Call layout is not built); no highlighted phrases in lessons.
- TV and Table were checked by tests, not in a browser; the room's window was rendered in Chromium on Room and Call at 1280×720 and 1920×1080, the one-screen stage on Room at 1920×1080.
- The room's window cannot page a long Build Room ask; it shows the first page and how many more.
- Remote share: some company networks block Cloudflare's address; no uptime promise; the macOS unpack and a system proxy are untested in CI; on Windows a tunnel left by a crash is not cleaned up at the next start; History links stay Wi-Fi links.
- The two-screen laptop console for Build Room still waits for the owner's review of its mockup.

## 17 Oct 2026 (third push): Build Room's History marks, a share that opens only the demo, the room's window, and a dock that holds still

**Test:** merge of dev `ad049d6e` (and the notes, help and README commit after it). **Review tag:** `reviewable/2026-10-17-…` (named in the push). Plan: `docs/design/parity/PLAN.md` (§2.8, §2a, §2b, §2.9, §2.9a).

### New

- **History says what the room gave and what reached Claude.** Every idea from the room that was used, and every ask the room saw, decided or not, on the host's History and on every phone's History tab. Each carries one mark: *chosen by the room* or *not chosen*, *sent to Claude as written*, *reworded by the host*, *for Claude, later*, *sent later, in other words* (a decision kept back and then combined), *with the room*, or *closed, nothing sent to Claude*. No names anywhere; a phone marks its own ideas as *yours*. The server now records, at the moment of sending, which idea or ask each thing came from and whether the host changed the words. *Made so far* counts used ideas by the same rule.
- **The room's window for Build Room.** Session › Settings › **Screens** › **Room's window** opens Stage, Build or History in its own window (on the second display in Chrome). It needs no sign-in, carries no host data and never shows a name; it follows the screen the host picks (2, 3, 4, P, the header tabs) and the codes card, and reports whether it is open and full screen. **New link** (press twice) cuts off every open window. The full two-screen laptop console waits for the owner's review of its mockup (`docs/design/build-room-console/index.html`).
- **Plugin 1.20.0: each shared server says what it is.** The share panel names servers *Demo*, *Mockups* (or *Mockups · Ask 3*) instead of App 1 and App 2. A project file `.engage/share.json` (`demo`, `mockups`, `label`) names them and wins over any guess; Claude can mark a link it posts as the demo or a mockup. Each session takes its Wi-Fi ports from a block set by its code (`ENGAGE_LAN_PORT` still overrides), every gateway response carries `X-Engage-Session`, the gateway's own pages name the session, and the plugin writes `.engage/share-status.json` listing what is shared.
- **Two design documents for the owner:** the Build Room console mockup (`docs/design/build-room-console/`) and remote share, security first (`docs/design/build-room-remote-share/DESIGN.md`). Nothing from either is built.

### Fixed

- **Share demo opened a folder of mockups, not the playable demo** (dev game 1215). The host's Open the build, QR and codes card went to each server's root; they now open the page Claude showed, as the phones always did.
- **The share let the room browse a whole folder.** Plugin 1.19.0 opens a page only inside the folders of the pages Claude linked (a page may still load its own files and API), never shows a folder listing (compressed ones too), and Claude is told to serve only the demo's and the mockups' own folders.
- **The Stage's bottom row moved under the pointer.** The *Press Space to …* hint appeared on hover and pushed Host and Session sideways; buttons came and went between moments. The Stage now uses the same dock and action bar as Call & Answer: fixed slots, Host and Session last, nothing changes on hover, and an early move (Show results while people are still answering, Next before Claude has finished) asks for a second press in place instead of a dialog.
- **The way back from the Stage was hidden.** With a count, Host opened a list instead of going home; it now goes to the Host screen in one press and keeps its count as a badge. The header's list on Build and History stays.

### What to look at

1. **Update the dev/test plugin** from the Build Room's **Connect** panel and restart Claude Code; Session › Claude should say **1.20.0** with no out-of-date notice.
2. **Share demo.** Have Claude show a demo served from a folder that also holds mockups. **Open the build** and the QR open the demo page itself. Remove the page name from the Wi-Fi address: it says *Not part of the shared build*, never a file list. The share panel names the servers *Demo* and *Mockups*. Write `.engage/share.json` with a `demo` link: Open the build follows it within a few seconds.
3. **History.** Send one idea to Claude, put two ideas to a vote, change the words of the winner before sending, and leave one ask open. On History (host) and a phone's History tab: the sent idea reads *sent to Claude as written*, the vote's two ideas *chosen by the room* and *not chosen*, the decision ends *reworded by the host*, the open ask reads *with the room*, and no name appears. The phone that sent an idea sees *yours* beside it.
4. **The room's window.** Session › Settings › Screens › **Room's window**: on a second display in Chrome it lands there; click once for full screen; the status says *on, full screen*. Press 2, 3, 4: the window follows. Reload it: same screen. Open it on another computer with the same link: both follow. **New link** twice: the old windows say their link has changed.
5. **The Stage dock.** Move between moments and hover the dock: nothing moves. At 3 of 4 answered, **Show results** asks for a second press. With something waiting, **← Host** goes home in one press.

### Known gaps

- The two-screen laptop console (B8) is not built: it waits for the owner's review of the mockup and its five questions. Until then the laptop on two screens is the same Host page.
- On the Stage and the room's window, a long ask with six long options is still cut at 1280×720 (marked, not paged).
- The window follows the codes card the server clears when an ask opens; the laptop's own codes card does not yet.
- The dock's stillness is held by tests, not yet measured in a browser on the signed-in page.
- Phones still receive two things the room's window now hides: a *Claude proposed a question* timeline entry for an ask the room has not seen, and mockups for asks still being drafted.
- Remote share (people off this Wi-Fi) is designed, not built.

## 17 Oct 2026 (second push): review #35, the verdict counts and four end-of-session fixes

**Test:** merge of dev `00cc0aee` (and the notes and help commit after it). **Review tag:** `reviewable/2026-10-17-…` (named in the push).

### New

- **The Verdict Board prompt is installed on test and dev** (v3, same prompt id, so Ready or Not picks it up with no other change). It sorts each answer by the verdict it opens with: a conditional yes ("yes, bounded", "pilot only", "only after", "fine if") is *Clears only if*; "no", "not yet", "unknown", "unproven" or "I cannot judge this from what was shown" is *Not shown to clear*; a plain yes is *Clears*; *No verdict* only when no verdict is given anywhere. No-verdict answers are never named or quoted, and a quote is only ever credited to the person whose answer contains it.

### Fixed

- **An empty round was reported as "expired"** (review #35). A round nobody answered, reported minutes later, carried an *Incomplete record* note saying its responses had expired under the seven-day retention. A round younger than seven days with no answers now reads as complete; the note still appears for a round old enough to have lost its answers.
- **"The responses could not be loaded" on a round nobody answered** (review #35). After the end, opening that round from **Something to add?** now says nobody responded. A round that has answers but whose results were never shown is still not opened: its authors were never revealed to the room.
- **A player who reloaded or rejoined after the end saw "Final score 0"** (review #35) while the host and the report said 6. The closing screen now reads the final score and standing from the server.
- **An earlier round opened after the end was headed only "Round 1"** (review #35). The heading is now the round's question; the top line still says *Round 1 · Feedback*.

Not changed: **Keep for 90 days** is right. The 30-day expiry the review found is the session's working copy of the report; the saved report's own record expires 90 days after the save (checked on test: 15 Jan 2027 for session 5963).

### What to look at

1. **Verdict counts.** Run *(Demo) Ready or Not* with the Demo, Deploy and Data answers quoted in issue #35. Expect Demo **Clears: 0. Clears only if: 4. Not shown to clear: 0. No verdict: 0.** and Data **0 / 0 / 4 / 0**; Deploy puts Lena's "fine if" under *Clears only if*. Press **Redo** two or three times on each: the wording may change, the counts should not. No *No verdict* bullet names anyone, and every named quote is from that person's own answer.
2. **An empty round.** Start one more round, let nobody answer, never show results, end the session and generate the report straight away: there is no *Incomplete record* note, and the round says *No answers recorded for this question.*
3. **The same round on a phone.** After the end, open it under **Something to add?**: the panel is headed by the round's question and says nobody responded; there is no *Try again*.
4. **Final score after a reload.** After the end, reload a player's page and rejoin as the same name: *Final score* and *Final standing* match the host's standings.
5. **Earlier rounds.** Open Round 1 from **Something to add?**: the heading is that round's question, the top line *Round 1 · Feedback*.

### Known gaps

- Workie runs at a fixed temperature for every prompt, so a Redo can still reword the read; only which side each answer falls on is pinned down.
- After the end, a trivia, wavelength or poll round's responses still do not load in the comment panel (Call & Answer only); its heading now shows the question.
- The fixes were checked by the test suites and not yet walked on dev in a browser.

## 17 Oct 2026: the room's window opens on the second display, and the fixes from review #34

**Test:** merge of dev `b5be600d` (and the notes, help and README commit after it). **Review tag:** `reviewable/2026-10-17-…` (named in the push).

### New

- **The room's window opens on the second display for you.** In Chrome or Edge, with the projector or TV connected as a second display (extended, not mirrored), **Room's window ↗** opens the window on that display and fills it. The first time, the browser asks to *manage windows on all your displays*: allow it. Then one click on the room's window makes it full screen. The same happens from Settings › Screens, the Setup chooser and the dock's PRESENT. Other browsers, one display, a refused permission or a blocked popup: it opens beside you as before; drag it over and press F.
- **Comments after the end can be reached** (review #34). When the session ends, each phone's closing screen says **Something to add?** and lists the rounds, for as long as comments are open (24 hours, or until the host presses Close comments). The comment panel opened from there stays open, shows that round's results and Workie's read, and marks the comment as added later.

### Fixed

- **Workie's verdict counts on Ready or Not blurred conditions and "unknown"** (review #34). The Verdict Board now counts four ways: *Clears*, *Clears only if*, *Not shown to clear*, *No verdict*. "Not yet", "Unknown" and "Unproven" count as not shown, never as a failure, and an answer that opens "Not yet" is never a clear. Conditions are quoted and never treated as met; a side counted at zero is never described; next steps are suggestions. **This is a stored prompt: it takes effect only once it is installed on test** (see Known gaps).
- **"Pick the ideas to show" after a Choose or Rate question** (review #34). After a question for the room, "Your part now" says *Pick the ideas to show* for Ideas only; Choose and Rate say *The room's answer is up*.
- **The host's response list could lag behind its count** (review #34: "3 of 4" answered while the list said *No responses yet*, until a reload). The host's list now reads the answer that was just announced, and while the count is ahead of the list during answering, the console fetches the list again (at 1.5, 3 and 6 seconds, up to five times a round).

### What to look at

1. **Second display.** In Chrome on a laptop with a projector, TV or iPad connected as an *extended* display, start a two-screen Call & Answer session and press **Room's window ↗**. Allow the browser's prompt. The window should open on the other display, filling it; click it once and it goes full screen; the console's status reads *on, full screen*. Try the same from Settings › Screens.
2. **Without a second display**, or in Safari or Firefox, the same button should open the window beside you, exactly as before.
3. **Comments after the end.** Join on a phone, play two rounds, then end the session from the host. The phone shows **Something to add?** with Round 1 and Round 2. Open Round 1: its responses and Workie's read load, the header says *Round 1 · Feedback*, and a comment posts and is marked *added later*. On the host, **Close comments** (Rounds tab), then reload the phone: the section is gone.
4. **"Your part now"** after a Choose and after a Rate question for the room: neither says *Pick the ideas*. After an Ideas question it still does.
5. **Response list.** Answer quickly from three or four phones at once during a round: the console's list should match the count within a few seconds without a reload.
6. **Verdict counts** (only once the prompt is installed): play rounds 2, 5 and 6 of Ready or Not with the answers quoted in issue #34 and check the count line and the bullets agree.

### Known gaps

- **The Verdict Board prompt is not installed on test by this push.** Prompts are stored records: someone with admin rights re-posts `demo-sets/ready-or-not.prompt.json` (see `demo-sets/README.md`) or runs `scripts/install-ai-prompt.js`. Until then Workie on test counts three ways as before.
- The response-list lag was not reproduced on dev from a fresh page; the fix covers every path that leaves the list behind, but has not been seen failing and then recovering.
- Second-display placement was checked in Chromium with two emulated displays, not yet on a real second monitor.
- After the end, a trivia, wavelength or poll round's responses do not load in the comment panel yet (Call & Answer only); the comment box still works.

---

## 16 Oct 2026: late answers and comments, results ideas first, Settings regrouped, Rate ends

**Test:** merge of dev `7e73d851` (and the notes and README commit after it). **Review tag:** `reviewable/2026-10-16-…` (named in the push).

### New

- **Nothing that arrives late is lost** (session flow v3, phase 5).
  - An answer to a question for the room sent after its results are up is kept; the phone says "The results are already up. Your answer is kept, but not in the count."
  - Once a round's results have been shown, people can keep commenting on it, marked "added later", until 24 hours after the session ends. After the end the host can press **Close comments** to stop them sooner.
  - **Late & not reviewed**: a list in the Rounds tab and in the two-screen console's left rail. Each item says who and when ("during Round 3 · Voting") and carries a label: *Not reviewed*, *Reviewed by the host* (**Mark reviewed**) or *Reviewed with the room* (**Show on the wall**). The status line counts what is waiting, e.g. "4 late answers kept".
  - The report shows each round's **Arrived late** items with their labels. **Settings › Report › Include items not reviewed** (on by default) leaves the unreviewed ones out when turned off, and says how many. Redoing Workie's read includes late answers and says so.
- **Results, ideas first**, on the room's window and on one screen: each idea in full as the headline, a bar for how much the room backed it (compared with the top idea), and a small credit line with the points and the name, the name only while names show. The heading reads "What the room backed". The people podium is off the results; the scoreboard is on demand (**S**, or **Show scoreboard** in the console's People section).
- **Put the question back up.** During voting and results, the question line above the cards (one screen) or the console's first row, "The question", puts the question on the wall.
- **The console marks the read.** The part of Workie's read the wall is showing is marked "On the wall".
- **Press twice, in place.** The "Proceed to voting?" dialog and its two relatives are gone. Advancing early changes the button to "Start voting anyway" / "Show results anyway" and says who is still at it: "1 of 3 still writing", or "Nobody has voted yet". Press again within a few seconds to go ahead. A question for the room's **Show results** now asks the same way on the laptop.
- **Settings, regrouped** into four groups, most used first: **Screens** (one or two screens, the room's window, room screen size, which was "Display profile"), **Your phone as a remote**, **The rounds** and **Joining**; session details and keys fold away. The Screens group also sits at the top of **Setup** on the step strip, so a host can switch between one and two screens mid-session.
- **Who may sign in on the phone.** The remote box says who may drive the session (any host or admin of the team; on a personal space, only you) and who is signed in on this laptop. It shows the email only while the room's window is up on two screens; otherwise the name, because the room may be watching the laptop.
- **Rate names its ends.** In Ask the room, a Rate question has "1 means" and "5 means" menus (Disagree/Agree, No/Yes, Low/High, Unlikely/Likely, Hard/Easy), or Custom for your own words (up to 24 characters each). Phones, the wall, the console and the report show them.

### Fixed

- **Privacy:** an idea's id, and a late item's reference, were a plain hash ending in the player's name, so someone holding the roster could match an idea to its author. They are now keyed by a secret made per session that never leaves the server.
- **The wall's results cut off long ideas** (five ideas of ~120 characters at 1280×720 lost the top and bottom rows). The wall now shrinks the type, then holds ideas to two lines, then shows the top ones with "and N more ideas". The top idea and the heading are never cut.
- **One-screen results ran off the stage** at laptop sizes. Results now show fewer ideas per page than voting does (Room 2, Call 2, TV 1, Table 3), measured to fit at 1280×720, 1366×768 and 1440×900; ↑ ↓ pages through the rest. A crowded dock drops the SPACE hint before it wraps a button to a third row.
- **A question put on the wall stayed up after the round moved on** (ASK to VOTE, and VOTE to RESULTS). It now comes down. With the question up during voting, **Next response** now goes to Response 1 instead of skipping it.
- **The session panel's Settings were hard to read in the light theme** (dark labels on the navy panel), and below about 660px wide the **Settings** tab sat off the edge of the screen. Both fixed.
- **A question for the room closed on one press** on the laptop even with nobody answered. It now asks twice.
- Late round answers two or more rounds past the last round row were missed by the late list and the report.

### What to look at

1. **Results on one screen.** On engage.test, run a Call & Answer round with six people and long answers (two or three lines each). On Results, try Settings › Screens › Room screen size at Room, TV and Table on a 1366×768 or 1280×720 laptop: nothing runs under the dock, and ↑ ↓ pages through the rest.
2. **Results on two screens.** Switch to **Two screens** from Setup, press **Room's window ↗**, and look at the same results there at Room, TV and Table: every visible idea is whole, the top one is outlined, and on TV the foot says "and 3 more ideas".
3. **Press twice.** In voting with nobody voted yet, press **Show results** once: it reads "Show results anyway" with "Nobody has voted yet. Press again to show results." Wait six seconds and it settles back; press twice to go ahead. Do the same on a question for the room.
4. **Settings.** Open the session panel (**\\**) › Settings: four groups in order, everything readable in both light and dark mode. Make the window about 660px and 375px wide: all four tabs can be reached.
5. **Who may sign in.** On two screens with the room's window closed, the remote box shows your name; open the room's window and it shows your email; switch to one screen and it shows the name again.
6. **Rate ends.** After a round's read, Ask the room › Rate: pick "Low" in "1 means" and "5 means" follows to "High"; try Custom with your own words. Send it: the phone, the wall and the console show the ends; after the session the report does too.
7. **Late items.** Show a question for the room's results, then answer it from a phone: the phone says it is kept; the host's status line counts it; it is in **Late & not reviewed** (Rounds tab, and the console's rail on two screens) as *Not reviewed*. Press **Mark reviewed**. Comment on a finished round from a phone after the room has moved on. End the session, press **Close comments**, then open the report and look for **Arrived late**; turn off **Include items not reviewed** and make the report again.
8. **The question on the wall.** During voting, press the question line (one screen) or "The question" in the console: the wall shows the question. Press **Next response**: it goes to Response 1. Start voting from a round where the question was up at answering: it comes down.

### Known gaps

- Results show fewer ideas per page than before, so a big round on TV is one idea per page.
- After a question for the room's results, "Your part now" says "Pick the ideas to show" even for a Choose or Rate question.
- The two-screen console is for a laptop; at phone widths use the Remote.
- A late round answer has no wall view yet, so it can only be marked reviewed. **Show on the wall** is offered only for the round the wall is on.
- **Close comments** is only offered once the session has ended.
- Ideas picked in a session that was live when this deployed stop matching their ideas (the ids changed).
- Settings held for the next round are lost on a reload; the phone cannot tell which response number is its own after a reload.

---

## 16 Oct 2026: Share demo holds steady when two plugins are running

**Test:** merge of dev `d0b8443b` (and the notes and help commit after it). **Review tag:** `reviewable/2026-10-16-…` (named in the push).

### New

- **Engage plugin 1.18.0.** Each plugin copy now names itself when it reports the
  Wi-Fi share. The host's Session panel says the plugin is out of date until it is
  updated from **Connect**.

### Fixed

- **Share demo's count flipped between 0 and 1, and a participant's Open the build
  link swapped addresses every few seconds.** Two plugin copies were sharing one room:
  an old prod plugin (1.14.0) beside the test plugin, each with its own address, key and
  count. The room now stays with the copy that holds it; any other copy is told to stop
  and closes its address. If the copy holding the room goes quiet for 30 seconds, the
  next one takes over.

### What to look at

1. **Update the test plugin** from the Build Room's **Connect** panel and restart Claude Code. Session › Claude should show 1.18.0 and no out-of-date notice.
2. **Steady count.** Connect a folder, let Claude show the running app, press **Share demo**, and open the build from a phone, laptop or tablet on the same Wi-Fi. Watch the host's chip and the participant's screen for a minute: the count stays at 1 and the link does not change.
3. **A second window.** Open a second Claude Code window on the same folder and connect it. The count and the link still do not change, and the second window does not open its own address.
4. **Hand-over.** Quit the window that was sharing. Within about 30 seconds the other one takes over: the chip shows *On* again, and participants get a new link (the old one stops working).

### Known gaps

- An old plugin (1.17.0 or earlier) alongside another old one still flips as before; the fix needs at least one copy on 1.18.0.
- After a hand-over the participant must press **Open the build** again: the new copy has a new key.
- The prod tier still serves plugin 1.14.0 until prod is promoted.

---

## 16 Oct 2026: the host console on two screens

**Test:** merge of dev `0e137d29` (and the help and notes commit after it). **Review tag:** `reviewable/2026-10-16-…` (named in the push).

### New

- **The host console (two screens only).** When the room's screen is a separate
  window (Present), the host's laptop no longer shows a copy of the wall. It shows a
  private console:
  - **Top line:** the session name, **Join 4473** (puts the join code on the wall), **Room's window ↗** (opens it), and a status that says whether the room's window is really up: *on, full screen*, *open, not full screen*, *hidden*, or *not open*.
  - **The loop:** the round's steps across the top. Pressing a step lets the host look at it privately; the room stays where it is.
  - **Left rail:** Round queue, People, Late & not reviewed, Session tools. The section that matters for the step opens by itself; a header's link opens the session menu at that tab.
  - **Main area:** the host's work for the step: responses as they land (names hidden while hidden), the ballot in the room's order, results with points, Workie's read with **Ask the room** beside it, the question for the room, comments as they land.
  - **Footer:** the one count for the step, "Your part now", "Next on the wall", and the buttons. Space, →, ← and the clicker work as before.
- **The room's window reports itself.** The Present page tells the server whether it is full screen and visible; the host's status is judged by the server's clock, so a wrong laptop clock cannot flip it.
- **Late answers are kept** (session flow v3, phase 5, step 1). An answer that arrives after its round has moved on is stored as late instead of being lost. The phone says "Kept, but late." If voting started while someone was still writing, the phone offers "Send it anyway".

### Fixed

- The Ask the room composer could be painted over by the step strip and the dock on one screen; it now sits above them.
- In-app help said players cannot vote for their own answer. They can (owner ruling, 11 Oct); the help now says so.

### What to look at

1. **Two screens, Call & Answer.** Two screens is only switched on for Call & Answer today (`config/surfaces.js`), so that is where the console appears. Start a session, open **Room's window ↗**, and run a full round: lobby, answering, voting, results, What we heard, Ask the room, a question for the room.
2. **The room's-window status.** Open the room's window in another tab: background tab → *hidden*; front → *open, not full screen*; press F on it → *on, full screen*; close it → *not open* within about 10 seconds.
3. **Keys.** After clicking a response to put it on the wall, Space and → must still move the room on. The "press again" warning on **Start round N** mid-read must work with two presses.
4. **Names.** On a round that hides names, no name appears beside any response, during answering or voting, and the People list never shows "still writing" next to someone who has answered.
5. **Laptop sizes.** 1366×768 and 1440×900: nothing scrolls sideways, and the footer's main button is always on screen. Ask the room's **Send** stays on screen while the read scrolls.
6. **One screen unchanged.** Switch to one screen (Settings) and confirm the stage, the slim strip and the dock are as before.
7. **Late answers.** On a phone, answer after the host has started voting: the phone should say the answer is kept but not in the vote.

### Known gaps

- Late & not reviewed is always empty until phase 5 adds the late list.
- Workie's read shows the whole text; it does not mark which page is on the wall.
- *On, full screen* could not be shown in the build's browser pane (it blocks full screen); please check it on a real second display.
