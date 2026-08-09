/**
 * One client, one socket.
 *
 * The server retires older connection rows for an identity (connect.js), which
 * is correct — one host screen, one row per player. The consequence is that a
 * socket this client abandons but never closes will still run its own $connect,
 * and until connect.js was ordered properly that stale handshake could delete
 * the row belonging to the socket the client is actually holding. The browser
 * then sits with `readyState === OPEN`, paints "WebSocket Connected", and
 * receives nothing for the rest of the session.
 *
 * Two ways this client used to produce that second socket, both fixed here:
 *
 *   1. `connect()` assigned `this.ws` over the top of a live socket without
 *      closing it;
 *   2. `ensureConnected()` — wired to visibilitychange / online / focus /
 *      pageshow on both the host and player pages — treated a socket that was
 *      still CONNECTING as absent and opened another one. Waking a laptop is
 *      exactly when the handshake is in flight.
 *
 * NOTE: the default export is the SINGLETON instance, not the class. The old
 * WebSocketClient.test.js calls `new WebSocketClient()` on it and has failed
 * ever since; this file drives the singleton it actually exports.
 */
import webSocketClient from '../WebSocketClient';

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 3;

let sockets;

class FakeSocket {
  constructor(url) {
    this.url = url;
    this.readyState = CONNECTING;
    this.sent = [];
    this.closeCalls = [];
    sockets.push(this);
  }

  send(data) { this.sent.push(data); }

  close(code, reason) {
    this.closeCalls.push({ code, reason });
    this.readyState = CLOSED;
    if (this.onclose) this.onclose({ code: code ?? 1000, reason });
  }

  /** Complete the handshake, the way the browser would. */
  finishHandshake() {
    this.readyState = OPEN;
    if (this.onopen) this.onopen();
  }
}

beforeEach(() => {
  sockets = [];
  global.WebSocket = FakeSocket;
  global.WebSocket.OPEN = OPEN;
  global.WebSocket.CONNECTING = CONNECTING;
  window.WS_URL = 'wss://ws.test.invalid/dev';

  // The singleton carries state across tests by design; reset the parts these
  // assertions read so one test cannot pass on another's leftovers.
  webSocketClient.ws = null;
  webSocketClient.gameId = null;
  webSocketClient.playerName = null;
  webSocketClient.isHost = false;
  webSocketClient.hasConnectedOnce = false;
  webSocketClient.reconnectAttempts = 0;
  webSocketClient.onConnectionChange = null;
  webSocketClient.onReconnect = null;
  webSocketClient._stopHeartbeat();
});

afterEach(() => {
  webSocketClient._stopHeartbeat();
});

describe('WebSocketClient never leaves a second socket open', () => {
  test('connect() closes the socket it is replacing', () => {
    webSocketClient.connect('4821', null, true);
    const first = sockets[0];
    first.finishHandshake();

    webSocketClient.connect('4821', null, true);

    expect(sockets).toHaveLength(2);
    expect(first.closeCalls).toHaveLength(1);
    expect(first.readyState).toBe(CLOSED);
    expect(webSocketClient.ws).toBe(sockets[1]);
  });

  test('replacing a socket does not schedule a reconnect for the one it closed', () => {
    jest.useFakeTimers();
    try {
      webSocketClient.connect('4821', null, true);
      sockets[0].finishHandshake();

      webSocketClient.connect('4821', null, true);
      jest.advanceTimersByTime(60_000);

      // Two: the original and its replacement. A third would mean the closed
      // socket's onclose ran the reconnect ladder and opened yet another.
      expect(sockets).toHaveLength(2);
    } finally {
      jest.useRealTimers();
    }
  });

  test('ensureConnected() does not open a rival while the handshake is in flight', () => {
    webSocketClient.connect('4821', null, true);
    expect(sockets).toHaveLength(1);
    expect(sockets[0].readyState).toBe(CONNECTING);

    webSocketClient.ensureConnected();

    expect(sockets).toHaveLength(1);
  });

  test('ensureConnected() still revives a socket that has closed', () => {
    webSocketClient.connect('4821', null, true);
    sockets[0].finishHandshake();
    sockets[0].readyState = CLOSED;

    webSocketClient.ensureConnected();

    expect(sockets).toHaveLength(2);
    expect(webSocketClient.ws).toBe(sockets[1]);
  });

  test('ensureConnected() is a no-op on a live socket', () => {
    webSocketClient.connect('4821', null, true);
    sockets[0].finishHandshake();

    expect(webSocketClient.ensureConnected()).toBe(true);
    expect(sockets).toHaveLength(1);
  });
});
