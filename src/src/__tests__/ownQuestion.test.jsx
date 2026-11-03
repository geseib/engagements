/**
 * THE IMPROMPTU ASK ON THE HOST SURFACES (docs/design/impromptu-ask; README
 * D2–D9, F2, F3, F5, F6, F8; reviews R1–R7, A-2–A-6).
 *
 *   1. the composer: the commit waits for words and says why; its label
 *      follows Next / Later / Now; Now is aria-disabled with its reason while
 *      answers are coming in, and still focusable; X, Cancel, ← and Escape go
 *      through one requestClose that asks first when something is typed; the
 *      note's "never shown" line is its description; the laptop commit is not
 *      the orange, the phone's is.
 *   2. the three doors and Q: the rail, the Session menu's Rounds (the
 *      composer inline, never a modal over the sheet), the Remote's Rounds
 *      tab; Q with the other keys' guards; the keys help.
 *   3. one screen: the choice comes first, its first line is text, focus on
 *      the phone option; the door sits outside the private reveal.
 *   4. the queue's Yours rows: the word, Edit, Remove armed in place, no
 *      Disable; Rounds so far marks Yours except on one screen.
 *   5. Your part now: "Next round asks your question".
 *   6. the report: Yours, the source line, the labelled note and the switch.
 *   7. Setup before round 1: First up shows Yours.
 *
 * No geometric assertions (jsdom has no layout engine).
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent, within, act } from '@testing-library/react';

jest.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value }) => <div data-testid="qr" data-value={value} />,
  QRCodeCanvas: ({ value }) => <div data-testid="qr" data-value={value} />,
}));

import OwnQuestionComposer, { commitLabel, composerDirty } from '../components/OwnQuestionComposer';
import OwnQuestionChoice from '../components/OwnQuestionChoice';
import QueueList from '../components/stage/QueueList';
import ConsoleRail from '../components/console/ConsoleRail';
import SessionSetupPanel from '../components/stage/SessionSetupPanel';
import SessionSetup from '../components/console/panels/SessionSetup';
import RemoteSessionPanel from '../components/RemoteSessionPanel';
import { ReportDocument } from '../components/GameReport';
import useOwnQuestionKey, { ownQuestionKeyIntent } from '../components/stage/useOwnQuestionKey';
import { ownQuestionWords as OQ } from '../config/consoleWords';
import {
  ownAtHead, withOwnNext, ownNowAllowed, laterAnchors, withOwnRounds, ownSourceLine,
} from '../config/ownQuestion';
import { AREA as hostRunning } from '../config/help/host-running';
import { AREA as hostTwoScreens } from '../config/help/host-two-screens';

const SRC = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');

const type = (el, value) => fireEvent.change(el, { target: { value } });

/* ── 1. the composer ─────────────────────────────────────────────────────── */

describe('the composer (frames 1–2, 5)', () => {
  test('focus lands in the question, and the commit waits for words with its reason', () => {
    render(<OwnQuestionComposer canNow />);
    const title = screen.getByTestId('own-title');
    expect(document.activeElement).toBe(title);
    const commit = screen.getByTestId('own-commit');
    expect(commit).toBeDisabled();
    expect(screen.getByText(OQ.needsWords)).toBeInTheDocument();
    type(title, 'What would have to be true to ship by March?');
    expect(commit).not.toBeDisabled();
  });

  test('the commit names the choice: Put it next / Put it after round N / Ask it now', () => {
    const later = [{ key: 'c001#005', round: 5, title: 'One habit worth keeping', through: ['c001#004', 'c001#005'] }];
    render(<OwnQuestionComposer canNow laterOptions={later} />);
    type(screen.getByTestId('own-title'), 'A question');
    const commit = screen.getByTestId('own-commit');
    expect(commit).toHaveTextContent('Put it next');
    fireEvent.click(screen.getByTestId('own-place-later'));
    expect(commit).toHaveTextContent('Put it after round 5');
    fireEvent.click(screen.getByTestId('own-place-now'));
    expect(commit).toHaveTextContent('Ask it now');
    expect(commitLabel({ mode: 'edit' })).toBe(OQ.save);
  });

  test('Where it goes is a radiogroup; arrow keys move and choose (A-2, R7)', () => {
    render(<OwnQuestionComposer canNow />);
    const group = screen.getByRole('radiogroup', { name: OQ.where });
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
    fireEvent.keyDown(radios[0], { key: 'ArrowRight' });
    expect(screen.getByTestId('own-place-later')).toHaveAttribute('aria-checked', 'true');
    // Each radio's line is its description.
    expect(radios[0]).toHaveAccessibleDescription(OQ.nextLine);
  });

  test('mid-answer, Now is aria-disabled (not disabled) with its reason, and cannot be chosen (F2)', () => {
    render(<OwnQuestionComposer canNow={false} />);
    const now = screen.getByTestId('own-place-now');
    expect(now).toHaveAttribute('aria-disabled', 'true');
    expect(now).not.toBeDisabled();
    expect(now).toHaveAccessibleDescription(OQ.nowWaits);
    fireEvent.click(now);
    expect(now).toHaveAttribute('aria-checked', 'false');
    // Arrow keys skip it.
    fireEvent.keyDown(screen.getByTestId('own-place-next'), { key: 'ArrowLeft' });
    expect(screen.getByTestId('own-place-later')).toHaveAttribute('aria-checked', 'true');
  });

  test('the private note is described by "never shown" (A-4, R4)', () => {
    render(<OwnQuestionComposer />);
    expect(screen.getByTestId('own-note')).toHaveAccessibleDescription(OQ.neverShown);
  });

  test('X, Cancel, ← Running order and Escape close at once when nothing is typed', () => {
    for (const how of ['own-x', 'own-cancel', 'own-back', 'escape']) {
      const onClose = jest.fn();
      const { unmount } = render(<OwnQuestionComposer onClose={onClose} />);
      if (how === 'escape') fireEvent.keyDown(screen.getByTestId('own-title'), { key: 'Escape' });
      else fireEvent.click(screen.getByTestId(how));
      expect(onClose).toHaveBeenCalledTimes(1);
      unmount();
    }
  });

  test('with words typed, every exit asks first, inline (never a second dialog)', () => {
    for (const how of ['own-x', 'own-cancel', 'own-back', 'escape']) {
      const onClose = jest.fn();
      const { unmount } = render(<OwnQuestionComposer onClose={onClose} />);
      type(screen.getByTestId('own-title'), 'Half a question');
      if (how === 'escape') fireEvent.keyDown(screen.getByTestId('own-title'), { key: 'Escape' });
      else fireEvent.click(screen.getByTestId(how));
      expect(onClose).not.toHaveBeenCalled();
      const ask = screen.getByTestId('own-confirm');
      expect(ask).toHaveTextContent(OQ.discardTitle);
      expect(screen.queryAllByRole('dialog')).toHaveLength(0);
      fireEvent.click(screen.getByTestId('own-discard'));
      expect(onClose).toHaveBeenCalledTimes(1);
      unmount();
    }
    expect(composerDirty({ title: 'a' }, {})).toBe(true);
    expect(composerDirty({ title: 'a' }, { title: 'a' })).toBe(false);
  });

  test('submit sends the words and where it goes, with the anchor\'s walk for Later', () => {
    const onSubmit = jest.fn();
    const later = [{ key: 'c001#005', round: 5, title: 'Five', through: ['c001#004', 'c001#005'] }];
    render(<OwnQuestionComposer laterOptions={later} onSubmit={onSubmit} />);
    type(screen.getByTestId('own-title'), '  Ship by March?  ');
    type(screen.getByTestId('own-line'), 'People and money');
    type(screen.getByTestId('own-note'), 'Budget or sign-off?');
    fireEvent.click(screen.getByTestId('own-place-later'));
    fireEvent.click(screen.getByTestId('own-commit'));
    expect(onSubmit).toHaveBeenCalledWith({
      title: 'Ship by March?', detail: 'People and money', note: 'Budget or sign-off?',
      place: 'later', anchorKey: 'c001#005', anchorRound: 5, through: ['c001#004', 'c001#005'],
    });
  });

  test('a question past 200 characters cannot be committed', () => {
    render(<OwnQuestionComposer />);
    type(screen.getByTestId('own-title'), 'x'.repeat(201));
    expect(screen.getByTestId('own-commit')).toBeDisabled();
  });

  test('editing draws no Where it goes, and saves', () => {
    render(<OwnQuestionComposer mode="edit" initial={{ title: 'Old words' }} />);
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    expect(screen.getByTestId('own-commit')).toHaveTextContent(OQ.save);
  });

  test('the laptop commit is a strong plain button, never the orange; the phone\'s is the orange (R2)', () => {
    const { unmount } = render(<OwnQuestionComposer />);
    const laptop = screen.getByTestId('own-commit');
    expect(laptop.className).toMatch(/ui-btn--quiet/);
    expect(laptop.className).not.toMatch(/ui-btn--action/);
    expect(laptop.className).toMatch(/oq-commit--strong/);
    unmount();
    render(<OwnQuestionComposer variant="touch" />);
    expect(screen.getByTestId('own-commit').className).toMatch(/ui-btn--action/);
  });
});

/* ── 2. the doors and Q ──────────────────────────────────────────────────── */

describe('the three doors and Q (D2)', () => {
  test('the rail\'s Round queue has a quiet "Write a question" link', () => {
    const onWriteQuestion = jest.fn();
    render(<ConsoleRail moment="READ" rounds={[{ n: 4, title: 'What would have to be true…', state: 'next', own: true }]} onWriteQuestion={onWriteQuestion} />);
    fireEvent.click(screen.getByTestId('rail-write'));
    expect(onWriteQuestion).toHaveBeenCalledTimes(1);
    // …and a round the host wrote is marked Yours there.
    expect(within(screen.getByRole('complementary')).getByTestId('yours-mark')).toHaveTextContent(OQ.yours);
  });

  test('no handler, no link', () => {
    render(<ConsoleRail moment="READ" rounds={[]} />);
    expect(screen.queryByTestId('rail-write')).not.toBeInTheDocument();
  });

  test('the Session menu\'s Rounds: "Write a question" beside Running order', () => {
    const onWriteQuestion = jest.fn();
    render(<SessionSetupPanel onClose={() => {}} gameState="RESULTS#003" gameId="7924" initialTab="rounds" onWriteQuestion={onWriteQuestion} />);
    fireEvent.click(screen.getByTestId('queue-write'));
    expect(onWriteQuestion).toHaveBeenCalledTimes(1);
  });

  test('the composer is an inline step of Rounds, never a dialog over the menu', () => {
    render(
      <SessionSetupPanel
        onClose={() => {}}
        gameState="RESULTS#003"
        gameId="7924"
        initialTab="rounds"
        ownComposer={{ canNow: true, onClose: () => {}, onSubmit: () => {} }}
      />,
    );
    const composer = screen.getByTestId('own-composer');
    // Inside the Session menu's own dialog, not a second one.
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog')).toContainElement(composer);
    expect(screen.getByLabelText('What comes next', { selector: 'section' })).not.toBeVisible();
  });

  test('the phone Remote\'s Rounds tab opens the composer as a full-height sheet', () => {
    const onWriteQuestion = jest.fn();
    const { rerender } = render(<RemoteSessionPanel initialTab="history" onWriteQuestion={onWriteQuestion} />);
    fireEvent.click(screen.getByTestId('remote-write'));
    expect(onWriteQuestion).toHaveBeenCalledTimes(1);
    rerender(<RemoteSessionPanel initialTab="history" onWriteQuestion={onWriteQuestion} ownComposer={{ variant: 'touch', onClose: () => {}, onSubmit: () => {} }} />);
    expect(screen.getByTestId('remote-own-sheet')).toContainElement(screen.getByTestId('own-composer'));
    expect(screen.getByTestId('own-composer').className).toMatch(/oq--touch/);
  });

  test('Q: the key, with the other keys\' guards', () => {
    const k = (props) => ownQuestionKeyIntent({ key: 'q', target: document.body, ...props });
    expect(k({})).toBe('write');
    expect(k({ key: 'Q' })).toBe('write');
    expect(k({ ctrlKey: true })).toBeNull();
    expect(k({ metaKey: true })).toBeNull();
    expect(k({ repeat: true })).toBeNull();
    expect(k({ defaultPrevented: true })).toBeNull();
    const input = document.createElement('input');
    expect(k({ target: input })).toBeNull();
    const area = document.createElement('textarea');
    expect(k({ target: area })).toBeNull();
    expect(k({ key: 'w' })).toBeNull();
  });

  function KeyProbe({ enabled, onWrite }) {
    useOwnQuestionKey({ enabled, onWrite });
    return <input data-testid="field" />;
  }

  test('Q opens the composer only while enabled (no dialog), never while typing', () => {
    const onWrite = jest.fn();
    const { rerender } = render(<KeyProbe enabled onWrite={onWrite} />);
    act(() => { fireEvent.keyDown(document.body, { key: 'q' }); });
    expect(onWrite).toHaveBeenCalledTimes(1);
    act(() => { fireEvent.keyDown(screen.getByTestId('field'), { key: 'q' }); });
    expect(onWrite).toHaveBeenCalledTimes(1);
    rerender(<KeyProbe enabled={false} onWrite={onWrite} />);
    act(() => { fireEvent.keyDown(document.body, { key: 'q' }); });
    expect(onWrite).toHaveBeenCalledTimes(1);
  });

  test('the page wires Q with the Session menu key\'s guards, and Call & Answer only', () => {
    const page = read('GameHostPage.jsx');
    const at = page.indexOf('useOwnQuestionKey({');
    expect(at).toBeGreaterThan(-1);
    const call = page.slice(at, at + 700);
    expect(call).toMatch(/sessionPanelKeyOn/);
    expect(call).toMatch(/call-and-answer/);
    expect(call).toMatch(/!ownComposer && !ownChoiceOpen/);
  });

  test('the keys help lists Q on both host keys tables', () => {
    const rowsOf = (guide) => JSON.stringify(guide);
    expect(rowsOf(hostRunning)).toMatch(/"keys":"Q"/);
    expect(rowsOf(hostTwoScreens)).toMatch(/"keys":"Q"/);
  });
});

/* ── 3. one screen ───────────────────────────────────────────────────────── */

describe('one screen: the choice before the composer (D8, A-5)', () => {
  test('the first line is text, saying the room sees this screen; focus starts on the phone option', () => {
    render(<OwnQuestionChoice remoteConnected />);
    const dialog = screen.getByRole('dialog');
    const lead = screen.getByTestId('own-choice-lead');
    expect(lead).toHaveTextContent(`${OQ.oneScreenLead} ${OQ.oneScreenLeadRest}`);
    expect(dialog).toContainElement(lead);
    expect(document.activeElement).toBe(screen.getByTestId('own-choice-phone'));
    expect(screen.getByTestId('own-choice-phone')).toHaveTextContent(OQ.openOnPhone);
    // It never draws the fields.
    expect(screen.queryByTestId('own-composer')).not.toBeInTheDocument();
  });

  test('with no Remote, the phone option connects one; Write it here is the other way', () => {
    const onConnectPhone = jest.fn();
    const onWriteHere = jest.fn();
    render(<OwnQuestionChoice onConnectPhone={onConnectPhone} onWriteHere={onWriteHere} />);
    fireEvent.click(screen.getByTestId('own-choice-phone'));
    expect(onConnectPhone).toHaveBeenCalled();
    expect(screen.getByText(OQ.writeHereLine)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('own-choice-here'));
    expect(onWriteHere).toHaveBeenCalled();
  });

  test('on one screen the door sits outside the private reveal, and the queue stays behind it', () => {
    render(<SessionSetupPanel onClose={() => {}} gameState="RESULTS#003" gameId="7924" initialTab="rounds" oneScreen onWriteQuestion={() => {}} questionQueue={['own:a1']} ownQuestions={[{ key: 'own:a1', title: 'Secret next question', status: 'queued' }]} />);
    expect(screen.getByTestId('queue-write-onescreen')).toBeInTheDocument();
    expect(screen.queryByText('Secret next question')).not.toBeInTheDocument();
  });

  test('the page opens the choice, not the fields, from any door on one screen', () => {
    const page = read('GameHostPage.jsx');
    expect(page).toMatch(/if \(mode === 'add' && !twoSurfaces && !skipChoice\) \{\s*setOwnChoiceOpen\(true\);/);
  });
});

/* ── 4. the queue's Yours rows ───────────────────────────────────────────── */

describe('a question of yours in the running order (D5, F3)', () => {
  const own = [{ key: 'own:a1', title: 'What would have to be true for us to ship?', status: 'queued' }];

  test('marked Yours in words, with Edit, earlier/later and Remove — and no Disable', () => {
    const onEditOwn = jest.fn();
    render(<QueueList queue={['own:a1', 'c001#005']} ownQuestions={own} onEditOwn={onEditOwn} onMove={() => {}} onRemove={() => {}} onDisable={() => {}} />);
    const row = screen.getAllByTestId('queue-row')[0];
    expect(row).toHaveAttribute('data-own', 'true');
    expect(within(row).getByTestId('yours-mark')).toHaveTextContent('Yours');
    expect(within(row).getByText(own[0].title)).toBeInTheDocument();
    expect(within(row).getByTestId('queue-next-flag')).toHaveTextContent('Next');
    expect(within(row).queryByLabelText(/disable/i)).not.toBeInTheDocument();
    expect(within(row).queryByText('Ask next')).not.toBeInTheDocument();
    fireEvent.click(within(row).getByTestId('queue-own-edit'));
    expect(onEditOwn).toHaveBeenCalledWith('own:a1', own[0]);
  });

  test('Remove arms in place, once, with Keep it — no second dialog', () => {
    const onRemoveOwn = jest.fn();
    render(<QueueList queue={['own:a1']} ownQuestions={own} onRemoveOwn={onRemoveOwn} />);
    fireEvent.click(screen.getByTestId('queue-own-remove'));
    expect(onRemoveOwn).not.toHaveBeenCalled();
    const arm = screen.getByTestId('queue-own-arm');
    expect(arm).toHaveTextContent(/It has not been asked, so nothing is lost but the words/);
    expect(screen.queryAllByRole('dialog')).toHaveLength(0);
    fireEvent.click(within(arm).getByText(OQ.keepIt));
    expect(screen.queryByTestId('queue-own-arm')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('queue-own-remove'));
    fireEvent.click(screen.getByTestId('queue-own-remove-confirm'));
    expect(onRemoveOwn).toHaveBeenCalledWith('own:a1', { title: own[0].title });
  });

  test('Rounds so far marks Yours on two screens, and not on one (F6)', () => {
    const rounds = [{ number: '004', ordinal: 4, title: 'What would have to be true…', own: true, answers: [] }];
    const { unmount } = render(<SessionSetupPanel onClose={() => {}} gameId="7924" gameState="RESULTS#004" initialTab="rounds" rounds={rounds} />);
    expect(screen.getAllByTestId('yours-mark').length).toBeGreaterThan(0);
    unmount();
    render(<SessionSetupPanel onClose={() => {}} gameId="7924" gameState="RESULTS#004" initialTab="rounds" rounds={rounds} oneScreen />);
    expect(screen.queryAllByTestId('yours-mark')).toHaveLength(0);
  });

  test('the confirmation says it is next and offers Undo', () => {
    const onOwnUndo = jest.fn();
    render(<SessionSetupPanel onClose={() => {}} gameId="7924" gameState="RESULTS#003" initialTab="rounds" ownNotice={{ text: OQ.isNext, rest: OQ.isNextRest, undoKey: 'own:a1' }} onOwnUndo={onOwnUndo} />);
    expect(screen.getByTestId('own-notice')).toHaveTextContent('Your question is next. It starts when you press Next round.');
    fireEvent.click(screen.getByTestId('own-undo'));
    expect(onOwnUndo).toHaveBeenCalled();
  });
});

/* ── 5. Your part now ────────────────────────────────────────────────────── */

describe('Your part now names it (R1)', () => {
  const part = { before: 'The read is done. Talk it through, then ', action: 'Next round', after: '.' };

  test('"Next round asks your question: \'…\'" when the head is yours and the main button advances', () => {
    const head = ownAtHead(['own:a1', 'c001#005'], [{ key: 'own:a1', title: 'What would have to be true to ship?', status: 'queued' }]);
    const next = withOwnNext(part, head, 'next');
    expect(`${next.before}${next.action}${next.after}`).toBe('The read is done. Next round asks your question: "What would have to be true to ship?"');
  });

  test('untouched when the head is a set question, or the button does not start a round', () => {
    expect(ownAtHead(['c001#005', 'own:a1'], [{ key: 'own:a1', title: 'x', status: 'queued' }])).toBeNull();
    const head = { key: 'own:a1', title: 'x' };
    expect(withOwnNext(part, head, 'finish')).toBe(part);
    expect(withOwnNext(part, null, 'next')).toBe(part);
  });

  test('a parked or already-asked own head is passed over', () => {
    expect(ownAtHead(['own:a1', 'own:b2'], [{ key: 'own:a1', status: 'asked' }, { key: 'own:b2', title: 'B', status: 'queued' }])).toEqual({ key: 'own:b2', title: 'B' });
  });

  test('Now is between rounds only; totals count your questions; Later carries the walk', () => {
    expect(ownNowAllowed('RESULTS#003')).toBe(true);
    expect(ownNowAllowed('CREATED')).toBe(true);
    expect(ownNowAllowed('ASK#003')).toBe(false);
    expect(ownNowAllowed('VOTE#003')).toBe(false);
    expect(withOwnRounds(12, [{ status: 'queued' }, { status: 'removed' }])).toBe(13);
    expect(withOwnRounds(undefined, [{ status: 'queued' }])).toBeUndefined();
    expect(laterAnchors([
      { key: 'own:a1', n: 4, title: 'Mine', source: 'own' },
      { key: 'c001#005', n: 5, title: 'Five', source: 'auto' },
      { key: 'c001#006', n: 6, title: 'Six', source: 'auto' },
    ])).toEqual([
      { key: 'own:a1', round: 4, title: 'Mine', through: [] },
      { key: 'c001#005', round: 5, title: 'Five', through: ['c001#005'] },
      { key: 'c001#006', round: 6, title: 'Six', through: ['c001#005', 'c001#006'] },
    ]);
  });

  test('the page feeds Your part now through withOwnNext, on two screens', () => {
    const page = read('GameHostPage.jsx');
    expect(page).toMatch(/const workflow = workflowRaw && ownHead && twoSurfaces/);
    expect(page).toMatch(/withOwnNext\(workflowRaw\.part, ownHead, hostControls\.primary && hostControls\.primary\.intent\)/);
  });
});

/* ── 6. the report ───────────────────────────────────────────────────────── */

describe('the report marks it Yours (D9, F5)', () => {
  const reportData = {
    gameId: '7924',
    eventTitle: 'Q4 planning retro',
    gameType: 'call-and-answer',
    players: [],
    questions: [{
      questionNumber: '004',
      questionData: {
        title: 'What would have to be true for us to ship the pilot by March?',
        detail: 'Think about people, money and the calendar.',
        category: '',
        customInstructions: 'Answer in a sentence or two.',
        own: {
          createdAt: '2026-11-02T10:42:00.000Z', createdByName: '', placement: 'next', placedAtRound: 3, placedAfterRound: null,
          note: 'Is the blocker budget or sign-off?',
        },
      },
      answers: [],
      aiSummary: null,
    }],
  };

  test('Yours beside the title, the source line, the line for the room and the labelled note', () => {
    render(<ReportDocument reportData={reportData} />);
    expect(screen.getAllByTestId('yours-mark').length).toBeGreaterThan(0);
    expect(screen.getByTestId('report-own-source')).toHaveTextContent(/Written by the host during the session, .*put next after round 3/);
    const own = screen.getByTestId('report-own');
    expect(own).toHaveTextContent(`${OQ.forTheRoom} Think about people, money and the calendar.`);
    expect(screen.getByTestId('report-own-note')).toHaveTextContent(`${OQ.hostNote} Is the blocker budget or sign-off?`);
    expect(own).toHaveTextContent(OQ.noSetMaterial);
  });

  test('Include my notes off: the note leaves the document (and so the PDF)', () => {
    render(<ReportDocument reportData={reportData} includeNotes={false} />);
    expect(screen.queryByTestId('report-own-note')).not.toBeInTheDocument();
    expect(screen.queryByText(/Is the blocker budget/)).not.toBeInTheDocument();
  });

  test('the source line reads Later and Now placements too', () => {
    expect(ownSourceLine({ placement: 'later', placedAfterRound: 5 })).toBe('Written by the host during the session · put after round 5');
    expect(ownSourceLine({ placement: 'next', placedAtRound: 0, createdByName: 'Dana' })).toBe('Written by Dana during the session · put first, before round 1');
  });
});

/* ── 7. Setup before round 1 ─────────────────────────────────────────────── */

describe('written in Setup before round 1 (F8, R5)', () => {
  test('First up shows Yours and how many of yours are queued', () => {
    render(
      <SessionSetup
        step="joins"
        choice="two"
        players={[]}
        firstUp="Round 1 · Before we start: what do you need from today?"
        firstUpOwn
        ownCount={2}
        onRunningOrder={() => {}}
        now={Date.parse('2026-11-03T09:00:00Z')}
      />,
    );
    expect(screen.getByTestId('yours-mark')).toHaveTextContent('Yours');
    expect(screen.getByTestId('setup-own-count')).toHaveTextContent('2 of yours queued');
  });
});

/* ── the stylesheets ─────────────────────────────────────────────────────── */

describe('the composer\'s stylesheet', () => {
  const css = read('components/OwnQuestionComposer.css').replace(/\/\*[\s\S]*?\*\//g, '');

  test('every selector is scoped to .oq', () => {
    const selectors = css.split('{').slice(0, -1).map((s) => s.split('}').pop().trim()).filter(Boolean);
    for (const sel of selectors) {
      for (const part of sel.split(',')) expect(part.trim()).toMatch(/^\.oq/);
    }
  });

  test('nothing below the 12px floor, inputs at body size, no raw colour, no --danger on text, no orange', () => {
    for (const m of css.matchAll(/font-size:\s*(\d+)px/g)) expect(Number(m[1])).toBeGreaterThanOrEqual(12);
    expect(css).toMatch(/--oq-t-body: 15px/);
    expect(css).toMatch(/\.oq-input, \.oq-select \{[^}]*font-size: var\(--oq-t-body\)/);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/color:\s*var\(--danger\)/);
    expect(css).not.toMatch(/var\(--primary\b|var\(--action\b/);
  });
});
