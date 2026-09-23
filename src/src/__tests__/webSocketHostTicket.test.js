/**
 * THE HOST SCREEN'S SOCKET CARRIES A TICKET, EVERY TIME IT OPENS.
 *
 * `?isHost=true` is only a request since the host-ticket change: the server
 * stores a connection as HOST — and so sends it the host-only frames (names as
 * they join, vote and survey progress) — only when the URL also carries a live
 * single-use ticket from POST /games/{gameId}/host-ticket
 * (lambda-functions/websocket/connect.js, tests/websocket-host-ticket.js).
 *
 * So the client has to fetch one before EVERY open, reconnects included: a
 * ticket is spent by the handshake it rode in on, and a reconnect that reused
 * the old URL would land as PLAYER and leave the host screen deaf while its
 * badge said Connected — the failure webSocketConnectHygiene.test.js exists
 * for, arriving by a new door.
 *
 * rejects: opening a host socket without waiting for the ticket; reusing a
 *          spent ticket on reconnect; a stale ticket fetch opening a socket
 *          after a newer connect or a disconnect; a rival socket opened while
 *          the ticket is in flight; a failed fetch opening a ticketless (deaf)
 *          host socket; a player connect asking for a ticket; the ticket in
 *          the console.
 */
import webSocketClient from '../WebSocketClient';
import { requestHostTicket } from '../utils/hostTicketClient';

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 3;

let sockets;

class FakeSocket {
  constructor(url) {
    this.url = url;
    this.readyState = CONNECTING;
    sockets.push(this);
  }

  send() {}

  close(code, reason) {
    this.readyState = CLOSED;
    if (this.onclose) this.onclose({ code: code ?? 1000, reason });
  }

  finishHandshake() {
    this.readyState = OPEN;
    if (this.onopen) this.onopen();
  }

  /** The server refused or dropped the connection. */
  drop() {
    this.readyState = CLOSED;
    if (this.onclose) this.onclose({ code: 1006, reason: '' });
  }
}

const T1 = '1'.repeat(64);
const T2 = '2'.repeat(64);

/** A provider whose answers the test releases by hand. */
function deferredTickets() {
  const pending = [];
  const provider = jest.fn(() => new Promise((resolve) => pending.push(resolve)));
  return { provider, release: (i, value) => pending[i](value), pending };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
/** Drain the microtask queue without a timer, for the fake-timer tests. */
const settle = async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); };
const ticketOf = (url) => new URL(url.replace(/^wss?:/, 'https:')).searchParams.get('hostTicket');

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
  webSocketClient.onConnectionChange = null;
  webSocketClient.onReconnect = null;
});

afterEach(() => {
  webSocketClient.disconnect();
  webSocketClient._stopHeartbeat();
  jest.useRealTimers();
});

describe('a host connect waits for its ticket', () => {
  test('no socket opens until the ticket arrives, then it rides on the URL', async () => {
    const { provider, release } = deferredTickets();
    webSocketClient.connect('4821', null, true, { hostTicket: provider });

    expect(provider).toHaveBeenCalledWith('4821');
    expect(sockets).toHaveLength(0);

    release(0, T1);
    await flush();

    expect(sockets).toHaveLength(1);
    expect(sockets[0].url).toContain('isHost=true');
    expect(ticketOf(sockets[0].url)).toBe(T1);
  });

  test('a fetch in flight counts as connecting, so a resume does not start a rival', async () => {
    const { provider, release } = deferredTickets();
    webSocketClient.connect('4821', null, true, { hostTicket: provider });

    expect(webSocketClient.isConnecting()).toBe(true);
    webSocketClient.ensureConnected();
    webSocketClient.ensureConnected();
    expect(provider).toHaveBeenCalledTimes(1);

    release(0, T1);
    await flush();
    expect(sockets).toHaveLength(1);
  });

  test('a newer connect supersedes a ticket still in flight', async () => {
    const { provider, release } = deferredTickets();
    webSocketClient.connect('4821', null, true, { hostTicket: provider });
    webSocketClient.connect('4821', null, true, { hostTicket: provider });

    release(1, T2);
    release(0, T1);          // the older answer lands last
    await flush();

    expect(sockets).toHaveLength(1);
    expect(ticketOf(sockets[0].url)).toBe(T2);
  });

  test('disconnecting while the ticket is in flight opens nothing afterwards', async () => {
    const { provider, release } = deferredTickets();
    webSocketClient.connect('4821', null, true, { hostTicket: provider });
    webSocketClient.disconnect();

    release(0, T1);
    await flush();

    expect(sockets).toHaveLength(0);
    expect(webSocketClient.isConnecting()).toBe(false);
  });
});

describe('every open gets a fresh ticket', () => {
  test('a reconnect after a drop fetches a new ticket rather than reusing the spent one', async () => {
    jest.useFakeTimers();
    const provider = jest.fn()
      .mockResolvedValueOnce(T1)
      .mockResolvedValueOnce(T2);
    webSocketClient.connect('4821', null, true, { hostTicket: provider });
    await settle();
    sockets[0].finishHandshake();

    sockets[0].drop();
    jest.advanceTimersByTime(1000);
    await settle();

    expect(provider).toHaveBeenCalledTimes(2);
    expect(sockets).toHaveLength(2);
    expect(ticketOf(sockets[1].url)).toBe(T2);
  });

  test('ensureConnected() on a dead host socket fetches a new ticket too', async () => {
    const provider = jest.fn()
      .mockResolvedValueOnce(T1)
      .mockResolvedValueOnce(T2);
    webSocketClient.connect('4821', null, true, { hostTicket: provider });
    await flush();
    sockets[0].finishHandshake();
    sockets[0].readyState = CLOSED;

    webSocketClient.ensureConnected();
    await flush();

    expect(sockets).toHaveLength(2);
    expect(ticketOf(sockets[1].url)).toBe(T2);
  });
});

describe('when no ticket can be had', () => {
  test('no ticketless host socket is opened, and the ladder tries again', async () => {
    jest.useFakeTimers();
    const provider = jest.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(T2);
    webSocketClient.connect('4821', null, true, { hostTicket: provider });
    await settle();

    // A socket without a ticket would be stored PLAYER: open, badge green,
    // and deaf to every host-only frame. Better no socket and an honest badge.
    expect(sockets).toHaveLength(0);
    expect(webSocketClient.isConnecting()).toBe(false);

    jest.advanceTimersByTime(1000);
    await settle();

    expect(provider).toHaveBeenCalledTimes(2);
    expect(sockets).toHaveLength(1);
    expect(ticketOf(sockets[0].url)).toBe(T2);
  });

  test('a provider that throws is treated the same way', async () => {
    const provider = jest.fn(() => Promise.reject(new Error('offline')));
    webSocketClient.connect('4821', null, true, { hostTicket: provider });
    await flush();
    expect(sockets).toHaveLength(0);
  });
});

describe('everything else is untouched', () => {
  test('a player connect never asks for a ticket and opens at once', () => {
    const provider = jest.fn();
    webSocketClient.connect('4821', 'Ada', false, { hostTicket: provider });
    expect(provider).not.toHaveBeenCalled();
    expect(sockets).toHaveLength(1);
    expect(sockets[0].url).not.toContain('hostTicket');
  });

  test('the ticket is not printed to the console', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      webSocketClient.connect('4821', null, true, { hostTicket: () => Promise.resolve(T1) });
      await flush();
      const printed = log.mock.calls.map((args) => args.join(' ')).join('\n');
      expect(printed).not.toContain(T1);
    } finally {
      log.mockRestore();
    }
  });
});

describe('requestHostTicket', () => {
  const ok = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });

  test('POSTs to the game\'s host-ticket route with the fetch it is handed', async () => {
    const fetchFn = jest.fn(() => ok({ ticket: T1, expiresInSeconds: 60 }));
    const result = await requestHostTicket({ fetchFn, apiBase: 'https://api.test/dev/', gameId: '4821' });

    expect(fetchFn).toHaveBeenCalledWith('https://api.test/dev/games/4821/host-ticket', expect.objectContaining({ method: 'POST' }));
    expect(result).toEqual({ ok: true, status: 200, ticket: T1, error: null });
  });

  test('a refusal resolves without a ticket rather than throwing', async () => {
    const fetchFn = jest.fn(() => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: 'Game not found' }) }));
    const result = await requestHostTicket({ fetchFn, apiBase: '/', gameId: '4821' });
    expect(result).toEqual({ ok: false, status: 404, ticket: null, error: 'Game not found' });
  });

  test('a network failure resolves without a ticket', async () => {
    const fetchFn = jest.fn(() => Promise.reject(new Error('offline')));
    const result = await requestHostTicket({ fetchFn, apiBase: '/', gameId: '4821' });
    expect(result.ok).toBe(false);
    expect(result.ticket).toBeNull();
  });

  test('a 200 without a usable ticket is not a ticket', async () => {
    const fetchFn = jest.fn(() => ok({ ticket: '' }));
    const result = await requestHostTicket({ fetchFn, apiBase: '/', gameId: '4821' });
    expect(result.ok).toBe(false);
    expect(result.ticket).toBeNull();
  });
});
