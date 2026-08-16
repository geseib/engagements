/**
 * IS THE INVITE DIALOG ACTUALLY REACHABLE FROM BOTH BUTTONS?
 *
 * `inviteDialog.test.jsx` mounts the dialog directly and proves it behaves.
 * This proves the page reaches it — a distinction that matters here more than
 * usual, because of one structural trap:
 *
 *   `GameHostPage`'s session-history branch is an early `return`. Anything
 *   rendered in the main tree below it is UNREACHABLE from that screen. A
 *   single mount in the main tree leaves the history list's Invite button
 *   opening nothing at all, and every test that mounts the dialog directly
 *   still passes.
 *
 * Source assertions, comment-stripped, in the idiom of the other *CallSite
 * files here — that helper exists because a previous test in this repo passed
 * on prose in a comment.
 */
const fs = require('fs');
const path = require('path');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const strip = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const HOST = strip(read('GameHostPage.jsx'));
const PANEL = strip(read('components', 'stage', 'SessionSetupPanel.jsx'));

describe('§1 the dialog is mounted where each opener can see it', () => {
  test('the page imports and renders it', () => {
    expect(HOST).toMatch(/import InviteDialog from '\.\/components\/InviteDialog'/);
    expect(HOST).toMatch(/<InviteDialog/);
  });

  /*
    THE TRAP. Both mounts are required and they are not redundant: the first is
    inside the `showReportsModal` early return, the second is in the main tree.
    Asserting only "it is rendered somewhere" is exactly the assertion that
    lets a dead history button ship.
  */
  test('it is mounted inside the session-history early return AND in the main tree', () => {
    const guard = HOST.indexOf('if (showReportsModal) {');
    const mounts = [...HOST.matchAll(/<InviteDialog/g)].map((m) => m.index);
    expect(guard).toBeGreaterThan(-1);
    expect(mounts).toHaveLength(2);
    // One before the early return closes, one after it.
    const historyEnd = HOST.indexOf('\n  }\n', guard);
    expect(mounts[0]).toBeGreaterThan(guard);
    expect(mounts[0]).toBeLessThan(historyEnd);
    expect(mounts[1]).toBeGreaterThan(historyEnd);
  });
});

describe('§2 both buttons open the one dialog', () => {
  test('the history list and the setup panel both set the same state', () => {
    // "identical mech" is this: two openers, one piece of state, one component.
    expect([...HOST.matchAll(/setInviteTarget\(\{/g)]).toHaveLength(2);
    expect(HOST).toMatch(/onInvite=\{\(session\) =>/);
    expect(HOST).toMatch(/onInvite=\{\(\) =>/);
  });

  test('the setup panel takes onInvite, not the old copy-straight-to-clipboard prop', () => {
    expect(PANEL).toMatch(/onInvite = \(\) => \{\}/);
    expect(PANEL).not.toMatch(/onCopyInvite/);
    expect(PANEL).not.toMatch(/inviteCopied/);
  });

  test('the panel is told to stop answering keys while the dialog is up', () => {
    expect(HOST).toMatch(/suppressKeys=\{Boolean\(inviteTarget\)\}/);
    expect(PANEL).toMatch(/if \(suppressKeys\) return;/);
  });
});

describe('§3 the old implementations are gone, not merely bypassed', () => {
  test.each([
    ['copyInviteInfo', /const copyInviteInfo/],
    ['createInvite', /const createInvite/],
    ["the history invite's four-line text", /Join the engagement!/],
    ['the panel invite text, now in config/invite.js', /ENGAGEMENT INVITATION/],
    ['the eventTitle read that was always undefined', /game\.eventTitle \|\| 'Engagement Session'/],
  ])('%s is no longer in GameHostPage', (_label, pattern) => {
    expect(HOST).not.toMatch(pattern);
  });

  test('the page no longer builds invite text at all', () => {
    /*
      One builder, in config/invite.js. Two is how they drifted apart in the
      first place.

      Matched on markers unique to the INVITE. A first version of this also
      asserted `INSTRUCTIONS:` was gone and failed on an AI prompt template
      four hundred lines away that happens to use the same word — a test that
      would have blocked the commit for a string it was never about.
    */
    expect(HOST).not.toMatch(/TO JOIN:/);
    expect(HOST).not.toMatch(/Ready to engage\? See you there!/);
    expect(HOST).not.toMatch(/Click this link or copy it to your browser/);
  });
});

describe('§4 the live session supplies its own creation date', () => {
  /*
    The deadline is creation + 90 days, so without this the panel's invite
    cannot check a date. It is also per-game state: `config/gameSession.js`
    lists it, and `gameSession.test.js` fails if the setter map drifts — which
    is what caught its omission before it shipped.
  */
  test('createdAt is captured from the state payload', () => {
    expect(HOST).toMatch(/setGameCreatedAt\(gameStateData\.gameMetadata\.createdAt/);
  });

  test('and it resets when the host switches session', () => {
    const KEYS = strip(read('config', 'gameSession.js'));
    expect(KEYS).toMatch(/gameCreatedAt: null/);
    expect(HOST).toMatch(/gameCreatedAt: setGameCreatedAt/);
  });
});
