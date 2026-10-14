/**
 * THE HOST PAGE'S JOIN CODE AND THE SCREENS, AS A STATE MACHINE (owner,
 * 2026-10-13: "when i hover over QR code game id on host it pops up on the
 * present screen, but when i click away and it closes on host it never does
 * on the present screen").
 *
 * The bug: the server's echo of the host's own "join" arrived while the code
 * was already pinned, so a one-shot "came from the server" flag was set and
 * never cleared, and the click that unpinned it published nothing. This
 * replays the host page's two rules (the publish effect and the frame
 * handler) over the exact sequence and asserts what reaches the server.
 */
function hostModel() {
  const sent = [];
  let qrMode = null;
  let joinOnServer = false;
  const effect = () => {
    const pinned = qrMode === 'pinned';
    if (pinned === joinOnServer) return;
    joinOnServer = pinned;
    sent.push(pinned ? 'join' : 'none');
  };
  const setQr = (next) => {
    const v = typeof next === 'function' ? next(qrMode) : next;
    if (v === qrMode) return; // React skips an effect when state does not change
    qrMode = v;
    effect();
  };
  const frame = (focus) => {
    if (focus === 'join') { joinOnServer = true; setQr('pinned'); }
    else if (joinOnServer) { joinOnServer = false; setQr((m) => (m === 'pinned' ? null : m)); }
  };
  return { sent, setQr, frame, get qr() { return qrMode; } };
}

test('hover up, its echo, click away: the take-down reaches the screens', () => {
  const h = hostModel();
  h.setQr('pinned');           // hover pins it
  h.frame('join');             // the server echoes the host's own join
  h.setQr(null);               // a click anywhere takes it down here
  expect(h.sent).toEqual(['join', 'none']);
});

test('put up on the Remote: pinned here, and a click here takes it down everywhere', () => {
  const h = hostModel();
  h.frame('join');
  expect(h.qr).toBe('pinned');
  expect(h.sent).toEqual([]);
  h.setQr(null);
  expect(h.sent).toEqual(['none']);
});

test('taken down on the Presentation: unpinned here, nothing echoed back', () => {
  const h = hostModel();
  h.setQr('pinned');
  h.frame('join');
  h.frame('none');
  expect(h.qr).toBe(null);
  expect(h.sent).toEqual(['join']);
});

test('J twice and hover again keep the screens in step', () => {
  const h = hostModel();
  h.setQr('pinned'); h.frame('join');
  h.setQr(null); h.frame('none');
  h.setQr('pinned'); h.frame('join');
  h.setQr(null);
  expect(h.sent).toEqual(['join', 'none', 'join', 'none']);
});
