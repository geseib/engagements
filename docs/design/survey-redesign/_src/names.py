# -*- coding: utf-8 -*-
"""Names: the one setting that decides what a survey records about people —
Anonymous, Who finished, Named — where it is chosen, what the phone says,
what the wall may show, and what the host gets. Plus the shared link's clock,
which starts when the survey OPENS."""
from build import console_page, phone_page, stage_page, board_page, frame, mk_anno, write, ico, anno
from content import (Q, TITLE, SHORT, CODE, JOINED, NAMES, NAMES_DEFAULT, OPENED, LINK_DAYS, LINK_UNTIL,
                     PEOPLE, qr_svg)
from phone import sbar, dock


def three(selected):
    out = []
    for key, label, host_line, _ in NAMES:
        on = "true" if key == selected else "false"
        out.append(f'<button role="radio" aria-checked="{on}"><b><i aria-hidden="true"></i>{label}</b><span>{host_line}</span></button>')
    return '<div class="sv-three" role="radiogroup" aria-label="Names">' + "".join(out) + "</div>"


def build():
    q1 = Q[0]

    # ------------------------------------------------ 07 start a survey -----
    body = f"""
    <div class="work-head"><div><h1>{TITLE}</h1><p class="sub">Survey &middot; 8 questions &middot; v2</p></div></div>
    <div class="work-body" style="filter:blur(1.5px);opacity:.45" aria-hidden="true"><div class="sv-card" style="height:420px"></div></div>
    <div class="scrim">
      <div class="modal sv-modal" style="width:min(760px,100%)">
        <header><div><h2>Start a survey session</h2>
          <p class="dim" style="margin:4px 0 0;font-size:var(--t-label)">{TITLE} &middot; v2 &middot; about 3 minutes to answer</p></div>
          <span style="flex:1"></span><button class="btn ghost sm" aria-label="Close">{ico('x')}</button></header>
        <div class="body">
          <p class="sv-sect">Responses</p>
          <div class="sv-card2">
            <div class="hd"><b>Names</b><span class="st">Who finished</span></div>
            {three("finished")}
            <p class="does">You will see a list of who finished and who stopped partway. Their answers are stored <b>apart from their names</b>, so nobody &mdash; you included &mdash; can match an answer to a person.</p>
            <div class="sv-pvs">
              <div class="sv-pv"><h6>What their phone says</h6><p>{NAMES[1][3]}</p></div>
              <div class="sv-pv"><h6>What you get</h6><p>&ldquo;Seeing the console actually run beat every slide about it.&rdquo;</p><p class="who">Response 12 &middot; no name</p>
                <p style="margin-top:10px">Priya Raghavan &middot; finished 2:12pm</p><p class="who">People list &middot; no answers</p></div>
            </div>
            <p class="limit">This hides names, not identities. In a small group, people may still recognise each other&rsquo;s answers.</p>
          </div>
          <p class="dim" style="font-size:var(--t-label);margin:-4px 0 0"><span class="sv-lock">{ico('lock')}Fixed once the survey opens</span> &mdash; people answer on the promise their phone made them. This set&rsquo;s default is <b style="color:var(--text)">Anonymous</b>; change the default in the set&rsquo;s Details.</p>

          <p class="sv-sect">After it closes</p>
          <dl class="sv-kv">
            <dt>Results link</dt><dd>Anyone with the link, for {LINK_DAYS} days from when the survey opens<small>Nothing is shared until you press Share. You can change both when you do.</small></dd>
            <dt>Workie&rsquo;s read</dt><dd>Written when you close it &middot; Dry Analyst, &lsquo;What we heard &mdash; survey&rsquo;</dd>
          </dl>
        </div>
        <footer><button class="btn">Cancel</button><span class="grow"></span><button class="btn primary">{ico('play')}Open the survey</button></footer>
      </div>
    </div>
{anno("Three values, named for what the host gets", "The owner: &lsquo;anon, record just that they completed, attribute. name concisely.&rsquo; One setting, <b>Names</b>: <b>Anonymous</b> &middot; <b>Who finished</b> &middot; <b>Named</b>. Each option says what the host ends up with, in one line.")}
{anno("The shipped card, one control wider", "This is GameSetupDialog's Responses card (<code>.gsd-opt</code>): the does-line, the two-panel preview and the limit line are kept word for word where they still hold. The checkbox becomes a three-way choice. The shipped card's 10.5px/11px captions are raised to the console's 12px floor.")}
{anno("The value decides what is written", "Not what is hidden later. Anonymous writes answers under a random id the phone made, with no name. Who finished writes those same nameless answers plus a separate who-finished list. Named writes answers under the person. See 40-data-model.")}
{anno("Locked when it opens", "Changing it mid-survey would break the promise each phone already showed. The set carries a default (Anonymous); a session can change it up to Open.")}
{anno("The link's clock starts here", "The owner: two days, and &lsquo;the trigger is opening, not creating or viewing.&rsquo; Open is the moment <code>start-game.js</code> already stamps (it rewrites the session TTL there), so the link's expiry is that stamp plus the window.")}
"""
    write("07-start-survey.html", console_page("Start a survey session", body, back="Question sets"), group="author")

    # ------------------------------------------------ phones: the promise ---
    steps = "".join(
        f'<button class="step" role="radio" aria-checked="{"true" if v == 4 else "false"}" aria-label="{v} of 5">{v}</button>'
        for v in range(1, 6))
    for fname, (key, label, _, line) in (("p-11-finished.html", NAMES[1]), ("p-12-named.html", NAMES[2])):
        write(fname, phone_page(f"Survey 1 of 8 — {label}", f"""
{sbar(1)}
<main class="stage">
  <p class="anon">{line}</p>
  <p class="qno">Question 1 <span class="req">&middot; needs an answer</span></p>
  <h2 class="q">{q1['title']}</h2>
  <div class="scale" role="radiogroup" aria-label="From 1 to 5">{steps}</div>
  <div class="ends"><span>1 &middot; {q1['low']}</span><span>5 &middot; {q1['high']}</span></div>
</main>
{dock(back=False)}
"""), group="phone")

    # ------------------------------------------------ the wall: who's left --
    waiting = [p for p in PEOPLE if p[1] != "finished"]
    roster = "".join(
        f'<li><span class="tick wait" aria-hidden="true">&#9675;</span><span class="nm">{n}</span>'
        f'<span class="sc">{"not started" if s == "not started" else m}</span></li>' for n, s, _, m in waiting)
    per = [36, 35, 34, 31, 30, 27, 24, 21]
    body = f"""
<main class="stage">
  <div class="field" aria-hidden="true"></div>
  <header class="rail"><span class="chip ask"><span class="dot"></span>Answering</span><span class="rail-title" data-drop="1">{TITLE}</span><span class="rail-ctx"><span>Survey</span><i>/</i><b>8 questions</b><span>about 3 min</span></span><div class="rail-join"><span data-drop="2">JOIN</span><span data-drop="3">engage.seibtribe.us/play</span><code>{CODE}</code></div></header><div class="bar" data-phase="ask" role="presentation"></div>
  <div class="main">
    <div class="content"><div class="fitbox center">
      <p class="stitle">Tell us how today went</p>
      <p class="ssub">Eight quick questions on your phone. Your host sees who finished &mdash; not what you answered.</p>
      <div class="joinblock" style="margin-top:calc(1.5vh + 6px)"><div class="qr">{qr_svg()}</div>
        <div class="joininfo"><span class="lbl">Scan, or go to</span><span class="url">engage.seibtribe.us/play</span>
          <span class="lbl">and enter</span><div class="code">{CODE}</div></div></div>
    </div></div>
    <aside class="meter"><h4>Finished</h4><div class="count"><span class="n">38</span><small> / {JOINED}</small></div>
      <div class="bar2"><i style="width:{round(38 * 100 / JOINED)}%"></i></div>
      <h4 style="margin-top:calc(1vh + 4px)">Still going</h4>
      <ul class="roster">{roster}</ul><div class="more">+ 1 more</div>
    </aside>
  </div>
  <footer class="dock"><button class="dock-more" type="button" aria-label="Session setup">&#8943;<span class="dock-more-lbl">Setup</span></button>
    <span class="status" aria-live="polite">38 finished &middot; 3 partway &middot; 1 not started</span><span class="spacer"></span>
    <button class="btn ghost" type="button" aria-pressed="true">Hide names</button><span class="kbd">SPACE</span>
    <button class="btn primary" type="button">Close the survey</button></footer>
</main>"""
    write("s-07-whos-left.html", stage_page("Survey collecting, who's left — stage", body), group="stage")

    # ------------------------------------------------ 33 people -------------
    rows = []
    for n, s, t, m in PEOPLE:
        cls = {"finished": "done", "partway": "part", "not started": "none"}[s]
        word = {"finished": "Finished", "partway": "Partway", "not started": "Not started"}[s]
        ans = f'<button class="btn sm">{ico("eye")}Answers</button>' if s != "not started" else '<span class="dim" style="font-size:var(--t-label)">&mdash;</span>'
        rows.append(f'<tr><td><span class="nm" title="{n}">{n}</span></td><td><span class="sv-status {cls}"><i></i>{word}</span></td>'
                    f'<td class="when">{t}</td><td class="num">{m}</td><td>{ans}</td></tr>')
    body = f"""
    <div class="work-head">
      <div style="min-width:0"><h1>{TITLE}</h1>
        <p class="sub">Survey &middot; 22 Sep 2026, 2:10&ndash;3:42pm &middot; closed &middot; <span class="sv-kind">{ico('users')}Names: Named</span></p></div>
      <span class="grow"></span>
      <div class="head-actions"><button class="btn">{ico('download')}CSV with names</button><button class="btn primary">{ico('share')}Share results</button></div>
    </div>
    <nav class="subnav"><button>Summary</button><button>Open answers <span class="dim">58</span></button><button aria-current="true">People <span class="dim">{JOINED}</span></button></nav>
    <div class="work-body">
      <div class="note-box">This survey was <b>Named</b>: you see each person&rsquo;s answers here and in the CSV. The wall, the shared link and the PDF never carry a name.</div>
      <div class="filters"><div class="search">{ico('search')}<input class="inp" placeholder="Find a person"></div>
        <div class="seg"><button aria-pressed="true">Everyone</button><button aria-pressed="false">Finished 38</button><button aria-pressed="false">Partway 3</button><button aria-pressed="false">Not started 1</button></div>
        <span class="count">Showing 10 of {JOINED}</span></div>
      <table class="tbl"><thead><tr><th>Name</th><th style="width:150px">Status</th><th style="width:110px">Finished</th><th class="num" style="width:110px">Time taken</th><th style="width:120px"></th></tr></thead>
        <tbody>{"".join(rows)}</tbody></table>
    </div>
{anno("Two of the three modes have a People tab", "<b>Who finished</b>: the same table without the Answers column &mdash; the answers were never stored against a name, so there is nothing to open. <b>Named</b>: Answers opens that person&rsquo;s eight answers in a dialog. <b>Anonymous</b>: no tab; the subnav says &lsquo;Each response&rsquo; and lists Response 1&hellip;41.")}
{anno("Names stop at the console", "Named means the host sees it. The wall walk-through, the featured quote, the shared link, Workie's prompt and the PDF are all built from counts and answer text, never from names, whatever this setting says.")}
{anno("Status is a word", "Finished, Partway, Not started &mdash; a word and a mark (filled, ring, dashed ring), never colour alone. &lsquo;Time taken&rsquo; for someone partway reads as how far they got.")}
"""
    write("33-people.html", console_page("Survey people — Named", body, nav="sessions", back="Sessions"), group="results")

    # ------------------------------------------------ 12 board ---------------
    body = f"""
<h1>Names: Anonymous, Who finished, Named</h1>
<p class="lede">One setting, chosen when the survey is started (07) and fixed once it opens. The phone says which promise applies on the first question; the wall shows names only in the two recorded modes, and only when the host asks.</p>
<div class="row">
{frame("p-01-rating.html", 390, 844, 0.72, "<b>Anonymous</b><span>The default. Nobody is recorded.</span>")}
{frame("p-11-finished.html", 390, 844, 0.72, "<b>Who finished</b><span>Completion recorded; answers kept apart</span>")}
{frame("p-12-named.html", 390, 844, 0.72, "<b>Named</b><span>The host sees names with answers</span>")}
</div>
<h2>The wall, near the end of a Who finished survey</h2>
<div class="row">{frame("s-07-whos-left.html", 1920, 1080, 0.5, "<b>Still going, on request</b><span>Names appear only when the host presses Show names; never in Anonymous</span>", "stage")}</div>"""
    notes = "".join([
        mk_anno("The phone says it first", "The line above question 1 is the promise, in the player's existing anonymity style (<code>.anon</code>). It changes with the setting, word for word from 07's preview, so what the host chose and what the room was told cannot drift."),
        mk_anno("Who's left, on request", "The stage's meter already &lsquo;names who's still waiting on demand&rsquo; (<code>RoomMeter.jsx</code>). A survey keeps that rule: in Who finished and Named the host can show the not-yet-finished names to chase stragglers; in Anonymous there are no names to show."),
        mk_anno("Never on the wall with an answer", "Even in Named, the wall pairs a name only with a status, never with what the person said."),
    ])
    write("12-names.html", board_page("Names — survey", body, notes), group="board")
