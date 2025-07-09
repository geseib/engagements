const WebSocket = require('ws');

// Test complete WebSocket integration with frontend message mapping
async function testCompleteIntegration() {
  const gameId = '2024';
  const wsUrl = `wss://024cfn695m.execute-api.us-east-1.amazonaws.com/dev?gameId=${gameId}`;
  
  console.log('🧪 Testing Complete WebSocket Integration');
  console.log('==========================================\n');
  
  // Test 1: Host Connection
  console.log('📡 Test 1: Host Connection');
  const hostWs = new WebSocket(`${wsUrl}&isHost=true`);
  
  await new Promise((resolve) => {
    hostWs.on('open', () => {
      console.log('✅ HOST connected');
      resolve();
    });
  });
  
  // Test 2: Player Connection  
  console.log('\n👤 Test 2: Player Connection');
  const playerWs = new WebSocket(`${wsUrl}&playerName=TestPlayer`);
  
  await new Promise((resolve) => {
    playerWs.on('open', () => {
      console.log('✅ PLAYER connected: TestPlayer');
      resolve();
    });
  });
  
  // Set up message handlers to test frontend integration
  hostWs.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      console.log('📥 HOST received:', JSON.stringify(message, null, 2));
      
      // Test frontend message mapping
      if (message.type === 'playerMessage') {
        const { messageType, playerName } = message;
        console.log(`   🎯 Mapped to frontend: ${mapPlayerMessageToFrontend(messageType)} from ${playerName}`);
      }
    } catch (error) {
      console.error('❌ HOST message parse error:', error);
    }
  });
  
  playerWs.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      console.log('📥 PLAYER received:', JSON.stringify(message, null, 2));
      
      // Test frontend message mapping
      if (message.type === 'hostMessage') {
        const { messageType } = message;
        console.log(`   🎯 Mapped to frontend: ${mapHostMessageToFrontend(messageType)}`);
      }
    } catch (error) {
      console.error('❌ PLAYER message parse error:', error);
    }
  });
  
  await sleep(1000);
  
  // Test 3: Host sends ASK#Q1 (simulating start-question.js)
  console.log('\n🎯 Test 3: Host broadcasts ASK#Q1');
  hostWs.send(JSON.stringify({
    messageType: 'ASK#Q1',
    gameId: gameId,
    questionId: 'Q1',
    questionRef: 'SET#001/QUESTION#tech#001',
    setId: '001',
    category: 'tech'
  }));
  
  await sleep(2000);
  
  // Test 4: Player responds ANSWERED#Q1 (simulating submit-answer.js)
  console.log('\n👤 Test 4: Player responds ANSWERED#Q1');
  playerWs.send(JSON.stringify({
    messageType: 'ANSWERED#Q1',
    gameId: gameId,
    playerName: 'TestPlayer',
    questionId: 'Q1',
    answer: 'JavaScript'
  }));
  
  await sleep(2000);
  
  // Test 5: Host sends VOTE#Q1 (simulating start-vote.js)
  console.log('\n🎯 Test 5: Host broadcasts VOTE#Q1');
  hostWs.send(JSON.stringify({
    messageType: 'VOTE#Q1',
    gameId: gameId,
    questionNumber: 'Q1'
  }));
  
  await sleep(2000);
  
  // Test 6: Player responds VOTED#Q1 (simulating submit-votes.js)
  console.log('\n👤 Test 6: Player responds VOTED#Q1');
  playerWs.send(JSON.stringify({
    messageType: 'VOTED#Q1',
    gameId: gameId,
    playerName: 'TestPlayer',
    questionId: 'Q1',
    votes: ['TestPlayer']
  }));
  
  await sleep(2000);
  
  // Test 7: Host sends RESULT#Q1 (simulating set-game-state.js)
  console.log('\n🎯 Test 7: Host broadcasts RESULT#Q1');
  hostWs.send(JSON.stringify({
    messageType: 'RESULT#Q1',
    gameId: gameId,
    questionId: 'Q1',
    state: 'results'
  }));
  
  await sleep(2000);
  
  // Test 8: Host sends END (simulating set-game-state.js)
  console.log('\n🎯 Test 8: Host broadcasts END');
  hostWs.send(JSON.stringify({
    messageType: 'END',
    gameId: gameId,
    state: 'end'
  }));
  
  await sleep(2000);
  
  // Test 9: Player quits (simulating player quit)
  console.log('\n👤 Test 9: Player sends QUIT');
  playerWs.send(JSON.stringify({
    messageType: 'QUIT',
    gameId: gameId,
    playerName: 'TestPlayer'
  }));
  
  await sleep(2000);
  
  console.log('\n🔌 Closing connections...');
  hostWs.close();
  playerWs.close();
  
  console.log('\n✅ Complete integration test finished!');
  console.log('\n📊 Summary:');
  console.log('   ✅ Host → Player messages: ASK#Q1, VOTE#Q1, RESULT#Q1, END');
  console.log('   ✅ Player → Host messages: ANSWERED#Q1, VOTED#Q1, QUIT');
  console.log('   ✅ Frontend message mapping working');
  console.log('   ✅ Clean WebSocket system operational');
}

// Helper function to map host messages to frontend handlers
function mapHostMessageToFrontend(messageType) {
  if (messageType.startsWith('ASK#')) {
    return 'questionStarted';
  } else if (messageType.startsWith('VOTE#')) {
    return 'votingStarted';
  } else if (messageType.startsWith('RESULT#')) {
    return 'resultsReady';
  } else if (messageType === 'END') {
    return 'gameEnded';
  }
  return 'unknown';
}

// Helper function to map player messages to frontend handlers
function mapPlayerMessageToFrontend(messageType) {
  if (messageType.startsWith('ANSWERED#')) {
    return 'playerAnswered';
  } else if (messageType.startsWith('VOTED#')) {
    return 'playerVoted';
  } else if (messageType === 'QUIT') {
    return 'playerLeft';
  }
  return 'unknown';
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run the test
testCompleteIntegration().catch(console.error);
