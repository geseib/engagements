import WebSocketClient from '../WebSocketClient';

describe('WebSocketClient', () => {
  let wsClient;
  let mockWebSocket;

  beforeEach(() => {
    wsClient = new WebSocketClient();
    
    // Mock WebSocket constructor
    mockWebSocket = {
      close: jest.fn(),
      send: jest.fn(),
      readyState: 1,
      OPEN: 1,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    };
    
    global.WebSocket = jest.fn(() => mockWebSocket);
    global.window.WS_URL = 'ws://localhost:3001';
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('creates WebSocketClient instance', () => {
    expect(wsClient).toBeInstanceOf(WebSocketClient);
    expect(wsClient.ws).toBeNull();
    expect(wsClient.gameId).toBeNull();
    expect(wsClient.playerName).toBeNull();
    expect(wsClient.isHost).toBe(false);
  });

  test('connects to WebSocket with game ID', () => {
    const result = wsClient.connect('GAME123');
    
    expect(result).toBe(true);
    expect(global.WebSocket).toHaveBeenCalledWith(
      expect.stringContaining('gameId=GAME123')
    );
    expect(wsClient.gameId).toBe('GAME123');
  });

  test('connects with player name and host flag', () => {
    wsClient.connect('GAME123', 'Player1', true);
    
    expect(global.WebSocket).toHaveBeenCalledWith(
      expect.stringContaining('gameId=GAME123&playerName=Player1&isHost=true')
    );
    expect(wsClient.playerName).toBe('Player1');
    expect(wsClient.isHost).toBe(true);
  });

  test('fails to connect when WS_URL is not configured', () => {
    global.window.WS_URL = null;
    
    const result = wsClient.connect('GAME123');
    
    expect(result).toBe(false);
    expect(global.WebSocket).not.toHaveBeenCalled();
  });

  test('disconnects WebSocket', () => {
    wsClient.connect('GAME123');
    wsClient.disconnect();
    
    expect(mockWebSocket.close).toHaveBeenCalledWith(1000, 'Manual disconnect');
    expect(wsClient.ws).toBeNull();
  });

  test('checks connection status', () => {
    expect(wsClient.isConnected()).toBe(false);
    
    wsClient.connect('GAME123');
    mockWebSocket.readyState = 1; // OPEN
    
    expect(wsClient.isConnected()).toBe(true);
  });

  test('sends message when connected', () => {
    wsClient.connect('GAME123', 'Player1');
    
    const result = wsClient.sendMessage('test-action', { data: 'test' });
    
    expect(result).toBe(true);
    expect(mockWebSocket.send).toHaveBeenCalledWith(
      expect.stringContaining('"action":"test-action"')
    );
  });

  test('fails to send message when not connected', () => {
    const result = wsClient.sendMessage('test-action');
    
    expect(result).toBe(false);
    expect(mockWebSocket.send).not.toHaveBeenCalled();
  });

  test('handles message registration', () => {
    const handler = jest.fn();
    wsClient.onMessage('test-type', handler);
    
    expect(wsClient.messageHandlers.has('test-type')).toBe(true);
    expect(wsClient.messageHandlers.get('test-type')).toBe(handler);
  });

  test('removes message handler', () => {
    const handler = jest.fn();
    wsClient.onMessage('test-type', handler);
    wsClient.offMessage('test-type');
    
    expect(wsClient.messageHandlers.has('test-type')).toBe(false);
  });
});
