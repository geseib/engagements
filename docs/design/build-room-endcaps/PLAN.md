# Build Room end caps: a clean start, crisp commits, a real wrap-up

Owner, 2026-10-06:

> "we need two new end caps 1 is to make sure we are creating a new folder and git init for
> the project based on what it is called. and we need a way to keep the commit crisp and
> clean and documented and updated. this should all be documented in the plugin and skills
> so that it is handled by the claude code on behalf of the engage build room."
>
> "next we need to make it wrap up shut everything down in claude."
>
> On "Later": "later to me means there is something for claude but we are putting in the
> queue. maybe it was meant to send some info to claude but im not sure it was included."

Status: **approved 2026-10-06; being built.** The owner's answers:

1. **For Claude, later:** nothing reaches Claude until the host sends it (Send now, or Put to a vote).
2. **Folder:** `~/build-room/<name>`, named from the session title and editable in the Connect panel.
3. **Snapshots:** yes, hidden snapshots every turn; one clean commit per decision or milestone.
4. **Shutdown:** wrap-up asks the host before stopping Claude's servers.

## What happens today (measured in the code, 2026-10-06)

| Area | Today | The problem |
|---|---|---|
| Two "Later"s | The queue's **Later** parks an idea for the host; nothing reaches Claude. "Claude gets it as **Later**" sends Claude `FOR LATER: … Do not start it now` at once and adds it to the Room brief's Later list. | The same word means two things, and the second one's effect is invisible on the host screen (the brief is folded away in the right column). |
| The folder | Claude works in whatever folder it was started in. The first checkpoint runs `git init` there if needed. | No folder named for the project. A host who starts Claude in their home folder or an old project gets a mess. |
| Commits | The Stop hook commits **every turn**, `git add -A`, `--no-verify`, message `Build Room <id>: <last post_update>`. | Dozens of tiny commits with room-ticker messages, hooks bypassed, no docs. |
| Docs | None in the project. The brief lives in `.engage/brief.md` (ignored by git). | Someone opening the repo next week cannot tell what was decided or how to run it. |
| Wrap-up | `wrap_up` saves the outcome; the prompt then says "call wait_for_direction and keep calling it". Ending the session refuses Claude's calls with 409. | Nothing stops the dev servers, makes a final commit or tells Claude the session is over. |
| Plugin | Slash commands and two hooks. No skill. | The conventions live only in tool replies Claude sees once. |

## Proposal

### 1. One word per meaning ("Later")

- The queue's button becomes **Park**. A parked idea waits in a **Parked** fold in the queue. Nothing goes to Claude.
- Claude's kind keeps the four you approved, with the third renamed to say where it goes: **Do now · Keep in mind · For Claude, later · Ask Claude**.
- **For Claude, later** shows up where you look. The queue column gets a **For Claude, later · N** fold, holding the brief's Later list. Each item has **Send now** (as Do now), **Put to a vote** (with the others) and **Remove**.
- Question 1 decides whether Claude hears about it at once or only when you send it.

### 2. The start cap: a folder named for the project

- The session already has a title ("Build connect four html game"). Engage makes a folder name from it, `connect-four-html-game`, which the host can edit in the Connect panel.
- The Connect panel's command becomes one paste that makes the folder, enters it and starts Claude Code:
  `mkdir -p ~/build-room/connect-four-html-game && cd $_ && claude "/engage:connect eng_…"`
  - Claude Code works in the folder it was started in. Hooks, the brief file and the key all key off that folder, so the reliable way to get a new folder is to *start* Claude in it.
- `/engage:connect` (the plugin) then, in an empty folder:
  - `git init`, with branch `main`;
  - writes `README.md`: the title, the goal, "built live in an Engage Build Room on <date>" and a Run section;
  - writes `DECISIONS.md`, empty for now;
  - writes `.gitignore`, which includes `.engage/`;
  - makes the first commit, "Start: <title>".
- In a folder that already has code, it does none of that. It says so, and works on a branch `build-room/<slug>` so the room's work never lands on someone's `main`.

### 3. Crisp commits

- **Every turn, a snapshot, not a commit.** The Stop hook keeps its safety net but stops writing history. It saves the working tree as a hidden snapshot (`git stash create` → `refs/engage/snapshots/<n>`). Nothing is lost, and the branch stays clean. `/engage:restore` lists the snapshots.
- **One commit per decision or milestone, written by Claude.** The plugin tells Claude, and the skill documents, to commit when it has finished a piece of work the room can name:
  - Subject: what changed, imperative, at most 72 characters. For example, "Add dark mode toggle".
  - Body: why, in the room's words. For example, "Room decision, ask 7: What should we build next: dark mode (by vote, 6 of 9)."
  - Engage adds the trailer `Build-Room: <session> ask <n>`.
  - The project's own git hooks run (no `--no-verify`). If they fail, Claude fixes the problem or tells the host. It never skips them.
- **Docs kept current, as part of each commit:**
  - `DECISIONS.md` gets one line per room decision: question, answer, how it was decided, and the commit.
  - `README.md`'s Run section stays true.
- The `checkpoint` tool becomes `commit`: the message comes from Claude, and Engage checks the shape (subject length, no "WIP").

### 4. The wrap-up cap: shut everything down

`/engage:wrap-up`, and Claude's reaction when the host ends the session, become one closing checklist:

1. **Final state:** finish or revert work in progress. Nothing half-done is left in the tree.
2. **Docs:**
   - `README.md`: what it is, how to run it, what was left out.
   - `DECISIONS.md`: complete.
   - `NEXT.md`: the brief's Later list and the room's next steps.
   - Claude proposes which Keep in mind rules belong in the project for good; the host picks.
3. **Final commit** "Wrap up: <title>", and the tag `build-room-<date>`.
4. **Screenshots** of the result for the report, as today.
5. **`wrap_up`** to Engage, as today.
6. **Shut down:**
   - stop every server and background process Claude started this session (the plugin keeps a list);
   - stop listening (no more `wait_for_direction`);
   - say in one line where everything is: the folder, the branch, the tag.
7. **When the host presses End session** before wrap-up, Claude's next call gets "the session has ended". Claude runs steps 1–3 and 6, without asking the room anything.

### 5. Where it is written down

- A **skill** in the plugin, `engage:build-room`, holds the conventions in sections 2–4: folder, commits, docs and closing. Claude Code loads it when working in a connected project, so the rules survive a long session and a `/clear`.
- The slash commands (`connect`, `kickoff`, `wrap-up`, `continue`) point at the skill instead of repeating it.
- The tool replies stay short and point at the skill.

## Questions for the owner

1. **For Claude, later:** should Claude be told at once ("FOR LATER, do not start it") so it can plan around it? Or should nothing reach Claude until you press Send now?
2. **Where the new folder lives:** `~/build-room/<name>` by default, editable in the Connect panel? Or chosen by the host every time?
3. **Turn snapshots:** keep the hidden safety snapshots each turn (recommended)? Or no per-turn safety net at all?
4. **The end:** should wrap-up stop Claude's servers automatically, or ask the host first? The demo link stops working once its server stops.
