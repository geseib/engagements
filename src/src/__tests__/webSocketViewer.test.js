/**
 * A PRESENTATION CONNECTS AS A VIEWER (two-surface PLAN 2.1, D4).
 *
 * The server stores `viewer=present&viewerId=<tab>` as a PLAYER row keyed by
 * its own tab id, so two walls never retire each other. The client must send
 * exactly that, never a name or a host request alongside it, and must keep the
 * same id when it reconnects (a new id would leave the old row to its ttl).
 */
import webSocketClient from '../WebSocketClient';

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 3;
let sockets;

class FakeSocket {
  constructor(url) { this.url = url; this.readyState = CONNECTING; sockets.push(this); }
  send() {}
  close(code) { this.readyState = CLOSED; if (this.onclose) this.onclose({ code: code ?? 1000 }); }
  finishHandshake() { this.readyState = OPEN; if (this.onopen) this.onopen(); }
  drop() { this.readyState = CLOSED; if (this.onclose) this.onclose({ code: 1006, reason: '' }); }
}

const params = (url) => new URL(url.replace(/^wss?:/, 'https:')).searchParams;
const VIEWER = 'tab-0f8e6d2c-1111';

beforeEach(() => {
  sockets = [];
  global.WebSocket = FakeSocket;
  global.WebSocket.OPEN = OPEN;
  global.WebSocket.CONNECTING = CONNECTING;
  window.WS_URL = 'wss://ws.test.invalid/dev';
  webSocketClient.disconnect();
  webSocketClient.ws = null;
  webSocketClient.hasConnectedOnce = false;
  webSocketClient.reconnectAttempts = 0;
  webSocketClient.reconnectDelay = webSocketClient.baseReconnectDelay;
});
afterEach(() => {
  webSocketClient.disconnect();
  webSocketClient._stopHeartbeat();
  jest.useRealTimers();
});

test('a viewer sends viewer=present and its tab id, with no name and no host request', () => {
  webSocketClient.connect('5479', 'Ada', true, { viewerId: VIEWER });
  expect(sockets).toHaveLength(1);
  const p = params(sockets[0].url);
  expect(p.get('gameId')).toBe('5479');
  expect(p.get('viewer')).toBe('present');
  expect(p.get('viewerId')).toBe(VIEWER);
  expect(p.get('playerName')).toBeNull();
  expect(p.get('isHost')).toBeNull();
});

test('a reconnect keeps the same viewer id', () => {
  jest.useFakeTimers();
  webSocketClient.connect('5479', null, false, { viewerId: VIEWER });
  sockets[0].finishHandshake();
  sockets[0].drop();
  jest.advanceTimersByTime(60000);
  expect(sockets.length).toBeGreaterThan(1);
  expect(params(sockets[sockets.length - 1].url).get('viewerId')).toBe(VIEWER);
});

test('an ordinary connect after a viewer one is not a viewer', () => {
  webSocketClient.connect('5479', null, false, { viewerId: VIEWER });
  webSocketClient.connect('5479', 'Ada');
  const p = params(sockets[sockets.length - 1].url);
  expect(p.get('viewer')).toBeNull();
  expect(p.get('playerName')).toBe('Ada');
});
