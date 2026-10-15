/**
 * SETTINGS FROM THE NEXT ROUND (session flow v3; owner, 14 Oct, open question
 * 9, with Pace and Display applying at once). While a round is live a change
 * in the Session panel is held and applied when the next round starts, so the
 * live question, its answers and its ballots never change under the room.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen } from '@testing-library/react';
import SessionSetupPanel from '../components/stage/SessionSetupPanel';

const board = { open: false, style: 'departure', page: 0, openedAt: null };

function renderSettings(props = {}) {
  return render(
    <SessionSetupPanel
      initialTab="settings"
      gameType="call-and-answer"
      gameState="RESULTS#002"
      scoreboard={board}
      scoreboardAvailability={{ show: false, enabled: false, reason: '' }}
      anonymousUntilReveal
      wallComments
      {...props}
    />,
  );
}

describe('the panel', () => {
  test('while a round is live it says when changes apply, and each section states its scope', () => {
    renderSettings({ settingsRoundLive: true, nextRoundNumber: 3 });
    expect(screen.getByText(/Settings apply from the next round/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^Names · From the next round/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^Feedback · From the next round/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^Pace · Applies now/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^Display · Applies now/ })).toBeInTheDocument();
  });

  test('a held change shows its new value and that it waits for the next round', () => {
    renderSettings({ settingsRoundLive: true, nextRoundNumber: 3, pendingSettings: { wallComments: false } });
    expect(screen.getByTestId('wall-comments')).not.toBeChecked();
    expect(screen.getByRole('heading', { name: /^Feedback · From the next round · Waiting for round 3/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^Names · From the next round$/ })).toBeInTheDocument();
  });

  test('in the lobby there is no waiting note', () => {
    renderSettings({ gameState: 'CREATED', settingsRoundLive: false });
    expect(screen.queryByText(/Settings apply from the next round/)).not.toBeInTheDocument();
  });
});

describe('the host page', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'GameHostPage.jsx'), 'utf8');
  test('the four round settings go through deferSetting; Auto and Display do not', () => {
    for (const key of ['anonymousUntilReveal', 'nameWaiting', 'wallComments', 'scoreboardStyle']) {
      expect(page).toMatch(new RegExp(`deferSetting\\('${key}'\\)`));
    }
    expect(page).toMatch(/onAutoModeChange=\{setAutoMode\}/);
    expect(page).toMatch(/onProfileChange=\{setProfile\}/);
  });
  test('held changes apply when the round number moves on', () => {
    expect(page).toMatch(/settingsRoundRef\.current === lessonNumber && settingsRoundLive\) return;/);
  });
});
