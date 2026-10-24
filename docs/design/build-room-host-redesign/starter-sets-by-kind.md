# Build Room starter sets by kind of build

Owner, 22 Oct 2026: *"different questions for a training site, vs a game, vs a paper"*; 23 Oct:
*"build step 6, the starter sets"* (`docs/superpowers/plans/2026-10-22-build-room-question-sets.md`).

Four kinds first, to match the first starter templates: **training, game, document, dashboard**.
Since 24 Oct 2026 each kind is **one Poll set** (owner: *"some questions are ideas (free form
responses), some are multiple choice (with the choices), some are yes no. we need to store that
info"*). A Poll question's kind is its Build Room type (`src/src/buildroom/readyQuestions.js`):
open answer → Ideas, choice → Choose, yes/no → Yes/No, 1–5 rating → Rate.

| File | Type | In a Build Room | Tags |
|---|---|---|---|
| `sets/build-room-training.csv` | Poll, 22 | 14 Ideas, 3 Choose, 3 Yes/No, 2 Rate | `build-room`, `for-training` |
| `sets/build-room-game.csv` | Poll, 22 | 14 Ideas, 3 Choose, 3 Yes/No, 2 Rate | `build-room`, `for-game` |
| `sets/build-room-document.csv` | Poll, 22 | 14 Ideas, 3 Choose, 3 Yes/No, 2 Rate | `build-room`, `for-document` |
| `sets/build-room-dashboard.csv` | Poll, 22 | 14 Ideas, 3 Choose, 3 Yes/No, 2 Rate | `build-room`, `for-dashboard` |

Until 24 Oct each kind was two sets (a Call and Answer set of Ideas and a three-question Poll
"pulse"); the install script switches those off. The Ideas tables below are unchanged; the CSVs
are the source for the Choose, Yes/No and Rate questions.

Same rules as the first starter set (`starter-set.md`): the five sections in session order
(Who it is for, Start, Think differently, While building, Before wrapping up), plain words, what
Claude gets for each answer (`ClaudeGets`) and how to use it (`ClaudeNote`, never shown to the
room). The general set is **Build Room: General** (`sets/build-room-general.csv`, 24 Oct 2026): one Poll set of 25 questions, untagged by kind, replacing **Build Room starters** and **Build Room pulse**, which are retired and then deleted (`scripts/delete-question-sets.js`).

**Drafts for the owner to edit.** Change the CSVs here, then reinstall; `tests/question-set-roundtrip.js`
imports every one with the real importer and checks the sections, the counts, that each has what
Claude gets, and that every question is one a Build Room can ask.

## Installing

Needs AWS credentials (not available from the remote container). Dry run first, then `--apply`:

```bash
AWS_PROFILE=adminaccess scripts/install-build-room-kind-sets.sh engagedev
AWS_PROFILE=adminaccess scripts/install-build-room-kind-sets.sh engagedev --apply
```

The dry run lists, per kind, the set it would install (`buildroom<kind>`) and the two old sets it
would switch off (`buildroom<kind>questions`, `buildroom<kind>pulse`, via
`scripts/retire-question-sets.js`). Re-running is safe: an installed set is skipped.

Or upload each CSV in the console (Question sets, New set, Upload, as a Poll), add the two tags,
and switch the old two off.

## The questions

### Training

| Section | Question | Claude gets |
|---|---|---|
| Who it is for | Who is learning, and what do they already know? | keep |
| Who it is for | What should they be able to do afterwards that they cannot do today? | keep |
| Who it is for | Where and when will they take this? | keep |
| Start | What mistake does a beginner make most often? | keep |
| Start | What do they need on day one, and what can wait? | keep |
| Start | How will we know someone has learned it? | keep |
| Think differently | What would you teach with a story instead of a rule? | ask |
| Think differently | How would an expert teach this in five minutes, standing next to you? | ask |
| Think differently | What would make someone want to finish? | ask |
| While building | Where did you get stuck in the lesson on the screen? | do-now |
| While building | Which question in the check felt unfair or unclear? | do-now |
| While building | What example would make this click for people like us? | do-now |
| Before wrapping up | What should the next lesson cover? | later |
| Before wrapping up | What would make a manager trust this training? | later |

Pulse:

- How clear is this lesson? (1 to 5)
- How long should one lesson be? (Under 2 minutes / About 5 minutes / About 10 minutes / Longer)
- Would you send a new volunteer to this? (1 to 5)

### Game

| Section | Question | Claude gets |
|---|---|---|
| Who it is for | Who is playing, and where are they when they play? | keep |
| Who it is for | What should a player feel in the first minute? | keep |
| Who it is for | Why would someone play a second time? | keep |
| Start | What does the player do in the first ten seconds? | keep |
| Start | How does a player win, and how do they lose? | keep |
| Start | What is the one rule that makes this game different? | keep |
| Think differently | Which game is this like, and what would we change? | ask |
| Think differently | How would this work as a board game or a playground game? | ask |
| Think differently | What if the players worked together instead of against each other? | ask |
| While building | What was confusing in the first try? | do-now |
| While building | When did it get boring? | do-now |
| While building | What would make it fairer? | do-now |
| Before wrapping up | What should the next level add? | later |
| Before wrapping up | What would make you share this with a friend? | later |

Pulse:

- How fun is it so far? (1 to 5)
- How hard is it? (Too easy / About right / Too hard)
- Would you play it again tomorrow? (1 to 5)

### Document

| Section | Question | Claude gets |
|---|---|---|
| Who it is for | Who reads this, and what should they do after reading it? | keep |
| Who it is for | What do they believe today, before they read it? | keep |
| Who it is for | How much time will they give it? | keep |
| Start | What is the one sentence we want them to remember? | keep |
| Start | What decision or action should it lead to? | keep |
| Start | What must it never say or promise? | keep |
| Think differently | What is the strongest argument against us? | ask |
| Think differently | How would we say this in one picture instead? | ask |
| Think differently | What would the reader ask first, if we were in the room? | keep |
| While building | Which part did you have to read twice? | do-now |
| While building | What is missing that a reader would need to act? | do-now |
| While building | What can we cut without losing the point? | do-now |
| Before wrapping up | What would make a skeptical reader say yes? | later |
| Before wrapping up | Who should read this before it goes out? | later |

Pulse:

- How clear is the main point? (1 to 5)
- How long should it be? (One page / Two or three pages / Longer, with sections)
- Would you send this as it is? (1 to 5)

### Dashboard

| Section | Question | Claude gets |
|---|---|---|
| Who it is for | Who looks at this, and how often? | keep |
| Who it is for | What decision should this help them make? | keep |
| Who it is for | What do they check today, somewhere else? | keep |
| Start | Which three numbers matter most? | keep |
| Start | What does a good week look like on the screen, and a bad one? | keep |
| Start | Where does the data come from, and how fresh is it? | keep |
| Think differently | Which number would surprise people most? | ask |
| Think differently | What if it sent one message instead of being a screen? | ask |
| Think differently | What could mislead someone reading it? | keep |
| While building | Which chart did you have to read twice? | do-now |
| While building | Which filter or comparison do you keep wishing for? | do-now |
| While building | What should we take off the screen? | do-now |
| Before wrapping up | What should it show next time we have more data? | later |
| Before wrapping up | Who else would use this, and what would they need? | later |

Pulse:

- How quickly could you find the number you needed? (1 to 5)
- What should open first? (The latest numbers / The trend over time / A comparison between groups)
- Would you check this every week? (1 to 5)
