#!/usr/bin/env python3
"""
Emits the self-contained mockups in docs/design/admin-redesign/.

Every output file inlines shell.css and the icon sprite, so each mockup opens
from file:// with no build step, no CDN and no external asset — the same rule
the host-redesign set follows.

    python3 _src/build.py          # from docs/design/admin-redesign/

Pages live in _src/pages.py. This file owns only the chrome that every page
shares: brand, topbar, left nav, and the annotation toggle.
"""
import os, sys, re

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

from pages import PAGES, NAV_COUNTS            # noqa: E402

CSS = open(os.path.join(HERE, "shell.css"), encoding="utf-8").read()

# --- icons -----------------------------------------------------------------
# 16px stroke icons, drawn here rather than pulled from a package: the mockups
# must be self-contained, and Phosphor (which the product uses) is a runtime
# dependency the design set cannot take.
ICONS = {
 "books":     '<path d="M3 4h4v16H3zM9 4h4v16H9z"/><path d="m15.4 5.3 3.5 15.2 2-.5L17.4 4.8z"/>',
 "play":      '<circle cx="12" cy="12" r="8.5"/><path d="M10.4 9.2 15 12l-4.6 2.8z"/>',
 "sparkle":   '<path d="M12 3.5 13.7 9l5.8 1.7-5.8 1.7L12 18l-1.7-5.6L4.5 10.7 10.3 9z"/>',
 "package":   '<path d="M12 3.6 20 8v8l-8 4.4L4 16V8z"/><path d="M4 8l8 4.3L20 8M12 12.3V20"/>',
 "users":     '<circle cx="9.5" cy="8.5" r="3.2"/><path d="M3.6 19.4a6 6 0 0 1 11.8 0"/><path d="M16.4 6.2a3 3 0 0 1 0 5.9M17.6 14.4a5.6 5.6 0 0 1 3 4.6"/>',
 "gear":      '<circle cx="12" cy="12" r="3.1"/><path d="M12 3.2v2.4M12 18.4v2.4M20.8 12h-2.4M5.6 12H3.2M18.2 5.8l-1.7 1.7M7.5 16.5l-1.7 1.7M18.2 18.2l-1.7-1.7M7.5 7.5 5.8 5.8"/>',
 "search":    '<circle cx="10.8" cy="10.8" r="6.2"/><path d="m15.4 15.4 4.1 4.1"/>',
 "plus":      '<path d="M12 5v14M5 12h14"/>',
 "trash":     '<path d="M4.6 6.6h14.8M9.4 6.6V4.4h5.2v2.2M6.6 6.6l1 13h8.8l1-13"/>',
 "warn":      '<path d="M12 4.2 21 19.6H3z"/><path d="M12 10v4.2M12 16.8v.1"/>',
 "check":     '<path d="m5 12.6 4.6 4.6L19 7.4"/>',
 "x":         '<path d="M6 6l12 12M18 6 6 18"/>',
 "down":      '<path d="m6 9.5 6 6 6-6"/>',
 "up":        '<path d="m6 14.5 6-6 6 6"/>',
 "left":      '<path d="m14 6-6 6 6 6"/>',
 "image":     '<rect x="3.6" y="5.2" width="16.8" height="13.6" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m4.4 17.2 4.8-4.4 4 3.4 2.8-2.4 3.6 3.2"/>',
 "upload":    '<path d="M12 16.4V4.6M7.6 9 12 4.6 16.4 9M4.4 19.4h15.2"/>',
 "download":  '<path d="M12 4.6v11.8M7.6 12l4.4 4.4L16.4 12M4.4 19.4h15.2"/>',
 "pencil":    '<path d="M4.6 19.4h3.2L19 8.2a2.3 2.3 0 0 0-3.2-3.2L4.6 16.2z"/>',
 "clock":     '<circle cx="12" cy="12" r="8.4"/><path d="M12 7.2V12l3.2 2"/>',
 "revert":    '<path d="M4.4 10.4h5V5.4"/><path d="M4.9 10a8 8 0 1 1-.5 4.4"/>',
 "link":      '<path d="M10.2 13.8a3.6 3.6 0 0 0 5.2 0l2.6-2.6a3.7 3.7 0 0 0-5.2-5.2l-1.1 1.1"/><path d="M13.8 10.2a3.6 3.6 0 0 0-5.2 0L6 12.8a3.7 3.7 0 0 0 5.2 5.2l1.1-1.1"/>',
 "file":      '<path d="M13.6 3.8H6.8v16.4h10.4V7.4z"/><path d="M13.6 3.8v3.6h3.6"/>',
 "pin":       '<path d="M9 3.8h6l-.8 5.4 3 3.4H6.8l3-3.4z"/><path d="M12 12.6V20"/>',
}


def sprite():
    out = ['<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>']
    for name, body in ICONS.items():
        out.append(
            f'<g id="i-{name}" fill="none" stroke="currentColor" stroke-width="1.7" '
            f'stroke-linecap="round" stroke-linejoin="round">{body}</g>')
    out.append("</defs></svg>")
    return "".join(out)


NAV = [
    ("sets",     "books",   "Question sets", "sets"),
    ("sessions", "play",    "Sessions",      "sessions"),
    ("prompts",  "sparkle", "Prompts",       "prompts"),
    ("archive",  "package", "Archive",       "archive"),
    ("users",    "users",   "Users",         "users"),
]


def nav_html(active, counts):
    counts = {**NAV_COUNTS, **(counts or {})}
    rows = []
    for key, icon, label, ckey in NAV:
        cur = ' aria-current="page"' if key == active else ""
        val = counts.get(ckey)
        if key == "users" and counts.get("pending"):
            tail = f'<span class="badge">{counts["pending"]}</span>'
        elif val in (None, ""):
            tail = ""
        else:
            tail = f'<span class="count">{val}</span>'
        rows.append(
            f'<button class="nav-item"{cur}><svg class="ico" viewBox="0 0 24 24">'
            f'<use href="#i-{icon}"/></svg><span class="nav-label">{label}</span>{tail}</button>')
    settings_cur = ' aria-current="page"' if active == "settings" else ""
    rows.append(
        '<div class="nav-foot"><button class="nav-item"' + settings_cur +
        '><svg class="ico" viewBox="0 0 24 24"><use href="#i-gear"/></svg>'
        '<span class="nav-label">Settings</span></button></div>')
    return "\n    ".join(rows)


TOP = """  <header class="brand">
    <span class="mark" aria-hidden="true"></span>
    <span class="word">Engage</span>
  </header>

  <div class="top">
    <nav class="crumbs" aria-label="Breadcrumb">{crumbs}</nav>
    <span class="spacer"></span>
    {jobchip}
    <span class="envchip dev">dev</span>
    <div class="who">
      <span class="avatar" aria-hidden="true">GS</span>
      <span class="name">george.seib@gmail.com</span>
    </div>
  </div>

  <nav class="nav" aria-label="Sections">
    {nav}
  </nav>
"""

DOC = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title} — Engage2 admin console</title>
<style>
{css}
{extra_css}
</style>
</head>
<body>
{sprite}
{chrome}
  <main class="work">
{body}
  </main>
{after}
<button class="anno-toggle" id="annoBtn">Hide design notes</button>
<script>
// Design-note toggle. N also works. This script is the only JS in the file and
// it exists solely so the annotations can be taken out of the way when you want
// to judge the screen as a screen.
(function(){{
  var b=document.getElementById('annoBtn');
  function set(off){{
    document.body.classList.toggle('no-anno',off);
    b.textContent=off?'Show design notes':'Hide design notes';
    try{{localStorage.setItem('adminAnno',off?'0':'1');}}catch(e){{}}
  }}
  try{{ if(localStorage.getItem('adminAnno')==='0') set(true); }}catch(e){{}}
  b.addEventListener('click',function(){{set(!document.body.classList.contains('no-anno'));}});
  addEventListener('keydown',function(e){{
    if(e.key==='n'||e.key==='N'){{
      if(/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName))return;
      set(!document.body.classList.contains('no-anno'));
    }}
  }});
}})();
</script>
</body>
</html>
"""


def crumbs_html(items):
    """items: list of (label, is_current).

    The topbar is NOT allowed to restate the h1 sitting 30px below it. On a root
    list that means it shows nothing at all; on a detail screen it shows one
    back link to the parent and never the object's own name. This is the host
    spec's rule 4 ("never state the same fact twice in one viewport") applied to
    this design's own chrome -- the first cut of this file broke it.
    """
    parent = [label for label, cur in items if not cur]
    if not parent:
        return ""
    return ('<a href="#" class="back">&lsaquo;&ensp;' + parent[-1] + "</a>")


ANNO_RE = re.compile(r'<aside class="anno".*?</aside>', re.S)


def split_annos(body):
    """Lift the design notes out of <main> and into their own grid column.

    They are authored inline, next to the markup they describe, which is the
    only sane way to keep them in sync. They must not RENDER there: an overlay
    pinned by pixel offsets sat on top of four table rows in the first cut.
    """
    notes = ANNO_RE.findall(body)
    clean = ANNO_RE.sub("", body).rstrip()
    if not notes:
        return clean, ""
    rail = ('  <aside class="annorail" aria-label="Design notes">\n'
            '    <h6>Design notes</h6>\n    ' + "\n    ".join(notes) + "\n  </aside>")
    return clean, rail


def build():
    sp = sprite()
    written = []
    for p in PAGES:
        p = dict(p)
        p["body"], p["_rail"] = split_annos(p["body"])
        chrome = TOP.format(
            crumbs=crumbs_html(p["crumbs"]),
            jobchip=p.get("jobchip", ""),
            nav=nav_html(p["nav"], p.get("counts")),
        )
        html = DOC.format(
            title=p["title"], css=CSS, extra_css=p.get("css", ""),
            sprite=sp, chrome=chrome, body=p["body"],
            after=p["_rail"] + p.get("after", ""),
        )
        path = os.path.join(OUT, p["file"])
        with open(path, "w", encoding="utf-8") as f:
            f.write(html)
        written.append(p["file"])
    print(f"wrote {len(written)} mockups:")
    for w in written:
        print("  " + w)


if __name__ == "__main__":
    build()
