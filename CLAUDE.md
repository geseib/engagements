# CLAUDE.md - Engage2 Project Context

## Project Overview
Real-time engagement platform for strategic thinking sessions with AWS serverless architecture.

## Tech Stack
- **Frontend**: React, WebSockets, QR codes
- **Backend**: AWS Lambda (Node.js), DynamoDB, API Gateway, WebSocket API
- **Infrastructure**: SAM (Serverless Application Model), CloudFormation
- **Deployment**: Custom scripts + GitHub branch-based CI/CD

## Deployment Strategy
- **Dev**: Manual deployment via `./deployall` or individual scripts
- **Test**: Auto-deploy on merge to `test` branch
- **Prod**: Auto-deploy on merge to `prod` branch
- **Flow**: `main` → `test` → `prod`

## Architecture Overview

### Database Design
- Single-table DynamoDB pattern
- Key prefixes: `GAME#`, `PLAYER#`, `GAMES`
- TTL: 90 days (creation), 7 days (active)

### Game Flow
```
Create → Start (players join) → Questions (ASK/VOTE/RESULTS) → End
```
- **Trivia**: ASK → RESULTS (no voting)
- **Polls**: ASK → VOTE → RESULTS

### Real-time Features
- WebSocket connections for live updates
- Host/player synchronization
- Automatic stale connection cleanup

### Category System
- Bitmask implementation (3×8 bits = 24 categories)
- Stored as HostMask1/2/3 in database
- Frontend uses Set for active categories

## Project Structure
```
/lambda-functions/
  /websocket/          # WebSocket handlers
  /game/               # Game APIs
  /admin/              # Admin functions, AI generation
/src/src/              # React frontend
  GameHostPage.jsx     # Host interface
  GamePlayerPage.jsx   # Player interface
  /components/         # Reusable UI components
/template-clean.yaml   # SAM infrastructure
```

## Common Commands

### Development
```bash
# Deploy all (backend + frontend)
./deployall

# Deploy backend only
./scripts/deploy-clean.sh engdev eng.dev.seibtribe.us

# Deploy frontend only
./scripts/deploy-frontend-eng.sh

# Local development
npm start              # Frontend dev server
sam local start-api    # Local API testing

# Debugging
sam logs -n [FunctionName] --stack-name engdev --tail
```

### Testing
```bash
# Create game
curl -X POST https://api.dev.domain.com/games \
  -H "Content-Type: application/json" \
  -d '{"eventTitle":"Test","gameType":"trivia","questionSetId":"tech"}'

# Get game state
curl https://api.dev.domain.com/games/{gameId}?role=host

# Clear games (dev only)
curl -X DELETE https://api.dev.domain.com/admin/clear-all-games
```

## Environment URLs
| Environment | API | Frontend |
|------------|-----|----------|
| Dev | https://r4c24mqku1.execute-api.us-east-1.amazonaws.com/dev | https://eng.dev.seibtribe.us |
| Test | https://api.test.seibtribe.us | https://eng.test.seibtribe.us |
| Prod | https://api.seibtribe.us | https://eng.seibtribe.us |

## AI Integration
- AWS Bedrock (Claude 3 Haiku) for result summaries
- Prompt generation and customization via admin UI
- GitHub issue creation for feedback

## Question Formats

### Trivia Questions
```javascript
{
  id: timestamp,
  title: "Short title",
  questionDetail: "Full question text",
  category: "Category",
  optionA-D: "Answer choices",
  correctAnswer: "OptionA", // Must be OptionA/B/C/D
  answerDetails: "Explanation",
  difficulty: "easy|medium|hard"
}
```

### Poll Questions
```javascript
{
  id: timestamp,
  title: "Question/prompt",
  detail: "Background context",
  category: "Category",
  customInstructions: "Response guidance"
}
```

## Active Issues
- Category bitmask showing zeros (debug logging added)
- Categories flashing then deactivating
- Player dates showing 1969 epoch time

## Data Flow Pattern
1. **Action**: Host triggers via HTTP API
2. **Persist**: API updates DynamoDB
3. **Notify**: WebSocket broadcasts to clients
4. **Refresh**: Clients fetch fresh data via HTTP

## Performance Notes
- Connection pooling for DynamoDB
- Request deduplication for rapid calls
- Question data caching in component state
- WebSocket notification batching

---
*Last Updated: 2025-07-28*