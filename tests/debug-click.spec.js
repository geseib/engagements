const { test, expect } = require('@playwright/test');

const FRONTEND_URL = 'https://eng.dev.seibtribe.us';

test('Debug Button Click', async ({ page }) => {
  console.log('🔍 Debugging button click...');
  
  await page.goto(`${FRONTEND_URL}/host`);
  await page.waitForLoadState('networkidle');
  
  console.log('Page loaded');
  
  // Take screenshot before click
  await page.screenshot({ path: 'test-results/before-click.png' });
  
  // Click the button
  const button = await page.locator('button:has-text("🎯 Start New Game")').first();
  await button.click();
  
  console.log('Button clicked');
  
  // Wait a moment and take another screenshot
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'test-results/after-click.png' });
  
  // Check what elements are visible now
  const allVisibleElements = await page.locator('*:visible').allTextContents();
  console.log('Visible elements after click:', allVisibleElements.slice(0, 10));
  
  // Check for any form or input elements
  const forms = await page.locator('form').count();
  const modals = await page.locator('.modal').count();
  const inputs = await page.locator('input[type="text"], textarea').count();
  
  console.log(`Forms: ${forms}, Modals: ${modals}, Inputs: ${inputs}`);
  
  // Get page URL to see if we navigated
  const currentUrl = page.url();
  console.log('Current URL:', currentUrl);
});