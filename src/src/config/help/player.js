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
      title: 'What you need',
      icon: 'DeviceMobile',
      blocks: [
        {
          t: 'features',
          items: [
            { icon: 'DeviceMobile', title: 'Any device', text: 'Phone, tablet or laptop. Whatever is in your hand.' },
            { icon: 'LinkSimple', title: 'A link or a code', text: 'Scan the QR on the big screen, or type the four digits.' },
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
            { title: 'Everyone answers', text: 'The host can see how many people are done, but not what you wrote, until the round closes.' },
            { title: 'Sometimes the room votes', text: 'On open-answer rounds you rank other people\'s answers. Not on trivia.' },
            { title: 'Results', text: 'Scores, the best answers, and a summary the AI wrote from what the room said.' },
          ],
        },
        { t: 'gameTypes' },
      ],
    },
    {
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
      title: 'Getting in',
      icon: 'MapPin',
      blocks: [
        {
          t: 'steps',
          items: [
            { title: 'Scan the QR code', text: 'It is on the host\'s screen. Your camera app will offer the link.' },
            { title: 'Or type the code', text: 'Four digits, shown next to the QR. There are no letters in it.' },
            { title: 'Type your name', text: 'Whatever the room will recognise you by.' },
            { title: 'Join', text: 'That is the whole of it. No password, no email, no account.' },
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
      title: 'If you lose the page',
      icon: 'ArrowsClockwise',
      blocks: [
        {
          t: 'p',
          text: 'Reopen the link and enter the same name. Your answers and your points are still there — the session remembers you by name, not by browser tab.',
        },
        {
          t: 'p',
          text: 'If the site asks "Are you the Sam already here?", that is this exact case: it cannot tell whether you are the same Sam coming back or a second Sam. Answer honestly. "Yes — rejoin as Sam" picks your history back up.',
        },
      ],
    },
    {
      /*
        THE FEATURE SHIPPED TODAY, AND THE ONE PLAYERS WILL HIT COLD. The
        buttons are quoted exactly as `JoinNameCollision.jsx` renders them,
        because a player reading this is looking at those buttons right now.
      */
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
            'You tap "Ask the host to hand it over".',
            'The host sees "asking to take this name" beside that name on their Players tab.',
            'They say yes — usually after you have said something out loud in the room.',
            'Your button becomes "Take over the name". Tap it and you are in, with the history that name has built up.',
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
      title: 'Other things the join screen might say',
      icon: 'Warning',
      blocks: [
        {
          t: 'faq',
          items: [
            { q: 'This session has not started yet', a: 'The host has created it but not opened the doors. Wait — your screen will let you in by itself once they start it.' },
            { q: 'This session has ended', a: 'It is over. The results may still be on the host\'s screen, but there is nothing left to join.' },
            { q: 'We do not recognise that code', a: 'Check the four digits against the host\'s screen. It is easy to read a 0 as an 8 across a room.' },
            { q: 'You appear to be offline', a: 'Your connection dropped. The page reconnects on its own once you have signal again.' },
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
            { title: 'Trivia', text: 'Four options. Pick one. There is a right answer and you will see it at the end of the round.' },
            { title: 'Poll', text: 'A text box, but there is no right answer. The spread of opinion is the point.' },
            { title: 'Wavelength', text: 'A word or a short phrase. Everyone\'s words become one cloud — the fun is in how much the room overlaps.' },
          ],
        },
        {
          t: 'note',
          tone: 'tip',
          title: 'You can change your answer until the round closes',
          text: 'Submitting is not final. Come back and edit it while the round is still open — the host sees that you have answered, not what you keep changing it to.',
        },
        {
          t: 'p',
          text: 'Once you have submitted, your screen tells you it is waiting for everyone else. Switching apps or locking your phone does not lose your answer.',
        },
      ],
    },
    {
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
      title: 'Voting',
      icon: 'Medal',
      blocks: [
        {
          t: 'p',
          text: 'On open-answer rounds, once everyone has answered the room ranks the answers. You cannot vote for your own.',
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
          text: 'You can switch between the two at any point before voting closes, and change your ranking as often as you like.',
        },
      ],
    },
    {
      title: 'Reading a long answer',
      icon: 'MagnifyingGlass',
      blocks: [
        {
          t: 'p',
          text: 'Tap any answer to open it full-screen. Then use Previous and Next to walk through the rest without going back to the list each time.',
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
      title: 'How points are earned',
      icon: 'Medal',
      blocks: [
        {
          t: 'p',
          text: 'It depends on the kind of round, and the host can adjust the weighting for their session — so treat this as the shape of it rather than a rulebook.',
        },
        {
          t: 'table',
          head: ['Round', 'Where points come from'],
          rows: [
            ['Call & Answer', 'Votes from the room. First place is worth more than second, second more than third.'],
            ['Trivia', 'Getting it right.'],
            ['Poll', 'Participation — there is no right answer to be right about.'],
            ['Wavelength', 'Overlap. Landing on a word other people also chose.'],
          ],
        },
        {
          t: 'note',
          tone: 'info',
          title: 'You cannot vote for yourself',
          text: 'The ballot leaves your own answer out. Points on an open round come from other people rating your answer, which is the whole point of them being anonymous while the vote is open.',
        },
      ],
    },
    {
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
              a: 'No. Rejoin with the same name and your score comes back with you.',
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

export const PLAYER_ROLE = {
  id: 'player',
  title: 'For players',
  icon: 'UsersThree',
  blurb: 'You scanned a code and you are in the room. Start here.',
  guides: [gettingStarted, joining, playing, scoring],
};
