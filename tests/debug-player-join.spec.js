const { test, expect } = require('@playwright/test');

const FRONTEND_URL = 'https://eng.dev.seibtribe.us';

test('Debug Player Join Process', async ({ browser }) => {
  console.log('🔍 Debugging player join process...');
  
  const hostContext = await browser.newContext();
  const playerContext = await browser.newContext();
  
  const hostPage = await hostContext.newPage();
  const playerPage = await playerContext.newPage();
  
  let gameId;
  
  try {
    // === CREATE GAME ===
    await hostPage.goto(`${FRONTEND_URL}/host`);
    await hostPage.waitForLoadState('networkidle');
    
    await hostPage.click('button:has-text("🎯 Start New Game")');
    await hostPage.waitForSelector('text="Create Game"');
    await hostPage.fill('input[type="text"]', 'Debug Test Game');
    await hostPage.selectOption('select >> nth=0', 'Call and Answer');
    await hostPage.waitForTimeout(1000);
    await hostPage.selectOption('select >> nth=1', 'Greatest Hits (10 questions)');
    await hostPage.waitForTimeout(2000);
    
    const randomCheckbox = await hostPage.locator('input[type="checkbox"]').first();
    if (await randomCheckbox.isVisible()) {
      await randomCheckbox.check();
    }
    
    await hostPage.click('button:has-text("Start New Game"):visible');
    await hostPage.waitForTimeout(3000);
    
    // Get game ID from URL
    const url = await hostPage.url();
    gameId = new URLSearchParams(url.split('?')[1])?.get('gameId');
    console.log(`✅ Game created with ID: ${gameId}`);
    
    // === DEBUG PLAYER JOIN ===
    console.log('🔍 Testing player join...');
    
    await playerPage.goto(`${FRONTEND_URL}/play?gameId=${gameId}`);
    await playerPage.waitForLoadState('networkidle');
    
    // Take screenshot of initial player page
    await playerPage.screenshot({ path: 'test-results/player-page-initial.png' });
    
    // Fill name and join
    await playerPage.fill('input[type="text"]:not([readonly])', 'DebugPlayer');
    
    // Take screenshot before clicking join
    await playerPage.screenshot({ path: 'test-results/player-before-join.png' });
    
    // Check if join button is visible
    const joinButton = await playerPage.locator('button:has-text("Join"), button:has-text("Play")').first();
    const isJoinButtonVisible = await joinButton.isVisible();
    console.log(`Join button visible: ${isJoinButtonVisible}`);
    
    if (isJoinButtonVisible) {
      await joinButton.click();
      console.log('✅ Clicked join button');
      
      // Wait a bit and take screenshot
      await playerPage.waitForTimeout(3000);
      await playerPage.screenshot({ path: 'test-results/player-after-join.png' });
      
      // Check page content
      const pageContent = await playerPage.textContent('body');
      console.log('Page content after join (first 500 chars):', pageContent.substring(0, 500));
      
      // Check for various possible states
      const possibleStates = [
        'text="Waiting for"',
        'text="waiting"', 
        '.waiting-screen',
        'text="Joined"',
        'text="Connected"',
        'text="Error"',
        'text="Game"'
      ];
      
      for (const state of possibleStates) {
        const element = await playerPage.locator(state).first();
        if (await element.isVisible()) {
          console.log(`✅ Found state: ${state}`);
        }
      }
      
      // Check current URL
      const currentUrl = await playerPage.url();
      console.log('Current URL after join:', currentUrl);
      
    } else {
      console.log('❌ Join button not found');
    }
    
  } catch (error) {
    console.error('❌ Debug failed:', error.message);
    throw error;
  } finally {
    await hostPage.close();
    await playerPage.close();
    await hostContext.close();
    await playerContext.close();
  }
});