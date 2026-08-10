import fs from 'fs';
import path from 'path';

const src = (...p) => path.join(__dirname, '..', ...p);
const source = fs.readFileSync(src('GameHostPage.jsx'), 'utf8');

/**
 * TWO QR CODES, TWO AUDIENCES, AND THEY MUST NEVER SWAP.
 *
 * | Surface     | Encodes    | Audience     | Where              |
 * |-------------|------------|--------------|--------------------|
 * | player join | `playUrl`  | the room     | the stage's rail   |
 * | host remote | `remoteUrl`| one operator | the setup panel    |
 *
 * The remote QR is behind the host sign-in, and it shipped once inside a block
 * headed "Join In", one paragraph below "Players can join at:" — so a host who
 * told a latecomer "scan the QR in the panel" sent that player to a login for
 * an account they will never have.
 *
 * The panel that carried it has been replaced by `<SessionSetupPanel>`, and the
 * copy-level guarantees moved with it: `sessionSetupPanel.test.jsx` renders the
 * panel and asserts that its QR value matches `/\/remote\?gameId=/` and that
 * the word "join" appears nowhere in the remote section. What CANNOT be
 * asserted there, and is asserted here, is the division of labour at the call
 * site — which url the page hands to which surface.
 */
describe('the host page hands each QR surface the right url', () => {
  test('the setup panel gets the REMOTE url', () => {
    // rejects: passing playUrl to the panel, which walks the host's own phone
    // into the player flow.
    expect(source).toMatch(/<SessionSetupPanel[\s\S]{0,2000}remoteUrl=\{remoteUrl\}/);
  });

  test('the same call also hands it the player link, separately labelled', () => {
    // rejects: collapsing the two into one prop. The panel prints the player
    // link under its own heading and the remote url under another; one prop
    // for both is how they become ambiguous again.
    expect(source).toMatch(/<SessionSetupPanel[\s\S]{0,2000}playUrl=\{playUrl\}/);
  });

  test('remoteUrl is the /remote route, carrying the game', () => {
    // rejects: a QR that lands the host on a remote with no session — which is
    // a QR that has failed.
    expect(source).toMatch(/const remoteUrl = `\$\{window\.location\.origin\}\/remote\?gameId=\$\{gameId\}`/);
  });

  test('the room-facing QRs are still playUrl, and still on the stage', () => {
    // rejects: pointing the lobby or the expanded overlay at the remote, which
    // would project a host-only sign-in at a room trying to join.
    expect(source).toMatch(/<QRCodeSVG value=\{playUrl\} size=\{512\}/);   // the lobby
    expect(source).toMatch(/<QRCodeSVG value=\{playUrl\} size=\{300\}/);   // the rail's overlay
  });

  test('the panel is the only other QR on the page', () => {
    // rejects: a third QR appearing without anyone deciding what it encodes.
    // Three: lobby, expanded overlay, and the panel's own import-site render.
    const rendered = source.match(/<QRCodeSVG/g) || [];
    expect(rendered).toHaveLength(2);
  });
});
