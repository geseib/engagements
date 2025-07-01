// WebSocket client for real-time game updates
class WebSocketClient {
  constructor() {
    this.ws = null;
    this.gameId = null;
    this.playerName = null;
    this.isHost = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000;
    this.messageHandlers = new Map();
    this.onConnectionChange = null;
  }

  connect(gameId, playerName = null, isHost = false) {
    if (!window.WS_URL) {
      console.error('🔌 WebSocket URL not configured');
      return false;
    }

    this.gameId = gameId;
    this.playerName = playerName;
    this.isHost = isHost;

    const wsUrl = `${window.WS_URL}?gameId=${gameId}${playerName ? `&playerName=${encodeURIComponent(playerName)}` : ''}${isHost ? '&isHost=true' : ''}`;
    
    console.log(`🔌 Connecting to WebSocket: ${wsUrl}`);

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('🔌 WebSocket connected');
        this.reconnectAttempts = 0;
        if (this.onConnectionChange) this.onConnectionChange(true);
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          console.log('🔌 WebSocket message received:', message);
          this.handleMessage(message);
        } catch (error) {
          console.error('🔌 Failed to parse WebSocket message:', error, event.data);
        }
      };

      this.ws.onclose = (event) => {
        console.log('🔌 WebSocket disconnected:', event.code, event.reason);
        if (this.onConnectionChange) this.onConnectionChange(false);
        
        // Attempt to reconnect unless it was a clean close
        if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          console.log(`🔌 Attempting reconnect ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${this.reconnectDelay}ms`);
          setTimeout(() => this.connect(this.gameId, this.playerName, this.isHost), this.reconnectDelay);
          this.reconnectDelay *= 2; // Exponential backoff
        }
      };

      this.ws.onerror = (error) => {
        console.error('🔌 WebSocket error:', error);
      };

      return true;
    } catch (error) {
      console.error('🔌 Failed to create WebSocket connection:', error);
      return false;
    }
  }

  disconnect() {
    if (this.ws) {
      console.log('🔌 Manually disconnecting WebSocket');
      this.ws.close(1000, 'Manual disconnect');
      this.ws = null;
    }
  }

  isConnected() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  sendMessage(action, data = {}) {
    if (!this.isConnected()) {
      console.warn('🔌 Cannot send message: WebSocket not connected');
      return false;
    }

    const message = {
      action,
      gameId: this.gameId,
      playerName: this.playerName,
      timestamp: new Date().toISOString(),
      ...data
    };

    console.log('🔌 Sending WebSocket message:', message);
    this.ws.send(JSON.stringify(message));
    return true;
  }

  handleMessage(message) {
    const { type, data, ...messageData } = message;
    
    if (this.messageHandlers.has(type)) {
      const handler = this.messageHandlers.get(type);
      try {
        // Pass either the data object or the entire message (excluding type)
        const payload = data || messageData;
        handler(payload);
      } catch (error) {
        console.error(`🔌 Error handling message type '${type}':`, error);
      }
    } else {
      console.warn(`🔌 No handler for message type '${type}'`);
    }
  }

  // Register a message handler for a specific message type
  onMessage(type, handler) {
    this.messageHandlers.set(type, handler);
  }

  // Remove a message handler
  offMessage(type) {
    this.messageHandlers.delete(type);
  }

  // Set connection status change callback
  onConnectionStatusChange(callback) {
    this.onConnectionChange = callback;
  }
}

// Create a singleton instance
const webSocketClient = new WebSocketClient();

export default webSocketClient;