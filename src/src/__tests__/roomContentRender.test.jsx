/**
 * BOTH DESTINATIONS READ ONE RULE (owner, 17 Oct 2026; parity PLAN §2d), AND
 * THE RULE IS THE 18 OCT ONE (docs/design/room-content-v2).
 *
 *   "you provided the biggest text with the generic room instructions, not
 *    the changing lesson, which in several mockups is not even visable. the
 *    instructions is the optional one. the title often is nice to have big
 *    too."
 *
 * The one-screen stage draws a question through components/QuestionCard; the
 * room's window draws it through present/presentModel → PresentMoments. Both
 * ask config/roomContent.js. The wall is being rebuilt alongside this change,
 * so its half here is asserted on presentModel's OUTPUT (the `room` content it
 * hands its renderer), never on the wall's DOM; the stage's half is the card
 * rendered with the content GameHostPage hands it (questionRoomData +
 * roomContentFor, the same call presentModel makes).
 */
import React from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { render } from '@testing-library/react';
import QuestionCard, { YOUR_TURN } from '../components/QuestionCard';
import { STORY_PRIMARY_MAX } from '../config/roomContent';
import { presentModel } from '../present/presentModel';
import {
  roomContentFor, questionRoomData, TALK_LINE, ROLE,
} from '../config/roomContent';
import { resolveInstruction } from '../config/instructions';
import { PROFILES } from '../config/displayProfile';

const OWN_TASK = 'Name the decision in one sentence. Then name the single piece of information that would have changed it.';
const OWN = {
  title: 'The decision you would remake',
  questionDetail: 'Most teams carry one decision that quietly shaped everything after it.',
  category: 'Judgment Calls',
  customInstructions: OWN_TASK,
  background: 'WORKIE-ONLY-BACKGROUND',
};
const LESSON = {
  title: 'Churchill bets Britain on an unproven ally',
  questionDetail: 'In 1940, Churchill refused the peace offer and staked survival on an ally that had not yet joined.',
  category: 'Tough Choices',
};
// The lesson sets open Detail_lesson with the question itself (README q1).
const ASKS = 'Describe how you apply thresholds in your work.';
const PULLED_LESSON = 'Architect Christopher Alexander taught that thresholds, the spaces between inside and outside, are crucial for human comfort.';
const PULLED = {
  title: 'THE IMPORTANCE OF THRESHOLDS',
  questionDetail: `${ASKS} ${PULLED_LESSON}`,
  category: 'School of Architecture',
};

const snapshot = (q, profile, over = {}) => ({
  gameId: '4821',
  gameType: 'call-and-answer',
  gameMetadata: { title: 'Q4 offsite' },
  state: 'ASK#003',
  currentQuestion: 3,
  currentQuestionData: { ...q, detail: q.questionDetail },
  stageBeat: null,
  stageFocus: { focus: 'none', index: null, part: 0, parts: 1, phase: null, rev: 0 },
  stageNotes: { page: 0, pages: null },
  stageProfile: profile,
  scoreboard: { open: false },
  roomCounts: { joined: 20, answered: 4, voted: 0 },
  ...over,
});

const generic = (q) => resolveInstruction(q, '', 'call-and-answer');

/** What the stage hands QuestionCard (GameHostPage.jsx: askRoomData). */
const stageRoom = (q, profile) => roomContentFor('ANSWERING', profile, questionRoomData(q, {
  task: generic(q),
  sessionTitle: 'Q4 offsite',
  roundLabel: 'Round 3',
}));

const ROOM_PARTS = ['category', 'title', 'task', 'story'];
/** { part: [role, text] } for the question's parts, from a room content. */
const partsOfRoom = (rc) => Object.fromEntries(ROOM_PARTS
  .filter((k) => rc.parts[k] && rc.parts[k].role !== ROLE.DROPPED)
  .map((k) => [k, [rc.parts[k].role, rc.parts[k].text]]));
/** { part: role } as a container draws them. */
const partsOfDom = (container) => Object.fromEntries(
  [...container.querySelectorAll('[data-rc-part]')].map((el) => [el.getAttribute('data-rc-part'), el.getAttribute('data-rc')]),
);
const card = (q, profile, props = {}) => render(
  <div className="fitbox">
    <QuestionCard phase="ASK" question={q} gameType="call-and-answer" room={stageRoom(q, profile)} {...props} />
  </div>,
);

describe.each([['own instruction', OWN], ['generic instruction (a lesson)', LESSON], ['the question pulled from the lesson', PULLED]])('a question with %s', (label, q) => {
  it.each(PROFILES)('on %s the stage and the wall get the same content, from the same function', (profile) => {
    const wall = presentModel(snapshot(q, profile));
    expect(partsOfRoom(wall.room)).toEqual(partsOfRoom(stageRoom(q, profile)));
  });

  it.each(PROFILES)('on %s the stage card draws exactly the parts the rule shows, with their roles', (profile) => {
    const rc = stageRoom(q, profile);
    const { container, unmount } = card(q, profile);
    const drawn = partsOfDom(container);
    const want = Object.fromEntries(Object.entries(partsOfRoom(rc)).map(([k, [role]]) => [k, role]));
    expect(drawn).toEqual(want);
    // The title leads, the lesson under it: on every profile.
    expect(drawn.title).toBe('lead');
    expect(drawn.story).toBe('support');
    unmount();
  });
});

describe('what the room sees while a question is up (owner, 18 Oct 2026; 5 Nov 2026)', () => {
  // rejects: the generic room instructions as the biggest text; the lesson
  // missing or droppable; the title as a small kicker; and since 5 Nov
  // ("taking the instructions out and making the main body larger is more
  // useful") any instruction at all on the room's screen.
  it('Room: the title leads at the hero step, the lesson under it never dropped, and nothing else', () => {
    const { container } = card(OWN, 'room');
    const lead = container.querySelector('[data-rc-part="title"]');
    expect(lead.tagName).toBe('H1');
    expect(lead.classList.contains('q')).toBe(true);
    expect(lead.getAttribute('data-rc-size')).toBe('hero');
    expect(lead.textContent).toBe(OWN.title);
    const lesson = container.querySelector('[data-rc-part="story"]');
    expect(lesson.textContent).toBe(OWN.questionDetail);
    expect(lesson.hasAttribute('data-drop')).toBe(false);
    expect(container.querySelector('.q-eyebrow[data-rc-part="category"]').textContent).toBe(OWN.category);
    expect(container.textContent).not.toContain('WORKIE-ONLY-BACKGROUND');
    // The question's own instruction is not on the room's screen: its phones carry it.
    expect(container.querySelector('[data-rc-part="task"]')).toBeNull();
    expect(container.textContent).not.toContain(OWN_TASK);
    expect(container.textContent).not.toContain(YOUR_TURN);
    const order = [...container.querySelectorAll('[data-rc-part]')].map((el) => el.getAttribute('data-rc-part'));
    expect(order).toEqual(['category', 'title', 'story']);
  });

  it('nothing on the card opens anything: no expand affordance on the title or the lesson', () => {
    const { container } = card(OWN, 'room');
    expect(container.querySelector('[data-expandable]')).toBeNull();
    expect(container.querySelector('[title="Show the full question"]')).toBeNull();
  });

  it.each(PROFILES)('%s: no instruction is drawn at all, own or generic', (profile) => {
    [OWN, LESSON, PULLED].forEach((q) => {
      const { container, unmount } = card(q, profile);
      expect(container.querySelector('[data-rc-part="task"]')).toBeNull();
      expect(container.querySelector('.q-turn, .q-howto')).toBeNull();
      expect(container.textContent).not.toContain(generic(q));
      expect(container.querySelector('[data-drop-note="How to answer"]')).toBeNull();
      unmount();
    });
  });

  it('a short lesson is the body at the primary step; a long one at secondary', () => {
    expect(OWN.questionDetail.length).toBeLessThanOrEqual(STORY_PRIMARY_MAX);
    const short = card(OWN, 'room');
    expect(short.container.querySelector('[data-rc-part="story"]').classList.contains('is-primary')).toBe(true);
    short.unmount();
    const LONG = { ...OWN, questionDetail: `${OWN.questionDetail} `.repeat(4).trim() };
    const long = card(LONG, 'room');
    expect(long.container.querySelector('[data-rc-part="story"]').classList.contains('is-secondary')).toBe(true);
    long.unmount();
  });

  it('the question at the front of a lesson stays in the lesson on the room\'s screen; an ALL-CAPS title is title-cased', () => {
    const { container } = card(PULLED, 'room');
    expect(container.querySelector('[data-rc-part="title"]').textContent).toBe('The Importance of Thresholds');
    expect(container.querySelector('[data-rc-part="story"]').textContent).toBe(`${ASKS} ${PULLED_LESSON}`);
    expect(container.querySelector('.q-turn')).toBeNull();
  });

  it('with no title the lesson leads; with neither, the task', () => {
    const noTitle = { ...OWN, title: '' };
    expect(stageRoom(noTitle, 'room').lead).toBe('story');
    const { container } = card(noTitle, 'room');
    expect(container.querySelector('h1[data-rc-part="story"]')).not.toBeNull();
    const bare = { ...OWN, title: '', questionDetail: '' };
    expect(stageRoom(bare, 'room').lead).toBe('task');
  });

  it('without `room` the card keeps its frozen DOM (the set editor preview)', () => {
    const { container } = render(<QuestionCard phase="ASK" question={OWN} gameType="call-and-answer" instruction={OWN_TASK} />);
    expect(container.querySelector('[data-rc-part]')).toBeNull();
    expect(container.querySelector('h1.q').textContent).toBe(OWN.title);
  });

  it('GameHostPage hands the stage card its room content from roomContentFor, built by questionRoomData', () => {
    const src = readFileSync(join(__dirname, '..', 'GameHostPage.jsx'), 'utf8');
    expect(src).toMatch(/import \{[^}]*roomContentFor[^}]*\} from '\.\/config\/roomContent'/);
    expect(src).toMatch(/<QuestionCard\s+phase="ASK"[\s\S]{0,400}room=\{askRoomData\s*\?\s*roomContentFor\('ANSWERING', profile, askRoomData\)/);
    // The stage's ASK card is handed no instruction and no expand handler.
    const ask = src.slice(src.indexOf("{hostPhase === 'ASK' && currentQuestion && ("), src.indexOf("{hostPhase === 'ASK' && currentGameType === 'poll'"));
    expect(ask).toMatch(/<QuestionCard/);
    expect(ask).not.toMatch(/instruction=/);
    expect(ask).not.toMatch(/onExpand=/);
    expect(src).toMatch(/const askRoomData = [^;]*questionRoomData\(askRecord, \{ task: getHostInstructionText\(askRecord\)/);
  });
});

describe('voting and results, as the rule decides them for both destinations', () => {
  // rejects (owner, 18 Oct 2026): "nice to see a bar chart results but not at
  // the expense of seeing what was voted on". The answers lead while voting
  // and the ideas lead on results, on every profile; the title is the
  // reminder; no tally while voting; the talk line is the first to give way.
  it.each(PROFILES)('%s: VOTING leads with every answer, the title the reminder, no task', (profile) => {
    const rc = roomContentFor('VOTING', profile, { title: 'The importance of thresholds', cue: 'Vote' });
    expect(rc.lead).toBe('answers');
    expect(rc.parts.answers.size).toBe('secondary');
    expect(rc.parts.title).toMatchObject({ role: ROLE.SUPPORT, size: 'primary' });
    expect(rc.essential).toEqual(expect.arrayContaining(['title', 'answers', 'count']));
    expect(rc.parts.task.role).toBe(ROLE.DROPPED);
    expect(rc.parts.cue.role).toBe(ROLE.KICKER);
  });

  it.each(PROFILES)('%s: RESULTS leads with the ideas; the talk line is support and drops first', (profile) => {
    const rc = roomContentFor('RESULTS', profile, { title: 'The importance of thresholds' });
    expect(rc.lead).toBe('ideas');
    expect(rc.parts.talk).toMatchObject({ role: ROLE.SUPPORT, size: 'body', text: TALK_LINE });
    expect(rc.dropOrder[0]).toBe('talk');
  });
});
