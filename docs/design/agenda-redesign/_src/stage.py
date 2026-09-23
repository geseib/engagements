# -*- coding: utf-8 -*-
"""The wall. Doors open (the day's agenda and the one code), a presentation
with the host's dock, the screen between items, and the moment the host
starts an engagement. Built on the audited stage; Room profile, 1920x1080."""
from build import stage_page, write, ICONS
from content import TITLE, CODE, URL, ITEMS, TYPES, ENDS, AGENDA, BREAK, DAY, qr_svg


def svg(name):
    return (f'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" '
            f'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{ICONS[name]}</svg>')


def rail(chip, title, ctx, join=True):
    j = (f'<div class="rail-join"><span data-drop="2">JOIN</span><span data-drop="3">{URL}</span>'
         f'<code>{CODE}</code></div>') if join else ""
    return (f'<header class="rail"><span class="chip lobby"><span class="dot"></span>{chip}</span>'
            f'<span class="rail-title" data-drop="1">{title}</span><span class="rail-ctx">{ctx}</span>{j}</header>'
            f'<div class="bar" data-phase="lobby" role="presentation"></div>')


def wall_list(items, states, max_rows=7):
    """At most max_rows rows; the rest are counted in a final line, never
    clipped silently (hard rule 7: a reduction with no recovery is a deletion)."""
    rows = []
    shown, rest = items[:max_rows], items[max_rows:]
    if len(rest) == 1:
        shown, rest = items, []
    for it in shown:
        st = states.get(it["n"], "")
        word = {"done": "Done", "now": "Now", "first": "First"}.get(st, "")
        label = TYPES[it["type"]][1] + (f' &middot; {it["who"]}' if it.get("who") else "")
        if it["type"] == "break":
            label = f'Back at {it["until"]}'
        cls = {"done": "done", "now": "now", "first": "now"}.get(st, "")
        rows.append(f'<li class="{cls}"><span class="at">{it["at"]}</span><div><div class="tt">{it["title"]}</div>'
                    f'<span class="ty">{label}</span></div><span class="st">{word}</span></li>')
    if rest:
        rows.append(f'<li class="more"><span class="at"></span><div><div class="tt">and {len(rest)} more, until {rest[-1]["until"]}</div></div><span class="st"></span></li>')
    return f'<ol class="ag-wl">{"".join(rows)}</ol>'


def joinblock(lbl1="Open on your phone", lbl2="Event code"):
    return (f'<div class="joinblock"><div class="qr">{qr_svg()}</div><div class="joininfo">'
            f'<div class="lbl">{lbl1}</div><div class="url">{URL}</div><div class="lbl">{lbl2}</div>'
            f'<div class="code">{CODE}</div></div></div>')


LOCK = '<p class="ag-lockline"><span><b>Invite only.</b> You&rsquo;ll also need your personal passcode.</span></p>'


def dock(status, primary, kbd="SPACE", extra="", go=True):
    return (f'<footer class="dock"><button class="dock-more" type="button" aria-label="Event setup">&#8943;'
            f'<span class="dock-more-lbl">Setup</span></button><span class="status{" go" if go else ""}" aria-live="polite">{status}</span>'
            f'<span class="spacer"></span>{extra}<span class="kbd">{kbd}</span><button class="btn" type="button">{primary}</button></footer>')


def build():
    # ------------------------------------------------------------ s-01 doors --
    body = f"""
<main class="stage">
  <div class="field" aria-hidden="true"></div>
  {rail("Starting soon", "Northwind Traders", f'<span>Ends</span><b>{ENDS}</b>', join=False)}
  <div class="main">
    <div class="content"><div class="fitbox center">
      <h1 class="ag-title">{TITLE}</h1>
      <p class="ag-date">Thursday 9 October</p>
      <div style="height:calc(1vh + 4px)"></div>
      {joinblock()}
      {LOCK}
    </div></div>
    <aside class="ag-wall"><h4>Today</h4>{wall_list(AGENDA, {1: "first"})}</aside>
  </div>
  {dock("12 of 42 are in", "Start the survey")}
</main>"""
    write("s-01-doors.html", stage_page("Doors open — stage", body), group="stage")

    # ------------------------------------------------------------ s-02 presenting
    # Owner, 23 Sep (decision 8): slides are presented from the presenter's own
    # presentation mode. Engage never shows or drives them. When a presentation
    # item is current and the projector is still on Engage, the stage holds.
    it2 = ITEMS[1]
    it3 = ITEMS[2]
    body = f"""
<main class="stage">
  <div class="field" aria-hidden="true"></div>
  {rail("Presenting", TITLE, '<b>2</b><span>of 8</span>', join=False)}
  <div class="main">
    <div class="content"><div class="fitbox center"><div class="ag-up">
      <h2 class="q">{it2['title']}</h2>
      <p class="ag-who">{it2['who']}</p>
      <p class="qdetail">The slides are on the presenter&rsquo;s own screen. A copy is on your phone.</p>
      {joinblock("Just arrived? Open", "Event code")}
    </div></div></div>
    <aside class="ag-wall"><h4>Coming up</h4>{wall_list(AGENDA[2:5], {})}</aside>
  </div>
  {dock("Planned to end at 9:38", "Start trivia", go=False)}
</main>"""
    write("s-02-presenting.html", stage_page("Now presenting — stage", body), group="stage")

    # ------------------------------------------------------------ s-03 between --
    it3 = ITEMS[2]
    body = f"""
<main class="stage">
  <div class="field" aria-hidden="true"></div>
  {rail("Between items", TITLE, '<b>2</b><span>of 8 done</span>', join=False)}
  <div class="main">
    <div class="content"><div class="fitbox center"><div class="ag-up">
      <p class="ty">{svg('trivia')}Trivia &middot; next</p>
      <h2 class="q">{it3['title']}</h2>
      <p class="qdetail">Ten questions. Read them up here, answer on your phone &mdash; faster right answers score more.</p>
      {joinblock("Just arrived? Open", "Event code")}
    </div></div></div>
    <aside class="ag-wall"><h4>Later today</h4>{wall_list(AGENDA[3:], {})}</aside>
  </div>
  {dock("36 phones are following", "Start trivia")}
</main>"""
    write("s-03-between.html", stage_page("Between items — stage", body), group="stage")

    # ------------------------------------------------------------ s-04 trigger --
    body = f"""
<main class="stage" style="--rv:1.4s">
  <div class="field" aria-hidden="true"></div>
  {rail("Lobby", it3['title'], '<span>Trivia</span><i>/</i><b>10 questions</b>')}
  <div class="main">
    <div class="content"><div class="fitbox center">
      <div class="kicker">How this works</div>
      <ol class="howto" style="margin:0;padding:0">
        <li><b>1</b><span>Read each question up here.</span></li>
        <li><b>2</b><span>Tap your answer on your phone.</span></li>
        <li><b>3</b><span>Right and fast scores most.</span></li>
      </ol>
    </div></div>
    <aside class="meter"><h4>Phones in</h4><div class="count"><span class="n tick">31</span><small> / 36</small></div>
      <div class="bar2"><i style="width:86%"></i></div></aside>
  </div>
  <div class="wipe ag-go" role="status">Trivia<small>Your phone has switched &mdash; <b>no code needed</b></small></div>
  {dock("Ready when you are", "Start question 1")}
</main>"""
    # MOCKUP ONLY: the wipe plays once for 1.4 s and is gone (refresh-stage.css
    # section 1). A still page would show nothing, so it is held at its fully
    # visible frame here. Not a product rule.
    hold = '<style>.wipe.ag-go{animation-delay:-.45s;animation-play-state:paused}</style>'
    write("s-04-trigger.html", stage_page("Starting an engagement — stage", body + hold), group="stage")

    # ------------------------------------------------------------ s-05 break --
    # Decision 7: a break is listed, not counted; the wall shows a countdown
    # to its planned return. Decision 6: the day's standings, once something
    # has been scored, on the between-items screens.
    nxt = AGENDA[AGENDA.index(BREAK) + 1]
    rows = "".join(f'<li><span class="ag-rk">{i + 1}</span><span class="nm">{nm}</span><span class="sc">{a + b:,}</span></li>'
                   for i, (nm, a, b) in enumerate(DAY))
    body = f"""
<main class="stage">
  <div class="field" aria-hidden="true"></div>
  {rail("Break", TITLE, '<b>4</b><span>of 8 done</span>')}
  <div class="main">
    <div class="content"><div class="fitbox center"><div class="ag-up">
      <p class="ty">{svg('clock')}Back at {BREAK['until']}</p>
      <p class="ag-count" role="timer" aria-label="12 minutes 40 seconds until 10:28">12:40</p>
      <p class="qdetail">{BREAK['desc']} Next: <b>{nxt['title']}</b> &middot; {nxt['who']}.</p>
    </div></div></div>
    <aside class="ag-wall"><h4>The day so far</h4><ol class="ag-rank">{rows}</ol>
      <p class="ag-rnote">Trivia and Call &amp; Answer points, added up. Your own place is on your phone.</p></aside>
  </div>
  <footer class="dock"><button class="dock-more" type="button" aria-label="Event setup">&#8943;<span class="dock-more-lbl">Setup</span></button>
    <span class="status" aria-live="polite">Counting down to the planned return</span><span class="spacer"></span>
    <button class="btn ghost" type="button">+5 min</button><span class="kbd">SPACE</span>
    <button class="btn" type="button">Start {nxt['title']}</button></footer>
</main>"""
    write("s-05-break.html", stage_page("A break — stage", body), group="stage")

    # ------------------------------------------------------------ s-06 rehearsal
    # Decision 9: the session-setup design's Preview (a view of a not-yet-open
    # thing, joins refused), for a whole event. Nothing is stored or billed.
    body = f"""
<main class="stage">
  <div class="field" aria-hidden="true"></div>
  <header class="rail"><span class="chip lobby ag-rehearse"><span class="dot"></span>Rehearsal</span>
    <span class="rail-title" data-drop="1">Northwind Traders</span><span class="rail-ctx"><span>Ends</span><b>{ENDS}</b></span></header>
  <div class="bar" data-phase="rehearse" role="presentation"></div>
  <div class="main">
    <div class="content"><div class="fitbox center">
      <p class="kicker ag-rh">Rehearsal &middot; the doors are closed, nobody can join</p>
      <h1 class="ag-title">{TITLE}</h1>
      <p class="ag-date">Thursday 9 October</p>
      <div style="height:calc(1vh + 4px)"></div>
      {joinblock()}
      {LOCK}
    </div></div>
    <aside class="ag-wall"><h4>Today</h4>{wall_list(AGENDA, {1: "first"})}</aside>
  </div>
  <footer class="dock"><button class="dock-more" type="button" aria-label="Event setup">&#8943;<span class="dock-more-lbl">Setup</span></button>
    <span class="status" aria-live="polite">Rehearsal: nothing is saved, counted or billed</span><span class="spacer"></span>
    <button class="btn ghost" type="button">End rehearsal</button><span class="kbd">&rarr;</span>
    <button class="btn" type="button">Step to item 1 &rsaquo;</button></footer>
</main>"""
    write("s-06-rehearsal.html", stage_page("Rehearsal — stage", body), group="stage")
