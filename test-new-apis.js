#!/usr/bin/env node

const API_BASE = 'https://h1jcmja0w1.execute-api.us-east-1.amazonaws.com/dev/';

async function testGetGameState() {
  console.log('\n🧪 Testing getGameState API...');
  
  try {
    // Test with a non-existent game
    const response = await fetch(`${API_BASE}games/test123/state`);
    const data = await response.json();
    
    if (response.status === 404) {
      console.log('✅ getGameState correctly returns 404 for non-existent game');
    } else {
      console.log('❓ getGameState response:', response.status, data);
    }
  } catch (error) {
    console.error('❌ getGameState error:', error.message);
  }
}

async function testGetQuestion() {
  console.log('\n🧪 Testing getQuestion API...');
  
  try {
    const response = await fetch(`${API_BASE}games/get-question`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gameId: 'test123',
        role: 'host',
        questionNumber: 1
      })
    });
    
    const data = await response.json();
    
    if (response.status === 404) {
      console.log('✅ getQuestion correctly returns 404 for non-existent game');
    } else {
      console.log('❓ getQuestion response:', response.status, data);
    }
  } catch (error) {
    console.error('❌ getQuestion error:', error.message);
  }
}

async function testAIGeneration() {
  console.log('\n🧪 Testing AI Question Generation...');
  
  try {
    const response = await fetch(`${API_BASE}admin/ai-generate-questions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        engagementType: 'call-and-answer',
        userInput: 'Create questions about leadership and teamwork',
        questionCount: 2,
        context: {
          title: 'Test Question Set',
          description: 'Testing API functionality'
        }
      })
    });
    
    const data = await response.json();
    
    if (response.ok) {
      console.log('✅ AI Generation successful!');
      console.log(`📝 Generated ${data.questions?.length || 0} questions`);
      if (data.questions?.length > 0) {
        console.log('📄 Sample question:', data.questions[0]);
      }
    } else {
      console.log('❌ AI Generation failed:', response.status, data);
    }
  } catch (error) {
    console.error('❌ AI Generation error:', error.message);
  }
}

async function runTests() {
  console.log('🚀 Testing New API Endpoints');
  console.log('API Base:', API_BASE);
  
  await testGetGameState();
  await testGetQuestion();
  await testAIGeneration();
  
  console.log('\n✅ API tests completed!');
}

runTests().catch(console.error);