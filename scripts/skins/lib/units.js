/**
 * The styles.css units (INVENTORY §3). A unit is found by its BANNER, never by
 * a line number: line numbers drift with every commit. Once seed-allowances.js
 * has run, each unit also carries a `/* skin-allowance SC-xx: … *\/` marker on
 * the line before its banner, and the markers are what the gate reads.
 *
 * `banner` is a regex matched against one line; the unit starts at the line
 * where its comment OPENS (a multi-line banner's `/* ====` line).
 */
const UNITS = [
  { id: 'SC-00', banner: null, what: 'Token layer, reset, icons, body (Phase 0 owns)' },
  { id: 'SC-01', banner: /^\/\* Game Host Page Styles \*\/\s*$/, what: 'Host page shell, setup panel, players, categories, browser, queue' },
  { id: 'SC-02', banner: /^\/\* --- The remote -{10,}/, what: 'Legacy remote, set selection, QR tab, AI summary section' },
  { id: 'SC-03', banner: /^\/\* Answer Navigator Styles \*\/\s*$/, what: 'Answer navigator, desktop/mobile input, voting toggle, detailed voting' },
  { id: 'SC-04', banner: /^\/\* Trivia Report Styles \*\/\s*$/, what: 'In-app reports: trivia/wavelength stats, report choices, enlarged question, set tabs' },
  { id: 'SC-05', banner: /^\/\* Quickstart checkbox styling \*\/\s*$/, what: 'Quickstart, format cards, AI review banner, AI modal, prompt debug' },
  { id: 'SC-06', banner: /^\/\* AI Insights Section Styles \*\/\s*$/, what: 'AI insights, clipboard, player trivia buttons, category selection, primary action' },
  { id: 'SC-07', banner: /^\s*BIG SCREEN MODE — Warm Summit dusk stage/, opensAbove: true, what: 'Big-screen hero stage: lobby/question/voting/results, Field Notes, responsive' },
  { id: 'SC-08', banner: /^\/\* Big Screen QR Code Styles \*\/\s*$/, what: 'Big-screen QR, markdown, Wavelength game + results' },
  { id: 'SC-09', banner: /^\/\* Question Browser Table Styles \*\/\s*$/, what: 'Question browser table, set editor (.qs-*), versions, question fields' },
  { id: 'SC-10', banner: /^\s*ANONYMOUS RESPONSES\s*$/, opensAbove: true, what: 'Session setup tail, anonymity, past rounds, answer spotlight' },
];

/** Resolve every unit to { id, from, to } (1-based, inclusive) in this text. */
function unitRanges(css) {
  const lines = css.split('\n');
  const starts = [];
  for (const u of UNITS) {
    if (!u.banner) { starts.push({ id: u.id, from: 1 }); continue; }
    const hits = [];
    lines.forEach((l, i) => { if (u.banner.test(l)) hits.push(i); });
    if (hits.length !== 1) {
      throw new Error(`${u.id}: banner ${u.banner} matched ${hits.length} lines in styles.css (want exactly 1) — update scripts/skins/lib/units.js`);
    }
    let at = hits[0];
    if (u.opensAbove) { while (at > 0 && !/^\s*\/\*/.test(lines[at])) at -= 1; }
    starts.push({ id: u.id, from: at + 1 });
  }
  for (let i = 1; i < starts.length; i += 1) {
    if (starts[i].from <= starts[i - 1].from) throw new Error(`${starts[i].id} starts before ${starts[i - 1].id}`);
  }
  return starts.map((s, i) => ({ ...s, to: i + 1 < starts.length ? starts[i + 1].from - 1 : lines.length }));
}

/**
 * Ranges as the GATE sees them: by the skin-allowance markers when present
 * (seeded), else by banner. A marker sits on the line just above its banner,
 * so marker-ranges and banner-ranges cover the same rules.
 */
function rangesFor(css) {
  const { unitPragmas } = require('./scan');
  const marked = unitPragmas(css);
  if (marked.length) return marked.map((m) => ({ id: m.unit, from: m.from, to: m.to, fields: m.fields }));
  return unitRanges(css);
}

module.exports = { UNITS, unitRanges, rangesFor };
