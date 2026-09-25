import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen } from '@testing-library/react';
import WorkieContextHint from '../components/WorkieContextHint';
import PastRound from '../components/PastRound';
import { roundsFrom } from '../config/sessionHistory';

const ALL = { background: true, setNote: true, eventDetails: false, hostInstructions: false, briefing: false };

test('lists the five kinds of context in the spec\'s order, ticked or dashed', () => {
  render(<WorkieContextHint contextUsed={ALL} />);
  expect(screen.getByTestId('workie-context-hint').textContent).toBe(
    'Workie had: question notes ✓ · set note ✓ · event details — · host instructions — · briefing —');
});

/*
 * A SCREEN READER GETS WORDS, NOT GLYPHS. "✓" reads as "check mark" at best and
 * "—" as "em dash" or nothing, so the ticks and dashes carry no meaning aloud.
 * The line is exposed as one image-like unit named in words — the star-rating
 * pattern — and the visible text the tests above pin is left exactly as it is.
 */
test('reads aloud as words, not as ticks and dashes', () => {
  render(<WorkieContextHint contextUsed={ALL} />);
  const hint = screen.getByRole('img', {
    name: 'Workie had — question notes: yes; set note: yes; event details: no; '
      + 'host instructions: no; briefing: no',
  });
  expect(hint).toBe(screen.getByTestId('workie-context-hint'));
  expect(hint.textContent).toBe(
    'Workie had: question notes ✓ · set note ✓ · event details — · host instructions — · briefing —');
});

test('renders nothing for a summary written before the flags existed', () => {
  const { container } = render(<WorkieContextHint contextUsed={null} />);
  expect(container).toBeEmptyDOMElement();
});

/*
 * NEVER OVER THE STAGE — asserted by RENDERING, not by searching for a name.
 *
 * The guard this replaces read GameHostPage.jsx and SessionSetupPanel.jsx for
 * the string "WorkieContextHint", and passed while the hint sat on the projected
 * stage all the same: the host page mounts `PastRound` as a modal over the stage
 * (opened from the session sidebar's rounds list), PastRound mounts RoundReport,
 * and RoundReport mounted the hint. No file on that path named the component the
 * search was looking for. So this mounts PastRound the way the host page does —
 * the same props, a report shaped the way create-report.js emits one — with the
 * flags set on the round, and asserts the DOM has no hint in it.
 */
test('the round review the host page opens over the stage never shows what Workie had', () => {
  const rounds = roundsFrom({
    success: true,
    gameId: '4821',
    report: {
      detailedQuestions: [{
        questionNumber: 1,
        questionData: { title: 'Where does time go?', category: 'Focus' },
        answers: [],
        voteStats: null,
        aiSummary: {
          summaryText: 'The room wants fewer meetings.',
          contextUsed: {
            background: true, setNote: true, eventDetails: true,
            hostInstructions: true, briefing: true,
          },
        },
      }],
    },
  });
  // GameHostPage.jsx's own mount: rounds, index, onIndex, onClose,
  // onRegenerate, regenerating — and nothing else.
  render(
    <PastRound
      rounds={rounds}
      index={0}
      onIndex={() => {}}
      onClose={() => {}}
      onRegenerate={() => {}}
      regenerating={[]}
    />,
  );
  expect(screen.getByText('The room wants fewer meetings.')).toBeInTheDocument();
  expect(screen.queryByTestId('workie-context-hint')).toBeNull();
  expect(screen.queryByText(/Workie had:/)).toBeNull();
});

/*
 * A second, cheaper line behind the render test: none of the files that make up
 * the host page's own surfaces may name the hint OR the RoundReport prop that
 * turns it on. The name search alone missed the indirect path above; with the
 * prop in the list it no longer can.
 */
test('the host page, its sidebar and its round review never name the hint or its opt-in', () => {
  for (const rel of [
    '../GameHostPage.jsx',
    '../components/stage/SessionSetupPanel.jsx',
    '../components/PastRound.jsx',
  ]) {
    const src = fs.readFileSync(path.join(__dirname, rel), 'utf8');
    expect({ rel, named: /WorkieContextHint|showWorkieContext/.test(src) })
      .toEqual({ rel, named: false });
  }
});

test('mounted on the host remote', () => {
  const src = fs.readFileSync(path.join(__dirname, '../HostRemote.jsx'), 'utf8');
  expect(src).toMatch(/<WorkieContextHint\s+contextUsed=\{aiSummary\?\.contextUsed/);
});
