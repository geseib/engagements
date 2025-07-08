const WebSocket = require('ws');

// Test WebSocket state synchronization
async function testWebSocketStateSync() {
  const gameId = '2007';
  const playerName = 'TestPlayer';
  const wsUrl = `wss://024cfn695m.execute-api.us-east-1.amazonaws.com/dev?gameId=${gameId}&playerName=${playerName}`;
  
  console.log(`🔌 Connecting to WebSocket: ${wsUrl}`);
  
  const ws = new WebSocket(wsUrl);
  
  ws.on('open', () => {
    console.log('✅ WebSocket connected');
    
    // Test 1: Request state sync
    console.log('📤 Sending requestStateSync message...');
    ws.send(JSON.stringify({
      action: 'requestStateSync',
      gameId: gameId,
      playerName: playerName
    }));
  });
  
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      console.log('📥 Received message:', message.type);
      
      if (message.type === 'completeStateSync') {
        console.log('🎯 Complete State Sync received!');
        console.log('📊 Game Context:', JSON.stringify(message.data.gameContext, null, 2));
        console.log('🎮 Game State:', JSON.stringify(message.data.gameState, null, 2));
        console.log('👥 Players:', JSON.stringify(message.data.players, null, 2));
        console.log('📈 Question Progress:', JSON.stringify(message.data.questionProgress, null, 2));
        console.log('🧑 Player State:', JSON.stringify(message.data.playerState, null, 2));
        
        // Test 2: Send ping
        console.log('📤 Sending ping...');
        ws.send(JSON.stringify({
          action: 'ping'
        }));
      } else if (message.type === 'pong') {
        console.log('🏓 Pong received!');
        
        // Test 3: Test broadcast
        console.log('📤 Testing broadcast...');
        ws.send(JSON.stringify({
          action: 'broadcast',
          gameId: gameId,
          message: {
            type: 'testMessage',
            content: 'Hello from test client!',
            timestamp: new Date().toISOString()
          }
        }));
      } else if (message.type === 'testMessage') {
        console.log('📢 Broadcast message received:', message.content);
        
        // Close connection after successful tests
        setTimeout(() => {
          console.log('✅ All tests completed successfully!');
          ws.close();
        }, 1000);
      } else {
        console.log('📨 Other message:', JSON.stringify(message, null, 2));
      }
    } catch (error) {
      console.error('❌ Error parsing message:', error);
      console.log('Raw message:', data.toString());
    }
  });
  
  ws.on('error', (error) => {
    console.error('❌ WebSocket error:', error);
  });
  
  ws.on('close', (code, reason) => {
    console.log(`🔌 WebSocket closed: ${code} ${reason}`);
  });
  
  // Keep connection alive for testing
  setTimeout(() => {
    if (ws.readyState === WebSocket.OPEN) {
      console.log('⏰ Test timeout - closing connection');
      ws.close();
    }
  }, 30000);
}

// Run the test
testWebSocketStateSync().catch(console.error);
