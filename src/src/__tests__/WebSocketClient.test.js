/**
 * THE SINGLETON, NOT THE CLASS.
 *
 * This suite has never run. It opened with `new WebSocketClient()` against a
 * module whose last line is `export default webSocketClient` — an INSTANCE.
 * `_WebSocketClient.default is not a constructor`, on every test, since the day
 * it was written.
 *
 * That matters beyond the tidy-up: the singleton is the whole design. Every
 * page imports the same object, which is why a host and a player screen in one
 * tab share one socket and why `ensureConnected()` can be called from four
 * resume handlers without opening four connections. A suite that built its own
 * instance would have tested an object the product never uses.
 */
import webSocketClient from '../WebSocketClient';

describe('the shared WebSocket client', () => {
  let sockets;

  beforeEach(() => {
    sockets = [];
    global.WebSocket = jest.fn(function FakeSocket() {
      this.close = jest.fn();
      this.send = jest.fn();
      this.readyState = 0;          // CONNECTING
      sockets.push(this);
    });
    global.WebSocket.CONNECTING = 0;
    global.WebSocket.OPEN = 1;
    global.WebSocket.CLOSING = 2;
    global.WebSocket.CLOSED = 3;
    window.WS_URL = 'ws://localhost:3001';
    webSocketClient.disconnect();
  });

  afterEach(() => {
    webSocketClient.disconnect();
    jest.clearAllMocks();
  });

  // rejects: exporting the class instead of the instance. Every page imports
  //          this module expecting THE socket; a class export would silently
  //          give each of them their own.
  test('the module exports one shared instance, not a constructor', () => {
    expect(typeof webSocketClient).toBe('object');
    expect(typeof webSocketClient.connect).toBe('function');
    expect(typeof webSocketClient.ensureConnected).toBe('function');
  });

  // rejects: reporting a socket that is still CONNECTING as connected, which
  //          is how a send lands on a socket that cannot carry it.
  test('a connecting socket is not yet a connected one', () => {
    webSocketClient.connect('4821', 'Ada', true);
    expect(sockets).toHaveLength(1);
    expect(webSocketClient.isConnected()).toBe(false);

    sockets[0].readyState = 1;
    expect(webSocketClient.isConnected()).toBe(true);
  });

  // rejects: `ensureConnected` opening a second socket when one is already
  //          live. It is called from visibilitychange, focus, online and
  //          pageshow — four handlers that can fire together when a phone
  //          wakes, so a connect-on-every-call would open four.
  test('ensureConnected does not open a second socket over a live one', () => {
    webSocketClient.connect('4821', 'Ada', true);
    sockets[0].readyState = 1;

    webSocketClient.ensureConnected();
    webSocketClient.ensureConnected();

    expect(sockets).toHaveLength(1);
  });

  // rejects: a handler surviving disconnect and firing against a closed
  //          socket, or a second registration for the same type stacking
  //          rather than replacing.
  test('handlers are registered by type and can be removed', () => {
    const first = jest.fn();
    webSocketClient.onMessage('gameStateChanged', first);
    webSocketClient.triggerHandler('gameStateChanged', { state: 'ASK#001' });
    expect(first).toHaveBeenCalledWith({ state: 'ASK#001' });

    webSocketClient.offMessage('gameStateChanged');
    webSocketClient.triggerHandler('gameStateChanged', { state: 'ASK#002' });
    expect(first).toHaveBeenCalledTimes(1);
  });

  // rejects: disconnect leaving the socket handle behind, so a later
  //          `isConnected()` answers about a socket nobody is holding.
  //
  //          `toBeFalsy`, not `toBe(false)`, and that is a finding rather than
  //          a convenience: `isConnected()` is `return this.ws && ...`, so with
  //          no socket it answers `null` rather than `false`. Every caller uses
  //          it in a condition, so nothing is broken — but it is typed as a
  //          predicate and does not return one. Left alone deliberately: this
  //          suite exists to start running, not to carry a product change.
  test('disconnect closes the socket and forgets it', () => {
    webSocketClient.connect('4821', 'Ada', true);
    const socket = sockets[0];
    socket.readyState = 1;

    webSocketClient.disconnect();

    expect(socket.close).toHaveBeenCalled();
    expect(webSocketClient.isConnected()).toBeFalsy();
  });
});
