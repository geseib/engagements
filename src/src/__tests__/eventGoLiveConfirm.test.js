/**
 * THE ASKS BEFORE AN EVENT'S PHONES MOVE (owner, 31 Oct 2026: "if i
 * accidentally press space bar it starts the event … we really need guard
 * rails"). One wording, asked by the event board (EventStage) and by an
 * engagement's own stage (GameHostPage's preview primary).
 */
import { eventGoLiveConfirm, eventHasStarted } from '../config/hostControls';

describe('eventHasStarted', () => {
  test('a scheduled event with every item planned has not started', () => {
    expect(eventHasStarted({ state: 'SCHEDULED' }, [{ state: 'planned' }, {}])).toBe(false);
  });
  test('a live or ended event has, and so has one with any item past planned', () => {
    expect(eventHasStarted({ state: 'LIVE' }, [])).toBe(true);
    expect(eventHasStarted({ state: 'ENDED' }, [])).toBe(true);
    expect(eventHasStarted({ state: 'SCHEDULED' }, [{ state: 'done' }])).toBe(true);
  });
});

describe('eventGoLiveConfirm', () => {
  test('the first go-live asks to start the event, naming the item', () => {
    const ask = eventGoLiveConfirm({ itemTitle: 'Space night', startsEvent: true });
    expect(ask.title).toBe('Start the event?');
    expect(ask.message).toMatch(/Space night/);
    expect(ask.confirmText).toBe('Start the event');
  });
  test('from a preview mid-event, it names what ends — and an open survey pausing instead', () => {
    const ask = eventGoLiveConfirm({ itemTitle: 'Break', liveTitle: 'FY26 in review' });
    expect(ask.title).toBe('Bring everyone here?');
    expect(ask.message).toMatch(/FY26 in review ends \(an open survey pauses instead\)/);
  });
  // rejects: a clicker's second → answering yes.
  test('every ask is irreversible, so → is never taken as yes', () => {
    expect(eventGoLiveConfirm({ startsEvent: true }).irreversible).toBe(true);
    expect(eventGoLiveConfirm({}).irreversible).toBe(true);
  });
});
