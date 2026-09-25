# Front page copy: current and proposed, 2026-09-25

The mockup is `home.html` in this folder. It uses the live page's own CSS and layout. The toggle in the
bottom-right corner switches between **Proposed** and **Current**. **Mark changes** outlines every string
that differs. Open `home.html?v=current` to start on the current wording.

"Current" is `origin/dev` at `05fb149c`: `src/src/marketing/content/home.js`, `MarketingShell.jsx`,
`src/src/components/JoinCodeEntry.jsx`, `content/clips.js`, `content/sampleReport.js`, `ClipStill.jsx` and
the `<head>` of `src/public/index.html`. Nothing in `src/` was changed.

**Rules** (Orwell, *Politics and the English Language*):
R1 no stale figure of speech · R2 short word over long · R3 cut what can be cut · R4 active over passive ·
R5 everyday word over jargon · R6 break a rule rather than write something barbarous.
Other reasons: **True** means the old line said something the product does not do. **Owner** means one of
the owner's three follow-up points: devices, purpose, and where the ideas come from.

## 1. Every string

### Page head (index.html; not visible on the page)

| Where | Current | Proposed | Why |
|---|---|---|---|
| `<title>` | Engagements — live sessions that turn your team’s material into decisions | Engagements — hear what your whole team thinks | R3, R5 |
| meta description | Run trivia and call-and-answer sessions from your own material. Everyone answers from their phone; call-and-answer rounds put every idea to a vote, and the report keeps everything. | Put a lesson, a question or a problem in front of your team. Everyone answers on a phone, laptop or tablet, and the report keeps every answer. | Owner (devices, purpose), R3 |
| og:description | Live sessions that turn your team’s own material into decisions — with a report that kept everything. | Bring your team a new idea and hear what everyone makes of it, with every answer kept in the report. | Owner (purpose), R4 |

### Nav, footer and join field

| Where | Current | Proposed | Why |
|---|---|---|---|
| Nav links, Sign in, Create a host account, Menu (aria) | — | unchanged | already plain |
| Footer: Engagements, Privacy, Terms, Help, Join with a code | — | unchanged | already plain |
| Join: label / button / aria | Have a code? / Join / Session code, 4 digits | unchanged | already plain |
| Join: hint | No account and no app. The code is on the screen at the front of the room. | unchanged | already plain and true |
| Join: code not found (shown after a failed lookup) | Nothing is running under {code}. Check the screen at the front of the room. | No session is using {code}. Check the screen at the front of the room. | R5 ("running under" is system talk) |

### Hero

| Where | Current | Proposed | Why |
|---|---|---|---|
| Kicker | Base camp | For offsites, workshops and retros | R1 (the climb stays in the picture, not the words), R5 |
| Headline (four lines) | Your team’s own / material, turned into / decisions everyone / climbed toward. | Bring your team / a new idea. / Hear what everyone / makes of it. | R1 ("climbed toward"), R4, Owner (purpose) |
| Lead | Build question sets from what your team already has. Run them as trivia to warm the room up, or as call and answer to collect every idea and put it to a vote. Everyone plays from their phone. The session ends with a report. | Each round gives the team something to work through: a lesson from a hard book, a choice a leader in history faced, or a problem of your own. Everyone answers on a phone, laptop or tablet, and the room votes on the answers. When you finish, the report is ready. | Owner (purpose, sources, devices), R1 ("warm the room up") |
| Buttons | Create a host account / Sign in | unchanged | — |

### Problem

| Where | Current | Proposed | Why |
|---|---|---|---|
| Title | Most sessions lose the thing they were for. | Most meetings hear from a few people and forget what they decided. | R3 ("the thing"): say what gets lost |
| 1 heading | A few voices decide | A few people decide | R1 |
| 1 text | The same three people talk. The quiet half of the room has the answer and no way into the conversation. | The same three people talk. Others in the room know the answer and never find a moment to say it. | R1, spoken rhythm |
| 2 heading | Ideas leave with the people | unchanged | literal, not a figure |
| 2 text | Written on a whiteboard, photographed by two of them, typed up by nobody. | Someone fills the whiteboard, two people photograph it, and nobody types it up. | R4 |
| 3 heading | Nobody remembers what was decided | Nobody remembers what you decided | R4 |
| 3 text | Six weeks later the decision is folklore, and the reasoning that produced it is gone. | Six weeks later, everyone remembers it differently, and nobody can say why you chose it. | R1 ("folklore"), R2 |

### Two kinds of round

| Where | Current | Proposed | Why |
|---|---|---|---|
| Title | One set of questions, two shapes of round. | Trivia to check what people know. Call and answer to hear what they think. | R5 ("shapes of round"); says what each round makes a team do (Owner, purpose). There are five types, not two (True) |
| Lead | Both run on the screen at the front of the room while everyone answers on their own phone. | Both run on the screen at the front of the room while everyone answers on their own phone, laptop or tablet. You can also run polls, surveys and Wavelength, a word game. | Owner (devices), True (five types) |
| Trivia tag | Trivia | unchanged | — |
| Trivia heading | Warm the room up, or check what landed. | Open with a quiz, or check what people remember. | R1 (both halves) |
| Trivia 1 | A question, four options, one right answer — revealed with its explanation. | Multiple-choice questions, each with a right answer. | True (the explanation is not shown on the screen; 4–6 options) |
| Trivia 2 | Ask, then results. Trivia has no vote phase. | No vote here: people answer, then you show the results. | R5 ("phase"), R4 |
| Trivia 3 | Running standings after every question. | After each question the top three go up on the screen, and every player sees their own place. | True (the screen shows a top-three podium, not full standings), concrete |
| Caption, TV | Trivia on the big screen | unchanged | — |
| Caption, phone | Answering from a phone | Answering on a phone, tablet or laptop | Owner (devices) |
| Alt, TV | …then the correct answer and the standings appear. | …then the correct answer and the top three appear. | True |
| C&A tag | Call and answer | unchanged (the app says "Call & Answer") | — |
| C&A heading | Pose a prompt, collect every idea, then vote. | Ask an open question, collect every idea, then vote. | R5 ("pose a prompt") |
| C&A 1 | Everyone writes at once, so the room hears from the people it usually does not. | Everyone types an answer at the same time, so you hear from people who rarely speak up. | R3, the team gain said plainly |
| C&A 2 | Ask, vote, results — three phases you move through. | Then each person ranks the three answers they like best. | True (the vote is a ranked top three), R5 |
| C&A 3 | Every answer is kept, not only the ones that won votes, and the breakdown goes into the report. | The results go up on the screen, followed by an AI summary of what the room said. | R4; the "every answer is kept" point moves to the room section and the report |
| Caption, phone | Adding an idea, then voting | unchanged | — |
| Alt, TV | The host screen shows a prompt, ideas from the room arrive one by one, the room votes, and the results are revealed with a summary. | The host screen shows a prompt and a count of answers coming in, then every answer goes up for the vote, and the results are revealed with a summary. | True (answers are hidden until the vote opens) |
| Alt, phone | …then votes on the ideas from the rest of the room. | …then ranks the three answers they like best. | True |

### Your material

| Where | Current | Proposed | Why |
|---|---|---|---|
| Title | The questions come from your work, not from a quiz pack. | Bring your own material, or borrow a lesson from a book or from history. | Owner (sources), R4 |
| Lead | Hand the builder the strategy document, the retro notes, the deck you are about to present. It drafts a set. You decide what runs. | Start from our library, with lessons from books such as The Design of Everyday Things and from leaders such as Lincoln, each turned into a question about your own work. Or upload your own documents and let the AI draft a set. You decide which questions run. | Owner (sources), True (slide decks are refused), R5 ("the builder") |
| Step 1 | Supply the material / Documents and topics you already have. Or write the questions yourself — the builder is a convenience, not a requirement. | Add your material / Upload a PDF, Word or text file, or describe the subject. Or skip the AI and write every question yourself. | R2 ("supply"), R3, True (file types) |
| Step 2 | A set is drafted / The AI builders turn it into trivia questions or call-and-answer prompts, each with its category and its detail. | The AI drafts a set / Trivia questions with answers and explanations, or open questions for call and answer, each with a category. | R4, R5 |
| Step 3 | You review and edit / Preview the set as a player will see it, change anything, drop anything. Nothing runs until you start a session with it. | You check and edit / Preview each question as the room will see it, then change or delete anything. Nothing runs until you start a session. | True (the preview shows the front screen, not the phone), R3 |
| Step 4 | It is stored where it belongs / In your organisation’s private library, encrypted. Or take a starting point from the moderated public library. | It stays in your library / Your library is private and encrypted. You can also copy a set another team has shared and make it your own. | R4, R3; "public library" explained in plain words |
| Caption / alt, laptop | Drafting a set from your material / The set builder takes a topic… | unchanged (see §3) | — |
| Note, bold | Private stays private. | unchanged | — |
| Note, text | An organisation’s sets are encrypted and are readable only inside that organisation. The public library is separate, moderated, and nothing reaches it without being published on purpose. | We encrypt the text of your questions, and nobody outside your team can open your sets in the app. A set reaches the public library only when an admin on your team shares it, and we check every one first. | True (see §2), R4 |

### The room

| Where | Current | Proposed | Why |
|---|---|---|---|
| Title | Answers arrive live. The team votes. The strongest ideas rise. | The whole room answers. Then the whole room votes. | True (answers are not shown live), R1 ("rise"), and "strongest" called a vote a measure of quality |
| Tally question | What should we stop doing? | unchanged | — |
| Tally meta | 20 people answered. 20 votes cast. | 20 people answered, then each ranked their top three. | True (ranked ballot) |
| Tally counts | 9 / 7 / 4 / 0 votes | 52 / 44 / 24 / 0 points | True: results show points (3/2/1 per ballot). 20 ballots × 6 = 120 |
| Tally note | The answer with no votes is kept too. A session that quietly discards it is a session you cannot go back to. | The answer nobody picked stays in the report too. You may want it next quarter. | R3, concrete |
| Photo caption | The moment a result lands. | Looking up for the result. | R1 ("lands") |
| Lead | Everyone writes at the same time, so the room does not have to take turns to be heard. | Everyone writes at the same time, so nobody has to wait for a turn to speak. | R4, R3 |
| List 1 | Answers appear on the front screen as they are submitted. | When you move to the vote, every answer goes up on the front screen. | True, R4 |
| List 2 | The room reads them, then votes — on what was actually said, not on who said it loudest. | By default, names stay hidden until the results, so people vote on what was said, not on who said it. | True (anonymity is on by default), R3 |
| List 3 | The count is a vote count. It is not a quality score and the report never calls it one. | A high score means the room liked an answer. It does not mean the answer is right. | True (the report says "points"), plain |
| List 4 | Names can be hidden for a whole session if the subject needs it. | removed; merged into list 2 | True (names come back at the results), R3 |

### The report

| Where | Current | Proposed | Why |
|---|---|---|---|
| Kicker | The summit | The report | R1 (as for "Base camp") |
| Title | Everyone leaves with the same page. | Nobody has to write it up afterwards. | R1 (twisted idiom), True (players do not receive the report) |
| Lead | The report is written as the session runs. Nobody has to type the whiteboard up afterwards. | The session records every answer, vote and comment as it goes. At the end, open the report, print it, or save it as a PDF to share. | R4, True (the report is built when opened; to keep it, the host saves it) |
| Photo caption | One sheet, read by everyone. | Two people, one report. | R4, says what the photo shows |
| Link | See a full report, annotated → | See a full sample report, with notes → | R2, and it is a sample |
| Sheet: answer counts | 9 votes / 7 / 4 / 0 votes | 52 points / 44 / 24 / 0 points | True (the real report prints "N points") |
| Sheet: standings | #, Player, Correct, Points: 1,340 / 1,205 / 1,118 | #, Player, Points: 41 / 38 / 33 | True (no "correct" column in the real report; 15 points a question at most) |
| Sheet: buttons | Export PDF / Copy shareable link | Print / Save report | True (the real report's toolbar) |
| Sheet: note | Every answer, every vote and every comment is kept — not only the ones that won. | Every answer and every comment stays in the report, not only the winners. | R4 |
| Sheet: title, meta, question, answers, bylines, summary, next steps | — | unchanged | sample product output |

### Closing band

| Where | Current | Proposed | Why |
|---|---|---|---|
| Title | Bring your own material. Leave with a decision. | Bring a problem. Leave with a decision everyone had a say in. | Owner (purpose), the team gain in plain words |
| Buttons | Create a host account / See how it works | unchanged | — |
| Fine print | Players never need an account. Hosts sign in once. | Players never need an account. Hosts sign up, and we approve each new host. | True (new hosts wait for approval) |

### Drawn product stills (text inside the pictures)

| Where | Current | Proposed | Why |
|---|---|---|---|
| Hero phone | +120 pts | +14 pts | True (10 for a right answer plus up to 5 for speed; 15 at most) |
| C&A TV chips | Call and answer · Vote … 20 votes cast … Results | Results … 20 of 20 voted … Next question | True (vote counts appear at results, not during the vote); the longer "· Results" label wrapped to three lines, so the chip says only "Results" |
| C&A TV bar numbers | 9 / 7 / 4 | 52 / 44 / 24 | True (points), matches the tally |

## 2. Claims removed, corrected or not verified

Checked against the code on `origin/dev` 05fb149c. The library contents were checked with read-only DynamoDB
queries on `engagedev`, `engagetest` and `engageprod`.

**Removed or corrected because the product does not do them:**

- **"Answers arrive live" / "Answers appear on the front screen as they are submitted."** During ASK the front
  screen shows only the question and a count. The answers go up when the host opens the vote
  (`GameHostPage.jsx` 6257–6310).
- **"The count is a vote count … the report never calls it one" / "20 votes cast" / "9 votes".** Each player
  ranks a top three, scored 3/2/1 (`PlayerPage.jsx` 2473, `get-results.js` 471–473). The report prints
  "N points" and "Session Champion" (`GameReport.jsx` 539, 646).
- **"Names can be hidden for a whole session."** Anonymity is on by default for Call & Answer and Poll, but
  names come back automatically at the results (`get-results.js` 261–271, `authorsHiddenNow`).
- **"Revealed with its explanation" (trivia).** The front screen never receives `answerDetails`
  (`get-question.js` 224–230). The explanation appears in the report and the round report.
- **"Four options, one right answer".** Trivia allows 4–6 options and 1–3 correct answers.
- **"The deck you are about to present."** PPTX is refused with "Save them as a PDF first". Uploads accept
  PDF, DOCX, TXT and MD, up to 5 MB (`utils/documentText.js`, `admin/parse-document.js`).
- **"Readable only inside that organisation."** Staff can decrypt; each decrypt is logged and names the org
  (`shared/tenant-crypto.js` 9–16). No staff screen shows org content. Question text also goes to the AI
  service for drafting and for the publish check. The proposed line says "in the app" on purpose.
- **"Preview the set as a player will see it."** The preview shows the front-screen card, not the phone
  (`QuestionPreview.jsx` 64–70).
- **"Everyone leaves with the same page."** Players do not receive the report. The host can print it, or save
  it and share a link that needs a passkey (`download-report.js`). The player download was removed.
- **"The report is written as the session runs."** Answers, votes, summaries and comments are recorded live.
  The report is assembled when the host opens it. An unsaved copy expires after 30 days and the session's
  rows after 7 (`create-report.js` 932, `session-ttl.js` 30). A saved report lasts 90 days or a year
  (`save-report.js` 100).
- **"Hosts sign in once."** A new sign-up joins the `pending` group and waits for an admin
  (`auth/post-confirmation.js` 76).
- **"Two shapes of round."** The create dialog offers five types: Call & Answer, Trivia, Poll, Wavelength
  and Survey (`config/gameTypes.js`, `GameSetupDialog.jsx` 586). Poll has not been retired in the code,
  which differs from an older note.
- **"+120 pts", "1,340 points", the "Correct" column.** Impossible or not in the product (see §1, stills
  and sheet).

**Added claims, and what backs them:**

- **Phone, laptop or tablet, no app.** Help → What you need to run it says: "Any phone, tablet or laptop with a
  current browser … No account, no install, no app" (`config/help/technical.js` 116–119). The lobby
  says "Scan to join · no app, no account".
- **Lessons from books and from leaders in history ("our library").** Engage's shared library (platform
  scope, readable by every team) holds these sets on all three tiers:
  - *Historic World Leaders advice and guidence*, 50 questions (Lincoln's cabinet of rivals, Mandela,
    Churchill and others).
  - *(Demo) Lessons from Different Schools*, 14 Apply questions. Their `SourceAttribution` names, among
    others, Don Norman's *The Design of Everyday Things*, Christopher Alexander's *A Pattern Language*,
    Kahneman and Tversky, and Amy Edmondson.
  - Dev alone also has *Lessons from the School of Hard Books* (80), *Lessons from the Band* and a
    sports-coaches set. The copy names only Lincoln and *The Design of Everyday Things*, which are on every
    tier. Aside: "guidence" in the set name is a typo.
- **Apply rounds exist.** `shared/round-kinds.js`: "You hand them somebody else's material and ask where it
  lands here". Each question asks where the lesson fits the team's own work (e.g. the Lincoln question asks
  which critics the team has kept outside the room).
- **AI summary on the screen after results.** It runs automatically once a round has at least one answer, and
  shows as the "What we heard" step (`GameHostPage.jsx` 1630–1660, 6608–6630).
- **Top three on screen, own place on the phone.** `config/podium.js`, `PlayerPage.jsx` 3176–3198.
- **Print / Save report.** These are the real report toolbar's two buttons (`GameReport.jsx` 191–206).

**Could not verify, so not claimed:** anything about pricing (the billing system is simulated), group size,
and whether "hard book" sets exist on test and prod beyond *Lessons from Different Schools*. Hence the
copy says "a lesson from a hard book", not the dev-only set's name.

## 3. Left alone on purpose, for the owner to decide

- **The climb.** The picture still climbs from base camp to the flag. Only the two kickers lost the words.
  To keep the metaphor in words, restore "Base camp" and "The summit". Nothing else depends on them.
- **The summit photograph** shows a printed sheet that reads "9 votes / 7 votes / 4 votes". At the sizes the
  page uses it is mostly texture, but a close look contradicts the proposed "points".
- **The laptop still** in "Your material" draws the host's list of sets, while its caption and alt text describe
  the set builder drafting. They were written for a recording that does not exist yet.
- **The sample report heading** "Final standings — trivia rounds". The real section is "Final Scores".
- **Existing layout bugs, not wording:** at phone width the two mode TVs shrink to about 143px wide (the live
  page does the same), and the hero lead sits flush under the headline because `.mk-root p { margin: 0 }`
  beats `.mk-hero-sub`'s margin. Both are the same on the live page.

## 4. When this is applied

The strings live in `src/src/marketing/content/home.js`, `content/clips.js`, `content/sampleReport.js`
(shared with `/reports`), `components/ClipStill.jsx`, `src/src/components/JoinCodeEntry.jsx` and
`src/public/index.html`. Dropping the Correct column needs a small change to `SampleReport.jsx`, which renders
four columns from `standingsCols`.

These tests pin current strings and will need updating: `src/src/__tests__/homePage.test.jsx` (the exact
h1 text, the kickers `['Base camp', 'The summit']`, `/trivia has no vote phase/`, `/no votes is kept too/`,
`/answers appear on the front screen/`, `'Export PDF'`, `'Copy shareable link'`, `'+120 pts'`,
`/see a full report, annotated/`). Also check `brandHome.test.jsx`, `rootPage.test.jsx` and the
marketing palette and contract suites.
