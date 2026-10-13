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
  test('pinning publishes a join focus and unpinning publishes none', () => {
    expect(HOST).toMatch(/publishFocusRef\.current\(\{ focus: 'join' \}\)/);
    expect(HOST).toMatch(/publishFocusRef\.current\(\{ focus: 'none' \}\)/);
  });
  test('a join set elsewhere pins it here, and anything else takes it down', () => {
    expect(HOST).toMatch(/if \(focus\.focus === 'join'\) \{\s*joinFromServerRef\.current = true;\s*setQrMode\('pinned'\);/);
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
    expect(REMOTE).toMatch(/setStageFocus\(joinOnWall \? \{ focus: 'none' \} : \{ focus: 'join' \}\)/);
  });
  test('a join put up elsewhere opens the Join code panel here', () => {
    expect(REMOTE).toMatch(/if \(joinOnWall\) \{\s*setJoinOpen/);
  });
  test('any tap but the panel button takes it down', () => {
    expect(REMOTE).toMatch(/closest\('\[data-join-toggle\]'\)\) return;\s*setStageFocus\(\{ focus: 'none' \}\)/);
  });
});

describe('Presentation', () => {
  test('a click anywhere but the strip or the ask takes it down, as J does', () => {
    expect(PRESENT).toMatch(/closest\('\.present-strip, \.present-confirm'\)\) return;\s*toggleJoin\(\)/);
    expect(read('present/presentControls.js')).toMatch(/event\.key === 'j' \|\| event\.key === 'J'/);
  });
});
