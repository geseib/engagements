# Enhanced Lessons Learned AI Prompt

**Name**: Enhanced Lessons Learned  
**Category**: lessons-learned  
**Game Type**: callandanswer  
**Status**: active  
**Default**: true  

## Template

You are analyzing strategic session results to extract actionable insights and lessons learned.

## Context
- **Event**: {eventTitle}
- **Question Set**: {questionSetName} 
- **Session Context**: {aiContext}
- **Custom Instructions**: {customInstructions}
- **Question**: {questionTitle}
- **Question Detail**: {questionDetail}

## Participant Engagement
- **Total Participants**: {totalParticipants}
- **Active Participants**: {activeParticipants}
- **Response Rate**: {responseRate}%

## Question Results
- **Top Ranked Answer**: {winnerName}: "{winnerResponse}" ({winnerPoints} points)
- **All Responses**: {responsesText}
- **Voting Results**: {totalVotes} total votes cast
- **Consensus Level**: {consensusLevel}

## Leadership Insights
Based on the responses to "{questionTitle}", here are the key strategic insights:

### Strategic Themes Identified
{analysisPrompt}

### Top Response Analysis
The winning response "{winnerResponse}" by {winnerName} received {winnerPoints} points, indicating strong alignment with the group's strategic thinking.

### Consensus Patterns
With a {consensusLevel} consensus level from {totalVotes} votes, this reveals important patterns about team alignment and decision-making preferences.

### Key Lessons Learned
1. **Strategic Priority**: What does the top response tell us about organizational priorities?
2. **Team Alignment**: How does the voting pattern reflect leadership consensus?
3. **Implementation Focus**: What specific actions emerge from these insights?

### Recommended Next Steps
1. **Immediate Actions** (Next 30 days):
   - Address the core theme from the winning response
   - Gather additional input on high-scoring alternatives

2. **Strategic Planning** (Next 90 days):
   - Integrate insights into quarterly planning
   - Develop implementation roadmap for top priorities

3. **Follow-up Questions** for deeper exploration:
   - What resources are needed to implement the winning approach?
   - How do these insights align with current strategic initiatives?
   - What barriers might prevent successful implementation?

### Discussion Starters
- "The group strongly favored '{winnerResponse}' - what does this tell us about our strategic direction?"
- "With {activeParticipants} people engaged and {consensusLevel} consensus, how should we move forward?"
- "What would successful implementation of these insights look like in 6 months?"

---
*Generated from strategic session data with {totalVotes} participant votes*