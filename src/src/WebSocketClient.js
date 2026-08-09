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
    this.baseReconnectDelay = 1000;
    this.messageHandlers = new Map();
    this.onConnectionChange = null;
    this.onReconnect = null;          // fired on every successful (re)open after the first
    this.hasConnectedOnce = false;
    this.heartbeatTimer = null;
    this.pongTimer = null;
    this.intentionalClose = false;
    this.heartbeatMs = 25000;         // < API GW 10-min idle; catches dead sockets fast
    this.pongWaitMs = 10000;
  }

  connect(gameId, playerName = null, isHost = false) {
    if (!window.WS_URL) {
      console.error('🔌 WebSocket URL not configured');
      return false;
    }

    this.gameId = gameId;
    this.playerName = playerName;
    this.isHost = isHost;

    // Retire whatever we were holding before opening its replacement.
    //
    // This used to assign over the top of a live socket. The abandoned one
    // stayed open, and the server retires connection rows by identity — one
    // host screen, one row per player — so the orphan's handshake could take
    // the row belonging to the socket we actually kept. Every broadcast is a
    // query over those rows, so the page then received nothing while
    // `readyState` still said OPEN and the badge still said Connected.
    //
    // The handlers come off first: this close is ours, and `onclose` is what
    // runs the reconnect ladder.
    this._discardSocket();

    const wsUrl = `${window.WS_URL}?gameId=${gameId}${playerName ? `&playerName=${encodeURIComponent(playerName)}` : ''}${isHost ? '&isHost=true' : ''}`;
    
    console.log(`🔌 Connecting to WebSocket: ${wsUrl}`);

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('🔌 WebSocket connected');
        const wasReconnect = this.hasConnectedOnce;
        this.hasConnectedOnce = true;
        this.reconnectAttempts = 0;
        this.reconnectDelay = this.baseReconnectDelay;   // FIX: reset backoff on success
        this._startHeartbeat();
        if (this.onConnectionChange) this.onConnectionChange(true);
        if (wasReconnect && this.onReconnect) this.onReconnect();  // FIX core gap: re-sync on reopen
      };

      this.ws.onmessage = (event) => {
        this._clearPongTimer();                          // any inbound frame == alive
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'pong') return;           // swallow keepalive
          console.log('🔌 WEBSOCKET DEBUG: Raw WebSocket message received:', message);
          console.log('🔌 WEBSOCKET DEBUG: Message type:', message.type);
          console.log('🔌 WEBSOCKET DEBUG: Game ID in message:', message.gameId);
          console.log('🔌 WEBSOCKET DEBUG: Current client game ID:', this.gameId);
          console.log('🔌 WEBSOCKET DEBUG: Client is host:', this.isHost);
          this.handleMessage(message);
        } catch (error) {
          console.error('🔌 WEBSOCKET DEBUG: Failed to parse WebSocket message:', error);
          console.error('🔌 WEBSOCKET DEBUG: Raw event data:', event.data);
        }
      };

      this.ws.onclose = (event) => {
        console.log('🔌 WebSocket disconnected:', event.code, event.reason);
        this._stopHeartbeat();
        if (this.onConnectionChange) this.onConnectionChange(false);

        if (this.intentionalClose || event.code === 1000) {
          this.intentionalClose = false;
          return;
        }
        this._scheduleReconnect();
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

  /** Detach and close the current socket without triggering our own reconnect. */
  _discardSocket() {
    const socket = this.ws;
    this.ws = null;
    if (!socket) return;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
    try { socket.close(1000, 'superseded'); } catch (_) { /* already gone */ }
  }

  _scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('🔌 max reconnects hit; will retry on network/visibility event');
      return;                                        // don't die forever; ensureConnected() re-arms
    }
    this.reconnectAttempts++;
    console.log(`🔌 Attempting reconnect ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${this.reconnectDelay}ms`);
    setTimeout(() => this.connect(this.gameId, this.playerName, this.isHost), this.reconnectDelay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.isConnected()) return;
      try { this.ws.send(JSON.stringify({ action: 'ping' })); } catch (_) { return; }
      this._clearPongTimer();
      this.pongTimer = setTimeout(() => {            // no frame back == half-open (phone lock)
        console.warn('🔌 heartbeat timeout — forcing reconnect');
        try { this.ws.close(4000, 'heartbeat-timeout'); } catch (_) {}
      }, this.pongWaitMs);
    }, this.heartbeatMs);
  }

  _stopHeartbeat() {
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this._clearPongTimer();
  }

  _clearPongTimer() {
    clearTimeout(this.pongTimer);
    this.pongTimer = null;
  }

  // Called by page visibility/online/focus handlers. Reconnect if dead, else just resync.
  ensureConnected() {
    // CONNECTING counts as present. Waking a laptop fires visibilitychange,
    // online, focus and pageshow within a few milliseconds of each other, which
    // is precisely when a handshake is still open — and starting a rival socket
    // there is how one of them ends up holding a connection the server has
    // already retired.
    if (this.isConnected() || this.isConnecting()) return true;  // caller still runs checkGameState()
    this.reconnectAttempts = 0;                      // FIX: re-arm after permanent give-up
    this.reconnectDelay = this.baseReconnectDelay;
    if (this.gameId) this.connect(this.gameId, this.playerName, this.isHost);
    return false;
  }

  onReconnected(cb) { this.onReconnect = cb; }

  disconnect() {
    if (this.ws) {
      console.log('🔌 Manually disconnecting WebSocket');
      this.intentionalClose = true;
      this._stopHeartbeat();
      this.ws.close(1000, 'Manual disconnect');
      this.ws = null;
    }
  }

  isConnected() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  /** Handshake in flight. Not usable yet, but emphatically not absent. */
  isConnecting() {
    return !!this.ws && this.ws.readyState === WebSocket.CONNECTING;
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

  // Send message using new clean WebSocket format
  sendCleanMessage(messageType, data = {}) {
    if (!this.isConnected()) {
      console.warn('🔌 Cannot send clean message: WebSocket not connected');
      return false;
    }

    const message = {
      messageType,
      gameId: this.gameId,
      playerName: this.playerName,
      timestamp: new Date().toISOString(),
      ...data
    };

    console.log('🔌 Sending clean WebSocket message:', message);
    this.ws.send(JSON.stringify(message));
    return true;
  }

  handleMessage(message) {
    console.log('🔌 WEBSOCKET DEBUG: handleMessage called with:', message);

    // Handle new clean WebSocket system messages
    if (message.type === 'hostMessage') {
      console.log('🔌 WEBSOCKET DEBUG: Handling hostMessage');
      this.handleHostMessage(message);
      return;
    }

    if (message.type === 'playerMessage') {
      console.log('🔌 WEBSOCKET DEBUG: Handling playerMessage');
      this.handlePlayerMessage(message);
      return;
    }

    // Handle legacy message format (for backward compatibility during transition)
    const { type, data, ...messageData } = message;
    console.log('🔌 WEBSOCKET DEBUG: Processing legacy message format, type:', type);
    console.log('🔌 WEBSOCKET DEBUG: Available handlers:', Array.from(this.messageHandlers.keys()));

    if (this.messageHandlers.has(type)) {
      const handler = this.messageHandlers.get(type);
      console.log('🔌 WEBSOCKET DEBUG: Found handler for type:', type);
      try {
        // Pass either the data object or the entire message (excluding type)
        const payload = data || messageData;
        console.log('🔌 WEBSOCKET DEBUG: Calling handler with payload:', payload);
        handler(payload);
        console.log('🔌 WEBSOCKET DEBUG: Handler completed successfully for type:', type);
      } catch (error) {
        console.error(`🔌 WEBSOCKET DEBUG: Error handling message type '${type}':`, error);
      }
    } else {
      console.warn(`🔌 WEBSOCKET DEBUG: No handler for message type '${type}'`);
      console.warn(`🔌 WEBSOCKET DEBUG: Available handlers:`, Array.from(this.messageHandlers.keys()));
    }
  }

  handleHostMessage(message) {
    const { messageType, ...messageData } = message;
    console.log(`🎯 Host message received: ${messageType}`, messageData);

    // Map new clean WebSocket message types to frontend handlers
    if (messageType.startsWith('ASK#')) {
      // ASK#Q1 -> questionStarted
      this.triggerHandler('questionStarted', {
        questionId: messageType.split('#')[1],
        ...messageData
      });
    } else if (messageType.startsWith('VOTE#')) {
      // VOTE#Q1 -> votingStarted
      this.triggerHandler('votingStarted', {
        questionId: messageType.split('#')[1],
        ...messageData
      });
    } else if (messageType.startsWith('RESULT#')) {
      // RESULT#Q1 -> resultsReady
      this.triggerHandler('resultsReady', {
        questionId: messageType.split('#')[1],
        ...messageData
      });
    } else if (messageType === 'END') {
      // END -> gameEnded
      this.triggerHandler('gameEnded', messageData);
    } else {
      console.warn(`🔌 Unknown host message type: ${messageType}`);
    }
  }

  handlePlayerMessage(message) {
    const { messageType, playerName, ...messageData } = message;
    console.log(`👤 Player message received: ${messageType} from ${playerName}`, messageData);

    // Map new clean WebSocket message types to frontend handlers
    if (messageType.startsWith('ANSWERED#')) {
      // ANSWERED#Q1 -> playerAnswered
      this.triggerHandler('playerAnswered', {
        questionId: messageType.split('#')[1],
        playerName,
        ...messageData
      });
    } else if (messageType.startsWith('VOTED#')) {
      // VOTED#Q1 -> playerVoted
      this.triggerHandler('playerVoted', {
        questionId: messageType.split('#')[1],
        playerName,
        ...messageData
      });
    } else if (messageType === 'QUIT') {
      // QUIT -> playerLeft
      this.triggerHandler('playerLeft', {
        playerName,
        ...messageData
      });
    } else {
      console.warn(`🔌 Unknown player message type: ${messageType}`);
    }
  }

  triggerHandler(type, payload) {
    if (this.messageHandlers.has(type)) {
      const handler = this.messageHandlers.get(type);
      try {
        handler(payload);
      } catch (error) {
        console.error(`🔌 Error handling mapped message type '${type}':`, error);
      }
    } else {
      console.warn(`🔌 No handler for mapped message type '${type}'`);
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