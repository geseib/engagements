// Simple test script to debug admin functions
// Run with: node test-admin-functions.js

const API_BASE = 'https://h1jcmja0w1.execute-api.us-east-1.amazonaws.com/dev/';

async function testPopulateDefaults() {
  console.log('🧪 Testing populate-defaults with overwrite...');
  
  try {
    const response = await fetch(`${API_BASE}admin/populate-defaults`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ overwrite: true })
    });
    
    const result = await response.json();
    console.log('📊 Response status:', response.status);
    console.log('📊 Response:', result);
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

async function testListPrompts() {
  console.log('🧪 Testing list prompts...');
  
  try {
    const response = await fetch(`${API_BASE}admin/ai-prompts`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      }
    });
    
    const result = await response.json();
    console.log('📊 Response status:', response.status);
    console.log('📊 Found prompts:', result.prompts?.length || 0);
    
    if (result.prompts && result.prompts.length > 0) {
      console.log('📋 First prompt example:');
      console.log('  - ID:', result.prompts[0].id);
      console.log('  - Name:', result.prompts[0].name);
      console.log('  - Is Default:', result.prompts[0].isDefault);
      
      return result.prompts[0].id; // Return first prompt ID for testing
    }
  } catch (error) {
    console.error('❌ Error:', error);
  }
  
  return null;
}

async function testDeletePrompt(promptId) {
  if (!promptId) {
    console.log('⚠️ No prompt ID provided for delete test');
    return;
  }
  
  console.log(`🧪 Testing delete prompt: ${promptId}`);
  
  // Test 1: Delete without hardDelete (should fail for default prompts)
  try {
    const response1 = await fetch(`${API_BASE}admin/ai-prompts/${promptId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      }
    });
    
    const result1 = await response1.json();
    console.log('📊 Delete (no hardDelete) - Status:', response1.status);
    console.log('📊 Delete (no hardDelete) - Response:', result1);
  } catch (error) {
    console.error('❌ Delete test 1 error:', error);
  }
  
  // Test 2: Delete with hardDelete=true
  try {
    const response2 = await fetch(`${API_BASE}admin/ai-prompts/${promptId}?hardDelete=true`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      }
    });
    
    const result2 = await response2.json();
    console.log('📊 Delete (hardDelete=true) - Status:', response2.status);
    console.log('📊 Delete (hardDelete=true) - Response:', result2);
  } catch (error) {
    console.error('❌ Delete test 2 error:', error);
  }
}

async function runTests() {
  console.log('🚀 Starting admin functions tests...\n');
  
  // Test 1: List prompts
  const promptId = await testListPrompts();
  console.log('\n' + '='.repeat(50) + '\n');
  
  // Test 2: Populate defaults
  await testPopulateDefaults();
  console.log('\n' + '='.repeat(50) + '\n');
  
  // Test 3: Delete prompt
  if (promptId) {
    await testDeletePrompt(promptId);
  }
  
  console.log('\n🏁 Tests completed!');
}

// Run if called directly
if (require.main === module) {
  runTests().catch(console.error);
}

module.exports = { testPopulateDefaults, testListPrompts, testDeletePrompt };