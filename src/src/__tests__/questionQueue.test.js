/**
 * The queue rules, as the BROWSER loads them.
 *
 * `tests/question-queue-order.js` already runs a fixture table through this
 * module and its Lambda mirror and fails if they disagree — but it gets at the
 * ESM copy by reading the file and stripping its `import`/`export` keywords,
 * because plain `node` cannot require ESM out of `src/`. That loader proves the
 * RULES; it cannot prove the file is a module the bundle can actually import.
 *
 * So this suite exists for the one thing only a real import can establish: that
 * `questionQueue.js` resolves, that `questionKey` really does come from
 * `setupPanel.js` rather than a local re-implementation (R1), and that the
 * names the two host surfaces will reach for are exported under those names.
 * The rule assertions below are the headline ones, deliberately not the whole
 * table — a second copy of the table is a second thing to keep in step, which
 * is the exact failure this module is built to avoid.
 */
import {
  QUEUE_MAX,
  QUEUE_OPS,
  normaliseQueue,
  queueEnqueue,
  queueRemove,
  queueMove,
  queueDrop,
  applyQueueOp,
  queuePosition,
  queueRows,
  queueSummary,
  materializePlanOps,
} from '../config/questionQueue';
import { questionKey } from '../config/setupPanel';

describe('the module the bundle actually loads', () => {
  test('exports every name the host surfaces call', () => {
    expect(typeof normaliseQueue).toBe('function');
    expect(typeof queueEnqueue).toBe('function');
    expect(typeof queueRemove).toBe('function');
    expect(typeof queueMove).toBe('function');
    expect(typeof queueDrop).toBe('function');
    expect(typeof applyQueueOp).toBe('function');
    expect(typeof queuePosition).toBe('function');
    expect(typeof queueRows).toBe('function');
    expect(typeof queueSummary).toBe('function');
  });

  test('the cap is the same 24 the host masks hold', () => {
    expect(QUEUE_MAX).toBe(24);
  });

  test('QUEUE_OPS is closed to the four the endpoint accepts', () => {
    expect(QUEUE_OPS).toEqual(['add', 'remove', 'earlier', 'later']);
  });
});

describe('R1 — one spelling, and it is setupPanel\'s', () => {
  test('a key is stored exactly as questionKey normalises it', () => {
    // Not `toBe('c005#001')`. Written against questionKey itself so that if the
    // canonical spelling ever changes, this suite follows it instead of pinning
    // a literal that would then be the ONLY place still using the old form.
    const stored = queueEnqueue([], 'QUESTION#c005#001').queue[0];
    expect(stored).toBe(questionKey('QUESTION#c005#001'));
  });

  test('the prefixed and bare spellings are one question, not two', () => {
    const first = queueEnqueue([], 'c005#001');
    const second = queueEnqueue(first.queue, 'QUESTION#c005#001');
    expect(second.changed).toBe(false);
    expect(second.refused).toBe('duplicate');
    expect(second.queue).toHaveLength(1);
  });
});

describe('R3/R4 — one step, clamped, as a swap', () => {
  const five = ['q1', 'q2', 'q3', 'q4', 'q5'];

  test('moving the fourth earlier swaps it with the third', () => {
    expect(queueMove(five, 'q4', 'earlier').queue)
      .toEqual(['q1', 'q2', 'q4', 'q3', 'q5']);
  });

  test('the head cannot go earlier, and does NOT wrap to the tail', () => {
    const result = queueMove(five, 'q1', 'earlier');
    expect(result.changed).toBe(false);
    expect(result.queue).toBe(five);
  });

  test('the tail cannot go later, and does NOT wrap to the head', () => {
    const result = queueMove(five, 'q5', 'later');
    expect(result.changed).toBe(false);
    expect(result.queue).toBe(five);
  });
});

describe('R5 — a stale surface cannot resurrect a removed question', () => {
  test.each(['remove', 'earlier', 'later'])(
    '%s on a key that is not queued leaves the queue untouched',
    (op) => {
      const queue = ['q1', 'q2'];
      const result = applyQueueOp(queue, { op, questionKey: 'gone' });
      expect(result.changed).toBe(false);
      expect(result.queue).toBe(queue);
    }
  );
});

describe('R6/R7 — refusals say why', () => {
  const full = Array.from({ length: 24 }, (_, i) => `q${i + 1}`);

  test('the 25th add is refused as full', () => {
    expect(applyQueueOp(full, { op: 'add', questionKey: 'q25' }))
      .toEqual({ queue: full, changed: false, refused: 'full' });
  });

  test('an op this build has never heard of is refused by name', () => {
    expect(applyQueueOp(full, { op: 'shuffle', questionKey: 'q1' }).refused)
      .toBe('unknown-op');
  });
});

describe('the read-only projections a panel will render from', () => {
  test('rows decide the edges so no component re-derives them', () => {
    const rows = queueRows(['a', 'b'], { questions: [{ id: 'QUESTION#a', title: 'Ay' }] });
    expect(rows.map((r) => [r.position, r.canMoveEarlier, r.canMoveLater]))
      .toEqual([[1, false, true], [2, true, false]]);
    // A queued key the caller could not resolve is still the host's own choice
    // and still on the server, so it renders as a row rather than vanishing.
    expect(rows[1].missing).toBe(true);
    expect(rows[0].title).toBe('Ay');
  });

  test('summary names what the next end-of-round will serve', () => {
    expect(queueSummary(['a', 'b'])).toEqual({
      count: 2, remaining: 22, full: false, nextKey: 'a',
    });
  });

  test('position is 1-based, and 0 means not queued', () => {
    expect(queuePosition(['a', 'b'], 'b')).toBe(2);
    expect(queuePosition(['a', 'b'], 'z')).toBe(0);
  });

  test('a stored queue is cleaned without being truncated', () => {
    // Junk goes; the cap does NOT apply on read. Truncating here would silently
    // delete the host's last choices every time anything looked at the list.
    expect(normaliseQueue(['a', '', null, 'a', 'b'])).toEqual(['a', 'b']);
    const long = Array.from({ length: 30 }, (_, i) => `q${i + 1}`);
    expect(normaliseQueue(long)).toHaveLength(30);
  });

  test('drop is the server\'s removal and takes several at once', () => {
    expect(queueDrop(['a', 'b', 'c'], ['a', 'c']).queue).toEqual(['b']);
    expect(queueRemove(['a', 'b'], 'a').queue).toEqual(['b']);
  });
});

describe('moving an auto row materialises the plan — the owner\'s own semantics', () => {
  /*
    "if there was Q1 - A Q2 - B and Q3 - C. and i move B to the bottom in a way
    all of them now are manually adjusted. that may not make a difference."
    The auto rows are a simulation with no stored order, so the gesture turns
    the DISPLAYED plan into queued rows and then applies the one-step move —
    expressed as ordinary QUEUE_OPS so the server's race handling still holds.
  */
  test('an empty queue: A,B,C with B moved later becomes adds then the move', () => {
    const { ops, queue, refused } = materializePlanOps([], ['a', 'b', 'c'], 'b', 'later');
    expect(refused).toBeNull();
    expect(ops).toEqual([
      { op: 'add', questionKey: 'a' },
      { op: 'add', questionKey: 'b' },
      { op: 'add', questionKey: 'c' },
      { op: 'later', questionKey: 'b' },
    ]);
    expect(queue).toEqual(['a', 'c', 'b']);
  });

  test('existing queued rows stay ahead, and are not re-added', () => {
    const { ops, queue } = materializePlanOps(['q1'], ['a', 'b'], 'a', 'later');
    expect(ops).toEqual([
      { op: 'add', questionKey: 'a' },
      { op: 'add', questionKey: 'b' },
      { op: 'later', questionKey: 'a' },
    ]);
    expect(queue).toEqual(['q1', 'b', 'a']);
  });

  test('the first auto row CAN move earlier when a queued row sits above it', () => {
    // Its swap partner is the queue's tail — the whole point of one running order.
    const { queue, refused } = materializePlanOps(['q1'], ['a', 'b'], 'a', 'earlier');
    expect(refused).toBeNull();
    expect(queue).toEqual(['a', 'q1', 'b']);
  });

  test('a refused move materialises NOTHING', () => {
    // rejects: adds followed by an at-edge move, which would freeze the plan
    // into the queue without performing the gesture the host asked for.
    const edge = materializePlanOps([], ['a', 'b'], 'a', 'earlier');
    expect(edge.ops).toEqual([]);
    expect(edge.refused).toBe('at-edge');
    expect(edge.queue).toEqual([]);
  });

  test('a materialisation that would burst the cap is refused whole', () => {
    const nearFull = Array.from({ length: QUEUE_MAX - 1 }, (_, i) => `q${i + 1}`);
    const { ops, refused } = materializePlanOps(nearFull, ['a', 'b'], 'a', 'later');
    expect(ops).toEqual([]);
    expect(refused).toBe('full');
  });

  test('keys arrive in either spelling and leave canonical', () => {
    const { ops } = materializePlanOps([], ['QUESTION#c001#001', 'c001#002'], 'QUESTION#c001#001', 'later');
    expect(ops[0]).toEqual({ op: 'add', questionKey: 'c001#001' });
    expect(ops[ops.length - 1]).toEqual({ op: 'later', questionKey: 'c001#001' });
  });
});
