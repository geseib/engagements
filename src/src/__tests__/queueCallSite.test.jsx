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

  test('every browser row offers Queue AND Ask next', () => {
    // rejects: replacing `Ask next` with `Queue`. They are different actions —
    // one interrupts the room, one does not — and the owner asked for the
    // second WITHOUT losing the first.
    renderPanel();
    openQuestions();

    for (const row of screen.getAllByTestId('browser-row')) {
      expect(within(row).getByRole('button', { name: /^queue$/i })).toBeInTheDocument();
      expect(within(row).getByRole('button', { name: /ask next/i })).toBeInTheDocument();
    }
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

  test('Ask next stays reachable on a queued row', () => {
    // rejects: disabling the interrupt once a question is queued. A host who
    // queued something and then decided to ask it now must not have to unqueue
    // it first — that is two presses to undo their own good intention.
    const onSelectQuestion = jest.fn();
    renderPanel({ questionQueue: ['q-1'], onSelectQuestion });
    openQuestions();

    fireEvent.click(within(browserRow('pricing power')).getByRole('button', { name: /ask next/i }));
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
  test('all five queue props reach the panel', () => {
    // rejects: the feature shipping as dead code. Every prop here defaults to a
    // no-op in the panel, so a forgotten one renders an identical screen whose
    // buttons do nothing — and every panel test above still passes.
    for (const prop of ['questionQueue', 'queueBusyKeys', 'onQueueQuestion', 'onQueueMove', 'onQueueRemove']) {
      expect(host).toMatch(new RegExp(`${prop}=\\{`));
    }
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
