/* TEMPORARY — emits a static HTML harness of <ReportDocument> into the
   scratchpad so a real Chromium can print it. Deleted after use. */
import React from 'react';
import fs from 'fs';
import { render } from '@testing-library/react';
import GameReport, { ReportDocument } from '../components/GameReport';

const OUT = process.env.PRINT_FIXTURE_OUT;

const lorem = (n) => Array.from({ length: n }, (_, i) =>
  `Participants kept returning to the same tension: the team wants to move faster, but every acceleration so far has come out of the same small group of people (sentence ${i + 1}). That is a capacity problem wearing a process costume, and naming it that way changed the tone of the room.`
).join(' ');

const answers = (names) => names.map((n, i) => ({
  rank: i + 1,
  rankDisplay: ['1st', '2nd', '3rd'][i] || `${i + 1}th`,
  answerText: i % 3 === 0
    ? `We should stop treating the quarterly review as the only moment we are allowed to change direction. ${lorem(1)}`
    : `Give the on-call rotation a real handover ritual — fifteen minutes, written, every Monday.`,
  playerName: n,
  totalScore: 30 - i * 4,
  voteBreakdown: `${3 - (i % 3)} first, ${i % 3} second, 1 third`,
}));

const data = {
  gameId: 'ENG-4831-KQ',
  eventTitle: 'Northwind Partners — Q3 Strategy Offsite',
  gameType: 'poll',
  roundNoun: null,
  players: [
    { playerName: 'Amara Osei', totalScore: 94 },
    { playerName: 'Daniel Reyes', totalScore: 88 },
    { playerName: 'Priya Venkatesan', totalScore: 81 },
    { playerName: 'Tom Halloran', totalScore: 76 },
    { playerName: 'Ines Bergström', totalScore: 71 },
    { playerName: 'Marcus Bell', totalScore: 64 },
    { playerName: 'Wei Zhang', totalScore: 58 },
    { playerName: 'Fiona Clarke', totalScore: 41 },
  ],
  questions: [1, 2, 3, 4].map((n) => ({
    questionNumber: n,
    questionData: {
      title: n === 2
        ? 'Where does the work actually stall between commitment and delivery?'
        : `What would we protect if next year halved the budget? (round ${n})`,
      detail: lorem(2),
      category: ['Strategy', 'Operations', 'Culture', 'Growth'][n - 1],
    },
    aiSummary: n === 3 ? {
      summaryText: `**The room split cleanly.** ${lorem(2)}`,
      discussionQuestions: [
        'Which of these constraints is real and which is inherited?',
        'If we could only unblock one handoff this quarter, which one pays for itself first?',
        'Who in this room has the authority to change the review cadence, and have we ever asked them?',
      ],
      nextSteps: [
        'Name an owner for the Monday handover ritual before the offsite ends.',
        'Bring the capacity figures to the next leadership review, not the quarterly one.',
      ],
    } : { markdownResponse: `## What we heard\n\n${lorem(3)}\n\n### Where it points\n\n- ${lorem(1)}\n- A second, shorter observation that must not be split from its bullet.\n\n${lorem(2)}` },
    answers: answers(['Amara Osei', 'Daniel Reyes', 'Priya Venkatesan', 'Tom Halloran', 'Ines Bergström']),
  })),
};

const trivia = {
  ...data,
  gameType: 'trivia',
  questions: [{
    questionNumber: 1,
    questionData: {
      title: 'Which of these shipped first?',
      detail: lorem(1),
      category: 'Tech',
      optionA: 'The first public web browser',
      optionB: 'The first commercial mobile phone call',
      optionC: 'The first spreadsheet program sold for a personal computer',
      optionD: 'The first commercially available laser printer',
      correctAnswer: 'OptionB',
    },
    aiSummary: null,
    answers: answers(['Amara Osei', 'Daniel Reyes']),
  }],
};

test('emit', () => {
  if (!OUT) return;
  const page = (body, css) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Archivo+Expanded:wght@700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${css}</style>
</head><body><div id="root">${body}</div></body></html>`;
  const css = fs.readFileSync(`${__dirname}/../styles.css`, 'utf8')
    + '\n' + fs.readFileSync(`${__dirname}/../components/GameReport.css`, 'utf8');
  const wrap = (d) => `<div class="report-container report-paper" data-theme="light">${
    render(<ReportDocument reportData={d} />).container.innerHTML}</div>`;
  fs.writeFileSync(`${OUT}/report-poll.html`, page(wrap(data), css));
  fs.writeFileSync(`${OUT}/report-trivia.html`, page(wrap(trivia), css));
  const shell = (props) => render(<GameReport {...props} />).container.innerHTML;
  fs.writeFileSync(`${OUT}/screen-ready.html`, page(shell({
    reportData: data, status: 'ready', onBrowseAll: () => {}, onRetry: () => {},
  }), css));
  fs.writeFileSync(`${OUT}/screen-loading.html`, page(shell({
    reportData: null, status: 'loading', onBrowseAll: () => {},
  }), css));
  fs.writeFileSync(`${OUT}/screen-error.html`, page(shell({
    reportData: null, status: 'error', error: 'create-report returned 502.',
    onBrowseAll: () => {}, onRetry: () => {},
  }), css));
});
