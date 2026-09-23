# -*- coding: utf-8 -*-
"""
The one event every mockup in this set draws, so the times, counts and codes
agree from the builder to the invite list to the phone to the wall to the hub.

It is the owner's own example agenda, in the owner's order:
  "1\\intro survey, 2\\preso, 3\\trivia/quiz, 4\\call&answer, 5 different preso,
   6\\different quiz, 7\\call and answer, 8\\survey"

check() runs at build time: the planned times are the start plus the running
sum of durations, the invite counts add up, and every engagement item names a
set of its own type.
"""

ORG = "Northwind Traders"
TITLE = "Q4 Kickoff"
FULL = f"{ORG} — {TITLE}"
DATE = "Thu 9 Oct 2026"
PLACE = "Harbour Room, 4th floor"
START = (9, 0)            # 9:00
TZ = "Europe/London"
CODE = "5307"             # the one code for the whole event
URL = "engage.seibtribe.us/play"

# type -> (icon, label). Labels are gameTypes.js's display names; presentation
# is the one new type, and it has no set.
TYPES = {
    "survey":  ("survey", "Survey"),
    "slides":  ("slides", "Presentation"),
    "trivia":  ("trivia", "Trivia"),
    "call":    ("call", "Call &amp; Answer"),
    "poll":    ("poll", "Poll"),
    "wave":    ("wave", "Wavelength"),
    "break":   ("clock", "Break"),
}

# n, type, title, source, minutes, state, extra
ITEMS = [
    dict(n=1, desc="Five quick questions on your phone, so we know where the room starts. Anonymous.", type="survey", title="Before we start",
         src="Kickoff pulse — before", ver=3, count="5 questions", mins=8),
    dict(n=2, desc="Where FY26 landed: renewals, the miss in self-serve, and what it taught us.", type="slides", title="FY26 in review",
         src="fy26-in-review.pdf", count="24 pages", mins=30, who="Dana Whitfield"),
    dict(n=3, desc="Ten questions about the customers we serve. Scored, fastest right answer wins.", type="trivia", title="How well do you know our customers?",
         src="Customer knowledge — Q4", ver=2, count="10 questions", mins=15),
    dict(n=4, desc="Write the one thing that slows your week down, then vote for the room's top three.", type="call", title="What's slowing us down?",
         src="Friction finder", ver=5, count="4 prompts", mins=20),
    dict(n=5, desc="The plan for next year, the three bets in it, and what changes for your team.", type="slides", title="The FY27 plan",
         src="fy27-plan-v6.pdf", count="31 pages", mins=35, who="Marcus Oyelaran"),
    dict(n=6, desc="Eight questions on the plan you just heard. Scored.", type="trivia", title="FY27 plan quiz",
         src="FY27 plan — check-in", ver=1, count="8 questions", mins=12),
    dict(n=7, desc="If you could change one thing first, what would it be? Write it, then vote.", type="call", title="What would you change first?",
         src="First moves", ver=2, count="3 prompts", mins=20),
    dict(n=8, desc="Eight questions on how today went. Anonymous; results shared afterwards.", type="survey", title="How did today go?",
         src="Q3 All-Hands — Presentation Feedback", ver=4, count="8 questions", mins=8),
]


def fmt(mins_from_midnight):
    h, m = divmod(mins_from_midnight, 60)
    return f"{h}:{m:02d}"


# A break (owner, 23 Sep, decision 7): listed on the agenda with a return
# time, NOT counted in the caps, not billed, stores nothing. It has no number.
BREAK = dict(n=None, type="break", title="Break", mins=15,
             desc="Coffee on the 4th-floor landing.")
BREAK_AFTER = 4          # between item 4 and item 5


def agenda(items, brk=True):
    """The agenda as listed: the counted items, with the break slotted in."""
    out = []
    for it in items:
        out.append(it)
        if brk and it["n"] == BREAK_AFTER:
            out.append(BREAK)
    return out


def stamp(rows):
    t = START[0] * 60 + START[1]
    for it in rows:
        it["at"] = fmt(t)
        t += it["mins"]
        it["until"] = fmt(t)
    return fmt(t)


AGENDA = agenda(ITEMS)
ENDS = stamp(AGENDA)

# The caps (owner, 23 Sep): at most 16 agenda items, at most 8 of them
# engagements. Presentations fill the rest.
MAX_ITEMS, MAX_ENGAGEMENTS = 16, 8


def engagements(items):
    return sum(1 for i in items if i["type"] not in ("slides", "break"))


def counted(items):
    """What the 16-item cap counts: everything but breaks."""
    return sum(1 for i in items if i["type"] != "break")


# The same agenda after the host adds two more engagements — the state the
# builder is in when the engagement cap is reached (02b). Times recompute.
CAP_ITEMS = [dict(it) for it in ITEMS[:7]] + [
    dict(n=8, type="poll", title="Where should Q1 start?", src="Q1 priorities", ver=1,
         count="3 questions", mins=10, desc=""),
    dict(n=9, type="wave", title="FY27 in one word", src="One word", ver=1,
         count="1 prompt", mins=6, desc=""),
    dict(ITEMS[7], n=10),
]
CAP_AGENDA = [dict(r) for r in agenda(CAP_ITEMS)]
CAP_ENDS = stamp(CAP_AGENDA)
stamp(AGENDA)            # CAP_AGENDA's rows are copies; restore the real times

# The invitation list (answer 2): a name each, an email only for the host's own
# records, and a personal PASSCODE that is shown once and handed out by the
# host. 40 people were added on 1 Oct; 2 walk-ins on the day. 38 came.
INVITED, JOINED = 42, 38

# The day's standings (decision 6): the sum of each scored item's final points.
# Scored = the items whose session keeps player scores (trivia; Call & Answer's
# placement points). Surveys, polls, wavelength, talks and breaks add nothing.
# After items 3 and 4 — the state the break screen shows.
DAY = [("Tomás Ferreira", 640, 180), ("Aleksandra Wiśniewska", 610, 150), ("Hannah Lindqvist", 580, 170),
       ("Priya Raman", 540, 200), ("Kwame Asante", 590, 120)]
DAY = sorted(DAY, key=lambda r: -(r[1] + r[2]))
PASS_ALPHABET = "2345679ABCDEFGHJKMNPQRSTUVWXYZ"   # 30 symbols: no 0/O, 1/I/L, 8/B
assert len(PASS_ALPHABET) == 30 and not set("018ILO") & set(PASS_ALPHABET)


def check():
    assert len(ITEMS) == 8
    assert [i["type"] for i in ITEMS] == ["survey", "slides", "trivia", "call",
                                          "slides", "trivia", "call", "survey"]
    assert ENDS == "11:43", ENDS
    assert BREAK in AGENDA and BREAK["at"] == "10:13" and BREAK["until"] == "10:28"
    assert JOINED <= INVITED
    assert engagements(ITEMS) == 6 and len(ITEMS) == 8
    assert counted(AGENDA) == 8 and engagements(AGENDA) == 6   # the break counts for nothing
    assert engagements(CAP_ITEMS) == MAX_ENGAGEMENTS and len(CAP_ITEMS) <= MAX_ITEMS
    for code in ("K7QXPM", "R4WJ9C", "T2HNVF"):
        assert all(ch in PASS_ALPHABET for ch in code), code
    for it in ITEMS:
        assert it["type"] in TYPES
        assert ("ver" in it) == (it["type"] != "slides"), it


check()


def qr_svg():
    """A deterministic stand-in QR (the stage's exactly-one QR, stage-base.css
    .joinblock). 25x25 modules with the three finder squares."""
    n = 25
    cells = []
    seed = 5307

    def finder(x, y):
        return (f'<rect x="{x}" y="{y}" width="7" height="7" fill="#0F1A2E"/>'
                f'<rect x="{x + 1}" y="{y + 1}" width="5" height="5" fill="#fff"/>'
                f'<rect x="{x + 2}" y="{y + 2}" width="3" height="3" fill="#0F1A2E"/>')
    for yy in range(n):
        for xx in range(n):
            if (xx < 8 and yy < 8) or (xx > n - 9 and yy < 8) or (xx < 8 and yy > n - 9):
                continue
            seed = (seed * 1103515245 + 12345) & 0x7fffffff
            if seed % 5 < 2:
                cells.append(f'<rect x="{xx}" y="{yy}" width="1" height="1"/>')
    return (f'<svg viewBox="0 0 {n} {n}" shape-rendering="crispEdges" aria-label="QR code for {URL}">'
            f'<g fill="#0F1A2E">{"".join(cells)}</g>{finder(0, 0)}{finder(n - 7, 0)}{finder(0, n - 7)}</svg>')
