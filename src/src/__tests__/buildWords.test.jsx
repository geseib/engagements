/** The Build Room's words (B6): pinned here so a reword is a decision, plus the one Send icon, rendered. */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { SendToClaude } from '../buildroom/BuildRoomPage';
import { W, RETIRED, KIND_WORDS } from '../buildroom/words';

describe('words.js', () => {
  test('every B6 word, exact', () => {
    expect(W.showResults).toBe('Show results');
    expect(W.openVoting).toBe('Open voting');
    expect(W.send('B')).toBe('Send B to Claude');
    expect(W.send('3.4')).toBe('Send 3.4 to Claude');
    expect(W.sendTopIdea).toBe('Send the top idea to Claude');
    expect(W.sendPlain).toBe('Send to Claude');
    expect(W.change).toBe('Change before sending');
    expect(W.askAgainEllipsis).toBe('Ask again…');
    expect(W.recordOnly).toBe('Record only');
    expect(W.voteAgain).toBe('Vote again');
    expect(W.spin).toBe('Spin the wheel');
    expect(W.spinAgain).toBe('Spin again');
    expect(W.saveLater).toBe('Save for later');
    expect(W.later).toBe('Later');
    expect(W.sendNow).toBe('Send to Claude now');
    expect(W.remove).toBe('Remove');
    expect(W.undo).toBe('Undo');
    expect(W.askRoom).toBe('Ask the room');
    expect(W.mainMenu).toBe('Main menu');
    expect(W.liveBuild).toBe('Open the live build ↗');
    expect(W.openBuild).toBe('Open the build');
    expect(W.openBuildTab).toBe('Open the build in a new tab');
    expect(W.spaceTo('show results')).toBe('Press Space to show results');
  });

  test('Later is not a kind', () => {
    expect(KIND_WORDS).toEqual(['Do now', 'Keep in mind', 'Ask Claude']);
  });

  test('W is frozen', () => {
    expect(Object.isFrozen(W)).toBe(true);
    expect(Object.isFrozen(RETIRED)).toBe(true);
  });

  test('every retired word has an enforced flag; the not-yet-enforced name their task; no enforced retired word is a live one', () => {
    expect(RETIRED.length).toBeGreaterThan(10);
    const live = Object.values(W).filter((v) => typeof v === 'string');
    RETIRED.forEach((r) => {
      expect(typeof r.word).toBe('string');
      expect(typeof r.enforced).toBe('boolean');
      if (!r.enforced) expect([2, 3, 4]).toContain(r.task);
      if (!r.prefix && r.enforced) expect(live).not.toContain(r.word);
    });
    ['Spin', 'Spin instead', 'Spin the wheel instead', 'Back to the main menu'].forEach((w) => {
      expect(RETIRED.find((r) => r.word === w).enforced).toBe(true);
    });
  });
});

describe('one Send icon: the paper plane, rendered', () => {
  const icon = (btn) => btn.querySelector('svg');
  test('the split Send button carries the plane full size and small', () => {
    const { unmount } = render(<SendToClaude onSend={() => {}} busy={false} />);
    expect(icon(screen.getByRole('button', { name: 'Send to Claude' }))).not.toBeNull();
    unmount();
    render(<SendToClaude small onSend={() => {}} busy={false} />);
    expect(icon(screen.getByRole('button', { name: 'Send to Claude' }))).not.toBeNull();
  });
});
