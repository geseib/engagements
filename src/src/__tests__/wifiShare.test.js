import { wifiState, shouldOfferWifi } from '../buildroom/wifiShare';

const NOW = '2026-10-07T12:00:00.000Z';
const ago = (ms) => new Date(Date.parse(NOW) - ms).toISOString();

describe('wifiState: the chip says what is happening, in words', () => {
  test('off, and off with no lan at all', () => {
    expect(wifiState(null, NOW)).toEqual({ state: 'off', label: 'Wi-Fi · Off', open: 0 });
    expect(wifiState({ wanted: false, status: 'off' }, NOW).label).toBe('Wi-Fi · Off');
  });
  test('starting', () => {
    expect(wifiState({ wanted: true, status: 'starting' }, NOW).label).toBe('Wi-Fi · Starting…');
  });
  test('starting for more than 25 s with no answer from Claude Code: waiting', () => {
    const waiting = { state: 'waiting', label: 'Wi-Fi · Waiting for Claude Code', open: 0 };
    expect(wifiState({ wanted: true, status: 'starting', wantedAt: ago(20000), reportedAt: null }, NOW).state).toBe('starting');
    expect(wifiState({ wanted: true, status: 'starting', wantedAt: ago(30000), reportedAt: null }, NOW)).toEqual(waiting);
    // a report older than the switch is no answer to it; a newer one is
    expect(wifiState({ wanted: true, status: 'starting', wantedAt: ago(30000), reportedAt: ago(40000) }, NOW)).toEqual(waiting);
    expect(wifiState({ wanted: true, status: 'starting', wantedAt: ago(30000), reportedAt: ago(5000) }, NOW).state).toBe('starting');
    // now may be a number
    expect(wifiState({ wanted: true, status: 'starting', wantedAt: ago(30000) }, Date.parse(NOW)).state).toBe('waiting');
  });
  test('on, with how many devices', () => {
    expect(wifiState({ wanted: true, status: 'live', open: 9, liveSince: ago(600000) }, NOW)).toEqual({ state: 'on', label: 'Wi-Fi · On · 9 open', open: 9 });
  });
  test('on but none open: says nothing for 2 minutes, then "none open yet"', () => {
    expect(wifiState({ wanted: true, status: 'live', open: 0, liveSince: ago(60000) }, NOW).state).toBe('on');
    expect(wifiState({ wanted: true, status: 'live', open: 0, liveSince: ago(121000) }, NOW)).toEqual({ state: 'quiet', label: 'Wi-Fi · On · none open yet', open: 0 });
  });
  test('failed', () => {
    expect(wifiState({ wanted: true, status: 'failed', error: 'No Wi-Fi address' }, NOW).label).toBe("Wi-Fi · Didn't start");
  });
});

describe('shouldOfferWifi: once, when Claude first shows something running on this laptop', () => {
  const lan = { wanted: false, status: 'off', offerDismissed: false };
  test('a showing entry by Claude with a local link', () => {
    expect(shouldOfferWifi({ lan, log: [{ by: 'agent', kind: 'showing', link: 'http://localhost:5173/' }], asks: [] })).toBe(true);
  });
  test('a choice option with a local url', () => {
    expect(shouldOfferWifi({ lan, log: [], asks: [{ options: [{ url: 'http://127.0.0.1:5174/a' }] }] })).toBe(true);
  });
  test('not for a public link, not once dismissed, not once on', () => {
    expect(shouldOfferWifi({ lan, log: [{ by: 'agent', kind: 'showing', link: 'https://example.com/' }], asks: [] })).toBe(false);
    expect(shouldOfferWifi({ lan: { ...lan, offerDismissed: true }, log: [{ by: 'agent', kind: 'showing', link: 'http://localhost:5173/' }], asks: [] })).toBe(false);
    expect(shouldOfferWifi({ lan: { ...lan, wanted: true }, log: [{ by: 'agent', kind: 'showing', link: 'http://localhost:5173/' }], asks: [] })).toBe(false);
  });
});
