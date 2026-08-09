#!/usr/bin/env python3
"""Writes the mockups. Run from this directory:  python3 build.py

The .html files it produces are the deliverable and are self-contained — no
build step, no CDN, no external assets. This script exists so seventeen files
cannot drift apart, not because the output depends on it.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from shell import page          # noqa: E402
import pages_join               # noqa: E402
import pages_auth               # noqa: E402

OUT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

ALL = {}
ALL.update(pages_join.PAGES)
ALL.update(pages_auth.PAGES)

for name, (title, body, extra_css, script) in sorted(ALL.items()):
    html = page(title, body, extra_css, script)
    with open(os.path.join(OUT, name), "w", encoding="utf-8") as fh:
        fh.write(html)
    print(f"{name:32s} {len(html):>7,} bytes")

print(f"\n{len(ALL)} mockups written to {OUT}")
