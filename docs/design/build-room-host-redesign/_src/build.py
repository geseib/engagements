#!/usr/bin/env python3
"""Builds the Build Room host-redesign mockups (static HTML, one file per state).

Run from anywhere:  python3 docs/design/build-room-host-redesign/_src/build.py
Every page shares mock.css / mock.js and the pieces below, so a change to the
rail, the dock or the drawer lands on every state at once.
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(HERE)

TITLE = 'Volunteer sign-up'
GOAL = 'A one-page site to pick a shift in a minute'
CODE = '4821'

# (file, code, short title) — the nav order
PAGES = [
    ('index.html', '', 'Overview'),
    ('00-today.html', '00', 'Today, measured'),
    ('b1-building.html', 'B1', 'Claude is building'),
    ('b2-proposed.html', 'B2', 'Claude proposes an ask'),
    ('b3-live.html', 'B3', 'The room is answering'),
    ('b4-decide.html', 'B4', 'Results and the direction'),
    ('b5-spoken.html', 'B5', 'Answer for the room'),
    ('b6-crew.html', 'B6', 'Crew mode'),
    ('b7-wrapped.html', 'B7', 'Wrapped up'),
    ('b8-ended.html', 'B8', 'Session ended'),
    ('b9-people.html', 'B9', 'Drawer: People'),
    ('b10-ideas.html', 'B10', 'Drawer: Ideas'),
    ('b11-claude.html', 'B11', 'Drawer: Claude'),
    ('b12-record.html', 'B12', 'Drawer: Record'),
    ('b13-present.html', 'B13', 'Present on the wall'),
    ('b14-connection.html', 'B14', 'Connection dropped'),
    ('a1-console.html', 'A1', 'Layout A: control screen'),
    ('a2-console-decide.html', 'A2', 'Layout A: deciding'),
    ('a3-remote.html', 'A3', 'Layout A: phone or tablet remote'),
    ('notices.html', 'N', 'Notices'),
    ('scores.html', 'S', 'Players and scores'),
]


def nav(current):
    out = ['<nav class="pg-nav">']
    for f, code, name in PAGES:
        label = (code + ' ' if code else '') + name
        cls = ' class="here"' if f == current else ''
        out.append(f'<a{cls} href="{f}">{label}</a>')
    out.append('</nav>')
    return '\n'.join(out)


def page(fname, heading, sub, screens, notes=(), after=''):
    code = next((c for f, c, _ in PAGES if f == fname), '')
    body = [nav(fname), f'<div class="pg-title"><h1>{(code + " · ") if code else ""}{heading}</h1><p>{sub}</p></div>']
    for s in screens:
        body.append(f'<div class="fit"><div class="fit-box">{s}</div></div>')
    if notes:
        body.append('<div class="notes">')
        for n, t, p in notes:
            body.append(f'<div class="note"><h3><b class="n">{n}</b>{t}</h3><p>{p}</p></div>')
        body.append('</div>')
    body.append(after)
    html = f'''<!doctype html>
<html lang="en" data-theme="dark" class="d-room">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{code + " " if code else ""}{heading} · Build Room host</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;700;800&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="mock.css">
</head>
<body>
{chr(10).join(body)}
<script src="mock.js"></script>
</body>
</html>
'''
    with open(os.path.join(OUT, fname), 'w') as fh:
        fh.write(html)


# ── shared pieces ──────────────────────────────────────────────────────────

def pin(n, x, y):
    return f'<span class="pin" style="left:{x}px;top:{y}px">{n}</span>'


def rail(phase='build', phase_text='Building', ctx='Build Room', code=CODE, closed=False):
    cls = {'build': 'phase--build', 'ask': '', 'vote': 'phase--vote', 'results': 'phase--results', 'done': 'phase--done'}[phase]
    join = (f'<div class="join"><span>Session {code} · closed</span></div>' if closed else
            f'<div class="join"><span class="k">JOIN</span><span class="u">engage.seibtribe.us/play</span><span class="code" title="Hover to show the QR; click to pin it">{code}</span></div>')
    return (f'<header class="rail"><span class="phase {cls}">{phase_text}</span>'
            f'<div class="rail-title"><b>{TITLE}</b><span>{ctx}</span></div>{join}</header>'
            f'<div class="bar bar--{phase}"></div>')


def dock(status, small='', buttons='', badge=None, wait=None, status_cls=''):
    b = f'<span class="dot">{badge}</span>' if badge else ''
    w = f'<span class="waitchip">{wait}</span>' if wait else ''
    s = f'<small>{small}</small>' if small else ''
    return (f'<footer class="dock"><span class="more" title="Host drawer (\\ key)">··· HOST {b}</span>'
            f'<div class="status {status_cls}">{status}{s}</div>{w}{buttons}</footer>')


def dbtn(text, kind='', kbd=None):
    k = f'<span class="kbd">{kbd}</span>' if kbd else ''
    cls = f' dbtn--{kind}' if kind else ''
    return f'<span class="dbtn{cls}">{text}</span>{k}'


TABS = [('people', 'People'), ('ideas', 'Ideas'), ('claude', 'Claude'), ('asks', 'Asks'), ('record', 'Record')]


def drawer(active, body, badges=None, crew=False, tall=False, foot=True):
    badges = badges or {}
    tabs = TABS[:]
    if crew:
        tabs.insert(1, ('crew', 'Crew'))
    t = []
    for key, name in tabs:
        n = badges.get(key)
        nb = ''
        if n is not None:
            q = ' n--q' if str(n).startswith('~') else ''
            nb = f'<span class="n{q}">{str(n).lstrip("~")}</span>'
        t.append(f'<span class="tab{" is-on" if key == active else ""}">{name}{nb}</span>')
    f = ('<div class="dr-foot"><span class="lbl">Session</span><span class="btn btn--sm btn--ghost">Present · P</span>'
         '<span class="btn btn--sm btn--ghost">Wrap up</span><span class="btn btn--sm btn--ghost">Report</span>'
         '<span class="btn btn--sm btn--danger push">End session</span></div>') if foot else ''
    return (f'<div class="scrim"></div><aside class="drawer{" drawer--tall" if tall else ""}">'
            f'<div class="dr-head"><h2>Host</h2><span class="live">Live</span><span class="hint">· Claude Code connected</span>'
            f'<span class="x push">×</span></div><div class="tabs">{"".join(t)}</div>'
            f'<div class="dr-body">{body}</div>{f}</aside>')


def toast(kind, ico, title, sub, acts='', fade=False):
    a = f'<div class="acts">{acts}</div>' if acts else ''
    return (f'<div class="toast toast--{kind}{" toast--fade" if fade else ""}"><span class="ico">{ico}</span>'
            f'<div class="tx"><b>{title}</b><span>{sub}</span>{a}</div><span class="hint">×</span></div>')


def toasts(items, left_of_drawer=False, more=None):
    m = f'<span class="toast-more">{more}</span>' if more else ''
    return f'<div class="toasts{" toasts--left-of-drawer" if left_of_drawer else ""}">{"".join(items)}{m}</div>'


def screen(inner, extra_cls=''):
    return f'<div class="scr {extra_cls}">{inner}</div>'


def meter(label, big, of, pct, says, join=True):
    j = (f'<div class="joinbox"><span class="qr"></span><p>Join on a phone, laptop or tablet<b>{CODE}</b></p></div>' if join else '')
    return (f'<aside class="meter"><span class="lbl">{label}</span><span class="big">{big}<small> / {of}</small></span>'
            f'<span class="bar2"><span style="width:{pct}%"></span></span><span class="says">{says}</span>{j}</aside>')


BADGES = {'people': '~18', 'ideas': 2, 'asks': None}


def choice_cards(live=True, results=False):
    a = (11, 4, 27) if results else (3, 2, 20)
    b = (11, 7, 73) if results else (3, 1, 10)
    lead = ' is-lead' if results else ''
    return f'''<div class="choices">
<div class="choice"><div class="choice-h"><span class="L">A</span><b>Bold banner</b></div>
<img class="shot" src="img/choice-a.svg" alt="Choice A: bold banner">
<div class="tally"><span class="track"><span style="width:{a[2]}%"></span></span><b>{a[1]}</b><span>{a[2]}%</span></div></div>
<div class="choice{lead}"><div class="choice-h"><span class="L L--b">B</span><b>Calm photo + calendar</b></div>
<img class="shot" src="img/choice-b.svg" alt="Choice B: calm photo and calendar">
<div class="tally"><span class="track"><span style="width:{b[2]}%"></span></span><b>{b[1]}</b><span>{b[2]}%</span></div></div>
</div>'''


def building_main(compact=False):
    return f'''<div class="main"><div class="content">
<div class="building"><span class="pulse"></span><h2 class="q">Claude is building</h2><span class="mins">working for 6 min</span></div>
<div class="now-doing">Right now: <b>Editing src/Header.jsx</b> · 12s ago</div>
<div class="idle-grid">
<div style="display:flex;flex-direction:column;gap:20px">
<div class="latest"><div class="k">Latest decision · Ask 2</div><div class="t">Use the calm photo and the shift calendar, and show spots left</div></div>
<ul class="ticker">
<li class="new"><span class="k">Showing</span><span>The shift calendar is up</span><span class="a">1 min</span></li>
<li><span class="k">Progress</span><span>Spots left now count down live</span><span class="a">4 min</span></li>
<li><span class="k">Progress</span><span>Scaffolded the page</span><span class="a">9 min</span></li>
</ul></div>
<img class="shot" src="img/preview.svg" alt="Latest screenshot: the shift calendar" style="aspect-ratio:16/10">
</div></div>
{meter("Here", 18, 18, 100, "Send an idea from your phone any time")}</div>'''


# ── 00 today ───────────────────────────────────────────────────────────────

def p_today():
    frames = [f'<div class="small-label" style="margin-bottom:6px">Today · {n} (full page, {h}px tall)</div>'
              f'<iframe src="today/{n}.html" style="display:block;width:1440px;height:{h}px;border:0;border-radius:10px;background:#0F1A2E"></iframe>'
              for n, h in [('proposed', 1866), ('results', 1822), ('idle', 1260), ('live', 1260)]]
    sub = ('Today\'s page rendered from fixture state (build-store.js roomFromRows + hostView, the shape GET build/state returns) '
           'with the real stylesheets, at 1440 wide. Measured, not estimated: see the table below. Only four asks and two ideas exist in '
           'this fixture; a real hour adds an asks table and a screenshot grid under all of it.')
    table = '''<div class="idx" style="padding-top:0"><table class="cmp">
<tr><th>State (1440×900)</th><th>Page height</th><th>Header</th><th>Where the stage starts</th><th>Where the host acts</th><th>Buttons</th></tr>
<tr><td>Claude building</td><td>1260px</td><td>147px, three rows</td><td>163px</td><td>"What next?" at 680–982px</td><td>29</td></tr>
<tr><td>Claude proposes an ask</td><td><b>1866px</b></td><td>147px</td><td><b>878px, below the fold</b> (the review card is first)</td><td>Review card 163–862px</td><td>34</td></tr>
<tr><td>Live ask</td><td>1260px</td><td>147px</td><td>163px</td><td>Close at the top of the stage</td><td>33</td></tr>
<tr><td>Results to decide</td><td><b>1822px</b></td><td>147px</td><td>163px</td><td>Send to Claude at <b>~1100px</b></td><td>38</td></tr>
</table>
<p>What it adds up to: <b>eleven controls in the header</b> (join code, joined count, Claude chip, connection chip, Auto switch, Connect, Crew, Wrap up, Report, End, Present),
<b>three always-open panels</b> under the stage (What next, Asks, Screenshots) and <b>three in the right column</b> (Claude activity, Ideas inbox, Timeline with its own form).
Every one of them is visible at once, in every state, so nothing tells the host what matters now.</p></div>'''
    page('00-today.html', 'Today, measured', sub, [], after=table + ''.join(f'<div class="fit" style="padding-top:12px"><div class="fit-box">{fr}</div></div>' for fr in frames))


# ── B: one screen, stage first, a drawer for the host ─────────────────────

def p_b1():
    inner = (rail('build', 'Building', 'Ask 2 decided · 3 asks so far') + building_main()
             + dock('Claude is building the shift calendar', '', dbtn('Ask the room', 'ghost') + dbtn('Tell Claude', 'primary', 'T'), badge=3)
             + toasts([toast('room', 'D', 'Dee sent an idea', '"Text a reminder the day before"', '<span class="btn btn--sm">Send to Claude</span><span class="btn btn--sm btn--ghost">Open Ideas</span>'),
                       toast('room', '3', '3 people looked at the preview', '2 said Looks good · 1 said Needs a change', '<span class="btn btn--sm btn--ghost">Read them</span>'),
                       toast('room', '+', 'Wen joined', '18 here now', fade=True)])
             + pin(1, 20, 14) + pin(2, 1036, 96) + pin(3, 16, 790) + pin(4, 1180, 790) + pin(5, 6, 230))
    page('b1-building.html', 'Claude is building (no ask on the stage)',
         'Drawer closed: the whole screen is the room\'s. The host keeps three things in view: the dock, the toasts, and the badge on HOST.',
         [screen(inner)],
         [(1, 'The rail is the room\'s header', 'Phase pill, title, context, join code: the same rail as every other session (Rail.jsx). <b>Eleven header controls leave it</b>: they move to the drawer (People, Claude, the Session row) or become a notice.'),
          (2, 'Notices arrive as toasts, host-only', 'An idea, preview feedback and a join each show for a few seconds, newest on top, at most three. Each says what happened and offers the one action that answers it. See <a href="notices.html">Notices</a>.'),
          (3, 'One button opens the host drawer', '<b>··· HOST</b> (or the backslash key, as on the regular stage). The badge counts what is unread across the drawer: 2 ideas and 1 preview comment. A number in a pill means nothing to the room.'),
          (4, 'The dock holds the next move, and only that', 'Between asks the next move is to tell Claude something or to ask the room. Tell Claude grows the dock into a sheet (T key), so typing never needs the drawer. Ask the room opens the composer dialog, as today.'),
          (5, 'The stage is unchanged in substance', 'Latest decision, Claude\'s posts and the newest screenshot: what today\'s IdleStage shows, drawn at the Room ladder. The "right now" line is the newest activity line, which today sits in the side column.')])


def review_card(open_edit=False):
    edit = ('''<details class="acc" open><summary>Edit the question and options<span class="sum">changes save when you open it</span></summary><div class="acc-b">
<label><span class="lbl">Question (shown big on the wall)</span><input class="in" value="Which header should volunteers see first?"></label>
<label><span class="lbl">Context (optional)</span><textarea class="ta" style="min-height:48px">Both run on the laptop.</textarea></label>
<p class="hint">Letters are fixed. Claude stamps "Choice A" and "Choice B" on its mockups, so renaming keeps the letter.</p></div></details>'''
            if open_edit else
            '<details class="acc"><summary>Edit the question and options<span class="sum">question, context, 2 options, preview links</span></summary></details>')
    return f'''<div class="card card--prop">
<div class="row"><span class="chip chip--amber">Proposed by Claude · the room cannot see it</span><span class="hint push">Claude is waiting · 40s</span></div>
<h3>Ask 3 · Choose<br><span style="font-weight:800;font-size:24px">Which header should volunteers see first?</span></h3>
<div class="optrow"><span class="L">A</span><span>Bold banner</span><img class="thumb" src="img/choice-a.svg" alt=""></div>
<div class="optrow"><span class="L L--b">B</span><span>Calm photo + calendar</span><span class="thumb thumb--none">no preview</span></div>
<div class="inline-note row"><span><b>No preview for B yet.</b> The room chooses faster from a picture.</span><span class="btn btn--sm push">Ask Claude for mockups</span></div>
{edit}
<div class="row" style="margin-top:2px"><span class="btn btn--danger">Discard</span><span class="btn btn--ghost push">Answer for the room</span><span class="btn btn--primary">Open to the room</span></div>
</div>'''


def p_b2():
    body = (review_card()
            + '<div class="row"><span class="switch"><i></i>Open Claude\'s questions straight away</span><span class="hint push">Off: you review each one first</span></div>'
            + '<details class="acc"><summary>Asks so far<span class="sum">2 decided</span></summary></details>'
            + '<div class="row"><span class="h3">Ask the room</span><span class="btn btn--sm btn--ghost push">Ideas</span><span class="btn btn--sm btn--ghost">Choose</span><span class="btn btn--sm btn--ghost">Rate</span></div>')
    inner = (rail('build', 'Building', 'Ask 2 decided · 3 asks so far') + building_main()
             + dock('Claude is building the shift calendar', '', dbtn('Review ask 3', 'primary', 'R'), badge=3, wait='Ask 3 waiting for you')
             + drawer('asks', body, {'people': '~18', 'ideas': 2, 'asks': 1})
             + pin(1, 864, 150) + pin(2, 864, 470) + pin(3, 864, 640) + pin(4, 690, 800) + pin(5, 300, 300))
    inner_toast = (rail('build', 'Building', 'Ask 2 decided · 3 asks so far') + building_main()
                   + dock('Claude is building the shift calendar', '', dbtn('Review ask 3', 'primary', 'R'), badge=4, wait='Ask 3 waiting for you')
                   + toasts([toast('claude', 'C', 'Claude has a question for the room', 'Ask 3 · Choose · "Which header should volunteers see first?"', '<span class="btn btn--sm btn--primary">Review</span><span class="btn btn--sm btn--ghost">Later</span>')]))
    page('b2-proposed.html', 'Claude proposes an ask',
         'Top: the moment it arrives, with the drawer closed. Bottom: the host pressed Review (or R) and the drawer opened on Asks with that card first. The stage still shows Claude building: the room sees nothing until the host opens it.',
         [screen(inner_toast), screen(inner)],
         [(1, 'One card, collapsed to what the decision needs', 'Question, the options with their previews, and three buttons. The <b>edit fields fold into an accordion</b>: most of Claude\'s asks open as written, so the five inputs that fill today\'s card (699px tall) are one click away instead of always open.'),
          (2, 'Missing previews say so, with the fix beside them', 'The "Ask Claude for mockups" note from today, unchanged, at the point of the decision.'),
          (3, 'Auto lives with the asks it governs', 'Today\'s header switch "Auto-open Claude\'s questions" moves here, next to the review it skips. Same setting (reviewAgentAsks), same words in the Claude tab.'),
          (4, 'The dock names the waiting ask', 'A dashed amber chip, matching the proposed card\'s dashed amber edge, says something is waiting. The primary becomes Review ask 3 until it is opened, answered for the room or discarded. The room sees an ask number and nothing else.'),
          (5, 'The room keeps watching Claude build', 'The drawer covers the right 560px, the same geometry as the regular stage\'s drawer. On a mirrored projector the room sees the drawer, so the card shows the question only after the host chooses Review. See question 2 for the owner.')])


def p_b3():
    main = f'''<div class="main"><div class="content">
<div class="eyebrow">Choose <span>· Ask 3 · Claude asks</span></div>
<h2 class="q">Which header should volunteers see first?</h2>
{choice_cards()}</div>
{meter("Answered", 5, 18, 28, "Pick one on your phone, laptop or tablet. Add why if you like.")}</div>'''
    inner = (rail('ask', 'Choose', 'Ask 3 of 3') + main
             + dock('5 of 18 have answered', '', dbtn('Answer for the room', 'ghost') + dbtn('Close and show results', 'primary', 'SPACE'), badge=2)
             + toasts([toast('room', 'J', 'Jo sent an idea', '"Put the address on the page"', '<span class="btn btn--sm">Send to Claude</span><span class="btn btn--sm btn--ghost">Open Ideas</span>', fade=True)])
             + pin(1, 1100, 120) + pin(2, 20, 790) + pin(3, 864, 790) + pin(4, 640, 150))
    page('b3-live.html', 'The room is answering',
         'A live Choose. The stage is the ask; the dock holds Close; everything else waits in the drawer.',
         [screen(inner)],
         [(1, 'The count lives on the stage, as it does in regular sessions', 'The meter column (RoomMeter) carries answered of here. When everyone has answered, the dock status says so and Close turns amber (a notice, not a toast).'),
          (2, 'The status line is for the room', 'Room-safe words only: the count, never who is missing.'),
          (3, 'Close is the primary, with Space', 'The same key and position as Start Voting on the regular stage. Answer for the room is the one secondary. <b>Edit wording, Open voting (Ideas asks), Reopen and Discard</b> move to the ask\'s row in the drawer\'s Asks tab: rare moves stay one click away.'),
          (4, 'Nothing host-only sits on the stage', 'Today the hint line "Shape the direction, then send it to Claude" and the edit buttons sit inside the stage. They leave it; the stage shows exactly what the room needs.')])


def p_b4():
    cards = choice_cards(results=True).replace('class="shot"', 'class="shot" style="max-height:120px"')
    main = f'''<div class="main" style="padding-bottom:12px"><div class="content">
<div class="eyebrow" style="color:var(--m-success-text)">Results <span>· Ask 3 · closed</span></div>
<h2 class="q" style="font-size:40px">Which header should volunteers see first?</h2>
{cards}</div>
<aside class="meter"><span class="lbl">Answered</span><span class="big" style="font-size:56px">15<small> / 18</small></span>
<span class="lbl" style="margin-top:10px">Reasons</span><div class="whys"><div><i>B</i>Dates first. That is what people come for.</div><div><i>B</i>Works on my old phone.</div><div><i>A</i>The big button is hard to miss.</div></div></aside></div>'''
    sheet = '''<section class="sheet">
<div class="sheet-h"><h2>Direction for Claude</h2><span class="sub">Claude builds from this sentence, not from the counts. 15 of 18 answered.</span><span class="hint push">Delivered on Claude's next step</span></div>
<div class="sheet-row"><textarea class="ta">Go with B: calm photo + calendar.</textarea>
<div style="display:flex;flex-direction:column;gap:8px;align-items:flex-end"><span class="dbtn dbtn--primary dbtn--sm">Send to Claude</span><span class="kbd">CTRL + ENTER</span></div></div>
<details class="acc"><summary>Adjust<span class="sum">Chosen: B · Fold in: 0 of 3 reasons · Note: none · Sends to Claude</span></summary></details>
</section>'''
    sheet_open = sheet.replace('<details class="acc"><summary>Adjust<span class="sum">Chosen: B · Fold in: 0 of 3 reasons · Note: none · Sends to Claude</span></summary></details>',
        '''<details class="acc" open><summary>Adjust<span class="sum">Chosen: B · Fold in: 1 of 3 · Sends to Claude</span></summary><div class="acc-b">
<div class="row"><span class="lbl" style="margin:0;width:110px">Chosen</span><span class="fold">A · Bold banner</span><span class="fold is-in">B · Calm photo + calendar</span></div>
<div class="row"><span class="lbl" style="margin:0;width:110px">Fold in</span><span class="fold is-in">+ Works on my old phone</span><span class="fold">+ The big button is hard to miss</span><span class="fold">+ Dates first</span></div>
<div class="row"><span class="lbl" style="margin:0;width:110px">The room said</span><input class="in" style="flex:1" placeholder='e.g. "show how many spots are left"'><span class="switch on"><i></i>Send to Claude</span></div>
</div></details>''').replace('Go with B: calm photo + calendar.', 'Go with B: calm photo + calendar. Works on my old phone.')
    inner = (rail('results', 'Results', 'Ask 3 of 3').replace('<div class="bar bar--results"></div>', '<div class="bar bar--results"></div>')
             + main + sheet + pin(1, 1060, 100) + pin(2, 30, 690) + pin(3, 30, 820) + pin(4, 1340, 680))
    inner = inner.replace('<div class="scr ', '<div class="scr ')
    inner2 = rail('results', 'Results', 'Ask 3 of 3') + main + sheet_open
    page('b4-decide.html', 'Results, and the direction for Claude',
         'The dock grows into a sheet for the one sentence that matters. The results stay in view above it, so the host decides while looking at what the room said. Top: as it opens. Bottom: Adjust unfolded.',
         [screen(inner, 'scr--sheet'), screen(inner2, 'scr--sheet')],
         [(1, 'The results stay the room\'s', 'Bars, counts and reasons, at the Room ladder, as today. Nothing is drawn over them.'),
          (2, 'One sentence, prefilled, editable', 'The same defaultDirection() prefill as today. It is the decision, so it gets the size and the position of the primary action.'),
          (3, 'Everything else folds into Adjust', 'Chosen, Fold in, What the room said and the Send to Claude switch are today\'s DecidePanel controls, all kept. The summary line says their current values, so a host who never opens Adjust still knows what will be sent.'),
          (4, 'Why a sheet and not the drawer', 'The container rule: stay inline when a modal would cover the thing being judged. The drawer would cover the right half of the results; the sheet takes only the dock\'s strip and grows upward.')])


def p_b5():
    main = f'''<div class="main" style="padding-bottom:12px"><div class="content">
<div class="eyebrow">Choose <span>· Ask 3 · Claude asks</span></div>
<h2 class="q" style="font-size:40px">Which header should volunteers see first?</h2>
{choice_cards().replace('aspect-ratio', 'max-height:110px;aspect-ratio')}</div>
{meter("Answered", 2, 18, 11, "", join=False)}</div>'''
    sheet = '''<section class="sheet">
<div class="sheet-h"><h2>Answer for the room</h2><span class="sub">For when people talk instead of tapping. Claude is told it was said out loud.</span><span class="btn btn--ghost push">Cancel</span></div>
<div class="row"><span class="lbl" style="margin:0;width:150px">What the room chose</span><span class="fold">A · Bold banner</span><span class="fold is-in">B · Calm photo + calendar</span></div>
<div class="sheet-row"><textarea class="ta" style="min-height:52px">The room chose B: Calm photo + calendar (said out loud).</textarea><span class="dbtn dbtn--primary dbtn--sm">Send to Claude</span></div>
<details class="acc"><summary>Adjust<span class="sum">Note: none · Sends to Claude</span></summary></details>
</section>'''
    inner = rail('ask', 'Choose', 'Ask 3 of 3') + main + sheet + pin(1, 30, 600)
    page('b5-spoken.html', 'Answer for the room',
         'Same sheet as deciding, in its spoken form. Reached from the dock (live ask) or from the review card (proposed ask). The stage behind it is unchanged.',
         [screen(inner, 'scr--sheet')],
         [(1, 'One sheet, two uses', 'DecidePanel already has a spoken mode; the redesign gives both modes the same place. Picks write the sentence until the host types in it, as today (spokenDirection).')])


def p_b6():
    lane = lambda n, who, task, state, chip: f'''<div class="choice" style="gap:8px;padding:14px 16px"><div class="row" style="gap:12px"><span class="av" style="width:44px;height:44px;font-size:18px">{n}</span><b style="font-size:var(--L-body)">{who}</b><span class="chip {chip} push" style="font-size:15px;height:30px">{state}</span></div><div style="font-size:var(--L-meta);color:var(--muted)">{task}</div></div>'''
    main = f'''<div class="main"><div class="content">
<div class="eyebrow">Crew <span>· 3 builders · branches off main</span></div>
<h2 class="q">The crew is building three pieces</h2>
<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:18px">
{lane('A', 'Ana', 'Reminder texts the day before', 'Early look', 'chip--amber')}
{lane('S', 'Sam', 'Map of the car park', 'Building', '')}
{lane('P', 'Priya', 'Shift sign-up without an account', 'Ready to merge', 'chip--green')}
</div>
<div class="latest"><div class="k">Main build · Claude</div><div class="t">Shift calendar shipped. Waiting for the crew.</div></div>
</div>
{meter("Builders", 3, 18, 17, "Have Claude Code? Tap I have Claude Code on your phone.")}</div>'''
    body = '''<div class="card"><div class="row"><span class="av">A</span><b>Ana · Reminder texts</b><span class="chip chip--amber push">Early look waiting</span></div>
<p class="hint">Branch crew/ana-reminders · 3 files · shared 2 min ago</p><div class="row"><span class="btn btn--sm btn--ghost">Show on the wall</span><span class="btn btn--sm btn--primary push">Open the early look</span></div></div>
<details class="acc"><summary>Builders<span class="sum">3 building · 1 asked for help</span></summary></details>
<details class="acc"><summary>Tasks for the crew<span class="sum">3 claimed · 1 open</span></summary></details>
<div class="row"><span class="switch on"><i></i>Run the crew's code on my laptop</span></div>
<p class="hint">Crew settings and the share-repo prompt: Crew dialog</p>'''
    closed = (rail('build', 'Crew', 'Crew board') + main
              + dock('3 builders · 1 early look waiting', '', dbtn('Room asks', 'ghost') + dbtn('Open Ana\'s early look', 'primary', 'SPACE'), badge=1)
              + pin(1, 20, 110) + pin(2, 700, 790))
    inner = (rail('build', 'Crew', 'Crew board') + main
             + dock('3 builders · 1 early look waiting', '', dbtn('Room asks', 'ghost') + dbtn('Open Ana\'s early look', 'primary', 'SPACE'), badge=1)
             + drawer('crew', body, {'people': '~18', 'crew': 1, 'ideas': 2}, crew=True)
             + pin(3, 864, 70))
    page('b6-crew.html', 'Crew mode',
         'The crew board becomes a stage of its own, swapped from the dock; incoming early looks are the crew\'s "next move" and its own tab.',
         [screen(closed), screen(inner)],
         [(1, 'Crew board on the stage', 'Today\'s CrewBoard and StageTabs: the room sees the lanes. The stage switch moves from tabs above the stage to the dock (Room asks / Crew board), one control instead of a tab strip the room reads as part of the page.'),
          (2, 'An early look is the next move', 'The newest incoming share is the dock primary. Others queue in the Crew tab, as CrewIncoming does in today\'s right column.'),
          (3, 'Crew gets a tab only while it is on', 'Builders, tasks, the run-code switch and incoming shares: CrewIncoming, CrewTasks and RunCrewCodeSwitch move in unchanged. CrewDialog and EarlyLookDialog stay dialogs.')])


def p_b7():
    main = '''<div class="main"><div class="content">
<div class="building"><span class="pulse" style="background:var(--success);box-shadow:0 0 0 8px var(--m-tint-green)"></span><h2 class="q">What we built</h2></div>
<p class="detail" style="color:var(--text)">A one-page sign-up for Saturday shifts. Pick a time, see spots left, no account needed.</p>
<div class="idle-grid"><img class="shot" src="img/preview.svg" alt="The finished page" style="aspect-ratio:16/10">
<div style="display:flex;flex-direction:column;gap:14px;font-size:var(--L-body)"><div class="eyebrow" style="color:var(--muted)">Built</div>
<div>Shift calendar with spots left</div><div>Sign-up without an account</div><div>Reminder text the day before</div>
<div class="eyebrow" style="color:var(--muted);margin-top:8px">Next steps</div><div>Hook up the real shift list</div></div></div>
</div>'''+ meter("Took part", 18, 18, 100, "6 asks · 14 ideas", join=False) + '</div>'
    inner = (rail('done', 'Wrapped up', '6 asks decided') + main
             + dock('Thanks, everyone. The report has every decision.', '', dbtn('Edit the wrap-up', 'ghost') + dbtn('Open the demo', 'primary'), badge=None))
    page('b7-wrapped.html', 'Wrapped up', 'Claude has called wrap_up; the session is still open. The stage is WrappedStage, the dock offers the demo.',
         [screen(inner)], [(1, 'The demo is the primary', 'Today it is a link inside the stage; it stays there for the room and becomes the dock primary for the host. Report and End live in the drawer\'s Session row.')])


def p_b8():
    main = building_main().replace('Claude is building', 'This session has ended').replace('<span class="pulse"></span>', '').replace('working for 6 min', 'ended 4 min ago')
    inner = (rail('done', 'Ended', '6 asks decided', closed=True) + main
             + dock('This session has ended', 'The timeline, the wrap-up and the report are still yours to edit.', dbtn('Edit the wrap-up', 'ghost') + dbtn('Open the report', 'primary')))
    page('b8-ended.html', 'Session ended', 'Read-only for the room; editable for the host. The rail says closed, as the regular stage does after End.',
         [screen(inner)], [(1, 'The ended notice moves into the dock', 'Today it is a full-width bar under the header. The dock already holds the one sentence that describes the session\'s state.')])


def p_b9():
    rows = [('Ana', 4, 3, 2, 1, 17), ('Priya', 4, 2, 1, 1, 13), ('Dee', 4, 2, 0, 1, 11), ('Sam', 3, 1, 2, 0, 10), ('Jo', 4, 1, 0, 1, 9),
            ('Lee', 2, 1, 1, 0, 7), ('Marcus', 3, 0, 0, 1, 5), ('Nia', 3, 1, 0, 0, 5), ('Omar', 3, 0, 0, 1, 4), ('Ravi', 2, 1, 0, 0, 4), ('Tess', 3, 0, 0, 0, 3), ('Wen', 1, 0, 0, 0, 1)]
    tr = ''.join(f'<tr><td>{i+1}</td><td><span class="av" style="width:22px;height:22px;margin-right:6px">{n[0]}</span>{n}</td><td class="num">{a}</td><td class="num">{s}</td><td class="num">{w}</td><td class="num">{f}</td><td class="num"><b>{p}</b></td></tr>' for i, (n, a, s, w, f, p) in enumerate(rows))
    body = f'''<div class="row"><span class="h3">18 here</span><span class="hint">· 2 joined in the last 5 min</span><span class="btn btn--sm btn--ghost push">Show join QR</span><span class="btn btn--sm btn--ghost">Copy link</span></div>
<table class="tbl"><colgroup><col style="width:30px"><col><col style="width:72px"><col style="width:54px"><col style="width:62px"><col style="width:76px"><col style="width:58px"></colgroup>
<thead><tr><th>#</th><th>Name</th><th class="num">Answers</th><th class="num">Ideas</th><th class="num">Picked</th><th class="num">Feedback</th><th class="num">Points</th></tr></thead><tbody>{tr}</tbody></table>
<p class="hint">+6 more. Points follow the rules you choose in Scoring (option 2 shown: taking part and influence). Nothing here is on the wall unless you open the scoreboard.</p>
<div class="row"><span class="btn btn--sm btn--ghost">Scoring rules</span><span class="btn btn--sm push">Show the scoreboard · S</span></div>'''
    inner = (rail('build', 'Building', 'Ask 2 decided · 3 asks so far') + building_main()
             + dock('Claude is building the shift calendar', '', dbtn('Ask the room', 'ghost') + dbtn('Tell Claude', 'primary', 'T'), badge=2)
             + drawer('people', body, {'people': '~18', 'ideas': 2}) + pin(1, 864, 150) + pin(2, 1240, 162) + pin(3, 1300, 680))
    page('b9-people.html', 'Drawer: People', 'Who is here and what each person has given. A new tab: today the host sees only "18 joined".',
         [screen(inner)],
         [(1, 'Joins in one line, with the QR one click away', 'The join QR and copy link (today\'s JoinFoot and QrZoom) stay on the stage for the room; the host gets them here too, for pasting into a chat.'),
          (2, 'Contribution first, points second', 'Answers, ideas sent, ideas picked (a suggestion that won or an idea sent to Claude), preview feedback. Every column is countable from rows that exist today. Points are a proposal: see <a href="scores.html">Players and scores</a>.'),
          (3, 'The scoreboard is the wall moment', 'If the owner wants Build Room scores on the wall, the shipped Scoreboard (three looks, S key) opens from here, as it does from the regular Players tab.')])


def p_b10():
    body = '''<div class="row"><span class="h3">2 new</span><span class="hint push">Phones can send an idea any time</span></div>
<div class="card"><div style="font-size:17px">Text a reminder the day before</div><div class="row"><span class="hint">Dee · 10:42</span><span class="btn btn--sm push">Send to Claude</span><span class="btn btn--sm" title="Open an Ideas ask first" style="opacity:.55">Add to current ideas</span><span class="btn btn--sm btn--danger">Dismiss</span></div></div>
<div class="card"><div style="font-size:17px">Put the address on the page</div><div class="row"><span class="hint">Jo · 10:44</span><span class="btn btn--sm push">Send to Claude</span><span class="btn btn--sm" style="opacity:.55">Add to current ideas</span><span class="btn btn--sm btn--danger">Dismiss</span></div></div>
<details class="acc" open><summary>On the preview "The shift calendar is up"<span class="sum">2 Looks good · 1 Needs a change</span></summary><div class="acc-b">
<ul class="list"><li><span class="unread"></span><span class="chip chip--red">Needs a change</span><span class="grow ell">The 13:00 row should say full in red</span><span class="who">Sam</span></li>
<li><span class="chip chip--green">Looks good</span><span class="grow"></span><span class="who">Ana, Priya</span></li></ul>
<div class="row"><span class="btn btn--sm push">Send the change to Claude</span></div></div></details>
<details class="acc"><summary>Handled<span class="sum">9 used · 2 dismissed</span></summary></details>'''
    inner = (rail('build', 'Building', 'Ask 2 decided · 3 asks so far') + building_main()
             + dock('Claude is building the shift calendar', '', dbtn('Ask the room', 'ghost') + dbtn('Tell Claude', 'primary', 'T'), badge=3)
             + drawer('ideas', body, {'people': '~18', 'ideas': 3}) + pin(1, 864, 210) + pin(2, 864, 470))
    page('b10-ideas.html', 'Drawer: Ideas', 'Today\'s IdeasInbox, moved into a tab, with preview feedback grouped under the preview it is about.',
         [screen(inner)],
         [(1, 'New ideas first, actions unchanged', 'Send to Claude, Add to current ideas (only while an Ideas ask is open), Dismiss: today\'s three, today\'s rules.'),
          (2, 'Feedback grouped by the preview it is about', 'Ideas with AboutLogId gather under that "showing" entry. "Looks good" collapses to names; "Needs a change" keeps its words and gets a send button.')])


def p_b11():
    body = '''<div class="card"><div class="row"><span class="chip chip--green">Connected</span><b>Claude Code</b><span class="hint">active 6s ago · listening</span><span class="btn btn--sm btn--ghost push">Connect</span></div>
<p class="hint">Claude reads what you send on its next step.</p></div>
<details class="acc" open><summary>What Claude is doing<span class="sum">live</span></summary><div class="acc-b"><ul class="list">
<li><span class="tm">now</span><span class="grow ell"><b>Editing</b> src/Header.jsx</span></li>
<li><span class="tm">40s</span><span class="grow ell">Running npm run build</span></li>
<li><span class="tm">1m</span><span class="grow ell">Reading src/App.jsx</span></li>
<li><span class="tm">2m</span><span class="grow ell">Searching for "shift"</span></li></ul></div></details>
<div class="row"><span class="btn">Preview the work</span><span class="btn btn--ghost">Copy the Continue prompt</span></div>
<div class="row"><span class="switch"><i></i>Open Claude's questions straight away</span></div>
<details class="acc"><summary>Directions sent<span class="sum">4 · all delivered</span></summary></details>'''
    inner = (rail('build', 'Building', 'Ask 2 decided · 3 asks so far') + building_main()
             + '<section class="sheet" style="position:absolute;left:0;right:0;bottom:0"><div class="sheet-h"><h2>Tell Claude</h2><span class="sub">Claude reads this on its next step.</span><span class="btn btn--ghost push">Cancel</span></div><div class="sheet-row"><textarea class="ta">Make the sign-up button bigger, and add the parking map the room asked for.</textarea><span class="dbtn dbtn--primary dbtn--sm">Send to Claude</span></div></section>'
             + drawer('claude', body, {'people': '~18', 'ideas': 2}).replace('class="scrim"', 'class="scrim" style="bottom:190px"').replace('class="drawer"', 'class="drawer" style="bottom:190px"')
             + pin(1, 864, 160) + pin(2, 864, 300) + pin(3, 30, 730))
    page('b11-claude.html', 'Drawer: Claude, and the Tell Claude sheet', 'Everything about the connection to Claude Code in one tab. Typing a direction is a dock sheet, so it works with the drawer open or closed.',
         [screen(inner)],
         [(1, 'One status instead of two chips', 'Today\'s Claude chip and connection chip become one line here; the wall keeps only the stage\'s "Claude is building / listening". Connect Claude Code (today a header button) is here.'),
          (2, 'The live activity, full length', 'ClaudeActivity with full=true. The newest line also appears on the stage, as today.'),
          (3, 'Tell Claude is a sheet from the dock', 'Today\'s "What next?" panel: the textarea, Send, Copy the Continue prompt and Preview the work. Ask the room is the dock\'s other button.')])


def p_b12():
    body = '''<details class="acc" open><summary>Asks<span class="sum">3 · 2 decided · 1 proposed</span></summary><div class="acc-b">
<table class="tbl"><colgroup><col style="width:28px"><col><col style="width:68px"><col style="width:84px"><col style="width:70px"></colgroup>
<tr><td>3</td><td>Which header should volunteers see first?</td><td>Choose</td><td><span class="chip chip--amber">Proposed</span></td><td><span class="btn btn--sm">Open</span></td></tr>
<tr><td>2</td><td>Pick a colour</td><td>Choose</td><td><span class="chip chip--green">Decided</span></td><td><span class="btn btn--sm btn--ghost">Reopen</span></td></tr>
<tr><td>1</td><td>What would stop someone signing up?</td><td>Ideas</td><td><span class="chip chip--green">Decided</span></td><td><span class="btn btn--sm btn--ghost">Reopen</span></td></tr></table></div></details>
<details class="acc" open><summary>Timeline<span class="sum">23 entries · newest first</span></summary><div class="acc-b">
<div class="row"><input class="in" style="flex:1" placeholder="Log what the room said..."><span class="btn btn--sm">Log</span></div>
<ul class="list"><li><span class="tm">10:46</span><span class="grow ell"><b>Claude</b> · The shift calendar is up</span></li>
<li><span class="tm">10:44</span><span class="grow ell"><b>Room said</b> · It has to work on old phones</span></li>
<li><span class="tm">10:41</span><span class="grow ell"><b>Decision</b> · Ask 2: use the green palette</span></li></ul></div></details>
<details class="acc"><summary>Screenshots<span class="sum">8 · 3 mockups, 5 progress</span></summary></details>'''
    inner = (rail('build', 'Building', 'Ask 2 decided · 3 asks so far') + building_main()
             + dock('Claude is building the shift calendar', '', dbtn('Ask the room', 'ghost') + dbtn('Tell Claude', 'primary', 'T'), badge=2)
             + drawer('record', body, {'people': '~18', 'ideas': 2, 'asks': 1}) + pin(1, 864, 130) + pin(2, 864, 330))
    page('b12-record.html', 'Drawer: Record (and the Asks tab\'s list)',
         'The things that make the report: the asks, the timeline and the screenshots. Each is an accordion with a summary line, so the tab opens short.',
         [screen(inner)],
         [(1, 'The asks table, with every row action', 'Open, Close, Reopen per row, as today (AskList). The Asks tab shows proposed cards first and the same table under them; Record keeps the full history.'),
          (2, 'Timeline and its quick log', 'Today\'s Timeline and quicklog form, unchanged in behaviour (edit, delete with the delete rule, Room said / Host note / Milestone, Send to Claude). The wall\'s filtered timeline stays as it is in Present.')])


def p_b13():
    main = building_main()
    inner = (rail('build', 'Building', 'Ask 2 decided · 3 asks so far') + main
             + dock('Claude is building the shift calendar', '', '', badge=3)
             + pin(1, 16, 790) + pin(2, 1000, 120))
    page('b13-present.html', 'Present on the wall (Room profile)',
         'P, or Present in the drawer\'s Session row. The dock keeps only the status line and the HOST badge; no toasts, no buttons. The redesigned default is already close to this, which is the point.',
         [screen(inner)],
         [(1, 'The only host trace is a number', 'The badge keeps counting. Pressing \\ or HOST leaves Present and opens the drawer in one move.'),
          (2, 'The wall gets state changes, never toasts', 'A join raises the count; a Claude post joins the ticker; a preview lands as the screenshot. That is the projector-safe version of every notice, and the stage already draws it.')])


def p_b14():
    inner = (rail('build', 'Building', 'Ask 2 decided · 3 asks so far') + building_main().replace('<div class="main">', '<div class="main" style="padding-top:74px">', 1)
             + '<div class="hostbar"><b>The live connection dropped.</b><span class="hint" style="color:var(--text)">Changes still save. It retries on its own.</span><span class="btn btn--sm push">Reconnect</span></div>'
             + dock('Claude is building the shift calendar', 'Reconnecting… the room is not seeing new changes yet', dbtn('Reconnect', 'primary'), badge=2)
             + pin(1, 600, 96) + pin(2, 1180, 790))
    page('b14-connection.html', 'Connection dropped',
         'The one alert that is not a toast: it stays until it is fixed. Signed out reads "Signed out · Sign in again", no internet "No internet · Try again", as today\'s ConnectionChip.',
         [screen(inner)],
         [(1, 'A host bar under the rail', 'Host-only (hidden in Present). It replaces today\'s connection chip and the error bar; the copy is ConnectionChip\'s, unchanged.'),
          (2, 'Reconnect takes the primary', 'Until the socket is back, nothing else the host does reaches the room. When it returns the bar goes and a short toast says "Back online".')])


# ── A: two screens ─────────────────────────────────────────────────────────

def console(decide=False):
    stage_thumb = ('<div style="border:1px solid var(--m-rule);border-radius:10px;overflow:hidden;background:var(--bg)"><div style="display:flex;justify-content:space-between;padding:6px 10px;font-size:12px;color:var(--muted);border-bottom:1px solid var(--m-rule)"><span>The stage window · what the room sees</span><span>on the projector</span></div>'
                   '<div style="padding:10px 12px;display:flex;flex-direction:column;gap:8px"><b style="font:800 17px/1.2 var(--font-display)">Which header should volunteers see first?</b>'
                   '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><img src="img/choice-a.svg" alt="" style="width:100%;border-radius:6px"><img src="img/choice-b.svg" alt="" style="width:100%;border-radius:6px"></div></div></div>')
    now = ('''<div class="card"><div class="row"><span class="chip chip--green">Results</span><b>Ask 3 · Which header should volunteers see first?</b></div>
<div class="row"><span class="L" style="width:30px;height:30px;font-size:18px">A</span><span>Bold banner</span><b class="push">4 · 27%</b></div>
<div class="row"><span class="L L--b" style="width:30px;height:30px;font-size:18px">B</span><span>Calm photo + calendar</span><b class="push">11 · 73%</b></div>
<span class="lbl">Direction for Claude</span><textarea class="ta">Go with B: calm photo + calendar. Works on my old phone.</textarea>
<div class="row"><span class="fold is-in">B chosen</span><span class="fold is-in">+ Works on my old phone</span><span class="fold">+ Dates first</span><span class="btn btn--primary push">Send to Claude</span></div></div>''' if decide else
           '''<div class="card"><div class="row"><span class="chip chip--amber">Live</span><b>Ask 3 · Which header should volunteers see first?</b><span class="hint push">5 of 18</span></div>
<div class="row"><span class="L" style="width:30px;height:30px;font-size:18px">A</span><span>Bold banner</span><b class="push">2</b></div>
<div class="row"><span class="L L--b" style="width:30px;height:30px;font-size:18px">B</span><span>Calm photo + calendar</span><b class="push">3</b></div>
<div class="row"><span class="btn btn--ghost">Edit wording</span><span class="btn btn--ghost">Answer for the room</span><span class="btn btn--danger">Discard</span><span class="btn btn--primary push">Close and show results</span></div></div>''')
    left = f'''<div style="display:flex;flex-direction:column;gap:14px;min-width:0"><div class="h3">Now</div>{now}{stage_thumb}
<div class="card"><span class="lbl">Tell Claude</span><textarea class="ta" style="min-height:52px" placeholder="What should Claude do next?"></textarea><div class="row"><span class="btn btn--primary">Send to Claude</span><span class="btn">Preview the work</span><span class="btn btn--ghost push">Ask the room</span></div></div></div>'''
    mid = '''<div style="display:flex;flex-direction:column;gap:12px;min-width:0"><div class="h3">Needs you</div>
<div class="card card--prop"><div class="row"><span class="chip chip--amber">Proposed by Claude</span><span class="hint push">waiting 40s</span></div><b>Ask 4 · Rate: How easy is sign-up now?</b><div class="row"><span class="btn btn--sm btn--ghost">Edit</span><span class="btn btn--sm btn--primary push">Open to the room</span></div></div>
<div class="card"><div class="row"><b>Dee</b><span class="hint">idea · 2 min</span></div><span>Text a reminder the day before</span><div class="row"><span class="btn btn--sm">Send to Claude</span><span class="btn btn--sm btn--danger push">Dismiss</span></div></div>
<div class="card"><div class="row"><b>Sam</b><span class="chip chip--red">Needs a change</span></div><span>The 13:00 row should say full in red</span><div class="row"><span class="btn btn--sm push">Send to Claude</span></div></div>
<div class="h3" style="margin-top:6px">Claude Code</div><ul class="list"><li><span class="tm">now</span><span class="grow ell"><b>Editing</b> src/Header.jsx</span></li><li><span class="tm">40s</span><span class="grow ell">Running npm run build</span></li><li><span class="tm">1m</span><span class="grow ell">Reading src/App.jsx</span></li></ul></div>'''
    right = '''<div style="display:flex;flex-direction:column;gap:10px;min-width:0"><div class="tabs" style="padding:0"><span class="tab is-on">Notices</span><span class="tab">People</span><span class="tab">Record</span></div>
<ul class="list"><li><span class="unread"></span><span class="tm">10:47</span><span class="grow ell">Claude proposed ask 4</span></li><li><span class="unread"></span><span class="tm">10:46</span><span class="grow ell">Sam: needs a change</span></li><li><span class="tm">10:46</span><span class="grow ell">Claude is showing the calendar</span></li><li><span class="tm">10:45</span><span class="grow ell">Wen joined · 18 here</span></li><li><span class="tm">10:44</span><span class="grow ell">Dee sent an idea</span></li><li><span class="tm">10:43</span><span class="grow ell">Claude has your direction</span></li><li><span class="tm">10:41</span><span class="grow ell">Ask 2 decided</span></li></ul></div>'''
    head = f'''<header style="display:flex;align-items:center;gap:14px;padding:12px 20px;border-bottom:1px solid var(--m-rule)"><b style="font:800 19px var(--font-display)">{TITLE}</b><span class="hint">Code {CODE} · 18 here</span><span class="chip chip--green">Live</span><span class="chip chip--green">Claude connected</span><span class="btn btn--sm btn--ghost push">Open the stage window</span><span class="btn btn--sm btn--ghost">Wrap up</span><span class="btn btn--sm btn--ghost">Report</span><span class="btn btn--sm btn--danger">End</span></header>'''
    return f'<div class="scr scr--plain" style="grid-template-rows:auto 1fr">{head}<div style="display:grid;grid-template-columns:1.25fr 1fr .8fr;gap:22px;padding:18px 20px;min-height:0;overflow:hidden">{left}{mid}{right}</div></div>'


def p_a1():
    page('a1-console.html', 'Layout A: the host\'s control screen',
         'Two windows. The stage window (B13 without the dock: nothing but the room\'s view) goes to the projector or the screen share; the host keeps this console on the laptop. Every capability is open at once, because no one else sees it.',
         [console()],
         [(1, 'What it is good at', 'A host with an extended display, or on a video call sharing only the stage window, sees everything at once and never hides anything from the room.'),
          (2, 'What it costs', 'A mirrored projector, the most common room set-up, shows this console to everyone: it then needs Present, which is today\'s problem. A second window must be opened and dragged to the right display every session. Two layouts to build and keep in step.'),
          (3, 'What it would reuse', 'Every panel in it is a B drawer panel laid out in columns, so building B first loses nothing if A follows.')])


def p_a2():
    page('a2-console-decide.html', 'Layout A: deciding on the console', 'Results and the direction in the Now column; the stage window shows the results to the room meanwhile.',
         [console(True)], [(1, 'Same controls as B4', 'The sheet\'s sentence, chosen and fold-in chips, inline because there is room.')])


def p_a3():
    phone = f'''<div class="device" style="width:390px;height:844px;display:flex;flex-direction:column">
<div style="display:flex;align-items:center;gap:8px;padding:14px 16px;border-bottom:1px solid var(--m-rule)"><b>{TITLE}</b><span class="chip chip--green push">Live</span></div>
<div style="padding:14px 16px;display:flex;flex-direction:column;gap:12px;flex:1;overflow:hidden">
<div class="small-label">Now · Choose · Ask 3</div><div style="font:800 22px/1.2 var(--font-display)">Which header should volunteers see first?</div>
<div class="row"><span class="L" style="width:30px;height:30px;font-size:18px">A</span>Bold banner<b class="push">2</b></div><div class="row"><span class="L L--b" style="width:30px;height:30px;font-size:18px">B</span>Calm photo + calendar<b class="push">3</b></div>
<div class="hint">5 of 18 answered</div>
<div class="card card--prop"><b>Claude proposed ask 4</b><span class="hint">Rate: How easy is sign-up now?</span><span class="btn btn--sm btn--primary">Review</span></div>
<div class="card"><b>Dee sent an idea</b><span>Text a reminder the day before</span><div class="row"><span class="btn btn--sm">Send to Claude</span><span class="btn btn--sm btn--danger push">Dismiss</span></div></div>
</div><div style="padding:12px 16px;border-top:1px solid var(--m-rule)"><span class="btn btn--primary" style="width:100%;justify-content:center;min-height:52px;font-size:17px">Close and show results</span></div></div>'''
    html = f'<div style="display:flex;gap:40px;align-items:flex-start;padding:10px">{phone}</div>'
    page('a3-remote.html', 'Layout A: the host remote on a phone, laptop or tablet',
         'HostRemote (/remote) already exists for regular sessions: a status card, the "needs you" queue and one big primary in a sticky dock. A Build Room version would let a host with one mirrored laptop leave the laptop on the stage and run the room from their hand.',
         [html],
         [(1, 'Recommended as a later step, not instead of B', 'The remote solves the mirrored-projector problem better than any laptop layout can. It reuses B\'s drawer panels and the server routes the page already calls; see PLAN.md step 9.')])


# ── notices + scores ───────────────────────────────────────────────────────

def p_notices():
    rows = [
        ('Someone joined', 'Room', 'Ambient', 'Count on the stage meter; a toast batched every 20s ("Wen and 2 others joined"), fading', 'Count only (the meter)', 'People'),
        ('An idea arrived', 'Room', 'Info', 'Toast 8s with Send to Claude and Open Ideas; badge on Ideas', 'Nothing', 'Ideas'),
        ('Preview feedback', 'Room', 'Info', 'Batched per preview: "3 looked: 2 Looks good, 1 Needs a change"', 'Nothing', 'Ideas'),
        ('Everyone has answered', 'Room', 'Action', 'Dock status says it; Close turns amber. No toast', 'The dock status line (room-safe)', 'Dock'),
        ('Claude proposed an ask', 'Claude', 'Action', 'Toast with Review, and the dock waiting chip until handled. Sticky', 'The ask number only, if the dock shows', 'Asks'),
        ('Claude posted progress or a milestone', 'Claude', 'Ambient', 'No toast: the stage ticker shows it to everyone', 'The ticker', 'Record'),
        ('Claude is showing something (preview ready)', 'Claude', 'Info', 'Toast with Open (the link) and Show on the wall', 'The ticker and the screenshot', 'Record'),
        ('Claude has your direction', 'Claude', 'Ambient', 'Short toast "Claude has it", once delivered', 'Nothing', 'Claude'),
        ('Claude went quiet (connected, no call for 2 min while it was expected to act)', 'Claude', 'Info', 'Toast with Copy the Continue prompt', 'Stage says "Claude is building"', 'Claude'),
        ('A crew early look arrived', 'Crew', 'Action', 'Toast with Open; becomes the dock primary in crew mode', 'Nothing until shown', 'Crew'),
        ('Live connection dropped / signed out / offline', 'System', 'Alert', 'Host bar under the rail until fixed; Reconnect is the primary', 'Nothing', 'Bar'),
        ('An action failed', 'System', 'Alert', 'Toast with the server\'s sentence, stays until dismissed (today\'s error bar)', 'Nothing', 'Toast'),
    ]
    tr = ''.join(f'<tr><td><b>{a}</b></td><td>{b}</td><td>{c}</td><td>{d}</td><td>{e}</td><td>{f}</td></tr>' for a, b, c, d, e, f in rows)
    spec = toasts([
        toast('claude', 'C', 'Claude has a question for the room', 'Ask 4 · Rate · "How easy is sign-up now?"', '<span class="btn btn--sm btn--primary">Review</span><span class="btn btn--sm btn--ghost">Later</span>'),
        toast('room', 'D', 'Dee sent an idea', '"Text a reminder the day before"', '<span class="btn btn--sm">Send to Claude</span><span class="btn btn--sm btn--ghost">Open Ideas</span>'),
        toast('claude', 'C', 'Claude is showing the shift calendar', 'localhost:5173 · screenshot attached', '<span class="btn btn--sm">Open</span><span class="btn btn--sm btn--ghost">Show on the wall</span>', fade=True),
    ], more='+ 4 more in the drawer').replace('class="toasts"', 'class="toasts" style="position:static;width:400px"')
    after = f'''<div class="idx" style="padding-top:0">
<h2>Four tiers</h2>
<table class="cmp"><tr><th style="width:12%">Tier</th><th>Behaviour</th></tr>
<tr><td><b>Ambient</b></td><td>No interruption. Raises a count or a badge, and lands in the tab where it is handled. A join toast, if any, is batched and fades in 4s.</td></tr>
<tr><td><b>Info</b></td><td>A toast for 8s (paused while the pointer is over the stack), with the one action that answers it. Clicking the body opens the drawer on the right tab with the item highlighted.</td></tr>
<tr><td><b>Action</b></td><td>Something is waiting on the host. It takes the dock (primary or the waiting chip) and stays until it is handled. Its toast, if any, appears once.</td></tr>
<tr><td><b>Alert</b></td><td>Something is wrong. A host bar under the rail, or an error toast that does not fade. Never auto-dismissed.</td></tr></table>
<h2>Stacking, fading, acknowledging</h2>
<p><b>At most three toasts</b>, newest on top; a fourth pushes the oldest into "+ N more in the drawer". <b>Same-kind notices merge</b> ("Jo and Lee sent ideas"). Every toast has an X; <b>opening the tab a notice points to marks it read</b>, which clears its share of the HOST badge. Toasts sit top-right under the rail, and left of the drawer when it is open, so they never cover the dock or the drawer's controls. They use <code>role="status"</code> (alerts <code>role="alert"</code>), which is what <code>aria-live</code> on today's ClaudeActivity panel does.</p>
<h2>What the projector shows</h2>
<p><b>No toast is ever drawn in Present.</b> The room learns of every event through a change to the stage it already reads: the count rises, the ticker grows, the screenshot changes, the ask opens. Ideas and feedback carry a person's name and never reach the wall, as the inbox does not today. On a mirrored projector outside Present, toasts are visible, so they show names but never the private content of a proposed ask (only its kind and the question once the host chooses Review). See the owner question on this.</p>
<h2>Why there is no Notices tab</h2>
<p>A notice is a pointer to something that lives somewhere: an idea in Ideas, a join in People, a proposed ask in Asks, a post in Record. A sixth tab would hold a second copy of each. The badge and the toasts point; the tabs hold the thing. Layout A (a console with room to spare) does show a Notices feed, because there it costs nothing. Owner question 3 offers the tab as an option.</p>
<h2>Specimen</h2><div style="background:var(--bg);border-radius:10px;padding:20px;display:inline-block">{spec}</div>
<h2>Every notice</h2>
<table class="cmp"><tr><th>Event</th><th>From</th><th>Tier</th><th>Host sees</th><th>Wall sees</th><th>Handled in</th></tr>{tr}</table></div>'''
    page('notices.html', 'Notices', 'What triggers one, how they stack and fade, what the projector shows. A new component: the host page has no toast today (GameHostPage.jsx says so in a comment).', [], after=after)


def p_scores():
    after = '''<div class="idx" style="padding-top:0">
<p>Scoring is a <b>new mechanic</b> and is proposed, not built. Every rule below can be counted from rows that exist today: answers and votes are keyed by player name; suggestions, reasons and ideas carry the player's name; a decision records which options and suggestions were chosen; an idea records whether the host used it; preview feedback is an idea with AboutLogId.</p>
<h2>Three options for the owner</h2>
<table class="cmp"><tr><th style="width:16%">Option</th><th>Rules</th><th style="width:28%">What it rewards, and the risk</th></tr>
<tr><td><b>1 · Counts, no points</b></td><td>The People tab shows answers, ideas sent, ideas picked and feedback. No total, no rank, no scoreboard.</td><td>Shows the host who is taking part and who is quiet. Nothing to game. Nothing for the wall.</td></tr>
<tr><td><b>2 · Taking part and influence</b> (recommended if points are wanted)</td><td>Answer or vote: <b>1</b>. A suggestion or an idea: <b>2</b> (at most 3 counted per ask). Preview feedback: <b>1</b> (once per preview). Your suggestion wins the vote, or is chosen in the direction: <b>+5</b>. Your idea is sent to Claude or added to an ask: <b>+3</b>. Said out loud and logged by the host: no points.</td><td>Rewards giving ideas that move the build. The caps stop a flood of one-word suggestions. Points never depend on picking the option that won, so nobody is pushed to follow the crowd.</td></tr>
<tr><td><b>3 · Influence only</b></td><td>Only <b>+5</b> for a winning or chosen suggestion and <b>+3</b> for a used idea.</td><td>A short, sharp board. Quiet people who answer every ask score nothing, which works against the point of the room.</td></tr></table>
<h2>How it fits what exists</h2>
<p><b>The scoreboard</b> is Trivia and Call and Answer only (owner, 2026-09-25: "poll doesn't need it"). Showing Build Room points on the wall would extend it; the People tab works without it. If extended, it opens any time, shows totals as of the last decided ask, and keeps its three looks and its close button on the board (owner, 2026-09-26).</p>
<p><b>Anonymity.</b> Suggestions are anonymous on the wall. A +5 appearing on a named scoreboard right after a vote hints whose suggestion won, the same side effect the owner accepted for trivia scoring (2026-09-25). In the People tab, the host already sees who suggested what.</p>
<p><b>The report.</b> If points are on, the report could list the top contributors; if not, the participants list stays as it is.</p>
<h2>Questions this raises</h2>
<p>Points at all (1, 2 or 3)? On the wall (extend the scoreboard to Build Room) or the host's eyes only? In the report? Do crew builders get points for a merged piece?</p></div>'''
    page('scores.html', 'Players and scores', 'The People tab (B9) works with any of these. Option 2 is drawn there.', [], after=after)


def p_index():
    cards = ''.join(f'<a href="{f}"><i>{c}</i><b>{n}</b></a>' for f, c, n in PAGES[1:])
    after = f'''<div class="idx">
<h1>Build Room host: less on the screen, the right thing in front</h1>
<p>Design only (2026-10-05). Nothing in <b>src/</b> changes. Mockups use the shipped Warm Summit tokens, the Room profile ladder for the stage, and the laptop ladder for host controls, at 1440×900. Read <b>RATIONALE.md</b> for the attention model and <b>PLAN.md</b> for the build steps.</p>
<div class="rec"><b>Recommendation: Layout B.</b> One screen, built from the regular host stage's own parts: the room's rail on top, the stage in the middle, one dock with the next move at the bottom, and a host drawer with five tabs (People, Ideas, Claude, Asks, Record, plus Crew while it is on) opened with HOST or the backslash key. Things that arrive become notices that point into the drawer. Words the host must write (a direction, an answer for the room, a note to Claude) open as a sheet that grows out of the dock, so the results stay in view. Later, the same drawer panels power a Build Room remote on a phone, laptop or tablet (A3), which is what a host with a mirrored projector needs most.</div>
<h2>Today vs B, in numbers</h2>
<table class="cmp"><tr><th>State, 1440×900</th><th>Today</th><th>B</th></tr>
<tr><td>Height of the page</td><td>1260 to 1866px (scrolls)</td><td>900px in every state (no page scroll; only drawer lists scroll)</td></tr>
<tr><td>Controls in the header</td><td>11</td><td>0 (the rail is the room's: phase, title, join code)</td></tr>
<tr><td>Where the next move is</td><td>Anywhere from 163px to ~1100px</td><td>Always the dock primary, bottom right, with a key</td></tr>
<tr><td>Proposed ask arrives</td><td>Card pushes the stage to 878px</td><td>Toast plus dock chip; card in the drawer; stage stays</td></tr>
<tr><td>Panels open at once</td><td>6 to 8</td><td>The stage, plus at most one drawer tab</td></tr></table>
<h2>Every state</h2><div class="cards">{cards}</div>
<h2>How to view</h2><p>From the repo root: <code>python3 -m http.server 8131 --directory docs/design</code>, then open <code>http://localhost:8131/build-room-host-redesign/</code>. Each screen scales to the window. Rebuild with <code>python3 docs/design/build-room-host-redesign/_src/build.py</code>. <code>today/</code> holds the current page rendered from fixture state, for comparison.</p>
</div>'''
    page('index.html', 'Build Room host redesign', 'Overview, recommendation and every state.', [], after=after)


for fn in [p_index, p_today, p_b1, p_b2, p_b3, p_b4, p_b5, p_b6, p_b7, p_b8, p_b9, p_b10, p_b11, p_b12, p_b13, p_b14, p_a1, p_a2, p_a3, p_notices, p_scores]:
    fn()
print('built', len(PAGES), 'pages into', OUT)
