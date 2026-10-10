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
    expect(W.openBuild).toBe('Open the build');
    expect(W.openBuildTab).toBe('Open the build in a new tab');
    expect(W.spaceTo('show results')).toBe('Press Space to show results');
    expect(W.savedLater).toBe('Saved for later');
  });

  test('Share demo (owner, 2026-10-10): "demo" for what the Wi-Fi shares, "build" for this laptop\'s link', () => {
    expect(W.shareNudgeHead).toBe('Let everyone try it.');
    expect(W.shareNudgeBody).toBe('Share this demo with people on your Wi-Fi.');
    expect(W.shareWho).toBe("People on this Wi-Fi can open this laptop's app. No one else can.");
    expect(W.shareDemo).toBe('Share demo');
    expect(W.notNow).toBe('Not now');
    expect(W.shareStarting).toBe('Starting…');
    expect(W.shareOn(11)).toBe('Shared · 11 opened');
    expect(W.shareQuiet).toBe('Shared · none opened yet');
    expect(W.shareFailed).toBe("Didn't start");
    expect(W.shareLiveHead).toBe('Demo shared on this Wi-Fi');
    expect(W.shareOpenedOf(11, 18)).toBe('11 opened it · 18 here');
    expect(W.shareNotAll(11, 18)).toBe('Not 11 of 18? Some people may be on mobile data or a VPN. They still see screenshots.');
    expect(W.stopSharing).toBe('Stop sharing');
    expect(W.keepSharing).toBe('Keep sharing');
    expect(W.shareShowOnStage).toBe('Show on the Stage');
    expect(W.showOnStage).toBe('Show on Stage');
    expect(W.onlyThisLaptop).toBe('Only this laptop can open it.');
    expect(W.anyoneOnWifi).toBe('Anyone on this Wi-Fi');
    expect(W.demoReadyLine).toBe('The demo is ready to share');
    expect(W.stageDemoHead).toBe('Try the demo yourself');
    expect(W.stageDemoScan).toBe('Scan the code, or press Open the demo.');
    expect(W.stageSameWifi).toBe('Same Wi-Fi as this laptop.');
    expect(W.stageOpened(11)).toBe('11 have opened it');
    expect(W.hideCode).toBe('Hide the code');
    expect(W.openDemo).toBe('Open the demo');
    expect(W.demoNotShared).toBe("The demo runs on the host's laptop. Screenshots are below.");
    expect(W.demoDidntOpen).toBe("Didn't open?");
    expect(W.demoMaybeOff(false)).toBe('You may be on mobile data or another Wi-Fi.');
    expect(W.demoMaybeOff(true)).toBe('You may be on a VPN or another Wi-Fi.');
    expect(W.tryAgain).toBe('Try again');
    // Retired with the nudge: the old offer and the switch's sentence.
    expect(W.wifiOffer).toBeUndefined();
    expect(W.wifiSay).toBeUndefined();
    expect(RETIRED.filter((r) => r.enforced).map((r) => r.word)).toEqual(expect.arrayContaining(['Share on this Wi-Fi', 'Let the room open it themselves?', 'Open the build yourself']));
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
