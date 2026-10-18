/**
 * BOTH DESTINATIONS READ ONE RULE (owner, 17 Oct 2026; parity PLAN §2d).
 *
 * The one-screen stage draws a question through components/QuestionCard; the
 * room's window draws it through present/presentModel → PresentMoments. Both
 * must ask config/roomContent.js, and for one fixture they must agree on which
 * parts show and what leads. GameHostPage cannot mount in jsdom, so the stage
 * half is QuestionCard with the content GameHostPage hands it
 * (questionRoomData + roomContentFor, the same call presentModel makes).
 */
import React from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { render } from '@testing-library/react';
import QuestionCard from '../components/QuestionCard';
import { presentModel } from '../present/presentModel';
import { PresentMoment } from '../present/PresentMoments';
import { roomContentFor, questionRoomData } from '../config/roomContent';
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

/** What the stage hands QuestionCard (GameHostPage.jsx: stageRoom). */
const stageRoom = (q, profile) => roomContentFor('ANSWERING', profile, questionRoomData(q, {
  task: resolveInstruction(q, '', 'call-and-answer'),
  sessionTitle: 'Q4 offsite',
  roundLabel: 'Round 3',
}));

/** The parts a container draws: { part: role }. */
const partsOf = (container) => Object.fromEntries(
  [...container.querySelectorAll('[data-rc-part]')].map((el) => [el.getAttribute('data-rc-part'), el.getAttribute('data-rc')]),
);
const ROOM_PARTS = ['category', 'title', 'task', 'story'];
const pick = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => ROOM_PARTS.includes(k)));

describe.each([['own instruction', OWN], ['generic instruction (a lesson)', LESSON]])('a question with %s', (label, q) => {
  it.each(PROFILES)('on %s the stage and the wall get the same content, from the same function', (profile) => {
    const wall = presentModel(snapshot(q, profile));
    expect(wall.room).toEqual(stageRoom(q, profile));
  });

  it.each(PROFILES)('on %s the stage and the wall draw the same parts with the same roles', (profile) => {
    const stage = render(<div className="fitbox"><QuestionCard phase="ASK" question={q} gameType="call-and-answer" instruction={resolveInstruction(q, '', 'call-and-answer')} room={stageRoom(q, profile)} /></div>);
    const wall = render(<PresentMoment model={presentModel(snapshot(q, profile))} />);
    const s = pick(partsOf(stage.container));
    const w = pick(partsOf(wall.container));
    expect(s).toEqual(w);
    expect(s.task).toBe('lead');
    stage.unmount();
    wall.unmount();
  });
});

describe('what the room sees while a question is up', () => {
  it('Room: the task leads, the title is a kicker, no story for an own instruction, no background', () => {
    const { container } = render(<PresentMoment model={presentModel(snapshot(OWN, 'room'))} />);
    expect(container.querySelector('[data-rc-part="task"][data-rc="lead"]').textContent).toBe(OWN_TASK);
    expect(container.querySelector('[data-rc-part="title"]').getAttribute('data-rc')).toBe('kicker');
    expect(container.querySelector('[data-rc-part="story"]')).toBeNull();
    expect(container.querySelector('[data-rc-part="category"]')).toBeNull();
    expect(container.textContent).not.toContain('WORKIE-ONLY-BACKGROUND');
    // the session title is not on the top line on Room while a question is up
    expect(container.textContent).not.toContain('Q4 offsite');
  });

  it('Room: a lesson with a generic instruction keeps the lesson, droppable', () => {
    const { container } = render(<PresentMoment model={presentModel(snapshot(LESSON, 'room'))} />);
    const story = container.querySelector('[data-rc-part="story"]');
    expect(story.getAttribute('data-rc')).toBe('support');
    expect(story.hasAttribute('data-drop')).toBe(true);
  });

  it('Call: category, title as a heading, the task leading, the story', () => {
    const { container } = render(<PresentMoment model={presentModel(snapshot(OWN, 'call'))} />);
    expect(partsOf(container)).toMatchObject({ category: 'kicker', title: 'support', task: 'lead', story: 'support' });
    expect(container.textContent).toContain('Q4 offsite');
  });

  it('the stage card on Room: the task leads and carries the expand recovery; the title is a kicker', () => {
    const onExpand = jest.fn();
    const { container } = render(<QuestionCard phase="ASK" question={OWN} gameType="call-and-answer" instruction={OWN_TASK} room={stageRoom(OWN, 'room')} onExpand={onExpand} />);
    const task = container.querySelector('[data-rc-part="task"]');
    expect(task.classList.contains('q')).toBe(true);
    expect(task.getAttribute('data-expandable')).toBe('1');
    expect(container.querySelector('.kicker[data-rc-part="title"]').textContent).toBe(OWN.title);
    // the task is never droppable, the old "How to answer" line is gone
    expect(task.hasAttribute('data-drop')).toBe(false);
    expect(container.querySelector('[data-drop-note="How to answer"]')).toBeNull();
  });

  it('without `room` the card keeps its frozen DOM (the set editor preview)', () => {
    const { container } = render(<QuestionCard phase="ASK" question={OWN} gameType="call-and-answer" instruction={OWN_TASK} />);
    expect(container.querySelector('[data-rc-part]')).toBeNull();
    expect(container.querySelector('h1.q').textContent).toBe(OWN.title);
  });

  it('GameHostPage hands the stage card its room content from roomContentFor', () => {
    const src = readFileSync(join(__dirname, '..', 'GameHostPage.jsx'), 'utf8');
    expect(src).toMatch(/import \{[^}]*roomContentFor[^}]*\} from '\.\/config\/roomContent'/);
    expect(src).toMatch(/<QuestionCard\s+phase="ASK"[\s\S]{0,400}room=\{/);
  });
});
