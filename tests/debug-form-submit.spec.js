const { test, expect } = require('@playwright/test');

const FRONTEND_URL = 'https://eng.dev.seibtribe.us';

test('Debug Form Submit', async ({ page }) => {
  console.log('🎮 Testing form submission with console logging...');
  
  // Listen for console messages
  page.on('console', msg => {
    console.log(`BROWSER: ${msg.type()}: ${msg.text()}`);
  });
  
  // Listen for page errors
  page.on('pageerror', error => {
    console.log(`PAGE ERROR: ${error.message}`);
  });
  
  // Listen for network requests
  page.on('request', request => {
    if (request.url().includes('games')) {
      console.log(`REQUEST: ${request.method()} ${request.url()}`);
    }
  });
  
  // Listen for network responses
  page.on('response', response => {
    if (response.url().includes('games')) {
      console.log(`RESPONSE: ${response.status()} ${response.url()}`);
    }
  });
  
  await page.goto(`${FRONTEND_URL}/host`);
  await page.waitForLoadState('networkidle');
  
  // Click start new game
  await page.click('button:has-text("🎯 Start New Game")');
  
  // Wait for form
  await page.waitForSelector('text="Create Game"', { timeout: 10000 });
  
  // Fill title
  await page.fill('input[type="text"]', 'Debug Test Game');
  
  // Select engagement type
  await page.selectOption('select >> nth=0', 'Call and Answer');
  await page.waitForTimeout(1000);
  
  // Select question set
  await page.selectOption('select >> nth=1', 'Greatest Hits (10 questions)');
  await page.waitForTimeout(3000);
  
  console.log('About to click Start New Game button...');
  
  // Click the form submit button
  await page.click('button:has-text("Start New Game")');
  
  await page.waitForTimeout(10000);
  
  const currentUrl = page.url();
  console.log('Current URL after submit:', currentUrl);
  
  // Check if there's any alert or error message
  const alerts = await page.locator('text="Please select"').all();
  if (alerts.length > 0) {
    console.log('Found validation alerts:', await Promise.all(alerts.map(a => a.textContent())));
  }
  
  // Take final screenshot
  await page.screenshot({ path: 'test-results/debug-form-submit.png' });
});