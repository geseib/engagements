/**
 * THE FOUR PLAYER GUIDES — the ones that had no content and, until this change,
 * no way to reach them either.
 *
 * `HelpButton` was mounted in exactly one place: `AdminPage`. So the audience
 * furthest from the codebase, on the smallest screen, with the least context,
 * had a documentation set written for them in the table of contents and no door
 * into it anywhere in the product.
 *
 * Written for someone holding a phone mid-session, so: short sentences, the
 * words that are actually on their screen, and the answer before the
 * explanation. Nobody reads help for pleasure while forty people wait.
 */

const gettingStarted = {
  id: 'player-getting-started',
  title: 'Getting started',
  icon: 'RocketLaunch',
  summary: 'What this is, and what you need. Which is almost nothing.',
  sections: [
    {
      id: 'what-you-need',
      title: 'What you need',
      icon: 'DeviceMobile',
      blocks: [
        {
          t: 'features',
          items: [
            { icon: 'DeviceMobile', title: 'Any device', text: 'Phone, tablet or laptop. Whatever is in your hand.' },
            { icon: 'LinkSimple', title: 'A link or a code', text: 'Scan the QR the host puts up, or type the four digits.' },
            { icon: 'UserCircle', title: 'No account', text: 'Players never sign in. Only hosts and admins do.' },
            { icon: 'Broadcast', title: 'A network', text: 'Anything that loads a web page will do.' },
          ],
        },
        {
          t: 'p',
          text: 'You do not install anything and you do not register. The host puts a QR code on the screen, you scan it, you type a name, and you are in.',
        },
      ],
    },
    {
      id: 'session-looks-like',
      title: 'What a session looks like',
      icon: 'GameController',
      blocks: [
        {
          t: 'p',
          text: 'The host drives. Your screen follows theirs — when they move the room on, your screen changes by itself. You never have to refresh, and there is no "next" button for you to miss.',
        },
        {
          t: 'steps',
          items: [
            { title: 'A question appears', text: 'Type an answer, pick an option, or place a word — depending on the kind of session.' },
            { title: 'Everyone answers', text: 'The host sees how many people are done. Their own screen may also show the answers as they come in, usually without names.' },
            { title: 'Sometimes the room votes', text: 'On Call & Answer rounds you rank the room\'s answers. Not on trivia, polls or wavelength.' },
            { title: 'Results', text: 'Scores, the best answers, and a summary the AI wrote from what the room said.' },
          ],
        },
        { t: 'gameTypes' },
      ],
    },
    {
      id: 'who-sees-your-name',
      title: 'Who sees your name',
      icon: 'EyeSlash',
      blocks: [
        {
          t: 'p',
          text: 'Your name is on the scoreboard, and it is how you get back in if you lose the page. On rounds where the room votes, your name is not shown next to your answer until voting closes — so people vote on the answer rather than on who wrote it.',
        },
        {
          t: 'note',
          tone: 'info',
          title: 'The host can always see the roster',
          text: 'The host sees who is in the room and who has answered, because they have to know whether to wait. What they do not see mid-round is which answer is yours.',
        },
      ],
    },
  ],
};

const joining = {
  id: 'player-joining',
  title: 'Joining a session',
  icon: 'UsersThree',
  summary: 'Getting in, getting back in, and what to do when your name is taken.',
  sections: [
    {
      id: 'getting-in',
      title: 'Getting in',
      icon: 'MapPin',
      blocks: [
        {
          t: 'steps',
          items: [
            { title: 'Scan the QR code', text: 'It is on the host\'s screen. Your camera app will offer the link.' },
            { title: 'Or type the code', text: 'Four digits, under the QR, labelled Session code. There are no letters in it.' },
            { title: 'Type your name', text: 'Whatever the room will recognise you by.' },
            { title: 'Join', text: 'Press **Join Game**. That is the whole of it. No password, no email, no account.' },
          ],
        },
        {
          t: 'note',
          tone: 'tip',
          title: 'Joining late is fine',
          text: 'You can join after the session has started. You will not see the rounds you missed, but you play every round from here on and you appear on the scoreboard straight away.',
        },
      ],
    },
    {
      id: 'lost-the-page',
      title: 'If you lose the page',
      icon: 'ArrowsClockwise',
      blocks: [
        /*
          The session knows a player by this browser (components/joinResult.js
          getClientId), not by name alone. Same browser: PlayerPage's "Welcome
          back." prompt with "Rejoin as {name}". Another device: join-game.js
          answers NAME_TAKEN. "Are you the Sam already here?" is only for
          sessions older than identity stamping (JoinNameCollision.jsx header).
        */
        {
          t: 'p',
          text: 'Reopen the link on the same phone and browser. Your screen says "Welcome back." Tap **Rejoin as** your name, and your answers and points come back with you. The session knows you by this browser, not by your name alone.',
        },
        {
          t: 'p',
          text: 'On a different phone or browser, the same name gets "That name is taken". Ask the host to hand it over (below).',
        },
        {
          t: 'p',
          text: 'Now and then the site asks "Are you the Sam already here?" instead. Answer honestly: "Yes — rejoin as Sam" picks your history back up.',
        },
      ],
    },
    {
      /*
        THE FEATURE SHIPPED TODAY, AND THE ONE PLAYERS WILL HIT COLD. The
        buttons are quoted exactly as `JoinNameCollision.jsx` renders them,
        because a player reading this is looking at those buttons right now.
      */
      id: 'name-taken',
      title: 'When your name is taken',
      icon: 'Lock',
      blocks: [
        {
          t: 'p',
          text: 'If the site says "That name is taken", another device is already in the session under that name. It will not simply let you in as them — that would throw away whatever the first person has done.',
        },
        { t: 'h', text: 'You have two ways forward' },
        {
          t: 'list',
          items: [
            { title: 'Pick a different name', text: 'The right answer when you and someone else happened to choose the same name. Add a surname or an initial and carry on.' },
            { title: 'Ask the host to hand it over', text: 'The right answer when the name is genuinely yours — you swapped phones, or your browser lost the page and will not let you back in.' },
          ],
        },
        { t: 'h', text: 'What happens when you ask' },
        {
          t: 'steps',
          items: [
            'You tap **Ask the host to hand it over**.',
            'The host sees "asking to take this name" beside that name on their Players tab.',
            'They say yes — usually after you have said something out loud in the room.',
            'Your button becomes **Take over the name**. Tap it and you are in, with the history that name has built up.',
          ],
        },
        {
          t: 'note',
          tone: 'warn',
          title: 'The host has to open it, every time',
          text: 'The unlock is good for one handover and then closes again. If you need to do it a second time — another device, another browser — you ask again. That is deliberate: it means nobody can quietly walk into somebody else\'s name.',
        },
      ],
    },
    {
      id: 'other-things-join-screen',
      title: 'Other things the join screen might say',
      icon: 'Warning',
      blocks: [
        {
          t: 'faq',
          items: [
            /*
              Wording from lambda-functions/game/session-gate.js (not started:
              403 message; not found: 404 "Game not found"), JoinCodeEntry.jsx:63
              (/join), and PlayerPage's offline banner. The gate never refuses an
              ended session: the player gets in and sees the closing screen.
            */
            { q: 'This game has not been started yet', a: 'The host has created the session but not started it. Wait until they do, then press **Join Game** again.' },
            { q: 'Game not found, or Nothing is running under…', a: 'Check the four digits against the room\'s screen. It is easy to read a 0 as an 8 across a room.' },
            { q: 'Offline. Reconnecting.', a: 'Your connection dropped. The page catches up on its own when it comes back. You do not need to refresh, and refreshing would lose anything you typed but did not send.' },
            { q: 'The session has already ended', a: 'You can still get in. You land on its closing screen.' },
          ],
        },
      ],
    },
  ],
};

const playing = {
  id: 'player-playing',
  title: 'Playing',
  icon: 'Play',
  summary: 'Answering, voting, and reading long answers on a small screen.',
  sections: [
    {
      id: 'answering',
      title: 'Answering',
      icon: 'ChatCircleText',
      blocks: [
        {
          t: 'p',
          text: 'What you get depends on what kind of session the host is running.',
        },
        {
          t: 'list',
          items: [
            { title: 'Call & Answer', text: 'A text box. Write as much or as little as you like — the interesting answers are usually not the shortest.' },
            { title: 'Trivia', text: 'Usually four options, up to six. Pick one. There is a right answer and you will see it at the end of the round.' },
            { title: 'Poll', text: 'One question: pick an option, give a rating, say yes or no, or write a short answer. There is no right answer; the room\'s result goes up on the main screen.' },
            { title: 'Wavelength', text: 'Up to ten words. A word counts only when everyone says it, so pick the obvious ones. The result shows the words the room shared.' },
            { title: 'Survey', text: 'Several questions you answer at your own pace, then send. You can go back and change your answers until the host closes the survey.' },
            { title: 'Build Room', text: 'The room builds an app with the host\'s Claude: suggest ideas, choose between options, rate. Open the demo opens the app itself, on the room\'s Wi-Fi, or from anywhere when the host has opened it to people who are not there. That button is yours alone; if the host removes you, it stops working. History marks what reached Claude, and when the host changed the room\'s words it shows what Claude got and why; your own ideas say yours. It never shows who sent anything.' },
          ],
        },
        /*
          Answers lock on submit: PlayerPage's receipt says "This is locked for
          the round." Only an answer held while offline ("Waiting for the
          connection.") can still be changed, with "Change my answer".
        */
        {
          t: 'note',
          tone: 'tip',
          title: 'Your answer is locked once you submit',
          text: 'If you were offline when you pressed submit, your screen says "Waiting for the connection." and offers **Change my answer** until it sends.',
        },
        {
          t: 'p',
          text: 'Your screen then shows what you sent. Reloading the page or locking your phone does not lose it.',
        },
        {
          t: 'note',
          tone: 'info',
          title: 'Answering late',
          text: 'If the round moves on before your answer arrives, it is still kept with that round and your screen says "Kept, but late." If voting has already started, a late answer is kept for the record but is not in the vote. Still writing when voting starts? Your screen offers "Send it anyway".',
        },
        {
          t: 'note',
          tone: 'info',
          title: 'A question for the room, and comments, after the moment',
          text: 'Answer a question for the room after the host has shown its results and it is still kept: your screen says "The results are already up. Your answer is kept, but not in the count." Once a round\'s results have been shown you can keep commenting on it, marked as added later, until 24 hours after the session ends or the host closes comments. After the end, the closing screen lists the rounds under "Something to add?"; opening one shows its question, its responses and Workie\'s read, or says nobody responded. Your final score and standing stay on the closing screen, even if you reload or rejoin. A Rate question shows what its two ends mean, for example 1 Disagree to 5 Agree.',
        },
      ],
    },
    {
      id: 'held-back',
      title: 'Some rounds hold something back',
      icon: 'EyeSlash',
      blocks: [
        {
          t: 'p',
          text: 'On some rounds the question deliberately withholds a detail — the real title of the painting, the actual figure, what really happened next — and reveals it only after you have committed to an answer.',
        },
        {
          t: 'p',
          text: 'That is not the site being slow. It is the round working as intended: your answer is worth more when it was not shaped by the thing you were guessing at. You get the withheld detail in the results, alongside what the AI made of what the room said.',
        },
      ],
    },
    {
      id: 'voting',
      title: 'Voting',
      icon: 'Medal',
      blocks: [
        {
          t: 'p',
          text: 'On Call & Answer rounds, once the host opens voting the room ranks the answers. Your own answer is marked "Yours", and you may rank it like any other.',
        },
        { t: 'h', text: 'Two ways to do it' },
        {
          t: 'list',
          items: [
            { title: 'Quick Vote', text: 'Three dropdowns — first, second, third. Fastest if you already know what you liked.' },
            { title: 'Detailed Vote', text: 'The answers laid out in full, and you tap to rank them. Better when you want to actually read them.' },
          ],
        },
        {
          t: 'p',
          text: 'You can switch between the two and change your ranking as often as you like until you press **Submit Votes**. After that your ballot is locked for the round.',
        },
      ],
    },
    {
      id: 'reading-long-answer',
      title: 'Reading a long answer',
      icon: 'MagnifyingGlass',
      blocks: [
        {
          t: 'p',
          text: 'On the **Detailed Vote** ballot, tap an answer\'s text or **Show all** to open it full-screen. Then use Previous and Next to walk through the rest without going back to the list each time.',
        },
        {
          t: 'keys',
          items: [
            { keys: '← →', text: 'Previous and next answer.' },
            { keys: 'Esc', text: 'Close and go back to the list.' },
          ],
        },
        {
          t: 'p',
          text: 'On a phone, tapping outside the answer closes it too.',
        },
      ],
    },
  ],
};

const scoring = {
  id: 'player-scoring',
  title: 'Scoring',
  icon: 'Trophy',
  summary: 'Where points come from, and why the scoreboard moved.',
  sections: [
    {
      id: 'points-earned',
      title: 'How points are earned',
      icon: 'Medal',
      blocks: [
        {
          t: 'p',
          text: 'Only Trivia and Call & Answer score.',
        },
        {
          t: 'table',
          head: ['Round', 'Where points come from'],
          rows: [
            ['Call & Answer', 'Votes from the room: 3 points for each first-place vote, 2 for second, 1 for third.'],
            ['Trivia', 'Getting it right, plus a speed bonus of up to 5 points: the faster a right answer, the bigger it is.'],
            ['Poll', 'None. A poll counts opinions; nobody scores.'],
            ['Wavelength', 'None. The result shows which words the room landed on together.'],
            ['Survey', 'None.'],
          ],
        },
        {
          t: 'note',
          tone: 'info',
          title: 'Your own answer is on the ballot',
          text: 'It is marked Yours, and you can rank it like any other. Points on a voted round come from how the room ranks your answer, which is why names stay hidden while the vote is open.',
        },
      ],
    },
    {
      id: 'scoreboard',
      title: 'The scoreboard',
      icon: 'ChartLineUp',
      blocks: [
        {
          t: 'p',
          text: 'The scoreboard is cumulative across the whole session, and it updates at the end of each round rather than continuously — so a round in progress does not tip off the room about who is winning it.',
        },
        {
          t: 'faq',
          items: [
            {
              q: 'I joined late. Am I out of it?',
              a: 'You start from zero on the round you joined. You cannot pick up points for rounds that happened before you arrived, but nothing is deducted either.',
            },
            {
              q: 'I dropped out and came back. Did I lose my points?',
              a: 'No. Rejoin from the same phone and browser and your score comes back with you. On another device, ask the host to hand your name over.',
            },
            {
              q: 'The host removed me from the list. Did that wipe my score?',
              a: 'No. Removing someone takes them out of the live count so the room is not waiting on a person who has left. Everything they answered and every point they scored stays in the results and in the report.',
            },
            {
              q: 'Why did my answer get no points?',
              a: 'On a voted round, points come from other people ranking you in their top three. A good answer that nobody put in their top three scores nothing — it is a ranking, not a rating.',
            },
          ],
        },
      ],
    },
  ],
};

/**
 * The player area. Assembled into roles by ./index.js (ROLE_AREAS); see
 * docs/help-refresh/STRUCTURE.md for the map and the conventions.
 */
export const AREA = {
  id: 'player',
  guides: { player: [gettingStarted, joining, playing, scoring] },
};
