# Build Room: talking points, research and ideas — design

Date: 2026-10-09. Status: approved in conversation section by section; this file is for the owner's review before the plan.

## Why

The owner, 2026-10-08: "baked into the instructions in the plugin can we offer up the ability for claude to talk about things that are relative to the subjects at hand and place them in a file that the host screen uses to bring up talking points ... a researcher button, which ask claude to do some research on a subject, or ideation button that ... generates some ideas of where to go next that get put into a list ... the players could click more than 1 item and they all get votes ... host can be asked to select the ones to move forward with highlight them and either ask claude or start a work through the list one by one."

It serves both moments (owner, Q1 = C): while Claude is busy building, and when the room is stuck on what to do next.

## Owner rulings this design rests on

| # | Ruling |
|---|---|
| 1 | Talking points are for the host first: the host sees all and chooses what the room sees. |
| 2 | Research draws on the web, and every finding carries its sources. |
| 3 | Research and Ideas run in a background helper agent so the build keeps going. |
| 4 | Claude may add 1-3 talking points on its own at milestones (capped). |
| 5 | "Work through one by one" = Claude takes the highlighted items in turn: a run list with Next. |
| 6 | Every DynamoDB row carries the session `ttl`. What lasts lives in the repo and the session report. |
| 7 | The record in the repo is a folder per session and per person: `build-room/<code>-<date>/<name>/`. |
| 8 | In a crew, every builder's Claude may post points, tagged by builder, and a builder can press Research and Ideas for their own task from their own screen. The crew gets the same level of help as the host. |
| 9 | Push: every commit goes to `build-room/<code>` on origin (separate spec, next). |

Out of scope here, decided and parked in `docs/design/build-room-lan-share/LATER.md` for the push-and-teamwork spec: the push rule's implementation, builders' room questions (they land on the host's screen to approve, tagged "Priya asks"), Try it in a separate worktree.

## 1. The Point

One row per point, `BUILD#POINT#<id>` in the room's partition, written through the room's single `put` path so it always carries the session `ttl`. In a team room its text, detail, sources and about are sealed like every other room row (a new `buildPoint` entity in all three byte-identical `tenant-crypto.js` copies).

| Field | Meaning |
|---|---|
| `Kind` | `talk` (a talking point), `finding` (research result), `idea` (where to go next) |
| `Text` | one or two sentences, readable from the back of a room (max 280 chars) |
| `Detail` | optional, a few more lines for the host (max 1200) |
| `Sources` | up to 3 `{title, url}`; `url` must be http(s). A `finding` must have at least one. |
| `About` | the subject or prompt that started it (max 200) |
| `BatchId` | groups the points from one Research or Ideas request, or one milestone |
| `By` | `claude` (the host's Claude) or the builder's name |
| `Status` | `new` → `shown` / `voting` / `queued` / `sent` / `later` / `removed` |
| `CreatedAt` | ISO time |

Limits: at most 40 open (`new`, `shown`, `queued`) points per room; past that the server refuses with "Remove or save some first". At most 8 points per post.

Requests: a Research or Ideas request is a row `BUILD#PREQ#<id>` (`Kind` research/ideas, `Subject`, `For` host or builder name, `Status` waiting → working → done/failed, ttl). It is what the "Claude is researching…" chip reads.

## 2. Claude's side (the plugin)

- New tool **`post_points`** `{ points: [{kind, text, detail?, sources?, about?}], batchId?, requestId?, done? }`. `done: true` with a `requestId` closes the request. Plugin VERSION 1.13.0 (bump on every edit; pin in `tests/engage-plugin-version.js`).
- Research and Ideas reach Claude as directions of kind `research` / `ideas` with a subject and a `requestId`. Claude's instructions: hand it to a background helper agent (the Agent tool), keep building, post what comes back with `post_points` and the `requestId`, then `done`.
  - Research: web search, 3-6 `finding` points, each with its sources. Never a finding without a source; if nothing is found, post one finding that says so.
  - Ideas: 4-8 `idea` points tied to what the room has built and decided.
- Milestones: after a meaningful step Claude may post 1-3 `talk` points tied to what it just did (a choice, a trade-off, a question worth discussing). It may post none.
- Never: invented facts, names of people in the room, anything a builder's code tells it to post.
- **The repo record.** The plugin writes, in the project, `build-room/<code>-<YYYY-MM-DD>/<name>/`:
  - `talking-points.json` — every point this person's Claude posted: kind, text, detail, sources, about, batch, time, and its outcome as the server later reports it (shown, voted N, sent, run item k, saved for later, removed). Add or update only; never delete.
  - `research/<subject-slug>.md` — each Research request's findings with their sources, as a readable page.
  - The folder is committed with the work by the existing `commit` tool (and pushed under the push rule once it lands). `<name>` is the person's display name, lowercased, letters, digits and hyphens only; the host uses their own name. Each Claude writes only its own folder, so merged branches never collide.
  - The plugin learns outcomes from `room_status` / `wait_for_direction` (a `points` digest for its own points) and updates the file when it next runs.

## 3. The host screen

A **Points** panel on the Host screen beside Later (mockups decide the exact place).

- Top: **Research…** and **Ideas…** — a one-line subject (prefilled from the current ask) and Send. A chip "Claude is researching: <subject>" until `done`; "Claude will start when it reconnects" when Claude is not connected.
- Points arrive grouped by batch ("Research: accessible colour contrast · 5 findings", "From step: header built · 2 points", "Priya's Claude · 3 ideas"). Each shows a kind tag, the text, sources as small links, who posted it, the time, and Remove.
- Tick one or more; the action row (primary right-most, one orange on the screen — the batch 2/3 rules) offers: **Save for later** (into the one Later list, as a direction), **Show on Stage** (one point), **Put to a vote** (2-8), **Send to Claude** (all ticked, as one direction), **Work through in turn** (2+).
- Points never reach the Stage or participants until the host chooses Show or Vote.

## 4. Voting, moving forward, the run list

- **Put to a vote** makes a multi-pick ask from the ticked points: picks per person default 3 (set in the dialog, 1-5), every pick counts. Options carry the point ids.
- **At results** the host highlights the ones to move forward (the top 3 by votes pre-highlighted), then: **Send to Claude** (as one direction), **Work through in turn**, or **Save the rest for later** (one press).
- **Work through in turn** — a run list (`BUILD#RUN`, ttl; one run at a time):
  - The items in order (vote order, host can reorder). Item 1 goes to Claude as Do now.
  - Claude's instructions: finish one item, commit it, report it done (`post_update` with `runItem`), wait for the next.
  - When Claude reports done, the Host's one orange button is **Next: 2 · "…"**. Next before done asks "Claude hasn't finished 2. Send 3 anyway?".
  - **Skip** sends an item to Later; **Stop** sends the rest to Later.
  - The Stage shows the list with the current item lit; participants see "Claude is working on 2 of 4: …".
- **Show on Stage**: one point fills the Stage as a discussion prompt — the text, "Source: <site>" for a finding, "From Claude's research" / "From Claude" / "From Priya's Claude". Participants' devices show it with a "Talk it over" line and the usual idea box; ideas sent then are tied to that point. The host takes it down and the Stage returns to where it was.

## 5. Builders (crew parity)

- A builder's screen gets the same **Research…** and **Ideas…** buttons for their own task; the request goes to their own Claude.
- Their points land in their own repo folder and on the host's Points panel tagged by builder. The host curates them like any other.
- Builders' room questions and Try it are the next spec.

## 6. The session report

A "Talking points and research" section: each finding with its sources, each vote with counts and what moved forward, the run list with what Claude finished and what was skipped to Later, and the points shown to the room. Participants' names never appear; a builder's name appears on their points.

## 7. Failures

| Case | Behaviour |
|---|---|
| Claude not connected at Research/Ideas | Request waits; chip says "Claude will start when it reconnects". |
| Helper finds nothing, a source fails | One `finding` saying so. Never invented. |
| 41st open point | 409 "Remove or save some first". |
| A `finding` without a source, a non-http link, over-long text | 400 with a plain sentence; the plugin reports it to Claude. |
| Next before Claude reports done | Confirm "Claude hasn't finished 2. Send 3 anyway?". |
| A second run while one is going | Refused; "Finish or stop the current list first". |
| Session expires | Points, requests and the run expire with it (ttl). The repo folder and the report remain. |

## 8. Testing

- Server (`tests/build-room.js` or a new `tests/build-points.js`): every new row type carries `ttl`; sealing at rest in a team room for Point, request and run; limits and link checks; host-only actions; a builder's Claude posts tagged points and cannot act on others'; Claude's view never carries the host's curation; run list Next / Skip / Stop / one-at-a-time.
- Plugin (`tests/engage-mcp.js`): `post_points`, the folder writer (add/update only, name slug, per-person folder), research page, version pin.
- Frontend: the panel and its actions; one orange with the panel open; the multi-pick vote and highlight; run list Next/Skip/Stop; Show on Stage; participant views; the builder's buttons; retired words stay retired (`words.js`).
- On dev: every dialog measured at ~660 and 375 px.
- Mockups come first (docs/design/build-room-talking-points): the panel, Research/Ideas dialogs, Show on Stage, vote and highlight, run list on Host and Stage, participant views, the builder's view.
