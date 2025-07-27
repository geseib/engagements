// Shared utilities for AWS Bedrock operations with retry logic

// Exponential backoff retry utility
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Track request timestamps for rate limiting (per Lambda instance)
let requestHistory = [];
const REQUESTS_PER_MINUTE = 5; // Conservative limit for Bedrock
const MINUTE_IN_MS = 60000;

const getRequestsInLastMinute = () => {
  const now = Date.now();
  const oneMinuteAgo = now - MINUTE_IN_MS;
  
  // Clean up old entries
  requestHistory = requestHistory.filter(timestamp => timestamp > oneMinuteAgo);
  
  return requestHistory.length;
};

const calculateWaitTime = () => {
  if (requestHistory.length === 0) return 0;
  
  const now = Date.now();
  const oldestRequest = Math.min(...requestHistory);
  const timeUntilOldestExpires = (oldestRequest + MINUTE_IN_MS) - now;
  
  // Add 2 second buffer to ensure we're past the rate limit window
  return Math.max(0, timeUntilOldestExpires + 2000);
};

const retryWithBackoff = async (fn, maxRetries = 3, baseDelay = 1000) => {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Pre-emptive rate limiting check
      const recentRequests = getRequestsInLastMinute();
      if (recentRequests >= REQUESTS_PER_MINUTE) {
        const waitTime = calculateWaitTime();
        console.log(`⚠️ Rate limit prevention: ${recentRequests}/${REQUESTS_PER_MINUTE} requests in last minute. Waiting ${Math.round(waitTime/1000)}s...`);
        await sleep(waitTime);
      }
      
      // Track this request
      requestHistory.push(Date.now());
      
      // Execute the function
      return await fn();
      
    } catch (error) {
      // Remove the failed request from history
      requestHistory.pop();
      
      const isThrottled = error.name === 'ThrottlingException' || 
                         error.message?.includes('Too many requests') ||
                         error.message?.includes('throttle') ||
                         error.message?.includes('rate limit') ||
                         error.$metadata?.httpStatusCode === 429;
      
      if (isThrottled && attempt < maxRetries) {
        // For rate limit errors, wait until next minute window
        const waitTime = calculateWaitTime();
        // Ensure minimum 30 second wait for rate limit errors
        const actualWait = Math.max(waitTime, 30000);
        
        console.log(`⏳ Rate limited! Waiting ${Math.round(actualWait/1000)}s until next minute window (attempt ${attempt + 1}/${maxRetries + 1})`);
        await sleep(actualWait);
        continue;
      }
      
      // Log non-throttling errors
      if (!isThrottled) {
        console.error(`❌ Non-throttling error on attempt ${attempt + 1}:`, error.message);
      }
      
      throw error;
    }
  }
};

// Enhanced invoke Claude with comprehensive retry logic
const invokeClaudeWithRetry = async (bedrockClient, InvokeModelCommand, prompt, maxTokens = 4000) => {
  // Use same inference profile ARN as the working AI Summary function
  const modelId = 'arn:aws:bedrock:us-east-1:239601476690:inference-profile/us.anthropic.claude-3-5-sonnet-20241022-v2:0';

  console.log('🤖 Calling Claude with retry logic...');
  console.log('🤖 BEDROCK: Using model ID:', modelId);

  const payload = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: maxTokens,
    temperature: 0.7,
    messages: [
      {
        role: 'user',
        content: prompt
      }
    ]
  };

  const callBedrock = async () => {
    console.log('🤖 BEDROCK: Sending request with payload size:', JSON.stringify(payload).length);
    
    try {
      const command = new InvokeModelCommand({
        modelId: modelId,
        body: JSON.stringify(payload)
      });

      const response = await bedrockClient.send(command);
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));
      
      console.log('✅ BEDROCK SUCCESS: Received response from Sonnet');
      return responseBody.content[0].text;
      
    } catch (error) {
      console.error('🚨 BEDROCK Sonnet ERROR:', error.message);
      console.log('🔄 BEDROCK: Trying Claude 3.5 Haiku as fallback...');
      
      // Try Claude 3.5 Haiku inference profile ARN as fallback
      const haikuModelId = 'arn:aws:bedrock:us-east-1:239601476690:inference-profile/us.anthropic.claude-3-5-haiku-20241022-v1:0';
      console.log('🤖 BEDROCK: Haiku model ID:', haikuModelId);
      
      const haikuCommand = new InvokeModelCommand({
        modelId: haikuModelId,
        body: JSON.stringify(payload)
      });

      const haikuResponse = await bedrockClient.send(haikuCommand);
      const haikuResponseBody = JSON.parse(new TextDecoder().decode(haikuResponse.body));
      
      console.log('✅ BEDROCK HAIKU SUCCESS: Received response from Haiku fallback');
      return haikuResponseBody.content[0].text;
    }
  };

  return await retryWithBackoff(callBedrock, 3, 1000);
};

module.exports = {
  retryWithBackoff,
  invokeClaudeWithRetry,
  sleep
};