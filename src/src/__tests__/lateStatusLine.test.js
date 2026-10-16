/**
 * THE LATE COUNT ON THE STATUS LINE (session flow v3 §4.4; late items Task 4).
 *
 * One count, one place: roundStep appends it, so the dock, the console footer
 * and the Remote all say the same thing. "3 of 4 voted · 1 late answer kept";
 * at ENDED "2 items not reviewed · Review", and the main button stays "Open
 * session report".
 */
import fs from 'fs';
import path from 'path';
import { roundStep } from '../config/roundStep';
import { hostControlsFor } from '../config/hostControls';
import { remoteStep } from '../config/hostRemote';
import LW from '../config/lateWords';

const voting = (late) => roundStep('VOTING', { progress: { received: 3, total: 4 }, late });

describe('the count joins the step\'s status', () => {
  test('nothing waiting: the status is unchanged', () => {
    expect(voting(undefined).status.text).toBe(voting({ notReviewed: 0, answers: 0 }).status.text);
    expect(voting(undefined).status.late).toBeFalsy();
  });

  test('one late answer kept', () => {
    const s = voting({ notReviewed: 1, answers: 1 }).status;
    expect(s.text).toBe(`${voting(null).status.text} · 1 late answer kept`);
    expect(s.late).toEqual({ line: '1 late answer kept', link: '1 late answer kept' });
    expect(s.tone).toBe(voting(null).status.tone);
  });

  test('mixed items: "N late items not reviewed"', () => {
    expect(voting({ notReviewed: 3, answers: 1 }).status.text).toMatch(/ · 3 late items not reviewed$/);
  });

  test('at ENDED: "2 items not reviewed · Review"; the primary is still the report', () => {
    const plain = roundStep('ENDED', {});
    const step = roundStep('ENDED', { late: { notReviewed: 2, answers: 0 } });
    expect(step.status.text).toBe(`2 items not reviewed · ${LW.review}`);
    expect(step.status.late).toEqual({ line: '2 items not reviewed', link: LW.review });
    expect(step.primary).toEqual(plain.primary);
  });
});

describe('the laptop and the Remote agree', () => {
  const MOMENTS = [
    { name: 'VOTING', dock: { phase: 'VOTE', roundNumber: 3, playerCount: 4, votedCount: 3, answerCount: 4 }, json: { state: 'VOTE#003', votingProgress: { votesReceived: 3, totalPlayers: 4 } }, extras: { playerCount: 4, answerCount: 4 } },
    { name: 'RESULTS', dock: { phase: 'RESULTS', roundNumber: 3, playerCount: 4, answerCount: 4 }, json: { state: 'RESULTS#003', stageBeat: 'results', stageFocus: { focus: 'none', index: null } }, extras: { playerCount: 4, answerCount: 4 } },
    { name: 'ENDED', dock: { phase: 'ENDED' }, json: { state: 'ENDED' }, extras: {} },
  ];
  const late = { notReviewed: 2, answers: 2 };
  test.each(MOMENTS)('$name', ({ dock, json, extras }) => {
    const gameType = 'call-and-answer';
    const a = hostControlsFor({ gameType, roundNoun: 'Round', hasQuestionSet: true, ...dock, late });
    const b = remoteStep({ gameType, ...json }, { roundNoun: 'Round', hasQuestionSet: true, ...extras, late });
    expect(b.status.text).toBe(a.status.text);
    expect(b.status.late).toEqual(a.status.late);
    expect(a.status.text).toMatch(/2 (late answers kept|items not reviewed · Review)$/);
  });
});

describe('the surfaces carry it', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

  test('the host page hands roundStep the count', () => {
    const page = read('GameHostPage.jsx');
    expect(page).toMatch(/hostControlsFor\(\{[\s\S]{0,3000}late: lateStatus,/);
    expect(page).toMatch(/const lateStatus = useMemo\(\(\) => lateStatusOf\(lateItems\)/);
  });

  test('the Remote hands roundStep the count', () => {
    const remote = read('HostRemote.jsx');
    expect(remote).toMatch(/late: lateStatus,/);
    expect(remote).toMatch(/fetchLate\(/);
  });

  test('the Remote re-reads at the end on the roster tick, so its count stays true', () => {
    const remote = read('HostRemote.jsx');
    expect(remote).toMatch(/remoteState !== 'ENDED'\) return undefined;[\s\S]{0,300}fetchLate\([\s\S]{0,200}ROSTER_POLL_MS\)/);
  });

  test('Present never passes the count, so the wall stays label-free (Q14)', () => {
    const present = read('present/presentControls.js');
    const call = present.slice(present.indexOf('remoteStep(hostState'), present.indexOf('}) : null;', present.indexOf('remoteStep(hostState')));
    expect(call).toMatch(/remoteStep\(hostState/);
    expect(call).not.toMatch(/\blate\b/);
  });

  test('the dock and the console footer turn the count into a link to the list', () => {
    const page = read('GameHostPage.jsx');
    expect(page).toMatch(/statusLink=\{dockLateLink\}/);
    expect(page).toMatch(/onStatusLink=\{openLateList\}/);
    expect(page).toMatch(/onReviewLate: openLateList,/);
    expect(read('components/console/ConsoleFooter.jsx')).toMatch(/onReviewLate/);
  });
});
