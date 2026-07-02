// Shared utilities for AWS Bedrock operations with retry logic

// Exponential backoff retry utility
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Track request timestamps for rate limiting (per Lambda instance)
let requestHistory = [];
const REQUESTS_PER_MINUTE = 25; // Optimized limit for Bedrock (gradual rollout from 5)
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
  
  // Calculate optimal spacing: 60 seconds / 25 requests = 2.4 seconds per request
  const optimalSpacing = MINUTE_IN_MS / REQUESTS_PER_MINUTE;
  
  // If we have fewer requests than the limit, use optimal spacing
  if (requestHistory.length < REQUESTS_PER_MINUTE) {
    const now = Date.now();
    const lastRequest = Math.max(...requestHistory);
    const timeSinceLastRequest = now - lastRequest;
    
    // Wait for optimal spacing if we're going too fast
    if (timeSinceLastRequest < optimalSpacing) {
      return optimalSpacing - timeSinceLastRequest + 100; // 100ms buffer
    }
    return 0;
  }
  
  // If at capacity, wait for oldest request to expire (fallback behavior)
  const now = Date.now();
  const oldestRequest = Math.min(...requestHistory);
  const timeUntilOldestExpires = (oldestRequest + MINUTE_IN_MS) - now;
  
  // Add small buffer to ensure we're past the rate limit window
  return Math.max(0, timeUntilOldestExpires + 500);
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
        // Ensure minimum 2 second wait for rate limit errors (optimized from 30s)
        const actualWait = Math.max(waitTime, 2000);
        
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
  const modelId = `arn:aws:bedrock:us-east-1:${process.env.ACCOUNT_ID}:inference-profile/us.anthropic.claude-sonnet-4-6`;

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
      console.log('🔄 BEDROCK: Trying Claude Haiku 4.5 as fallback...');
      
      // Try Claude Haiku 4.5 inference profile ARN as fallback
      const haikuModelId = `arn:aws:bedrock:us-east-1:${process.env.ACCOUNT_ID}:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0`;
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