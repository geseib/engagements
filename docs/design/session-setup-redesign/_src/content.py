# -*- coding: utf-8 -*-
"""
The one session every mockup in this set draws, so the dialog, the stage, the
phone and the prompt page agree about the title, the code, the set, the
briefing and the round.

It is the owner's own example, end to end: a document saying issues are up
15% and MTTR has stretched to three weeks, a participant answering "prioritise
easy-fix tickets so they get done immediately", and Workie tying the two
together on the wall.

check() runs at build time: the briefing fits its cap, the category counts add
up to the set's total, and nothing that must never reach the wall (a person's
name from the document) appears in the briefing or in Workie's comment.
"""

TITLE = "Support Ops Review — Q3"
CODE = "6142"
URL = "engage.seibtribe.us/play"
FORMAT = "Call &amp; Answer"

SET_NAME = "Faster fixes"
CATEGORIES = [("Backlog", 4), ("Handoffs", 3), ("Tooling", 3), ("Customer updates", 2)]
SET_TOTAL = 12

DOC_NAME = "q3-support-ops-review.pdf"
DOC_PAGES = 14
DOC_MB = "2.1 MB"
DOC_CHARS = "19,400"
# The two names the document carries. The summariser swaps them for roles;
# check() proves neither reaches the briefing or the wall.
DOC_NAMES = ["Dana Whitfield", "Marcus Oyelaran"]

BRIEF_CAP = 1500
BRIEF_LINES = [
    "Q3 review of the support team, ahead of Q4 planning.",
    "Open issues are up 15% on Q2 (1,840 to 2,116).",
    "Mean time to resolve (MTTR) has stretched to 3 weeks. The Q4 target is 10 days.",
    "About a third of the open backlog is tagged “quick fix” (under a day of work); many have waited more than a month.",
    "Most escalations start with a ticket reopened after a first fix.",
    "Two tier-2 roles were unfilled for most of the quarter.",
    "Goal: MTTR under 10 days without adding headcount.",
]
BRIEF_TEXT = "\n".join(("- " + l) if i else l for i, l in enumerate(BRIEF_LINES))

QUESTION = "What’s one change that would cut our resolution time the most?"
QUESTION_DETAIL = "Think about the tickets you touched this quarter, not the ones you heard about."

ANSWERS = [  # text, points
    ("Prioritise the easy-fix tickets so they get done immediately — stop letting them queue behind the hard ones.", 18),
    ("One owner per ticket until the customer confirms it’s fixed. No more bouncing between queues.", 14),
    ("Fill the two tier-2 seats before we try anything clever.", 9),
    ("A daily 15-minute triage so nothing sits unassigned overnight.", 6),
]

# Workie's read-back on the wall. It must (a) draw on general knowledge,
# (b) tie back to the brief, naming the fact as the brief states it, and
# (c) never present a brief fact as something a participant said.
WORKIE_MD = [
    ("h", "Summary"),
    ("p", "The room’s top answer, <b>clear the easy fixes first</b>, is the classic quick-win play: "
          "small tickets close in a day, the queue visibly shrinks, and the customers who have waited "
          "longest for the simplest things stop waiting. It is also the fastest lever on an MTTR the "
          "brief puts at <b>three weeks</b>: a third of the backlog is under a day’s work, so pulling "
          "those out drags the average down without anyone working faster."),
    ("p", "Second place, <b>one owner until the customer confirms</b>, goes straight at reopened "
          "tickets, which the brief says is where most escalations start."),
    ("h", "Discussion Questions"),
    ("ol", ["If quick fixes jump the queue, who makes sure the hard tickets don’t wait even longer?",
            "What would “done” mean if the customer had to confirm it?"]),
    ("h", "Next Steps"),
    ("ul", ["Support lead: pull every ticket tagged “quick fix” into a two-week sprint and measure MTTR before and after."]),
]

PERSONA_DEFAULT = "Adapt to the session (recommended)"
PERSONA_PICK = "The Business Advisor — Strategic, direct, focused on what to do next"
PERSONA_SHORT = "The Business Advisor"
APPROACH_DEFAULT = "The standard Call &amp; Answer way (recommended)"
APPROACH_DEFAULT_SHORT = "the standard Call &amp; Answer summary"


def check():
    body = "\n".join(BRIEF_LINES)
    assert len(body) + 2 * (len(BRIEF_LINES) - 1) <= BRIEF_CAP, "briefing exceeds its cap"
    assert sum(n for _, n in CATEGORIES) == SET_TOTAL, "category counts do not add up"
    wall = " ".join(t if isinstance(t, str) else " ".join(t) for _, t in WORKIE_MD)
    for name in DOC_NAMES:
        for part in name.split():
            assert part not in body, f"a name from the document reached the briefing: {part}"
            assert part not in wall, f"a name from the document reached the wall: {part}"
    # The comment must cite the brief as the brief, never as the room.
    assert "the brief" in wall and "3 weeks" in body and "three weeks" in wall
    assert "15%" in body


BRIEF_LEN = len(BRIEF_TEXT)


def qr_svg(seed=11, n=29):
    """A deterministic QR-shaped pattern. Not a working code — a mockup.
    Copied from survey-redesign/_src/content.py (copied, not imported)."""
    import random
    r = random.Random(seed)
    cells = []

    def finder(x, y):
        for i in range(7):
            for j in range(7):
                if i in (0, 6) or j in (0, 6) or (2 <= i <= 4 and 2 <= j <= 4):
                    cells.append((x + i, y + j))
    finder(0, 0); finder(n - 7, 0); finder(0, n - 7)
    reserved = set()
    for (x0, y0) in ((0, 0), (n - 8, 0), (0, n - 8)):
        for i in range(8):
            for j in range(8):
                reserved.add((x0 + i, y0 + j))
    for x in range(n):
        for y in range(n):
            if (x, y) not in reserved and r.random() < 0.46:
                cells.append((x, y))
    rects = "".join(f'<rect x="{x}" y="{y}" width="1" height="1"/>' for x, y in cells)
    return (f'<svg viewBox="-1 -1 {n + 2} {n + 2}" xmlns="http://www.w3.org/2000/svg" '
            f'shape-rendering="crispEdges" role="img" aria-label="QR code"><rect x="-1" y="-1" '
            f'width="{n + 2}" height="{n + 2}" fill="#fff"/><g fill="#0F1A2E">{rects}</g></svg>')
