const { test, expect } = require('@playwright/test');

const FRONTEND_URL = 'https://eng.dev.seibtribe.us';

test('Debug Host Page', async ({ page }) => {
  console.log('🔍 Debugging host page...');
  
  await page.goto(`${FRONTEND_URL}/host`);
  await page.waitForLoadState('networkidle');
  
  // Take screenshot
  await page.screenshot({ path: 'test-results/debug-host-page.png' });
  
  // Log page content
  const pageTitle = await page.title();
  console.log('Page title:', pageTitle);
  
  // Check for buttons
  const allButtons = await page.locator('button').allTextContents();
  console.log('All buttons found:', allButtons);
  
  // Check for any inputs
  const allInputs = await page.locator('input').allTextContents();
  console.log('All inputs found:', allInputs);
  
  // Get page HTML to see structure
  const bodyHTML = await page.locator('body').innerHTML();
  console.log('Body HTML preview:', bodyHTML.substring(0, 500));
});