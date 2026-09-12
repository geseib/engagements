# Enhanced Category Management with Bitmasks

## Overview

This document extends the DATABASE_DESIGN.md category management with enhanced bitmask-based category tracking, question ordering, and completion detection.

## Bitmask Category System

### Category Bitmask Values
```
Category 1: 1    (binary: 00000001)
Category 2: 2    (binary: 00000010) 
Category 3: 4    (binary: 00000100)
Category 4: 8    (binary: 00001000)
Category 5: 16   (binary: 00010000)
Category 6: 32   (binary: 00100000)
Category 7: 64   (binary: 01000000)
Category 8: 128  (binary: 10000000)
```

### Database Schema

#### Category State Management
```
PK: GAME#1234
SK: STATE#CATS
Attributes:
  HostMask1-8: "11110000"      // Categories 1-4 selected by host
  AvailMask1-8: "11111111"     // Categories 1-8 available in question set
  CompletedMask1-8: "00010000" // Category 5 completed
  HostMask9-16: "00000000"     // Categories 9-16 (future expansion)
  AvailMask9-16: "00000000"
  CompletedMask9-16: "00000000"
  UpdatedAt: ISO timestamp
  TTL: expiration
```

#### Category Metadata
```
PK: GAME#1234
SK: CAT#METADATA
Attributes:
  CategoryMap: {
    "1": "Leadership",
    "2": "Innovation", 
    "4": "Agile Practices",
    "8": "Communication"
  }
  TotalCategories: 4
  SelectedCount: 4
  CompletedCount: 1
  UpdatedAt: ISO timestamp
  TTL: expiration
```

#### Category Question Order (per category)
```
PK: GAME#1234
SK: CAT#001#ORDER
Attributes:
  CategoryBitmask: 1           // Which category this represents
  CategoryName: "Leadership"
  IsRandom: true
  QuestionOrder: [3,7,1,5,2,8,4,6]  // Randomized question sequence
  TotalQuestions: 8
  CreatedAt: ISO timestamp
  TTL: expiration
```

#### Category Active State (per category)
```
PK: GAME#1234
SK: CAT#001#ACTIVE
Attributes:
  CategoryBitmask: 1           // Which category this represents
  CategoryName: "Leadership"
  QuestionCount: 8             // Total questions in category
  ActiveIndex: 3               // Current position in QuestionOrder array
  QuestionsUsed: 3             // Number of questions used from this category
  RemainingQuestions: 5        // Calculated: QuestionCount - QuestionsUsed
  CompletedAt: null            // Timestamp when category completed
  LastQuestionAt: ISO timestamp
  TTL: expiration
```

## Category Management Functions

### Bitmask Operations
```javascript
// Check if category is selected by host
const isCategorySelected = (hostMask, categoryBitmask) => {
  return (hostMask & categoryBitmask) !== 0;
};

// Check if category is completed
const isCategoryCompleted = (completedMask, categoryBitmask) => {
  return (completedMask & categoryBitmask) !== 0;
};

// Mark category as completed
const markCategoryCompleted = (completedMask, categoryBitmask) => {
  return completedMask | categoryBitmask;
};

// Get available categories (selected but not completed)
const getAvailableCategories = (hostMask, completedMask) => {
  return hostMask & (~completedMask);
};

// Check if game is complete (all selected categories completed)
const isGameComplete = (hostMask, completedMask) => {
  return (hostMask & completedMask) === hostMask;
};
```

### Question Selection Logic
```javascript
// Get next question from category
const getNextQuestionFromCategory = async (gameId, categoryBitmask) => {
  // 1. Get category order and active state
  const [orderData, activeData] = await Promise.all([
    getCategoryOrder(gameId, categoryBitmask),
    getCategoryActive(gameId, categoryBitmask)
  ]);
  
  // 2. Check if category is exhausted
  if (activeData.ActiveIndex >= orderData.QuestionOrder.length) {
    return null; // Category completed
  }
  
  // 3. Get next question number
  const questionNumber = orderData.IsRandom 
    ? orderData.QuestionOrder[activeData.ActiveIndex]
    : activeData.ActiveIndex + 1;
    
  // 4. Increment active index
  await updateCategoryActiveIndex(gameId, categoryBitmask, activeData.ActiveIndex + 1);
  
  return questionNumber;
};

// Select next category using round-robin or priority
const selectNextCategory = async (gameId) => {
  const catsState = await getCategoryState(gameId);
  const availableCategories = getAvailableCategories(
    parseInt(catsState.HostMask1_8, 2), 
    parseInt(catsState.CompletedMask1_8, 2)
  );
  
  if (availableCategories === 0) {
    return null; // Game complete
  }
  
  // Get lowest bit (round-robin style)
  return availableCategories & (-availableCategories);
};
```

### Category Completion Detection
```javascript
// Check and mark category completion
const checkCategoryCompletion = async (gameId, categoryBitmask) => {
  const activeData = await getCategoryActive(gameId, categoryBitmask);
  const orderData = await getCategoryOrder(gameId, categoryBitmask);
  
  if (activeData.ActiveIndex >= orderData.QuestionOrder.length) {
    // Category is completed
    await markCategoryCompleted(gameId, categoryBitmask);
    
    // Broadcast category completion
    await broadcastToGame(gameId, {
      type: 'categoryCompleted',
      categoryName: activeData.CategoryName,
      categoryBitmask: categoryBitmask,
      timestamp: new Date().toISOString()
    });
    
    // Check if game is complete
    const isComplete = await checkGameCompletion(gameId);
    if (isComplete) {
      await broadcastToGame(gameId, {
        type: 'gameCompleted',
        timestamp: new Date().toISOString()
      });
    }
    
    return true;
  }
  
  return false;
};
```

## Integration with Clean State Management

### Enhanced Host States
```
LOBBY → ASK/Q001/CAT1 → VOTE/Q001/CAT1 → RESULTS/Q001/CAT1 → ASK/Q002/CAT2 → ... → END
```

### Category Progress Tracking
```javascript
// Enhanced game state with category info
const gameState = {
  hostState: "ASK/Q003/CAT1",
  currentQuestionId: "Q003",
  currentCategory: {
    bitmask: 1,
    name: "Leadership", 
    questionNumber: 3,
    totalQuestions: 8,
    remaining: 5
  },
  categoryProgress: {
    "Leadership": { used: 3, total: 8, completed: false },
    "Innovation": { used: 2, total: 6, completed: false },
    "Agile": { used: 0, total: 4, completed: false }
  },
  gameProgress: {
    totalQuestions: 18,
    questionsUsed: 5,
    categoriesCompleted: 0,
    categoriesTotal: 3
  }
};
```

## Benefits of Enhanced Design

1. **Efficient Category Operations**: Bitmask operations are very fast
2. **Scalable**: Supports up to 64 categories with current design
3. **Real-time Progress**: Always know category and game completion status
4. **Flexible Question Order**: Supports both random and sequential ordering
5. **Clean State Integration**: Works seamlessly with clean state management
6. **UI-Friendly**: Provides all data needed for progress indicators
7. **Completion Detection**: Automatic detection of category and game completion

This enhanced design maintains your elegant bitmask approach while adding the missing pieces for comprehensive category and question management.
