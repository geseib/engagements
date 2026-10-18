/**
 * WHAT THE ROOM SEES, AND HOW LARGE (owner, 17 Oct 2026; parity PLAN §2d).
 *
 * config/roomContent.js decides, per moment and display profile, which parts
 * of a moment the room's screens show and with what emphasis. These tests hold
 * the decisions table in its header: the title and the lesson lead whenever a
 * question or a lesson is up, the question's own task in "Your turn" (owner,
 * 18 Oct 2026, docs/design/room-content-v2); voting shows every answer and
 * results the pick with no counts; Call carries the extra; nothing ever
 * carries a name; Claude's status is never dropped in a Build Room.
 */
import {
  roomContentFor, shows, roleOf, sizeOf, textOf, isVerbose, taskIsOwn,
  CA_MOMENTS, BUILD_MOMENTS, MINIMAL_PROFILES, ROLE, LIST_LEADS, TALK_LINE,
  questionRoomData, splitLessonQuestion, roomTitle, overviewFits,
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
      // A lead is drawn at the profile's hero or primary step, never smaller;
      // a list lead (every answer, the ranked ideas) at secondary.
      expect(LIST_LEADS.includes(rc.lead) ? ['secondary'] : ['hero', 'primary']).toContain(sizeOf(rc, rc.lead));
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

  // rejects (owner, 18 Oct 2026): "you provided the biggest text with the
  // generic room instructions, not the changing lesson ... the instructions is
  // the optional one. the title often is nice to have big too."
  it.each(UP)('%s: the title leads and the lesson sits under it, never dropped, on every profile', (moment) => {
    PROFILES.forEach((profile) => {
      [DATA, { ...DATA, taskOwn: false }].forEach((d) => {
        const rc = roomContentFor(moment, profile, d);
        expect(rc.lead).toBe('title');
        expect(roleOf(rc, 'story')).toBe(ROLE.SUPPORT);
        expect(sizeOf(rc, 'story')).toBe('secondary');
        expect(rc.essential).toContain('story');
        expect(rc.dropOrder).not.toContain('story');
        expect(rc.order.indexOf('title')).toBeLessThan(rc.order.indexOf('story'));
      });
    });
  });

  it.each(UP)('%s: the question\'s own task is "Your turn", never dropped, on every profile', (moment) => {
    PROFILES.forEach((profile) => {
      const rc = roomContentFor(moment, profile, DATA);
      expect(roleOf(rc, 'task')).toBe(ROLE.SUPPORT);
      expect(sizeOf(rc, 'task')).toBe('secondary');
      expect(rc.essential).toContain('task');
      expect(rc.order.indexOf('story')).toBeLessThan(rc.order.indexOf('task'));
    });
  });

  it.each(UP)('%s: a generic instruction is left off Room, TV and Table; on Call it is a line that may give way', (moment) => {
    MINIMAL_PROFILES.forEach((profile) => {
      expect(shows(roomContentFor(moment, profile, { ...DATA, taskOwn: false }), 'task')).toBe(false);
    });
    const call = roomContentFor(moment, 'call', { ...DATA, taskOwn: false });
    expect(roleOf(call, 'task')).toBe(ROLE.SUPPORT);
    expect(sizeOf(call, 'task')).toBe('body');
    expect(call.dropOrder).toContain('task');
  });

  it.each(UP)('%s: the category is a small eyebrow on every profile', (moment) => {
    PROFILES.forEach((profile) => {
      const rc = roomContentFor(moment, profile, DATA);
      expect(roleOf(rc, 'category')).toBe(ROLE.KICKER);
      expect(sizeOf(rc, 'category')).toBe('meta');
    });
  });

  it.each(UP)('%s: with no title the lesson leads; with neither, the task', (moment) => {
    PROFILES.forEach((profile) => {
      expect(roomContentFor(moment, profile, { ...DATA, title: '' }).lead).toBe('story');
      const rc = roomContentFor(moment, profile, { ...DATA, title: '', story: '' });
      expect(rc.lead).toBe('task');
      expect(textOf(rc, 'task')).toBe(LONG_TASK);
    });
  });

  it('a task that only repeats the lesson or the title is not shown twice', () => {
    expect(shows(roomContentFor('ANSWERING', 'room', { ...DATA, task: STORY }), 'task')).toBe(false);
    expect(shows(roomContentFor('ANSWERING', 'room', { ...DATA, task: DATA.title }), 'task')).toBe(false);
  });

  it('a short title is drawn at hero, a long one at primary', () => {
    expect(sizeOf(roomContentFor('ANSWERING', 'room', DATA), 'title')).toBe('hero');
    expect(sizeOf(roomContentFor('ANSWERING', 'room', { ...DATA, title: LONG_TASK }), 'title')).toBe('primary');
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
  it('VOTING: every answer leads; the title stays as the reminder; no task, no tally', () => {
    PROFILES.forEach((p) => {
      const rc = roomContentFor('VOTING', p, DATA);
      expect(rc.lead).toBe('answers');
      expect(roleOf(rc, 'title')).toBe(ROLE.SUPPORT);
      expect(rc.essential).toContain('title');
      expect(shows(rc, 'task')).toBe(false);
      expect(shows(rc, 'tally')).toBe(false);
    });
  });

  it('RESULTS: the ideas lead under the title; the talk line is the first to give way and never asks who wrote it', () => {
    PROFILES.forEach((p) => {
      const rc = roomContentFor('RESULTS', p, DATA);
      expect(rc.lead).toBe('ideas');
      expect(roleOf(rc, 'title')).toBe(ROLE.SUPPORT);
      expect(shows(rc, 'task')).toBe(false);
      expect(rc.dropOrder[0]).toBe('talk');
      expect(textOf(rc, 'talk')).toBe(TALK_LINE);
    });
    expect(TALK_LINE).not.toMatch(/who\b|wrote|author/i);
    expect(textOf(roomContentFor('RESULTS', 'room', { ...DATA, talk: 'Workie topic' }), 'talk')).toBe('Workie topic');
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

  // Owner, 18 Oct 2026: "not at the expense of seeing what was voted on".
  it.each(ASKS)('%s: the prompt and its options lead; each option\'s detail shows on every profile', (moment) => {
    PROFILES.forEach((p) => {
      const rc = roomContentFor(moment, p, DATA);
      expect(rc.lead).toBe('prompt');
      expect(roleOf(rc, 'options')).toBe(ROLE.LEAD);
      expect(shows(rc, 'optionDetail')).toBe(true);
      expect(JSON.stringify(textOf(rc, 'options'))).toContain('OPTION-DETAIL-A');
      expect(rc.dropOrder).toContain('optionDetail');
    });
    expect(shows(roomContentFor(moment, 'room', DATA), 'detail')).toBe(false);
    expect(shows(roomContentFor(moment, 'call', DATA), 'detail')).toBe(true);
  });

  it('no tally while an ask is open; on the result the tally and the room\'s reasons show everywhere', () => {
    PROFILES.forEach((p) => {
      expect(shows(roomContentFor('BUILD_ASK', p, DATA), 'tally')).toBe(false);
      expect(shows(roomContentFor('BUILD_ASK', p, DATA), 'whys')).toBe(false);
      const res = roomContentFor('BUILD_RESULTS', p, DATA);
      expect(shows(res, 'tally')).toBe(true);
      expect(shows(res, 'whys')).toBe(true);
    });
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

describe('the question inside a lesson (owner, 18 Oct 2026)', () => {
  const LESSON = 'Describe how you apply the concept of thresholds in your work. Architect Christopher Alexander taught that thresholds are crucial for human comfort.';

  it('a first sentence that asks becomes "Your turn"; the rest stays the lesson', () => {
    const { question, lesson } = splitLessonQuestion(LESSON);
    expect(question).toBe('Describe how you apply the concept of thresholds in your work.');
    expect(lesson).toMatch(/^Architect Christopher Alexander/);
    expect(splitLessonQuestion('How do you design for human scale? Jane Jacobs observed that cities work best for pedestrians.').question)
      .toBe('How do you design for human scale?');
  });

  it('a lesson that does not open with a question is left whole', () => {
    const text = 'Most teams carry one decision that shaped everything after it. It is rarely the dramatic one; it is the quick call made in a corridor.';
    expect(splitLessonQuestion(text)).toEqual({ question: '', lesson: text });
    expect(splitLessonQuestion('Describe it. Short.')).toEqual({ question: '', lesson: 'Describe it. Short.' });
    expect(splitLessonQuestion('')).toEqual({ question: '', lesson: '' });
  });

  it('questionRoomData pulls the question only when the question has no instruction of its own', () => {
    const generic = questionRoomData({ title: 'THE IMPORTANCE OF THRESHOLDS', detail: LESSON }, { task: 'Adapt this lesson to your work.' });
    expect(generic.taskOwn).toBe(true);
    expect(generic.task).toMatch(/^Describe how you apply/);
    expect(generic.story).toMatch(/^Architect/);
    expect(generic.title).toBe('The Importance of Thresholds');
    const own = questionRoomData({ title: 't', detail: LESSON, customInstructions: 'Two sentences.' }, { task: 'Two sentences.' });
    expect(own.task).toBe('Two sentences.');
    expect(own.story).toBe(LESSON);
    const plain = questionRoomData({ title: 't', detail: 'A lesson with no question in front of it, long enough to stand alone here.' }, { task: 'Answer on your phone.' });
    expect(plain.taskOwn).toBe(false);
    expect(plain.task).toBe('Answer on your phone.');
  });

  it('roomTitle changes only an ALL-CAPS title', () => {
    expect(roomTitle('FORM FOLLOWS FUNCTION')).toBe('Form Follows Function');
    expect(roomTitle('THE GENIUS OF THE PLACE')).toBe('The Genius of the Place');
    expect(roomTitle('If an agent can build it, who writes the ticket?')).toBe('If an agent can build it, who writes the ticket?');
    expect(roomTitle('AWS')).toBe('AWS');
  });
});

describe('voting opens on all the answers when they fit (owner, 18 Oct 2026)', () => {
  const short = (n) => Array.from({ length: n }, (_, i) => `Answer ${i + 1}: a short idea worth weighing.`);
  it('fits within the profile\'s count and length; otherwise one at a time', () => {
    expect(overviewFits(short(6), 'room')).toBe(true);
    expect(overviewFits(short(7), 'room')).toBe(false);
    expect(overviewFits(short(5), 'tv')).toBe(false);
    expect(overviewFits(['x'.repeat(201)], 'room')).toBe(false);
    expect(overviewFits([], 'room')).toBe(false);
    expect(overviewFits(short(4).map((text) => ({ text })), 'tv')).toBe(true);
  });
});
