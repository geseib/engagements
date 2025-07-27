# Engage2 Game Display Structure Documentation

## Question Data Structure

### Call-and-Answer Questions
- **title**: Short descriptive title (e.g., "Leadership Challenge", "Team Dynamics")
- **detail**: The full question or scenario that players respond to
- **category**: Question category/theme
- **school**: Context (e.g., "Business School")
- **customInstructions**: How players should respond (from question set)

### Trivia Questions
- **title**: Short question title
- **questionDetail**: The full trivia question
- **optionA-F**: Multiple choice answers
- **correctAnswer**: Which option is correct
- **answerDetails**: Explanation shown after answering

### Wavelength Questions
- **title**: The word/phrase to associate
- **detail**: Context scenario introducing the word
- **customInstructions**: "What are the first 10 words you think of when you think of this word?"

## Display Screens

### ASK Phase (Question Display)

#### Host View (GameHostPage.jsx)
**Header Section:**
- Lesson/Question number (e.g., "Lesson 3" for call-and-answer, "Question 3" for trivia)
- Category badge
- School name (call-and-answer only)

**Question Content:**
- **Call-and-Answer**: 
  - Title: Short title (should be minimal)
  - Detail: Main question content (this is what players answer)
  - Custom Instruction: How to respond (e.g., "How would you apply this to your team?")
- **Trivia**:
  - Title: Question title
  - Question Detail: Full question text
  - Options: A-F multiple choice options
  - Instruction: "Select the best answer:"
- **Wavelength**:
  - Title: The word/phrase
  - Detail: Context scenario
  - Instruction: "What are the first 10 words..."

**Progress Section:**
- "X of Y players answered"
- Real-time answer indicators per player

**Controls:**
- "Vote" button (call-and-answer) / "Show Results" button (trivia/wavelength)
- "Skip to Next Question" button

#### Player View (PlayerPage.jsx)
**Question Display:**
- Same question content as host
- Input area based on game type:
  - Call-and-Answer: Text area for response
  - Trivia: Multiple choice buttons
  - Wavelength: 10 individual word input boxes

### VOTE Phase (Call-and-Answer Only)

#### Host View
**Display:**
- "Vote for the Best Applications!"
- Answer navigator showing one answer at a time
- Answer counter (e.g., "Answer 3 of 12")
- Navigation arrows to cycle through answers
- Current answer text in quotes
- Author name below answer

**Progress:**
- Voting progress indicators
- "X of Y players voted"

**Controls:**
- "Show Results" button
- Answer navigation arrows

#### Player View
**Display:**
- All submitted answers listed
- Ability to select top 3 choices
- Rank assignments (1st, 2nd, 3rd)
- Submit vote button

### RESULTS Phase

#### Host View
**Display Varies by Game Type:**

**Call-and-Answer Results:**
- Ranked list of answers by vote points
- Point breakdown (1st place votes, 2nd place, 3rd place)
- Player names with their answers
- Total vote points per answer
- AI-generated summary and insights

**Trivia Results:**
- List of players with their answers
- Correct/incorrect indicators
- Points earned (base + speed bonus)
- Correct answer highlighted
- Answer explanation displayed

**Wavelength Results:**
- Common words found by multiple players
- Word frequency display
- Team score (number of common words)
- Individual player word submissions

**Controls:**
- "Next Question" button
- "Generate Report" option

#### Player View
**Display:**
- Same results as host view
- Personal score update
- Leaderboard position

### END GAME Screen (Needs Implementation)

#### Host View
**Should Display:**
- "Game Complete!" header
- Final leaderboard with total scores
- Top performers highlighted
- Game statistics:
  - Total questions answered
  - Participation rate
  - Average scores
- AI-generated game summary
- Export/save game report options
- "Start New Game" button
- "Return to Lobby" button

#### Player View
**Should Display:**
- Final ranking and score
- Personal statistics:
  - Questions answered
  - Accuracy (trivia)
  - Votes received (call-and-answer)
- Top 3 leaderboard
- "Play Again" prompt

## Current Issues to Fix

1. **Call-and-Answer ASK Display**: Currently showing title prominently when it should show detail as the main question
2. **Missing End Game Screen**: No proper completion screen when all questions are finished
3. **Redundant Display**: When title and detail are same/similar, it shows duplicate content