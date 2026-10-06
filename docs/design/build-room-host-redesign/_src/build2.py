#!/usr/bin/env python3
"""Second pass of the Build Room host redesign (the c-pages and index.html).

Run:  python3 docs/design/build-room-host-redesign/_src/build2.py
It shares mock.css and adds v2.css. The first pass (build.py) is kept as
first-pass.html and the b-/a- pages.
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(HERE)
TITLE = 'Volunteer sign-up'
CODE = '4821'

PAGES = [
    ('index.html', '', 'Overview'),
    ('c0-model.html', 'C0', 'The model'),
    ('c1-host.html', 'C1', 'Host: Claude is building'),
    ('c2-claude-asks.html', 'C2', 'Host: Claude proposes'),
    ('c3-to-a-vote.html', 'C3', 'Host: ideas to a vote'),
    ('c3b-mockups.html', 'C3b', 'Host: the vote waits for mockups'),
    ('c4-live.html', 'C4', 'Host: the room is answering'),
    ('c5-decide.html', 'C5', 'Host: results and direction'),
    ('c6-stage.html', 'C6', 'Stage screen'),
    ('c7-build.html', 'C7', 'Build screen'),
    ('c8-build-blocked.html', 'C8', 'Build screen, blocked'),
    ('c9-history.html', 'C9', 'History screen'),
    ('c10-artifacts.html', 'C10', 'History: artifacts'),
    ('c11-phones.html', 'C11', 'Phones'),
    ('c12-wrapped.html', 'C12', 'Wrapped and ended'),
    ('c13-library.html', 'C13', 'Ask the room: the question library'),
    ('c14-claude-gets.html', 'C14', 'What Claude gets, and the room brief'),
    ('c15-set-editor.html', 'C15', 'Making a set Build Room ready'),
]


def nav(current):
    out = ['<nav class="pg-nav"><b style="color:var(--muted)">Second pass</b>']
    for f, code, name in PAGES:
        cls = ' class="here"' if f == current else ''
        out.append(f'<a{cls} href="{f}">{(code + " ") if code else ""}{name}</a>')
    out.append('<span class="sp"></span><a href="first-pass.html">First pass</a><a href="notices.html">Notices</a><a href="scores.html">Scores</a></nav>')
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
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{code + " " if code else ""}{heading} · Build Room host</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;700;800&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="mock.css">
<link rel="stylesheet" href="v2.css">
</head>
<body>
{chr(10).join(body)}
<script src="mock.js"></script>
</body>
</html>
'''
    with open(os.path.join(OUT, fname), 'w') as fh:
        fh.write(html)


def pin(n, x, y):
    return f'<span class="pin" style="left:{x}px;top:{y}px">{n}</span>'


# ── the header ─────────────────────────────────────────────────────────────

def hdr(on='host', ask=None, queue=4, claude='Claude is building', results=False):
    views = [('host', 'Host', '1', queue), ('stage', 'Stage', '2', None), ('build', 'Build', '3', None), ('history', 'History', '4', None)]
    v = ''.join(
        f'<span class="view{" is-on" if k == on else ""}">{name}'
        f'{f"<span class=n>{n}</span>" if n else ""}<kbd>{key}</kbd></span>' for k, name, key, n in views)
    a = f'<span class="askpill{" askpill--results" if results else ""}">{ask}</span>' if ask else ''
    return (f'<header class="hdr"><span class="ttl">{TITLE}</span><div class="views">{v}</div>{a}'
            f'<span class="sp" style="flex:1"></span><span class="dotline dotline--claude">{claude}</span>'
            f'<span class="hjoin">Join <b>{CODE}</b> · 18 here</span><span class="menu" title="Connect Claude Code, Crew, Wrap up, Report, End session">···</span></header>')


# ── queue items ────────────────────────────────────────────────────────────

def ask_room_btn(label='Ask the room'):
    return f'<span class="split"><span class="btn btn--sm">{label}</span><span class="btn btn--sm">▾</span></span>'


Q_CLAUDE_ASK = '''<div class="q-item is-wait"><div class="q-top"><span class="srcdot srcdot--claude">C</span><span class="src">Claude asks the room</span><span class="chip chip--amber">Choose</span><span class="meta" style="margin-left:auto">Claude is waiting · 40s</span></div>
<div class="q-text q-text--big">Which header should volunteers see first?</div>
<div class="thumbs"><figure><img src="img/choice-a.svg" alt=""><figcaption><b>A</b> Bold banner</figcaption></figure><figure><img src="img/choice-b.svg" alt=""><figcaption><b>B</b> Calm photo + calendar</figcaption></figure></div>
<div class="q-acts"><span class="btn btn--sm btn--primary">Open to the room</span><span class="btn btn--sm">Answer for the room</span><span class="btn btn--sm btn--ghost">Edit</span><span class="btn btn--sm btn--link" style="margin-left:auto;color:var(--danger-text)">Discard</span></div></div>'''


def q_idea(who, text, meta, sel=False, kind='idea', chip=''):
    dot = {'room': '', 'you': ' srcdot--you', 'crew': ' srcdot--crew'}.get(kind, '')
    label = {'idea': f'{who} · idea', 'feedback': f'{who} · on the preview', 'you': 'You · note', 'said': 'The room said'}.get(kind, who)
    ch = f'<span class="chip {chip}">{"Needs a change" if chip == "chip--red" else ""}</span>' if chip else ''
    return f'''<div class="q-item{" is-sel" if sel else ""}"><div class="q-top"><span class="box{" on" if sel else ""}"></span><span class="srcdot{dot}">{who[0]}</span><span class="src">{label}</span>{ch}<span class="meta" style="margin-left:auto">{meta}</span></div>
<div class="q-text">{text}</div>
<div class="q-acts"><span class="btn btn--sm">Send to Claude</span>{ask_room_btn()}<span class="btn btn--sm btn--ghost">Later</span><span class="btn btn--sm btn--link" style="margin-left:auto;color:var(--muted)">Dismiss</span></div></div>'''


Q_DEE = q_idea('Dee', 'Text a reminder the day before', '2 min')
Q_SAM = q_idea('Sam', 'The 13:00 row should say full, in red', '1 min', kind='feedback', chip='chip--red')
Q_YOU = q_idea('You', 'Ask about a car park map once the calendar is done', '5 min', kind='you')
Q_JO = q_idea('Jo', 'Put the address and a map link at the top', 'now')
Q_CREW = '''<div class="q-item"><div class="q-top"><span class="srcdot srcdot--crew">A</span><span class="src">Ana · crew early look</span><span class="chip chip--green">Ready</span><span class="meta" style="margin-left:auto">3 min</span></div>
<div class="q-text">Reminder texts, on branch crew/ana-reminders</div>
<div class="q-acts"><span class="btn btn--sm">Open the early look</span><span class="btn btn--sm">Show on Build</span>''' + ask_room_btn() + '</div></div>'


def queue_col(items, count, filt='All', more=None, bulk=''):
    fl = ''.join(f'<span class="flt{" is-on" if f == filt else ""}">{f}</span>' for f in ['All', 'Claude · 1', 'Room · 3', 'You · 1', 'Crew · 1'])
    m = f'<div class="hint" style="text-align:center">{more}</div>' if more else ''
    return (f'<section class="col"><div class="colh"><h2>Waiting for you</h2><span class="count">{count}</span>'
            f'<span class="hint" style="margin-left:auto">Claude first, then oldest</span></div><div class="filters">{fl}</div>'
            f'{"".join(items)}{m}{bulk}</section>')


COMPOSER = '''<div class="composer"><span class="lbl" style="margin:0">Add something</span>
<textarea class="ta" placeholder="An idea, what the room said out loud, or a note for Claude"></textarea>
<div class="routes"><span class="btn btn--sm">Send to Claude</span>''' + ask_room_btn() + '''<span class="btn btn--sm btn--ghost">Queue it</span><span class="btn btn--sm btn--ghost" style="margin-left:auto" title="Into History as what the room said, nothing else">Log it</span></div></div>'''


def hist_compact(tab='History'):
    tabs = ''.join(f'<span class="tab{" is-on" if t == tab else ""}">{t}</span>' for t in ['History', 'People', 'Claude'])
    return f'''<section class="col"><div class="tabs" style="padding:0">{tabs}<span class="tab" style="margin-left:auto;color:var(--secondary)">Full screen · 4</span></div>
<ul class="hist">
<li><span class="tm">10:46</span><span class="pt pt--claude"></span><div class="bd"><b>Claude showed</b> the shift calendar<img src="img/preview.svg" alt=""><span class="sub">3 phones answered: 2 Looks good, 1 Needs a change</span></div></li>
<li><span class="tm">10:44</span><span class="pt pt--room"></span><div class="bd">Dee's idea <b>went to a vote</b><span class="chain"><span>Ask 2</span><i>→</i><span>9 of 14 picked it</span><i>→</i><span>sent to Claude</span></span></div></li>
<li><span class="tm">10:41</span><span class="pt pt--dec"></span><div class="bd"><b>Decided</b> · Ask 2: use the calm photo and the shift calendar<span class="sub">Claude has it · built it 10:46</span></div></li>
<li><span class="tm">10:38</span><span class="pt"></span><div class="bd">The room said: it has to work on old phones<span class="sub">Logged by you, sent to Claude</span></div></li>
<li><span class="tm">10:31</span><span class="pt pt--dec"></span><div class="bd"><b>Decided</b> · Ask 1: no account needed to sign up</div></li>
</ul></section>'''


def now_building():
    return '''<div class="now"><div class="colh"><h2>Now</h2><span class="dotline dotline--claude" style="margin-left:auto">building for 6 min</span></div>
<p class="nq">Claude is building the shift calendar</p>
<ul class="list"><li><span class="tm">now</span><span class="grow ell"><b>Editing</b> src/Header.jsx</span></li><li><span class="tm">40s</span><span class="grow ell">Running npm run build</span></li><li><span class="tm">1m</span><span class="grow ell">Reading src/App.jsx</span></li></ul>
<div class="row"><span class="btn btn--primary">Show the build</span><span class="btn">Preview the work</span><span class="hint" style="margin-left:auto">Stage shows: Claude is building</span></div></div>'''


def host_screen(now, queue, right=None, header=None, extra=''):
    return (f'<div class="scr2">{header or hdr()}<div class="host"><section class="col">{now}{COMPOSER}</section>'
            f'{queue}{right or hist_compact()}</div>{extra}</div>')


# ── pages ──────────────────────────────────────────────────────────────────

def p_c1():
    s = host_screen(now_building(), queue_col([Q_CLAUDE_ASK, Q_DEE, Q_SAM], 5, more='+ 2 more: your note, Ana\'s early look'))
    s = s[:-6] + pin(1, 470, 16) + pin(2, 466, 84) + pin(3, 466, 520) + pin(4, 2, 440) + pin(5, 1018, 84) + pin(6, 2, 52) + '</div>'
    page('c1-host.html', 'Host screen: Claude is building', 'The host\'s working screen. Everything that needs a decision is in one queue, whoever it came from. Everything that happened is in History. What is happening now is one card.',
         [s],
         [(1, 'Four screens in one header', '<b>Host · Stage · Build · History</b>, keys 1 to 4. This replaces Present: instead of hiding controls, the host chooses what the room looks at. P still works: it flips between Host and the last screen shown to the room.'),
          (2, 'One queue', 'Claude\'s proposed asks, ideas from phones, feedback on a preview, the host\'s own notes and crew early looks, in one list. Claude\'s asks sort first because Claude is waiting on them; the rest are oldest first. Filters narrow it by source.'),
          (3, 'Every item has the same routes', '<b>Send to Claude</b>, <b>Ask the room</b> (put it to a vote, ask for a rating, or ask for ideas on it), <b>Later</b>, <b>Dismiss</b>. A Claude ask adds Open to the room and Answer for the room. Tick several items to route them together (C3).'),
          (4, 'One composer for everything the host types', 'It replaces three forms on today\'s page: Tell Claude, the timeline\'s "Log what the room said" and the Ask the room buttons. Type once, then choose where it goes.'),
          (5, 'History beside the queue', 'Decisions and actions, newest first, with screenshots at the moment they arrived. Each entry shows its chain: idea, then vote, then sent to Claude, then built. Open History for the full screen (C9).'),
          (6, 'Now: what Claude or the room is doing', 'Between asks: Claude\'s live activity, with Show the build (switches the room to the Build screen) and Preview the work.')])


def p_c2():
    s = host_screen(now_building(), queue_col([Q_CLAUDE_ASK.replace('<div class="q-acts">', '<div class="inline-note row" style="font-size:13px"><span><b>Both options have a mockup.</b> Phones see the same pictures.</span></div><div class="q-acts">'), Q_DEE], 5, filt='All', more='+ 3 more'))
    s = s[:-6] + pin(1, 466, 150) + '</div>'
    page('c2-claude-asks.html', 'Host screen: Claude proposes an ask', 'Claude\'s ask arrives at the top of the queue, dashed amber because Claude is waiting. The Host tab counts it; on any other screen the header shows the count only.',
         [s],
         [(1, 'Review where the other items are reviewed', 'The proposed card is a queue item with its mockups. Edit opens today\'s review fields in place. "Ask Claude for mockups" appears when an option has no preview, as today.'),
          (2, 'On a projected screen', 'If the room is looking at Stage or Build when Claude asks, the Host tab badge goes up and nothing else changes on the wall. The question is never shown before the host opens it.')])


def p_c3():
    bulk = '''<div class="bulk"><b>3 selected</b><span class="btn btn--sm btn--primary">Put to a vote</span><span class="btn btn--sm">Ask for ratings</span><span class="btn btn--sm">Send all to Claude</span><span class="btn btn--sm btn--link" style="margin-left:auto;color:var(--muted)">Clear</span></div>'''
    q = queue_col([q_idea('Dee', 'Text a reminder the day before', '2 min', sel=True), q_idea('Jo', 'Put the address and a map link at the top', 'now', sel=True), q_idea('Lee', 'Let people sign up as a pair', '4 min', sel=True)], 5, filt='Room · 3', bulk=bulk)
    modal = '''<div class="scrim" style="bottom:0;z-index:60"></div><div style="position:absolute;z-index:61;left:50%;top:120px;transform:translateX(-50%);width:620px;background:var(--m-drawer);border:1px solid var(--m-rule);border-radius:14px;padding:18px 20px;display:flex;flex-direction:column;gap:12px;box-shadow:0 30px 70px rgba(0,0,0,.5)">
<div class="row"><h3 style="margin:0;font:800 19px/1.2 var(--font-ui)">Put 3 ideas to a vote</h3><span class="x push" style="width:32px;height:32px;display:grid;place-items:center;border:1px solid var(--m-rule);border-radius:8px;color:var(--muted)">×</span></div>
<label><span class="lbl">Question for the room</span><input class="in" value="Which should Claude build next?"></label>
<div><span class="lbl">How people vote <span style="color:var(--muted)">· Pick one is the default</span></span><div class="row"><span class="fold is-in">Pick one (A, B, C)</span><span class="fold">Pick up to 2</span><span class="fold">Rate each 1 to 5</span></div></div>
<ul class="list"><li><span class="L" style="width:26px;height:26px;font-size:15px;border-radius:6px">A</span><span class="grow">Text a reminder the day before</span><span class="who">Dee</span></li><li><span class="L L--b" style="width:26px;height:26px;font-size:15px;border-radius:6px">B</span><span class="grow">Put the address and a map link at the top</span><span class="who">Jo</span></li><li><span class="L L--c" style="width:26px;height:26px;font-size:15px;border-radius:6px">C</span><span class="grow">Let people sign up as a pair</span><span class="who">Lee</span></li></ul>
<p class="hint">Names are not shown to the room. When you decide, the winner goes to Claude as a direction and each idea is marked as used or not.</p>
<div class="row"><span class="switch on"><i></i>Ask Claude for a quick mockup of each first</span></div>
<div class="inline-note">The vote waits in your queue, hidden from the room, until Claude has made the mockups. Meanwhile you can ask the room other things. When they are in, the vote is marked Ready and you open it.</div>
<div class="row"><span class="btn btn--ghost">Cancel</span><span class="btn btn--primary push">Ask Claude for 3 mockups</span></div></div>'''
    modal_off = modal.replace('<div class="row"><span class="switch on"><i></i>Ask Claude for a quick mockup of each first</span></div>', '<div class="row"><span class="switch"><i></i>Ask Claude for a quick mockup of each first</span></div>')
    modal_off = modal_off[:modal_off.index('<div class="inline-note">The vote waits')] + '<div class="row"><span class="btn btn--ghost">Cancel</span><span class="btn btn--ghost push">Save as a draft</span><span class="btn btn--primary">Open to the room</span></div></div>'
    s = host_screen(now_building(), q, extra=modal)
    s_off = host_screen(now_building(), q, extra=modal_off)
    page('c3-to-a-vote.html', 'Host screen: send ideas to the room', 'Tick ideas in the queue and put them to a vote. Top: with mockups, the button becomes "Ask Claude for 3 mockups" and the vote waits (C3b). Bottom: without, it opens at once, or saves as a draft.',
         [s, s_off],
         [(1, 'The room votes on the room\'s ideas', 'Ideas become the options of a Choose ask, or a Rate ask per idea. Letters are assigned in the order shown. Names stay off the wall, as for suggestions today.'),
          (2, 'Mockups first means the vote waits', 'With the switch on there is no "Open to the room": the ask is created as a proposed ask (the room cannot see it), Claude gets the existing "make a mockup of each, attach it to its option" direction, and the vote sits in the queue until the pictures are in (C3b). The second switch opens it by itself when the last one arrives. If Claude is not connected the switch is off, with the reason.'),
          (3, 'What it needs that does not exist', 'A route to create an ask from ideas and mark them used (today an idea can only be added to an open Ideas ask). PLAN.md step 4.')])


def q_vote(state):
    if state == 'waiting':
        top = '<span class="chip chip--amber">Choose · Ask 4</span><span class="meta" style="margin-left:auto">Claude is making mockups · 1 of 3</span>'
        thumbs = ('<figure><img src="img/choice-a.svg" alt=""><figcaption><b>A</b> Text a reminder the day before</figcaption></figure>'
                  '<figure><span class="thumb--none" style="display:grid;place-items:center;aspect-ratio:640/336;border:1px dashed var(--m-rule);border-radius:7px;color:var(--muted);font-size:13px">Claude is making it</span><figcaption><b>B</b> Address and map link at the top</figcaption></figure>'
                  '<figure><span class="thumb--none" style="display:grid;place-items:center;aspect-ratio:640/336;border:1px dashed var(--m-rule);border-radius:7px;color:var(--muted);font-size:13px">Waiting</span><figcaption><b>C</b> Sign up as a pair</figcaption></figure>')
        note = '<div class="hint">The room cannot see it yet. It is marked Ready when all 3 are in; you open it.</div>'
        acts = '<span class="btn btn--sm btn--ghost">Open now, without the rest</span><span class="btn btn--sm btn--ghost">Edit</span><span class="btn btn--sm btn--link" style="margin-left:auto;color:var(--danger-text)">Cancel the vote</span>'
        cls = ' is-wait'
    else:
        top = '<span class="chip chip--green">Mockups ready</span><span class="chip chip--amber">Choose · Ask 4</span><span class="meta" style="margin-left:auto">3 of 3 · just now</span>'
        thumbs = ('<figure><img src="img/choice-a.svg" alt=""><figcaption><b>A</b> Text a reminder the day before</figcaption></figure>'
                  '<figure><img src="img/choice-b.svg" alt=""><figcaption><b>B</b> Address and map link at the top</figcaption></figure>'
                  '<figure><img src="img/preview.svg" alt="" style="aspect-ratio:640/336;object-fit:cover;object-position:top"><figcaption><b>C</b> Sign up as a pair</figcaption></figure>')
        note = '<div class="hint">Ask 5 is still open. Open next puts this vote on the room\'s screens as soon as you close ask 5.</div>'
        acts = '<span class="btn btn--sm btn--primary">Open next</span><span class="btn btn--sm">Close ask 5 and open this</span><span class="btn btn--sm btn--ghost">Edit</span><span class="btn btn--sm btn--link" style="margin-left:auto;color:var(--danger-text)">Discard</span>'
        cls = ' is-wait'
    return (f'<div class="q-item{cls}"><div class="q-top"><span class="srcdot srcdot--you">Y</span><span class="src">Your vote, from 3 ideas</span>{top}</div>'
            f'<div class="q-text q-text--big">Which should Claude build next?</div>'
            f'<div class="thumbs" style="grid-template-columns:1fr 1fr 1fr">{thumbs}</div>{note}<div class="q-acts">{acts}</div></div>')


def now_mockups():
    return '''<div class="now"><div class="colh"><h2>Now</h2><span class="dotline dotline--claude" style="margin-left:auto">making mockups</span></div>
<p class="nq">Claude is mocking up 3 ideas for the next vote</p>
<ul class="list"><li><span class="tm">now</span><span class="grow ell"><b>Editing</b> mockups/b-address.html</span></li><li><span class="tm">30s</span><span class="grow ell">Running npx playwright screenshot</span></li><li><span class="tm">50s</span><span class="grow ell"><b>Shared</b> Choice A onto ask 4</span></li></ul>
<div class="row"><span class="btn">Show the build</span><span class="hint" style="margin-left:auto">Stage shows: Claude is building</span></div></div>'''


def now_rate(n=7):
    return f'''<div class="now now--live"><div class="colh"><h2>Now</h2><span class="chip chip--amber">Rate · Ask 5</span><span class="hint" style="margin-left:auto">from Build Room starters</span></div>
<p class="nq">How close is this to something you would use?</p>
<div class="mini"><div class="r"><span class="L" style="background:var(--surface-2);color:var(--text)">4</span><span>Average so far</span><span class="tr"><span style="width:72%"></span></span><b>3.6</b></div></div>
<div class="row"><b>{n} of 18</b><span class="hint">answered</span><span class="hint" style="margin-left:auto">Claude gets it as: Keep in mind</span></div>
<div class="row"><span class="btn btn--primary">Close and show results</span><span class="btn">Answer for the room</span><span class="btn btn--ghost">Edit</span></div></div>'''


def p_c3b():
    waiting = host_screen(now_rate(7), queue_col([q_vote('waiting'), Q_SAM], 3, more='+ 1 more'), header=hdr(queue=3, ask='Ask 5 · 7 of 18', claude='Claude is making mockups'))
    waiting = waiting[:-6] + pin(1, 466, 84) + pin(2, 466, 330) + pin(3, 2, 52) + '</div>'
    ready = host_screen(now_rate(15), queue_col([q_vote('ready'), Q_SAM], 3, more='+ 1 more'), header=hdr(queue=3, ask='Ask 5 · 15 of 18'))
    ready = ready[:-6] + pin(4, 466, 84) + '</div>'
    page('c3b-mockups.html', 'Host screen: the vote waits in the queue while Claude makes mockups',
         'After "Ask Claude for 3 mockups" the vote goes into the queue, hidden from the room, and the host carries on: here the room is answering a starter question (ask 5) meanwhile. Top: one mockup of three is in. Bottom: all three are in while ask 5 is still open.',
         [waiting, ready],
         [(1, 'The vote is a proposed ask with empty pictures', 'It behaves like one of Claude\'s proposed asks today: the room cannot see it, each option fills in as Claude calls share_image with its askId and letter, and the card counts "1 of 3".'),
          (2, 'Ways out while it waits', '<b>Open now, without the rest</b> if Claude is slow (options without a picture show their words only, as today). <b>Edit</b> the question or the options. <b>Cancel the vote</b>: the ideas go back to the queue.'),
          (3, 'The host keeps the room busy', 'Nothing waits on Claude: the host asks other things, here a starter question from the library (C13).'),
          (4, 'Ready never interrupts', 'When all the pictures are in, the card turns green and says Ready. It never opens by itself. While another ask is open the host can choose <b>Open next</b> (it opens the moment ask 5 is closed) or <b>Close ask 5 and open this</b>.')])


def now_live():
    return '''<div class="now now--live"><div class="colh"><h2>Now</h2><span class="chip chip--amber">Choose · Ask 3</span><span class="hint" style="margin-left:auto">on the Stage</span></div>
<p class="nq">Which header should volunteers see first?</p>
<div class="mini"><div class="r"><span class="L">A</span><span>Bold banner</span><span class="tr"><span style="width:40%"></span></span><b>2</b></div><div class="r"><span class="L L--b">B</span><span>Calm photo + calendar</span><span class="tr"><span style="width:60%"></span></span><b>3</b></div></div>
<div class="row"><b>5 of 18</b><span class="hint">answered</span><span class="hint" style="margin-left:auto">Waiting on 13</span></div>
<div class="row"><span class="btn btn--primary">Close and show results</span><span class="btn">Answer for the room</span><span class="btn btn--ghost">Edit</span></div></div>'''


def p_c4():
    s = host_screen(now_live(), queue_col([Q_JO, Q_SAM, Q_YOU], 4, more='+ 1 more'), header=hdr(ask='Ask 3 · 5 of 18', queue=4, claude='Claude is waiting for the room'))
    s = s[:-6] + pin(1, 2, 52) + pin(2, 470, 16) + '</div>'
    page('c4-live.html', 'Host screen: the room is answering', 'The ask is on the Stage for the room; the host watches it in the Now card and keeps working the queue.',
         [s],
         [(1, 'The live ask is a card, not the page', 'Counts, Close, Answer for the room and Edit. Discard, Open voting (for an Ideas ask) and Reopen sit on the card too, under Edit.'),
          (2, 'The ask pill', 'Wherever the host is, the header says an ask is open and how many have answered. Clicking it goes to the Stage.')])


def now_results():
    return '''<div class="now now--results"><div class="colh"><h2>Now</h2><span class="chip chip--green">Results · Ask 3</span><span class="hint" style="margin-left:auto">15 of 18</span></div>
<p class="nq" style="font-size:20px">Which header should volunteers see first?</p>
<div class="mini"><div class="r"><span class="L">A</span><span>Bold banner</span><span class="tr"><span style="width:27%"></span></span><b>4</b></div><div class="r lead"><span class="L L--b">B</span><span>Calm photo + calendar</span><span class="tr"><span style="width:73%"></span></span><b>11</b></div></div>
<span class="lbl" style="margin:0">Direction for Claude</span><textarea class="ta" style="min-height:58px">Go with B: calm photo + calendar. Works on my old phone.</textarea>
<details class="acc"><summary>Adjust<span class="sum">B chosen · 1 reason folded in · sends to Claude</span></summary></details>
<div class="row"><span class="btn btn--primary">Send to Claude</span><span class="btn btn--ghost">Reopen</span></div></div>'''


def p_c5():
    s = host_screen(now_results(), queue_col([Q_JO, Q_SAM], 3, more='+ 1 more'), header=hdr(ask='Ask 3 · results', results=True, queue=3, claude='Claude is waiting for you'))
    page('c5-decide.html', 'Host screen: results and the direction', 'The Stage shows the results to the room; the host writes the sentence here. After Send, the decision lands in History and Now goes back to Claude building.',
         [s],
         [(1, 'Same controls as today\'s decide panel', 'Sentence prefilled from the winner; Chosen, Fold in, the note and Send to Claude on or off inside Adjust, with a summary line.'),
          (2, 'Reasons and suggestions can become queue items', 'A reason worth acting on can be sent to the queue from the results (for a later vote, or for Claude), so nothing said in a round is lost when the round ends.')])


def p_c6():
    main = '''<div class="stage2"><div class="main"><div class="content">
<div class="eyebrow">Choose <span>· Ask 3 · Claude asks</span></div>
<h2 class="q">Which header should volunteers see first?</h2>
<div class="choices">
<div class="choice"><div class="choice-h"><span class="L">A</span><b>Bold banner</b></div><img class="shot" src="img/choice-a.svg" alt="" style="max-height:280px"><div class="tally"><span class="track"><span style="width:20%"></span></span><b>2</b><span>20%</span></div></div>
<div class="choice"><div class="choice-h"><span class="L L--b">B</span><b>Calm photo + calendar</b></div><img class="shot" src="img/choice-b.svg" alt="" style="max-height:280px"><div class="tally"><span class="track"><span style="width:30%"></span></span><b>3</b><span>30%</span></div></div>
</div></div>
<aside class="meter"><span class="lbl">Answered</span><span class="big">5<small> / 18</small></span><span class="bar2"><span style="width:28%"></span></span><span class="says">Pick one on your phone, laptop or tablet.</span><div class="joinbox"><span class="qr"></span><p>Join<b>4821</b></p></div></aside></div>
<footer class="dock"><div class="status">5 of 18 have answered</div><span class="dbtn dbtn--ghost dbtn--sm">Answer for the room</span><span class="dbtn dbtn--primary">Close and show results</span><span class="kbd">SPACE</span></footer></div>'''
    s = f'<div class="scr2">{hdr("stage", ask="Ask 3 · 5 of 18")}{main}</div>'
    s = s[:-6] + pin(1, 600, 16) + pin(2, 1100, 790) + '</div>'
    page('c6-stage.html', 'Stage screen', 'What the room reads when there is an ask: the first pass\'s stage (B3), under the shared header. Room ladder. The host can switch here automatically when an ask opens (a setting).',
         [s],
         [(1, 'The header is on every screen', 'It is small and quiet, so the room can ignore it. The Host tab shows a count, never the content of what is waiting.'),
          (2, 'The dock keeps the one move', 'Close and Space, as on the regular stage, so a host presenting from the laptop never has to go back to Host to close an ask.')])


def p_c7():
    build = f'''<div class="build"><div class="urlbar"><div class="vtabs"><span class="vtab is-on">Latest build</span><span class="vtab">Choice A</span><span class="vtab">Choice B</span></div><span class="u">http://localhost:5173/  ·  served by Claude Code on this laptop</span><span class="btn btn--sm btn--ghost">Reload</span><span class="btn btn--sm btn--ghost">Open in a new tab</span></div>
<div class="frame"><img src="img/preview.svg" alt="The live dev server page"><div class="overlay-pill">Ask 3 is open · vote on your phone <b>5 / 18</b></div></div></div>'''
    s = f'<div class="scr2">{hdr("build", ask="Ask 3 · 5 of 18")}{build}</div>'
    s = s[:-6] + pin(1, 14, 70) + pin(2, 760, 70) + pin(3, 1120, 820) + '</div>'
    page('c7-build.html', 'Build screen: the live product', 'This is what Present becomes: the project Claude is building, live from its local dev server, framed under the Engage header so the host can switch back with one key.',
         [s],
         [(1, 'What to show', 'The newest local link Claude posted (a showing entry, Preview the work, or the wrap-up demo). During a Choose ask whose options have local links, Choice A and Choice B get their own tabs, so the room can see each one running.'),
          (2, 'It is the host\'s laptop', 'Only this laptop can open localhost. Phones get the screenshots (History, C10), never the link, as today (publicUrl strips local links).'),
          (3, 'The room still knows an ask is open', 'A small pill over the frame, room-safe: the count, never names.')])


def p_c8():
    body = '''<div class="blocked"><div><img src="img/preview.svg" alt="" style="width:100%;border-radius:12px;border:1px solid var(--m-rule)"><p class="hint" style="margin-top:8px">The newest screenshot Claude sent · 10:46</p></div>
<div style="display:flex;flex-direction:column;gap:14px"><h2 style="margin:0;font:800 28px/1.2 var(--font-display)">This browser will not show localhost inside Engage</h2>
<p style="margin:0;color:var(--muted);font-size:17px">Chrome and Edge ask once: "Allow access to devices on your local network". Choose Allow and reload. Safari does not allow it at all.</p>
<div class="row"><span class="btn btn--primary">Open the build in a new tab</span><span class="btn">Try again</span></div>
<p class="hint">In a new tab, press the Engage tab or Cmd+Tab to come back. Until then the room sees this screenshot.</p></div></div>'''
    s = f'<div class="scr2">{hdr("build")}{body}</div>'
    page('c8-build-blocked.html', 'Build screen when the browser refuses', 'Measured 2026-10-05: in Chromium 152 (the desktop app\'s browser pane), an https page framing http://localhost showed nothing, the request never reached the server, and no prompt appeared. The design needs this fallback until the owner\'s browsers are tested (PLAN step 0).',
         [s],
         [(1, 'Never a blank frame', 'If the frame does not load within a few seconds, the screen shows the newest screenshot and the two ways forward.'),
          (2, 'To check before building', 'Chrome\'s local network permission prompt; Safari; Firefox; a dev server that sends X-Frame-Options (Rails and Django do by default). See PLAN step 0.')])


STORY = '''<ul class="story">
<li><span class="tm">10:46</span><span class="pt pt--claude"></span><div class="bd"><span class="k">Claude showed</span>The shift calendar is up<div class="imgs"><img src="img/preview.svg" alt=""></div></div></li>
<li><span class="tm">10:44</span><span class="pt pt--dec"></span><div class="bd"><span class="k">Decided · Ask 2</span>Build reminder texts next<span class="chain" style="font-size:16px"><span>an idea from a phone</span><i>→</i><span>9 of 14 voted for it</span><i>→</i><span>Claude has it</span></span></div></li>
<li><span class="tm">10:31</span><span class="pt pt--dec"></span><div class="bd"><span class="k">Decided · Ask 1</span>Calm photo and the shift calendar<div class="imgs"><img src="img/choice-a.svg" alt=""><img src="img/choice-b.svg" alt="" style="outline:3px solid var(--secondary)"></div></div></li>
<li><span class="tm">10:22</span><span class="pt"></span><div class="bd"><span class="k">The room said</span>It has to work on old phones</div></li>
</ul>'''


def p_c9():
    side = '''<aside style="display:flex;flex-direction:column;gap:14px"><div class="filters"><span class="flt is-on">Everything</span><span class="flt">Decisions</span><span class="flt">Artifacts</span></div>
<div class="card"><span class="h3">Decided so far</span><ol style="margin:0;padding-left:20px;font-size:17px;line-height:1.5"><li>No account needed</li><li>Calm photo and the shift calendar</li><li>Reminder texts next</li></ol></div>
<div class="card"><span class="h3">Made so far</span><p style="margin:0;font-size:17px">8 screenshots · 2 previews · 14 ideas, 9 used</p></div></aside>'''
    body = f'<div class="histscreen">{STORY}{side}</div>'
    s = f'<div class="scr2">{hdr("history")}{body}</div>'
    page('c9-history.html', 'History screen', 'The session\'s story, for the room: every decision and the actions around it, with the artifacts at the moment they were made. Projectable at the Room ladder; the same story is on phones (C11) and in the report.',
         [s],
         [(1, 'Today\'s Timeline, grown up', 'The wall timeline already filters out host notes and system rows (WALL_HIDDEN_KINDS). History keeps that rule and adds screenshots inline and the chain from idea to vote to direction to build.'),
          (2, 'Look back on purpose', 'A host can bring the room back to a decision ("we picked this at 10:31") with one key. Clicking an entry in History on the Host screen jumps here to it.'),
          (3, 'Editing stays on the Host screen', 'Edit and delete (with the delete rule) are on the Host screen\'s History column, never on this one.')])


def p_c10():
    arts = [('preview.svg', 'The shift calendar', 'Claude · progress · 10:46'), ('choice-a.svg', 'Choice A: bold banner', 'Ask 1 mockup · 10:24'),
            ('choice-b.svg', 'Choice B: calm photo + calendar', 'Ask 1 mockup · chosen'), ('preview.svg', 'Spots left counting down', 'Claude · progress · 10:39'),
            ('choice-b.svg', 'Header, first try', 'Claude · progress · 10:18'), ('preview.svg', 'Sign-up without an account', 'Claude · progress · 10:12'),
            ('choice-a.svg', 'Early banner', 'Claude · progress · 10:08'), ('preview.svg', 'Preview link', 'localhost:5173 · on this laptop only')]
    g = ''.join(f'<div class="art"><img src="img/{i}" alt=""><div>{t}<span>{m}</span></div></div>' for i, t, m in arts)
    s = f'<div class="scr2">{hdr("history")}<div style="min-height:0;overflow:hidden"><div class="filters" style="padding:18px 36px 0"><span class="flt">Everything</span><span class="flt">Decisions</span><span class="flt is-on">Artifacts · 10</span></div><div class="grid-art">{g}</div></div></div>'
    page('c10-artifacts.html', 'History: artifacts', 'Every screenshot, mockup and link, newest first, each saying what it was for. Today\'s Screenshots panel, on a screen the room can look through, and on phones.',
         [s],
         [(1, 'Each artifact says what it was for', 'A mockup knows its ask and letter; a progress shot knows when it was sent. Clicking one opens it large, with the entry it belongs to.'),
          (2, 'Removing one', 'From the Host screen only, with today\'s delete rule (creator host, or a team owner or admin; staff give a reason).')])


def p_c11():
    ph1 = '''<div class="phone"><div class="ph-top"><b>Volunteer sign-up</b><div class="hint">Ask 4 · vote</div></div><div class="ph-body">
<div style="font:800 22px/1.2 var(--font-display)">Which should Claude build next?</div><p class="hint" style="margin:0">Ideas from the room. Pick one.</p>
<div class="ph-opt"><span class="L" style="width:30px;height:30px;font-size:17px;border-radius:7px">A</span>Text a reminder the day before</div>
<div class="ph-opt on"><span class="L L--b" style="width:30px;height:30px;font-size:17px;border-radius:7px">B</span>Put the address and a map link at the top</div>
<div class="ph-opt"><span class="L L--c" style="width:30px;height:30px;font-size:17px;border-radius:7px">C</span>Let people sign up as a pair</div>
<span class="btn btn--primary" style="justify-content:center;min-height:50px;font-size:17px">Send my vote</span></div>
<div class="ph-tabs"><span class="is-on">Now</span><span>Ideas</span><span>History</span></div></div>'''
    ph2 = '''<div class="phone"><div class="ph-top"><b>Volunteer sign-up</b><div class="hint">What we have built so far</div></div><div class="ph-body">
<div class="filters"><span class="flt is-on">Everything</span><span class="flt">Decisions</span><span class="flt">Pictures</span></div>
<ul class="hist"><li><span class="tm">10:46</span><span class="pt pt--claude"></span><div class="bd"><b>Claude showed</b> the shift calendar<img src="img/preview.svg" alt="" style="width:100%"><span class="row" style="margin-top:6px"><span class="btn btn--sm">Looks good</span><span class="btn btn--sm">Needs a change</span></span></div></li>
<li><span class="tm">10:44</span><span class="pt pt--dec"></span><div class="bd"><b>Decided</b> · Reminder texts next<span class="sub">Your idea was in this vote</span></div></li>
<li><span class="tm">10:31</span><span class="pt pt--dec"></span><div class="bd"><b>Decided</b> · Calm photo and the shift calendar</div></li></ul></div>
<div class="ph-tabs"><span>Now</span><span>Ideas</span><span class="is-on">History</span></div></div>'''
    ph3 = '''<div class="phone"><div class="ph-top"><b>Volunteer sign-up</b><div class="hint">Your ideas</div></div><div class="ph-body">
<textarea class="ta" placeholder="An idea for what to build or change"></textarea><span class="btn btn--primary" style="justify-content:center;min-height:48px">Send to the host</span>
<ul class="list"><li><span class="grow">Text a reminder the day before</span><span class="chip chip--blue">In a vote now</span></li><li><span class="grow">Bigger dates</span><span class="chip chip--green">Sent to Claude</span></li><li><span class="grow">Dark mode</span><span class="chip">With the host</span></li></ul></div>
<div class="ph-tabs"><span>Now</span><span class="is-on">Ideas</span><span>History</span></div></div>'''
    s = f'<div style="display:flex;gap:36px;padding:10px">{ph1}{ph2}{ph3}</div>'
    page('c11-phones.html', 'Phones: vote on ideas, look back, follow your ideas', 'Participants on a phone, laptop or tablet. Three tabs: Now (the current ask), Ideas (send one, see what happened to yours), History (decisions and pictures).',
         [s],
         [(1, 'Ideas come back to the room', 'A vote built from the room\'s ideas looks like any Choose ask. Names are not shown.'),
          (2, 'History and the artifacts on the phone', 'Phones already receive every screenshot in their state (publicView images). Today they show only option images and the finals; this adds the gallery and the story. Preview feedback moves onto the preview it is about.'),
          (3, 'What happened to my idea', 'Today a phone sees "With the host / Picked up / Not used this time". It gains "In a vote now" and "Sent to Claude".')])


def p_c12():
    side = '''<aside style="display:flex;flex-direction:column;gap:14px"><div class="card"><span class="h3">What we built</span><p style="margin:0;font-size:17px">A one-page sign-up for Saturday shifts. Pick a time, see spots left, no account needed.</p><span class="btn btn--primary">Open the demo</span></div>
<div class="card"><span class="h3">Decided</span><ol style="margin:0;padding-left:20px;font-size:17px;line-height:1.5"><li>No account needed</li><li>Calm photo and the shift calendar</li><li>Reminder texts next</li></ol></div>
<div class="card"><span class="h3">Next steps</span><p style="margin:0;font-size:17px">Hook up the real shift list</p></div></aside>'''
    s = f'<div class="scr2">{hdr("history", claude="Claude wrapped up", queue=None)}<div class="histscreen">{STORY}{side}</div></div>'
    page('c12-wrapped.html', 'Wrapped up, and ended', 'After wrap_up, History becomes the closing screen: the story on the left, what we built on the right. After End, the header reads "Session 4821 · closed" and the same screen stays editable for the host.',
         [s],
         [(1, 'The wrap-up is the end of the story', 'Today\'s WrappedStage content (summary, built, next steps, the demo link) moves into History\'s side column. The report is drawn from the same entries.')])


# ── C13 the question library ───────────────────────────────────────────────

LIB_THINK = [
    ('Who it is for', [
        ('Ideas', 'Who is this for, in one sentence?', 'Keep in mind'),
        ('Ideas', 'Who is this not for?', 'Keep in mind'),
        ('Ideas', 'Who did we forget?', 'Keep in mind'),
        ('Ideas', 'What job is someone hiring this to do?', 'Keep in mind')]),
    ('Think differently', [
        ('Ideas', 'How could we reach the same goal a completely different way?', 'Ask Claude'),
        ('Ideas', 'How would we do this with no app at all?', 'Ask Claude'),
        ('Ideas', 'Who has solved this already, in a different field?', 'Ask Claude'),
        ('Ideas', 'How would we make sure nobody ever used it?', 'Keep in mind'),
        ('Ideas', 'What would make this ten times better, not ten percent?', 'Later')]),
]

LIB = [
    ('Who it is for', [
        ('Ideas', 'Who is this for, in one sentence?', 'Keep in mind')]),
    ('Start', [
        ('Ideas', 'What does done look like by the end of today?', 'Keep in mind'),
        ('Ideas', 'What must it never do?', 'Keep in mind'),
        ('Ideas', 'It is launch day. Write the headline.', 'Keep in mind')]),
    ('While building', [
        ('Rate', 'How close is this to something you would use?', 'Keep in mind'),
        ('Ideas', 'What would stop someone using it?', 'Do now'),
        ('Ideas', 'What is confusing on the screen right now?', 'Do now'),
        ('Ideas', 'What should we cut?', 'Do now'),
        ('Rate', 'How clear is the main screen?', 'Keep in mind')]),
    ('Before wrapping up', [
        ('Ideas', 'A month from now, nobody uses it. Why?', 'Later'),
        ('Ideas', 'What should we build next time?', 'Later'),
        ('Rate', 'Would you use this tomorrow?', 'Keep in mind')]),
]


def lib_modal(lib, selected, right, groups_on='All'):
    rows = ''
    for grp, qs in lib:
        rows += f'<div class="h3" style="margin:8px 0 2px">{grp}</div><ul class="list">'
        for i, (kind, q, gets) in enumerate(qs):
            sel = ' style="background:var(--m-tint-amber);border-radius:8px;padding-left:8px"' if q == selected else ''
            chip = {'Ideas': 'chip--blue', 'Rate': 'chip--green', 'Choose': 'chip--amber'}[kind]
            rows += f'<li{sel}><span class="chip {chip}" style="width:62px;justify-content:center">{kind}</span><span class="grow ell">{q}</span><span class="who">{gets}</span></li>'
        rows += '</ul>'
    return f'''<div class="scrim" style="bottom:0;z-index:60"></div><div style="position:absolute;z-index:61;left:50%;top:76px;transform:translateX(-50%);width:1180px;height:790px;background:var(--m-drawer);border:1px solid var(--m-rule);border-radius:14px;display:grid;grid-template-rows:auto 1fr auto;box-shadow:0 30px 70px rgba(0,0,0,.5)">
<div class="row" style="padding:16px 20px;border-bottom:1px solid var(--m-rule)"><h3 style="margin:0;font:800 19px/1.2 var(--font-ui)">Ask the room</h3><span class="hint">Start from a ready question, or write your own</span><span class="x push" style="width:32px;height:32px;display:grid;place-items:center;border:1px solid var(--m-rule);border-radius:8px;color:var(--muted)">×</span></div>
<div style="display:grid;grid-template-columns:1fr 470px;min-height:0">
<div style="padding:14px 20px;overflow:hidden;border-right:1px solid var(--m-rule);display:flex;flex-direction:column;gap:8px">
<div class="row"><input class="in" style="flex:1" placeholder="Search ready questions"><span class="flt is-on">Starters and pulse · Engage</span><span class="flt">Discovery · your team</span><span class="flt">Write my own</span></div>
<div class="filters">{"".join(f'<span class="flt{" is-on" if g == groups_on else ""}">{g}</span>' for g in ["All", "Who it is for", "Start", "Think differently", "While building", "Wrapping up"])}</div>
{rows}</div>
{right}</div></div>
<div class="row" style="padding:10px 20px;border-top:1px solid var(--m-rule)"><span class="hint">Ready questions come from any Call and Answer or Poll set tagged build-room. Rate questions use a 1 to 5 scale; Choose up to 6 options.</span></div></div>'''


RIGHT_STOP = '''<div style="padding:14px 20px;display:flex;flex-direction:column;gap:12px">
<div class="row"><span class="chip chip--blue">Ideas</span><span class="hint">from Build Room starters · Call and Answer</span></div>
<label><span class="lbl">Question for the room</span><input class="in" value="What would stop someone using it?"></label>
<label><span class="lbl">Context (optional)</span><textarea class="ta" style="min-height:52px">Think of the busiest volunteer you know, on an old phone.</textarea></label>
<div><span class="lbl">When it is decided, Claude gets it as</span><div class="row"><span class="fold is-in">Do now</span><span class="fold">Keep in mind</span><span class="fold">Later</span><span class="fold">Ask Claude</span></div>
<p class="hint" style="margin-top:6px">Do now: the winning answer goes to Claude as the next thing to build. The rest go on the brief's Later list.</p></div>
<label><span class="lbl">Note for Claude (from the set, editable)</span><textarea class="ta" style="min-height:52px">Fix the top answer first. Say in one line what you changed.</textarea></label>
<div class="row" style="margin-top:auto"><span class="btn btn--ghost">Back</span><span class="btn btn--ghost push">Queue it</span><span class="btn btn--primary">Open to the room</span></div>'''

RIGHT_DIFF = '''<div style="padding:14px 20px;display:flex;flex-direction:column;gap:12px">
<div class="row"><span class="chip chip--blue">Ideas</span><span class="hint">from Build Room starters · Think differently</span></div>
<label><span class="lbl">Question for the room</span><input class="in" value="How could we reach the same goal a completely different way?"></label>
<label><span class="lbl">Context (optional)</span><textarea class="ta" style="min-height:52px">Forget what is on the screen. If we started again with the same goal, what would we build instead?</textarea></label>
<div><span class="lbl">When it is decided, Claude gets it as</span><div class="row"><span class="fold">Do now</span><span class="fold">Keep in mind</span><span class="fold">Later</span><span class="fold is-in">Ask Claude</span></div>
<p class="hint" style="margin-top:6px">Ask Claude: Claude says on the screen how it would build the winning approach and what it would cost, and keeps building the current one until the room decides.</p></div>
<label><span class="lbl">Note for Claude (from the set, editable)</span><textarea class="ta" style="min-height:76px">In a few lines, say how you would build the winning approach and what it would cost next to the current one. Do not switch unless a Do now says so.</textarea></label>
<div class="row" style="margin-top:auto"><span class="btn btn--ghost">Back</span><span class="btn btn--ghost push">Queue it</span><span class="btn btn--primary">Open to the room</span></div></div>'''


def p_c13():
    modal = lib_modal(LIB, 'What would stop someone using it?', RIGHT_STOP)
    modal2 = lib_modal(LIB_THINK, 'How could we reach the same goal a completely different way?', RIGHT_DIFF, 'Think differently')
    s2 = host_screen(now_building(), queue_col([Q_DEE, Q_SAM], 3), extra=modal)
    s2 = s2[:-6] + pin(1, 150, 150) + pin(2, 150, 230) + pin(3, 820, 330) + pin(4, 820, 450) + '</div>'
    s3 = host_screen(now_building(), queue_col([Q_DEE, Q_SAM], 3), extra=modal2)
    s3 = s3[:-6] + pin(5, 150, 196) + pin(6, 820, 400) + '</div>'
    page('c13-library.html', 'Ask the room: the question library',
         'Every "Ask the room" (the composer, a queue item, the empty Now card) opens here. Left: ready questions from sets tagged build-room, grouped by when in a session they help. Right: the chosen one, editable, with what Claude gets when it is decided.',
         [s2, s3],
         [(1, 'Ordinary question sets, tagged build-room', 'A Call and Answer question becomes an Ideas ask (everyone answers, then votes: the same shape). A Poll rating question on a 1 to 5 scale becomes a Rate ask; a Poll choice question with up to 6 options becomes Choose. Anything else in a set is not shown here. Sets come from the Engage library and from the host\'s team, as on the regular host shelf.'),
          (2, 'Grouped by when they help', 'The set\'s categories do the grouping (Start, While building, Before wrapping up), so a team can add its own groups without new fields.'),
          (3, 'Thinking tools, not just polls', 'Some starters borrow from known methods: the launch-day headline is Amazon\'s "working backwards", and "a month from now nobody uses it" is Gary Klein\'s pre-mortem. Each says where it comes from in the set, and nowhere on the wall.'),
          (4, 'The question carries how Claude should use the answer', 'Each ready question stores a default for what Claude gets (C14) and a short note for Claude. The host can change both before opening.'),
          (5, 'Who it is for, and Think differently', 'Two groups added at the owner\'s request: questions about the people (who it is for, who it is not for, who we forgot, the job they hire it to do) and questions that reframe the problem (the same goal a completely different way, no app at all, borrowed from another field, inversion, ten times better). Second screen.'),
          (6, 'Reframing answers go to Claude as Ask Claude', 'Claude says what the other approach would take and keeps building the current one. If the room wants to switch, the host puts "keep going" against "switch" to a Pick one vote with mockups first (C3b).')])


# ── C14 what Claude gets ───────────────────────────────────────────────────

def p_c14():
    menu = '''<div style="position:absolute;z-index:62;left:494px;top:330px;width:360px;background:var(--surface);border:1px solid var(--m-rule);border-radius:12px;box-shadow:0 20px 50px rgba(0,0,0,.5);padding:6px">
<div class="list" style="padding:0 6px">
<div style="padding:8px 4px;border-bottom:1px solid var(--m-rule)"><b>Do now</b><div class="hint">The next thing to build. Claude stops and does it.</div></div>
<div style="padding:8px 4px;border-bottom:1px solid var(--m-rule);background:var(--m-tint-amber);border-radius:6px"><b>Keep in mind</b><div class="hint">A rule or a fact for everything from now on. Goes on the brief; Claude does not stop.</div></div>
<div style="padding:8px 4px;border-bottom:1px solid var(--m-rule)"><b>Later</b><div class="hint">Something to build, not now. Goes on the brief's Later list.</div></div>
<div style="padding:8px 4px"><b>Ask Claude</b><div class="hint">A question. Claude answers on the screen and keeps building.</div></div></div></div>'''
    q_send = Q_SAM.replace('<span class="btn btn--sm">Send to Claude</span>', '<span class="split"><span class="btn btn--sm">Send to Claude</span><span class="btn btn--sm" style="border-color:var(--primary)">▾</span></span>', 1)
    brief = '''<section class="col"><div class="tabs" style="padding:0"><span class="tab">History</span><span class="tab">People</span><span class="tab is-on">Claude</span></div>
<div class="row"><span class="h3">The room brief</span><span class="hint push">Claude reads it on every call</span></div>
<div class="card" style="gap:6px"><span class="lbl" style="margin:0">Who it is for</span><div>Busy volunteers, often on an old phone</div></div>
<div class="card" style="gap:6px"><span class="lbl" style="margin:0">Keep in mind · 3</span><ul class="list"><li><span class="grow">No account needed to sign up</span><span class="who">Ask 1</span></li><li><span class="grow">Has to work on old phones</span><span class="who">the room said</span></li><li><span class="grow">Plain words, no jargon</span><span class="who">you</span></li></ul></div>
<div class="card" style="gap:6px"><span class="lbl" style="margin:0">Later · 2</span><ul class="list"><li><span class="grow">Let people sign up as a pair</span><span class="who">Lee</span></li><li><span class="grow">Car park map</span><span class="who">you</span></li></ul><div class="row"><span class="btn btn--sm">Put Later to a vote</span></div></div>
<div class="row"><span class="btn btn--sm btn--ghost">Edit the brief</span><span class="hint push">Saved for next time: offered at wrap-up</span></div></section>'''
    s2 = host_screen(now_building(), queue_col([q_send, Q_DEE], 3), right=brief, extra=menu)
    s2 = s2[:-6] + pin(1, 860, 330) + pin(2, 1018, 84) + pin(3, 1018, 560) + '</div>'
    term = '''<div class="idx" style="padding-top:0"><h2>What Claude sees for each kind (the plugin's text in its terminal)</h2>
<table class="cmp"><tr><th style="width:14%">Kind</th><th>Shown to Claude</th><th style="width:26%">Where it lives</th></tr>
<tr><td><b>Do now</b></td><td><code>DIRECTION FROM THE ROOM (via the host): The 13:00 row should say full, in red. Act on this now: it is the host's word and takes priority over your current plan.</code> (today's text, unchanged)</td><td>History; delivered once</td></tr>
<tr><td><b>Keep in mind</b></td><td><code>ADDED TO THE ROOM BRIEF (Keep in mind): Has to work on old phones. Apply it to everything you build from now on. You do not need to stop what you are doing.</code></td><td>The room brief, returned by room_status and repeated whenever it changes; the plugin also writes it to .engage/brief.md so it survives a long session</td></tr>
<tr><td><b>Later</b></td><td><code>FOR LATER: Let people sign up as a pair. Do not start it now. It is on the brief's Later list; when you finish your current work, say which Later item you would take next.</code></td><td>The brief's Later list, until it is done, voted on or removed</td></tr>
<tr><td><b>Ask Claude</b></td><td><code>THE ROOM ASKS YOU: How long would reminder texts take? Answer in one post_update (kind "answer"), then carry on.</code></td><td>History, question and answer together; the answer shows on the Stage ticker</td></tr></table>
<h2>Why a room brief and not Claude Code's own memory</h2>
<p>Claude Code's memory files (CLAUDE.md, auto memory) outlive the session and apply to everyone who opens the project. A room's preferences from one afternoon should not quietly become permanent rules for the repo. So the brief belongs to the Build Room, lives in Engage, is visible and editable on the host screen, and Claude re-reads it on every call. At wrap-up Claude offers the brief items worth keeping (for example "no accounts" is a product rule; "the room liked green" is not), and the host chooses which, if any, Claude writes into the project (a decisions file or CLAUDE.md).</p>
<h2>The best things to share with Claude</h2>
<table class="cmp"><tr><th style="width:24%">Information</th><th>Why it helps Claude</th><th style="width:16%">Kind</th></tr>
<tr><td><b>Who it is for</b></td><td>Every screen choice gets easier: reading level, device, how much time people have.</td><td>Keep in mind</td></tr>
<tr><td><b>What done looks like</b></td><td>Claude can tell when to stop polishing and wrap up.</td><td>Keep in mind</td></tr>
<tr><td><b>Rules: must and never</b></td><td>Saves rework: no accounts, works offline, no new dependencies.</td><td>Keep in mind</td></tr>
<tr><td><b>The room's choice, with its reasons</b></td><td>The reasons let Claude get the details right, not just the headline.</td><td>Do now</td></tr>
<tr><td><b>What is broken or confusing</b></td><td>Specific feedback on what Claude showed, tied to its screenshot.</td><td>Do now</td></tr>
<tr><td><b>Ideas worth keeping</b></td><td>A backlog Claude can propose from when it is free, instead of guessing.</td><td>Later</td></tr>
<tr><td><b>Questions about cost or effort</b></td><td>The room decides better knowing what is quick and what is not.</td><td>Ask Claude</td></tr>
<tr><td><b>A 1 to 5 pulse with its reasons</b></td><td>Tells Claude whether to keep polishing or move on.</td><td>Keep in mind</td></tr></table>
<p>Not worth sending: raw vote counts without the host's sentence (today's rule, kept: the direction decides), names of who said what, and anything the room said in confidence.</p></div>'''
    page('c14-claude-gets.html', 'What Claude gets, and the room brief',
         'Today everything sent to Claude says "act on this now". Four kinds instead, chosen from the Send to Claude menu on any queue item, the composer, or a decision; and a room brief that holds the standing ones.',
         [s2],
         [(1, 'Four kinds of message', '<b>Do now</b> (today\'s direction, still the default), <b>Keep in mind</b>, <b>Later</b>, <b>Ask Claude</b>. The split button keeps one click for Do now; the menu is for the other three.'),
          (2, 'The room brief', 'Who it is for, the standing rules, and the Later list. Decisions with Keep in mind land here; so do items the host adds. Claude reads it on every call, so a rule made at 10:20 still holds at 11:40.'),
          (3, 'Later feeds the next vote', 'The Later list can go straight to the room as a Pick one vote (C3), which closes the loop: ideas, kept for later, voted on, built.')],
         after=term)


# ── C15 the set editor ─────────────────────────────────────────────────────

def p_c15():
    body = '''<div style="padding:22px 28px;display:flex;flex-direction:column;gap:14px;min-height:0;overflow:hidden">
<div class="row"><span class="hint">Question sets</span><span class="hint">/</span><b style="font:800 22px/1.2 var(--font-display)">Build Room starters</b><span class="chip">Call and Answer</span><span class="chip chip--amber">build-room</span><span class="chip">business-work</span><span class="btn btn--sm btn--ghost push">Edit set details</span></div>
<p class="hint" style="font-size:15px">Short questions that help a room steer a build. Tagged build-room, so the Build Room's Ask the room lists them.</p>
<table class="tbl" style="font-size:15px"><colgroup><col style="width:150px"><col><col style="width:110px"><col style="width:150px"><col style="width:70px"></colgroup>
<thead><tr><th>Category</th><th>Question</th><th>In a Build Room</th><th>Claude gets</th><th></th></tr></thead><tbody>
<tr><td>Start</td><td>Who is this for, in one sentence?</td><td>Ideas</td><td>Keep in mind</td><td><span class="btn btn--sm btn--ghost">Edit</span></td></tr>
<tr><td>Start</td><td>What must it never do?</td><td>Ideas</td><td>Keep in mind</td><td><span class="btn btn--sm btn--ghost">Edit</span></td></tr>
<tr style="background:var(--m-tint-amber)"><td>While building</td><td>What would stop someone using it?</td><td>Ideas</td><td>Do now</td><td><span class="btn btn--sm">Close</span></td></tr></tbody></table>
<div class="card" style="gap:12px;border-color:var(--m-line-amber)">
<label><span class="lbl">Question</span><input class="in" value="What would stop someone using it?"></label>
<label><span class="lbl">Detail (shown under the question)</span><input class="in" value="Think of the busiest volunteer you know, on an old phone."></label>
<div class="h3" style="margin-top:4px">In a Build Room</div>
<div class="row"><span class="lbl" style="margin:0;width:200px">Asked as</span><span class="chip chip--blue">Ideas</span><span class="hint">Call and Answer questions are always Ideas: everyone answers, then votes.</span></div>
<div class="row"><span class="lbl" style="margin:0;width:200px">When decided, Claude gets it as</span><span class="fold is-in">Do now</span><span class="fold">Keep in mind</span><span class="fold">Later</span><span class="fold">Ask Claude</span></div>
<label><span class="lbl">Note for Claude</span><textarea class="ta" style="min-height:48px">Fix the top answer first. Say in one line what you changed.</textarea></label>
<label><span class="lbl">Where it comes from (shown to the host only)</span><input class="in" value=""></label>
<div class="row"><span class="btn btn--ghost">Cancel</span><span class="btn btn--primary push">Save question</span></div></div>
<div class="inline-note">In a Poll set tagged build-room, a 1 to 5 rating is asked as Rate and a choice of up to 6 options as Choose. A question that cannot be asked in a Build Room (a 1 to 10 scale, ranking, yes or no, free text) says so here and is left out of the list.</div>
</div>'''
    s2 = f'<div class="scr2" style="grid-template-rows:1fr">{body}</div>'
    page('c15-set-editor.html', 'Making a set Build Room ready',
         'In the admin console\'s question set editor (the shipped .qsets screen, drawn here only in outline). A set becomes Build Room ready with one tag; each question gains an "In a Build Room" section.',
         [s2],
         [(1, 'One tag, no new set type', 'build-room is an ordinary set tag (lowercase, up to 12 per set, edited in SetTopicField). The set stays a Call and Answer or Poll set and still plays as one in a regular session.'),
          (2, 'Two new question fields', '<b>Claude gets</b> (do-now, keep, later, ask; default do-now) and <b>Note for Claude</b>. In a team\'s set the note is encrypted like the other question text (tenant-crypto). Neither field matters outside a Build Room.'),
          (3, 'Asked as is derived, never typed', 'From the set type and the question kind, so it cannot disagree with the question.')])


def p_c0():
    after = '''<div class="idx" style="padding-top:0">
<h2>Where things come from, where they go</h2>
<div class="flow">
<div class="colx"><div class="bx"><b>Claude Code</b><span>asks it proposes · previews it shows · questions</span></div><div class="bx"><b>The room</b><span>ideas from phones · feedback on a preview · what people say out loud</span></div><div class="bx"><b>You</b><span>notes and ideas you type</span></div><div class="bx"><b>The crew</b><span>early looks · requests for help</span></div></div>
<div class="arrow">→</div>
<div class="colx"><div class="bx big"><b>The queue: waiting for you</b><span>one list, one set of routes for every item:</span></div>
<div class="bx"><b>Ask the room</b><span>open it · put several to a vote · ask for ratings · ask for ideas on it</span></div>
<div class="bx"><b>Send to Claude</b><span>as a direction, with your words</span></div>
<div class="bx"><b>Decide yourself</b><span>answer for the room (said out loud)</span></div>
<div class="bx"><b>Later · Dismiss</b><span>nothing is lost: dismissed items can be restored</span></div></div>
<div class="arrow">→</div>
<div class="colx"><div class="bx big"><b>History</b><span>every decision and action, with its artifacts, as a story</span></div><div class="bx"><b>On the wall</b><span>the History screen</span></div><div class="bx"><b>On phones</b><span>the History tab</span></div><div class="bx"><b>In the report</b><span>the same entries</span></div></div>
</div>
<h2>Four screens instead of Present</h2>
<table class="cmp"><tr><th style="width:12%">Screen</th><th>What it is</th><th style="width:30%">Who it is for</th></tr>
<tr><td><b>Host</b> · 1</td><td>Now card, the one composer, the queue, History in a column (C1 to C5)</td><td>The host. Fine for the room to glimpse; it is where the work happens.</td></tr>
<tr><td><b>Stage</b> · 2</td><td>The current ask or its results, big, with Close in the dock (C6)</td><td>The room, while an ask is open</td></tr>
<tr><td><b>Build</b> · 3</td><td>The live product from the local dev server, framed under the header (C7, C8)</td><td>The room, while Claude builds</td></tr>
<tr><td><b>History</b> · 4</td><td>The story so far, and the artifacts (C9, C10, C12)</td><td>The room, looking back; the close of the session</td></tr></table>
<p>The header is the same on all four: title, the four tabs, an ask pill when an ask is open, Claude's status, the join code (the QR on hover) and a menu with Connect Claude Code, Crew, Wrap up, Report and End session. P flips between Host and the last screen shown to the room.</p>
<h2>Projector rule</h2>
<p>Stage, Build and History are made to be seen. On them, anything waiting for the host shows only as a number on the Host tab. Names and the text of ideas, feedback and proposed asks appear only on the Host screen.</p></div>'''
    page('c0-model.html', 'The model', 'Three nouns (the queue, Now, History) and four screens. Everything else on today\'s page is one of these.', [], after=after)


def p_index():
    cards = ''.join(f'<a href="{f}"><i>{c}</i><b>{n}</b></a>' for f, c, n in PAGES[1:])
    after = f'''<div class="idx">
<h1>Build Room host, second pass</h1>
<p>Design only (2026-10-05, second round). Reworked from the owner's notes on the first pass:</p>
<ul style="color:var(--muted);max-width:86ch;line-height:1.6">
<li>Claude's and people's asks, ideas and input should queue up <b>together</b>.</li>
<li>Ideas should go to the room for feedback or a vote, and to Claude.</li>
<li>Present is not useful as it is. <b>Presenting is showing the live dev server.</b></li>
<li>The artifacts should be reviewable, by participants too.</li>
<li>The history of decisions and actions is worth keeping in front.</li></ul>
<div class="rec"><b>The shape:</b>
<ul style="margin:6px 0 0;padding-left:20px;line-height:1.6">
<li><b>One queue</b> for everything that needs a decision. Each item has the same routes: ask the room, send to Claude, decide yourself, later.</li>
<li><b>One composer</b> for everything the host types.</li>
<li><b>One History</b> of decisions and actions, with the artifacts inline. It is shown to the room, on phones and in the report.</li>
<li><b>Four screens</b> in one header: Host, Stage, Build (the live product) and History. Choosing what the room looks at replaces hiding controls.</li>
<li><b>Ready questions</b> from Call and Answer and Poll sets tagged build-room (C13, C15).</li>
<li><b>Four kinds of message to Claude</b> (Do now, Keep in mind, Later, Ask Claude) and a room brief Claude reads on every call (C14).</li></ul></div>
<p>What carries over from the first pass: the Stage screen is the first pass's stage, the dock's one next move, the notices tiers (<a href="notices.html">Notices</a>, now with the projector rule on C0) and the scoring options (<a href="scores.html">Scores</a>).</p>
<p>What the first pass got wrong:
<ul style="color:var(--muted);max-width:86ch;line-height:1.6">
<li>It kept ideas and Claude's asks in two places (an Ideas tab and an Asks tab).</li>
<li>It hid History in a Record tab.</li>
<li>It treated Present as a way to hide things rather than as a choice of what to show.</li></ul></p>
<h2>Every screen</h2><div class="cards">{cards}</div>
<h2>How to view</h2><p>From the repo root, <code>python3 -m http.server 8131 --directory docs/design</code>, then <code>http://localhost:8131/build-room-host-redesign/</code>. Add <code>#s1</code> to a page for the screen alone. Rebuild with <code>python3 docs/design/build-room-host-redesign/_src/build2.py</code>.</p></div>'''
    page('index.html', 'Build Room host redesign', 'Second pass: one queue, one History, four screens.', [], after=after)


for fn in [p_index, p_c0, p_c1, p_c2, p_c3, p_c3b, p_c4, p_c5, p_c6, p_c7, p_c8, p_c9, p_c10, p_c11, p_c12, p_c13, p_c14, p_c15]:
    fn()
print('built', len(PAGES), 'second-pass pages')
