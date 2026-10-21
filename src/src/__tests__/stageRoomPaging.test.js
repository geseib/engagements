/**
 * HOW MANY ANSWERS A STAGE PAGE HOLDS UNDER THE 18 OCT RULE
 * (components/stage/roomPaging.js; docs/design/room-content-v2 frames 4-5).
 *
 * rejects: voting that opens on three of five short answers when all five fit
 * (owner, 18 Oct 2026, README question 5: open on all the answers when they
 * fit); a results page too short to hold the pick and its runners-up; a page
 * size that is a literal rather than the profile's.
 */
import { stagePageSizeFor, ROOM_VOTE_PAGE, ROOM_RESULTS_PAGE, votingWall } from '../components/stage/roomPaging';
import { overviewFits, OVERVIEW_FIT } from '../config/roomContent';
import { pageSizeFor } from '../config/stagePaging';
import { PROFILES } from '../config/displayProfile';

const row = (answer) => ({ answer, playerName: 'Ada' });
const short = (n) => Array.from({ length: n }, (_, i) => row(`A short answer, number ${i + 1}.`));

describe.each(PROFILES)('%s', (profile) => {
  it('VOTE: every answer on one page when overviewFits says they fit', () => {
    const n = OVERVIEW_FIT[profile].max;
    const answers = short(n);
    expect(overviewFits(answers.map((a) => a.answer), profile)).toBe(true);
    expect(stagePageSizeFor('VOTE', profile, answers)).toBe(n);
  });

  it('VOTE: the profile\'s page when they do not fit', () => {
    const answers = short(OVERVIEW_FIT[profile].max + 1);
    expect(stagePageSizeFor('VOTE', profile, answers)).toBe(ROOM_VOTE_PAGE[profile]);
    const long = [row('x'.repeat(OVERVIEW_FIT[profile].each + 1))];
    expect(stagePageSizeFor('VOTE', profile, long)).toBe(ROOM_VOTE_PAGE[profile]);
  });

  it('RESULTS: the pick and its runners-up (at least three rows)', () => {
    expect(stagePageSizeFor('RESULTS', profile, short(9))).toBe(ROOM_RESULTS_PAGE[profile]);
    expect(ROOM_RESULTS_PAGE[profile]).toBeGreaterThanOrEqual(3);
  });

  it('every other phase keeps config/stagePaging.js', () => {
    expect(stagePageSizeFor('FIELD_NOTES', profile, short(3))).toBe(pageSizeFor(profile));
  });
});

it('an unknown profile reads as Room, and no answers is still a page of one', () => {
  expect(stagePageSizeFor('RESULTS', 'nonsense', [])).toBe(ROOM_RESULTS_PAGE.room);
  expect(stagePageSizeFor('VOTE', 'room', [])).toBe(ROOM_VOTE_PAGE.room);
});

// WHAT THE ROOM'S WINDOW SHOWS DURING VOTING, as the host's page reads it
// (19 Oct 2026): the console marked Response 1 "On the wall now" while the
// window showed every answer (presentModel's overview, the same overviewFits).
describe('votingWall: what the room\'s window shows during voting', () => {
  const fit = short(3);
  const long = Array.from({ length: OVERVIEW_FIT.room.max + 1 }, (_, i) => row(`Answer ${i + 1}`));
  it('no focus and every answer fits: the overview, no index', () => {
    expect(votingWall({ spotlightIndex: null, wallFocus: 'none', answers: fit, profile: 'room' })).toEqual({ overview: true, index: null });
  });
  it('no focus and they do not fit: Response 1', () => {
    expect(votingWall({ spotlightIndex: null, wallFocus: 'none', answers: long, profile: 'room' })).toEqual({ overview: false, index: 0 });
  });
  it('a response put up: that response, overview or not', () => {
    expect(votingWall({ spotlightIndex: 2, wallFocus: 'answer', answers: fit, profile: 'room' })).toEqual({ overview: false, index: 2 });
  });
  it('the question put up: neither', () => {
    expect(votingWall({ spotlightIndex: null, wallFocus: 'question', answers: fit, profile: 'room' })).toEqual({ overview: false, index: null });
  });
  it('no answers: nothing', () => {
    expect(votingWall({ spotlightIndex: null, wallFocus: 'none', answers: [], profile: 'room' })).toEqual({ overview: false, index: null });
  });
});
