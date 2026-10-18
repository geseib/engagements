/**
 * WHAT THE ROOM SEES, AND HOW LARGE (owner, 17 Oct 2026; parity PLAN §2d).
 *
 * config/roomContent.js decides, per moment and display profile, which parts
 * of a moment the room's screens show and with what emphasis. These tests hold
 * the decisions table in its header: the task leads whenever a question or a
 * lesson is up on Room, TV and Table; Call carries the extra; nothing ever
 * carries a name; Claude's status is never dropped in a Build Room.
 */
import {
  roomContentFor, shows, roleOf, sizeOf, textOf, isVerbose, taskIsOwn,
  CA_MOMENTS, BUILD_MOMENTS, MINIMAL_PROFILES, ROLE,
} from '../config/roomContent';
import { PROFILES } from '../config/displayProfile';

const LONG_TASK = 'Name the decision in one sentence. Then name the single piece of information that would have changed it. Do not relitigate the outcome: identify the missing input.';
const STORY = 'Most teams carry one decision that quietly shaped everything that came after it. It is rarely the dramatic one; it is usually the quick call made in a corridor.';

const NAMES = ['Zebulon', 'Quintessa', 'Ottoline'];

/** Every field a caller might hand over, including the ones the room must never see. */
const DATA = {
  title: 'The decision you would remake',
  task: LONG_TASK,
  taskOwn: true,
  story: STORY,
  category: 'Judgment Calls',
  background: 'WORKIE-ONLY-BACKGROUND',
  sessionTitle: 'Q4 offsite',
  roundLabel: 'Round 3',
  cue: 'Vote on your phone',
  playerName: NAMES[0],
  players: NAMES,
  prompt: 'Which header should volunteers see first?',
  detail: 'BUILD-ASK-DETAIL',
  options: [
    { label: 'A', title: 'Bold banner', detail: 'OPTION-DETAIL-A', playerName: NAMES[1] },
    { label: 'B', title: 'Calm photo', detail: 'OPTION-DETAIL-B' },
  ],
  whys: [{ label: 'A', text: 'WHY-TEXT', playerName: NAMES[2] }],
  claude: { key: 'building', headline: 'Claude is adding the map', dur: 'for 3 min', helperLine: 'A helper is checking links', line: '' },
  step: { k: 2, text: 'Add the rota' },
};

const ALL = [...CA_MOMENTS, ...BUILD_MOMENTS];

describe('the shape', () => {
  it.each(ALL)('%s answers for every profile with one lead that shows', (moment) => {
    PROFILES.forEach((profile) => {
      const rc = roomContentFor(moment, profile, DATA);
      expect(rc.moment).toBe(moment);
      expect(rc.profile).toBe(profile);
      expect(typeof rc.lead).toBe('string');
      expect(shows(rc, rc.lead)).toBe(true);
      expect(roleOf(rc, rc.lead)).toBe(ROLE.LEAD);
      // A lead is drawn at the profile's hero or primary step, never smaller.
      expect(['hero', 'primary']).toContain(sizeOf(rc, rc.lead));
      // What may give way for space is only ever something that shows, and never the lead.
      rc.dropOrder.forEach((k) => {
        expect(shows(rc, k)).toBe(true);
        expect(k).not.toBe(rc.lead);
        expect(rc.essential).not.toContain(k);
      });
    });
  });

  it('an unknown profile is Room, an unknown moment is a quiet lead', () => {
    expect(roomContentFor('ANSWERING', 'cinema', DATA).profile).toBe('room');
    const rc = roomContentFor('NOPE', 'room', DATA);
    expect(shows(rc, rc.lead)).toBe(true);
  });

  it('Call is the one verbose profile', () => {
    expect(isVerbose('call')).toBe(true);
    MINIMAL_PROFILES.forEach((p) => expect(isVerbose(p)).toBe(false));
    expect([...MINIMAL_PROFILES, 'call'].sort()).toEqual([...PROFILES].sort());
  });
});

describe('never a name, never the Workie background', () => {
  it.each(ALL)('%s carries no name and no background on any profile', (moment) => {
    PROFILES.forEach((profile) => {
      const out = JSON.stringify(roomContentFor(moment, profile, DATA));
      NAMES.forEach((n) => expect(out).not.toContain(n));
      expect(out).not.toContain('WORKIE-ONLY-BACKGROUND');
    });
  });
});

describe('Call & Answer: a question or a lesson is up', () => {
  const UP = ['ANSWERING', 'QUESTION_FOCUS'];

  // rejects (owner, 18 Oct 2026): the task leading while the lesson the room is
  // answering is dropped ("neither the host nor the room sees the actual lesson").
  it.each(UP)('%s: the lesson leads on every profile; the task sits under it, never dropped', (moment) => {
    PROFILES.forEach((profile) => {
      [DATA, { ...DATA, taskOwn: false }].forEach((d) => {
        const rc = roomContentFor(moment, profile, d);
        expect(rc.lead).toBe('story');
        expect(textOf(rc, 'story')).toBe(STORY);
        expect(roleOf(rc, 'task')).toBe(ROLE.SUPPORT);
        expect(sizeOf(rc, 'task')).toBe('secondary');
        expect(rc.essential).toContain('task');
        expect(rc.dropOrder).not.toContain('task');
        expect(rc.order.indexOf('story')).toBeLessThan(rc.order.indexOf('task'));
      });
    });
  });

  it.each(UP)('%s: the title is only a small kicker on Room, TV and Table; no category', (moment) => {
    MINIMAL_PROFILES.forEach((profile) => {
      const rc = roomContentFor(moment, profile, DATA);
      expect(roleOf(rc, 'title')).toBe(ROLE.KICKER);
      expect(sizeOf(rc, 'title')).toBe('meta');
      expect(shows(rc, 'category')).toBe(false);
    });
  });

  it.each(UP)('%s: Call carries the category and the title as a heading', (moment) => {
    const rc = roomContentFor(moment, 'call', DATA);
    expect(rc.lead).toBe('story');
    expect(roleOf(rc, 'category')).toBe(ROLE.KICKER);
    expect(roleOf(rc, 'title')).toBe(ROLE.SUPPORT);
  });

  it.each(UP)('%s: with no lesson the task leads', (moment) => {
    MINIMAL_PROFILES.forEach((profile) => {
      const rc = roomContentFor(moment, profile, { ...DATA, story: '' });
      expect(rc.lead).toBe('task');
      expect(textOf(rc, 'task')).toBe(LONG_TASK);
      expect(shows(rc, 'story')).toBe(false);
    });
  });

  it('a task that only repeats the lesson is not shown twice', () => {
    const rc = roomContentFor('ANSWERING', 'room', { ...DATA, task: STORY });
    expect(rc.lead).toBe('story');
    expect(shows(rc, 'task')).toBe(false);
  });

  it('a short lead is drawn at hero, a long one at primary', () => {
    expect(sizeOf(roomContentFor('ANSWERING', 'room', { ...DATA, story: '', task: 'Name one habit to drop.' }), 'task')).toBe('hero');
    expect(sizeOf(roomContentFor('ANSWERING', 'room', { ...DATA, story: '' }), 'task')).toBe('primary');
    expect(sizeOf(roomContentFor('ANSWERING', 'room', { ...DATA, story: 'Name one habit to drop.' }), 'story')).toBe('hero');
  });

  it('a title that only repeats the task is not shown twice', () => {
    const rc = roomContentFor('ANSWERING', 'room', { ...DATA, story: '', title: LONG_TASK });
    expect(shows(rc, 'title')).toBe(false);
    expect(shows(roomContentFor('ANSWERING', 'room', { ...DATA, title: STORY }), 'title')).toBe(false);
  });

  it('with no task the title leads, so the room is never shown nothing', () => {
    const rc = roomContentFor('ANSWERING', 'room', { ...DATA, story: '', task: '' });
    expect(rc.lead).toBe('title');
  });

  it('ANSWERING shows the answered count everywhere; QUESTION_FOCUS has none', () => {
    PROFILES.forEach((p) => {
      expect(roleOf(roomContentFor('ANSWERING', p, DATA), 'count')).toBe(ROLE.COUNT);
      expect(shows(roomContentFor('QUESTION_FOCUS', p, DATA), 'count')).toBe(false);
    });
  });

  it('the background field is never a part, even on Call', () => {
    PROFILES.forEach((p) => expect(shows(roomContentFor('ANSWERING', p, DATA), 'background')).toBe(false));
  });
});

describe('Call & Answer: the other moments', () => {
  it('VOTING: the cue leads; the title only on Call; the task is support', () => {
    MINIMAL_PROFILES.forEach((p) => {
      const rc = roomContentFor('VOTING', p, DATA);
      expect(rc.lead).toBe('cue');
      expect(shows(rc, 'title')).toBe(false);
      expect(roleOf(rc, 'task')).toBe(ROLE.SUPPORT);
    });
    expect(shows(roomContentFor('VOTING', 'call', DATA), 'title')).toBe(true);
  });

  it('RESULTS leads with the ideas; the task is the first to give way on Room, TV and Table', () => {
    MINIMAL_PROFILES.forEach((p) => {
      const rc = roomContentFor('RESULTS', p, DATA);
      expect(rc.lead).toBe('ideas');
      expect(rc.dropOrder[0]).toBe('task');
    });
    expect(roomContentFor('RESULTS', 'call', DATA).dropOrder).not.toContain('task');
  });

  it('VOTE_RESPONSE and RESPONSES lead with the response', () => {
    PROFILES.forEach((p) => {
      expect(roomContentFor('VOTE_RESPONSE', p, DATA).lead).toBe('response');
      expect(roomContentFor('RESPONSES', p, DATA).lead).toBe('response');
    });
  });

  it('the session title rides the top line on Call, in the lobby and at the end; elsewhere only the round', () => {
    MINIMAL_PROFILES.forEach((p) => {
      expect(shows(roomContentFor('ANSWERING', p, DATA), 'sessionTitle')).toBe(false);
      expect(shows(roomContentFor('LOBBY', p, DATA), 'sessionTitle')).toBe(true);
      expect(shows(roomContentFor('ENDED', p, DATA), 'sessionTitle')).toBe(true);
      expect(shows(roomContentFor('ANSWERING', p, DATA), 'roundLabel')).toBe(true);
    });
    expect(shows(roomContentFor('ANSWERING', 'call', DATA), 'sessionTitle')).toBe(true);
  });

  it('FEEDBACK keeps the round title as its reminder on every profile', () => {
    PROFILES.forEach((p) => expect(shows(roomContentFor('FEEDBACK', p, DATA), 'title')).toBe(true));
  });

  it('a question for the room leads with its words and its options', () => {
    PROFILES.forEach((p) => {
      const rc = roomContentFor('ROOM_QUESTION', p, DATA);
      expect(rc.lead).toBe('question');
      expect(roleOf(rc, 'options')).toBe(ROLE.LEAD);
    });
  });
});

describe('Build Room', () => {
  const ASKS = ['BUILD_ASK', 'BUILD_RESULTS', 'BUILD_WHEEL'];

  it.each(ASKS)('%s: the prompt and its options lead; detail and reasons only on Call', (moment) => {
    MINIMAL_PROFILES.forEach((p) => {
      const rc = roomContentFor(moment, p, DATA);
      expect(rc.lead).toBe('prompt');
      expect(roleOf(rc, 'options')).toBe(ROLE.LEAD);
      expect(shows(rc, 'detail')).toBe(false);
      expect(shows(rc, 'optionDetail')).toBe(false);
      expect(shows(rc, 'whys')).toBe(false);
      expect(JSON.stringify(rc)).not.toContain('OPTION-DETAIL');
      expect(JSON.stringify(rc)).not.toContain('BUILD-ASK-DETAIL');
    });
    const call = roomContentFor(moment, 'call', DATA);
    expect(shows(call, 'detail')).toBe(true);
    expect(shows(call, 'optionDetail')).toBe(true);
    if (moment === 'BUILD_RESULTS') expect(shows(call, 'whys')).toBe(true);
  });

  it('option titles are drawn at secondary or larger, never at body', () => {
    PROFILES.forEach((p) => expect(['hero', 'primary', 'secondary']).toContain(sizeOf(roomContentFor('BUILD_ASK', p, DATA), 'options')));
  });

  // Owner, 17 Oct 2026: "I do like that Claude's status and activity is kept
  // current on the build room stage (whichever screen shown to the room)."
  it.each(BUILD_MOMENTS)("%s: Claude's status is essential on every profile, and never dropped", (moment) => {
    PROFILES.forEach((p) => {
      const rc = roomContentFor(moment, p, DATA);
      expect(shows(rc, 'claude')).toBe(true);
      expect(rc.essential).toContain('claude');
      expect(rc.dropOrder).not.toContain('claude');
      // large enough to read across the room: body or larger, never the meta step
      expect(['hero', 'primary', 'secondary', 'body']).toContain(sizeOf(rc, 'claude'));
      expect(textOf(rc, 'claude').headline).toBe('Claude is adding the map');
      expect(textOf(rc, 'claude').dur).toBe('for 3 min');
      expect(textOf(rc, 'claude').helperLine).toBe('A helper is checking links');
    });
  });

  it.each(ASKS)("%s: Claude's status never displaces the ask as the lead", (moment) => {
    PROFILES.forEach((p) => {
      const rc = roomContentFor(moment, p, DATA);
      expect(rc.lead).toBe('prompt');
      expect(roleOf(rc, 'claude')).toBe(ROLE.SUPPORT);
    });
  });

  it("between asks Claude's status IS the lead", () => {
    PROFILES.forEach((p) => expect(roomContentFor('BUILD_IDLE', p, DATA).lead).toBe('claude'));
  });

  it('the run list keeps its current step', () => {
    PROFILES.forEach((p) => {
      const rc = roomContentFor('BUILD_RUN', p, DATA);
      expect(rc.lead).toBe('run');
      expect(rc.essential).toContain('step');
      expect(textOf(rc, 'step')).toEqual({ k: 2, text: 'Add the rota' });
    });
  });
});

describe('taskIsOwn', () => {
  it('is the question\'s own instruction only', () => {
    expect(taskIsOwn({ customInstructions: 'Do this.' })).toBe(true);
    expect(taskIsOwn({ CustomInstructions: ' x ' })).toBe(true);
    expect(taskIsOwn({ customInstructions: '  ' })).toBe(false);
    expect(taskIsOwn(null)).toBe(false);
  });
});
