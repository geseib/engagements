/**
 * THE JOIN CODE, IN STEP ON EVERY SURFACE (owner, 2026-10-13): "it needs to be
 * in sync on the remote, the host or present screen ... if i hover over the
 * join in host mode it should show up in the present screen ... on the remote
 * it could just come up on the remote modal, but there is a button there that
 * says display on screen. any click on the present screen or host screen or
 * remote or pressing j again should take the qr code down."
 *
 * The fact is one `join` focus on /stage-focus (tests/stage-focus-vote.js §8);
 * these are source contracts on the three pages that jsdom cannot mount whole.
 */
const fs = require('fs');
const path = require('path');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
const HOST = strip(read('GameHostPage.jsx'));
const REMOTE = strip(read('HostRemote.jsx'));
const PRESENT = strip(read('PresentPage.jsx'));

describe('host page (two surfaces)', () => {
  test('hovering the join code pins it, and leaving does not take it down', () => {
    expect(HOST).toMatch(/onPreview: \(\) => setQrMode\(\(mode\) => \(mode === 'pinned' \? mode : \(twoSurfaces \? 'pinned' : 'preview'\)\)\)/);
    expect(HOST).toMatch(/onPreviewEnd: \(\) => setQrMode\(\(mode\) => \(mode === 'pinned' \|\| twoSurfaces \? mode : null\)\)/);
  });
  test('it publishes whenever what this page shows differs from what the screens show', () => {
    // Since 18 Oct 2026 the join code is its own fact, `{ join }`, on
    // /stage-focus: `focus: 'none'` no longer takes it down.
    expect(HOST).toMatch(/if \(pinned === joinOnServerRef\.current\) return;\s*joinOnServerRef\.current = pinned;\s*if \(publishFocusRef\.current\) publishFocusRef\.current\(\{ join: pinned \}\)/);
  });
  test('a join frame (its own echo included) records the screens and pins it here; anything else takes it down', () => {
    // `joinUp` is the frame's `join`, or a legacy `focus: 'join'`.
    expect(HOST).toMatch(/const joinUp = typeof data\.join === 'boolean' \? data\.join : focus\.focus === 'join';/);
    expect(HOST).toMatch(/if \(joinUp\) \{\s*joinOnServerRef\.current = true;\s*setQrMode\('pinned'\);/);
    expect(HOST).toMatch(/else if \(joinOnServerRef\.current\) \{\s*joinOnServerRef\.current = false;/);
  });
  test('no one-shot "from the server" flag survives (the swallowed take-down, 2026-10-13)', () => {
    expect(HOST).not.toMatch(/joinFromServerRef|joinPublishedRef/);
  });
  test('J toggles it, outside fields', () => {
    expect(HOST).toMatch(/e\.key !== 'j' && e\.key !== 'J'/);
    expect(HOST).toMatch(/setQrMode\(\(mode\) => \(mode \? null : 'pinned'\)\)/);
  });
  test('a click on the code itself takes it down too (only the copy link keeps it)', () => {
    expect(HOST).toMatch(/twoSurfaces && !\(e\.target && e\.target\.closest && e\.target\.closest\('\.clickable-url'\)\)/);
  });
});

describe('Remote', () => {
  test('the panel button reads Display on screen and toggles the join focus', () => {
    expect(REMOTE).toMatch(/joinOnWall \? 'Take it off the screen' : 'Display on screen'/);
    // Since 18 Oct the QR is its own fact beside the focus: { join: true|false }.
    expect(REMOTE).toMatch(/setStageFocus\(\{ join: !joinOnWall \}\)/);
  });
  test('a join put up elsewhere opens the Join code panel here', () => {
    expect(REMOTE).toMatch(/if \(joinOnWall\) \{\s*setJoinOpen/);
  });
  test('any tap but the panel button takes it down', () => {
    expect(REMOTE).toMatch(/closest\('\[data-join-toggle\]'\)\) return;\s*setStageFocus\(\{ join: false \}\)/);
  });
});

describe('Presentation', () => {
  test('a click anywhere but the strip or the ask takes it down, as J does', () => {
    expect(PRESENT).toMatch(/closest\('\.present-strip, \.present-confirm'\)\) return;\s*toggleJoin\(\)/);
    expect(read('present/presentControls.js')).toMatch(/event\.key === 'j' \|\| event\.key === 'J'/);
  });
});
