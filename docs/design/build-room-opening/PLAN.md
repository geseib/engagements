# The Build Room opening: frame it with the room, then build

Owner, 2026-10-06:

> "we haven't built the entry to the build room where it is more wide open and we start
> with questions about what we are building and there are a few ways to narrow the team. we
> ask them to pick from a list or we spin a wheel. are we creating a website, writing a
> document, creating an app, a game, figuring something out. … the host can continue to
> narrow the room with probing questions. think questions like amazon asks for working
> backwards. who is this for. what problems exist, what would good look like. and then they
> can start asking what are they building, any special frameworks, libraries or styles they
> should use. … once these questions are answered claude code goes from planning and prep
> mode (room setup and organizing) to build mode. these could be in the plugin and skills."

Status: **built 2026-10-06** (mockups: index.html, O1 to O4), including Claude's draft of the brief (draft_brief: a headline, a summary and plainer line wording, which the host edits, then uses or dismisses). The owner's answers: The owner's answers:

1. **Kinds:** no change asked for, so the proposed six stand, editable per session.
2. **Order:** a guided path the host walks in order, and can skip.
3. **Tools and style (3b):** the host answers by default, with one click to ask the room
   instead.
4. **Claude during the opening:** prepares, proposes probing questions for the host to review,
   and drafts the brief.

## Today

The Now card offers one starter, "Start with the room: What should we build?", answered as a
Choose list or as the room's ideas, with the wheel or a revote on a tie. After it there is no
narrowing, no phase, and the brief fills only through whatever the host sends as Keep in mind.

## The shape: two phases

```
OPENING (Claude prepares, the room frames)        BUILDING (Claude builds, the room steers)
 1 What kind of thing?        pick or wheel
 2 Working backwards          who, problem, good, proof, never
 3 Narrow to a first build    smallest version, tools, look
 4 The build brief            one page, on the wall      ──► Start building ──►  plan, build, ask
```

The session has a phase, `opening` or `building`. The host sees where the room is in the
opening and can skip, reorder, reword or repeat any step. **Start building** is always
available. It never waits for the steps to be "done".

### Step 1: What kind of thing are we making?

Pick one, or spin the wheel. The proposed list, which the host can edit and add to (up to 6,
so it fits the wheel):

- **A website or page:** something people visit.
- **An app:** something people use on a phone, laptop or tablet.
- **A game.**
- **A tool that saves time:** a script, an automation, a helper.
- **A document or guide:** a plan, a how-to, a proposal.
- **Figure something out:** compare options, test an idea, make a decision.

The answer sets the brief's **Kind**. It also changes the wording of later steps; for
example, a document gets "Who will read it?" instead of "Who will use it?".

### Step 2: Working backwards (Amazon's order)

Each step is an Ideas ask: everyone answers, then everyone votes, with a tie going to the
wheel or a revote, as today. The host can also answer for the room. Each decided answer fills
one line of the brief.

| # | Question (on the wall) | Fills | Probe the host can add |
|---|---|---|---|
| 2a | Who is it for? Name a person and the moment they need it. | Who it is for | Who else? Who is it **not** for? |
| 2b | What problem do they have today? | The problem | What do they do instead today? Why is that not good enough? |
| 2c | It is launch day. Write the headline. | What good looks like | What would they tell a friend? |
| 2d | How will we know it worked? | How we will know | What would we see, or count? |
| 2e | What must it never do? | Keep in mind (rules) | — |

**Probe** sits on each decided step. It asks a follow-up (the column above) as a new ask and
adds the answer to the same brief line. The host can probe as many times as they like.

### Step 3: Narrow to a first build

| # | Question | Fills | Usually answered by |
|---|---|---|---|
| 3a | What is the smallest version we could show today? | First build | the room |
| 3b | Any tools, frameworks, libraries or styles to use, or to avoid? | Tools and style | the host (or the room) |
| 3c | How should it look and feel? Pick one, or suggest. | Look and feel | the room, with mockups if Claude makes them |

### Step 4: The build brief

One page on the wall and in the report. It reads like the start of a press release:

> **Connect four, for two friends on one laptop**
> For: two friends sitting together, who want a quick game without signing up.
> Today: board games take setup, and online games want accounts.
> Good looks like: "Play in one tap, no account, on any laptop."
> We will know when: a new player finishes a game without help.
> First build: a board, two colours, a win check. Tools: plain HTML and JavaScript, no framework.
> Never: ask for an account.

**Start building** sends the whole brief to Claude as Do now, with "The room has framed the
build. Plan 3 to 6 steps, post the plan, and start." The phase becomes `building`.

### Claude during the opening ("planning and prep mode")

Claude is connected and listening, but writes no product code. It:

- sets up the project folder and git (the end caps), and notes the stack question for later;
- reads each answer as it lands (the brief, through room_status);
- may propose a probing question as a proposed ask, which the host reviews like any other;
- when the brief has Who, Problem and Good, may draft the one-page brief for the host to edit.

The plugin's `/engage:kickoff` reads the phase. In `opening` it prepares and listens; in
`building` it plans and builds. The skill gets an **Opening** section with these rules.

### Where the questions live

The steps ship built in, with their wording editable per session, because the brief lines
depend on them. The **Build Room starters** set stays the library for probing and mid-build
questions. A team can add its own opening questions as a `build-room` set.

## Questions for the owner

1. **The list of kinds.** Is the proposed list right: a website, an app, a game, a tool that
   saves time, a document or guide, figure something out?
2. **The opening's order.** A guided path the host walks in order (and can skip), or a
   checklist the host picks from in any order?
3. **Tools and style (3b).** Ask the room by default, or does the host answer it by default?
4. **Claude during the opening.** Only prepare and listen? Or also propose probing questions
   and draft the brief?
