import { navigatorWindow, trackOf } from '../present/navigatorWindow';

// Render a window the way NOTES §5 writes it: ranges in brackets, minis bare,
// 1-based, the focused one between bars.
const show = (index, total) => {
  const w = navigatorWindow(index, total);
  const item = (x) => (x.kind === 'range' ? `[${x.from + 1}–${x.to + 1}]` : String(x.index + 1));
  return [...w.left.map(item), '|', String(index + 1), '|', ...w.right.map(item)].join(' ');
};

describe('navigatorWindow (NOTES §5)', () => {
  it('4 responses: no ranges', () => {
    expect(show(1, 4)).toBe('1 | 2 | 3 4');
    expect(show(0, 4)).toBe('| 1 | 2 3 4');
  });
  it('8 at #6', () => expect(show(5, 8)).toBe('[1–3] 4 5 | 6 | 7 8'));
  it('20 at #10', () => expect(show(9, 20)).toBe('[1–7] 8 9 | 10 | 11 12 [13–20]'));
  it('60 at #30', () => expect(show(29, 60)).toBe('[1–27] 28 29 | 30 | 31 32 [33–60]'));
  it('a range of one is a mini, never a "1 response" chip', () => {
    expect(show(3, 8)).toBe('1 2 3 | 4 | 5 6 [7–8]');
    const w = navigatorWindow(3, 8);
    expect(w.left.every((x) => x.kind === 'mini')).toBe(true);
  });
  it('a flank never holds more than three items', () => {
    for (let total = 1; total <= 70; total += 1) {
      for (let i = 0; i < total; i += 1) {
        const w = navigatorWindow(i, total);
        expect(w.left.length).toBeLessThanOrEqual(3);
        expect(w.right.length).toBeLessThanOrEqual(3);
        expect(w.left.filter((x) => x.kind === 'range').length).toBeLessThanOrEqual(1);
      }
    }
  });
  it('clamps an index out of range and survives zero', () => {
    expect(navigatorWindow(99, 3).index).toBe(2);
    expect(navigatorWindow(0, 0)).toEqual({ index: 0, total: 0, left: [], right: [] });
  });
});

describe('trackOf', () => {
  it('one tick per response up to 24', () => {
    expect(trackOf(2, 5)).toEqual({ kind: 'ticks', ticks: [false, false, true, false, false] });
    expect(trackOf(0, 24).ticks).toHaveLength(24);
  });
  it('a bar with a marker above 24', () => {
    expect(trackOf(0, 25)).toEqual({ kind: 'bar', at: 0 });
    expect(trackOf(24, 25)).toEqual({ kind: 'bar', at: 1 });
    expect(trackOf(29, 60).at).toBeCloseTo(29 / 59);
  });
});
