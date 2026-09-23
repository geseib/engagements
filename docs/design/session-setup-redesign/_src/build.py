#!/usr/bin/env python3
"""
Emits the self-contained session-setup mockups in docs/design/session-setup-redesign/.

Every output inlines its whole stylesheet, so each file opens from file://
with no build step, no CDN and no external asset — the rule every set in
docs/design follows.

THE BASE STYLESHEETS ARE READ, NOT RETYPED:

  create dialog   src/src/styles.css  (:root tokens + the handful of base rules
                                       the dialog leans on, extracted by exact
                                       selector — build fails if one moves)
                  + src/src/components/GameSetupDialog.css  (whole, as shipped)
                  + ss-dialog.css
  phone           player-redesign/build.py  CSS = r\"\"\"…\"\"\"  + ss-phone.css
  stage (room)    refresh-2026-09-22/_src/stage-base.css
                  + refresh-2026-09-22/_src/refresh-stage.css + ss-stage.css
  console         admin-redesign/_src/shell.css + ss-console.css
  design notes    marketing-redesign/mk.css (its design-notes tail) + notes.js

The dialog is the one surface read straight from src/ rather than from an
approved mockup, on purpose: the shipped GameSetupDialog is the thing being
improved, so its own stylesheet is the only honest base. What this design ADDS
is legible as a diff: the four ss-*.css files beside this script.

    python3 _src/build.py          # from docs/design/session-setup-redesign/
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(HERE)
DESIGN = os.path.dirname(OUT)
REPO = os.path.dirname(os.path.dirname(DESIGN))
sys.path.insert(0, HERE)


def read(*p):
    with open(os.path.join(*p), encoding="utf-8") as f:
        return f.read()


# ------------------------------------------------------------- base sheets
STYLES = read(REPO, "src", "src", "styles.css")
GSD_CSS = read(REPO, "src", "src", "components", "GameSetupDialog.css")


def rule(css, selector):
    """One top-level rule block from `css`, by its exact selector text."""
    i = css.find("\n" + selector + " {")
    assert i >= 0, f"styles.css no longer has `{selector}` — re-check the dialog base"
    j = css.find("\n}", i)
    return css[i + 1:j + 2]


# The dialog's inherited base, in the order styles.css declares it. Only rules
# whose selectors the shipped dialog markup actually carries.
DIALOG_BASE = "\n".join(rule(STYLES, s) for s in (
    ":root", '[data-theme="light"]', '[data-theme="dark"]',
    ".btn-primary", ".btn-primary:disabled", ".btn-secondary",
    ".new-game-overlay", ".new-game-dialog", ".new-game-dialog h2",
    ".dialog-content", ".form-group", ".dialog-actions",
    ".dialog-actions .btn-primary,\n.dialog-actions .btn-secondary",
))

ADMIN_CSS = read(DESIGN, "admin-redesign", "_src", "shell.css")
PHONE_CSS = re.search(r'CSS = r"""(.*?)"""',
                      read(DESIGN, "player-redesign", "build.py"), re.S).group(1)
STAGE_CSS = (read(DESIGN, "refresh-2026-09-22", "_src", "stage-base.css") + "\n" +
             read(DESIGN, "refresh-2026-09-22", "_src", "refresh-stage.css"))
MK = read(DESIGN, "marketing-redesign", "mk.css")
ANNO_CSS = MK[MK.index("/* ============================================================= design notes"):]
NOTES_JS = read(DESIGN, "marketing-redesign", "notes.js")

SS_DIALOG = read(HERE, "ss-dialog.css")
SS_PHONE = read(HERE, "ss-phone.css")
SS_STAGE = read(HERE, "ss-stage.css")
SS_CONSOLE = read(HERE, "ss-console.css")

# A frame on a board loads a page with #bare, which hides that page's own notes
# rail so the board's rail is the only one on screen.
BARE_JS = ("<script>if(location.hash==='#bare'){document.body.classList.remove('mk-anno-on');"
           "document.body.classList.add('mk-anno-off','ss-bare');"
           "var t=document.getElementById('mkAnno');if(t)t.style.display='none';}</script>")

# --------------------------------------------------------------- the icons
# Console: admin-redesign's sprite, copied (not imported) as survey-redesign
# does. Dialog: a few 16px stroke glyphs drawn to the same rules.
_admin_src = read(DESIGN, "admin-redesign", "_src", "build.py")
ICONS = {}
exec(re.search(r"ICONS = \{.*?\n\}", _admin_src, re.S).group(0), {}, ICONS)
ICONS = ICONS["ICONS"]
ICONS.update({
    "file":     '<path d="M14 3.6H7.4a1.8 1.8 0 0 0-1.8 1.8v13.2a1.8 1.8 0 0 0 1.8 1.8h9.2a1.8 1.8 0 0 0 1.8-1.8V8z"/><path d="M14 3.6V8h4.4"/>',
    "lock":     '<rect x="5.2" y="10.6" width="13.6" height="9.4" rx="1.8"/><path d="M8.4 10.6V8a3.6 3.6 0 0 1 7.2 0v2.6"/>',
    "eye":      '<path d="M2.8 12s3.4-6.2 9.2-6.2 9.2 6.2 9.2 6.2-3.4 6.2-9.2 6.2S2.8 12 2.8 12z"/><circle cx="12" cy="12" r="2.6"/>',
    "door":     '<path d="M5 20.4h14"/><path d="M7 20.4V4.6a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v15.8"/><circle cx="14" cy="12.4" r=".9"/>',
    "database": '<ellipse cx="12" cy="6" rx="7.4" ry="2.6"/><path d="M4.6 6v12c0 1.4 3.3 2.6 7.4 2.6s7.4-1.2 7.4-2.6V6M4.6 12c0 1.4 3.3 2.6 7.4 2.6s7.4-1.2 7.4-2.6"/>',
    "arrow":    '<path d="M4.6 12h14.6M13.4 6.2 19.2 12l-5.8 5.8"/>',
})


def sprite():
    out = ['<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>']
    for name, body in ICONS.items():
        out.append(f'<g id="i-{name}" fill="none" stroke="currentColor" stroke-width="1.7" '
                   f'stroke-linecap="round" stroke-linejoin="round">{body}</g>')
    out.append("</defs></svg>")
    return "".join(out)


def ico(name, cls="ico"):
    return f'<svg class="{cls}" viewBox="0 0 24 24" aria-hidden="true"><use href="#i-{name}"/></svg>'


def mk_anno(kind, text):
    return f'<div class="mk-anno"><b>{kind}</b>{text}</div>'


def rail_html(notes, label="Design notes"):
    return (f'<aside class="mk-anno-rail" aria-label="Design notes"><h6>{label}</h6>{notes}</aside>'
            '<button class="mk-anno-toggle" type="button" id="mkAnno">Hide design notes</button>'
            f'<script>{NOTES_JS}</script>')


# ------------------------------------------------------- the create dialog
SCROLL_TO_ADV = ("<script>(function(){var c=document.querySelector('.gsd'),a=document.querySelector('.ss-adv');"
                 "if(c&&a){c.scrollTop=a.offsetTop-96;}})();</script>")


def dialog_page(title, dialog, notes, behind="", scroll_adv=False):
    """The shipped overlay + card (GameHostPage renders the dialog by an early
    return over the paper body: rgba(0,0,0,.7) over #FBF7F1 = #4B4A48, which is
    what this draws). `behind` is only used where the design proposes the
    dialog open OVER the preview stage."""
    return f"""<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title>
<style>
/* ---- src/src/styles.css, the rules the dialog inherits (extracted) ---- */
{DIALOG_BASE}
body{{margin:0;font-family:var(--font-ui);line-height:1.6;color:var(--text);background:var(--bg)}}
*,*::before,*::after{{box-sizing:border-box}}
/* ---- src/src/components/GameSetupDialog.css, verbatim ---- */
{GSD_CSS}
/* ---- ss-dialog.css: what this design adds ---- */
{SS_DIALOG}
/* ---- mockup tooling: the design-notes rail (mk.css), not product CSS ---- */
{ANNO_CSS}
</style>
</head>
<body class="mk-anno-on">
{sprite()}
{behind}
<div class="new-game-overlay">
{dialog}
</div>
{rail_html(notes)}
{BARE_JS}
{SCROLL_TO_ADV if scroll_adv else ""}
</body>
</html>
"""


# ---------------------------------------------------------------- the stage
def stage_page(title, body, notes, tag="", profile="d-room"):
    return f"""<!doctype html>
<html lang="en" class="{profile}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title>
<style>
{STAGE_CSS}
/* ---- ss-stage.css: what this design adds ---- */
{SS_STAGE}
/* ---- mockup tooling: the design-notes rail (mk.css), not product CSS ---- */
{ANNO_CSS}
body.mk-anno-on .stage{{width:100%}}
</style>
</head>
<body class="mk-anno-on">
{body}
{f'<div class="tag">{tag}</div>' if tag else ''}
{rail_html(notes)}
{BARE_JS}
</body>
</html>
"""


# ---------------------------------------------------------------- the phone
def phone_page(title, body, volume="act", phase=None):
    phase_css = f"<style>:root{{--phase:{phase}}}</style>" if phase else ""
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>{title}</title>
<style>{PHONE_CSS}
/* ---- ss-phone.css: what this design adds ---- */
{SS_PHONE}</style>{phase_css}
</head>
<body class="v-{volume}">
{body}
</body>
</html>
"""


def bar(ctx, cat=None, who="Priya"):
    who_html = f'<span class="who"><span class="dot"></span>{who}</span>' if who else ''
    cat_html = f'<span class="cat">{cat}</span>' if cat else ''
    return (f'<header class="bar"><div class="strip"></div>'
            f'<div class="line"><span class="ctx">{ctx}</span>{cat_html}'
            f'<span class="spacer"></span>{who_html}</div></header>')


# -------------------------------------------------------------- the console
NAV = [("sets", "books", "Question sets", 43), ("sessions", "play", "Sessions", 18),
       ("reports", "file", "Reports", 23), ("prompts", "sparkle", "Prompts", 47),
       ("archive", "package", "Archive", None), ("users", "users", "Users", None)]


def nav_html(active):
    rows = []
    for key, icon, label, n in NAV:
        cur = ' aria-current="page"' if key == active else ""
        tail = f'<span class="count">{n}</span>' if n else ""
        if key == "users":
            tail = '<span class="badge">3</span>'
        rows.append(f'<button class="nav-item"{cur}>{ico(icon)}<span class="nav-label">{label}</span>{tail}</button>')
    rows.append('<div class="nav-foot"><button class="nav-item">' + ico("gear") +
                '<span class="nav-label">Settings</span></button></div>')
    return "\n    ".join(rows)


ANNO_RE = re.compile(r'<aside class="anno".*?</aside>', re.S)


def anno(kind, text):
    return f'<aside class="anno"><b>{kind}</b>{text}</aside>'


def console_page(title, body, nav="sessions", back=""):
    notes = ANNO_RE.findall(body)
    body = ANNO_RE.sub("", body).rstrip()
    rail = ""
    if notes:
        rail = ('  <aside class="annorail" aria-label="Design notes">\n    <h6>Design notes</h6>\n    ' +
                "\n    ".join(notes) + "\n  </aside>")
    crumbs = f'<a href="#" class="back">&lsaquo;&ensp;{back}</a>' if back else ""
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title} — Engage2 admin console</title>
<style>
{ADMIN_CSS}
/* ---- ss-console.css: what this design adds ---- */
{SS_CONSOLE}
</style>
</head>
<body>
{sprite()}
  <header class="brand"><span class="mark" aria-hidden="true"></span><span class="word">Engage</span></header>
  <div class="top">
    <nav class="crumbs" aria-label="Breadcrumb">{crumbs}</nav>
    <span class="spacer"></span>
    <span class="envchip dev">dev</span>
    <div class="who"><span class="avatar" aria-hidden="true">GS</span><span class="name">george.seib@gmail.com</span></div>
  </div>
  <nav class="nav" aria-label="Sections">
    {nav_html(nav)}
  </nav>
  <main class="work">
{body}
  </main>
{rail}
<button class="anno-toggle" id="annoBtn">Hide design notes</button>
<script>
(function(){{
  var b=document.getElementById('annoBtn');
  function set(off){{document.body.classList.toggle('no-anno',off);
    b.textContent=off?'Show design notes':'Hide design notes';
    try{{localStorage.setItem('adminAnno',off?'0':'1');}}catch(e){{}}}}
  try{{ if(localStorage.getItem('adminAnno')==='0') set(true); }}catch(e){{}}
  b.addEventListener('click',function(){{set(!document.body.classList.contains('no-anno'));}});
  addEventListener('keydown',function(e){{if(e.key!=='n'&&e.key!=='N')return;
    if(/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName))return;
    set(!document.body.classList.contains('no-anno'));}});
}})();
</script>
</body>
</html>
"""


# ----------------------------------------------------- the gallery (a board)
# Several real pages side by side in iframes, each at its own device size, so a
# phone renders at the phone ladder and a stage at Room's.
BOARD_CSS = """
*{box-sizing:border-box}
body{margin:0;background:#0B1322;color:#F4EDE4;font:400 15px/1.5 "Inter",system-ui,sans-serif;
  -webkit-font-smoothing:antialiased}
.bd{padding:26px 30px 60px}
.bd h1{font:800 24px/1.15 "Archivo Expanded","Archivo",system-ui,sans-serif;margin:0 0 6px}
.bd .lede{color:#B6C2D4;margin:0 0 22px;max-width:96ch}
.bd .row{display:flex;flex-wrap:wrap;gap:22px;align-items:flex-start;margin:0 0 30px}
.bd figure{margin:0}
.bd figcaption{font:700 12px/1.4 "Inter",system-ui,sans-serif;letter-spacing:.09em;text-transform:uppercase;
  color:#B6C2D4;margin:9px 0 0;max-width:var(--w)}
.bd figcaption b{color:#F6A94C}
.bd figcaption span{display:block;text-transform:none;letter-spacing:0;font-weight:400;margin-top:3px;color:#9BA8BE}
.frame{position:relative;overflow:hidden;border-radius:26px;border:1px solid rgba(244,237,228,.16);
  background:#0F1A2E;box-shadow:0 18px 44px rgba(0,0,0,.45)}
.frame.stage,.frame.laptop{border-radius:12px}
.frame iframe{border:0;display:block;transform-origin:0 0;position:absolute;left:0;top:0}
.bd h2{font:800 15px/1.2 "Inter",system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;
  color:#9BA8BE;margin:4px 0 14px}
.bd .step{font:800 12px/1 "Inter",system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#F6A94C;margin:0 0 8px}
"""


def frame(src, w, h, scale, caption, kind="phone"):
    fw, fh = round(w * scale), round(h * scale)
    return (f'<figure style="--w:{fw}px"><div class="frame {kind}" style="width:{fw}px;height:{fh}px">'
            f'<iframe src="{src}" width="{w}" height="{h}" style="transform:scale({scale})" loading="lazy" '
            f'title="{re.sub("<.*?>", "", caption)}"></iframe></div><figcaption>{caption}</figcaption></figure>')


def board_page(title, body, notes, extra_css=""):
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title>
<style>
{BOARD_CSS}
{extra_css}
{ANNO_CSS}
</style>
</head>
<body class="mk-anno-on">
<main class="bd">
{body}
</main>
{rail_html(notes)}
</body>
</html>
"""


# ------------------------------------------------------------------ writing
WRITTEN = []


def write(name, html, group=""):
    with open(os.path.join(OUT, name), "w", encoding="utf-8") as f:
        f.write(html)
    scrub = html.replace("http://www.w3.org", "")
    for bad in ("http://", "https://", "<link ", "@import"):
        assert bad not in scrub, f"{name} fetches something: {bad}"
    # The repo guard (tests/no-retired-twin-references.js) refuses two deploy
    # phrasings in any tracked file, this one included — so they are assembled
    # from their words here rather than written out.
    for banned in (" ".join(("deploys", "nothing")), " ".join(("tags", "only"))):
        assert banned not in html.lower(), f"{name} carries a phrase the repo guard refuses"
    WRITTEN.append((group, name))


if __name__ == "__main__":
    import content
    content.check()
    import pages
    pages.build_all()
