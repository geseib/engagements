const { test, expect } = require('@playwright/test');

const FRONTEND_URL = 'https://eng.dev.seibtribe.us';

test('Debug Form Details', async ({ page }) => {
  console.log('🔍 Debugging form after button click...');
  
  await page.goto(`${FRONTEND_URL}/host`);
  await page.waitForLoadState('networkidle');
  
  // Click the button
  const button = await page.locator('button:has-text("🎯 Start New Game")').first();
  await button.click();
  
  // Wait for form
  await page.waitForSelector('text="Create Game"', { timeout: 10000 });
  
  // Debug select options
  const selectElement = await page.locator('select').first();
  const options = await selectElement.locator('option').allTextContents();
  console.log('Select options:', options);
  
  // Get option values
  const optionValues = await selectElement.locator('option').allTextContents();
  console.log('Option values:', optionValues);
  
  // Debug input elements
  const inputs = await page.locator('input').all();
  console.log(`Found ${inputs.length} input elements`);
  
  for (let i = 0; i < inputs.length; i++) {
    const type = await inputs[i].getAttribute('type') || 'text';
    const placeholder = await inputs[i].getAttribute('placeholder') || '';
    console.log(`Input ${i}: type=${type}, placeholder="${placeholder}"`);
  }
  
  // Check for checkboxes
  const checkboxes = await page.locator('input[type="checkbox"]').all();
  console.log(`Found ${checkboxes.length} checkboxes`);
  
  // Take screenshot
  await page.screenshot({ path: 'test-results/debug-form-details.png' });
});