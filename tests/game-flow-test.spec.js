const { test, expect } = require('@playwright/test');

const FRONTEND_URL = 'https://eng.dev.seibtribe.us';
const API_BASE = 'https://h1jcmja0w1.execute-api.us-east-1.amazonaws.com/dev/';

test.describe('Game Flow End-to-End Test', () => {
  let gameId;
  let hostPage;
  let player1Page;
  let player2Page;
  let player3Page;

  test.beforeAll(async ({ browser }) => {
    // Create contexts for host and 3 players
    const hostContext = await browser.newContext();
    const player1Context = await browser.newContext();
    const player2Context = await browser.newContext();
    const player3Context = await browser.newContext();

    hostPage = await hostContext.newPage();
    player1Page = await player1Context.newPage();
    player2Page = await player2Context.newPage();
    player3Page = await player3Context.newPage();
  });

  test('Complete Game Flow - Greatest Hits with Random Questions', async () => {
    console.log('🚀 Starting complete game flow test...');

    // === STEP 1: HOST CREATES GAME ===
    console.log('📝 Step 1: Host creates new game');
    
    await hostPage.goto(`${FRONTEND_URL}/host`);
    await hostPage.waitForLoadState('networkidle');
    
    // Take screenshot for debugging
    await hostPage.screenshot({ path: 'test-results/host-page-loaded.png' });

    // Click "Start New Game" button 
    const newGameButton = await hostPage.locator('button:has-text("🎯 Start New Game"), button:has-text("Start New Game"), button:has-text("New Game")').first();
    await newGameButton.waitFor({ timeout: 10000 });
    await newGameButton.click();
    
    // Wait for form to appear and fill in game details
    await hostPage.waitForSelector('text="Create Game"', { timeout: 10000 });
    await hostPage.screenshot({ path: 'test-results/create-game-form.png' });

    // Fill in event title
    const titleInput = await hostPage.locator('input[type="text"]').first();
    await titleInput.fill('Test Game - Greatest Hits');
    
    // Select Call and Answer engagement type first
    const engagementSelect = await hostPage.locator('select').first();
    await engagementSelect.selectOption('Call and Answer');
    await hostPage.waitForTimeout(1000);
    
    // Select "Greatest Hits" question set from the second select
    const questionSetSelect = await hostPage.locator('select').nth(1);
    await questionSetSelect.selectOption('Greatest Hits (10 questions)');
    await hostPage.waitForTimeout(2000); // Wait for categories to load

    // Wait for categories to load and take screenshot
    await hostPage.waitForTimeout(3000);
    await hostPage.screenshot({ path: 'test-results/categories-loaded.png' });
    
    // Find category checkboxes - look for ones that are not the randomization checkbox
    const allCheckboxes = await hostPage.locator('input[type="checkbox"]').all();
    console.log(`Found ${allCheckboxes.length} total checkboxes`);
    
    // Enable randomization checkbox first (should be near "random" text)
    const randomCheckbox = await hostPage.locator('input[type="checkbox"]:near(:text("random"), 50)').first();
    if (await randomCheckbox.isVisible()) {
      await randomCheckbox.check();
      console.log('✅ Enabled randomization');
    }
    
    // Find category checkboxes by looking for ones near category names
    const categoryNames = ['Entertainment', 'Travel', 'Food', 'Sports', 'Technology', 'History', 'Science', 'Art'];
    let categoriesSelected = 0;
    
    for (const categoryName of categoryNames) {
      const categoryCheckbox = await hostPage.locator(`input[type="checkbox"]:near(:text("${categoryName}"), 50)`).first();
      if (await categoryCheckbox.isVisible() && categoriesSelected < 2) {
        const isChecked = await categoryCheckbox.isChecked();
        if (!isChecked) {
          await categoryCheckbox.check();
          console.log(`✅ Selected category: ${categoryName}`);
          categoriesSelected++;
        }
      }
    }
    
    if (categoriesSelected === 0) {
      console.log('⚠️ No categories selected, continuing anyway...');
    }

    // Create the game - click the "Start New Game" button in the form
    await hostPage.screenshot({ path: 'test-results/before-submit.png' });
    
    // Find the submit button (should be the "Start New Game" button in the form, not the page header)
    const startButtons = await hostPage.locator('button:has-text("Start New Game")').all();
    console.log(`Found ${startButtons.length} "Start New Game" buttons`);
    
    // Click the form submit button (there should be one in the form)
    await hostPage.click('button:has-text("Start New Game"):visible');
    await hostPage.waitForTimeout(5000); // Wait for game creation

    // Extract game ID from URL or display
    await hostPage.waitForTimeout(2000);
    await hostPage.screenshot({ path: 'test-results/after-game-creation.png' });
    
    // Try multiple ways to find the game ID
    let gameIdElement;
    try {
      gameIdElement = await hostPage.locator('[data-testid="game-id"]').first();
      if (!(await gameIdElement.isVisible())) {
        gameIdElement = await hostPage.locator('.game-id').first();
      }
      if (!(await gameIdElement.isVisible())) {
        gameIdElement = await hostPage.locator('text=/Game ID:.*\\d+/').first();
      }
    } catch (e) {
      console.log('Could not find game ID element, trying URL...');
    }
    
    let gameIdText = '';
    if (gameIdElement && await gameIdElement.isVisible()) {
      gameIdText = await gameIdElement.textContent();
    }
    
    gameId = gameIdText.match(/\d{4}/)?.[0];
    
    if (!gameId) {
      // Try to get from URL
      const url = await hostPage.url();
      gameId = new URLSearchParams(url.split('?')[1])?.get('gameId');
    }
    
    expect(gameId).toBeTruthy();
    console.log(`✅ Game created with ID: ${gameId}`);

    // === STEP 2: PLAYERS JOIN GAME ===
    console.log('👥 Step 2: Players join the game');

    const players = [
      { page: player1Page, name: 'Alice' },
      { page: player2Page, name: 'Bob' },
      { page: player3Page, name: 'Charlie' }
    ];

    for (const player of players) {
      await player.page.goto(`${FRONTEND_URL}/play?gameId=${gameId}`);
      await player.page.waitForLoadState('networkidle');
      
      // Fill in player name and join
      await player.page.fill('input[placeholder*="name"], input[type="text"]', player.name);
      await player.page.click('button:has-text("Join"), button:has-text("Play")');
      
      // Wait for join confirmation
      await player.page.waitForSelector('text="Waiting for", text="waiting", .waiting-screen', { timeout: 10000 });
      console.log(`✅ ${player.name} joined the game`);
    }

    // Verify host sees all players
    await hostPage.waitForTimeout(2000);
    const playerList = await hostPage.locator('.player-list, .players').first();
    await expect(playerList).toContainText('Alice');
    await expect(playerList).toContainText('Bob');
    await expect(playerList).toContainText('Charlie');
    console.log('✅ Host sees all 3 players');

    // === STEP 3: HOST STARTS FIRST QUESTION ===
    console.log('🎯 Step 3: Host starts first question');
    
    await hostPage.click('button:has-text("Next Question"), button:has-text("Start")');
    await hostPage.waitForTimeout(3000);

    // Verify question is displayed
    const questionTitle = await hostPage.locator('.question-title, .question h2, h1').first();
    await expect(questionTitle).toBeVisible();
    const questionText = await questionTitle.textContent();
    console.log(`✅ Question started: "${questionText}"`);

    // === STEP 4: PLAYERS ANSWER QUESTION ===
    console.log('💭 Step 4: Players submit answers');

    const answers = [
      'My favorite movie is The Matrix because of its philosophical depth',
      'I love classical music, especially Beethoven symphonies',
      'Pizza is my go-to comfort food - simple and satisfying'
    ];

    for (let i = 0; i < players.length; i++) {
      const player = players[i];
      const answer = answers[i];
      
      // Wait for question to appear
      await player.page.waitForSelector('textarea, input[type="text"]:not([placeholder*="name"])', { timeout: 10000 });
      
      // Submit answer
      await player.page.fill('textarea, input[type="text"]:not([placeholder*="name"])', answer);
      await player.page.click('button:has-text("Submit")');
      
      // Wait for confirmation
      await player.page.waitForSelector('text="submitted", text="waiting", .answer-submitted', { timeout: 5000 });
      console.log(`✅ ${player.name} submitted answer`);
    }

    // === STEP 5: HOST STARTS VOTING ===
    console.log('🗳️ Step 5: Host starts voting phase');
    
    // Wait for all answers to be received
    await hostPage.waitForTimeout(2000);
    
    // Click Vote/Finish button
    await hostPage.click('button:has-text("Vote"), button:has-text("Finish")');
    await hostPage.waitForTimeout(3000);

    // Verify voting interface
    const votingInterface = await hostPage.locator('.voting, .answers-list').first();
    await expect(votingInterface).toBeVisible();
    console.log('✅ Voting phase started');

    // === STEP 6: PLAYERS VOTE ===
    console.log('✍️ Step 6: Players cast votes');

    for (const player of players) {
      // Wait for voting interface
      await player.page.waitForSelector('.voting, .vote-buttons, button:has-text("1st")', { timeout: 10000 });
      
      // Cast votes (each player votes for someone else's answers)
      const voteButtons = await player.page.locator('button:has-text("1st"), button:has-text("First")').all();
      if (voteButtons.length >= 3) {
        await voteButtons[0].click(); // Vote for first answer
        
        const secondVoteButtons = await player.page.locator('button:has-text("2nd"), button:has-text("Second")').all();
        if (secondVoteButtons.length >= 2) {
          await secondVoteButtons[1].click(); // Vote for second answer
        }
        
        const thirdVoteButtons = await player.page.locator('button:has-text("3rd"), button:has-text("Third")').all();
        if (thirdVoteButtons.length >= 1) {
          await thirdVoteButtons[0].click(); // Vote for third answer
        }
      }
      
      // Submit votes
      await player.page.click('button:has-text("Submit Votes"), button:has-text("Submit")');
      await player.page.waitForSelector('text="voted", text="waiting", .vote-submitted', { timeout: 5000 });
      console.log(`✅ ${player.name} cast votes`);
    }

    // === STEP 7: HOST SHOWS RESULTS ===
    console.log('🏆 Step 7: Host shows results');
    
    // Wait for all votes
    await hostPage.waitForTimeout(2000);
    
    // Click Results button
    await hostPage.click('button:has-text("Results"), button:has-text("Show Results")');
    await hostPage.waitForTimeout(3000);

    // Verify results are displayed
    const resultsDisplay = await hostPage.locator('.results, .scores').first();
    await expect(resultsDisplay).toBeVisible();
    console.log('✅ Results displayed');

    // === STEP 8: TEST SECOND QUESTION (NON-RANDOM) ===
    console.log('🔄 Step 8: Test second question with non-random selection');
    
    // Disable randomization for second question
    const randomCheckbox2 = await hostPage.locator('input[type="checkbox"]:near(text*="random")').first();
    if (await randomCheckbox2.isChecked()) {
      await randomCheckbox2.uncheck();
    }

    // Start second question
    await hostPage.click('button:has-text("Next Question")');
    await hostPage.waitForTimeout(3000);

    // Verify second question is different from first
    const secondQuestionTitle = await hostPage.locator('.question-title, .question h2, h1').first();
    const secondQuestionText = await secondQuestionTitle.textContent();
    expect(secondQuestionText).not.toBe(questionText);
    console.log(`✅ Second question started: "${secondQuestionText}"`);

    // Players answer second question quickly
    const quickAnswers = ['Answer A', 'Answer B', 'Answer C'];
    for (let i = 0; i < players.length; i++) {
      const player = players[i];
      await player.page.waitForSelector('textarea, input[type="text"]:not([placeholder*="name"])', { timeout: 10000 });
      await player.page.fill('textarea, input[type="text"]:not([placeholder*="name"])', quickAnswers[i]);
      await player.page.click('button:has-text("Submit")');
      console.log(`✅ ${player.name} answered question 2`);
    }

    // Complete voting and results for second question
    await hostPage.waitForTimeout(2000);
    await hostPage.click('button:has-text("Vote"), button:has-text("Finish")');
    await hostPage.waitForTimeout(2000);

    // Quick voting
    for (const player of players) {
      await player.page.waitForSelector('.voting, button:has-text("1st")', { timeout: 10000 });
      // Simple voting pattern
      const firstVote = await player.page.locator('button:has-text("1st")').first();
      await firstVote.click();
      await player.page.click('button:has-text("Submit")');
    }

    await hostPage.waitForTimeout(2000);
    await hostPage.click('button:has-text("Results")');
    await hostPage.waitForTimeout(2000);

    console.log('✅ Second question completed successfully');

    // === VERIFICATION: CHECK PLAYER SCORES ===
    console.log('📊 Final verification: Check player scores');
    
    const finalScores = await hostPage.locator('.score, .points').allTextContents();
    console.log('Final scores:', finalScores);
    
    // Verify players have scores > 0
    const scoreElements = await hostPage.locator('[data-testid*="score"], .player-score').all();
    let playersWithScores = 0;
    for (const scoreElement of scoreElements) {
      const scoreText = await scoreElement.textContent();
      const score = parseInt(scoreText.match(/\d+/)?.[0] || '0');
      if (score > 0) playersWithScores++;
    }
    
    expect(playersWithScores).toBeGreaterThan(0);
    console.log(`✅ ${playersWithScores} players have scores > 0`);

    console.log('🎉 Complete game flow test PASSED!');
  });

  test.afterAll(async () => {
    // Clean up
    if (hostPage) await hostPage.close();
    if (player1Page) await player1Page.close();
    if (player2Page) await player2Page.close();
    if (player3Page) await player3Page.close();
  });
});

// Helper test to verify API endpoints
test.describe('API Endpoint Tests', () => {
  test('Verify all critical endpoints respond', async ({ request }) => {
    console.log('🔍 Testing API endpoints...');

    // Test question sets
    const questionSetsResponse = await request.get(`${API_BASE}question-sets`);
    expect(questionSetsResponse.ok()).toBeTruthy();
    const questionSets = await questionSetsResponse.json();
    expect(questionSets.sets.length).toBeGreaterThan(0);
    console.log(`✅ Found ${questionSets.sets.length} question sets`);

    // Test categories for greatest hits
    const categoriesResponse = await request.get(`${API_BASE}question-sets/greatesthits/categories`);
    expect(categoriesResponse.ok()).toBeTruthy();
    const categories = await categoriesResponse.json();
    expect(categories.categories.length).toBeGreaterThan(0);
    console.log(`✅ Found ${categories.categories.length} categories for greatest hits`);

    // Test game state endpoint (should return 404 for non-existent game)
    const gameStateResponse = await request.get(`${API_BASE}games/nonexistent/state`);
    expect(gameStateResponse.status()).toBe(404);
    console.log('✅ Game state endpoint correctly returns 404 for non-existent game');

    console.log('✅ All API endpoint tests passed');
  });
});