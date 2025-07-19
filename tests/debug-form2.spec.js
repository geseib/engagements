const { test, expect } = require('@playwright/test');

const FRONTEND_URL = 'https://eng.dev.seibtribe.us';

test('Debug Form After Engagement Type', async ({ page }) => {
  console.log('🔍 Debugging form after selecting engagement type...');
  
  await page.goto(`${FRONTEND_URL}/host`);
  await page.waitForLoadState('networkidle');
  
  // Click the button
  const button = await page.locator('button:has-text("🎯 Start New Game")').first();
  await button.click();
  
  // Wait for form
  await page.waitForSelector('text="Create Game"', { timeout: 10000 });
  
  // Fill title
  const titleInput = await page.locator('input[type="text"]').first();
  await titleInput.fill('Test Game');
  
  // Select Call and Answer type
  await page.selectOption('select', 'Call and Answer');
  await page.waitForTimeout(2000);
  
  // Check for any new selects or form elements
  const allSelects = await page.locator('select').all();
  console.log(`Found ${allSelects.length} select elements after choosing engagement type`);
  
  for (let i = 0; i < allSelects.length; i++) {
    const options = await allSelects[i].locator('option').allTextContents();
    console.log(`Select ${i} options:`, options);
  }
  
  // Check entire form HTML
  const formHTML = await page.locator('body').innerHTML();
  if (formHTML.includes('Greatest Hits')) {
    console.log('✅ Found "Greatest Hits" in page HTML');
  } else {
    console.log('❌ "Greatest Hits" not found in page HTML');
  }
  
  // Take screenshot
  await page.screenshot({ path: 'test-results/debug-after-engagement-type.png' });
});