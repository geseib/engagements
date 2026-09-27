/**
 * THE QUEUE, WHERE THE HOST ACTUALLY PRESSES IT.
 *
 * Two halves, because the two failures are different.
 *
 * The FIRST half renders `SessionSetupPanel` and drives the browser rows. That
 * is a real render with real assertions — the panel was extracted precisely so
 * it could be one.
 *
 * The SECOND half reads `GameHostPage.jsx` as SOURCE. Not because the file
 * cannot be mounted — `GameHostPage.test.jsx` mounts it and passes, and the
 * claim that it cannot has been repeated in three comment blocks in this repo
 * while being false — but because what needs pinning here is WIRING: that a
 * prop is passed at all, that a WebSocket handler registered is also removed,
 * that the optimistic list is put back on failure. Mounting proves the panel
 * renders; it does not prove the page handed it the right function, and a
 * queue whose buttons call no-op defaults looks identical on screen.
 *
 * The source is COMMENT-STRIPPED. Every claim below is discussed in a comment
 * near the code it describes, so an un-stripped match passes against prose with
 * the code deleted. A previous agent's test in this repo did exactly that.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent, within } from '@testing-library/react';

jest.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value }) => <div data-testid="qr" data-value={value} />,
}));

import SessionSetupPanel from '../components/stage/SessionSetupPanel';

const categories = [{ name: 'Pricing Power' }, { name: 'Competitive Response' }];
const categoryCounts = { '1-8': [7, 9], '9-16': [], '17-24': [] };

const questions = [
  { id: 'q-1', title: 'Where does pricing power come from?', category: 'Pricing Power' },
  { id: 'q-2', title: 'A competitor cuts list price 20%. Your first move?', category: 'Competitive Response' },
];

const renderPanel = (props = {}) => render(
  <SessionSetupPanel
    onClose={() => {}}
    wsConnected
    gameState="LOBBY"
    categories={categories}
    categoryCounts={categoryCounts}
    questions={questions}
    gameId="4821"
    playUrl="https://e.example/play?gameId=4821"
    remoteUrl="https://e.example/remote?gameId=4821"
    profile="room"
    {...props}
  />,
);

const openQuestions = () => fireEvent.click(screen.getByRole('tab', { name: /questions/i }));

/** The browser row whose title contains `text`. */
const browserRow = (text) => screen.getAllByTestId('browser-row')
  .find((row) => row.textContent.includes(text));

describe('the queue on the questions tab', () => {
  test('the running order is on screen before the browser that fills it', () => {
    // rejects: putting the queue below sixty question rows, where a host would
    // scroll past everything they might add to reach what they already chose.
    // Document order is assertable in jsdom; geometry is not.
    const { container } = renderPanel();
    openQuestions();

    const queue = container.querySelector('.setup-q');
    const list = container.querySelector('.setup-qb__list');
    expect(queue).toBeTruthy();
    expect(list).toBeTruthy();
    // eslint-disable-next-line no-bitwise
    expect(queue.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('every browser row offers Queue, Ask next AND Ask now, least disruptive first', () => {
    // rejects: one button doing two jobs. The owner: "'ask next' in most
    // people's mind means put it at the top of the queue, not run it now" —
    // so the interrupt is `Ask now`, and `Ask next` is a queue op.
    renderPanel();
    openQuestions();

    for (const row of screen.getAllByTestId('browser-row')) {
      expect(within(row).getAllByRole('button').map((b) => b.textContent))
        .toEqual(['Queue', 'Ask next', 'Ask now']);
    }
  });

  test('Ask next puts the question at the top of the queue and does NOT ask it', () => {
    // rejects: the reported bug — "when you click a question to 'ask next' ...
    // it actually switches the game to that one."
    const onQueueFirst = jest.fn();
    const onSelectQuestion = jest.fn();
    renderPanel({ onQueueFirst, onSelectQuestion });
    openQuestions();

    fireEvent.click(within(browserRow('pricing power')).getByRole('button', { name: /^ask next$/i }));
    expect(onQueueFirst).toHaveBeenCalledWith('q-1');
    expect(onSelectQuestion).not.toHaveBeenCalled();
  });

  test('Ask now asks the question, and does not touch the queue', () => {
    const onQueueFirst = jest.fn();
    const onQueueQuestion = jest.fn();
    const onSelectQuestion = jest.fn();
    renderPanel({ onQueueFirst, onQueueQuestion, onSelectQuestion });
    openQuestions();

    fireEvent.click(within(browserRow('pricing power')).getByRole('button', { name: /^ask now$/i }));
    expect(onSelectQuestion).toHaveBeenCalledWith(questions[0]);
    expect(onQueueFirst).not.toHaveBeenCalled();
    expect(onQueueQuestion).not.toHaveBeenCalled();
  });

  test('Ask next is held on the question already at the top', () => {
    renderPanel({ questionQueue: ['q-1', 'q-2'] });
    openQuestions();
    expect(within(browserRow('pricing power')).getByRole('button', { name: /^ask next$/i })).toBeDisabled();
    expect(within(browserRow('competitor')).getByRole('button', { name: /^ask next$/i })).toBeEnabled();
  });

  test('an asked question can only be asked again now — the drain drops asked entries', () => {
    // rejects: a Queue or Ask next on an asked question, which next-question.js
    // would silently drop at the end of the round.
    renderPanel({ usedQuestionIds: ['q-1'] });
    openQuestions();
    const row = browserRow('pricing power');
    expect(within(row).getByRole('button', { name: /^queue$/i })).toBeDisabled();
    expect(within(row).getByRole('button', { name: /^ask next$/i })).toBeDisabled();
    expect(within(row).getByRole('button', { name: /^ask again now$/i })).toBeEnabled();
  });

  test('the running order\'s rows ask next and ask now too, through the same two props', () => {
    // The queue rows raise keys; Ask now finds the loaded question for the key,
    // so the page has ONE ask-now path, not one per list.
    const onQueueFirst = jest.fn();
    const onSelectQuestion = jest.fn();
    renderPanel({ questionQueue: ['q-1', 'q-2'], onQueueFirst, onSelectQuestion });
    openQuestions();
    const rows = screen.getAllByTestId('queue-row');

    fireEvent.click(within(rows[1]).getByRole('button', { name: /^ask next/i }));
    expect(onQueueFirst).toHaveBeenCalledWith('q-2', expect.anything());
    expect(onSelectQuestion).not.toHaveBeenCalled();

    fireEvent.click(within(rows[1]).getByRole('button', { name: /^ask now/i }));
    expect(onSelectQuestion).toHaveBeenCalledWith(questions[1]);
  });

  test('Queue hands back the whole question, not just its id', () => {
    // rejects: passing `row.id`. The row is a redacted PROJECTION that
    // deliberately carries no correct answer; the caller needs the original to
    // hand `next-question` something it will accept.
    const onQueueQuestion = jest.fn();
    renderPanel({ onQueueQuestion });
    openQuestions();

    fireEvent.click(within(browserRow('pricing power')).getByRole('button', { name: /^queue$/i }));
    expect(onQueueQuestion).toHaveBeenCalledWith(questions[0]);
  });

  test('Queue does NOT ask the question', () => {
    // rejects: wiring Queue to `onSelectQuestion`. That is the entire feature —
    // the owner's complaint was *"no matter where you are it forward to that
    // question"*. A Queue button that jumps is worse than no Queue button.
    const onSelectQuestion = jest.fn();
    renderPanel({ onSelectQuestion });
    openQuestions();

    fireEvent.click(within(browserRow('pricing power')).getByRole('button', { name: /^queue$/i }));
    expect(onSelectQuestion).not.toHaveBeenCalled();
  });

  test('a queued row shows its position and offers Unqueue', () => {
    // rejects: a control reading "Queued #2" that removes on press. A button
    // must say what pressing it DOES; the position belongs in the tag, which is
    // the same pill idiom as Asked and Off.
    renderPanel({ questionQueue: ['q-2', 'q-1'] });
    openQuestions();

    const row = browserRow('pricing power');
    expect(within(row).getByTestId('browser-queued-tag')).toHaveTextContent('Queued #2');
    expect(within(row).getByRole('button', { name: /unqueue/i })).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: /^queue$/i })).not.toBeInTheDocument();
  });

  test('Unqueue removes by key rather than re-adding', () => {
    // rejects: a toggle that calls `onQueueQuestion` both ways, which would
    // re-add the row it was meant to clear.
    const onQueueRemove = jest.fn();
    const onQueueQuestion = jest.fn();
    renderPanel({ questionQueue: ['q-1'], onQueueRemove, onQueueQuestion });
    openQuestions();

    fireEvent.click(within(browserRow('pricing power')).getByRole('button', { name: /unqueue/i }));
    expect(onQueueRemove).toHaveBeenCalledWith('q-1');
    expect(onQueueQuestion).not.toHaveBeenCalled();
  });

  test('a row with a queue request in flight cannot be pressed again', () => {
    // rejects: leaving the control live through its own round trip, which turns
    // an impatient double-tap into two ops.
    renderPanel({ queueBusyKeys: ['q-1'] });
    openQuestions();

    expect(within(browserRow('pricing power')).getByRole('button', { name: /^queue$/i })).toBeDisabled();
    expect(within(browserRow('competitor')).getByRole('button', { name: /^queue$/i })).toBeEnabled();
  });

  test('Ask now stays reachable on a queued row', () => {
    // rejects: disabling the interrupt once a question is queued. A host who
    // queued something and then decided to ask it now must not have to unqueue
    // it first — that is two presses to undo their own good intention.
    const onSelectQuestion = jest.fn();
    renderPanel({ questionQueue: ['q-1'], onSelectQuestion });
    openQuestions();

    fireEvent.click(within(browserRow('pricing power')).getByRole('button', { name: /^ask now$/i }));
    expect(onSelectQuestion).toHaveBeenCalledWith(questions[0]);
  });

  test('the panel reorders nothing itself', () => {
    // rejects: a second optimistic copy inside the panel. `GameHostPage` owns
    // the optimistic update because it owns the WebSocket that corrects it;
    // a panel-local one would re-apply on the frame that IS its own edit
    // coming home, and the row would move twice.
    const onQueueMove = jest.fn();
    renderPanel({ questionQueue: ['q-1', 'q-2'], onQueueMove });
    openQuestions();

    const before = screen.getAllByTestId('queue-row').map((r) => r.textContent);
    fireEvent.click(screen.getAllByTestId('queue-row')[1]
      .querySelector('button[aria-label*="earlier"]'));

    expect(onQueueMove).toHaveBeenCalledWith('q-2', 'earlier');
    expect(screen.getAllByTestId('queue-row').map((r) => r.textContent)).toEqual(before);
  });
});

/* --------------------------------------------------------------- the page --- */

function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/([^:'"`\\])\/\/.*$/gm, '$1');
}

const host = stripComments(
  fs.readFileSync(path.join(__dirname, '..', 'GameHostPage.jsx'), 'utf8'),
);

describe('the page wires the queue up', () => {
  test('all six queue props reach the panel', () => {
    // rejects: the feature shipping as dead code. Every prop here defaults to a
    // no-op in the panel, so a forgotten one renders an identical screen whose
    // buttons do nothing — and every panel test above still passes.
    for (const prop of ['questionQueue', 'queueBusyKeys', 'onQueueQuestion', 'onQueueFirst', 'onQueueMove', 'onQueueRemove']) {
      expect(host).toMatch(new RegExp(`${prop}=\\{`));
    }
  });

  test('Ask next is the `first` queue op, run through the optimistic runner', () => {
    // rejects: Ask next wired to selectQuestion — the reported bug — or to a
    // bespoke fetch that skips the rollback and the reconcile runQueueOp does.
    expect(host).toMatch(/onQueueFirst=\{handleQueueFirst\}/);
    expect(host).toMatch(/const handleQueueFirst = useCallback\(\s*\(key\) => runQueueOp\('first', key, \(q\) => queueFirst\(q, key\)\)/);
    expect(host).toMatch(/onSelectQuestion=\{selectQuestion\}/);
  });

  test('Ask now mid-round confirms, and points at Ask next', () => {
    // The stage's guard for jumping rounds, with the reversible neighbour named.
    expect(host).toMatch(/showConfirmation\(\s*'Ask this question now\?'[\s\S]{0,200}use Ask next/);
  });

  test('an op that the local rules refuse is never sent', () => {
    // rejects: posting every press. `earlier` on the head row would be a
    // request whose answer arrives after the host has moved on, re-rendering a
    // list they have since changed.
    expect(host).toMatch(/if\s*\(!local\.changed\)\s*\{/);
  });

  test('a failed op puts the list back', () => {
    // rejects: leaving an optimistic move on screen after the write failed.
    // The host would end the round expecting the question they "moved" to the
    // top and get the one that was really there — in front of a room.
    expect(host).toMatch(/if\s*\(!result\.ok\)\s*\{\s*setQuestionQueue\(before\)/);
  });

  test('the queue is re-read when a round starts', () => {
    // rejects: relying on a broadcast that does not exist. `next-question.js`
    // pops the head it serves but does NOT announce `questionQueueChanged` for
    // that write, so without this the question now on the room's screen also
    // sits at #1 in the host's queue.
    expect(host).toMatch(/onMessage\('questionStarted'[\s\S]{0,400}loadQueue\(\)/);
  });

  test('the queue frame is registered AND removed', () => {
    // rejects: a handler that outlives its session and fires with a stale
    // closure — the exact defect the registered/removed symmetry check in
    // hostControls.test.js was written for, after `gameEnded` shipped with one
    // half missing.
    expect(host).toMatch(/onMessage\('questionQueueChanged'/);
    expect(host).toMatch(/offMessage\('questionQueueChanged'\)/);
  });

  test('an empty queue in a frame is applied, and a missing one is ignored', () => {
    // rejects: `data.queue || []`, which turns "this frame says nothing about
    // the queue" into "the queue is empty" and wipes the host's running order
    // on any unrelated malformed frame. A host who just emptied the queue must
    // still see it empty, so the two cases have to be told apart.
    expect(host).toMatch(/data\?\.queue\s*\?\?\s*null/);
    expect(host).toMatch(/if\s*\(!Array\.isArray\(list\)\)\s*return/);
  });
});
