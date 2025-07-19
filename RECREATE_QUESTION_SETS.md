# Question Set Recreation Guide

## Issue
The existing question sets were created with incorrect numbering system:
- **Old (incorrect)**: QUESTION#C001#001, QUESTION#C001#002, QUESTION#C002#003, QUESTION#C002#004
- **New (correct)**: QUESTION#C001#001, QUESTION#C001#002, QUESTION#C002#001, QUESTION#C002#002

The upload function has been fixed to use category-relative numbering, but existing sets need to be deleted and recreated.

## Current Question Sets (Need to be recreated)

1. **Amazon Leadership Principles for new hires** (ID: amazonleadershipprinciplesfornewhires)
   - 5 questions, 5 categories
   - Type: call-and-answer

2. **Greatest Hits** (ID: greatesthits)
   - 10 questions, 8 categories  
   - Type: call-and-answer

3. **Lessons from School** (ID: lessonsfromschool)
   - 80 questions, 8 categories
   - Type: call-and-answer

4. **template-pbod** (ID: templatepbod)
   - 15 questions, 15 categories
   - Type: call-and-answer

## Steps to Fix

### 1. Delete Existing Question Sets
```bash
# Delete each question set by ID
curl -X DELETE "https://h1jcmja0w1.execute-api.us-east-1.amazonaws.com/dev/admin/question-sets/amazonleadershipprinciplesfornewhires"
curl -X DELETE "https://h1jcmja0w1.execute-api.us-east-1.amazonaws.com/dev/admin/question-sets/greatesthits"
curl -X DELETE "https://h1jcmja0w1.execute-api.us-east-1.amazonaws.com/dev/admin/question-sets/lessonsfromschool"
curl -X DELETE "https://h1jcmja0w1.execute-api.us-east-1.amazonaws.com/dev/admin/question-sets/templatepbod"
```

### 2. Re-upload Question Sets
You'll need to re-upload each question set using the admin interface. The upload function now correctly implements category-relative numbering:

```javascript
// Fixed code in upload-questions.js (lines 244-245)
const categoryRelativeNumber = String(questionIndex + 1).padStart(3, '0'); // Start from 001 for each category
const questionId = `QUESTION#${categoryId}#${categoryRelativeNumber}`;
```

### 3. Verify Correct Numbering
After re-upload, verify that questions are numbered correctly:
- Category 1: QUESTION#c001#001, QUESTION#c001#002, etc.
- Category 2: QUESTION#c002#001, QUESTION#c002#002, etc.

## Test Commands

### Delete all question sets:
```bash
# Delete Amazon Leadership Principles
curl -X DELETE "https://h1jcmja0w1.execute-api.us-east-1.amazonaws.com/dev/admin/question-sets/amazonleadershipprinciplesfornewhires"

# Delete Greatest Hits
curl -X DELETE "https://h1jcmja0w1.execute-api.us-east-1.amazonaws.com/dev/admin/question-sets/greatesthits"

# Delete Lessons from School
curl -X DELETE "https://h1jcmja0w1.execute-api.us-east-1.amazonaws.com/dev/admin/question-sets/lessonsfromschool"

# Delete template-pbod
curl -X DELETE "https://h1jcmja0w1.execute-api.us-east-1.amazonaws.com/dev/admin/question-sets/templatepbod"
```

### Verify deletion:
```bash
curl -s "https://h1jcmja0w1.execute-api.us-east-1.amazonaws.com/dev/admin/question-sets" | jq '.questionSets'
```

After deletion, you can re-upload the question sets through the admin interface, and they will use the correct category-relative numbering system.

## Why This Fixes the Issue

The updated upload function:
1. Groups questions by category
2. Assigns category-relative numbers starting from 001 for each category
3. Creates question IDs in the format: `QUESTION#c001#001`, `QUESTION#c001#002`, `QUESTION#c002#001`, etc.

This ensures that the question flow system will work correctly with the QUESTION#REF records that reference these source questions.