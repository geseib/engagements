# -*- coding: utf-8 -*-
"""The wall. A survey collecting (self-paced), then the host walking the room
through its results one question at a time — which is also exactly what a
POLL's results look like, because a poll is the same five kinds, host-paced."""
from build import stage_page, write
from content import Q, TITLE, CODE, JOINED, FINISHED, PARTWAY, pct, n_of, mean, qr_svg

RAIL_JOIN = (f'<div class="rail-join"><span data-drop="2">JOIN</span>'
             f'<span data-drop="3">engage.seibtribe.us/play</span><code>{CODE}</code></div>')


def rail(chip, chip_cls, ctx):
    return (f'<header class="rail"><span class="chip {chip_cls}"><span class="dot"></span>{chip}</span>'
            f'<span class="rail-title" data-drop="1">{TITLE}</span>'
            f'<span class="rail-ctx">{ctx}</span>{RAIL_JOIN}</header>')


def walk_dock(i, status="Walking the room through the results"):
    return (f'<footer class="dock"><button class="dock-more" type="button" aria-label="Session setup">&#8943;'
            f'<span class="dock-more-lbl">Setup</span></button><span class="status" aria-live="polite">{status}</span>'
            f'<span class="spacer"></span><button class="btn ghost" type="button">Previous</button>'
            f'<span class="kbd">SPACE</span><button class="btn primary" type="button">'
            f'{"Next result" if i < 8 else "What we heard"}</button></footer>')


def results_page(fname, title, q, content, meter=""):
    ctx = f'<span>Survey</span><i>/</i><b>Question {q["n"]}</b><span>of {len(Q)}</span>'
    main_cls = "main" if meter else "main solo"
    body = f"""
<main class="stage" style="--rv:.15s">
  <div class="field alpenglow" aria-hidden="true"></div>
  {rail("Results", "results", ctx)}<div class="bar" data-phase="results" role="presentation"></div>
  <div class="{main_cls}">
    <div class="content"><div class="fitbox">{content}</div></div>
    {meter}
  </div>
  {walk_dock(q["n"])}
</main>"""
    write(fname, stage_page(title, body), group="stage")


def build():
    q1, q2, q3, q4, q5, q6, q7, q8 = Q

    # --- collecting -----------------------------------------------------------
    per = [36, 35, 34, 31, 30, 27, 24, 21]   # answered so far, per question
    rows = "".join(
        f'<div class="r"><span>Q{q["n"]}</span><span class="t"><i style="width:{round(c * 100 / JOINED)}%"></i></span>'
        f'<span class="v">{c} / {JOINED}</span></div>' for q, c in zip(Q, per))
    body = f"""
<main class="stage">
  <div class="field" aria-hidden="true"></div>
  {rail("Answering", "ask", '<span>Survey</span><i>/</i><b>8 questions</b><span>about 3 min</span>')}<div class="bar" data-phase="ask" role="presentation"></div>
  <div class="main">
    <div class="content"><div class="fitbox center">
      <p class="stitle">Tell us how today went</p>
      <p class="ssub">Eight quick questions on your phone. Anonymous &mdash; the host sees totals and words, never names.</p>
      <div class="joinblock" style="margin-top:calc(1.5vh + 6px)"><div class="qr">{qr_svg()}</div>
        <div class="joininfo"><span class="lbl">Scan, or go to</span><span class="url">engage.seibtribe.us/play</span>
          <span class="lbl">and enter</span><div class="code">{CODE}</div></div></div>
    </div></div>
    <aside class="meter"><h4>Finished</h4><div class="count"><span class="n">21</span><small> / {JOINED}</small></div>
      <div class="bar2"><i style="width:{round(21 * 100 / JOINED)}%"></i></div>
      <h4 style="margin-top:calc(1vh + 4px)">Answered, by question</h4>
      <div class="sprog">{rows}</div>
    </aside>
  </div>
  <footer class="dock"><button class="dock-more" type="button" aria-label="Session setup">&#8943;<span class="dock-more-lbl">Setup</span></button>
    <span class="status" aria-live="polite">21 finished &middot; 15 partway &middot; 6 not started</span><span class="spacer"></span>
    <button class="btn ghost" type="button">Two-minute warning</button><span class="kbd">SPACE</span>
    <button class="btn primary" type="button">Close the survey</button></footer>
</main>"""
    write("s-01-collecting.html", stage_page("Survey collecting — stage", body), group="stage")

    # --- choice (pick one) ---------------------------------------------------
    n3 = n_of(q3)
    top = max(c for _, c in q3["opts"])
    opts = []
    for i, (t, c) in enumerate(q3["opts"]):
        p = pct(c, n3)
        is_top = c == top
        cls = "opt most hero-row" if is_top else "opt dim"
        flag = '<span class="flag most">Most picked</span>' if is_top else ""
        opts.append(f'<div class="{cls}"><span class="fill" style="width:{p}%"></span><span class="ltr">{"ABCDE"[i]}</span>'
                    f'<span class="txt">{t}</span>{flag}<span class="pct">{p}%<small>{c}</small></span></div>')
    results_page("s-02-choice.html", "Survey results · multiple choice — stage", q3,
                 f'<p class="recap">{q3["title"]}</p><div class="opts list">{"".join(opts)}</div>'
                 f'<p class="rule-note">Pick one &middot; {n3} answered</p>')

    # --- rating ---------------------------------------------------------------
    n1 = n_of(q1)
    mx = max(q1["dist"])
    cols = "".join(f'<div class="c{" top" if c == mx else ""}"><em>{pct(c, n1)}%</em>'
                   f'<i style="height:{round(c * 100 / mx)}%"></i></div>' for c in q1["dist"])
    results_page("s-03-rating.html", "Survey results · rating — stage", q1, f"""
<p class="recap">{q1['title']}</p>
<div class="srate" style="--n:5">
  <div class="mean"><span class="hero">{mean(q1):.1f}</span><span class="of">out of 5</span>
    <span class="n">{n1} answered &middot; {pct(q1['dist'][3] + q1['dist'][4], n1)}% said 4 or 5</span></div>
  <div><div class="hist" style="--n:5">{cols}</div>
    <div class="histx" style="--n:5"><span>1</span><span>2</span><span>3</span><span>4</span><span>5</span></div>
    <div class="histends"><span>{q1['low']}</span><span>{q1['high']}</span></div></div>
</div>""")

    # --- yes / no ---------------------------------------------------------------
    y, no, ns = q5["split"]; n5 = y + no + ns
    results_page("s-04-yesno.html", "Survey results · yes / no — stage", q5, f"""
<p class="recap">{q5['title']}</p>
<div class="syn">
  <div class="split" role="img" aria-label="Yes {pct(y, n5)} percent, no {pct(no, n5)} percent, not sure {pct(ns, n5)} percent">
    <i class="yes" style="flex:{y}">{pct(y, n5)}% <small>Yes</small></i>
    <i class="no" style="flex:{no}">{pct(no, n5)}% <small>No</small></i>
    <i class="ns" style="flex:{ns}" title="Not sure {pct(ns, n5)}%">{pct(ns, n5)}%</i></div>
  <p class="rule-note">{n5} answered &middot; Not sure {pct(ns, n5)}%</p>
  <div class="why"><div><h5>{q5['follow'][1]} &mdash; {no - 2} of {no} who said No wrote why</h5>
    <div class="arr"><p class="ans">Cut the roadmap section in half and give that time to questions.</p></div>
    <div class="arr"><p class="ans">Too long for a Tuesday afternoon. 30 minutes would have done it.</p></div></div>
  <div><h5>&nbsp;</h5><div class="arr"><p class="ans">Needed longer on the demo, less on hiring.</p></div>
    <div class="arr"><p class="ans">Add ten minutes of breakouts and it would be the right length.</p></div></div></div>
</div>""")

    # --- ranking ------------------------------------------------------------------
    cards = []
    for i, (t, a, first) in enumerate(q6["items"]):
        lead = " lead" if i == 0 else ""
        cards.append(f'<div class="card{lead}"><span class="fill" style="width:{round((5 - a) * 100 / 4)}%"></span>'
                     f'<span class="rank">{i + 1}</span><div class="body"><div class="ans" style="font-size:var(--t-secondary)">{t}</div>'
                     f'<span class="who">Put first by {first} of {q6["resp"]}</span></div>'
                     f'<span class="avg"><b>{a:.1f}</b>average place</span></div>')
    results_page("s-05-rank.html", "Survey results · ranking — stage", q6,
                 f'<p class="recap">{q6["title"]}</p><div class="cards">{"".join(cards)}</div>')

    # --- open answer: themes + the featured quote --------------------------------
    n7 = q7["resp"]
    mxc = max(c for _, c, _ in q7["themes"])
    th = "".join(
        f'<div class="card{" lead" if c == mxc else ""}"><span class="fill" style="width:{round(c * 100 / n7)}%"></span>'
        f'<div class="body"><div class="ans">{t}</div></div>'
        f'<span class="tally">{c}<small>people</small></span></div>'
        for t, c, qt in q7["themes"][:4])
    results_page("s-06-themes.html", "Survey results · open answer — stage", q7, f"""
<p class="recap">{q7['title']} <span class="rule-note">&middot; {n7} answers, grouped by Workie</span></p>
<div class="cards">{th}</div>
<blockquote class="featured"><p class="say">&ldquo;Seeing the console actually run beat every slide about it.&rdquo;</p>
  <footer><span class="on">Chosen by the host &middot; names never go on the wall</span></footer></blockquote>""")
