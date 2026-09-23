# -*- coding: utf-8 -*-
"""The participant's phone: joining an invite-only event (and the three ways
it can go wrong), the agenda between items, watching a presentation, the beat
when the host starts an engagement, and the day's end. Every page is the
shipped player shell (bar / stage / dock, three volumes) with agenda-phone.css
on top."""
from build import phone_page, write, bar, lookup, INFO, ICONS
from content import TITLE, CODE, ITEMS, TYPES, ENDS, AGENDA, BREAK, DAY, PLACE

HOST = "George Seib"


def svg(name, size=18):
    return (f'<svg width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
            f'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{ICONS[name]}</svg>')


WHERE = (f'<div class="ag-where"><span class="n">{CODE}</span><div class="t"><b>{TITLE}</b>'
         f'<span>Northwind Traders &middot; Thu 9 Oct, 9:00</span></div><button type="button">Change</button></div>')


def type_line(it, extra=""):
    icon, label = TYPES[it["type"]]
    who = f' &middot; {it["who"]}' if it.get("who") else ""
    if it["type"] == "break":
        return f'{svg(icon, 16)}<span>Back at {it["until"]}{extra}</span>'
    return f'{svg(icon, 16)}<span>{label}{who}{extra}</span>'


def agenda(states, extras=None, links=None, words=True, desc=False, default=""):
    extras = extras or {}
    links = links or {}
    out = []
    for it in AGENDA:
        n = it["n"] if it["n"] else "brk"
        st = states.get(n, default if it["type"] != "break" else "")
        cls = {"done": " is-done", "now": " is-now", "next": " is-now"}.get(st, "")
        word = {"done": '<span class="ag-st done">Done</span>', "now": '<span class="ag-st now">Now</span>',
                "next": '<span class="ag-st now">Next</span>',
                "later": '<span class="ag-st">Not started</span>'}.get(st, "") if words else ""
        go = ""
        if n in links:
            go = '<div class="go">' + "".join(
                f'<a class="ag-a" href="#">{svg(i, 16)}{t}</a>' for i, t in links[n]) + '</div>'
        d = f'<p class="ds">{it["desc"]}</p>' if desc and it.get("desc") else ""
        out.append(f'<li class="ag-it{cls}{" is-brk" if n == "brk" else ""}"><span class="at">{it["at"]}</span><div><div class="tt">{it["title"]}</div>'
                   f'<div class="ty">{type_line(it, extras.get(n, ""))}{word}</div>{d}</div>{go}</li>')
    return f'<ol class="ag-list" aria-label="Agenda">{"".join(out)}</ol>'


def build():
    # ---------------------------------------------------------- p-01 join ----
    SHARE = ('<p class="anon"><b>Reports are shared afterwards.</b> Everyone who came can see each item&rsquo;s '
             'report, with names. Survey results never show names.</p>')
    write("p-01-join-invite.html", phone_page("Join an invite-only event", f"""
{bar('Join a session', who=None)}
<main class="stage">
  {WHERE}
  <h1 style="font-size:var(--L-primary)">This event is invite-only.</h1>
  <p class="lede muted">Enter the passcode your host gave you.</p>
  <div class="field"><label class="lab" for="pc">Your passcode</label>
    <input class="inp ag-code6" id="pc" autocomplete="one-time-code" autocapitalize="characters" maxlength="7" value="K7QXPM" aria-describedby="pch">
    <p class="help" id="pch">Six letters and digits, on your card or in the message your host sent. A personal link or the card&rsquo;s QR code fills it in for you.</p></div>
  {SHARE}
</main>
<footer class="dock">
  <button class="btn">Join</button>
  <button class="btn ghost">I don&rsquo;t have a passcode</button>
</footer>
""", volume="act", phase="var(--muted)"), group="phone")

    # ---------------------------------------------------------- p-02 mismatch --
    write("p-02-join-mismatch.html", phone_page("Join — passcode not recognised", f"""
{bar('Join a session', who=None)}
<main class="stage">
  {WHERE}
  <h1 style="font-size:var(--L-primary)">This event is invite-only.</h1>
  <p class="lede muted">Enter the passcode your host gave you.</p>
  <div class="field"><label class="lab" for="pc">Your passcode</label>
    <input class="inp ag-code6 bad" id="pc" value="K7QXPN" aria-invalid="true" aria-describedby="jerr">
    <p class="err" id="jerr" role="alert">{INFO}<span>That passcode doesn&rsquo;t let anyone into {TITLE}. Check it against your card &mdash; passcodes never use 0, O, 1, I, L or 8.</span></p>
    <p class="ag-tries">2 more tries, then a 10-minute pause.</p></div>
</main>
<footer class="dock">
  <button class="btn">Try again</button>
  <button class="btn ghost">I don&rsquo;t have a passcode</button>
</footer>
""", volume="act", phase="var(--muted)"), group="phone")

    # ---------------------------------------------------------- p-03 in use ---
    write("p-03-join-in-use.html", phone_page("Join — passcode open on another phone", f"""
{bar('Join a session', who=None)}
<main class="stage">
  {WHERE}
  <h1 style="font-size:var(--L-primary)">This passcode is open on another phone.</h1>
  <p class="lede muted">One passcode lets one phone in. If that was you, move it here &mdash; the other phone stops following the event.</p>
  <div class="card"><div class="stat"><span class="k">Joined as</span><span class="v">Priya Raman</span></div>
    <div class="stat"><span class="k">Since</span><span class="v">8:52</span></div></div>
  <p class="help">Not you? Tell {HOST}, who invited you. They can give you a new passcode, and the old one stops working.</p>
</main>
<footer class="dock">
  <button class="btn">Move it to this phone</button>
  <button class="btn ghost">Cancel</button>
</footer>
""", volume="act", phase="var(--muted)"), group="phone")

    # ---------------------------------------------------------- p-04 paused ---
    write("p-04-join-paused.html", phone_page("Join — too many tries", f"""
{bar('Join a session', who=None)}
<main class="stage centre">
  <p class="lab">{TITLE} &middot; {CODE}</p>
  <h1 style="font-size:var(--L-primary)">Too many tries from this phone.</h1>
  <p class="lede muted">You can try again at <b style="color:var(--text)">9:06</b>. This page will bring the form back by itself.</p>
  <p class="help">Nothing is wrong with the event. If your passcode is not working, {HOST} (who invited you) can give you a new one in a few seconds.</p>
</main>
<footer class="dock">
  <button class="btn ghost">Use a different event code</button>
</footer>
""", volume="act", phase="var(--rule)"), group="phone")

    # ---------------------------------------------------------- p-05 agenda ---
    write("p-05-agenda.html", phone_page("Between items — the agenda", f"""
{bar(TITLE)}
<main class="stage">
  <p class="ag-when">Thu 9 Oct &middot; Harbour Room</p>
  <h1 style="font-size:var(--L-primary)">Nothing to do here.</h1>
  <p class="lede muted">Your phone switches by itself when the host starts the next item.</p>
  {agenda({1: "done", 2: "done", 3: "next"},
          links={1: [("chart", "See the results")], 2: [("slides", "Slides (PDF)")]})}
</main>
""", volume="rest", phase="var(--rule)"), group="phone")

    # ---------------------------------------------------------- p-05a before --
    # Decision 11: before the day the agenda can be read — times, titles,
    # presenters, descriptions — and nothing is active. An invite-only event's
    # agenda is shown only after the passcode (proposal, RATIONALE 11).
    write("p-05a-before.html", phone_page("Before the day — the agenda", f"""
{bar(TITLE)}
<main class="stage">
  <p class="ag-when">Thursday 9 October &middot; 9:00&ndash;{ENDS}</p>
  <h1 style="font-size:var(--L-primary)">{TITLE}</h1>
  <p class="lede muted">{PLACE}. Nothing opens before the day: each item starts when the host starts it, and this page follows along.</p>
  {agenda({}, desc=True, default="later")}
  <p class="help">You&rsquo;re in as Priya Raman. Keep this page, or your passcode, for the day.</p>
</main>
""", volume="rest", phase="var(--rule)"), group="phone")

    # ---------------------------------------------------------- p-09 break ----
    nxt = AGENDA[AGENDA.index(BREAK) + 1]
    write("p-09-break.html", phone_page("A break", f"""
{bar(TITLE)}
<main class="stage centre">
  <p class="lab">Break</p>
  <h1 style="font-size:var(--L-hero)">Back at {BREAK['until']}</h1>
  <p class="lede muted">{BREAK['desc']} Your phone switches by itself when the next item starts.</p>
  <div class="ag-next"><span>Next</span><b>{nxt['title']} &middot; {nxt['who']}</b></div>
  <p class="help" style="margin-top:14px">You&rsquo;re 4th on the day so far.</p>
</main>
""", volume="rest", phase="var(--rule)"), group="phone")

    # ---------------------------------------------------------- p-06 watching --
    # Decision 8: the talk runs from the presenter's own screen; the phone has
    # the reference copy when the host shared it.
    it2, it3 = ITEMS[1], ITEMS[2]
    write("p-06-watching.html", phone_page("A presentation is on", f"""
{bar(TITLE)}
<main class="stage">
  <p class="lab">Now &middot; 2 of 8 &middot; a talk</p>
  <h1 style="font-size:var(--L-primary)">{it2['title']}</h1>
  <p class="lede muted">{it2['who']} is presenting. <b style="color:var(--text)">Look up</b> &mdash; your phone switches by itself when there is something to answer.</p>
  <a class="ag-a ag-copy" href="#">{svg('slides', 18)}<span><b>Slides &mdash; open or save</b><small>A copy to follow along or keep &middot; PDF, 24 pages</small></span></a>
  <div class="ag-next"><span>Next</span><b>Trivia &middot; {it3['title']}</b></div>
</main>
""", volume="watch", phase="var(--rule)"), group="phone")

    # ---------------------------------------------------------- p-07 the beat --
    write("p-07-switching.html", phone_page("The host started trivia", f"""
{bar(TITLE + ' &middot; 3 of 8')}
<main class="stage ag-beat">
  <p class="ty">{svg('trivia', 20)}Trivia &middot; 3 of 8</p>
  <h1>{it3['title']}</h1>
  <p class="lede muted">Ten questions. Read each on the main screen, answer here &mdash; faster right answers score more.</p>
  <p class="ag-join"><i></i>You&rsquo;re in as Priya Raman. No code needed.</p>
</main>
""", volume="act", phase="var(--primary)"), group="phone")

    # ---------------------------------------------------------- p-08 the end --
    write("p-08-ended.html", phone_page("The event has ended", f"""
{bar(TITLE + ' &middot; Ended')}
<main class="stage">
  <p class="lab">That&rsquo;s the day</p>
  <h1 style="font-size:var(--L-primary)">Thanks for coming, Priya.</h1>
  <p class="lede muted">What {HOST.split()[0]} has shared is below. This page stays here until 7 Jan 2027.</p>
  <div class="card ag-day"><div class="stat"><span class="k">Your day</span><span class="v">4th of 38 <span class="muted" style="font-weight:600">&middot; 1,440 points</span></span></div></div>
  {agenda({}, extras={3: " &middot; you came 5th of 36", 6: " &middot; you came 2nd of 35"},
          links={1: [("chart", "See the results")], 2: [("slides", "Slides (PDF)")],
                 3: [("file", "Report (PDF)")], 4: [("file", "Report, no names (PDF)")],
                 6: [("file", "Report (PDF)")], 8: [("chart", "See the results")]},
          words=False)}
  <p class="help">Keep your passcode: it brings you back here, on this phone or another.</p>
</main>
""", volume="rest", phase="var(--rule)"), group="phone")
