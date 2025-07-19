const https = require('https');

// Configuration for dev environment
const API_BASE = 'https://h1jcmja0w1.execute-api.us-east-1.amazonaws.com/dev';

// Helper function to make HTTP requests
const makeRequest = (method, path, data = null) => {
  return new Promise((resolve, reject) => {
    const url = new URL(API_BASE + path);
    
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (data) {
      const jsonData = JSON.stringify(data);
      options.headers['Content-Length'] = Buffer.byteLength(jsonData);
    }

    const req = https.request(options, (res) => {
      let responseData = '';
      
      res.on('data', (chunk) => {
        responseData += chunk;
      });
      
      res.on('end', () => {
        try {
          const parsed = JSON.parse(responseData);
          resolve({
            statusCode: res.statusCode,
            data: parsed
          });
        } catch (e) {
          resolve({
            statusCode: res.statusCode,
            data: responseData
          });
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    if (data) {
      req.write(JSON.stringify(data));
    }
    
    req.end();
  });
};

// Test functions
async function testGetPrompts() {
  console.log('\n🔍 Testing GET /admin/ai-prompts...');
  
  try {
    const response = await makeRequest('GET', '/admin/ai-prompts?gameType=callandanswer');
    console.log(`Status: ${response.statusCode}`);
    
    if (response.statusCode === 200) {
      console.log(`✅ Found ${response.data.totalCount} prompts`);
      if (response.data.prompts.length > 0) {
        console.log(`   First prompt: ${response.data.prompts[0].name}`);
      }
    } else {
      console.log(`❌ Error: ${JSON.stringify(response.data)}`);
    }
  } catch (error) {
    console.log(`❌ Request failed: ${error.message}`);
  }
}

async function testCreatePrompt() {
  console.log('\n➕ Testing POST /admin/ai-prompts...');
  
  const testPrompt = {
    name: 'Test Prompt - API Validation',
    description: 'A test prompt created by the API validation script',
    gameType: 'callandanswer',
    category: 'test',
    scenario: 'Testing',
    template: 'This is a test prompt template for {question} with {playerResponses}. Please provide test insights.',
    isDefault: false,
    status: 'draft',
    tags: ['test', 'validation']
  };
  
  try {
    const response = await makeRequest('POST', '/admin/ai-prompts', testPrompt);
    console.log(`Status: ${response.statusCode}`);
    
    if (response.statusCode === 201) {
      console.log(`✅ Created prompt with ID: ${response.data.promptId}`);
      return response.data.promptId;
    } else {
      console.log(`❌ Error: ${JSON.stringify(response.data)}`);
      return null;
    }
  } catch (error) {
    console.log(`❌ Request failed: ${error.message}`);
    return null;
  }
}

async function testUpdatePrompt(promptId) {
  if (!promptId) {
    console.log('\n⏭️ Skipping update test (no promptId)');
    return;
  }
  
  console.log(`\n✏️ Testing PUT /admin/ai-prompts/${promptId}...`);
  
  const updateData = {
    name: 'Updated Test Prompt - API Validation',
    description: 'Updated description for API validation',
    status: 'active'
  };
  
  try {
    const response = await makeRequest('PUT', `/admin/ai-prompts/${promptId}`, updateData);
    console.log(`Status: ${response.statusCode}`);
    
    if (response.statusCode === 200) {
      console.log(`✅ Updated prompt: ${response.data.message}`);
    } else {
      console.log(`❌ Error: ${JSON.stringify(response.data)}`);
    }
  } catch (error) {
    console.log(`❌ Request failed: ${error.message}`);
  }
}

async function testAIAdvisor() {
  console.log('\n🪄 Testing POST /admin/ai-prompt-advisor...');
  
  const testPrompt = {
    promptText: 'Analyze the responses and provide insights.',
    gameType: 'callandanswer',
    scenario: 'test-scenario',
    analysisType: 'improve'
  };
  
  try {
    const response = await makeRequest('POST', '/admin/ai-prompt-advisor', testPrompt);
    console.log(`Status: ${response.statusCode}`);
    
    if (response.statusCode === 200) {
      console.log(`✅ AI analysis completed`);
      if (response.data.analysis) {
        console.log(`   Analysis type: ${response.data.analysisType}`);
        console.log(`   Model used: ${response.data.metadata?.modelUsed || 'claude-3.5-sonnet'}`);
      }
    } else {
      console.log(`❌ Error: ${JSON.stringify(response.data)}`);
    }
  } catch (error) {
    console.log(`❌ Request failed: ${error.message}`);
  }
}

async function testDeletePrompt(promptId) {
  if (!promptId) {
    console.log('\n⏭️ Skipping delete test (no promptId)');
    return;
  }
  
  console.log(`\n🗑️ Testing DELETE /admin/ai-prompts/${promptId} (soft delete)...`);
  
  try {
    const response = await makeRequest('DELETE', `/admin/ai-prompts/${promptId}`);
    console.log(`Status: ${response.statusCode}`);
    
    if (response.statusCode === 200) {
      console.log(`✅ Deleted prompt: ${response.data.message}`);
    } else {
      console.log(`❌ Error: ${JSON.stringify(response.data)}`);
    }
  } catch (error) {
    console.log(`❌ Request failed: ${error.message}`);
  }
}

// Main test runner
async function runAllTests() {
  console.log('🧪 AI Prompt API Testing Suite');
  console.log('================================');
  console.log(`🌐 Testing against: ${API_BASE}`);
  
  // Test the CRUD operations in sequence
  await testGetPrompts();
  
  const promptId = await testCreatePrompt();
  
  await testUpdatePrompt(promptId);
  
  await testAIAdvisor();
  
  await testDeletePrompt(promptId);
  
  console.log('\n🏁 Testing completed!');
  console.log('\n📋 Summary:');
  console.log('- GET /admin/ai-prompts - List prompts with filtering');
  console.log('- POST /admin/ai-prompts - Create new prompts');
  console.log('- PUT /admin/ai-prompts/{id} - Update existing prompts');
  console.log('- DELETE /admin/ai-prompts/{id} - Archive prompts');
  console.log('- POST /admin/ai-prompt-advisor - AI-powered analysis');
  console.log('\n💡 Next step: Deploy infrastructure and populate default prompts');
}

// Handle command line execution
if (require.main === module) {
  runAllTests().catch(console.error);
}

module.exports = { runAllTests, makeRequest };