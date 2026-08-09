import fs from 'fs';
import path from 'path';

const HOST_PAGE = path.join(__dirname, '..', 'GameHostPage.jsx');
const source = fs.readFileSync(HOST_PAGE, 'utf8');

/**
 * TWO QR CODES, ONE PANEL, DIFFERENT AUDIENCES.
 *
 * The side panel's QR points at `/remote`, which is behind the host sign-in.
 * It shipped inside the block headed "Join In", one paragraph below "Players
 * can join at:" — so a host who told a latecomer "scan the QR in the Join In
 * panel" sent that player to a login for an account they will never have. The
 * caption under the QR was already right; the heading above it was not.
 *
 * Asserted against the source because GameHostPage cannot be rendered in jsdom
 * (AuthProvider plus a live socket). Same technique gameSession.test.js already
 * uses on this file.
 */
describe('the side panel keeps the remote QR clear of the join block', () => {
  const remoteQrIndex = source.indexOf('<QRCodeSVG value={remoteUrl}');
  const joinHeadingIndex = source.indexOf('<h3>Join In</h3>');

  test('the panel still has both a Join In heading and a remote QR', () => {
    // Guards the two assertions below from passing because the markup moved.
    expect(joinHeadingIndex).toBeGreaterThan(-1);
    expect(remoteQrIndex).toBeGreaterThan(joinHeadingIndex);
  });

  test('a heading of its own separates the remote QR from the join block', () => {
    // rejects: the shipped markup, where the only heading between "Join In"
    // and the remote QR was nothing at all.
    const between = source.slice(joinHeadingIndex, remoteQrIndex);
    expect(between).toMatch(/<h4[^>]*>[^<]*[Rr]emote/);
  });

  test('the QR still says what it is, and what it is not', () => {
    // rejects: relying on the heading alone. The caption is the last thing a
    // host reads before pointing a phone at it.
    const caption = source.slice(remoteQrIndex, remoteQrIndex + 400);
    expect(caption).toMatch(/Scan to open the remote on your phone/);
    expect(caption).toMatch(/Not the player link/);
  });

  test('the room-facing QR is still the rail\'s, not this panel\'s', () => {
    // rejects: re-adding a click-to-expand here. The expanded overlay renders
    // playUrl, so a magnified PLAYER QR would open on top of a REMOTE one.
    const qrSection = source.slice(joinHeadingIndex, remoteQrIndex);
    expect(qrSection).not.toMatch(/qr-code-clickable/);
  });
});
