# -*- coding: utf-8 -*-
"""
The one survey every mockup in this set draws, so the numbers agree from the
editor to the phone to the wall to the report. Presentation feedback, because
that is the owner's example ("what was the best part of the preso? what would
you like to see added?").

Every total below is checked by check() at build time: shares sum to their
n, average ranks sum to 1+2+…+k, the NPS is what its split says.
"""

TITLE = "Q3 All-Hands — Presentation Feedback"
SHORT = "All-hands feedback"
CODE = "4821"
JOINED, FINISHED, PARTWAY = 42, 38, 3

Q = [
  dict(n=1, kind="rating", req=True,
       title="How useful was today’s session for your work?",
       scale=(1, 5), low="Not useful", high="Very useful",
       dist=[1, 2, 6, 15, 14]),
  dict(n=2, kind="nps", req=False,
       title="How likely are you to recommend this session to a colleague?",
       scale=(0, 10), low="Not at all likely", high="Extremely likely",
       split=(6, 13, 18)),                       # detractors, passives, promoters
  dict(n=3, kind="choice", req=True, multi=False,
       title="Which part of the presentation was most valuable to you?",
       opts=[("Live demo of the new console", 14),
             ("The three customer case studies, with their renewal numbers", 11),
             ("Pricing roadmap for FY27", 7),
             ("The open Q&amp;A", 4),
             ("Hiring plan update", 2)]),
  dict(n=4, kind="choice", req=False, multi=True, pick=2, other=True, resp=36,
       title="Which formats would you want more of next time?",
       opts=[("More time for questions", 22), ("A hands-on breakout", 17),
             ("Slides sent a day ahead", 12), ("A recording afterwards", 9),
             ("Other", 3)]),
  dict(n=5, kind="yesno", req=True, unsure=True,
       title="Was the length about right?",
       follow=("No", "What would you cut or add?"),
       split=(24, 11, 3)),                        # yes, no, not sure
  dict(n=6, kind="rank", req=False, top=3, resp=35,
       title="Rank these topics for the next all-hands",
       items=[("Customer stories", 2.1, 13), ("Product roadmap", 2.3, 12),
              ("Team wins", 2.9, 5), ("Culture &amp; hiring", 3.6, 3),
              ("Financials", 4.1, 2)]),
  dict(n=7, kind="text", req=False, length="long", limit=500, resp=31,
       title="What was the best part of the presentation?",
       themes=[("The live demo made it concrete", 12,
                "Seeing the console actually run beat every slide about it."),
               ("Customer stories with real numbers", 8,
                "The renewal figures on the Halvorsen account were the first time I understood why pricing matters."),
               ("Honesty about what slipped", 6,
                "Appreciated that the Q2 miss was named and not dressed up."),
               ("Pace and energy", 3, "Didn’t drag. Forty minutes felt like twenty."),
               ("Other", 2, "")]),
  dict(n=8, kind="text", req=False, length="short", limit=280, resp=27,
       title="What would you like to see added or changed?",
       themes=[("More time for questions", 10, "Give Q&amp;A twenty minutes, not five."),
               ("Send the slides ahead", 7, "A pre-read the day before so we can come with questions."),
               ("A shorter roadmap section", 5, "The roadmap part could be half as long."),
               ("Breakouts by team", 3, "Ten minutes in teams to talk about what it means for us."),
               ("Other", 2, "")]),
]

KIND = {
  "rating": ("star", "Rating"), "nps": ("star", "Rating 0–10"),
  "choice": ("list", "Multiple choice"), "yesno": ("toggle", "Yes / No"),
  "rank": ("rank", "Ranking"), "text": ("text", "Open answer"),
}


def n_of(q):
    if "dist" in q:
        return sum(q["dist"])
    if q["kind"] == "nps" or q["kind"] == "yesno":
        return sum(q["split"])
    if q["kind"] == "choice" and not q.get("multi"):
        return sum(c for _, c in q["opts"])
    return q["resp"]


def mean(q):
    lo, _ = q["scale"]
    tot = sum((lo + i) * c for i, c in enumerate(q["dist"]))
    return tot / sum(q["dist"])


def nps(q):
    d, p, pr = q["split"]
    return round((pr - d) * 100 / (d + p + pr))


def pct(c, n):
    return round(c * 100 / n)


def check():
    for q in Q:
        n = n_of(q)
        assert 0 < n <= FINISHED + PARTWAY, (q["n"], n)
        if q["kind"] == "rank":
            k = len(q["items"])
            assert abs(sum(a for _, a, _ in q["items"]) - k * (k + 1) / 2) < 0.051, q["n"]
            assert sum(f for _, _, f in q["items"]) == q["resp"], q["n"]
        if q["kind"] == "text":
            assert sum(c for _, c, _ in q["themes"]) == q["resp"], q["n"]
        if q["kind"] == "choice" and q.get("multi"):
            assert all(c <= q["resp"] for _, c in q["opts"])
            assert sum(c for _, c in q["opts"]) <= q["resp"] * q["pick"]
    assert abs(mean(Q[0]) - 4.03) < 0.01
    assert nps(Q[1]) == 32


check()


def qr_svg(seed=7, n=29):
    """A deterministic QR-shaped pattern. Not a working code — a mockup."""
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


# --------------------------------------------------------------- names ----
# The owner, 2026-09-23: "i would like to collect names. this could be an
# option: anon, record just that they completed, attribute. name concisely."
# One setting, three values. The VALUE decides what gets WRITTEN, not what
# gets hidden afterwards (see 40-data-model).
NAMES = [
  ("anonymous", "Anonymous", "Nobody is recorded. The host sees totals and the words people write.",
   "<b>Anonymous.</b> Your host sees totals and the words you write &mdash; never who wrote them."),
  ("finished", "Who finished", "The host sees who finished, never what they answered.",
   "Your host sees <b>that you finished</b> &mdash; not what you answered."),
  ("named", "Named", "The host sees each person&rsquo;s name with their answers. The room never does.",
   "<b>Named.</b> Your host sees your name with your answers. The room and any shared results never do."),
]
NAMES_DEFAULT = "anonymous"

# When the survey OPENED (the trigger for the shared link's clock — the owner:
# "the trigger is opening not creating or viewing"). start-game.js already
# stamps the start and rewrites the TTL there, so this is that moment.
OPENED = "Tue 22 Sep, 2:10pm"
LINK_DAYS = 2
LINK_UNTIL = "Thu 24 Sep, 2:10pm"

# Named mode: the People tab. (name, status, finished, minutes)
PEOPLE = [
  ("Aisha Bello", "finished", "2:14pm", "3:10"),
  ("Aleksandra Wiśniewska", "finished", "2:15pm", "4:02"),
  ("Bartholomew Okonkwo-Fitzgerald", "finished", "2:16pm", "5:48"),
  ("Dana Whitfield", "partway", "—", "5 of 8"),
  ("Lee Chen", "finished", "2:13pm", "2:31"),
  ("Marcus Ola", "finished", "2:17pm", "2:50"),
  ("Priya Raghavan", "finished", "2:12pm", "2:05"),
  ("Sam Keller", "finished", "2:19pm", "6:11"),
  ("Tomás Ferreira", "not started", "—", "—"),
  ("Wes Duncan", "partway", "—", "2 of 8"),
]
