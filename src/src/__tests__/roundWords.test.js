/**
 * R6 (docs/design/simplify-round/PRINCIPLES.md): every label, status and
 * participant line for a round comes from config/roundWords.js. Plain,
 * sentence case, no exclamation marks, no emoji, and the room's devices are
 * always "phone, laptop or tablet".
 */
import RW, { deviceWords, allRoundLabels, nounOf } from '../config/roundWords';

const NOUN_WORDS = new Set(['startFirst', 'nextRound', 'skipRound', 'armSkip']);

/** Every string the module can produce, with sample arguments for the functions. */
function everyString() {
  const out = [];
  const visit = (value, where) => {
    if (typeof value === 'string') { out.push([where, value]); return; }
    if (typeof value === 'function') {
      // Noun-taking words get a noun; the rest get numbers (and a kind).
      const takesNoun = NOUN_WORDS.has(where.split('.').pop());
      const samples = takesNoun
        ? [['Lesson'], ['Round'], [undefined]]
        : [[3, 8], [1, 'voting'], [2, 'answering'], [0, 1]];
      for (const args of samples) {
        let result;
        try { result = value(...args); } catch { continue; }
        if (typeof result === 'string') out.push([`${where}(${args.join(',')})`, result]);
      }
      return;
    }
    if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) visit(v, `${where}.${k}`);
    }
  };
  visit(RW, 'RW');
  return out.filter(([, s]) => s !== '');
}

describe('roundWords', () => {
  const strings = everyString();

  test('there is a real vocabulary to check', () => {
    expect(strings.length).toBeGreaterThan(30);
  });

  test('sentence case: a capital first letter and no other capitalised word except Workie', () => {
    const allowed = new Set(['Workie', 'I']);
    for (const [where, s] of strings) {
      expect([where, /^[A-Z0-9]/.test(s)]).toEqual([where, true]);
      const words = s.split(/\s+/).slice(1);
      for (const w of words) {
        const bare = w.replace(/[^A-Za-z]/g, '');
        if (!bare || allowed.has(bare)) continue;
        // A word after a full stop starts a new sentence.
        const idx = s.indexOf(w);
        const before = s.slice(0, idx).trimEnd();
        if (/[.:]$/.test(before)) continue;
        expect([where, w, /^[A-Z]/.test(bare)]).toEqual([where, w, false]);
      }
    }
  });

  test('no exclamation marks', () => {
    for (const [where, s] of strings) expect([where, s.includes('!')]).toEqual([where, false]);
  });

  test('no emoji', () => {
    for (const [where, s] of strings) {
      expect([where, /\p{Extended_Pictographic}/u.test(s)]).toEqual([where, false]);
    }
  });

  test('the device phrase is the three-device phrase, and "phone" never stands alone', () => {
    expect(deviceWords).toBe('phone, laptop or tablet');
    for (const [where, s] of strings) {
      if (!/phone/.test(s)) continue;
      expect([where, s.includes(deviceWords)]).toEqual([where, true]);
    }
  });

  test('the set noun is substituted, lower case after the verb', () => {
    expect(RW.nextRound('Lesson')).toBe('Next lesson');
    expect(RW.nextRound('Question')).toBe('Next question');
    expect(RW.nextRound()).toBe('Next round');
    expect(RW.nextRound('  ')).toBe('Next round');
    expect(nounOf('Subject')).toBe('subject');
  });

  test('the core verbs', () => {
    expect(RW.startVoting).toBe('Start voting');
    expect(RW.showResults).toBe('Show results');
    expect(RW.whatWeHeard).toBe('What we heard');
    expect(RW.nextPage).toBe('Next page');
    expect(RW.backPage).toBe('Back a page');
    expect(RW.nextResponse).toBe('Next response');
    expect(RW.nextPart).toBe('Next part');
    expect(RW.stopShowing).toBe('Stop showing');
    expect(RW.showTheRead).toBe('Show the read');
    expect(RW.workieWriting).toBe('Workie is writing');
    expect(RW.openReport).toBe('Open session report');
    expect(RW.backToMenu).toBe('Back to menu');
    expect(RW.showResponse(1, 9)).toBe('Show response 1 of 9');
  });

  test('the arm texts say how many and what the second press does', () => {
    expect(RW.armVote(4)).toBe('4 still answering. Press again to start voting.');
    // With the room's size (walk W3, 16 Oct 2026): "1 of 3 still writing".
    expect(RW.armVote(1, 3)).toBe('1 of 3 still writing. Press again to start voting.');
    expect(RW.armResults(2, 'answering', 5)).toBe('2 of 5 still answering. Press again to show results.');
    expect(RW.armResults(1, 'voting', 3)).toBe('1 of 3 still voting. Press again to show results.');
    expect(RW.armResults(1, 'voting')).toBe('1 still voting. Press again to show results.');
    expect(RW.armResults(2, 'answering')).toBe('2 still answering. Press again to show results.');
  });

  test('the voting foot line names the three devices', () => {
    expect(RW.answersOnDevices(6)).toBe('6 answers are on your phone, laptop or tablet.');
    expect(RW.answersOnDevices(1)).toBe('1 answer is on your phone, laptop or tablet.');
  });

  test('allRoundLabels lists the literal labels the parity grep looks for', () => {
    const labels = allRoundLabels();
    expect(labels).toEqual(expect.arrayContaining(['Start voting', 'Show results', 'What we heard', 'Next page']));
    for (const l of labels) expect(typeof l).toBe('string');
  });
});
