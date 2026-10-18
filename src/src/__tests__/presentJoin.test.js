/**
 * THE QR SIDE PANEL, AS ARITHMETIC (owner, 18 Oct 2026: "whenever the host
 * wants to show the qr code. it moves the screen around a bit so all content
 * is there but the qr code is avail"). config/stageFocus.js's half of the
 * contract stage-focus.js holds (tests/stage-focus-vote.js §8-10): `join` is
 * its own boolean beside the focus, and a legacy focus of 'join' reads as up.
 */
import { joinShown, joinRequest, normaliseFocus, focusFromFrame, focusRequest } from '../config/stageFocus';

describe('joinShown', () => {
  it('reads stageFocus.join, beside any focus', () => {
    expect(joinShown({ focus: 'answer', index: 2, join: true })).toBe(true);
    expect(joinShown({ focus: 'none', join: false })).toBe(false);
  });
  it('a legacy focus of join is the panel up; nothing at all is down', () => {
    expect(joinShown({ focus: 'join' })).toBe(true);
    expect(joinShown({ focus: 'none' })).toBe(false);
    expect(joinShown(null)).toBe(false);
    expect(joinShown(undefined)).toBe(false);
  });
  it('an explicit join wins over the legacy focus', () => {
    expect(joinShown({ focus: 'join', join: false })).toBe(false);
  });
});

describe('joinRequest', () => {
  it('carries join and the round, never a focus (the server keeps the focus as it is)', () => {
    expect(joinRequest({ join: true, state: 'VOTE#007' })).toEqual({ join: true, questionNumber: 7 });
    expect(joinRequest({ join: false, state: 'RESULTS#002' })).toEqual({ join: false, questionNumber: 2 });
  });
  it('outside a round, or without a boolean, there is nothing to send', () => {
    expect(joinRequest({ join: true, state: 'CREATED' })).toBeNull();
    expect(joinRequest({ join: 'yes', state: 'ASK#001' })).toBeNull();
  });
});

describe('frames carry join through, and only as a boolean', () => {
  it('normaliseFocus keeps join beside the focus', () => {
    expect(normaliseFocus({ focus: 'answer', index: 1, join: true })).toEqual({ focus: 'answer', index: 1, join: true });
    expect(normaliseFocus({ focus: 'none', join: false })).toEqual({ focus: 'none', index: null, join: false });
    expect(normaliseFocus({ focus: 'none', join: 'yes' })).toEqual({ focus: 'none', index: null });
  });
  it('a frame that moved only the QR still carries the answer up', () => {
    const frame = { questionNumber: '005', focus: 'answer', index: 3, part: 0, parts: 1, phase: 'VOTE', join: true, rev: 4 };
    expect(focusFromFrame(frame, 'VOTE#005', 3)).toEqual({ focus: 'answer', index: 3, part: 0, parts: 1, phase: 'VOTE', join: true, rev: 4 });
  });
  it('focusRequest is unchanged for the older callers (no join in the body)', () => {
    expect(focusRequest({ focus: 'answer', index: 0, state: 'VOTE#005' })).toEqual({ focus: 'answer', index: 0, questionNumber: 5 });
  });
});
