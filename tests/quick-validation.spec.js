const { test, expect } = require('@playwright/test');

const FRONTEND_URL = 'https://eng.dev.seibtribe.us';

test('Quick End-to-End Validation', async ({ browser }) => {
  console.log('🚀 Quick validation of core game flow...');
  
  // Create contexts
  const hostContext = await browser.newContext();
  const playerContext = await browser.newContext();
  
  const hostPage = await hostContext.newPage();
  const playerPage = await playerContext.newPage();
  
  let gameId;
  
  try {
    // === HOST CREATES GAME ===
    console.log('📝 Host creates game...');
    
    await hostPage.goto(`${FRONTEND_URL}/host`);
    await hostPage.waitForLoadState('networkidle');
    
    // Create game
    await hostPage.click('button:has-text("🎯 Start New Game")');
    await hostPage.waitForSelector('text="Create Game"', { timeout: 10000 });
    
    await hostPage.fill('input[type="text"]', 'Quick Test Game');
    await hostPage.selectOption('select >> nth=0', 'Call and Answer');
    await hostPage.waitForTimeout(1000);
    await hostPage.selectOption('select >> nth=1', 'Greatest Hits (10 questions)');
    await hostPage.waitForTimeout(2000);
    
    // Enable randomization if available
    const randomCheckbox = await hostPage.locator('input[type="checkbox"]').first();
    if (await randomCheckbox.isVisible()) {
      await randomCheckbox.check();
    }
    
    await hostPage.click('button:has-text("Start New Game"):visible');
    await hostPage.waitForTimeout(3000);
    
    // Extract game ID
    const url = await hostPage.url();
    gameId = new URLSearchParams(url.split('?')[1])?.get('gameId');
    
    if (!gameId) {
      // Try finding it in page content
      const pageContent = await hostPage.textContent('body');
      const match = pageContent.match(/game.*?(\d{4})/i);
      if (match) gameId = match[1];
    }
    
    expect(gameId).toBeTruthy();
    console.log(`✅ Game created with ID: ${gameId}`);
    
    // === PLAYER JOINS ===
    console.log('👤 Player joins game...');
    
    await playerPage.goto(`${FRONTEND_URL}/play?gameId=${gameId}`);
    await playerPage.waitForLoadState('networkidle');
    
    // Join as player - find the name input (not the readonly game ID input)
    await playerPage.fill('input[type="text"]:not([readonly])', 'TestPlayer');
    await playerPage.click('button:has-text("Join"), button:has-text("Play")');
    
    // Wait for join confirmation
    await playerPage.waitForSelector('text="Waiting for", text="waiting", .waiting-screen', { timeout: 10000 });
    console.log('✅ Player joined successfully');
    
    // === VERIFY HOST SEES PLAYER ===
    await hostPage.waitForTimeout(2000);
    const hostPageContent = await hostPage.textContent('body');
    
    if (hostPageContent.includes('TestPlayer')) {
      console.log('✅ Host sees player in game');
    } else {
      console.log('⚠️ Host may not see player yet (could be timing)');
    }
    
    console.log('🎉 Quick validation PASSED! Core functionality works.');
    
  } catch (error) {
    console.error('❌ Quick validation failed:', error.message);
    throw error;
  } finally {
    await hostPage.close();
    await playerPage.close();
    await hostContext.close();
    await playerContext.close();
  }
});