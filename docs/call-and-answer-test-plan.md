# Call and Answer Games - Comprehensive Test Plan

## Overview
This test plan covers all functionality for Call and Answer games, including prompt creation, question set management, AI prompt assignment, category management, randomization options, and end-to-end game flow.

---

## Test Case 1: Create AI Prompt
**Objective**: Test creation of custom AI prompts for call and answer games

### Test Steps:
1. Navigate to Admin Page → AI Prompts tab
2. Click "Create New Prompt"
3. Fill in prompt details:
   - **Name**: "Test Leadership Analysis"
   - **Description**: "Analyze leadership responses for team building"
   - **Game Type**: Select "Call and Answer"
   - **Category**: Select "Leadership"
   - **Instructions**: Enter custom analysis instructions
   - **Output Format**: Define markdown output structure with template variables
4. Test "Generate AI Prompt" button functionality
5. Test AI Advisor (Improve/Validate/Optimize) features
6. Save the prompt

### Expected Results:
- Prompt saves successfully with all fields
- Generate AI tool enhances content rather than replacing it
- AI Advisor preserves admin intent while providing suggestions
- Prompt appears in AI Prompts list
- Prompt can be selected for question sets

---

## Test Case 2: Create Question Set
**Objective**: Test creation of call and answer question sets

### Test Steps:
1. Navigate to Admin Page → Question Sets tab
2. Click "Upload Question Set" and expand the upload section
3. Create new question set:
   - **Name**: "Leadership Scenarios Test"
   - **Description**: "Test scenarios for leadership assessment"
   - **Game Type**: Select "Call and Answer"
   - **Categories**: Select multiple categories (e.g., Leadership, Team Building, Decision Making)
4. Add individual questions:
   - **Title**: "Difficult Team Decision"
   - **Detail**: "Describe a time you had to make a tough decision affecting your team"
   - **Category**: "Leadership"
   - **Custom Instructions**: "Focus on decision-making process and team impact"
5. Add 5-10 more questions across different categories
6. Save question set

### Expected Results:
- Question set saves with correct metadata
- All questions saved with proper formatting
- Categories properly assigned
- Question set appears in scrollable list (max 8 visible items)
- Statistics show correct question count and categories

---

## Test Case 3: Edit Question Set
**Objective**: Test editing existing question sets

### Test Steps:
1. Navigate to Question Sets tab
2. Select existing question set from list
3. Click "Edit Questions" 
4. Modify existing questions:
   - Edit question titles and details
   - Change categories
   - Update custom instructions
   - Toggle active/inactive status
5. Add new questions to the set
6. Remove questions from the set
7. Save changes

### Expected Results:
- All edits saved correctly
- Question count updates properly
- Categories reflect changes
- Active/inactive questions handled correctly
- Changes persist after page refresh

---

## Test Case 4: Set AI Prompt for Question Set
**Objective**: Test assignment of AI prompts to question sets

### Test Steps:
1. Navigate to Question Sets tab
2. Select a question set
3. In question set details, locate "AI Prompt Assignment" section
4. Click dropdown to select AI prompt
5. Choose from available prompts (including custom prompts from Test Case 1)
6. Test different prompt types:
   - Default prompts (lessons-learned, team-building, etc.)
   - Custom prompts created earlier
   - Prompts with different categories
7. Save assignment
8. Verify prompt appears in question set metadata

### Expected Results:
- AI prompt dropdown shows all available prompts
- Selected prompt saves to question set
- Prompt assignment displays correctly in UI
- Question set shows assigned prompt in metadata
- Different game types show appropriate prompts only

---

## Test Case 5: Disable/Enable Categories
**Objective**: Test category management functionality

### Test Steps:
1. Navigate to Question Sets tab
2. Select question set with multiple categories
3. Test category disabling:
   - Identify categories currently enabled
   - Disable specific categories using toggle/checkbox controls
   - Verify question count updates reflect disabled categories
4. Test category enabling:
   - Re-enable previously disabled categories
   - Verify questions from those categories become available again
5. Test with different combinations:
   - Disable all but one category
   - Enable all categories
   - Disable majority of categories

### Expected Results:
- Category toggles work correctly
- Question counts update immediately when categories disabled/enabled
- Only questions from enabled categories included in games
- UI clearly shows which categories are active/inactive
- Changes persist across page refreshes

---

## Test Case 6: Random vs Non-Random Game Selection
**Objective**: Test randomization settings for question selection

### Test Steps:
1. **Create Game with Random Selection**:
   - Navigate to host page and create new game
   - Select question set with multiple categories
   - Enable "Random Question Order" option
   - Set total number of questions (e.g., 5 questions)
   - Start game and note question sequence
   - Repeat game creation multiple times to verify randomization

2. **Create Game with Non-Random Selection**:
   - Create new game with same question set
   - Disable "Random Question Order" (or select "Sequential")
   - Set same total number of questions
   - Start game and note question sequence
   - Repeat to verify consistent ordering

3. **Test Category-Specific Randomization**:
   - Create game with multiple categories enabled
   - Test random selection across categories
   - Verify questions pulled from different categories
   - Test non-random with category order

### Expected Results:
- **Random Mode**: 
  - Questions appear in different order each game
  - Questions selected randomly from enabled categories
  - No repeated questions within single game
  - Fair distribution across categories when possible
- **Non-Random Mode**:
  - Questions appear in consistent order
  - Same questions selected each time with same settings
  - Sequential order follows question set organization
- **Category Handling**:
  - Only questions from enabled categories appear
  - Random mode respects category selection
  - Sequential mode maintains category grouping

---

## Test Case 7: End-to-End Game Flow
**Objective**: Test complete game workflow from creation to AI summary

### Test Steps:
1. **Game Setup**:
   - Create game with test question set
   - Configure categories and randomization
   - Set AI prompt assignment
   - Generate QR code for player access

2. **Player Participation**:
   - Multiple players join via QR code
   - Host starts game
   - For each question:
     - Host presents question with custom instructions
     - Players submit text responses
     - Host initiates voting phase
     - Players vote on best responses
     - Host shows voting results

3. **Game Progression**:
   - Test with 3-5 questions
   - Verify WebSocket updates between host and players
   - Check question progress tracking
   - Validate voting tallies and winner selection

4. **Game Completion & AI Summary**:
   - Complete final question
   - Host ends game
   - AI summary generates automatically using assigned prompt
   - Review AI summary for quality and accuracy
   - Test markdown formatting in summary
   - Verify template variables populated correctly

### Expected Results:
- Smooth game flow without errors
- Real-time updates work correctly
- Question randomization/ordering works as configured
- Voting system functions properly
- AI summary generates with assigned prompt
- Summary includes relevant game data and insights
- Markdown formatting renders correctly
- All template variables populated appropriately

---

## Test Case 8: Error Handling & Edge Cases
**Objective**: Test system behavior under error conditions

### Test Steps:
1. **Invalid Data Entry**:
   - Try creating question set with empty required fields
   - Test with extremely long question text
   - Try special characters and emojis in questions

2. **Connection Issues**:
   - Test with poor network connectivity
   - Simulate WebSocket disconnection during game
   - Test player reconnection scenarios

3. **Game State Issues**:
   - Try starting game with no questions
   - Test with all categories disabled
   - Try accessing game with invalid game ID

4. **AI Prompt Issues**:
   - Test with no AI prompt assigned
   - Test with invalid template variables
   - Test AI summary generation failures

### Expected Results:
- Appropriate error messages for invalid input
- Graceful handling of connection issues
- Auto-reconnection when possible
- Clear user feedback for error conditions
- Fallback behavior when AI features fail
- No data loss during error conditions

---

## Test Case 9: Cross-Browser & Device Testing
**Objective**: Ensure compatibility across platforms

### Test Steps:
1. **Browser Testing**:
   - Test on Chrome, Firefox, Safari, Edge
   - Verify admin panel functionality
   - Test player experience on each browser
   - Check responsive design on different screen sizes

2. **Device Testing**:
   - Test admin panel on desktop/laptop
   - Test player experience on mobile devices
   - Verify QR code scanning on mobile
   - Test touch interactions for mobile voting

3. **Performance Testing**:
   - Test with maximum number of players
   - Test with long question sets (20+ questions)  
   - Monitor load times and responsiveness
   - Test AI summary generation performance

### Expected Results:
- Consistent functionality across all browsers
- Responsive design works on all screen sizes
- Mobile experience optimized for touch
- Good performance under load
- Fast AI summary generation
- No browser-specific bugs or issues

---

## Success Criteria

### Functional Requirements:
- ✅ All test cases pass without critical errors
- ✅ Random/non-random selection works correctly
- ✅ Category management functions properly
- ✅ AI prompt assignment and generation works
- ✅ End-to-end game flow completes successfully
- ✅ Real-time updates function correctly

### Performance Requirements:
- ✅ Page load times under 3 seconds
- ✅ WebSocket updates under 1 second
- ✅ AI summary generation under 30 seconds
- ✅ Smooth operation with 20+ concurrent players

### Quality Requirements:
- ✅ Intuitive user interface
- ✅ Clear error messages and feedback
- ✅ Consistent behavior across browsers
- ✅ Mobile-friendly design
- ✅ Accessible to users with disabilities

---

## Notes for Testers

### Pre-Test Setup:
1. Ensure test environment has recent deployment
2. Create test AI prompts covering different categories
3. Prepare test question sets with varied content
4. Have multiple devices available for multi-player testing

### Test Data Recommendations:
- Use realistic business scenarios in questions
- Test with 5-20 questions per set
- Include various category combinations
- Test with 3-15 players for optimal experience

### Reporting:
- Document any bugs with screenshots
- Note performance issues with specific timing
- Report browser/device-specific problems
- Suggest improvements for user experience

---

*Last Updated: January 2025*
*Test Plan Version: 1.0*