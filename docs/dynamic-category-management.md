# Dynamic Category Management Feature

## Overview
Enable hosts to dynamically toggle categories on and off during active games, providing real-time control over question availability and game flow.

## Core Concept
Allow hosts to disable/enable specific categories during gameplay while maintaining accurate question counts and total game progress tracking.

## Key Features

### 1. Dynamic Category Toggle UI
- **Location**: Host panel during active games (STARTED, ASK, VOTE, RESULTS states)
- **Visual Design**: Category buttons show remaining question counts
- **Interactive States**:
  - ✅ **Enabled**: Green background, shows count (e.g., "History (12)")  
  - ❌ **Disabled**: Grayed out, shows count (e.g., "Science (8)" - disabled)
  - 🔄 **Active**: Currently asking question from this category (highlight)

### 2. Question Count Tracking System
- **DynamoDB Structure**: `STATE#CATS#COUNTS` record per game
- **Data Format**:
  ```javascript
  {
    PK: "GAME#12345",
    SK: "STATE#CATS#COUNTS", 
    CategoryCounts: {
      "History": 12,
      "Science": 8,
      "Technology": 15,
      "Business": 6
    },
    EnabledCategories: ["History", "Technology", "Business"], // Science disabled
    TotalEnabledQuestions: 33, // Sum of enabled categories
    LastUpdated: "2023-..."
  }
  ```

### 3. Real-Time Question Count Management
- **On Category Toggle**:
  - Update `EnabledCategories` array
  - Recalculate `TotalEnabledQuestions` 
  - Broadcast via WebSocket to all connected clients
- **On Question Asked**:
  - Decrement count for the category of the asked question
  - Update `TotalEnabledQuestions`
  - Refresh host UI progress indicators

### 4. Game Flow Integration
- **Question Selection Logic**: Only select from enabled categories
- **Progress Tracking**: Base progress on enabled questions only
- **End Game Detection**: Game ends when all enabled categories are exhausted

## Implementation Plan

### Phase 1: Data Structure & API
1. **Create `toggle-category.js` Lambda function**
   - Accept gameId, categoryName, enabled boolean
   - Update `STATE#CATS#COUNTS` record
   - Broadcast WebSocket notification

2. **Enhance existing Lambda functions**:
   - `create-game.js`: Initialize category counts from selected question set
   - `start-question.js`: Only select from enabled categories
   - `get-results.js`: Decrement category count when question completes

### Phase 2: Host UI Components
1. **Category Toggle Panel**
   ```jsx
   <div className="category-panel">
     <h4>Active Categories</h4>
     <div className="category-buttons">
       {categories.map(cat => (
         <button 
           key={cat.name}
           className={`category-btn ${cat.enabled ? 'enabled' : 'disabled'} ${cat.active ? 'current' : ''}`}
           onClick={() => toggleCategory(cat.name)}
         >
           {cat.name} ({cat.remainingQuestions})
         </button>
       ))}
     </div>
   </div>
   ```

2. **Enhanced Progress Display**
   ```jsx
   <div className="game-progress">
     <span>Questions: {currentQuestion}/{totalEnabledQuestions}</span>
     <div className="progress-bar">
       <div className="progress-fill" style={{width: `${(currentQuestion/totalEnabledQuestions)*100}%`}} />
     </div>
   </div>
   ```

### Phase 3: WebSocket Integration
1. **New WebSocket Message Types**:
   ```javascript
   // Host toggles category
   {
     type: 'categoryToggled',
     gameId: '12345',
     categoryName: 'Science',
     enabled: false,
     newTotalQuestions: 25
   }
   
   // Question asked, counts updated
   {
     type: 'categoryCountsUpdated', 
     gameId: '12345',
     categoryCounts: {...},
     totalEnabledQuestions: 24
   }
   ```

## Technical Considerations

### Database Design
- **Atomic Updates**: Use DynamoDB conditional writes to prevent race conditions
- **Efficient Queries**: Store enabled categories as array for fast lookups
- **Historical Tracking**: Consider logging category changes for analytics

### Performance Optimizations
- **Client-Side Caching**: Cache category states locally with WebSocket sync
- **Debounced Updates**: Prevent rapid toggle spam with debouncing
- **Minimal Payload**: Only send changed data in WebSocket messages

### Edge Cases & Validation
- **Minimum Categories**: Require at least 1 category enabled
- **Active Category Disable**: Handle disabling category of current question
- **Empty Categories**: Skip categories with 0 remaining questions
- **Game State Validation**: Only allow toggles during appropriate game states

## User Experience Flow

### Host Workflow
1. **Game Creation**: Categories selected with initial question counts displayed
2. **Game Start**: All selected categories enabled by default
3. **During Game**: 
   - Host sees current category counts in real-time
   - Can toggle categories on/off as needed
   - Progress bar updates based on enabled questions
4. **Question Selection**: System only picks from enabled categories
5. **Game End**: Automatic completion when all enabled questions exhausted

### Player Experience
- **Transparent**: Players see questions as normal
- **Informed**: Could optionally show active categories to players
- **Consistent**: Game flow remains unchanged from player perspective

## Future Enhancements

### Advanced Features
- **Category Weights**: Allow hosts to set probability weights for categories
- **Smart Suggestions**: AI-powered category recommendations based on engagement
- **Category Themes**: Group related categories for easier management
- **Time-Based Rules**: Auto-enable/disable categories based on time limits

### Analytics Integration
- **Category Performance**: Track which categories generate most engagement
- **Toggle Patterns**: Analyze how hosts use category management
- **Question Effectiveness**: Identify high-performing questions per category

## Implementation Timeline

### Sprint 1 (Week 1)
- Create `toggle-category.js` Lambda function
- Update DynamoDB schema and data initialization
- Basic WebSocket message handling

### Sprint 2 (Week 2) 
- Build host UI category toggle panel
- Integrate with existing game state management
- Test category enable/disable functionality

### Sprint 3 (Week 3)
- Real-time question count updates
- Progress tracking with dynamic totals
- End-to-end testing and refinement

### Sprint 4 (Week 4)
- Polish UI/UX based on testing feedback
- Performance optimization and edge case handling
- Documentation and deployment

## Success Metrics
- **Host Adoption**: % of games using category toggles
- **Engagement Impact**: Changes in player engagement when categories are managed
- **Game Duration**: Impact on average game length and completion rates
- **User Satisfaction**: Host feedback on category management utility

---

*This feature enables more dynamic and engaging game experiences by giving hosts real-time control over content delivery while maintaining accurate progress tracking and game flow.*