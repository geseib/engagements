/**
 * THE ONE-SCREEN STAGE'S FRAME, AS STYLESHEET TEXT, AND WHAT IT MEASURED
 * (experience plan §3.3, Phase 2 step 2h; engage-design §5). jsdom loads no
 * stylesheet and has no layout, so the contract is read from the files and
 * the geometry is the Chromium record below. NO GEOMETRIC ASSERTIONS ON jsdom.
 *
 * PLAN marks 2h medium–high: the fitter measured a bottom dock, and moving
 * the host's controls to the top changes every fit. So this pins:
 *   - the grid: top bar, Your part now, the Needs-you line, then the rail, in
 *     that order, and no bottom dock row left holding 13vh;
 *   - the frame is host chrome on the laptop ladder (fixed px, never the
 *     profile's --t-* / --L-*), nothing under 12px; the stage's own ladder
 *     (rail, meter, content) is untouched by this change;
 *   - the panels and the scoreboard leave the frame live;
 *   - contrast of the new paint, from the skin's dusk values;
 *   - the measurements, so a later change that moves the frame is compared
 *     against numbers rather than memory.
 *
 * // rejects: a bottom dock still reserving --dock-h under a top-mounted frame.
 * // rejects: the frame's text drawn from the room's ladder (TV's 26px floor
 * //          would make a "slim" bar 70px tall and push the content off).
 * // rejects: the Session menu or the scoreboard covering Your part now.
 */
const fs = require('fs');
const path = require('path');
const { MEASURED } = require('../testing/stageFrameMeasured');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const noComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const stage = noComments(read('styles', 'stage.css'));
const hc = noComments(read('components', 'console', 'HostConsole.css'));
const ny = noComments(read('components', 'needs', 'NeedsYou.css'));
const styles = noComments(read('styles.css'));
const rule = (css, sel) => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`(?:^|[}\\n])\\s*${esc}\\s*\\{([^}]*)\\}`));
  return m ? m[1] : '';
};

describe('the grid: the host\'s frame on top, the rail under it', () => {
  test('rows: top · now · needs · rail · bar · strip · main · dock', () => {
    const base = rule(stage, '.stage');
    expect(base).toMatch(/grid-template-areas:"top" "now" "needs" "rail" "bar" "strip" "main" "dock"/);
    expect(base).toMatch(/grid-template-rows:auto auto auto auto auto auto minmax\(0,1fr\) auto/);
    expect(rule(stage, '.stage-top')).toMatch(/grid-area:top/);
    expect(rule(stage, '.stage-now')).toMatch(/grid-area:now/);
    expect(rule(stage, '.stage-needs')).toMatch(/grid-area:needs/);
  });

  test('with Your part now there is no bottom dock and no placeholder holding its height', () => {
    const src = read('components', 'stage', 'Stage.jsx');
    expect(src).toMatch(/\{dock \|\| \(now \? null : <div className="dock" \/>\)\}/);
    // Your part now undoes the bottom band's min-height (13vh in Room).
    expect(rule(stage, '.dock.dock--part')).toMatch(/min-height:0/);
  });

  test('the fitter refits when a frame row changes height, and publishes where the frame ends', () => {
    const fit = read('hooks', 'useStageFit.js');
    expect(fit).toMatch(/querySelectorAll\('\.dock, \.stage-top, \.stage-now, \.stage-needs, \.main, \.meter'\)/);
    expect(fit).toMatch(/setProperty\('--stage-now-bottom'/);
    expect(fit).toMatch(/setProperty\('--dock-measured', '0px'\)/);
    expect(fit).toMatch(/removeProperty\('--stage-now-bottom'\)/);
    // And when the content grows after its fit (a late reveal), measured from
    // where the last run left it, so the refit it triggers cannot loop.
    expect(fit).toMatch(/querySelectorAll\('\.content > \.fitbox'\)/);
    expect(fit).toMatch(/Math\.abs\(Math\.round\(el\.getBoundingClientRect\(\)\.height\) - settled\.get\(el\)\) > 1/);
    expect(fit).toMatch(/publishDockHeight\(\);\s*remember\(\);/);
  });
});

describe('host chrome on the laptop ladder, nothing under 12px; the stage\'s ladder untouched', () => {
  const frameRules = [...stage.matchAll(/([^{}]*(?:\.stage-top|\.stage-now|\.stage-needs|\.dock--part)[^{}]*)\{([^}]*)\}/g)];

  test('every size in the frame is fixed px, 12 or more, never the room\'s ladder', () => {
    expect(frameRules.length).toBeGreaterThan(10);
    frameRules.forEach(([, sel, body]) => {
      expect([sel.trim(), /var\(--(t|L)-/.test(body)]).toEqual([sel.trim(), false]);
      for (const m of body.matchAll(/font-size:\s*(\d+)px/g)) {
        expect([sel.trim(), Number(m[1]) >= 12]).toEqual([sel.trim(), true]);
      }
    });
    // The label, the status, the hint, the buttons and the key cap, named.
    expect(rule(stage, '.dock.dock--part .dock-k')).toMatch(/font-size:12px/);
    expect(rule(stage, '.dock.dock--part .status')).toMatch(/font-size:15px/);
    expect(rule(stage, '.dock.dock--part .hint')).toMatch(/font-size:13px/);
    expect(stage).toMatch(/\.dock\.dock--part \.host-action-bar__tertiary\{font-size:15px;/);
    expect(rule(stage, '.dock.dock--part .host-action-bar__primary .keycap')).toMatch(/font-size:12px/);
  });

  test('the new top-bar parts are on the console\'s ladder (12 / 13px)', () => {
    // The bell is ui/Button at 36px since step 5a (OneScreenNeedsBell passes size 36);
    // the bar sets its type through --ui-size.
    expect(rule(hc, '.hc-top .hc-needsbtn')).toMatch(/--ui-size: 13px/);
    expect(rule(hc, '.hc-needs-n')).toMatch(/font-size: 12px/);
  });

  test('the four profile ladders are as they were (2h changes no stage type size)', () => {
    expect(stage).toMatch(/--floor:20px; --measure-base:26ch; --bar-h:8px; --fit-min:\.55;/);
    expect(stage).toMatch(/--floor:26px; --measure-base:22ch; --bar-h:12px; --fit-min:\.78;/);
    expect(stage).toMatch(/--floor:16px; --measure-base:30ch; --bar-h:5px; --fit-min:\.55;/);
  });

  test('the Needs-you line keeps one height, slimmer on the stage than on the console', () => {
    expect(rule(stage, '.stage-needs .ny')).toMatch(/--ny-line-h:36px/);
    expect(rule(ny, '.ny.ny-line')).toMatch(/height: var\(--ny-line-h\)/);
    // Public: an amber edge, no wash.
    const pub = rule(ny, '.ny.ny-line.ny-line--public.is-waiting');
    expect(pub).toMatch(/border-left-color: var\(--accent\)/);
    expect(pub).not.toMatch(/background/);
  });
});

describe('nothing covers the frame', () => {
  test('the Session menu and its scrim start below the frame', () => {
    expect(rule(styles, '.setup-panel-scrim')).toMatch(/top: var\(--stage-now-bottom, 0px\)/);
    expect(rule(styles, '.setup-panel')).toMatch(/top: var\(--stage-now-bottom, 0px\)/);
    // The console's sheet keeps its own geometry.
    expect(rule(hc, '.hc-sheet .setup-panel')).toMatch(/top: 0/);
  });

  test('the scoreboard spans the rail to the main area, leaving the frame live', () => {
    const sb = noComments(read('components', 'stage', 'scoreboard', 'Scoreboard.css'));
    expect(rule(sb, '.sb')).toMatch(/grid-row:rail-start \/ main-end/);
  });
});

describe('contrast of the new paint, from the skin\'s dusk values', () => {
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const lum = (rgb) => {
    const [r, g, b] = rgb.map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const over = (fg, a, bg) => fg.map((v, i) => Math.round(v * a + bg[i] * (1 - a)));
  const skin = read('styles', 'skins', 'classic.css');
  const tok = (name) => hex((skin.match(new RegExp(`--sk-${name}:\\s*(#[0-9A-Fa-f]{6})`)) || [])[1]);
  const BG = tok('dark-bg'); const SURFACE = tok('dark-surface'); const TEXT = tok('dark-text');
  const MUTED = tok('dark-muted'); const ACCENT = tok('accent'); const ON_ACCENT = tok('dark-on-accent'); const INFO = tok('info');

  test('the bell\'s count: --on-accent on --accent', () => {
    expect(ratio(ON_ACCENT, ACCENT)).toBeGreaterThanOrEqual(4.5);
  });
  test('"The room sees this screen": --text on the 14% info tint over the bar\'s --bg', () => {
    expect(ratio(TEXT, over(INFO, 0.14, BG))).toBeGreaterThanOrEqual(4.5);
  });
  test('Your part now: label (--muted) and status (--text) on --surface', () => {
    expect(ratio(MUTED, SURFACE)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(TEXT, SURFACE)).toBeGreaterThanOrEqual(4.5);
  });
});

/*
  THE MEASUREMENTS (Chromium 1194, the real GameHostPage over a fixture
  network; every phase of Call & Answer, Trivia, Poll, Wavelength and Survey;
  1280x720, 1366x768, 1440x900, 1920x1080; Room, TV, Call, Table). The raw
  per-state record is testing/stageFrameMeasured.js. A state is "clean" when
  nothing overflows the viewport or its own box, the frame never runs past its
  width, the host chrome is at least 12px and the stage's text is at least the
  profile's floor; "clamped" is the fitter's terminal state.
*/
/*
  THE ROOM'S TIME LINE ON ONE SCREEN (2f in 2h's frame, the merge). Unplaced,
  RoomTimeLine was a third grid item in .main: it wrapped into a row of its
  own under the content at 16px, under every profile's floor, and clipped
  TV's Call & Answer prompt at 1280x720 (Chromium). rejects: the time costing
  the content a row; the time at a size of its own; the time vanishing with
  the meter's column; the time stated twice.
*/
describe('the room\'s time line: in the meter\'s column, or the rail when the column goes', () => {
  test('under the meter, in its column, at the label tier, and never widening the column', () => {
    const t = rule(stage, '.main > .stage-time');
    expect(t).toMatch(/grid-column:-2 \/ -1/);
    expect(t).toMatch(/grid-row:1/);
    expect(t).toMatch(/align-self:end/);
    expect(t).toMatch(/contain:inline-size/);
    expect(t).toMatch(/font-size:var\(--t-meta\)/);
    // Both placed: auto-placement would push the meter under the content.
    expect(rule(stage, '.main:has(> .stage-time) > .meter')).toMatch(/grid-column:-2 \/ -1;grid-row:1/);
  });

  test('the fitter taking the column moves it to the rail: exactly one shows', () => {
    expect(rule(stage, '.main.solo > .stage-time')).toMatch(/display:none/);
    expect(rule(stage, '.rail .rail-time')).toMatch(/display:none/);
    expect(rule(stage, '.rail .rail-time')).toMatch(/font-size:var\(--t-meta\)/);
    expect(rule(stage, '.stage:has(> .main[data-auto-solo="1"]) .rail .rail-time')).toMatch(/display:inline-flex/);
    const page = read('GameHostPage.jsx');
    expect(page).toMatch(/<RoomTimeLine time=\{phaseTimer\} className="stage-time" \/>/);
    expect(page).toMatch(/time=\{phaseTimer && phaseTimer\.onWall !== false \? <RoomTimeLine time=\{phaseTimer\} className="rail-time" \/> : null\}/);
  });

  test('a fit taken at the edge refits when its box settles a sub-pixel shorter (Trivia answering, TV 1280x720)', () => {
    const fit = read('hooks', 'useStageFit.js');
    expect(fit).toMatch(/const contents = fitboxes\.map\(\(el\) => el\.parentNode\)\.filter\(Boolean\);/);
    expect(fit).toMatch(/const edge = contents\.some\(\(box\) => box\.dataset\.clamped !== 'on' && over\(box\)\);/);
    expect(fit).toMatch(/if \(grew\) contents\.forEach\(\(el\) => grew\.observe\(el\)\);/);
  });

  test('measured: every timed state clean, the chip beside the main button, + adds a minute', () => {
    expect(MEASURED.timed.states).toBe(7);
    MEASURED.timed.rows.forEach((r) => {
      expect([r.size, r.profile, r.notClean]).toEqual([r.size, r.profile, []]);
      expect([r.size, r.profile, r.chipBesidePrimary]).toEqual([r.size, r.profile, true]);
      expect([r.size, r.profile, r.plusKeyAddsTime]).toEqual([r.size, r.profile, true]);
      expect([r.size, r.profile, r.timeWordsMinPx >= r.floor]).toEqual([r.size, r.profile, true]);
    });
  });
});

describe('the Chromium record', () => {
  test('every size and profile was measured, in every phase of the five one-screen types', () => {
    expect(MEASURED.sizes).toEqual(['1280x720', '1366x768', '1440x900', '1920x1080']);
    expect(MEASURED.profiles).toEqual(['room', 'tv', 'call', 'table']);
    expect(MEASURED.states).toBe(21);
    expect(MEASURED.rows).toHaveLength(16);
  });

  test('the main button sits in one place per size and profile, in every phase and type', () => {
    MEASURED.rows.forEach((r) => expect([r.size, r.profile, r.primaryTops.length]).toEqual([r.size, r.profile, 1]));
  });

  test('the frame never overflows its width and the host chrome never drops under 12px', () => {
    MEASURED.rows.forEach((r) => {
      expect([r.size, r.profile, r.frameOverflow]).toEqual([r.size, r.profile, 0]);
      expect([r.size, r.profile, r.hostMinPx >= 12]).toEqual([r.size, r.profile, true]);
    });
  });

  test('no state is worse than before 2h: every state clean before is clean after', () => {
    MEASURED.rows.forEach((r) => expect([r.size, r.profile, r.regressed]).toEqual([r.size, r.profile, []]));
  });
});
