# CLAUDE.md - Engage2 Project Context

## Project Overview
Real-time engagement platform for strategic thinking sessions with AWS serverless architecture.

## Key Technologies
- **Frontend**: React, WebSockets, QR codes
- **Backend**: AWS Lambda (Node.js), DynamoDB, API Gateway, WebSocket API
- **Infrastructure**: SAM (Serverless Application Model), CloudFormation
- **Deployment**: Custom deploy scripts for dev/test/prod environments

## Architecture Patterns
- **Database**: Single-table DynamoDB design with partition keys like `GAME#{gameId}`, `PLAYER#{playerId}`, `GAMES`
- **Real-time**: WebSocket connections for live updates between host and players
- **Game States**: CREATED → STARTED → ASK#{questionid} → VOTE#{questionid} → RESULTS#{questionid}
- **Categories**: Bitmask system (HostMask1-8/9-16/17-24) supporting up to 24 categories per game
- **Game Lifecycle**: Create (not playable) → Start (playable) → Play

## Key Files & Directories
```
/lambda-functions/
  /websocket/          # WebSocket handlers, game creation
  /game/               # Game APIs (join, get-players, start, etc.)
  /admin/              # Admin functions (clear, AI generation)
/src/src/              # React frontend source
  GameHostPage.jsx     # Main host interface
  GamePlayerPage.jsx   # Player interface
  /components/         # Reusable components
/template-clean.yaml   # SAM infrastructure template
```

## Common Commands

### Development & Deployment
```bash
# Deploy everything (backend + frontend) to dev
./deployall

# Individual deployment scripts
./scripts/deploy-clean.sh engdev eng.dev.seibtribe.us  # Backend only
./scripts/deploy-frontend-eng.sh                      # Frontend only

# Legacy deployment (if needed)
./deploy.sh dev
./deploy.sh test

# Build only (without deploy)
sam build -t template-clean.yaml

# View logs for specific function
sam logs -n CreateGameFunction --stack-name engdev --tail

# Local development
npm start  # Frontend development server
sam local start-api  # Local API testing
```

### Database Operations
```bash
# Clear all games (dev only)
curl -X DELETE https://api.dev.domain.com/admin/clear-all-games

# Clear specific game
curl -X DELETE https://api.dev.domain.com/admin/clear-game/{gameId}
```

### Testing Commands
```bash
# Test game creation
curl -X POST https://api.dev.domain.com/games \
  -H "Content-Type: application/json" \
  -d '{"eventTitle":"Test Game","gameType":"call-and-answer","questionSetId":"amazonleadershipprinciplesfornewhires"}'

# Get game status
curl https://api.dev.domain.com/games/{gameId}?role=host

# Get players
curl https://api.dev.domain.com/games/{gameId}/players
```

## Current Issues & Recent Fixes

### Fixed Issues ✅
- Game creation infinite loop resolved
- WebSocket player join notifications implemented  
- Game start/create separation implemented
- Category bitmask restoration from database
- URL-based game loading with proper status checking

### Active Issues 🔄
- Category bitmask generation showing all zeros (debug logging added)
- Categories flashing active then deactivating (partially fixed)
- Player date formatting showing 1969 epoch dates

### Game Flow Architecture
```
Host Creates Game → Game in CREATED state (Started: false)
     ↓
Host Starts Game → Game in STARTED state (Started: true, players can join)
     ↓  
Host Begins Questions → Game states: ASK# → VOTE# → RESULTS#
```

## Development Notes

### WebSocket Integration
- Host connections stored as `GAME#{gameId}#CONNECTION#{connectionId}` with `ConnectionType: HOST`
- Player connections for real-time updates
- Automatic cleanup of stale connections (410 status codes)

### Category Management
- Categories selected via bitmask system (3 x 8-bit masks = 24 categories max)
- Frontend uses Set for activeCategoryIds, converts to array for API calls
- Backend converts selectedCategories array to bitmask for storage

### Security & Access
- Games support public/private visibility with access codes
- Players blocked from joining non-started games
- Host-only endpoints protected with role-based access

### AI Integration
- AWS Bedrock (Claude 3 Haiku) for game result summaries
- AI summaries stored in DynamoDB with caching
- Structured prompts for strategic business insights

## Environment Configuration

### API Endpoints
- **Dev**: `https://r4c24mqku1.execute-api.us-east-1.amazonaws.com/dev`
- **Test**: `https://api.test.seibtribe.us`  
- **Prod**: `https://api.seibtribe.us`

### Frontend URLs
- **Dev**: `https://eng.dev.seibtribe.us`
- **Test**: `https://eng.test.seibtribe.us`
- **Prod**: `https://eng.seibtribe.us`

## Debugging Tips

### Common Log Patterns
```bash
# Game creation issues
sam logs -n CreateGameFunction --stack-name engagedev --filter "ERROR"

# WebSocket connection issues  
sam logs -n ConnectFunction --stack-name engagedev --filter "WebSocket"

# Category bitmask debugging
sam logs -n CreateGameFunction --stack-name engagedev --filter "DEBUG.*categories"
```

### Frontend Debugging
- Game state in browser console: Check `gameState`, `activeCategoryIds`, `gameId`
- WebSocket status: Look for connection/disconnection messages
- API calls: Monitor Network tab for failed requests

### Database Debugging
```bash
# Check game exists
aws dynamodb get-item --table-name engagedev --key '{"PK":{"S":"GAME#1234"},"SK":{"S":"METADATA"}}'

# Check category state  
aws dynamodb get-item --table-name engagedev --key '{"PK":{"S":"GAME#1234"},"SK":{"S":"STATE#CATS"}}'
```

## Performance Considerations
- Single DynamoDB table with efficient query patterns
- WebSocket connections for real-time updates (no polling)
- TTL for automatic cleanup (90 days creation, 7 days active)
- Lambda cold start mitigation with connection reuse

## Recent Architecture Changes
1. **Game Lifecycle Separation**: Create vs Start operations now separate
2. **Started Flag**: Added to all game records for proper state management  
3. **Player Join Blocking**: Players cannot join non-started games
4. **Game History**: API and UI for hosts to manage multiple games
5. **Enhanced Logging**: Debug logs for troubleshooting category selection

---
*Last Updated: 2025-07-15*