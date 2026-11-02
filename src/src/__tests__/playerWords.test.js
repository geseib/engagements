/**
 * THE PARTICIPANT'S WORD LIST (config/playerWords.js; experience plan 3a).
 *
 * rejects: audit C's six receipt headings ("Answer Submitted!", "Words
 * Submitted!", "Answer In!", "Answer received.", "Title received.", "Votes
 * Submitted!") coming back as six shapes; a wait that is not "Waiting for the
 * host."; an end that thanks a poll for playing; the friendly wrong-code line
 * losing to the server's "Game not found"; any word on PLAN §3.6's "not these"
 * list in the participant's words.
 */
import {
  STEP, barWhere, IN_SESSION, JOIN, EARLY, WAIT, SENT, RECEIPT, receiptFor, RESULTS, ENDED, LOOK_UP,
} from '../config/playerWords';
import { classifyJoinFailure } from '../components/joinResult';
import { hasScoreboard } from '../config/scoreboard';

describe('one receipt grammar: "Sent", then "Your <thing> is/are in."', () => {
  test.each([
    ['call-and-answer', {}, 'Your answer is in.'],
    ['call-and-answer', { artwork: true }, 'Your title is in.'],
    ['trivia', {}, 'Your answer is in.'],
    ['poll', {}, 'Your answer is in.'],
    ['wavelength', {}, 'Your words are in.'],
  ])('%s %j', (type, opts, heading) => {
    expect(receiptFor(type, opts)).toBe(heading);
  });

  test('every receipt heading has the one shape, and the eyebrow is Sent', () => {
    expect(SENT).toBe('Sent');
    for (const key of ['answer', 'title', 'words', 'votes', 'answers', 'idea', 'pick', 'rating']) {
      expect(RECEIPT[key]).toMatch(/^Your [a-z]+ (is|are) in\.$/);
    }
  });
});

describe('one way to say wait', () => {
  test('the heading is one sentence; the eyebrow says why', () => {
    expect(WAIT.heading).toBe('Waiting for the host.');
    expect(EARLY.heading).toBe(WAIT.heading);
    expect(WAIT.lobbyEyebrow('Ada')).toBe('You’re in as Ada');
    expect(WAIT.line).toMatch(/changes on its own/);
  });
});

describe('the bar says where you are', () => {
  test('"Round 3 · Answer", and whichever half is known', () => {
    expect(barWhere('Round 3', STEP.answer)).toBe('Round 3 · Answer');
    expect(barWhere('Lesson 2', STEP.vote)).toBe('Lesson 2 · Vote');
    expect(barWhere(null, STEP.results)).toBe('Result');
    expect(barWhere(null, null)).toBe(IN_SESSION);
  });
});

describe('one ended screen', () => {
  test('scored formats thank you for playing; the rest for taking part', () => {
    expect(ENDED.scored('Ada')).toBe('Thanks for playing, Ada.');
    expect(ENDED.unscored('Ada')).toBe('Thanks for taking part, Ada.');
    // The formats that score are config/scoreboard.js's, not a second list.
    expect(hasScoreboard('trivia')).toBe(true);
    expect(hasScoreboard('poll')).toBe(false);
    expect(hasScoreboard('wavelength')).toBe(false);
  });

  test('inside an event the item is finished and the page stays open', () => {
    expect(ENDED.itemEyebrow).toBe('This item is finished');
    expect(ENDED.eventLine).toMatch(/Keep this page open/);
    expect(ENDED.eventLine).not.toMatch(/close this page/i);
    expect(ENDED.agenda).toBe('Open the agenda');
  });
});

describe('joining says "session" and the friendly wrong-code line wins', () => {
  test('the words', () => {
    expect(JOIN.button).toBe('Join');
    expect(JOIN.heading).toBe('Join the session.');
    expect(JOIN.wrongCode('7123')).toMatch(/^Nothing is running under 7123\./);
  });

  test('a 404 reads the friendly line, never the server\'s "Game not found"', () => {
    const f = classifyJoinFailure(404, { error: 'Game not found' }, '7123');
    expect(f.kind).toBe('not-found');
    expect(f.message).toBe(JOIN.wrongCode('7123'));
    expect(f.message).not.toMatch(/game/i);
  });

  test('not started is the lobby\'s line, never the server\'s "This game has not been started"', () => {
    const f = classifyJoinFailure(403, { error: 'Game not started', message: 'This game has not been started yet.' });
    expect(f.kind).toBe('not-started');
    expect(f.message).toBe(EARLY.lede);
  });
});

describe('no word on PLAN §3.6\'s "not these" list', () => {
  const all = [];
  const walk = (v) => {
    if (typeof v === 'string') all.push(v);
    else if (typeof v === 'function') all.push(String(v('Ada')));
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  [STEP, JOIN, EARLY, WAIT, RECEIPT, RESULTS, ENDED, LOOK_UP].forEach(walk);
  test.each([
    /\bgames?\b/i, /\bmain screen\b/i, /\bbig screen\b/i, /\bprojector\b/i, /\bjoin game\b/i,
    /\bgame id\b/i, /\bback to the agenda\b/i, /\bthis phone\b/i,
  ])('%s', (re) => {
    expect(all.filter((s) => re.test(s))).toEqual([]);
  });
});
