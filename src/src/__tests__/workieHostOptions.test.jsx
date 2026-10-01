/**
 * WORKIE'S HOST OPTIONS OFF THE STAGE, AND A TEMPLATE THAT SAYS WHAT IT IS.
 *
 * QA drive 2026-09-29:
 *   #5  a closed survey's What We Heard showed get-ai-summary.js's data-driven
 *       template ("5 responses were submitted… a range of perspectives", stock
 *       discussion prompts) exactly as if it were Workie's read;
 *   #5b the same screen offered "VOICE (NEXT QUESTION)" / "APPROACH (NEXT
 *       QUESTION)" on a survey with no next question;
 *   #21 the Voice and Approach selects, "Briefing on" and Redo were drawn on
 *       the room-facing stage.
 *
 * GameHostPage cannot be rendered in jsdom (the auth provider), so its wiring
 * is pinned in source, as hostSummaryApproach.test.js does; the pieces it
 * composes are rendered.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent, within } from '@testing-library/react';

jest.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value }) => <div data-testid="qr" data-value={value} />,
}));

import AISummaryStatus from '../components/AISummaryStatus';
import WorkieSettings from '../components/stage/WorkieSettings';
import SessionSetupPanel from '../components/stage/SessionSetupPanel';
import { nextRoundPickersApply, fallbackDetail } from '../config/workieOptions';

const TEMPLATE = {
  summary: '5 responses were submitted on "End-of-day survey". The group shared a range of perspectives.',
  discussionTopics: ['What stood out to you in the responses?', 'Where did the group agree or differ most?'],
  nextSteps: ['Pick one takeaway from this question to apply to your own work this week.'],
  markdownResponse: '## End-of-day survey — Summary\n\n5 responses were submitted.\n\n### Discussion topics\n- What stood out to you in the responses?',
};

describe('#5 a template read is marked, not presented as Workie\'s', () => {
  // rejects: applyAISummary dropping the flag, or AISummaryStatus ignoring it
  // and drawing the markdown template as the read.
  it('says Workie\'s read didn\'t run, keeps the count, drops the stock prompts', () => {
    render(<AISummaryStatus insights={{ ...TEMPLATE, fallback: true, fallbackReason: 'no-prompt' }} onRedo={() => {}} />);
    const box = screen.getByTestId('ai-summary-fallback');
    expect(box).toHaveTextContent("Workie's read didn't run");
    expect(box).toHaveTextContent('5 responses were submitted');
    expect(screen.queryByText(/What stood out to you/)).toBeNull();
    expect(screen.queryByText(/Pick one takeaway/)).toBeNull();
    expect(box).toHaveTextContent(fallbackDetail('no-prompt'));
  });

  // rejects: a fallback state that informs the host and leaves them stuck.
  it('offers Redo, wired to the handler', () => {
    const onRedo = jest.fn();
    render(<AISummaryStatus insights={{ ...TEMPLATE, fallback: true, fallbackReason: 'model-error' }} onRedo={onRedo} />);
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
    expect(onRedo).toHaveBeenCalledTimes(1);
  });

  // rejects: the flag read so loosely that every read becomes a fallback.
  it('a real read renders as before, with no fallback notice', () => {
    render(<AISummaryStatus insights={{ ...TEMPLATE, fallback: false }} onRedo={() => {}} />);
    expect(screen.queryByTestId('ai-summary-fallback')).toBeNull();
    expect(screen.queryByText(/didn't run/)).toBeNull();
  });

  it('a failure still outranks everything', () => {
    render(
      <AISummaryStatus
        insights={{ ...TEMPLATE, fallback: true }}
        failure={{ headline: 'Could not reach Workie', detail: 'Offline' }}
      />,
    );
    expect(screen.getByText('Could not reach Workie')).toBeInTheDocument();
    expect(screen.queryByTestId('ai-summary-fallback')).toBeNull();
  });

  it('each reason has room-safe words, and none is an error string', () => {
    for (const reason of ['no-prompt', 'model-error', undefined]) {
      expect(fallbackDetail(reason)).toMatch(/count/);
    }
  });
});

describe('#5b next-round pickers only when there is a next round', () => {
  it('no pickers on a survey, open or closed, or once the session has ended', () => {
    expect(nextRoundPickersApply({ gameType: 'survey', gameState: 'SURVEY#CLOSED' })).toBe(false);
    expect(nextRoundPickersApply({ gameType: 'call-and-answer', gameState: 'SURVEY#CLOSED' })).toBe(false);
    expect(nextRoundPickersApply({ gameType: 'trivia', gameState: 'ENDED' })).toBe(false);
  });
  it('none on the last round: nothing left to ask', () => {
    expect(nextRoundPickersApply({ gameType: 'call-and-answer', gameState: 'RESULTS#005', remaining: 0 })).toBe(false);
  });
  // rejects: hiding a working control on a count that was never loaded.
  it('kept mid-session, and when the count cannot be told', () => {
    expect(nextRoundPickersApply({ gameType: 'call-and-answer', gameState: 'RESULTS#002', remaining: 3 })).toBe(true);
    expect(nextRoundPickersApply({ gameType: 'call-and-answer', gameState: 'RESULTS#002', remaining: null })).toBe(true);
  });

  it('WorkieSettings draws no "(next …)" picker when told there is no next round', () => {
    render(<WorkieSettings showNextRound={false} briefed onRedo={() => {}} />);
    expect(screen.queryByLabelText(/Voice \(next/)).toBeNull();
    expect(screen.queryByLabelText(/Approach \(next/)).toBeNull();
    expect(screen.getByTestId('workie-redo')).toBeInTheDocument();
  });
});

describe('#21 host-only Workie controls live in the Session panel', () => {
  const personas = [{ personaId: 'p1', name: 'The Coach' }];
  const prompts = [{ promptId: 'a1', name: 'Lessons learned' }];

  it('WorkieSettings: voice and approach pickers drive the page\'s handlers', () => {
    const onPersona = jest.fn();
    const onPrompt = jest.fn();
    render(
      <WorkieSettings
        roundNoun="Round" personas={personas} prompts={prompts}
        onPersona={onPersona} onPrompt={onPrompt}
      />,
    );
    fireEvent.change(screen.getByLabelText('Voice (next round)'), { target: { value: 'p1' } });
    fireEvent.change(screen.getByLabelText('Approach (next round)'), { target: { value: 'a1' } });
    expect(onPersona).toHaveBeenCalledWith('p1');
    expect(onPrompt).toHaveBeenCalledWith('a1');
  });

  // rejects: a Redo drawn where there is no read on screen to rewrite.
  it('Redo only where there is a read on screen', () => {
    const { rerender } = render(<WorkieSettings />);
    expect(screen.queryByTestId('workie-redo')).toBeNull();
    const onRedo = jest.fn();
    rerender(<WorkieSettings onRedo={onRedo} />);
    fireEvent.click(screen.getByTestId('workie-redo'));
    expect(onRedo).toHaveBeenCalledTimes(1);
  });

  it('"Briefing on" is a note in the panel, not a chip', () => {
    render(<WorkieSettings briefed />);
    const note = screen.getByTestId('workie-briefed');
    expect(note.tagName).toBe('P');
    expect(note).toHaveClass('setup-note');
  });

  const renderPanel = (props = {}) => render(
    <SessionSetupPanel
      onClose={() => {}}
      wsConnected
      players={[]}
      gameState="RESULTS#002"
      gameType="call-and-answer"
      categories={[{ name: 'Pricing Power' }]}
      categoryCounts={{ '1-8': [7], '9-16': [], '17-24': [] }}
      categoryBitmasks={{ 'HostMask1-8': '10000000', 'HostMask9-16': '00000000', 'HostMask17-24': '00000000' }}
      questions={[]}
      gameId="4821"
      profile="room"
      {...props}
    />,
  );

  it('the Settings tab carries the Workie section', () => {
    renderPanel({ workie: { roundNoun: 'Round', personas, prompts, briefed: true, onRedo: () => {} } });
    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));
    const section = screen.getByTestId('workie-settings');
    expect(within(section).getByLabelText('Voice (next round)')).toBeInTheDocument();
    expect(within(section).getByLabelText('Approach (next round)')).toBeInTheDocument();
    expect(within(section).getByTestId('workie-briefed')).toBeInTheDocument();
    expect(within(section).getByTestId('workie-redo')).toBeInTheDocument();
  });

  it('...without next-round pickers on a closed survey', () => {
    renderPanel({ gameType: 'survey', gameState: 'SURVEY#CLOSED', workie: { personas, prompts, onRedo: () => {} } });
    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));
    expect(screen.queryByLabelText(/Voice \(next/)).toBeNull();
    expect(screen.getByTestId('workie-redo')).toBeInTheDocument();
  });

  it('...and without them when no question is left', () => {
    renderPanel({
      categoryCounts: { '1-8': [0], '9-16': [], '17-24': [] },
      workie: { personas, prompts },
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));
    expect(screen.queryByLabelText(/Voice \(next/)).toBeNull();
  });

  const src = fs.readFileSync(path.join(__dirname, '..', 'GameHostPage.jsx'), 'utf8');
  const fieldNotes = (() => {
    const at = src.indexOf("{hostPhase === 'FIELD_NOTES' && (");
    expect(at).toBeGreaterThan(-1);
    // The branch closes at its own indent; comments are stripped, since the
    // one explaining the move names what moved.
    const end = src.indexOf('\n            )}', at);
    expect(end).toBeGreaterThan(at);
    return src.slice(at, end).replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  })();

  // rejects: the pickers, the briefing chip or a standing Redo drawn back
  // onto the room-facing What We Heard beat.
  it('GameHostPage draws no host-only Workie control on the stage\'s What We Heard', () => {
    expect(fieldNotes).not.toMatch(/fn-controls/);
    expect(fieldNotes).not.toMatch(/id="game-persona"|id="game-prompt"/);
    expect(fieldNotes).not.toMatch(/Briefing on/);
    expect(fieldNotes).not.toMatch(/regenerate-ai-btn/);
  });

  it('...hands them to the Session panel, with Redo only on What We Heard', () => {
    expect(src).toMatch(/workie=\{\{/);
    expect(src).toMatch(/onPersona: handleChangeGamePersona/);
    expect(src).toMatch(/onPrompt: handleChangeGamePrompt/);
    expect(src).toMatch(/onRedo: hostPhase === 'FIELD_NOTES' \? handleRegenerateAISummary : null/);
  });

  // rejects: applyAISummary dropping the server's flag on the way to the stage.
  it('...and carries the server\'s fallback flag onto the stage', () => {
    expect(src).toMatch(/fallback: summary\.fallback === true/);
    expect(fieldNotes).toMatch(/onRedo=\{handleRegenerateAISummary\}/);
  });
});
