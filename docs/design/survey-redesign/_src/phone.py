# -*- coding: utf-8 -*-
"""The participant's phone: answering each kind, reviewing, finishing, and the
results a host shares back. Every page is the shipped player shell (bar /
stage / dock) with survey-phone.css on top."""
from build import phone_page, write
from content import Q, TITLE, SHORT, FINISHED, JOINED, pct, n_of, mean, nps, LINK_UNTIL

INFO = ('<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
        'stroke-width="2.2" stroke-linecap="round" aria-hidden="true">'
        '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.6v.1"/></svg>')
UP = ('<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
      '<path d="M12 20V5"/><path d="M6 11l6-6 6 6"/><path d="M4 3h16"/></svg>')
TOTAL = len(Q)


def sbar(i, who="Sam", done=None):
    """The player's bar, with the 4px phase strip doubling as progress."""
    p = f"{round((done if done is not None else i - 1) * 100 / TOTAL)}%"
    ctx = f"{i} of {TOTAL}" if i else "Survey"
    who_html = f'<span class="who"><span class="dot"></span>{who}</span>' if who else ""
    return (f'<header class="bar"><div class="strip prog" style="--p:{p}"></div>'
            f'<div class="line"><span class="ctx">{ctx}</span><span class="cat">{SHORT}</span>'
            f'<span class="spacer"></span>{who_html}</div></header>')


def dock(back=True, nxt="Next", note="Saved"):
    b = '<button class="btn ghost">Back</button>' if back else '<button class="btn ghost" disabled>Back</button>'
    return (f'<footer class="dock"><p class="saved"><i></i>{note}</p>'
            f'<div class="pair">{b}<button class="btn">{nxt}</button></div></footer>')


def build():
    q1, q2, q3, q4, q5, q6, q7, q8 = Q

    # --- rating --------------------------------------------------------------
    steps = "".join(
        f'<button class="step" role="radio" aria-checked="{"true" if v == 4 else "false"}" '
        f'aria-label="{v} of 5">{v}</button>' for v in range(1, 6))
    write("p-01-rating.html", phone_page("Survey 1 of 8 — rating", f"""
{sbar(1)}
<main class="stage">
  <p class="anon"><b>Anonymous.</b> Your host sees totals and the words you write &mdash; never who wrote them.</p>
  <p class="qno">Question 1 <span class="req">&middot; needs an answer</span></p>
  <h2 class="q">{q1['title']}</h2>
  <div class="scale" role="radiogroup" aria-label="From 1, {q1['low']}, to 5, {q1['high']}">{steps}</div>
  <div class="ends"><span>1 &middot; {q1['low']}</span><span>5 &middot; {q1['high']}</span></div>
</main>
{dock(back=False)}
""", phase=None), group="phone")

    # --- nps (0-10, optional, nothing chosen: Next reads Skip) ----------------
    steps = "".join(f'<button class="step" role="radio" aria-checked="false">{v}</button>' for v in range(0, 11))
    write("p-02-nps.html", phone_page("Survey 2 of 8 — rating 0 to 10", f"""
{sbar(2)}
<main class="stage">
  <p class="qno">Question 2 <span class="req">&middot; optional</span></p>
  <h2 class="q">{q2['title']}</h2>
  <div class="scale wrap" role="radiogroup" aria-label="From 0 to 10">{steps}</div>
  <div class="ends"><span>0 &middot; {q2['low']}</span><span>10 &middot; {q2['high']}</span></div>
</main>
{dock(nxt="Skip")}
"""), group="phone")

    # --- choice, pick up to two, with Other ----------------------------------
    rows = []
    picked = {"More time for questions", "Other"}
    for i, (t, _) in enumerate(q4["opts"]):
        on = "true" if t in picked else "false"
        if t == "Other":
            rows.append(f'<div class="opt other" role="checkbox" aria-checked="{on}"><span class="k sq"></span>'
                        f'<span>Something else</span><input class="inp" value="A one-page written summary afterwards" '
                        f'aria-label="Something else — say what"></div>')
        else:
            rows.append(f'<button class="opt" role="checkbox" aria-checked="{on}"><span class="k sq"></span>'
                        f'<span>{t}</span></button>')
    write("p-03-choice.html", phone_page("Survey 4 of 8 — pick up to two", f"""
{sbar(4)}
<main class="stage">
  <p class="qno">Question 4 <span class="req">&middot; optional</span></p>
  <h2 class="q">{q4['title']}</h2>
  <p class="rule-line">Pick up to <b>two</b> &middot; 2 of 2 picked. Untick one to change.</p>
  <div class="opts" role="group" aria-label="Pick up to two">{''.join(rows)}</div>
</main>
{dock()}
"""), group="phone")

    # --- yes / no / not sure with its follow-up ------------------------------
    write("p-04-yesno.html", phone_page("Survey 5 of 8 — yes or no", f"""
{sbar(5)}
<main class="stage">
  <p class="qno">Question 5 <span class="req">&middot; needs an answer</span></p>
  <h2 class="q">{q5['title']}</h2>
  <div class="yn three" role="radiogroup" aria-label="Yes, no or not sure">
    <button class="step" role="radio" aria-checked="false">Yes</button>
    <button class="step" role="radio" aria-checked="true">No</button>
    <button class="step" role="radio" aria-checked="false">Not sure</button>
  </div>
  <div class="follow">
    <label class="lab" for="fu">{q5['follow'][1]} <span class="req">&middot; optional</span></label>
    <textarea class="inp" id="fu">Cut the roadmap section in half and give that time to questions.</textarea>
    <p class="count">64 / 280</p>
  </div>
</main>
{dock()}
"""), group="phone")

    # --- ranking --------------------------------------------------------------
    placed = [("Customer stories", 1), ("Product roadmap", 2), ("Team wins", 3)]
    rows = "".join(
        f'<li class="placed"><span class="pl" aria-label="Place {p}">{p}</span><span class="it">{t}</span>'
        f'<span class="mv"><button aria-label="Move {t} up">&uarr;</button>'
        f'<button aria-label="Move {t} down">&darr;</button></span></li>' for t, p in placed)
    rest = "".join(
        f'<li class="unplaced"><span class="pl" aria-hidden="true"></span><span class="it">{t}</span></li>'
        for t in ("Culture &amp; hiring", "Financials"))
    write("p-05-rank.html", phone_page("Survey 6 of 8 — ranking", f"""
{sbar(6)}
<main class="stage">
  <p class="qno">Question 6 <span class="req">&middot; optional</span></p>
  <h2 class="q">{q6['title']}</h2>
  <p class="rule-line">Tap them in the order you&rsquo;d put them. <b>Your top three is enough.</b></p>
  <ol class="rank" aria-label="Your order">{rows}</ol>
  <p class="rank-h">Not placed &middot; tap to add</p>
  <ul class="rank">{rest}</ul>
</main>
{dock()}
"""), group="phone")

    # --- open answer -----------------------------------------------------------
    write("p-06-text.html", phone_page("Survey 7 of 8 — open answer", f"""
{sbar(7)}
<main class="stage">
  <p class="qno">Question 7 <span class="req">&middot; optional</span></p>
  <h2 class="q">{q7['title']}</h2>
  <div class="field">
    <label class="lab" for="a">Your answer</label>
    <textarea class="inp" id="a">Seeing the console actually run. Every slide about it before that was abstract, and the moment Dana clicked through the approval flow the whole pricing argument made sense. The renewal numbers on the case studies helped too.</textarea>
    <p class="count">231 / 500</p>
  </div>
</main>
{dock()}
"""), group="phone")

    # --- review and send ------------------------------------------------------
    ans = ["4 &middot; useful", None, "Live demo of the new console",
           "More time for questions; something else", "No &mdash; with a note", "Customer stories, Product roadmap, Team wins",
           "&ldquo;Seeing the console actually run&hellip;&rdquo;", None]
    items = []
    for q, a in zip(Q, ans):
        if a:
            items.append(f'<li><span class="n">{q["n"]}</span><span class="b"><span class="t">{q["title"]}</span>'
                         f'<span class="a">{a}</span></span><a class="ed" href="#">Change</a></li>')
        else:
            items.append(f'<li><span class="n">{q["n"]}</span><span class="b"><span class="t">{q["title"]}</span>'
                         f'<span class="a none">Skipped &mdash; optional</span></span><a class="ed" href="#">Answer</a></li>')
    write("p-07-review.html", phone_page("Survey — check and send", f"""
{sbar(0, done=8)}
<main class="stage">
  <h2 class="q">Check your answers</h2>
  <p class="lede muted" style="font-size:var(--L-body)">Two were optional and you skipped them. Anything can change until your host closes the survey.</p>
  <ol class="rev">{''.join(items)}</ol>
</main>
<footer class="dock"><p class="saved"><i></i>Everything is saved as you go</p>
  <div class="pair"><button class="btn ghost">Back</button><button class="btn">Send my answers</button></div></footer>
"""), group="phone")

    # --- done (rest volume: no dock, no amber) -------------------------------
    write("p-08-done.html", phone_page("Survey — sent", f"""
<header class="bar"><div class="strip"></div><div class="line"><span class="ctx">Sent</span><span class="cat">{SHORT}</span><span class="spacer"></span><span class="who"><span class="dot"></span>Sam</span></div></header>
<main class="stage centre">
  <h1 style="font-size:var(--L-primary)">Thanks, Sam &mdash; that&rsquo;s everything.</h1>
  <p class="lede muted">Your answers are in. You can still change them from here until the host closes the survey.</p>
  <p class="help" style="font-size:var(--L-body)"><a href="#" style="color:var(--text)">Change my answers</a></p>
  <div class="lookup">{UP}<div>When the survey closes, your host may put the results on the main screen &mdash; and send them to this page.</div></div>
</main>
""", volume="rest"), group="phone")

    # --- ended, with results shared back -------------------------------------
    write("p-09-ended.html", phone_page("Survey closed — results shared", f"""
<header class="bar"><div class="strip" style="background:var(--success)"></div><div class="line"><span class="ctx">Survey closed</span><span class="cat">{SHORT}</span><span class="spacer"></span><span class="who"><span class="dot"></span>Sam</span></div></header>
<main class="stage centre">
  <h1 style="font-size:var(--L-primary)">The results are in.</h1>
  <p class="lede muted">{FINISHED} of {JOINED} people answered. Your host has shared what the room said.</p>
  <div class="card"><p class="quote"><b>People came away with something to use &mdash; and want more room to talk back.</b></p>
    <p class="help" style="margin-top:8px">Workie&rsquo;s read of all {FINISHED} answers.</p></div>
</main>
<footer class="dock"><button class="btn">See the results</button>
  <p class="note" style="margin:10px 0 0">A page you can keep until {LINK_UNTIL}. Your own answers are marked on it from this phone only.</p></footer>
""", phase="var(--success)"), group="phone")

    # --- the shared results page ------------------------------------------------
    def dist(rows, you=None, top=None):
        out = []
        for label, c, n in rows:
            p = pct(c, n)
            cls = "dr top" if label == top else "dr"
            y = ' <span class="you">You</span>' if label == you else ""
            out.append(f'<div class="{cls}"><span class="fill" style="width:{p}%"></span><span>{label}{y}</span>'
                       f'<span class="v">{p}%</span></div>')
        return '<div class="dist">' + "".join(out) + "</div>"

    n1 = n_of(q1)
    def lbl(v):
        return f"{v}" + (" &middot; Very useful" if v == 5 else " &middot; Not useful" if v == 1 else "")
    r1 = dist([(lbl(v), c, n1) for v, c in zip(range(1, 6), q1["dist"])][::-1], you="4", top="4")
    n3 = n_of(q3)
    r3 = dist([(t, c, n3) for t, c in q3["opts"]], you="Live demo of the new console", top="Live demo of the new console")
    y, no, ns = q5["split"]; n5 = y + no + ns
    r5 = dist([("Yes", y, n5), ("No", no, n5), ("Not sure", ns, n5)], you="No", top="Yes")
    r6 = "".join(f'<div class="dr{" top" if i == 0 else ""}"><span style="font-weight:800;width:1.4em">{i + 1}</span>'
                 f'<span>{t}</span><span class="v" style="font-weight:600;color:var(--muted)">avg {a:.1f}</span></div>'
                 for i, (t, a, _) in enumerate(q6["items"]))
    th7 = "".join(f'<div class="theme"><div class="th">{t}<span class="c">{c} people</span></div>'
                  f'<p>&ldquo;{qt}&rdquo;</p></div>' for t, c, qt in q7["themes"] if qt)
    write("p-10-shared.html", phone_page("What the room said — shared results", f"""
<header class="bar"><div class="strip" style="background:var(--success)"></div><div class="line"><span class="ctx">Results</span><span class="cat">{SHORT}</span></div></header>
<main class="stage">
  <h1 style="font-size:var(--L-primary)">What the room said</h1>
  <p class="lede muted" style="font-size:var(--L-body)">{TITLE} &middot; 22 Sep 2026 &middot; {FINISHED} of {JOINED} answered. Shared by the host; nobody&rsquo;s name is on it.</p>
  <div class="wk"><p class="lab">Workie&rsquo;s read</p><p>Three in four found it useful (4 or 5 of 5), and the live demo is why. The clearest ask is more room to talk back: more time for questions, and the slides a day ahead.</p></div>

  <p class="sec-h">{q1['title']}</p>
  <div class="meanline"><span class="big">{mean(q1):.1f}</span><small>OUT OF 5 &middot; {n1} ANSWERS</small></div>
  {r1}

  <p class="sec-h">{q3['title']}</p><p class="sec-s">Pick one &middot; {n3} answers</p>
  {r3}

  <p class="sec-h">{q5['title']}</p><p class="sec-s">{n5} answers</p>
  {r5}

  <p class="sec-h">{q6['title']}</p><p class="sec-s">By average place &middot; {q6['resp']} answers</p>
  <div class="dist">{r6}</div>

  <p class="sec-h">{q7['title']}</p><p class="sec-s">{q7['resp']} answers, grouped by Workie &middot; one quote each, chosen by the host</p>
  {th7}
</main>
""", volume="rest", phase="var(--success)"), group="phone")
