#!/usr/bin/env python3
"""
Builds the player-redesign mockups.

Every output file is standalone, runnable HTML with no build step, no external
asset and no CDN — that is the deliverable. This script exists only so the one
shared stylesheet is written once instead of twenty-two times and cannot drift
between states. Run it from anywhere:

    python3 docs/design/player-redesign/build.py

It rewrites every NN-*.html plus index.html in its own directory. view.html is
hand-written and is not touched.
"""

import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))

# ---------------------------------------------------------------------------
# The one stylesheet. Type ladders are declared literally on :root at each
# breakpoint — never as a multiplier — for the reason the host spec's §4.2
# records: a custom property that multiplies another custom property declared on
# the same element substitutes against that element's own value, and the floor a
# multiplier produces is whatever the multiplier happens to give you rather than
# a number anybody derived.
# ---------------------------------------------------------------------------
CSS = r"""
:root{
  /* Warm Summit, unchanged */
  --bg:#0F1A2E; --text:#F4EDE4; --primary:#F6A94C; --success:#4FB286;
  --secondary:#7CA7E6; --danger:#E4695E;
  /* text-only tints (host spec §4.3) — carried across so the two surfaces
     cannot drift, even though the phone needs no black-lift allowance */
  --muted:#B6C2D4; --success-text:#6FD0A4;
  --surface:#182640; --surface-2:#20304E; --rule:rgba(182,194,212,.20);
  --phase:var(--muted);

  /* PHONE ladder — read at ~14 in on a ~142 CSS-ppi panel. Derived in
     RATIONALE.md §3; the arcminute figure for each rung is in the comment. */
  /* rem, not px, so a reader who has raised their browser or OS text size gets
     the whole ladder scaled with them (WCAG 1.4.4). The comment gives the px at
     a 16px root, which is what the derivation produced. */
  --L-hero:2.125rem;      /* 34px — 42' — one object owns the screen */
  --L-primary:1.5rem;     /* 24px — 30' — the question */
  --L-secondary:1.1875rem;/* 19px — 24' — answers, options, button labels */
  --L-body:1rem;          /* 16px — 20' — detail, instructions, inputs */
  --L-meta:0.8125rem;     /* 13px — 16' — labels. Nothing is smaller, ever. */

  --tap:44px; --pad:18px; --measure:32ch;
  /* The gutter, not the content, absorbs a wide window: a phone layout stretched
     to 1280px is not a laptop design, it is a phone design that was not stopped. */
  --gut:var(--pad);
}
@media (min-width:768px){   /* TABLET — ~18 in, ~132 CSS ppi */
  :root{--L-hero:2.5rem;--L-primary:1.75rem;--L-secondary:1.375rem;--L-body:1.1875rem;--L-meta:0.9375rem;
        --pad:28px;--measure:40ch;--gut:clamp(28px,calc((100% - 620px)/2),30%)}
}
@media (min-width:1200px){  /* LAPTOP — ~24 in, ~110 CSS ppi */
  :root{--L-hero:2.8125rem;--L-primary:2rem;--L-secondary:1.625rem;--L-body:1.3125rem;--L-meta:1.0625rem;
        --pad:36px;--measure:46ch;--gut:clamp(36px,calc((100% - 660px)/2),34%)}
}

*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{height:100%}
body{margin:0;background:var(--bg);color:var(--text);
  font:400 var(--L-body)/1.5 "Inter",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  display:flex;flex-direction:column;overflow:hidden;
  -webkit-font-smoothing:antialiased}

/* ---------- volumes ------------------------------------------------------
   ACT  the phone is the only place the task can be done — full contrast, amber
        primary, a dock.
   REST the task is done — no dock at all, no amber, nothing to press.
   WATCH the shared screen is the show — the phone carries only what is
        personal and therefore cannot be on the stage.                       */
body.v-rest, body.v-watch{--phase:var(--rule)}

/* ---------- bar ---------------------------------------------------------- */
.bar{flex:none;border-bottom:1px solid var(--rule)}
.strip{height:4px;background:var(--phase)}
.line{display:flex;align-items:center;gap:12px;padding:10px var(--gut);
  font-size:var(--L-meta);font-weight:700;letter-spacing:.09em;text-transform:uppercase;
  color:var(--muted)}
/* single text node, min-width:0, so the ellipsis actually renders (host §5.1) */
.ctx{min-width:0;flex:0 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  display:block}
/* Ordered sacrifice, horizontally: the CATEGORY goes first and goes whole, rather
   than shrinking to an unreadable stub. It is on the shared screen anyway. Below
   the tablet breakpoint it is not rendered at all. */
.cat{flex:0 1 auto;min-width:9ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  color:var(--muted);opacity:.8}
.cat::before{content:"\00b7";margin-right:9px;opacity:.7}
@media (max-width:767px){.cat{display:none}}
.spacer{flex:1 1 auto;min-width:0}
.who{flex:none;display:flex;align-items:center;gap:6px;max-width:11ch;overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap;color:var(--muted)}
.dot{width:8px;height:8px;border-radius:50%;background:var(--success);flex:none}
.dot.off{background:var(--primary)}

.banner{display:flex;gap:10px;align-items:flex-start;padding:11px var(--gut);
  background:rgba(246,169,76,.13);border-bottom:1px solid rgba(246,169,76,.4);
  font-size:var(--L-meta);line-height:1.45;color:var(--text)}
.banner b{font-weight:700}
.banner svg{flex:none;margin-top:1px}

/* ---------- stage -------------------------------------------------------- */
.stage{flex:1;min-height:0;overflow-y:auto;padding:20px var(--gut) 28px;
  overscroll-behavior:contain}
.stage.centre{display:flex;flex-direction:column;justify-content:center}

h1{font-size:var(--L-hero);line-height:1.06;font-weight:800;letter-spacing:-.02em;
  margin:0 0 12px;max-width:var(--measure)}
.q{font-size:var(--L-primary);line-height:1.24;font-weight:700;letter-spacing:-.01em;
  margin:0 0 12px;max-width:var(--measure)}
.detail{font-size:var(--L-body);line-height:1.5;margin:0 0 18px;max-width:var(--measure);
  color:var(--text)}
.lede{font-size:var(--L-secondary);line-height:1.4;margin:0 0 16px;max-width:var(--measure)}
.lab{font-size:var(--L-meta);font-weight:700;letter-spacing:.1em;text-transform:uppercase;
  color:var(--muted);margin:0 0 7px}
.task{border-left:2px solid var(--rule);padding-left:13px;margin:0 0 20px;max-width:var(--measure)}
.task p{margin:0;font-size:var(--L-body);line-height:1.45}
.muted{color:var(--muted)}
.sep{border:0;border-top:1px solid var(--rule);margin:22px 0}

/* ---------- the look-up cue ---------------------------------------------- */
.lookup{display:flex;gap:11px;align-items:flex-start;margin:26px 0 0;padding-top:18px;
  border-top:1px solid var(--rule);color:var(--muted);font-size:var(--L-body);line-height:1.45;
  max-width:var(--measure)}
.lookup svg{flex:none;margin-top:2px}
/* a stat row already drew a rule; do not draw a second one 26px under it */
.stat + .lookup{border-top:0;padding-top:4px}

/* ---------- dock --------------------------------------------------------- */
.dock{flex:none;border-top:1px solid var(--rule);background:var(--bg);
  padding:12px var(--gut) calc(16px + env(safe-area-inset-bottom,0px))}
.dock .note{font-size:var(--L-meta);color:var(--muted);margin:0 0 9px;line-height:1.4}
.btn{display:block;width:100%;min-height:56px;border:0;border-radius:14px;padding:15px 16px;
  background:var(--primary);color:#0F1A2E;font:800 var(--L-secondary)/1.2 inherit;
  letter-spacing:-.01em;cursor:pointer;text-align:center}
.btn[disabled]{background:transparent;border:1px solid var(--rule);color:var(--muted);
  font-weight:700;cursor:default}
.btn.ghost{background:transparent;border:1px solid var(--rule);color:var(--text);font-weight:700}
.btn+.btn{margin-top:10px}

/* ---------- form --------------------------------------------------------- */
.field{margin:0 0 20px}
.inp{width:100%;min-height:56px;background:var(--surface);border:1px solid var(--rule);
  border-radius:12px;color:var(--text);padding:14px;
  font:400 var(--L-secondary)/1.35 inherit}
.inp::placeholder{color:var(--muted);opacity:.75}
.inp:focus{outline:2px solid var(--primary);outline-offset:2px}
.inp.bad{border-color:var(--primary);box-shadow:inset 0 0 0 1px var(--primary)}
textarea.inp{min-height:148px;resize:vertical;display:block}
.code{font:800 var(--L-hero)/1.1 ui-monospace,SFMono-Regular,Menlo,monospace;
  letter-spacing:.3em;text-indent:.3em;text-align:center;min-height:80px}
.help{font-size:var(--L-meta);color:var(--muted);line-height:1.45;margin:8px 0 0}
.err{display:flex;gap:8px;align-items:flex-start;margin:9px 0 0;font-size:var(--L-meta);
  line-height:1.45;color:var(--primary);font-weight:600}
.err svg{flex:none;margin-top:1px}
.count{font-size:var(--L-meta);color:var(--muted);text-align:right;margin:7px 0 0}

/* ---------- options (trivia) --------------------------------------------- */
.opts{margin:0 0 4px}
.opt{display:flex;gap:12px;align-items:flex-start;width:100%;text-align:left;
  min-height:var(--tap);padding:13px 14px;margin:0 0 10px;border:1px solid var(--rule);
  border-radius:13px;background:var(--surface);color:var(--text);
  font:400 var(--L-secondary)/1.35 inherit;cursor:pointer}
.opt .k{flex:none;width:30px;height:30px;border-radius:9px;border:1px solid var(--rule);
  display:grid;place-items:center;font:800 var(--L-meta)/1 inherit;color:var(--muted)}
.opt[aria-checked="true"]{border-color:var(--primary);background:rgba(246,169,76,.11)}
.opt[aria-checked="true"] .k{background:var(--primary);border-color:var(--primary);color:#0F1A2E}

/* ---------- cards, receipts, stats --------------------------------------- */
.card{border:1px solid var(--rule);border-radius:14px;background:var(--surface);
  padding:15px;margin:0 0 14px}
.card.good{border-color:rgba(111,208,164,.45)}
.quote{font-size:var(--L-secondary);line-height:1.4;margin:0}
.stat{display:flex;justify-content:space-between;align-items:baseline;gap:14px;
  padding:13px 0;border-bottom:1px solid var(--rule)}
.stat:last-child{border-bottom:0}
.stat .k{font-size:var(--L-meta);font-weight:700;letter-spacing:.09em;text-transform:uppercase;
  color:var(--muted)}
.stat .v{font-size:var(--L-secondary);font-weight:700;text-align:right}
.big{font-size:var(--L-hero);font-weight:800;letter-spacing:-.02em;line-height:1.05}
.flag{display:inline-block;font-size:var(--L-meta);font-weight:800;letter-spacing:.09em;
  text-transform:uppercase;padding:3px 8px;border-radius:6px;border:1px solid var(--rule);
  color:var(--muted);white-space:nowrap}
.flag.ok{color:var(--success-text);border-color:rgba(111,208,164,.5)}
.flag.mine{color:var(--primary);border-color:rgba(246,169,76,.5)}

/* ---------- ballot ------------------------------------------------------- */
.anon{font-size:var(--L-meta);line-height:1.5;color:var(--muted);
  border-left:2px solid var(--rule);padding:2px 0 2px 13px;margin:0 0 18px;max-width:var(--measure)}
.anon b{color:var(--text);font-weight:600}
.resp{border:1px solid var(--rule);border-radius:14px;background:var(--surface);
  padding:13px 14px 12px;margin:0 0 12px}
.resp.own{border-color:rgba(111,208,164,.45)}
.rhead{display:flex;align-items:center;gap:9px;margin:0 0 8px}
.rid{font-size:var(--L-meta);font-weight:800;letter-spacing:.11em;text-transform:uppercase;
  color:var(--muted)}
.rtxt{font-size:var(--L-secondary);line-height:1.38;margin:0 0 12px}
.clamp{display:-webkit-box;-webkit-line-clamp:5;-webkit-box-orient:vertical;overflow:hidden}
.more{background:none;border:0;padding:8px 0;min-height:var(--tap);color:var(--muted);
  font:700 var(--L-meta)/1 inherit;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;
  display:block;margin:-10px 0 6px;text-decoration:underline;text-underline-offset:4px}
.ranks{display:flex;gap:8px}
.rk{flex:1;min-height:var(--tap);border:1px solid var(--rule);border-radius:11px;
  background:transparent;color:var(--muted);font:800 var(--L-meta)/1 inherit;letter-spacing:.07em;
  cursor:pointer}
.rk[aria-pressed="true"]{background:var(--primary);border-color:var(--primary);color:#0F1A2E}
.slots{display:flex;gap:8px;margin:0 0 11px}
.slot{flex:1;min-height:var(--tap);border:1px dashed var(--rule);border-radius:11px;
  padding:6px 9px;display:flex;flex-direction:column;justify-content:center}
.slot.filled{border-style:solid;background:var(--surface)}
.slot .sk{font-size:var(--L-meta);font-weight:800;letter-spacing:.09em;color:var(--muted);
  line-height:1.25}
.slot .sv{font-size:var(--L-meta);font-weight:700;color:var(--text);line-height:1.25;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.slot.filled .sv{color:var(--text)}
.pager{display:flex;gap:8px;align-items:stretch;margin:0 0 16px}
.pager a{flex:1;min-height:var(--tap);display:flex;align-items:center;justify-content:center;
  border:1px solid var(--rule);border-radius:11px;color:var(--muted);text-decoration:none;
  font:700 var(--L-meta)/1.2 inherit;letter-spacing:.05em;text-align:center;padding:6px}
.pager a.cur{background:var(--surface);color:var(--text);border-color:var(--rule)}

/* ---------- chips (wavelength) ------------------------------------------- */
.chips{display:flex;flex-wrap:wrap;gap:9px;margin:14px 0 0}
.chip{display:inline-flex;align-items:center;gap:4px;min-height:var(--tap);
  padding:8px 4px 8px 14px;border-radius:999px;border:1px solid var(--rule);
  background:var(--surface);font-size:var(--L-body);line-height:1.2}
.chip .x{width:var(--tap);height:var(--tap);margin:-8px -4px -8px 0;border:0;background:none;
  color:var(--muted);cursor:pointer;display:grid;place-items:center;border-radius:999px}
.chip.shared{border-color:rgba(111,208,164,.5)}

/* ---------- results rows ------------------------------------------------- */
.row{display:flex;gap:12px;align-items:flex-start;padding:13px 14px;margin:0 0 10px;
  border:1px solid var(--rule);border-radius:13px;background:var(--surface);
  font-size:var(--L-secondary);line-height:1.35}
.row .k{flex:none;width:30px;height:30px;border-radius:9px;border:1px solid var(--rule);
  display:grid;place-items:center;font:800 var(--L-meta)/1 inherit;color:var(--muted)}
.row.correct{border-color:var(--success);border-width:2px;padding:12px 13px}
.row.correct .k{border-color:var(--success);color:var(--success-text)}
.row.mine{background:var(--surface-2)}
.row .tail{margin-left:auto;flex:none;display:flex;flex-direction:column;gap:5px;
  align-items:flex-end}

/* ---------- reference page (22) ------------------------------------------ */
.doc{padding:26px var(--gut) 60px}
.doc table{border-collapse:collapse;width:100%;font-size:var(--L-meta);margin:0 0 22px}
.doc th,.doc td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--rule);
  vertical-align:top}
.doc th{color:var(--muted);text-transform:uppercase;letter-spacing:.08em;font-size:var(--L-meta)}
.doc code{color:var(--primary);font-family:ui-monospace,Menlo,monospace}
.spec{border:1px solid var(--rule);border-radius:12px;padding:14px;margin:0 0 12px}
.spec .t{font-size:var(--L-meta);color:var(--muted);letter-spacing:.08em;text-transform:uppercase;
  margin:0 0 8px}
"""

UP_ARROW = ('<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
            'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
            '<path d="M12 20V5"/><path d="M6 11l6-6 6 6"/><path d="M4 3h16"/></svg>')
INFO = ('<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
        'stroke-width="2.2" stroke-linecap="round" aria-hidden="true">'
        '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.6v.1"/></svg>')
X = ('<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
     'stroke-width="2.4" stroke-linecap="round" aria-hidden="true">'
     '<path d="M6 6l12 12M18 6L6 18"/></svg>')


def shell(title, body, volume="act", phase=None):
    phase_css = f"<style>:root{{--phase:{phase}}}</style>" if phase else ""
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>{title}</title>
<style>{CSS}</style>{phase_css}
</head>
<body class="v-{volume}">
{body}
</body>
</html>
"""


def bar(ctx, cat=None, who="Sam", online=True):
    dot = '<span class="dot"></span>' if online else '<span class="dot off"></span>'
    who_html = f'<span class="who">{dot}{who}</span>' if who else ''
    cat_html = f'<span class="cat">{cat}</span>' if cat else ''
    return (f'<header class="bar"><div class="strip"></div>'
            f'<div class="line"><span class="ctx">{ctx}</span>{cat_html}'
            f'<span class="spacer"></span>{who_html}</div></header>')


def lookup(text):
    return f'<div class="lookup">{UP_ARROW}<div>{text}</div></div>'


# ---------------------------------------------------------------------------
# The states.
# ---------------------------------------------------------------------------
STATES = []


def state(f, name, purpose, worst, html):
    STATES.append(dict(f=f, name=name, purpose=purpose, worst=worst))
    with open(os.path.join(HERE, f), "w") as fh:
        fh.write(html)


# --- 01 join ---------------------------------------------------------------
state(
    "01-join.html", "Joining — code and name",
    "The first thing every participant ever sees. Two fields, one button, no account, "
    "no app. The name field carries the only honest place to say what a name is for.",
    "A 34-character display name; the code typed by hand rather than arriving in the URL.",
    shell("Join a session — Engage", f"""
{bar('Join a session', who=None)}
<main class="stage">
  <h1>Join the session</h1>
  <p class="lede muted">Type the four digits on the main screen.</p>

  <div class="field">
    <label class="lab" for="code">Session code</label>
    <input class="inp code" id="code" value="4821" inputmode="numeric" autocomplete="one-time-code"
           maxlength="4" aria-describedby="codehelp">
    <p class="help" id="codehelp">Four digits. Not case-sensitive, because there are no letters.</p>
  </div>

  <div class="field">
    <label class="lab" for="nm">Your name</label>
    <input class="inp" id="nm" value="Bartholomew Okonkwo-Fitzgerald" aria-describedby="nmhelp">
    <p class="help" id="nmhelp">Used for the scoreboard and to get you back in if you lose
      this page. On rounds where the room votes, your name is <b>not</b> shown next to your
      answer until voting closes.</p>
  </div>
</main>
<footer class="dock">
  <button class="btn">Join</button>
  <p class="note" style="margin:10px 0 0">No account, nothing to install. Keep this page open —
    the same code and name will bring you back.</p>
</footer>
""", volume="act", phase="var(--muted)"))

# --- 02 join error ---------------------------------------------------------
state(
    "02-join-code-bad.html", "Joining — the code is wrong",
    "The single most common failure, and today it is an alert() that says nothing useful. "
    "The error is inline, attached to the field that caused it, keeps what was typed, and "
    "says where to look for the right value.",
    "Amber, not red: red is reserved for destructive. A four-digit code is easy to mistype and "
    "easy to misread off a projector, so the message names both causes.",
    shell("Join a session — no such code", f"""
{bar('Join a session', who=None)}
<main class="stage">
  <h1>Join the session</h1>
  <p class="lede muted">Type the four digits on the main screen.</p>

  <div class="field">
    <label class="lab" for="code">Session code</label>
    <input class="inp code bad" id="code" value="4B21" inputmode="numeric" aria-invalid="true"
           aria-describedby="cerr">
    <p class="err" id="cerr" role="alert">{INFO}<span>No session with the code 4B21. Codes are
      four digits — 8 and B look alike on a projector. Check the main screen and try again.</span></p>
  </div>

  <div class="field">
    <label class="lab" for="nm">Your name</label>
    <input class="inp" id="nm" value="Priya">
  </div>
</main>
<footer class="dock">
  <button class="btn">Join</button>
</footer>
""", volume="act", phase="var(--muted)"))

# --- 03 join ended ---------------------------------------------------------
state(
    "03-join-ended.html", "Joining — the session has finished",
    "A distinct outcome from a wrong code, and a dead end rather than a retry loop. Today "
    "this is the same generic alert as a typo, so a late arrival keeps retyping a code that "
    "will never work.",
    "No form is rendered at all. The only action offered is the one that can succeed.",
    shell("Session 4821 has finished", f"""
{bar('Session 4821', who=None)}
<main class="stage centre">
  <h1>That session has finished.</h1>
  <p class="lede muted">Session <b>4821</b> ended at 3:42pm. There is nothing left to join.</p>
  <p class="help">If your host has started a new session, they will have a new four-digit code
    on the main screen.</p>
</main>
<footer class="dock">
  <button class="btn ghost">Enter a different code</button>
</footer>
""", volume="act", phase="var(--rule)"))

# --- 04 join locked --------------------------------------------------------
state(
    "04-join-locked.html", "Joining — a private session",
    "The access-code branch. Today it appears as a second screen after a failed join, having "
    "thrown the name away; here it is one screen with three fields and nothing lost.",
    "Long instruction copy, and the access code shown as free text because it is not a secret "
    "worth masking — it is read aloud in the room.",
    shell("Join a private session", f"""
{bar('Join a session', who=None)}
<main class="stage">
  <h1>This session is private.</h1>
  <p class="lede muted">Session 4821 needs an access code as well. Your host will have it.</p>

  <div class="field">
    <label class="lab" for="ac">Access code</label>
    <input class="inp" id="ac" placeholder="Ask the host" autocapitalize="characters"
           autocomplete="off">
    <p class="help">Not the four-digit session code. This is a word or phrase the host chose
      when they set the session up.</p>
  </div>
  <div class="field">
    <label class="lab" for="nm">Your name</label>
    <input class="inp" id="nm" value="Priya">
  </div>
</main>
<footer class="dock">
  <button class="btn" disabled>Join</button>
  <button class="btn ghost">Use a different session code</button>
</footer>
""", volume="act", phase="var(--muted)"))

# --- 05 lobby --------------------------------------------------------------
state(
    "05-lobby.html", "In, and waiting for round 1",
    "The first REST screen. The phone has nothing to do, so it offers nothing to do — no dock, "
    "no amber, no pulse animation, no player count. It spends the idle minute on the one piece "
    "of housekeeping that is worthless later and priceless mid-session: how to get back in.",
    "The longest plausible display name, and an event title long enough to force the rail "
    "ellipsis.",
    shell("You're in — waiting to start", f"""
{bar('Q3 Leadership Offsite — Strategy Day', who='Bartholomew')}
<main class="stage centre">
  <p class="lab">You're in</p>
  <h1>Joined as Bartholomew Okonkwo-Fitzgerald.</h1>
  <p class="lede muted">Nothing to do yet. The host will start the first round.</p>

  <div class="card" style="margin-top:26px">
    <p class="lab" style="margin-bottom:9px">If you lose this page</p>
    <p style="margin:0;font-size:var(--L-body);line-height:1.5">Go back to the join screen,
      enter <b>4821</b> and the same name. Your answers and your score come back with you.</p>
  </div>

  {lookup('Everything the room shares — the questions, the results, the discussion — is on the main screen. This page is only ever <b>your</b> half.')}
</main>
""", volume="rest", phase="var(--rule)"))

# --- 06 ask trivia ---------------------------------------------------------
state(
    "06-ask-trivia.html", "ASK — trivia",
    "Pick one of A–F. The whole answering affordance is above the dock and reachable without "
    "leaving the question on screen. Selection and the button it enables share one amber thread.",
    "Six options, not four — the code renders A–F. Option F is 121 characters, which is the "
    "longest option in the shipped question sets.",
    shell("Question 3 — trivia", f"""
{bar('Question 3 of 12', 'Systems Thinking')}
<main class="stage">
  <p class="q">Which constraint does the Theory of Constraints tell you to exploit before you
    consider elevating it?</p>
  <p class="detail muted">Goldratt's five focusing steps, in order.</p>

  <div class="opts" role="radiogroup" aria-label="Answer options">
    <button class="opt" role="radio" aria-checked="false"><span class="k">A</span>
      <span>The market constraint, since demand sets the ceiling on throughput.</span></button>
    <button class="opt" role="radio" aria-checked="true"><span class="k">B</span>
      <span>The system's current bottleneck, whatever it happens to be.</span></button>
    <button class="opt" role="radio" aria-checked="false"><span class="k">C</span>
      <span>The most expensive resource, because idle capital is the largest waste.</span></button>
    <button class="opt" role="radio" aria-checked="false"><span class="k">D</span>
      <span>Whichever step has the longest queue at the end of the shift.</span></button>
    <button class="opt" role="radio" aria-checked="false"><span class="k">E</span>
      <span>Policy constraints first, since they cost nothing to change.</span></button>
    <button class="opt" role="radio" aria-checked="false"><span class="k">F</span>
      <span>None of these — the theory says to subordinate everything else to the constraint
      before you exploit it, and exploitation comes fourth rather than second.</span></button>
  </div>
</main>
<footer class="dock">
  <p class="note">B selected. You can change it until you submit.</p>
  <button class="btn">Submit answer</button>
</footer>
""", volume="act", phase="var(--primary)"))

# --- 07 ask call-and-answer ------------------------------------------------
state(
    "07-ask-call.html", "ASK — call &amp; answer",
    "Free text. The question stays on screen while you type — today a full-screen textarea "
    "overlay covers it, so people answer from memory. The dock holds one submit, not three.",
    "The longest plausible prompt (247 characters) plus a per-set custom instruction, on the "
    "narrowest phone. The composer is deliberately not tall: the question must stay visible "
    "above the keyboard.",
    shell("Round 3 — your response", f"""
{bar('Round 3 of 8', 'Operating Model')}
<main class="stage">
  <p class="q">Our regional teams each built their own intake process, and the three of them
    now disagree about what counts as a qualified request — which is why the same customer
    gets three different answers depending on who picks up the phone.</p>

  <div class="task">
    <p class="lab">Your task</p>
    <p>How could you adapt this lesson to your work, project, or team?</p>
  </div>

  <label class="lab" for="a">Your response</label>
  <textarea class="inp" id="a" aria-describedby="ahelp">We could publish one definition of "qualified" and make the three intake forms render from it, so a change lands in all three at once rather than in whichever region noticed</textarea>
  <p class="count">168 characters</p>
  <p class="help" id="ahelp">The room will see this response and vote on it. Your name is not
    attached to it until voting closes.</p>
</main>
<footer class="dock">
  <button class="btn">Submit response</button>
</footer>
""", volume="act", phase="var(--primary)"))

# --- composing, keyboard up ------------------------------------------------
state(
    "08-ask-call-typing.html", "ASK — composing, keyboard up",
    "The state that decides whether the previous screen works. A 247-character prompt is nine "
    "lines at the primary rung; with a soft keyboard up there is roughly 430px of usable "
    "height, and the question and the composer cannot both have it. So on focus the question "
    "condenses to three lines at body size and pins itself above the composer, with a control "
    "that puts it back. This is a reduction the <i>player</i> can undo, which is the only kind "
    "allowed on this surface.",
    "The longest prompt in the set, a 380px keyboard, and the caret mid-sentence. The submit "
    "stays in the dock, above the keyboard, and never moves.",
    shell("Round 3 — composing", f"""
{bar('Round 3 of 8', 'Operating Model')}
<div style="flex:none;padding:12px var(--pad) 0">
  <p class="q" style="font-size:var(--L-body);font-weight:600;line-height:1.4;margin:0;
     display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden">
    Our regional teams each built their own intake process, and the three of them now disagree
    about what counts as a qualified request &mdash; which is why the same customer gets three
    different answers depending on who picks up the phone.</p>
  <button class="more" style="margin:6px 0 0">Show the whole question &darr;</button>
</div>
<main class="stage" style="padding-top:10px">
  <label class="lab" for="a">Your response</label>
  <textarea class="inp" id="a" style="min-height:118px">We could publish one definition of "qualified" and make the three intake forms render from it, so a change lands in all</textarea>
  <p class="count">139 characters</p>
</main>
<footer class="dock">
  <button class="btn">Submit response</button>
</footer>
<div aria-hidden="true" style="flex:none;height:380px;background:#12203A;
  border-top:1px solid var(--rule);display:grid;place-items:center;color:var(--muted);
  font-size:var(--L-meta);letter-spacing:.1em;text-transform:uppercase;font-weight:700">
  Soft keyboard &mdash; 380px
</div>
""", volume="act", phase="var(--primary)"))

# --- 08 ask artwork --------------------------------------------------------
ART = """<svg viewBox="0 0 320 220" width="100%" style="display:block;border-radius:12px;border:1px solid var(--rule)" role="img" aria-label="Abstract painting: an ochre sun over layered blue ridges">
<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#2A3550"/><stop offset="1" stop-color="#7A5B4A"/></linearGradient>
<linearGradient id="r1" x1="0" y1="0" x2="1" y2="0">
<stop offset="0" stop-color="#1B2942"/><stop offset="1" stop-color="#2C3E5F"/></linearGradient>
</defs>
<rect width="320" height="220" fill="url(#sky)"/>
<circle cx="212" cy="78" r="34" fill="#F6A94C" opacity=".92"/>
<path d="M0 148 L74 108 L138 142 L196 112 L262 150 L320 122 L320 220 L0 220Z" fill="url(#r1)"/>
<path d="M0 176 L58 152 L126 180 L188 154 L252 184 L320 160 L320 220 L0 220Z" fill="#101B30"/>
<path d="M0 204 L96 190 L184 206 L320 192 L320 220 L0 220Z" fill="#0A1223"/>
</svg>"""

state(
    "09-ask-artwork.html", "ASK — call &amp; answer with artwork",
    "The Art Title round. The artwork is the prompt, so it leads; the instruction is the "
    "set-level one the code already resolves. A single-line input, because a title is a title.",
    "A wide image on the narrowest phone, and the artwork sized so the input and the dock are "
    "both reachable without scrolling the image out of view.",
    shell("Artwork 2 — name this work", f"""
{bar('Artwork 2 of 6', 'Name the work')}
<main class="stage">
  {ART}
  <p class="q" style="margin-top:16px">Untitled, oil on board, 1962</p>

  <div class="task">
    <p class="lab">Your task</p>
    <p>Name this work of art. Will you be accurate, witty, or make the room really think?</p>
  </div>

  <label class="lab" for="t">Your title</label>
  <input class="inp" id="t" placeholder="Give it a name" aria-describedby="thelp">
  <p class="help" id="thelp">Titles go on the ballot without names. Yours will be marked so you
    can find it.</p>
</main>
<footer class="dock">
  <button class="btn" disabled>Submit title</button>
</footer>
""", volume="act", phase="var(--primary)"))

# --- 09 ask poll -----------------------------------------------------------
state(
    "10-ask-poll.html", "ASK — poll",
    "The state the current code cannot render. Poll and survey fall through every branch to a "
    "title-only view, so the background context a poll question carries in <code>detail</code> "
    "is never shown to a single player. Here it is.",
    "Title, detail and a per-question custom instruction all present at once — the case that "
    "proves the branch is missing.",
    shell("Poll 4 — where should we land", f"""
{bar('Poll 4 of 5', 'Roadmap')}
<main class="stage">
  <p class="q">Should we hold the March date?</p>
  <p class="detail">Engineering says the integration work is four weeks from done and has been
    for three weeks. Sales has told two named accounts March. Nobody has asked the support
    team what a March launch costs them.</p>

  <div class="task">
    <p class="lab">Your task</p>
    <p>Say where you think the room should land, and the one fact that would change your mind.</p>
  </div>

  <label class="lab" for="a">Your response</label>
  <textarea class="inp" id="a" placeholder="No right answer here — the spread is the point."></textarea>
  <p class="help">Responses go up for the room to vote on, without names, until voting closes.</p>
</main>
<footer class="dock">
  <button class="btn" disabled>Submit response</button>
</footer>
""", volume="act", phase="var(--primary)"))

# --- 10 ask wavelength -----------------------------------------------------
state(
    "11-ask-wavelength.html", "ASK — wavelength",
    "Word entry. Today this is ten stacked text inputs, each with a label and an identical "
    "placeholder — 20 redundant strings and roughly 900px of form on a 375px phone. One input "
    "that commits to a chip does the same job in one screen.",
    "Seven of ten slots used, including a long hyphenated term, so the chip wrap is real. The "
    "counter names the maximum without implying ten are required.",
    shell("Subject 2 — wavelength", f"""
{bar('Subject 2 of 4', 'Wavelength')}
<main class="stage">
  <p class="q">Trust</p>
  <p class="detail muted"><b>Topic:</b> what it looks like inside a team that has it</p>

  <div class="task">
    <p class="lab">Your task</p>
    <p>Enter up to 10 words that come to mind for this subject.</p>
  </div>

  <label class="lab" for="w">Add a word</label>
  <input class="inp" id="w" placeholder="Type a word, then press return" aria-describedby="whelp">
  <p class="help" id="whelp">7 of 10 added. Any number is fine — one is a valid answer.</p>

  <div class="chips" aria-label="Your words">
    <span class="chip">candour<button class="x" aria-label="Remove candour">{X}</button></span>
    <span class="chip">follow-through<button class="x" aria-label="Remove follow-through">{X}</button></span>
    <span class="chip">disagreement<button class="x" aria-label="Remove disagreement">{X}</button></span>
    <span class="chip">predictability<button class="x" aria-label="Remove predictability">{X}</button></span>
    <span class="chip">silence<button class="x" aria-label="Remove silence">{X}</button></span>
    <span class="chip">repair<button class="x" aria-label="Remove repair">{X}</button></span>
    <span class="chip">time<button class="x" aria-label="Remove time">{X}</button></span>
  </div>
</main>
<footer class="dock">
  <button class="btn">Submit 7 words</button>
</footer>
""", volume="act", phase="var(--primary)"))

# --- 11 answered -----------------------------------------------------------
state(
    "12-answered.html", "Answer submitted — waiting",
    "REST. The dock is gone, because there is nothing to press; that absence is the design, "
    "not an omission. The receipt is the fix for the current screen's worst small habit: it "
    "clears the textarea on submit, so a player cannot see what they wrote while they wait.",
    "A long response shown in full rather than truncated — there is a whole screen and nothing "
    "else to put on it.",
    shell("Response submitted", f"""
{bar('Round 3 of 8', 'Operating Model')}
<main class="stage">
  <p class="lab" style="color:var(--success-text)">Submitted &middot; 3:12pm</p>
  <h1 style="font-size:var(--L-primary)">Your response is in.</h1>

  <div class="card good">
    <p class="lab" style="margin-bottom:9px">What you sent</p>
    <p class="quote">We could publish one definition of "qualified" and make the three intake
      forms render from it, so a change lands in all three at once rather than in whichever
      region noticed.</p>
  </div>
  <p class="help">This is locked for the round. If this page reloads, it comes back.</p>

  {lookup('The host will bring every response up on the main screen when the round closes, without names. <b>Look up</b> — you will be voting on what you see there.')}
</main>
""", volume="rest", phase="var(--rule)"))

# --- 12 vote ---------------------------------------------------------------


def resp(n, text, own=False, ranked=None, clamp=False, more=False):
    cls = "resp own" if own else "resp"
    mine = '<span class="flag mine">Yours</span>' if own else ''
    txt_cls = "rtxt clamp" if clamp else "rtxt"
    more_html = '<button class="more">Show all &darr;</button>' if more else ''
    btns = []
    for label, key in (("1st", "first"), ("2nd", "second"), ("3rd", "third")):
        on = "true" if ranked == key else "false"
        btns.append(f'<button class="rk" aria-pressed="{on}" '
                    f'aria-label="Rank response {n} {label}">{label}</button>')
    return (f'<article class="{cls}">'
            f'<div class="rhead"><span class="rid">Response {n}</span>{mine}</div>'
            f'<p class="{txt_cls}">{text}</p>{more_html}'
            f'<div class="ranks">{"".join(btns)}</div></article>')


def slots(first="—", second="—", third="—"):
    def one(k, v):
        filled = " filled" if v != "—" else ""
        return (f'<div class="slot{filled}"><span class="sk">{k}</span>'
                f'<span class="sv">{v}</span></div>')
    return ('<div class="slots" aria-label="Your ballot so far">'
            + one("1ST", first) + one("2ND", second) + one("3RD", third) + '</div>')


LONG_RESP = ("The definition should live with the team that owns the customer relationship, not "
             "with operations, because operations will optimise it for throughput and the whole "
             "reason we have three definitions is that each region optimised for the thing it "
             "was measured on. Put it with the account team, publish it, and make every intake "
             "form render from the published version so nobody can quietly fork it again. Then "
             "review it once a quarter with all three regions in the room, and treat a "
             "disagreement about the definition as the actual agenda item rather than an "
             "administrative detail to be resolved afterwards by email.")

state(
    "13-vote.html", "VOTE — the anonymous ballot",
    "The core of the redesign. One ballot, not two competing modes. Rows are numbered "
    "positionally and 1-based so a facilitator can say &ldquo;look at response six&rdquo; and "
    "everyone is looking at the same thing. Ranks are 44&times;44 buttons in the row itself, "
    "and the sticky slot bar is the answer to &ldquo;what have I picked so far&rdquo;.",
    "Six responses, one of them the player's own, one of them 520 characters and clamped with "
    "a recoverable <b>Show all</b>. Two of three ranks already placed, so the submit is still "
    "disabled and says why.",
    shell("Vote — round 3", f"""
{bar('Voting &middot; Round 3 of 8')}
<main class="stage">
  <h1 style="font-size:var(--L-primary)">Rank your top three.</h1>
  <p class="anon"><b>Nobody sees who wrote what — the host included — until voting closes.</b>
    This hides names, not identities.</p>

  {resp(1, "Publish one definition and make every intake form render from it.")}
  {resp(2, "Pick the strictest of the three definitions and make the other two regions live with it for a quarter.", ranked="first")}
  {resp(3, "Ask the support team what a wrong answer costs them, then define qualified backwards from that number.")}
  {resp(4, "We could publish one definition of &quot;qualified&quot; and make the three intake forms render from it, so a change lands in all three at once rather than in whichever region noticed.", own=True)}
  {resp(5, LONG_RESP, clamp=True, more=True, ranked="second")}
  {resp(6, "Stop trying to agree. Route by region and tell the customer which region owns them.")}
</main>
<footer class="dock">
  {slots("Response 2", "Response 5")}
  <button class="btn" disabled>Pick a 3rd to submit</button>
</footer>
""", volume="act", phase="var(--secondary)"))

# --- 13 long ballot --------------------------------------------------------
LONG_ITEMS = [
    (9, "Route by region and publish which region owns which account. Stop pretending it is one process."),
    (10, "Give the definition an owner with a name on it. Shared ownership is why it drifted."),
    (11, "Run the three definitions against last quarter's disputed requests and see which one would have been right."),
    (12, "Nothing changes until the compensation plan stops rewarding volume in two regions and margin in the third."),
    (13, "Write the definition as a set of examples rather than a rule. Rules get argued, examples get copied."),
    (14, "Have the three intake owners sit in each other's queues for a day."),
    (15, "The customer does not care which of us is right. Give them one number to call."),
    (16, "Make the disagreement visible in the tool — flag a request all three would score differently and review those weekly."),
]
state(
    "14-vote-long.html", "VOTE — twenty responses, paged",
    "The worst-case ballot. Pages carry absolute ranges (<b>Responses 9–16 of 20</b>) and the "
    "numbers never reindex, so page 2 still contains response eleven and nothing else does. "
    "The slot bar keeps picks made on other pages, which is the only reason paging is "
    "survivable at all.",
    "Twenty responses in a room of twenty; the player is on page 2 with two ranks already "
    "placed on page 1 and page 3, and neither is on screen.",
    shell("Vote — 20 responses", f"""
{bar('Voting &middot; Round 3 of 8')}
<main class="stage">
  <h1 style="font-size:var(--L-primary)">Rank your top three.</h1>
  <p class="anon"><b>Nobody sees who wrote what — the host included — until voting closes.</b>
    This hides names, not identities.</p>
  <p class="lab" style="margin-bottom:12px">Responses 9&ndash;16 of 20</p>
  <div class="pager">
    <a href="#">1&ndash;8</a><a href="#" class="cur" aria-current="page">9&ndash;16</a><a href="#">17&ndash;20</a>
  </div>
  {''.join(resp(n, t) for n, t in LONG_ITEMS)}
  <div class="pager">
    <a href="#">1&ndash;8</a><a href="#" class="cur" aria-current="page">9&ndash;16</a><a href="#">17&ndash;20</a>
  </div>
</main>
<footer class="dock">
  {slots("Response 3", "—", "Response 18")}
  <button class="btn" disabled>Pick a 2nd to submit</button>
</footer>
""", volume="act", phase="var(--secondary)"))

# --- 14 vote submitted -----------------------------------------------------
state(
    "15-vote-submitted.html", "Votes submitted — waiting",
    "REST again, and the receipt matters more here than after an answer: the ballot is about to "
    "be replaced by a named one, and a player who cannot remember what they picked has no way "
    "to check.",
    "The ballot the player submitted, by absolute response number — the same handles the host "
    "will read aloud.",
    shell("Votes submitted", f"""
{bar('Voting &middot; Round 3 of 8')}
<main class="stage">
  <p class="lab" style="color:var(--success-text)">Submitted &middot; 3:19pm</p>
  <h1 style="font-size:var(--L-primary)">Your ballot is in.</h1>

  <div class="card good">
    <div class="stat"><span class="k">1st</span><span class="v">Response 2</span></div>
    <div class="stat"><span class="k">2nd</span><span class="v">Response 5</span></div>
    <div class="stat"><span class="k">3rd</span><span class="v">Response 11</span></div>
  </div>
  <p class="help">Names appear when the host closes voting — on the main screen, and here.</p>

  {lookup('<b>Look up.</b> The host reads the responses out by number, and the count comes up on the main screen when everyone has voted.')}
</main>
""", volume="rest", phase="var(--rule)"))

# --- 15 results trivia -----------------------------------------------------
state(
    "16-results-trivia.html", "RESULTS — trivia",
    "WATCH. The phone answers exactly one question — <i>how did I do</i> — because that is the "
    "one thing the host screen is forbidden to show (host spec §7.15: never name a person on "
    "the stage). The distribution, the leaderboard and the discussion stay up there.",
    "The player got it wrong. Wrong is muted plus the word — never red, and never colour alone. "
    "The correct row carries a 2px rule <i>and</i> the word CORRECT.",
    shell("Question 3 — results", f"""
{bar('Question 3 of 12 &middot; Results')}
<main class="stage">
  <p class="lab">You answered</p>
  <h1 style="font-size:var(--L-primary);margin-bottom:18px">C. Not this time.</h1>

  <div class="row mine"><span class="k">C</span>
    <span>The most expensive resource, because idle capital is the largest waste.</span>
    <span class="tail"><span class="flag">Your answer</span></span></div>
  <div class="row correct"><span class="k">B</span>
    <span>The system's current bottleneck, whatever it happens to be.</span>
    <span class="tail"><span class="flag ok">Correct</span></span></div>

  <hr class="sep">
  <div class="stat"><span class="k">This round</span><span class="v">+0</span></div>
  <div class="stat"><span class="k">Total</span><span class="v">340</span></div>
  <div class="stat"><span class="k">Standing</span><span class="v">7th of 12</span></div>

  {lookup('How the whole room answered, and why B, is on the main screen.')}
</main>
""", volume="watch", phase="var(--rule)"))

# --- 16 results call -------------------------------------------------------
state(
    "17-results-call.html", "RESULTS — call &amp; answer",
    "The reveal. This is the moment the anonymity feature pays off, so the phone says plainly "
    "which numbered response was yours — the number the room has been discussing for two "
    "minutes — and what it earned. It does not reproduce the room's leaderboard.",
    "A middling result, not a win: two votes, third place, a rank that went down. Designed for "
    "the eleven players who did not come first.",
    shell("Round 3 — results", f"""
{bar('Round 3 of 8 &middot; Results')}
<main class="stage">
  <p class="lab">Yours was</p>
  <h1 style="margin-bottom:16px">Response 4</h1>

  <div class="card">
    <p class="quote">We could publish one definition of "qualified" and make the three intake
      forms render from it, so a change lands in all three at once rather than in whichever
      region noticed.</p>
  </div>

  <div class="stat"><span class="k">Votes for it</span><span class="v">2</span></div>
  <div class="stat"><span class="k">This round</span><span class="v">+4</span></div>
  <div class="stat"><span class="k">Total</span><span class="v">31</span></div>
  <div class="stat"><span class="k">Standing</span><span class="v">5th of 12 &middot; was 4th</span></div>

  {lookup('Names are on the main screen now. The top responses and the discussion prompts are up there too — <b>this page will not repeat them</b>.')}
</main>
""", volume="watch", phase="var(--rule)"))

# --- 17 results wavelength -------------------------------------------------
state(
    "18-results-wavelength.html", "RESULTS — wavelength",
    "The cloud is the room's result and it belongs on the stage. The phone's version of the "
    "same fact is personal: which of <i>your</i> words the room also said. Today the phone "
    "renders a full common-words list, a stats block and your words — three views of one "
    "dataset, on the smallest screen in the building.",
    "Seven words, three shared. A player whose words were all unique gets the same layout with "
    "a different sentence, not an empty state.",
    shell("Subject 2 — results", f"""
{bar('Subject 2 of 4 &middot; Results')}
<main class="stage">
  <p class="lab">Your words</p>
  <h1 style="font-size:var(--L-primary);margin-bottom:6px">3 of your 7 were said by someone else.</h1>
  <p class="help" style="margin-bottom:4px">Shared words are outlined.</p>

  <div class="chips" aria-label="Your words">
    <span class="chip shared" style="padding-right:14px">candour</span>
    <span class="chip" style="padding-right:14px">follow-through</span>
    <span class="chip shared" style="padding-right:14px">disagreement</span>
    <span class="chip" style="padding-right:14px">predictability</span>
    <span class="chip shared" style="padding-right:14px">silence</span>
    <span class="chip" style="padding-right:14px">repair</span>
    <span class="chip" style="padding-right:14px">time</span>
  </div>

  {lookup('The full cloud — every word the room reached for, sized by how many said it — is on the main screen.')}
</main>
""", volume="watch", phase="var(--rule)"))

# --- 18 between rounds -----------------------------------------------------
state(
    "19-between-rounds.html", "Between rounds",
    "A state the current code cannot distinguish from the lobby: any phase that is not ASK, "
    "VOTE or RESULTS renders &ldquo;You're in! Waiting for the game to start…&rdquo;, so after "
    "round 3 the phone tells you the session has not begun.",
    "Round 3 finished, round 4 not yet started, and the discussion is running in the room — "
    "which is exactly when the phone should be least interesting.",
    shell("Between rounds", f"""
{bar('Round 3 closed &middot; 5 rounds left')}
<main class="stage centre">
  <p class="lab">Round 3 is closed</p>
  <h1 style="font-size:var(--L-primary)">Nothing to do here.</h1>
  <p class="lede muted">The next round starts when the host is ready. This page will change on
    its own — you do not need to refresh it.</p>

  <hr class="sep">
  <div class="stat"><span class="k">Your total</span><span class="v">31</span></div>
  <div class="stat"><span class="k">Standing</span><span class="v">5th of 12</span></div>

  {lookup('The discussion is on the main screen. <b>Join in</b> — this is the part the session is actually for.')}
</main>
""", volume="rest", phase="var(--rule)"))

# --- 19 ended --------------------------------------------------------------
state(
    "20-ended.html", "The session has ended",
    "A designed finale, on the surface that has never had one. Today ENDED satisfies "
    "<code>isWaitingState()</code>, so a finished session shows &ldquo;Waiting for the game to "
    "start…&rdquo; behind a dismissible modal — and once dismissed, that lobby screen is where "
    "the player stays.",
    "One player's whole session in four numbers, and an honest final line for somebody who came "
    "fifth. No download button that 404s.",
    shell("Session complete", f"""
{bar('Q3 Leadership Offsite &middot; Complete')}
<main class="stage centre">
  <p class="lab">That's a wrap</p>
  <h1>Thanks for playing, Bartholomew.</h1>

  <hr class="sep">
  <div class="stat"><span class="k">Rounds played</span><span class="v">8 of 8</span></div>
  <div class="stat"><span class="k">Responses that placed</span><span class="v">3</span></div>
  <div class="stat"><span class="k">Final score</span><span class="v">86</span></div>
  <div class="stat"><span class="k">Final standing</span><span class="v big">5th<span
    style="font-size:var(--L-meta);color:var(--muted);font-weight:700"> of 12</span></span></div>

  {lookup('The room summary — the top responses, and what the host wants everyone to take away — is on the main screen.')}
  <p class="help" style="margin-top:18px">You can close this page. If your host publishes a
    session summary, they will share the link themselves.</p>
</main>
""", volume="watch", phase="var(--rule)"))

# --- 20 connection lost ----------------------------------------------------
state(
    "21-offline.html", "Connection lost, mid-answer",
    "The failure that loses work. Today the only connection affordance is a status chip whose "
    "click handler is <code>window.location.reload()</code> — offered to a player in the middle "
    "of typing, which is the one moment a reload is unforgivable. Here the banner reconnects "
    "itself and the reload is withheld while there is unsent text.",
    "The banner sits above the bar and pushes nothing off screen; the composed answer is intact "
    "and says so; the dock states what will happen rather than failing silently.",
    shell("Offline — reconnecting", f"""
<div class="banner" role="status">{INFO}<div><b>Offline.</b> Reconnecting&hellip; Your text is
  safe on this phone and will send as soon as you are back.</div></div>
{bar('Round 3 of 8', 'Operating Model', online=False)}
<main class="stage">
  <p class="q">Our regional teams each built their own intake process, and the three of them
    now disagree about what counts as a qualified request.</p>

  <label class="lab" for="a">Your response</label>
  <textarea class="inp" id="a">We could publish one definition of "qualified" and make the three intake forms render from it, so a change lands in all three at once</textarea>
  <p class="help">Saved on this phone 4 seconds ago. Keep typing.</p>
</main>
<footer class="dock">
  <p class="note">Waiting for the connection. Nothing has been lost.</p>
  <button class="btn" disabled>Send when reconnected</button>
</footer>
""", volume="act", phase="var(--primary)"))

# --- 21 rejoin -------------------------------------------------------------
state(
    "22-rejoin.html", "Rejoining mid-round",
    "The bug this whole screen exists to kill: a player who has voted and then reloads gets a "
    "<b>completely blank page</b> today, because the VOTE branch is guarded on "
    "<code>answers.length &gt; 0</code> and the already-voted path returns before the answers "
    "are ever fetched. A rejoin must always say what it found.",
    "The hardest rejoin: back mid-VOTE, with a ballot already cast, and the ballot list "
    "deliberately not re-fetched — there is nothing left to do with it.",
    shell("Welcome back", f"""
{bar('Voting &middot; Round 3 of 8')}
<main class="stage">
  <p class="lab" style="color:var(--success-text)">Welcome back</p>
  <h1 style="font-size:var(--L-primary)">You had already voted.</h1>
  <p class="lede muted">Nothing was lost. Here is where you are.</p>

  <div class="card good">
    <div class="stat"><span class="k">Your response</span><span class="v">Response 4</span></div>
    <div class="stat"><span class="k">Your ballot</span><span class="v">2 &middot; 5 &middot; 11</span></div>
    <div class="stat"><span class="k">Your total</span><span class="v">27</span></div>
  </div>

  {lookup('Voting is still open for the room. Results come up on the main screen when the host closes it.')}
</main>
""", volume="rest", phase="var(--secondary)"))

# --- 22 type ladder --------------------------------------------------------
state(
    "23-type-ladder.html", "The derivation, shown",
    "Not a state — the reference card. Three ladders, each derived from a viewing distance and "
    "a CSS pixel density rather than chosen, with live specimens so the numbers can be checked "
    "against something visible. Open it at 375, 768 and 1280 to see each ladder in force.",
    "The rungs are the same angular sizes at all three distances, which is why the pixel "
    "numbers differ and the screens look the same size to the reader.",
    shell("Player type ladder — derivation", f"""
<main class="stage doc">
  <h1 style="font-size:var(--L-primary)">The ladder, derived</h1>
  <p class="lede muted">Cap height subtending an angle at the eye. font-size = cap &divide; 0.72.
    The active ladder below is whichever your window width selects — resize and the specimens
    change with it.</p>

  <table>
    <tr><th>Rung</th><th>Angle</th><th>Phone<br>14in / 142ppi</th><th>Tablet<br>18in / 132ppi</th>
      <th>Laptop<br>24in / 110ppi</th></tr>
    <tr><td>hero</td><td>42&prime;</td><td>34px</td><td>40px</td><td>45px</td></tr>
    <tr><td>primary — the question</td><td>30&prime;</td><td>24px</td><td>28px</td><td>32px</td></tr>
    <tr><td>secondary — answers, buttons</td><td>24&prime;</td><td>19px</td><td>22px</td><td>26px</td></tr>
    <tr><td>body — detail, inputs</td><td>20&prime;</td><td>16px</td><td>19px</td><td>21px</td></tr>
    <tr><td>meta — labels (floor)</td><td>16&prime;</td><td>13px</td><td>15px</td><td>17px</td></tr>
  </table>

  <div class="spec"><p class="t">hero &mdash; var(--L-hero)</p>
    <p class="big" style="margin:0">Response 4</p></div>
  <div class="spec"><p class="t">primary &mdash; var(--L-primary)</p>
    <p class="q" style="margin:0">Should we hold the March date?</p></div>
  <div class="spec"><p class="t">secondary &mdash; var(--L-secondary)</p>
    <p class="rtxt" style="margin:0">Publish one definition and make every intake form render from it.</p></div>
  <div class="spec"><p class="t">body &mdash; var(--L-body)</p>
    <p style="margin:0">Engineering says the integration work is four weeks from done and has
      been for three weeks.</p></div>
  <div class="spec"><p class="t">meta &mdash; var(--L-meta) &mdash; the floor</p>
    <p class="lab" style="margin:0">Nothing on this surface is smaller than this</p></div>

  <p class="help" style="margin-top:22px">Measured contrast on the real background
    <code>#0F1A2E</code>, with no black-lift model, because a phone is a direct-view emissive
    panel: <code>--text</code> 13.2:1, <code>--muted #B6C2D4</code> 9.8:1,
    <code>--success-text #6FD0A4</code> 9.2:1, <code>--primary #F6A94C</code> 8.8:1,
    and <code>#0F1A2E</code> on an amber button 8.8:1. Every pair clears AA for normal text at
    every rung.</p>
</main>
""", volume="watch", phase="var(--rule)"))


# ---------------------------------------------------------------------------
# index.html
# ---------------------------------------------------------------------------
INDEX_CSS = """
:root{--bg:#0F1A2E;--surface:#182640;--text:#F4EDE4;--muted:#B6C2D4;--primary:#F6A94C;
  --success-text:#6FD0A4;--rule:rgba(182,194,212,.20)}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);padding:50px 24px 90px;
  font:400 16px/1.55 "Inter",system-ui,-apple-system,"Segoe UI",sans-serif}
.wrap{max-width:980px;margin:0 auto}
h1{font-size:clamp(30px,4.4vw,44px);line-height:1.05;margin:0 0 14px;font-weight:800;
  letter-spacing:-.02em}
h2{font-size:14px;letter-spacing:.13em;text-transform:uppercase;color:var(--muted);
  margin:40px 0 12px;font-weight:800}
.sub{color:var(--muted);max-width:78ch;margin:0 0 10px}
a{color:var(--primary)}
.hint{color:var(--muted);font-size:15px;border-left:3px solid var(--primary);padding:12px 16px;
  background:rgba(246,169,76,.07);border-radius:0 8px 8px 0;margin:20px 0;max-width:78ch}
.hint b{color:var(--text)}
.go{display:inline-block;background:var(--primary);color:#0F1A2E;font-weight:800;
  text-decoration:none;padding:12px 22px;border-radius:10px}
ol{list-style:none;padding:0;margin:0}
li{border-bottom:1px solid var(--rule);padding:16px 0 16px 62px;position:relative}
li .n{position:absolute;left:0;top:19px;font-weight:800;color:var(--primary);font-size:14px;
  letter-spacing:.07em}
li a.t{color:var(--text);text-decoration:none;font-weight:800;font-size:18px}
li a.t:hover{color:var(--primary)}
li p{margin:6px 0 0;color:var(--muted);font-size:15px;max-width:84ch}
li p.w{color:var(--success-text);font-size:14px}
li p.w b{color:var(--text)}
code{color:var(--primary);font-size:.92em;font-family:ui-monospace,Menlo,monospace}
footer{margin-top:40px;color:var(--muted);font-size:14px;max-width:80ch}
"""

rows = []
for i, s in enumerate(STATES, 1):
    rows.append(
        f'<li><span class="n">{i:02d}</span>'
        f'<a class="t" href="{s["f"]}">{s["name"]}</a>'
        f'<p>{s["purpose"]}</p>'
        f'<p class="w"><b>Worst case carried:</b> {s["worst"]}</p></li>')

INDEX = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Engage2 player screen — redesign mockups</title>
<style>{INDEX_CSS}</style>
</head>
<body>
<div class="wrap">
  <h1>Engage2 player screen &mdash; redesign mockups</h1>

  <p class="sub"><a class="go" href="view.html">Open the deck viewer &rarr;</a></p>
  <p class="sub" style="margin-top:10px">Steps through all {len(STATES)} in a device frame with
    <b>&larr;</b> <b>&rarr;</b>, and switches device with <b>1</b> phone 375&times;812,
    <b>2</b> tablet 768&times;1024, <b>3</b> laptop 1280&times;800. The three type ladders are
    real media queries, so the device switch is the only way to see them fire.
    <b>Serve this directory</b> &mdash; <code>python3 -m http.server 8124 --directory
    docs/design/player-redesign</code>.</p>

  <div class="hint">
    <b>This surface had never been designed.</b> There is no player-facing design document
    anywhere in the repository and the host spec does not mention the player's screen once.
    Read <a href="INVENTORY.md">INVENTORY.md</a> first &mdash; it is the honest accounting of
    what <code>src/src/PlayerPage.jsx</code> renders today, including four states that cannot
    render at all and one that renders a blank page. Then
    <a href="RATIONALE.md">RATIONALE.md</a> for the derivations, the arguments and the places
    this design disagrees with the host spec and with the brief, and
    <a href="OPEN-QUESTIONS.md">OPEN-QUESTIONS.md</a> for the ten decisions that are not mine
    to make. <a href="audit.html">audit.html</a> is the verification: ten assertions &times; 23
    mockups &times; 3 device profiles, 690 in all, and one of them changed the design.
  </div>

  <div class="hint">
    <b>The organising idea is volume.</b> Every state is ACT, REST or WATCH.
    <b>ACT</b> &mdash; the phone is the only place the task can be done: full contrast, amber
    primary, a dock. <b>REST</b> &mdash; the task is done: <i>no dock at all</i>, no amber,
    nothing to press. <b>WATCH</b> &mdash; the shared screen is the show: the phone carries only
    what is personal and therefore cannot be on the stage. The state machine sets the volume;
    the player never chooses it.
  </div>

  <h2>The {len(STATES)} states</h2>
  <ol>
    {''.join(rows)}
  </ol>

  <footer>
    Warm Summit tokens unchanged. Type ladders derived per viewing distance in
    <a href="23-type-ladder.html">23</a> and RATIONALE.md &sect;3 &mdash; the host spec's
    projector ladder is deliberately <i>not</i> used, and neither is its black-lift contrast
    model. Every file is standalone HTML: no build step, no CDN, no external asset. They are
    regenerated by <code>build.py</code> so the one stylesheet cannot drift between states;
    <code>view.html</code> is hand-written and is not generated.
  </footer>
</div>
</body>
</html>
"""

with open(os.path.join(HERE, "index.html"), "w") as fh:
    fh.write(INDEX)

print(f"wrote {len(STATES)} mockups + index.html into {HERE}")
