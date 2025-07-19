const { test, expect } = require('@playwright/test');

const FRONTEND_URL = 'https://eng.dev.seibtribe.us';

test('Test Game Creation and Player Join', async ({ browser }) => {
  const hostContext = await browser.newContext();
  const playerContext = await browser.newContext();
  const hostPage = await hostContext.newPage();
  const playerPage = await playerContext.newPage();

  // Listen for console messages
  hostPage.on('console', msg => {
    console.log(`HOST: ${msg.type()}: ${msg.text()}`);
  });
  
  playerPage.on('console', msg => {
    console.log(`PLAYER: ${msg.type()}: ${msg.text()}`);
  });

  console.log('🎮 Step 1: Host creates game');
  
  // Host creates game
  await hostPage.goto(`${FRONTEND_URL}/host`);
  await hostPage.waitForLoadState('networkidle');
  
  await hostPage.click('button:has-text("🎯 Start New Game")');
  await hostPage.waitForSelector('text="Create Game"', { timeout: 10000 });
  
  await hostPage.fill('input[type="text"]', 'Test Game');
  await hostPage.selectOption('select >> nth=0', 'Call and Answer');
  await hostPage.waitForTimeout(1000);
  await hostPage.selectOption('select >> nth=1', 'Greatest Hits (10 questions)');
  await hostPage.waitForTimeout(3000);
  
  await hostPage.click('button:has-text("Start New Game")');
  await hostPage.waitForTimeout(5000);
  
  // Get game ID from URL
  const hostUrl = await hostPage.url();
  const gameId = new URLSearchParams(hostUrl.split('?')[1])?.get('gameId');
  
  console.log(`✅ Game created with ID: ${gameId}`);
  expect(gameId).toBeTruthy();
  
  console.log('👥 Step 2: Player joins game');
  
  // Player joins game
  await playerPage.goto(`${FRONTEND_URL}/play?gameId=${gameId}`);
  await playerPage.waitForLoadState('networkidle');
  
  await playerPage.fill('input[placeholder*="name"], input[placeholder*="Name"]', 'TestPlayer');
  await playerPage.click('button:has-text("Join")');
  
  await playerPage.waitForTimeout(3000);
  
  // Check if player joined successfully
  const playerUrl = await playerPage.url();
  console.log(`Player URL: ${playerUrl}`);
  
  // Verify host sees the player
  await hostPage.waitForTimeout(2000);
  const playerList = await hostPage.textContent('body');
  expect(playerList).toContain('TestPlayer');
  
  console.log('✅ Player joined successfully!');
  
  await hostPage.close();
  await playerPage.close();
});