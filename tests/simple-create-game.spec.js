const { test, expect } = require('@playwright/test');

const FRONTEND_URL = 'https://eng.dev.seibtribe.us';

test('Simple Game Creation Test', async ({ page }) => {
  console.log('🎮 Testing simple game creation...');
  
  await page.goto(`${FRONTEND_URL}/host`);
  await page.waitForLoadState('networkidle');
  
  // Click start new game
  await page.click('button:has-text("🎯 Start New Game")');
  
  // Wait for form
  await page.waitForSelector('text="Create Game"', { timeout: 10000 });
  
  // Fill title
  await page.fill('input[type="text"]', 'Simple Test Game');
  
  // Select engagement type
  await page.selectOption('select >> nth=0', 'Call and Answer');
  await page.waitForTimeout(1000);
  
  // Select question set
  await page.selectOption('select >> nth=1', 'Greatest Hits (10 questions)');
  await page.waitForTimeout(3000);
  
  // Take screenshot to see current state
  await page.screenshot({ path: 'test-results/simple-test-form.png' });
  
  // Count all buttons with "Start New Game" text
  const startButtons = await page.locator('button:has-text("Start New Game")').all();
  console.log(`Found ${startButtons.length} "Start New Game" buttons`);
  
  // Find all visible buttons
  const allButtons = await page.locator('button:visible').allTextContents();
  console.log('All visible buttons:', allButtons);
  
  // Try to submit by clicking the last "Start New Game" button if there are multiple
  if (startButtons.length > 1) {
    console.log('Clicking second "Start New Game" button...');
    await startButtons[1].click();
  } else if (startButtons.length === 1) {
    console.log('Only one "Start New Game" button found, skipping click to avoid going back...');
  }
  
  await page.waitForTimeout(5000);
  
  // Check current URL
  const currentUrl = page.url();
  console.log('Current URL after submit:', currentUrl);
  
  // Take final screenshot
  await page.screenshot({ path: 'test-results/simple-test-after-submit.png' });
});