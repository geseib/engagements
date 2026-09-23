# -*- coding: utf-8 -*-
"""After it closes: the results in the console, Workie's read, one open-answer
question in full, sharing the results back, and the paper report."""
from build import console_page, paper_page, write, ico, anno
from content import Q, KIND, TITLE, JOINED, FINISHED, PARTWAY, pct, n_of, mean, nps, qr_svg, OPENED, LINK_UNTIL
from author import kind_chip

WORKIE_LEAD = "People came away with something to use &mdash; and want more room to talk back."
WORKIE_P = ("Three in four rated the session useful (4 or 5 of 5), and the live demo is the reason they give most: "
            "it was picked as the most valuable part by more than a third, and it is the biggest theme in what people "
            "wrote. The length split the room less than the recommend score suggests &mdash; most of the eleven who said "
            "&lsquo;too long&rsquo; want the same forty minutes spent differently, not fewer of them.")
NEXT = ["Give questions twenty minutes, not five &mdash; it is the top format ask (61%) and the top written one.",
        "Send the deck the day before. Twelve asked for it outright; it also answers most of the &lsquo;cut the roadmap&rsquo; notes.",
        "Keep a live demo in every all-hands. Nothing else scored like it."]
CAVEAT = (f"{FINISHED} of {JOINED} finished; three stopped partway and their answers are counted where they gave them. "
          "Question 8 had 27 answers. Themes are Workie&rsquo;s grouping &mdash; read the answers before quoting one.")


def bars(rows, n, sub=None, top_label=None):
    out = []
    for label, c in rows:
        p = pct(c, n)
        top = " is-top" if label == top_label else ""
        tag = '<span class="sv-tag">Most picked</span>' if label == top_label else ""
        out.append(f'<div class="sv-bar{top}"><span class="l" title="{label}">{label}{tag}</span>'
                   f'<span class="t"><i style="width:{p}%"></i></span><span class="v">{p}%<small>{c}</small></span></div>')
    return '<div class="sv-bars">' + "".join(out) + "</div>"


def result_card(q, note=None, wide=False, acts=True):
    k = q["kind"]
    n = n_of(q)
    if k == "rating":
        mx = max(q["dist"])
        cols = "".join(f'<div class="c{" is-top" if c == mx else ""}"><em>{c}</em><i style="height:{round(c * 100 / mx)}%"></i></div>' for c in q["dist"])
        body = (f'<div class="sv-rate"><div class="sv-mean"><b>{mean(q):.1f}</b><span>out of 5 &middot; mean</span>'
                f'<em>{pct(q["dist"][3] + q["dist"][4], n)}% said 4 or 5</em></div>'
                f'<div><div class="sv-hist" style="--n:5">{cols}</div><div class="sv-histx" style="--n:5"><span>1</span><span>2</span><span>3</span><span>4</span><span>5</span></div>'
                f'<div class="sv-ends"><span>{q["low"]}</span><span>{q["high"]}</span></div></div></div>')
    elif k == "nps":
        d, p_, pr = q["split"]
        body = (f'<div class="sv-rate"><div class="sv-mean"><b>+{nps(q)}</b><span>recommend score</span><em>&minus;100 to +100</em></div>'
                f'<div><div class="sv-split" role="img" aria-label="Detractors {pct(d, n)}%, passives {pct(p_, n)}%, promoters {pct(pr, n)}%">'
                f'<i class="det" style="flex:{d}">{pct(d, n)}%</i><i class="pas" style="flex:{p_}">{pct(p_, n)}%</i><i class="pro" style="flex:{pr}">{pct(pr, n)}%</i></div>'
                f'<div class="sv-legend"><span><i style="background:var(--danger)"></i><b>0&ndash;6</b> would not ({d})</span>'
                f'<span><i style="background:#8A96AB"></i><b>7&ndash;8</b> maybe ({p_})</span><span><i style="background:var(--success)"></i><b>9&ndash;10</b> would ({pr})</span></div></div></div>')
    elif k == "choice":
        rows = [(t, c) for t, c in q["opts"]]
        top = max(rows, key=lambda r: r[1])[0]
        body = bars(rows, n, top_label=top)
        if q.get("multi"):
            body += f'<p class="sv-foot">Pick up to {q["pick"]} &middot; shares are of the {n} people who answered, so they add to more than 100%. <a href="#" style="color:var(--text)">3 write-ins</a></p>'
    elif k == "yesno":
        y, no, ns = q["split"]
        body = (f'<div class="sv-split" role="img" aria-label="Yes {pct(y, n)}%, no {pct(no, n)}%, not sure {pct(ns, n)}%">'
                f'<i class="yes" style="flex:{y}">Yes {pct(y, n)}%</i><i class="no" style="flex:{no}">No {pct(no, n)}%</i><i class="ns" style="flex:{ns}">{pct(ns, n)}%</i></div>'
                f'<div class="sv-legend"><span><b>{y}</b> yes</span><span><b>{no}</b> no</span><span><b>{ns}</b> not sure</span></div>'
                f'<ul class="sv-quotes"><li>Cut the roadmap section in half and give that time to questions.<small>said No</small></li>'
                f'<li>Too long for a Tuesday afternoon. 30 minutes would have done it.<small>said No &middot; <a href="#" style="color:var(--text)">7 more reasons</a></small></li></ul>')
    elif k == "rank":
        rows = []
        for i, (t, a, first) in enumerate(q["items"]):
            # where it landed: firsts, then an even-ish spread of the rest (drawn, not computed)
            rest = q["resp"] - first
            seg = [first] + [round(rest * w) for w in ((0.35, 0.3, 0.2, 0.15) if i < 2 else (0.15, 0.2, 0.3, 0.35))]
            strip = "".join(f'<i class="p{j + 1}" style="flex:{s}"></i>' for j, s in enumerate(seg) if s)
            rows.append(f'<div class="r"><span class="p">{i + 1}</span><span class="l">{t}</span>'
                        f'<span class="strip" title="Where people put it, 1st to 5th">{strip}</span><span class="v"><b>{a:.1f}</b> avg</span></div>')
        body = f'<div class="sv-rank">{"".join(rows)}</div><p class="sv-foot">By average place &middot; the strip is where people put it, 1st (amber) to 5th.</p>'
    else:
        themes = "".join(f'<div class="sv-theme"><div class="h"><b>{t}</b><span class="t"><i style="width:{pct(c, n)}%"></i></span><span class="c">{c}</span></div>'
                         + (f'<q>{qt}</q>' if qt else "") + "</div>" for t, c, qt in q["themes"][:4])
        body = f'<div class="sv-themes">{themes}</div><p class="sv-foot">{n} answers, grouped by Workie. <a href="31-open-text.html" style="color:var(--text)">Read all {n}</a></p>'
    note_html = f'<p class="note"><b>Workie:</b> {note}</p>' if note else ""
    act = ""
    if acts:
        act = f'<div class="acts"><button class="btn sm">{ico("play")}Show on the wall</button><button class="btn sm ghost">Hide from shared results</button></div>'
    cls = "sv-res wide" if wide else "sv-res"
    req = "" if q["req"] else " &middot; optional"
    return (f'<section class="{cls}"><header><div class="hd"><span class="n">Q{q["n"]}</span>{kind_chip(q["kind"])}'
            f'<span class="grow"></span><span class="cnt">{n} answered{req}</span></div><h3>{q["title"]}</h3></header>'
            f'<div class="body">{body}{note_html}{act}</div></section>')


NOTES = {1: "Mostly 4s and 5s. The six 3s are the ones worth a follow-up; none wrote an answer to Q7.",
         2: "+32 is good for an internal session. Sixteen percent would not recommend it &mdash; five of the six also said it was too long.",
         3: "The demo beat the customer stories, but only just; together they are two thirds of the room.",
         4: "Questions and breakouts both clear 45%. They are the same ask: room to respond.",
         5: "Of the eleven Nos, eight want time moved, not removed.",
         6: "Customer stories and roadmap are nearly tied for first. Financials is last for almost everyone.",
         7: "The demo again, in people&rsquo;s own words.",
         8: "Matches Q4: time for questions, and slides ahead."}


def build():
    # ------------------------------------------------------------ 30 results ---
    cards = "\n".join(result_card(q, NOTES[q["n"]], wide=False) for q in Q)
    workie = f"""
      <section class="sv-workie">
        <header><h2>{ico('sparkle')}Workie&rsquo;s read</h2><span class="dim" style="font-size:var(--t-label)">of all {FINISHED + PARTWAY} responses</span><span class="grow"></span>
          <label class="dim" style="font-size:var(--t-label)">Voice</label><select class="inp"><option>Adapt to the session</option><option selected>Dry Analyst</option></select>
          <label class="dim" style="font-size:var(--t-label)">Approach</label><select class="inp"><option selected>What we heard &mdash; survey</option><option>Lessons learned</option></select></header>
        <div class="body">
          <div><p class="lead">{WORKIE_LEAD}</p><p>{WORKIE_P}</p></div>
          <div><h4>What to do next</h4><ol>{"".join(f"<li>{x}</li>" for x in NEXT)}</ol>
            <p class="caveat">{CAVEAT}</p></div>
        </div>
        <footer><div class="sv-steer"><input class="inp" placeholder="Steer it: &lsquo;focus on what the sales team said&rsquo;"><button class="btn sm">{ico('refresh')}Redo</button></div>
          <span class="grow"></span><button class="btn sm">{ico('pencil')}Edit the words</button>
          <label class="sv-switch" style="font-size:var(--t-label)"><input type="checkbox" checked>In shared results and the PDF</label></footer>
      </section>"""
    body = f"""
    <div class="work-head">
      <div style="min-width:0"><h1>{TITLE}</h1>
        <p class="sub">Survey &middot; 22 Sep 2026, 2:10&ndash;3:42pm &middot; closed by George &middot; set v2 &middot; <span class="sv-kind">{ico('users')}Names: Anonymous</span></p>
        <div class="sv-head-kpis"><div class="sv-kpi"><b>{FINISHED}</b><span>finished of {JOINED} who joined</span></div>
          <div class="sv-kpi"><b>{PARTWAY}</b><span>stopped partway &mdash; counted</span></div>
          <div class="sv-kpi"><b>2:50</b><span>median time to finish</span></div></div></div>
      <span class="grow"></span>
      <div class="head-actions"><button class="btn">{ico('play')}Walk the room through it</button>
        <button class="btn">{ico('download')}CSV</button><button class="btn">{ico('file')}Save PDF</button>
        <button class="btn primary">{ico('share')}Share results</button></div>
    </div>
    <nav class="subnav"><button aria-current="true">Summary</button><button>Open answers <span class="dim">58</span></button><button>Each response <span class="dim">{FINISHED + PARTWAY}</span></button></nav>
    <div class="work-body">
{workie}
      <div class="sv-grid">
{cards}
      </div>
    </div>
{anno("Where this lives", "Sessions &rarr; a survey session, and the set's Results tab (04). Built from one <code>GET /games/{id}/survey-results</code>; after close it reads a frozen snapshot, so the page is identical next month even though the answer rows expire at 7 days.")}
{anno("Workie's read, reusing the workie", "Voice = the persona picker, Approach = the summary-prompt picker, both as the session setup and the stage already offer them (<code>584c11f6</code>). New: a <b>survey</b> default prompt (none ships today; <code>default-ai-prompts.json</code> has only call-and-answer and trivia) and one structured call that also writes the per-question notes and the themes. Redo takes a steer, the same way the stage's Redo rewrites the one on screen.")}
{anno("A chart per kind, and only five", "Rating = histogram + mean (a scale is ordered); 0&ndash;10 = the recommend split; choice = bars with Most picked; yes/no = one split bar and the why; ranking = average place with where-it-landed strips; open answer = themes with a quote. Every bar has its number printed; colour never carries a result alone.")}
{anno("Every per-question note is Workie's", "Blue is Workie's colour here and on the stage. The host can edit or drop any of them before sharing; an edited note is marked as edited in the PDF.")}
"""
    write("30-results.html", console_page("Survey results", body, nav="sessions", back="Sessions"), group="results")

    # ------------------------------------------------------------ 31 open text --
    q7 = Q[6]
    themes = "".join(f'<button class="sv-start" aria-pressed="{"true" if i == 0 else "false"}" style="padding:9px 12px"><div style="flex:1"><b>{t}</b><span>{c} answers</span></div></button>'
                     for i, (t, c, _) in enumerate(q7["themes"]))
    resp = [
        ("Seeing the console actually run beat every slide about it.", "The live demo made it concrete", "on"),
        ("Dana clicking through the approval flow. That is the first time I understood what we are selling to Halvorsen.", "The live demo made it concrete", "flag"),
        ("The demo. More of that, less roadmap.", "The live demo made it concrete", ""),
        ("Watching an approval go end to end in under a minute — I didn't know it was that far along.", "The live demo made it concrete", ""),
        ("Live demo, obviously. Also the honest bit about the Q2 slip.", "The live demo made it concrete · Honesty about what slipped", ""),
    ]
    rl = []
    for text, th, state in resp:
        flag = ""
        if state == "on":
            flag = '<span class="sv-onwall">On the wall</span>'
        if state == "flag":
            flag = '<span class="chip warn">Names a person &middot; held back from shared results</span>'
        cls = "sv-resp on" if state == "on" else "sv-resp"
        rl.append(f'<div class="{cls}"><div><p>{text}</p><small>{th}</small></div><div class="acts">{flag}'
                  f'<button class="btn sm">{ico("play")}{"Take down" if state == "on" else "Wall"}</button>'
                  f'<button class="btn sm ghost">{"Release" if state == "flag" else "Hide"}</button></div></div>')
    body = f"""
    <div class="work-head"><div style="min-width:0"><h1>Q7 &middot; {q7['title']}</h1>
      <p class="sub">{kind_chip('text')} &nbsp;{q7['resp']} answers &middot; grouped into 4 themes by Workie &middot; <a href="#" style="color:var(--muted)">regroup</a></p></div>
      <span class="grow"></span><div class="head-actions"><button class="btn">{ico('left')}Q6</button><button class="btn">Q8 &rsaquo;</button></div></div>
    <nav class="subnav"><button>Summary</button><button aria-current="true">Open answers <span class="dim">58</span></button><button>Each response <span class="dim">{FINISHED + PARTWAY}</span></button></nav>
    <div class="work-body">
      <div style="display:grid;grid-template-columns:300px minmax(0,1fr);gap:16px;align-items:start">
        <div class="sv-starts"><span class="lab" style="margin-bottom:2px">Themes</span>{themes}
          <button class="sv-start" aria-pressed="false" style="padding:9px 12px"><div><b>All {q7['resp']} answers</b><span>in the order they arrived</span></div></button></div>
        <section class="panel"><header><h2>The live demo made it concrete</h2><p class="note">12 answers &middot; showing 5</p><span class="grow"></span>
          <div class="search" style="flex:0 1 220px"><svg class="ico" viewBox="0 0 24 24"><use href="#i-search"/></svg><input class="inp" placeholder="Search answers"></div></header>
          <div class="body" style="padding:4px 14px">{"".join(rl)}</div></section>
      </div>
    </div>
{anno("The wall button is the feedback wall's", "<code>POST /games/{id}/comments/{commentId}/feature</code> already puts a comment up as the featured quote (<code>799c4ba6</code>). An open answer gets the same verb and the same <code>blockquote.featured</code> on the stage (s-06) &mdash; <b>without</b> a name, because a survey is anonymous where a comment is not.")}
{anno("Held back is the default for a name", "Workie's theming pass also marks answers that name a person. They show here with the reason and are left out of shared results until the host releases them. Hide is the reversible neighbour of deleting; nothing here deletes.")}
{anno("Themes sort, they do not replace", "Every answer stays readable. A theme is a filter with a count; an answer can sit in two. Regroup reruns the pass.")}
"""
    write("31-open-text.html", console_page("Open answers", body, nav="sessions", back="Sessions"), group="results")

    # ------------------------------------------------------------ 32 share -----
    inc = []
    for q in Q:
        if q["kind"] == "text":
            ctl = '<select class="inp"><option selected>Themes and chosen quotes</option><option>Themes only</option><option>Hidden</option></select>'
        else:
            ctl = '<span class="dim" style="font-size:var(--t-label)">Chart</span>'
        chk = "" if q["n"] == 2 else " checked"
        inc.append(f'<div class="i"><label class="cbx"><input type="checkbox"{chk} aria-label="Include Q{q["n"]}"></label><span class="l">Q{q["n"]} &middot; {q["title"]}</span>{ctl}</div>')
    cards = "\n".join(result_card(q, None) for q in Q[:2])
    body = f"""
    <div class="work-head"><div><h1>{TITLE}</h1><p class="sub">Survey &middot; closed</p></div></div>
    <div class="work-body" style="filter:blur(1.5px);opacity:.45" aria-hidden="true"><div class="sv-grid">{cards}</div></div>
    <div class="scrim">
      <div class="modal wide" style="width:min(880px,100%)">
        <header><div><h2>Share the results</h2>
          <p class="dim" style="margin:4px 0 0;font-size:var(--t-label)">A read-only copy, made at 3:44pm and opened 14 times. Later edits and redos reach it only when you press Update.</p></div>
          <span style="flex:1"></span><button class="btn ghost sm" aria-label="Close">{ico('x')}</button></header>
        <div class="body">
          <div class="sv-share">
            <div style="display:flex;flex-direction:column;gap:14px">
              <div class="field"><span class="lab">What goes on it</span><div class="sv-inc">
                <div class="i"><label class="cbx"><input type="checkbox" checked aria-label="Include Workie's read"></label><span class="l"><b>Workie&rsquo;s read</b> &mdash; the lead line and the three next steps</span><span class="dim" style="font-size:var(--t-label)">as edited</span></div>
                {"".join(inc)}</div>
                <p class="help">Q2 is left out by you. Any chart with fewer than 5 answers is left out automatically, and so is any answer Workie held back for naming a person. No name is ever on it, whatever the survey&rsquo;s Names setting.</p></div>
              <div class="sv-row"><div class="field"><label>The link works until</label><select class="inp"><option selected>2 days after it opened</option><option>7 days after it opened</option><option>30 days after it opened</option><option>90 days after it opened</option></select></div>
                <div class="field"><label>Who can open it</label><select class="inp"><option selected>Anyone with the link</option><option>People in my organisation</option></select></div></div>
              <p class="help" style="margin-top:-6px"><b style="color:var(--text)">Until {LINK_UNTIL}.</b> Counted from when the survey opened ({OPENED}) &mdash; not from when the link was made or first opened.</p>
              <div class="field"><span class="lab">The link</span><div class="sv-link"><input class="inp" readonly value="engage.seibtribe.us/r/7fK2-mQ9x"><button class="btn">{ico('copy')}Copy</button></div></div>
            </div>
            <div style="display:flex;flex-direction:column;gap:8px;align-items:center"><div class="sv-qrbox">{qr_svg(11)}</div>
              <button class="btn" style="width:170px;justify-content:center">{ico('play')}Put it on the wall</button>
              <button class="btn" style="width:170px;justify-content:center">{ico('share')}Send to 6 phones</button>
              <p class="dim" style="font-size:var(--t-label);text-align:center;margin:0">6 people still have the session open.</p></div>
          </div>
        </div>
        <footer><button class="btn danger">Revoke the link</button><span class="grow"></span><button class="btn">Close</button><button class="btn primary">Update the link</button></footer>
      </div>
    </div>
{anno("There is no way back to participants today", "The player's ENDED screen says &lsquo;if your host publishes a session summary, they will share the link themselves&rsquo; (<code>PlayerPage.jsx:2499-2530</code>) and nothing publishes one; <code>GET /games/{id}/report</code> is public but no player calls it. This is the missing piece: a frozen copy behind a token, with three ways to hand it out &mdash; the wall (QR), the phones still connected, and the link.")}
{anno("A copy, not a view", "<code>SHARE#&lt;token&gt;</code> points at a snapshot written now. The answer rows expire at 7 days and the host may redo Workie's read; neither can change what 40 people were sent. Update and Revoke appear here once a link exists.")}
{anno("The clock starts when the survey opens", "The owner's rule: default <b>2 days</b>, anyone with the link, and &lsquo;the trigger is opening, not creating or viewing.&rsquo; So the expiry is the survey's open stamp plus the window, printed as a date. A host who shares after the window has passed is offered the next one still in the future, never a dead link.")}
{anno("Anonymity has a floor", "Under 5 answers a distribution can identify someone, so it is dropped from the shared page (the console still shows it). Held-back open answers never ship. The threshold is a constant, not a setting &mdash; one less way to get it wrong.")}
"""
    write("32-share.html", console_page("Share survey results", body, nav="sessions", back="Sessions"), group="results")

    # ------------------------------------------------------------ 34 report ----
    secs = []
    for q in Q:
        k = q["kind"]; n = n_of(q)
        if k == "rating":
            mx = max(q["dist"])
            cols = "".join(f'<div class="{"top" if c == mx else ""}"><em>{c}</em><i style="height:{round(c * 100 / mx)}%"></i></div>' for c in q["dist"])
            chart = (f'<div class="rate"><div class="m"><b>{mean(q):.1f}</b><span>out of 5 &middot; {pct(q["dist"][3] + q["dist"][4], n)}% said 4 or 5</span></div>'
                     f'<div><div class="hist" style="--n:5">{cols}</div><div class="histx" style="--n:5"><span>1</span><span>2</span><span>3</span><span>4</span><span>5</span></div>'
                     f'<div class="ends"><span>{q["low"]}</span><span>{q["high"]}</span></div></div></div>')
        elif k == "nps":
            d, p_, pr = q["split"]
            chart = (f'<div class="rate"><div class="m"><b>+{nps(q)}</b><span>recommend score</span></div>'
                     f'<div><div class="split"><i class="ns" style="flex:{d}">0&ndash;6 &middot; {pct(d, n)}%</i><i class="ns" style="flex:{p_};background:#EEF0F3">7&ndash;8 &middot; {pct(p_, n)}%</i><i class="yes" style="flex:{pr}">9&ndash;10 &middot; {pct(pr, n)}%</i></div></div></div>')
        elif k == "choice":
            top = max(q["opts"], key=lambda r: r[1])[0]
            chart = '<div class="bars">' + "".join(
                f'<div class="b{" top" if t == top else ""}"><span class="l">{t}</span><span class="t"><i style="width:{pct(c, n)}%"></i></span><span class="v">{pct(c, n)}%</span></div>'
                for t, c in q["opts"]) + "</div>"
        elif k == "yesno":
            y, no, ns = q["split"]
            chart = (f'<div class="split"><i class="yes" style="flex:{y}">Yes {pct(y, n)}%</i><i class="no" style="flex:{no}">No {pct(no, n)}%</i><i class="ns" style="flex:{ns}">{pct(ns, n)}%</i></div>'
                     f'<ul class="quotes"><li>Cut the roadmap section in half and give that time to questions.<small>said No</small></li>'
                     f'<li>Add ten minutes of breakouts and it would be the right length.<small>said No</small></li></ul>')
        elif k == "rank":
            chart = '<div class="rank">' + "".join(f'<div class="r"><b>{i + 1}</b><span>{t}</span><span class="v">avg {a:.1f}</span></div>'
                                                   for i, (t, a, _) in enumerate(q["items"])) + "</div>"
        else:
            chart = "".join(f'<div class="theme"><b>{t}</b><span class="c">{c}</span>' + (f'<q>{qt}</q>' if qt else "") + "</div>"
                            for t, c, qt in q["themes"])
        secs.append(f'<section class="sec"><div class="idx"><span class="num">Question {q["n"]}</span><span class="badge">{KIND[k][1]}</span>'
                    f'<span class="badge">{n} answered</span></div><h2 class="q">{q["title"]}</h2>{chart}'
                    f'<p class="foot">Workie: {NOTES[q["n"]]}</p></section>')
    body = f"""
<div class="toolbar"><div class="g"><button class="tool">&larr; Back</button></div>
  <div class="g"><button class="tool">Print</button><button class="tool">Copy link</button><button class="tool primary">Download PDF</button></div></div>
<article class="doc">
  <header class="titleblock"><p class="eyebrow">Survey report</p><h1 class="title">{TITLE}</h1>
    <p class="date">22 September 2026 &middot; 2:10&ndash;3:42pm</p>
    <dl class="meta"><div><dt>Joined</dt><dd>{JOINED}</dd></div><div><dt>Finished</dt><dd>{FINISHED}</dd></div>
      <div><dt>Questions</dt><dd>8</dd></div><div><dt>Recommend score</dt><dd>+{nps(Q[1])}</dd></div></dl></header>
  <section class="sec"><div class="idx"><span class="num">Workie&rsquo;s read</span><span class="badge">Dry Analyst</span></div>
    <div class="workie"><p class="lead">{WORKIE_LEAD}</p><p>{WORKIE_P}</p>
      <p class="bh" style="margin-top:14px">What to do next</p><ol>{"".join(f"<li>{x}</li>" for x in NEXT)}</ol>
      <p class="by">{CAVEAT}</p></div></section>
  {"".join(secs)}
</article>
"""
    write("34-report.html", paper_page("Survey report — PDF", body), group="results")
