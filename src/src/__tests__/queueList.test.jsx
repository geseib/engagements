/**
 * THE RUNNING ORDER — components/stage/QueueList.jsx, rendered.
 *
 * A real render, because the component is presentational and takes every action
 * as a prop, which is the whole reason it was extracted from the panel.
 *
 * NO GEOMETRIC ASSERTIONS. jsdom has no layout engine, so every width, offset
 * and overflow reads zero and passes unconditionally. What CAN be pinned is
 * document order, roles, accessible names, disabled state — and, separately,
 * the CSS as TEXT. The stylesheet block at the bottom does the second thing,
 * and it reads COMMENT-STRIPPED source: a comment that quotes a declaration
 * satisfies a naive `indexOf` and the assertion passes with the rule deleted.
 * That exact mutant survived once already this month.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent, within } from '@testing-library/react';
import QueueList from '../components/stage/QueueList';
import { QUEUE_MAX } from '../config/questionQueue';

const questions = [
  { id: 'c001#001', title: 'Where does pricing power come from?', category: 'Pricing Power' },
  { id: 'c001#002', title: 'What would a rival do first?', category: 'Competitive Response' },
  { id: 'c002#001', title: 'Which bundle wins?', category: 'Packaging' },
];

const rowNames = () => screen.getAllByTestId('queue-row')
  .map((row) => within(row).getByText(/\?|c\d/).textContent);

describe('an empty running order', () => {
  test('it still renders, and states the difference between Queue and Ask next', () => {
    // rejects: hiding the section until something is queued. A feature that is
    // invisible until it is already in use is one nobody finds — the exact
    // report the owner made about the help entry point ("i dont see the help
    // anywhere"), and the empty line is the ONLY place this distinction is
    // stated anywhere in the product.
    render(<QueueList queue={[]} questions={questions} />);

    expect(screen.getByRole('heading', { name: /running order/i })).toBeInTheDocument();
    const empty = screen.getByTestId('queue-empty');
    expect(empty).toHaveTextContent(/Queue.*running order/i);
    expect(empty).toHaveTextContent(/waits until you end the current round/i);
    expect(empty).toHaveTextContent(/Ask next.*straight away/i);
    expect(screen.queryByTestId('queue-list')).not.toBeInTheDocument();
  });

  test('the count says nothing is queued rather than "0"', () => {
    // rejects: a bare 0, which reads as a broken counter rather than a state.
    render(<QueueList queue={[]} questions={questions} />);
    expect(screen.getByTestId('queue-count')).toHaveTextContent(/nothing queued/i);
  });
});

describe('a populated running order', () => {
  const renderQueue = (props = {}) => {
    const onMove = jest.fn();
    const onRemove = jest.fn();
    render(
      <QueueList
        queue={['c001#002', 'c002#001', 'c001#001']}
        questions={questions}
        onMove={onMove}
        onRemove={onRemove}
        {...props}
      />,
    );
    return { onMove, onRemove };
  };

  test('rows appear in queue order, not in question order', () => {
    // rejects: rendering `questions` and filtering, which loses the ordering
    // that IS the feature. The fixture queue is deliberately not the fixture
    // question order, so a sort-by-source implementation fails here.
    renderQueue();
    expect(rowNames()).toEqual([
      'What would a rival do first?',
      'Which bundle wins?',
      'Where does pricing power come from?',
    ]);
  });

  test('only the head row is flagged Next', () => {
    // rejects: flagging by colour alone, or flagging every row. "What happens
    // when I press Next?" is the one question this list answers mid-session.
    renderQueue();
    const flags = screen.getAllByTestId('queue-next-flag');
    expect(flags).toHaveLength(1);
    const rows = screen.getAllByTestId('queue-row');
    expect(rows[0]).toContainElement(flags[0]);
  });

  test('the head cannot move earlier and the tail cannot move later', () => {
    // rejects: an unclamped move. `queueMove` refuses both, and a button that
    // is live while the server refuses is a button that does nothing.
    renderQueue();
    const rows = screen.getAllByTestId('queue-row');

    expect(within(rows[0]).getByRole('button', { name: /move .* earlier/i })).toBeDisabled();
    expect(within(rows[0]).getByRole('button', { name: /move .* later/i })).toBeEnabled();
    expect(within(rows[2]).getByRole('button', { name: /move .* earlier/i })).toBeEnabled();
    expect(within(rows[2]).getByRole('button', { name: /move .* later/i })).toBeDisabled();
  });

  test('the edge buttons are DISABLED, never removed', () => {
    // rejects: conditionally rendering the arrows. Every row must carry the
    // same three controls or the action column changes width per row and the
    // buttons move under the host's finger as the list reorders.
    renderQueue();
    for (const row of screen.getAllByTestId('queue-row')) {
      expect(within(row).getAllByRole('button')).toHaveLength(3);
    }
  });

  test('moving and removing report the KEY and the direction', () => {
    // rejects: handing back the row index. An index is meaningless to a server
    // replaying an op against a list it read a moment later.
    const { onMove, onRemove } = renderQueue();
    const rows = screen.getAllByTestId('queue-row');

    fireEvent.click(within(rows[1]).getByRole('button', { name: /move .* earlier/i }));
    expect(onMove).toHaveBeenCalledWith('c002#001', 'earlier');

    fireEvent.click(within(rows[0]).getByRole('button', { name: /move .* later/i }));
    expect(onMove).toHaveBeenCalledWith('c001#002', 'later');

    fireEvent.click(within(rows[2]).getByRole('button', { name: /remove .* from the queue/i }));
    expect(onRemove).toHaveBeenCalledWith('c001#001');
  });

  test('a row with a request in flight has all three controls disabled', () => {
    // rejects: leaving the row live during the round trip, which lets three
    // taps on ↑ send three ops for one intent and travel the row three places.
    renderQueue({ busyKeys: ['c002#001'] });
    const rows = screen.getAllByTestId('queue-row');

    for (const button of within(rows[1]).getAllByRole('button')) {
      expect(button).toBeDisabled();
    }
    // And ONLY that row: a global lock would freeze the whole list on one press.
    expect(within(rows[0]).getByRole('button', { name: /move .* later/i })).toBeEnabled();
  });

  test('busy keys match through either spelling of a question id', () => {
    // rejects: a raw Set membership test. Both `QUESTION#c001#002` and the bare
    // form are on the wire (setupPanel.js:154 records what that already cost),
    // so a busy key arriving prefixed must still find its row.
    renderQueue({ busyKeys: ['QUESTION#c001#002'] });
    const rows = screen.getAllByTestId('queue-row');
    expect(within(rows[0]).getByRole('button', { name: /remove/i })).toBeDisabled();
  });
});

describe('a queued question we cannot resolve', () => {
  test('the row stays, shows its key, and says why', () => {
    // rejects: dropping unresolved keys. The server still holds the entry and
    // will still try to serve it; hiding the row removes the host's own choice
    // from the only surface that could take it back off the list.
    render(<QueueList queue={['c001#001', 'c009#404']} questions={questions} />);

    const rows = screen.getAllByTestId('queue-row');
    expect(rows).toHaveLength(2);
    expect(rows[1]).toHaveTextContent('c009#404');
    expect(rows[1]).toHaveTextContent(/not in this set/i);
  });

  test('it is still removable', () => {
    // rejects: disabling the controls on an unresolved row, which would make a
    // stale entry permanent — the one row a host most needs to clear.
    const onRemove = jest.fn();
    render(<QueueList queue={['c009#404']} questions={questions} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button', { name: /remove .* from the queue/i }));
    expect(onRemove).toHaveBeenCalledWith('c009#404');
  });
});

describe('the cap', () => {
  const full = Array.from({ length: QUEUE_MAX }, (_, n) => `c001#${String(n + 1).padStart(3, '0')}`);

  test('a full queue says so, with the number and the way out', () => {
    // rejects: a silent cap. A host pressing Queue on a 25th question gets a
    // refusal from the server either way; this is what tells them why.
    render(<QueueList queue={full} questions={questions} />);
    const notice = screen.getByTestId('queue-full');
    expect(notice).toHaveTextContent(String(QUEUE_MAX));
    expect(notice).toHaveTextContent(/remove one/i);
  });

  test('the cap is not advertised while it is far away', () => {
    // rejects: a permanent "1 of 24", which teaches a limit that will never be
    // reached and states a second fact about the same object.
    render(<QueueList queue={['c001#001']} questions={questions} />);
    expect(screen.getByTestId('queue-count')).toHaveTextContent('1 queued');
    expect(screen.getByTestId('queue-count')).not.toHaveTextContent(String(QUEUE_MAX));
    expect(screen.queryByTestId('queue-full')).not.toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ CSS --- */

/**
 * Comment-stripped stylesheet source.
 *
 * Every rule this block asserts is quoted in a comment somewhere above it in
 * styles.css — that is what good comments do — so an un-stripped `indexOf`
 * matches the comment and passes with the declaration deleted. Mutation M12
 * survived on exactly that.
 */
const CSS = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

/** The declarations inside one selector's block. */
function block(selector) {
  const at = CSS.indexOf(`${selector} {`);
  if (at === -1) return '';
  return CSS.slice(at, CSS.indexOf('}', at));
}

describe('the stylesheet contract', () => {
  test('the queue name truncates as a single text node with min-width: 0', () => {
    // rejects: hard rule 8. `text-overflow` is INERT on a flex container with
    // span children — the text is silently cut with no ellipsis to say it was.
    // A truncated question title with no sign of truncation is rule 7's
    // "reduction with no recovery", on the row a host chooses from.
    const name = block('.setup-q__name');
    expect(name).toMatch(/display:\s*block/);
    expect(name).toMatch(/min-width:\s*0/);
    expect(name).toMatch(/text-overflow:\s*ellipsis/);
    expect(name).toMatch(/overflow:\s*hidden/);
  });

  test('a disabled queue button dims rather than disappearing', () => {
    // rejects: `display: none` on :disabled, which changes the action column's
    // width per row and moves the remaining buttons under the host's finger.
    const disabled = block('.setup-q__btn:disabled');
    expect(disabled).toMatch(/opacity:/);
    expect(disabled).not.toMatch(/display:\s*none/);
    expect(disabled).not.toMatch(/visibility:\s*hidden/);
  });

  test('the browser row action group wraps', () => {
    // rejects: a nowrap group. `.setup-qb__row` is a two-column grid whose
    // second column is `auto`, so an action group that will not wrap widens
    // that column and eats the question text — the one thing on the row that
    // is being read.
    expect(block('.setup-qb__acts')).toMatch(/flex-wrap:\s*wrap/);
  });

  test('nothing in the queue block paints with --danger', () => {
    // rejects: `color: var(--danger)`. #E5645E is 4.38:1 on --surface and
    // 3.56:1 on --surface-2 — under AA. `--danger-text` exists for copy.
    for (const selector of ['.setup-q__warn', '.setup-q__full', '.setup-q__btn--drop:hover:not(:disabled)']) {
      expect(block(selector)).not.toMatch(/color:\s*var\(--danger[,)]/);
    }
    expect(block('.setup-q__warn')).toMatch(/var\(--danger-text/);
  });

  test('nothing in the queue block is below the 12px floor', () => {
    // rejects: shrinking the position number or the meta line to fit. The
    // console's floor is 12px and these are glanced, which is what the floor is
    // FOR — not a reason to go under it.
    const sizes = [...CSS.matchAll(/\.setup-q__[a-z-]+[^{]*\{[^}]*font-size:\s*(\d+)px/g)]
      .map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(0);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(12);
  });
});

/* ========================================================================== */

describe('what follows the queue — the automatic picks', () => {
  const plan = [
    { source: 'auto', questionId: 'QUESTION#c001#003', title: 'Third', categoryName: 'Pricing', round: 1 },
    { source: 'auto', questionId: 'QUESTION#c002#001', title: 'Fourth', categoryName: 'Packaging', round: 2 },
  ];

  test('with an empty queue it still shows what is coming', () => {
    /*
      THE REQUEST, LITERALLY: "offer the up next to show the next several
      questions even if its just the built in queue". A host who has queued
      nothing is the COMMON case — most sessions never touch the queue — so if
      the preview only appeared once something was queued, most hosts would
      never see it at all.
    */
    render(<QueueList queue={[]} questions={questions} upNext={plan} />);
    expect(screen.getByTestId('queue-auto')).toBeInTheDocument();
    expect(screen.getAllByTestId('queue-auto-row')).toHaveLength(2);
    expect(screen.getByText('Coming up')).toBeInTheDocument();
  });

  test('the empty-queue explainer survives beside it', () => {
    // rejects: the preview replacing the empty state. That line is the only
    // place the difference between Queue and Ask next is stated.
    render(<QueueList queue={[]} questions={questions} upNext={plan} />);
    expect(screen.getByTestId('queue-empty')).toBeInTheDocument();
  });

  test('with a queue it reads as the continuation, not a second list', () => {
    render(<QueueList queue={['c001#001']} questions={questions} upNext={plan} />);
    expect(screen.getByText('Then, automatically')).toBeInTheDocument();
  });

  test('every automatic row is tagged, and no queued row is', () => {
    /*
      "might create a obvious tag when the user queued it up just to
      distinguish." The tag sits on the AUTOMATIC rows: the queued ones already
      announce themselves by being numbered, movable, and under a heading that
      says Running order. It is the questions the host did not pick that need
      saying so.
    */
    render(<QueueList queue={['c001#001']} questions={questions} upNext={plan} />);
    expect(screen.getAllByText('Auto')).toHaveLength(2);
    for (const row of screen.getAllByTestId('queue-row')) {
      expect(within(row).queryByText('Auto')).not.toBeInTheDocument();
    }
  });

  test('the server\'s copy of the QUEUED items is not rendered a second time', () => {
    /*
      rejects: rendering the whole plan. The endpoint returns queued items AND
      automatic ones; the queued half is already drawn above from the QUEUE
      record, which is the copy the host can edit. Drawing the server's copy too
      states one fact about one object twice — which this console's own rule
      forbids — and the two disagree for the length of a round trip every time
      the host reorders.
    */
    render(
      <QueueList
        queue={['c001#001']}
        questions={questions}
        upNext={[
          { source: 'queued', questionId: 'QUESTION#c001#001', title: 'First', round: 1 },
          ...plan,
        ]}
      />,
    );
    expect(screen.getAllByTestId('queue-auto-row')).toHaveLength(2);
    expect(screen.getAllByTestId('queue-row')).toHaveLength(1);
  });

  test('automatic rows carry no reorder controls', () => {
    // rejects: arrows that cannot work. These are DERIVED — there is no stored
    // order to reorder — so the way to move one is to queue it.
    render(<QueueList queue={[]} questions={questions} upNext={plan} />);
    for (const row of screen.getAllByTestId('queue-auto-row')) {
      expect(within(row).queryAllByRole('button')).toHaveLength(0);
    }
  });

  test('no plan means no section at all', () => {
    // rejects: an empty bordered box captioned "Coming up" with nothing in it.
    render(<QueueList queue={[]} questions={questions} upNext={[]} />);
    expect(screen.queryByTestId('queue-auto')).not.toBeInTheDocument();
  });

  test('a row with no title falls back to its id, never to a placeholder', () => {
    // Same rule the queued rows follow: "Untitled" is a claim about the
    // question; the id is the only true thing we hold.
    render(<QueueList queue={[]} questions={questions} upNext={[
      { source: 'auto', questionId: 'QUESTION#c009#404', title: '', round: 1 },
    ]} />);
    expect(screen.getByText('QUESTION#c009#404')).toBeInTheDocument();
  });
});

describe('the automatic rows are subordinate, not disabled', () => {
  test('they are dimmed well above the disabled level', () => {
    /*
      rejects: reusing the disabled opacity. These rows are a PREDICTION and the
      queued ones are a DECISION, which is a difference worth showing — but
      nothing here is broken or unavailable, and painting them at the disabled
      value would say it was.
    */
    const rule = block('.setup-q__row--auto');
    const opacity = Number((/opacity:\s*([\d.]+)/.exec(rule) || [])[1]);
    expect(opacity).toBeGreaterThan(0.6);
    expect(opacity).toBeLessThan(1);
  });

  test('they drop the action column rather than leaving it empty', () => {
    // rejects: keeping the queued row's three-track grid. With no buttons to
    // fill it, every automatic title would be short by the width of three
    // missing controls and the two lists would not line up.
    expect(block('.setup-q__row--auto')).toMatch(/grid-template-columns:\s*auto\s+minmax\(0,\s*1fr\)\s*;/);
  });

  test('the Auto tag does not compete with the Next flag for the eye', () => {
    // rejects: a second --primary label. The Next flag is the one thing on this
    // panel that should catch the eye, and a rival amber would flatten the
    // distinction the colour exists to make.
    expect(block('.setup-q__flag--auto')).toMatch(/var\(--muted/);
    expect(block('.setup-q__flag--auto')).not.toMatch(/var\(--primary/);
  });
});
