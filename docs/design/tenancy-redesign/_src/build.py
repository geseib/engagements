#!/usr/bin/env python3
"""
Emits the multi-tenant mockups in docs/design/tenancy-redesign/.

    python3 _src/build.py          # from docs/design/tenancy-redesign/

WHY THIS SET REUSES admin-redesign/_src/shell.css RATHER THAN COPYING IT.
These screens are new sections of the SAME console — Team and Billing sit in
the same left nav as Question sets and Sessions, one click apart. A forked
stylesheet would drift, and the first thing to drift would be the type ladder
or a token, which is exactly the divergence the ladder was derived to prevent.
There is one shell; this set adds only the components that did not exist
(the org switcher, the usage meter, the access log, the moderation verdict).

Everything is still inlined at build time, so each output file opens from
file:// with no build step, no CDN and no external asset — the same rule the
other three sets follow.
"""
import os, sys, re

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.dirname(HERE)
SHELL = os.path.join(HERE, "..", "..", "admin-redesign", "_src", "shell.css")
sys.path.insert(0, HERE)

from pages import PAGES, NAV_ORG, NAV_PLATFORM, NAV_PERSONAL  # noqa: E402

CSS = open(SHELL, encoding="utf-8").read()
EXTRA = open(os.path.join(HERE, "extra.css"), encoding="utf-8").read()

# 16px stroke icons. Redrawn here rather than imported: the mockups must be
# self-contained, and Phosphor (which the product uses) is a runtime dependency
# a design set cannot take. Names match the admin set where they overlap.
ICONS = {
 "books":   '<path d="M3 4h4v16H3zM9 4h4v16H9z"/><path d="m15.4 5.3 3.5 15.2 2-.5L17.4 4.8z"/>',
 "play":    '<circle cx="12" cy="12" r="8.5"/><path d="M10.4 9.2 15 12l-4.6 2.8z"/>',
 "sparkle": '<path d="M12 3.5 13.7 9l5.8 1.7-5.8 1.7L12 18l-1.7-5.6L4.5 10.7 10.3 9z"/>',
 "package": '<path d="M12 3.6 20 8v8l-8 4.4L4 16V8z"/><path d="M4 8l8 4.3L20 8M12 12.3V20"/>',
 "users":   '<circle cx="9.5" cy="8.5" r="3.2"/><path d="M3.6 19.4a6 6 0 0 1 11.8 0"/><path d="M16.4 6.2a3 3 0 0 1 0 5.9M17.6 14.4a5.6 5.6 0 0 1 3 4.6"/>',
 "gear":    '<circle cx="12" cy="12" r="3.1"/><path d="M12 3.2v2.4M12 18.4v2.4M20.8 12h-2.4M5.6 12H3.2M18.2 5.8l-1.7 1.7M7.5 16.5l-1.7 1.7M18.2 18.2l-1.7-1.7M7.5 7.5 5.8 5.8"/>',
 "search":  '<circle cx="10.8" cy="10.8" r="6.2"/><path d="m15.4 15.4 4.1 4.1"/>',
 "plus":    '<path d="M12 5v14M5 12h14"/>',
 "trash":   '<path d="M4.6 6.6h14.8M9.4 6.6V4.4h5.2v2.2M6.6 6.6l1 13h8.8l1-13"/>',
 "warn":    '<path d="M12 4.2 21 19.6H3z"/><path d="M12 10v4.2M12 16.8v.1"/>',
 "check":   '<path d="m5 12.6 4.6 4.6L19 7.4"/>',
 "x":       '<path d="M6 6l12 12M18 6 6 18"/>',
 "down":    '<path d="m6 9.5 6 6 6-6"/>',
 "clock":   '<circle cx="12" cy="12" r="8.4"/><path d="M12 7.2V12l3.2 2"/>',
 "lock":    '<rect x="4.8" y="10.4" width="14.4" height="9.4" rx="2"/><path d="M8.2 10.4V7.8a3.8 3.8 0 0 1 7.6 0v2.6"/>',
 "eye":     '<path d="M2.4 12S6 5.8 12 5.8 21.6 12 21.6 12 18 18.2 12 18.2 2.4 12 2.4 12Z"/><circle cx="12" cy="12" r="2.9"/>',
 "card":    '<rect x="2.8" y="5.6" width="18.4" height="12.8" rx="2.2"/><path d="M2.8 10h18.4"/>',
 "globe":   '<circle cx="12" cy="12" r="8.5"/><path d="M3.6 12h16.8"/><path d="M12 3.5c2.4 2.6 3.6 5.6 3.6 8.5s-1.2 5.9-3.6 8.5c-2.4-2.6-3.6-5.6-3.6-8.5S9.6 6.1 12 3.5Z"/>',
 "shield":  '<path d="M12 3.4 19.4 6v6.2c0 4-3.1 7-7.4 8.4-4.3-1.4-7.4-4.4-7.4-8.4V6z"/><path d="m8.9 12 2.2 2.2 4-4.2"/>',
 "flag":    '<path d="M6 20.4V4.2h10.6l-1.7 3.6 1.7 3.6H6"/>',
 "building":'<path d="M4.6 20.4V5.2h9.2v15.2M13.8 10.2h5.6v10.2"/><path d="M7.4 8.6h3.6M7.4 12.2h3.6M7.4 15.8h3.6"/>',
 "swap":    '<path d="M4.4 8.6h13.2l-3-3M19.6 15.4H6.4l3 3"/>',
 "key":     '<circle cx="8.2" cy="15.8" r="3.6"/><path d="m10.8 13.2 8-8M16.4 7.6l2 2M14.2 9.8l2 2"/>',
}


def sprite():
    out = ['<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>']
    for name, body in ICONS.items():
        out.append(f'<g id="i-{name}" fill="none" stroke="currentColor" stroke-width="1.7" '
                   f'stroke-linecap="round" stroke-linejoin="round">{body}</g>')
    out.append("</defs></svg>")
    return "".join(out)


def nav_html(active, kind):
    """
    THE NAV IS COMPUTED, AND THAT IS THE POINT OF THE WHOLE SET.

    An org admin and a platform admin are not the same person and must not see
    the same console. `NAV_ORG` is what a member of Northwind sees; `NAV_PLATFORM`
    is what somebody who works on Engage sees — and it contains no content
    section at all, because after this change a platform admin cannot open an
    org's question sets, sessions or reports without a logged, expiring grant.
    """
    # "none" is a real state, not an edge case: an approved account that has not
    # joined or created an organisation yet. It gets NO sections, because every
    # section is a place inside an org and there is no org — the first cut of
    # this set drew the first-run screen with Northwind's populated nav beside
    # the words "one more thing before you can build anything", which is a
    # contradiction a reader spots immediately.
    if kind == "none":
        groups = []
    elif kind == "personal":
        groups = NAV_PERSONAL
    elif kind == "platform":
        groups = NAV_PLATFORM
    else:
        groups = NAV_ORG
    rows = []
    for label, items in groups:
        if label:
            rows.append(f'<div class="nav-sec">{label}</div>')
        for key, icon, text, tail in items:
            cur = ' aria-current="page"' if key == active else ""
            t = ""
            if tail:
                cls = "badge" if str(tail).startswith("!") else "count"
                t = f'<span class="{cls}">{str(tail).lstrip("!")}</span>'
            rows.append(
                f'<button class="nav-item"{cur}><svg class="ico" viewBox="0 0 24 24">'
                f'<use href="#i-{icon}"/></svg><span class="nav-label">{text}</span>{t}</button>')
    rows.append('<div class="nav-foot"><button class="nav-item"'
                + (' aria-current="page"' if active == "settings" else "")
                + '><svg class="ico" viewBox="0 0 24 24"><use href="#i-gear"/></svg>'
                  '<span class="nav-label">Settings</span></button></div>')
    return "\n    ".join(rows)


TOP = """  <header class="brand">
    <span class="mark" aria-hidden="true"></span>
    <span class="word">Engage</span>
  </header>

  <div class="top">
    <nav class="crumbs" aria-label="Breadcrumb">{crumbs}</nav>
    <span class="spacer"></span>
    {orgchip}
    <span class="envchip dev">dev</span>
    <div class="who">
      <span class="avatar" aria-hidden="true">{initials}</span>
      <span class="name">{email}</span>
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
<title>{title} — Engage2 teams</title>
<style>
{css}
{extra}
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
(function(){{
  var b=document.getElementById('annoBtn');
  function set(off){{
    document.body.classList.toggle('no-anno',off);
    b.textContent=off?'Show design notes':'Hide design notes';
    try{{localStorage.setItem('tenancyAnno',off?'0':'1');}}catch(e){{}}
  }}
  try{{ if(localStorage.getItem('tenancyAnno')==='0') set(true); }}catch(e){{}}
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
    """One back link to the parent, never the object's own name.

    Same rule as the admin set: the topbar may not restate the h1 sitting 30px
    below it, so a root list shows nothing at all here.
    """
    parent = [label for label, cur in items if not cur]
    return f'<a href="#" class="back">&lsaquo;&ensp;{parent[-1]}</a>' if parent else ""


ANNO_RE = re.compile(r'<aside class="anno".*?</aside>', re.S)


def split_annos(body):
    """Lift design notes into their own grid column.

    Authored inline next to the markup they describe — the only way to keep them
    in sync — but they must not RENDER there, or they sit on top of table rows.
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
            orgchip=p.get("orgchip", ""),
            nav=nav_html(p["nav"], p.get("navkind", "org")),
            initials=p.get("initials", "AR"),
            email=p.get("email", "amara.reyes@northwind.example"),
        )
        html = DOC.format(title=p["title"], css=CSS, extra=EXTRA,
                          extra_css=p.get("css", ""), sprite=sp, chrome=chrome,
                          body=p["body"], after=p["_rail"] + p.get("after", ""))
        with open(os.path.join(OUT, p["file"]), "w", encoding="utf-8") as f:
            f.write(html)
        written.append(p["file"])
    print(f"wrote {len(written)} mockups:")
    for w in written:
        print("  " + w)


if __name__ == "__main__":
    build()
