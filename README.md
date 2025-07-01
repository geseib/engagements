# Engagements 
Engagements is a interactive meeting toolset for making meeting, offsites, and training more enagaging with fun exercies, trivia, AI involvement, and documentation. 

# How it works
Host signup to get a event pass so they can create multiple engagements for their event. Host select the engagement type: Poll, Survey, Call and Answer (Lessons Learned, Solutioning, Direction narrative), Prioritizations, Triva Game, Bingo.
Question/trivia/polls are provided in three ways 1:system provided(public), system add-ons (theme based), host provided (private based on their login)


# Components
- Admin (requires login) Super Admin can change public and system-addons
  - Engagment Sets  
    - List engagementSets Question/Trivia/Poll Sets/Surveys by catagory 
    - Manage EngagementSets (add, delete, modify) Super can manage 
      - Add by upload csv, enter manually, AI Generated based on background info)
    - Download Template CSV (by engagement type)
  - Super Admin only: Remove games
    - radio: Single Game, All Games
    - Dialog box: Enter Game ID (only for Single game)
  - Super Admin only: Add/Remove host
    - Add host by name, email (generate passwors and notify them,)

- Host (requires login) This is the main display for engagement shared via zoom or projection video usually
  - Main screen 
    - Cool Parallex banner
    - Title of the Engagement 
    - Partipant cards (Name, scores if applicable. place (1st,2nd,3rd and order by if scoring status [waiting for reply/submitted reply)])
    - Question/Lesson 
        - Title
        - Detail
        - instructions
    - Next step button (changes with context: First question, vote, results, Next question)
    - skip question button
- Right Panel (Admin) with two columns
  - Join IN
    - [GAME ID]
    - Players can join in at: [url for this gameID] clicking url will copy to clipboard
    - QR Code with URL to GAMEID
    - View Report button
    - Switch Game button
  - Engagement SET Name
    - number of questions left/total questions
    - Catagories (clickable buttons to enable/disable with catagory name and number of questions left)
- Left Panel
  - Title of the engagement type (Poll. Lesson Learned, Survey)
    - How to Play/Instructions

# Enagagement Types
## Polls - no catagories
Host can ask for input on various topics and the information could be tallked and shared with the partipants. (ie. what cuisine should we order tomorrow: Chinese, Pizza, Mexican, sandwiches)
Each question in question set has
- title
- detail question
- number of expected selections by each particiapnt (1+)
- list of choices
Polls go one by one back and forth between the host screen and the partipants screen (where they answer)
Option when selecting this is Random order

## Survey - no catagories
Host can create surveys that have rating and free form feedback. The ratings items would be tallyed and a report generated
Items types Rate 1-5: Radio button also will have a question (ie Rate the Speaker's Knowledge)
Item type Free form dialog with a question (i.e. what would you like to see added to this session)
All items are given to the partipants screen to submit at once
Results are only shared if the host chooses to via the report button

## Prioritization - no catagories
Host provides a list of items that the partipants can rank the priority and submit
The reults are shared after the host click results button 

## Call and Answer (vote)
Host selects a questionb set with catagores, if they are to be randomized or not. Name the engagement and provide Details of the event, goals of this engagment, AI enable toggle w/ AI extra instructions. if there is only one response/particpant, no vote should be triggered instead just go to results and provide AI (if enabled)
-types
  - Lessons learned: where they are given some scenario/lesson and the partipants respond with how they could adapt this lesson to the task at hand for the engagement event. partipants vote on best response. Ai summerizes and provides insight
  - Solutioning: where they are given a problem and the partipants respond with an approach or a solution. Vote for best answers
  - Interview: Where they can practice interview questions and respond as if they were being interviewed. Vote on best responses. 
- Report will list all questions the answers marking the top 3 answers (they should be first in the report). Current score/Final score of the top three players. if tied skip to the next place. ie. Joe 1st (tied), Sam 1st(tied), Sue 3rd

## Trivia
Host selects a questionb set with catagores, if they are to be randomized or not, time per question. Name the engagement and provide Details of the event.
 - questions are presented with their choices on the main screen and the partipants screen. They are told to pick best answer or x number of answers (i.e choose 2)
 - Results will show those that got it right and add up their scores for the round. . person results will show up in partipants screen only after host clicks results. Also results will show percent of answers for each answer even the worng ones. 
 -Report will list all questions the choices with the percentages answerd marking the correct answer. Current score/Final score of the top three players. if tied skip to the next place. ie. Joe 1st (tied), Sam 1st(tied), Sue 3rd