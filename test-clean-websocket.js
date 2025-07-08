const WebSocket = require('ws');

const WEBSOCKET_URL = 'wss://024cfn695m.execute-api.us-east-1.amazonaws.com/dev';
const TEST_GAME_ID = '2007';

/**
 * Test the clean WebSocket system with proper message patterns
 */
async function testCleanWebSocket() {
  console.log('🧪 Testing Clean WebSocket System');
  console.log('=====================================');
  
  // Test 1: Host Connection
  console.log('\n📡 Test 1: Host Connection');
  const hostWs = await createConnection(TEST_GAME_ID, null, true);
  
  // Test 2: Player Connection
  console.log('\n👤 Test 2: Player Connection');
  const playerWs = await createConnection(TEST_GAME_ID, 'TestPlayer', false);
  
  // Wait for connections to establish
  await sleep(1000);
  
  // Test 3: Host broadcasts ASK#Q1 to all players
  console.log('\n🎯 Test 3: Host broadcasts ASK#Q1');
  hostWs.send(JSON.stringify({
    messageType: 'ASK#Q1',
    gameId: TEST_GAME_ID,
    questionId: 'Q1',
    questionText: 'What is 2+2?',
    options: ['3', '4', '5', '6']
  }));
  
  // Wait for message processing
  await sleep(2000);
  
  // Test 4: Player responds with ANSWERED#Q1
  console.log('\n👤 Test 4: Player responds ANSWERED#Q1');
  playerWs.send(JSON.stringify({
    messageType: 'ANSWERED#Q1',
    gameId: TEST_GAME_ID,
    playerName: 'TestPlayer',
    questionId: 'Q1',
    answer: '4'
  }));
  
  // Wait for message processing
  await sleep(2000);
  
  // Test 5: Host broadcasts VOTE#Q1
  console.log('\n🎯 Test 5: Host broadcasts VOTE#Q1');
  hostWs.send(JSON.stringify({
    messageType: 'VOTE#Q1',
    gameId: TEST_GAME_ID,
    questionId: 'Q1',
    answers: [
      { playerName: 'TestPlayer', answer: '4' }
    ]
  }));
  
  // Wait for message processing
  await sleep(2000);
  
  // Test 6: Player responds with VOTED#Q1
  console.log('\n👤 Test 6: Player responds VOTED#Q1');
  playerWs.send(JSON.stringify({
    messageType: 'VOTED#Q1',
    gameId: TEST_GAME_ID,
    playerName: 'TestPlayer',
    questionId: 'Q1',
    vote: 'TestPlayer'
  }));
  
  // Wait for message processing
  await sleep(2000);
  
  // Test 7: Host broadcasts RESULT#Q1
  console.log('\n🎯 Test 7: Host broadcasts RESULT#Q1');
  hostWs.send(JSON.stringify({
    messageType: 'RESULT#Q1',
    gameId: TEST_GAME_ID,
    questionId: 'Q1',
    results: {
      'TestPlayer': { votes: 1, score: 100 }
    }
  }));
  
  // Wait for message processing
  await sleep(2000);
  
  // Test 8: Host broadcasts END
  console.log('\n🎯 Test 8: Host broadcasts END');
  hostWs.send(JSON.stringify({
    messageType: 'END',
    gameId: TEST_GAME_ID,
    finalScores: {
      'TestPlayer': 100
    }
  }));
  
  // Wait for final processing
  await sleep(2000);
  
  // Close connections
  console.log('\n🔌 Closing connections...');
  hostWs.close();
  playerWs.close();
  
  console.log('\n✅ Clean WebSocket test complete!');
}

/**
 * Create WebSocket connection with proper parameters
 */
function createConnection(gameId, playerName, isHost) {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      gameId,
      ...(playerName && { playerName }),
      isHost: isHost.toString()
    });
    
    const ws = new WebSocket(`${WEBSOCKET_URL}?${params}`);
    
    ws.on('open', () => {
      const role = isHost ? 'HOST' : 'PLAYER';
      const name = playerName || 'HOST';
      console.log(`✅ ${role} connected: ${name}`);
      resolve(ws);
    });
    
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        const role = isHost ? 'HOST' : 'PLAYER';
        const name = playerName || 'HOST';
        
        console.log(`📥 ${role} (${name}) received:`, {
          type: message.type,
          messageType: message.messageType,
          from: message.playerName || 'HOST',
          timestamp: message.timestamp
        });
        
        if (message.type === 'hostMessage') {
          console.log(`   🎯 Host message: ${message.messageType}`);
        } else if (message.type === 'playerMessage') {
          console.log(`   👤 Player message: ${message.messageType} from ${message.playerName}`);
        }
        
      } catch (error) {
        console.log(`📥 ${role} raw message:`, data.toString());
      }
    });
    
    ws.on('error', (error) => {
      console.error(`❌ WebSocket error:`, error);
      reject(error);
    });
    
    ws.on('close', () => {
      const role = isHost ? 'HOST' : 'PLAYER';
      const name = playerName || 'HOST';
      console.log(`🔌 ${role} disconnected: ${name}`);
    });
  });
}

/**
 * Sleep utility
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run the test
if (require.main === module) {
  testCleanWebSocket().catch(console.error);
}

module.exports = { testCleanWebSocket };
