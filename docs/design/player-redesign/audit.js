/* Player-redesign audit.
 *
 * Ten assertions over every mockup x three device profiles. Written to port
 * into component tests as-is: nothing here knows about the mockups' markup
 * beyond the class names the real components would carry.
 *
 * Serve the directory — from file:// the iframes are cross-origin and every
 * check reports "unreadable".
 */
const FILES = [
  "01-join.html","02-join-code-bad.html","03-join-ended.html","04-join-locked.html",
  "05-lobby.html","06-ask-trivia.html","07-ask-call.html","08-ask-call-typing.html",
  "09-ask-artwork.html","10-ask-poll.html","11-ask-wavelength.html","12-answered.html",
  "13-vote.html","14-vote-long.html","15-vote-submitted.html","16-results-trivia.html",
  "17-results-call.html","18-results-wavelength.html","19-between-rounds.html","20-ended.html",
  "21-offline.html","22-rejoin.html","23-type-ladder.html"
];
const DEVICES = [
  { id: "phone",  w: 375,  h: 812,  floor: 13 },
  { id: "tablet", w: 768,  h: 1024, floor: 15 },
  { id: "laptop", w: 1280, h: 800,  floor: 17 }
];
const ANON = "Nobody sees who wrote what — the host included — until voting closes.";
const QUALIFIER = "This hides names, not identities.";

/* ---- colour ------------------------------------------------------------- */
const lin = c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const lum = ([r, g, b]) => 0.2126 * lin(r / 255) + 0.7152 * lin(g / 255) + 0.0722 * lin(b / 255);
const parse = s => {
  const m = String(s).match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
  return { rgb: p.slice(0, 3), a: p.length > 3 ? p[3] : 1 };
};
const over = (fg, bg, a) => fg.map((c, i) => c * a + bg[i] * (1 - a));
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};
function bgOf(el, win) {
  let n = el, acc = null;
  while (n && n.nodeType === 1) {
    const c = parse(win.getComputedStyle(n).backgroundColor);
    if (c && c.a > 0) {
      acc = acc === null ? (c.a === 1 ? c.rgb : null) : acc;
      if (c.a === 1) return c.rgb;
    }
    n = n.parentElement;
  }
  return [15, 26, 46];
}

/* ---- checks ------------------------------------------------------------- */
const TEXTY = "h1,h2,h3,p,span,li,td,th,label,button,a,div.rtxt,div.quote";

function run(doc, win, dev, source) {
  const out = [];
  const fail = (id, msg) => out.push({ id, ok: false, msg });
  const pass = id => out.push({ id, ok: true });
  const de = doc.documentElement, body = doc.body;

  // A1 — nothing scrolls sideways. Ever.
  de.scrollWidth <= dev.w + 1
    ? pass("A1") : fail("A1", `document scrollWidth ${de.scrollWidth} > ${dev.w}`);

  // A2 — the page itself does not scroll; only .stage does. A dock that can be
  // pushed below the fold is the defect this whole layout exists to prevent.
  body.scrollHeight <= dev.h + 1
    ? pass("A2") : fail("A2", `body scrollHeight ${body.scrollHeight} > ${dev.h}`);

  // A3 — if there is a primary action it is fully on screen at rest.
  const dock = doc.querySelector(".dock");
  if (!dock) pass("A3");
  else {
    const r = dock.getBoundingClientRect();
    r.bottom <= dev.h + 1 && r.top >= 0
      ? pass("A3") : fail("A3", `dock ${Math.round(r.top)}–${Math.round(r.bottom)} vs ${dev.h}`);
  }

  // A4 — touch targets. 44x44 minimum, no exceptions, including the ones inside
  // chips and pagers where it is easiest to cheat.
  let bad4 = [];
  doc.querySelectorAll("button,a,input,textarea,select").forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;      // not rendered
    if (r.height < 43.5 || r.width < 43.5)
      bad4.push(`${el.className || el.tagName} ${Math.round(r.width)}x${Math.round(r.height)}`);
  });
  bad4.length ? fail("A4", bad4.slice(0, 4).join("; ")) : pass("A4");

  // A5 — the type floor is per-device and angular in origin (RATIONALE §3).
  let bad5 = [];
  doc.querySelectorAll(TEXTY).forEach(el => {
    if (!el.textContent.trim()) return;
    const fs = parseFloat(win.getComputedStyle(el).fontSize);
    if (fs < dev.floor - 0.5) bad5.push(`${el.className || el.tagName} ${fs}px`);
  });
  bad5.length ? fail("A5", [...new Set(bad5)].slice(0, 4).join("; ")) : pass("A5");

  // A6 — WCAG 2.1 AA against the real background. No black-lift model: a phone
  // is a direct-view emissive panel, so the measured number is the number.
  let bad6 = [];
  doc.querySelectorAll(TEXTY).forEach(el => {
    const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    if (!own) return;
    const cs = win.getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") return;
    const fg = parse(cs.color); if (!fg) return;
    const bg = bgOf(el, win);
    const eff = fg.a < 1 ? over(fg.rgb, bg, fg.a) : fg.rgb;
    const size = parseFloat(cs.fontSize), weight = parseInt(cs.fontWeight, 10) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const need = large ? 3 : 4.5;
    const r = ratio(eff, bg);
    if (r < need - 0.02)
      bad6.push(`${el.className || el.tagName} ${r.toFixed(2)}:1 (needs ${need})`);
  });
  bad6.length ? fail("A6", [...new Set(bad6)].slice(0, 4).join("; ")) : pass("A6");

  // A7 — the anonymity sentence, verbatim, wherever a ballot is shown, with the
  // qualifier. Copy that overclaims is the failure mode here, not layout.
  const isBallot = !!doc.querySelector(".resp");
  if (!isBallot) pass("A7");
  else {
    const t = body.innerText.replace(/\s+/g, " ");
    t.includes(ANON.replace(/\s+/g, " ")) && t.includes(QUALIFIER)
      ? pass("A7") : fail("A7", "ballot without the exact anonymity sentence + qualifier");
  }

  // A8 — the ballot is positional. Numbers are 1-based, strictly increasing and
  // absolute; a page never reindexes. This is what lets a host say "response
  // eleven" and have it mean one thing.
  const ids = [...doc.querySelectorAll(".rid")]
    .map(e => parseInt(e.textContent.replace(/\D+/g, ""), 10));
  if (!ids.length) pass("A8");
  else {
    const inc = ids.every((n, i) => i === 0 || n > ids[i - 1]);
    const contiguous = ids[ids.length - 1] - ids[0] === ids.length - 1;
    inc && contiguous && ids[0] >= 1
      ? pass("A8") : fail("A8", `response numbers ${ids.join(",")}`);
  }

  // A9 — volume is structural. A REST or WATCH screen has no dock and spends no
  // amber: if there is nothing to do, there must be nothing that looks pressable.
  const vol = body.className.replace("v-", "");
  if (vol === "act") pass("A9");
  else {
    const issues = [];
    if (dock) issues.push("has a .dock");
    doc.querySelectorAll("*").forEach(el => {
      const bg = parse(win.getComputedStyle(el).backgroundColor);
      if (bg && bg.a > 0.5 && bg.rgb[0] > 220 && bg.rgb[1] > 140 && bg.rgb[1] < 200 && bg.rgb[2] < 120)
        issues.push(`amber fill on .${el.className || el.tagName}`);
    });
    issues.length ? fail("A9", issues.slice(0, 3).join("; ")) : pass("A9");
  }

  // A10 — self-contained. No CDN, no external asset, no build step.
  const ext = (source.match(/(?:src|href)="https?:|url\(\s*https?:|@import/g) || []);
  ext.length ? fail("A10", `${ext.length} external reference(s)`) : pass("A10");

  return out;
}

/* ---- driver ------------------------------------------------------------- */
const IDS = ["A1","A2","A3","A4","A5","A6","A7","A8","A9","A10"];
const LABEL = {
  A1:"no sideways scroll", A2:"page itself never scrolls", A3:"primary action on screen",
  A4:"touch targets ≥44×44", A5:"type floor per device", A6:"contrast AA, measured",
  A7:"anonymity copy verbatim", A8:"ballot numbers absolute", A9:"REST/WATCH is quiet",
  A10:"self-contained"
};

async function main() {
  const root = document.getElementById("out");
  const frame = document.getElementById("probe");
  let total = 0, failed = 0;

  for (const file of FILES) {
    const source = await (await fetch(file)).text();
    const row = document.createElement("div");
    row.className = "file";
    row.innerHTML = `<h3>${file}</h3>`;
    for (const dev of DEVICES) {
      frame.style.width = dev.w + "px";
      frame.style.height = dev.h + "px";
      await new Promise(res => { frame.onload = res; frame.src = file; });
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const doc = frame.contentDocument, win = frame.contentWindow;
      const results = run(doc, win, dev, source);
      const cell = document.createElement("div");
      cell.className = "dev";
      cell.innerHTML = `<b>${dev.id}</b>` + IDS.map(id => {
        const r = results.find(x => x.id === id);
        total++;
        if (!r || !r.ok) { failed++; return `<span class="bad" title="${r ? r.msg : "n/a"}">${id}</span>`; }
        return `<span class="ok">${id}</span>`;
      }).join("");
      const msgs = results.filter(r => !r.ok)
        .map(r => `<p class="msg"><b>${r.id}</b> ${r.msg}</p>`).join("");
      cell.innerHTML += msgs;
      row.appendChild(cell);
    }
    root.appendChild(row);
  }
  document.getElementById("score").textContent =
    failed === 0 ? `${total} assertions, all pass`
                 : `${total} assertions, ${failed} FAIL`;
  document.getElementById("score").className = failed ? "bad" : "ok";
  document.getElementById("legend").innerHTML =
    IDS.map(id => `<span><b>${id}</b> ${LABEL[id]}</span>`).join("");
}
main();
