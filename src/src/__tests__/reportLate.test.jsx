/**
 * "ARRIVED LATE" IN THE REPORTS, AND "INCLUDE ITEMS NOT REVIEWED"
 * (session flow v3 §4.4 and §4.5; late items Task 5).
 *
 * The round's `late: { answers, askAnswers, comments }` as create-report.js
 * files it (tests/report-late.js holds the server side), drawn under the
 * heading "Arrived late" with each item's label, in the session report and
 * the round report; the line saying what the setting left out; the setting
 * in Settings; and the phone's feedback round never carrying any of it (Q14).
 */
import React from 'react';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import ReportLate from '../components/ReportLate';
import RoundReport from '../components/RoundReport';
import { ReportDocument } from '../components/GameReport';
import SessionSetupPanel from '../components/stage/SessionSetupPanel';
import { roundsFrom, feedbackRoundFrom } from '../config/sessionHistory';

const LATE = {
  answers: [{
    text: 'Ship it on Friday.', who: 'Ada', arrivedDuring: 'VOTE#001', arrivedAt: '2026-10-16T09:01:00.000Z',
    label: 'Not reviewed', reviewed: null,
  }],
  askAnswers: [{
    text: 'The finance team', who: null, arrivedDuring: 'ASK#002', arrivedAt: '2026-10-16T09:12:00.000Z',
    label: 'Reviewed with the room', reviewed: 'shown', askQuestion: 'Who else should hear this?',
  }],
  comments: [{
    text: 'We skipped cost.', who: null, arrivedDuring: 'ENDED', arrivedAt: '2026-10-16T09:10:00.000Z',
    label: 'Reviewed by the host', reviewed: 'read', anchorKind: 'summary',
  }],
  leftOut: { comments: 0, answers: 0 },
};

describe('ReportLate', () => {
  test('the heading, every item oldest first, each with its label', () => {
    const { container } = render(<ReportLate late={LATE} roundNoun="Round" />);
    expect(screen.getByRole('heading', { name: 'Arrived late' })).toBeInTheDocument();
    const items = [...container.querySelectorAll('.report-late-item')];
    expect(items.map((el) => el.querySelector('blockquote').textContent))
      .toEqual(['Ship it on Friday.', 'We skipped cost.', 'The finance team']);
    expect(items.map((el) => el.querySelector('.report-late-label').textContent))
      .toEqual(['Not reviewed', 'Reviewed by the host', 'Reviewed with the room']);
  });

  test('who where the round showed names, nothing where it did not; what an ask answer answered', () => {
    const { container } = render(<ReportLate late={LATE} roundNoun="Round" />);
    const [answer, comment, idea] = [...container.querySelectorAll('.report-late-item')];
    expect(within(answer).getByText('Ada')).toBeInTheDocument();
    expect(answer.textContent).toMatch(/Late answer/);
    expect(answer.textContent).toMatch(/during Round 1 · Voting/);
    expect(comment.querySelector('.comment-author')).toBeNull();
    expect(comment.textContent).toMatch(/Comment added later/);
    expect(comment.textContent).toMatch(/after the session ended/);
    expect(idea.textContent).toMatch(/Late answer to a question · To: Who else should hear this\?/);
    expect(idea.querySelector('.comment-author')).toBeNull();
  });

  test('nothing late, nothing drawn', () => {
    expect(render(<ReportLate late={null} />).container.innerHTML).toBe('');
    expect(render(<ReportLate late={{ answers: [], askAnswers: [], comments: [] }} />).container.innerHTML).toBe('');
  });
});

describe('the session report', () => {
  const reportData = {
    gameId: 'ENG-78',
    eventTitle: 'Ops review',
    gameType: 'call-and-answer',
    roundNoun: null,
    players: [{ playerName: 'Bea', totalScore: 3 }],
    questions: [{
      questionNumber: '001',
      questionData: { title: 'What do we fix first?', category: 'Ops' },
      answers: [],
      comments: [],
      followUps: [],
      late: LATE,
    }],
  };

  test('each round has its "Arrived late" with the labels', () => {
    render(<ReportDocument reportData={reportData} />);
    expect(screen.getByRole('heading', { name: 'Arrived late' })).toBeInTheDocument();
    expect(screen.getByText('Not reviewed')).toBeInTheDocument();
    expect(screen.getByText('Reviewed by the host')).toBeInTheDocument();
    expect(screen.getByText('Reviewed with the room')).toBeInTheDocument();
  });

  test('with the setting off it prints the one line saying what it left out', () => {
    const line = "2 comments not reviewed are left out of this report, at the host's choice.";
    render(<ReportDocument reportData={{ ...reportData, notReviewedLeftOut: { comments: 2, answers: 0, line } }} />);
    expect(screen.getByText(line)).toBeInTheDocument();
  });

  test('nothing left out, no line', () => {
    const { container } = render(<ReportDocument reportData={{ ...reportData, notReviewedLeftOut: { comments: 0, answers: 0, line: '' } }} />);
    expect(container.querySelector('.report-left-out')).toBeNull();
  });
});

describe('the round report and the rounds tab', () => {
  const slice = {
    questionNumber: '001',
    questionData: { title: 'What do we fix first?' },
    answers: [],
    comments: [],
    followUps: [],
    late: LATE,
  };

  test('the host\'s round keeps late, and RoundReport draws "Arrived late" with the labels', () => {
    const [round] = roundsFrom({ detailedQuestions: [slice] });
    expect(round.late).toEqual(LATE);
    render(<RoundReport round={round} />);
    expect(screen.getByRole('heading', { name: 'Arrived late' })).toBeInTheDocument();
    expect(screen.getByText('Not reviewed')).toBeInTheDocument();
  });

  test('the set\'s own round noun reaches "Arrived late" ("during Lesson 1"), and the host page passes it', () => {
    const [round] = roundsFrom({ detailedQuestions: [slice] });
    const { container } = render(<RoundReport round={round} roundNoun="Lesson" />);
    expect(container.textContent).toMatch(/during Lesson 1 · Voting/);
    expect(container.textContent).not.toMatch(/during Round 1/);
    // PastRound hands it on, and the host page gives PastRound the session's.
    const fs = require('fs');
    const path = require('path');
    const past = fs.readFileSync(path.join(__dirname, '..', 'components', 'PastRound.jsx'), 'utf8');
    expect(past).toMatch(/<RoundReport[\s\S]{0,400}roundNoun=\{roundNoun\}/);
    const host = fs.readFileSync(path.join(__dirname, '..', 'GameHostPage.jsx'), 'utf8');
    expect(host).toMatch(/<PastRound[\s\S]{0,400}roundNoun=\{getHostRoundNoun\(\)\}/);
  });

  test('a phone\'s feedback round never carries it (Q14)', () => {
    const round = feedbackRoundFrom(slice);
    expect(round.late).toBeNull();
    render(<RoundReport round={round} />);
    expect(screen.queryByText('Arrived late')).not.toBeInTheDocument();
    expect(screen.queryByText('Not reviewed')).not.toBeInTheDocument();
  });
});

describe('the setting, in Settings', () => {
  const board = { open: false, style: 'departure', page: 0, openedAt: null };
  const renderSettings = (props = {}) => render(
    <SessionSetupPanel
      initialTab="settings"
      gameType="call-and-answer"
      gameState="RESULTS#002"
      scoreboard={board}
      scoreboardAvailability={{ show: false, enabled: false, reason: '' }}
      {...props}
    />,
  );

  test('on by default, under Report, and it applies now', () => {
    renderSettings({ settingsRoundLive: true, nextRoundNumber: 3 });
    expect(screen.getByRole('heading', { name: /^Report · Applies now/ })).toBeInTheDocument();
    const box = screen.getByTestId('include-not-reviewed');
    expect(box).toBeChecked();
    expect(screen.getByText('Include items not reviewed')).toBeInTheDocument();
  });

  test('turning it off asks the page to change it', () => {
    const onChange = jest.fn();
    renderSettings({ includeNotReviewed: true, onIncludeNotReviewedChange: onChange });
    fireEvent.click(screen.getByTestId('include-not-reviewed'));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  test('a refused change says so in an alert line', async () => {
    const onChange = jest.fn().mockResolvedValue({ ok: false, error: 'Network down' });
    renderSettings({ includeNotReviewed: true, onIncludeNotReviewedChange: onChange });
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByTestId('include-not-reviewed'));
    expect(await screen.findByRole('alert')).toHaveTextContent('The setting did not save. Try again.');
  });

  test('a saved change says nothing, and clears an earlier failure', async () => {
    const onChange = jest.fn()
      .mockResolvedValueOnce({ ok: false, error: 'Network down' })
      .mockResolvedValueOnce({ ok: true });
    renderSettings({ includeNotReviewed: true, onIncludeNotReviewedChange: onChange });
    fireEvent.click(screen.getByTestId('include-not-reviewed'));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByTestId('include-not-reviewed'));
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  test('off shows off', () => {
    renderSettings({ includeNotReviewed: false });
    expect(screen.getByTestId('include-not-reviewed')).not.toBeChecked();
  });
});
