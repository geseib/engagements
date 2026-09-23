#!/usr/bin/env python3
"""
Emits the self-contained survey & poll mockups in docs/design/survey-redesign/.

Every output inlines its whole stylesheet, so each file opens from file://
with no build step, no CDN and no external asset — the rule every set in
docs/design follows.

THE BASE STYLESHEETS ARE READ FROM THE APPROVED SETS, NOT RETYPED:

  console (laptop)  admin-redesign/_src/shell.css             + survey-console.css
  phone             player-redesign/build.py  CSS = r\"\"\"…\"\"\"  + survey-phone.css
  stage (room)      refresh-2026-09-22/_src/stage-base.css
                    + refresh-2026-09-22/_src/refresh-stage.css + survey-stage.css
  paper (report)    survey-paper.css — paper tokens from styles.css:58-66;
                    GameReport.css is scoped to a React tree and is not inlinable

so every token, ladder, floor and component is byte-identical to what was
audited, and what this design ADDS is legible as a diff: the four survey-*.css
files beside this script.

    python3 _src/build.py          # from docs/design/survey-redesign/
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(HERE)
DESIGN = os.path.dirname(OUT)
sys.path.insert(0, HERE)


def read(*p):
    with open(os.path.join(*p), encoding="utf-8") as f:
        return f.read()


# ------------------------------------------------------------- base sheets
ADMIN_CSS = read(DESIGN, "admin-redesign", "_src", "shell.css")
PHONE_CSS = re.search(r'CSS = r"""(.*?)"""',
                      read(DESIGN, "player-redesign", "build.py"), re.S).group(1)
STAGE_CSS = (read(DESIGN, "refresh-2026-09-22", "_src", "stage-base.css") + "\n" +
             read(DESIGN, "refresh-2026-09-22", "_src", "refresh-stage.css"))
MK = read(DESIGN, "marketing-redesign", "mk.css")
ANNO_CSS = MK[MK.index("/* ============================================================= design notes"):]
NOTES_JS = read(DESIGN, "marketing-redesign", "notes.js")

SURVEY_CONSOLE = read(HERE, "survey-console.css")
SURVEY_PHONE = read(HERE, "survey-phone.css")
SURVEY_STAGE = read(HERE, "survey-stage.css")
SURVEY_PAPER = read(HERE, "survey-paper.css")

# The console's icon sprite: admin-redesign's set, plus the glyphs a survey
# needs. Same 16px stroke drawing rules (build.py there), so they sit together.
_admin_src = read(DESIGN, "admin-redesign", "_src", "build.py")
ICONS = {}
exec(re.search(r"ICONS = \{.*?\n\}", _admin_src, re.S).group(0), {}, ICONS)
ICONS = ICONS["ICONS"]
ICONS.update({
    "star":     '<path d="m12 4 2.4 5 5.4.6-4 3.8 1.1 5.4L12 16.1l-4.9 2.7 1.1-5.4-4-3.8 5.4-.6z"/>',
    "list":     '<path d="M9 7h11M9 12h11M9 17h11"/><circle cx="4.6" cy="7" r="1"/><circle cx="4.6" cy="12" r="1"/><circle cx="4.6" cy="17" r="1"/>',
    "toggle":   '<rect x="3" y="7" width="18" height="10" rx="5"/><circle cx="15.6" cy="12" r="2.8"/>',
    "rank":     '<path d="M4 6h3M4 12h3M4 18h3"/><path d="M10 6h10M10 12h7M10 18h4"/>',
    "text":     '<path d="M4.4 6.4h15.2M4.4 11h15.2M4.4 15.6h9.6"/>',
    "grip":     '<circle cx="9" cy="6.5" r="1.2"/><circle cx="15" cy="6.5" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="9" cy="17.5" r="1.2"/><circle cx="15" cy="17.5" r="1.2"/>',
    "share":    '<circle cx="6.4" cy="12" r="2.4"/><circle cx="17.4" cy="6.2" r="2.4"/><circle cx="17.4" cy="17.8" r="2.4"/><path d="m8.6 10.9 6.6-3.6M8.6 13.1l6.6 3.6"/>',
    "qr":       '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h2.4v2.4H14zM17.6 17.6H20V20h-2.4zM14 18.6V20M19.2 14H20"/>',
    "chart":    '<path d="M4.4 19.6h15.2"/><path d="M7 16.4V11M12 16.4V6.6M17 16.4v-3.2"/>',
    "copy":     '<rect x="8.4" y="8.4" width="11.2" height="11.2" rx="2"/><path d="M15.6 8.4V5.8a1.4 1.4 0 0 0-1.4-1.4H5.8a1.4 1.4 0 0 0-1.4 1.4v8.4a1.4 1.4 0 0 0 1.4 1.4h2.6"/>',
    "eye":      '<path d="M2.8 12s3.4-6.2 9.2-6.2 9.2 6.2 9.2 6.2-3.4 6.2-9.2 6.2S2.8 12 2.8 12z"/><circle cx="12" cy="12" r="2.6"/>',
    "lock":     '<rect x="5.2" y="10.6" width="13.6" height="9.4" rx="1.8"/><path d="M8.4 10.6V8a3.6 3.6 0 0 1 7.2 0v2.6"/>',
    "quote":    '<path d="M6.4 17.6c-1.6-1.2-2-3-2-4.6 0-3 1.8-5.6 4.6-6.6M14.4 17.6c-1.6-1.2-2-3-2-4.6 0-3 1.8-5.6 4.6-6.6"/>',
    "refresh":  '<path d="M19.4 12a7.4 7.4 0 0 1-12.9 5M4.6 12a7.4 7.4 0 0 1 12.9-5"/><path d="M17.6 3.6v3.6H14M6.4 20.4v-3.6H10"/>',
    "database": '<ellipse cx="12" cy="6" rx="7.4" ry="2.6"/><path d="M4.6 6v12c0 1.4 3.3 2.6 7.4 2.6s7.4-1.2 7.4-2.6V6M4.6 12c0 1.4 3.3 2.6 7.4 2.6s7.4-1.2 7.4-2.6"/>',
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


# ------------------------------------------------------------ console chrome
# The nav an organisation's host sees today (config/consoleSections.js, org
# mode): the org's name as the section head, then its places, then Team.
NAV = [("sec", "Northwind Traders"),
       ("sets", "books", "Question sets", 43), ("sessions", "play", "Sessions", 18),
       ("library", "package", "Public library", None), ("prompts", "sparkle", "Prompts", 47),
       ("sec", "Team"),
       ("members", "users", "Members", 9), ("billing", "chart", "Plan &amp; usage", None),
       ("privacy", "lock", "Data &amp; privacy", None)]


def nav_html(active):
    rows = []
    for item in NAV:
        if item[0] == "sec":
            rows.append(f'<div class="nav-sec">{item[1]}</div>')
            continue
        key, icon, label, n = item
        cur = ' aria-current="page"' if key == active else ""
        tail = f'<span class="count">{n}</span>' if n else ""
        rows.append(f'<button class="nav-item"{cur}>{ico(icon)}<span class="nav-label">{label}</span>{tail}</button>')
    return "\n    ".join(rows)


ANNO_RE = re.compile(r'<aside class="anno".*?</aside>', re.S)


def console_page(title, body, nav="sets", back="", after="", jobchip=""):
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
{SURVEY_CONSOLE}
</style>
</head>
<body>
{sprite()}
  <header class="brand"><span class="mark" aria-hidden="true"></span><span class="word">Engage</span></header>
  <div class="top">
    <nav class="crumbs" aria-label="Breadcrumb">{crumbs}</nav>
    <span class="spacer"></span>
    {jobchip}
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
{after}
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


def anno(kind, text):
    return f'<aside class="anno"><b>{kind}</b>{text}</aside>'


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
{SURVEY_PHONE}</style>{phase_css}
</head>
<body class="v-{volume}">
{body}
</body>
</html>
"""


def bar(ctx, cat=None, who="Sam"):
    who_html = f'<span class="who"><span class="dot"></span>{who}</span>' if who else ''
    cat_html = f'<span class="cat">{cat}</span>' if cat else ''
    return (f'<header class="bar"><div class="strip"></div>'
            f'<div class="line"><span class="ctx">{ctx}</span>{cat_html}'
            f'<span class="spacer"></span>{who_html}</div></header>')


# ---------------------------------------------------------------- the stage
def stage_page(title, body, profile="d-room", extra_js=""):
    return f"""<!doctype html>
<html lang="en" class="{profile}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title>
<style>
{STAGE_CSS}
{SURVEY_STAGE}
</style>
</head>
<body>
{body}
{extra_js}
</body>
</html>
"""


# ---------------------------------------------------------------- the paper
def paper_page(title, body):
    return f"""<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title>
<style>
{SURVEY_PAPER}
</style>
</head>
<body>
{body}
</body>
</html>
"""


# ----------------------------------------------------- the gallery (a board)
# A board lays several real pages side by side in iframes, each at its own
# device size, so a phone renders at the phone ladder and a stage at Room's —
# nothing is re-drawn at a smaller scale by hand. Notes sit in the mk rail.
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
.frame.stage{border-radius:12px}
.frame iframe{border:0;display:block;transform-origin:0 0;position:absolute;left:0;top:0}
.bd h2{font:800 15px/1.2 "Inter",system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;
  color:#9BA8BE;margin:4px 0 14px}
"""


def frame(src, w, h, scale, caption, kind="phone"):
    fw, fh = round(w * scale), round(h * scale)
    return (f'<figure style="--w:{fw}px"><div class="frame {kind}" style="width:{fw}px;height:{fh}px">'
            f'<iframe src="{src}" width="{w}" height="{h}" style="transform:scale({scale})" loading="lazy" '
            f'title="{re.sub("<.*?>", "", caption)}"></iframe></div><figcaption>{caption}</figcaption></figure>')


def board_page(title, body, notes):
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title>
<style>
{BOARD_CSS}
{ANNO_CSS}
</style>
</head>
<body class="mk-anno-on">
<main class="bd">
{body}
</main>
<aside class="mk-anno-rail" aria-label="Design notes">
<h6>Design notes</h6>
{notes}
</aside>
<button class="mk-anno-toggle" type="button" id="mkAnno">Hide design notes</button>
<script>{NOTES_JS}</script>
</body>
</html>
"""


def mk_anno(kind, text):
    return f'<div class="mk-anno"><b>{kind}</b>{text}</div>'


# ------------------------------------------------------------------ writing
WRITTEN = []


def write(name, html, label="", blurb="", group=""):
    with open(os.path.join(OUT, name), "w", encoding="utf-8") as f:
        f.write(html)
    for bad in ("http://", "https://fonts", "<link ", "@import"):
        assert bad not in html.replace("http://www.w3.org", ""), f"{name} fetches something: {bad}"
    WRITTEN.append((group, name, label, blurb))


if __name__ == "__main__":
    import pages  # noqa: F401  — each page module calls write() on import
    pages.build_all()
