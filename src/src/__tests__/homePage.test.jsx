import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import HomePage from '../marketing/HomePage';
import { navigateTo } from '../auth/navigate';
import { RETURN_KEY } from '../auth/returnPath';
import { SAMPLE_REPORT_HOME, SAMPLE_REPORT } from '../marketing/content/sampleReport';
import { HOME } from '../marketing/content/home';

jest.mock('../auth/navigate', () => ({ navigateTo: jest.fn() }));
beforeEach(() => {
  jest.clearAllMocks();
  global.fetch.mockReset();
  sessionStorage.clear();
  window.API_BASE = 'https://api.example/';
});

test('one h1, and it is about the reader, not the product', () => {
  render(<HomePage />);
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/team/i);
});

test('the climb is told in order: problem, two modes, material, the room, the report', () => {
  render(<HomePage />);
  const ids = [...document.querySelectorAll('section[id]')].map((s) => s.id);
  expect(ids).toEqual(['top', 'problem', 'modes', 'material', 'room', 'summit', 'start']);
});

test('a player who types the bare domain can still join from the hero', async () => {
  render(<HomePage />);
  const hero = document.getElementById('top');
  fireEvent.change(within(hero).getByLabelText(/session code/i), { target: { value: '4821' } });
  global.fetch.mockResolvedValueOnce({ status: 200, ok: true, json: async () => ({}) });
  fireEvent.click(within(hero).getByRole('button', { name: /join/i }));
  await waitFor(() => expect(navigateTo).toHaveBeenCalledWith('/play?gameId=4821'));
});

test('the hero register CTA asks for the register form and returns the host to /', () => {
  render(<HomePage />);
  const hero = document.getElementById('top');
  fireEvent.click(within(hero).getByRole('link', { name: /create a host account/i }));
  expect(navigateTo).toHaveBeenCalledWith('/auth?mode=register');
  expect(sessionStorage.getItem(RETURN_KEY)).toBe('/');
});

// Adapted from the brief: the mockup's mode-copy heading text does not itself
// contain the words "trivia" / "call and answer" (those live in a sibling
// `.mk-mode-tag` badge). HomePage nests that tag inside the h3 so the heading's
// accessible name carries it, keeping the mockup's markup/classes intact while
// giving the heading a name these queries can match.
test('both modes show the room and the phone', () => {
  render(<HomePage />);
  const modes = document.getElementById('modes');
  // level 3: since 2026-09-25 the section's own h2 names both modes too
  // ("Trivia to check what people know. Call and answer to hear what they
  // think."), so the query is pinned to the mode headings themselves.
  expect(within(modes).getByRole('heading', { level: 3, name: /trivia/i })).toBeInTheDocument();
  expect(within(modes).getByRole('heading', { level: 3, name: /call and answer/i })).toBeInTheDocument();
  expect(within(modes).getAllByRole('img')).toHaveLength(4);
});

test('the report is the one paper surface, and converts theme and markup together', () => {
  render(<HomePage />);
  const paper = document.querySelectorAll('[data-theme="light"]');
  expect(paper).toHaveLength(1);
  expect(document.getElementById('summit')).toContainElement(paper[0]);
  expect(within(paper[0]).getAllByText(/next steps/i).length).toBeGreaterThan(0);
});

test("the home sheet's own headings stay h3/h4 — SampleReport's default `headingLevel`", () => {
  // Fix round 1 gave SampleReport a `headingLevel` prop (/reports passes 2)
  // so its headings can drop under a page h1 without DOM reordering. The
  // home page renders under its own section h2 and must keep the default
  // (3), so this pins it: a change to the default would silently move the
  // home sheet's headings and this is the only test that would catch it.
  render(<HomePage />);
  const sheet = document.querySelector('.mk-report');
  expect(sheet.querySelector('.mk-report-title').tagName).toBe('H3');
  const blockHeadings = sheet.querySelectorAll('.mk-report-block-h');
  expect(blockHeadings.length).toBeGreaterThan(0);
  for (const h of blockHeadings) expect(h.tagName).toBe('H4');
});

// Adapted from the brief: the link text for these two links is "See how it
// works" (closing CTA -> /how-it-works) and, since the 2026-09-25 copy pass,
// "See a full sample report, with notes" (below the report -> /reports; it
// was "See a full report, annotated"). Hrefs are unchanged.
test('the tour and the report page are one click away', () => {
  render(<HomePage />);
  expect(screen.getByRole('link', { name: /see how it works/i })).toHaveAttribute('href', '/how-it-works');
  expect(screen.getByRole('link', { name: /see a full sample report/i })).toHaveAttribute('href', '/reports');
});

// Fix round 1 (ruling 1): the home page must show exactly the sheet approved
// in 01-home.html (SAMPLE_REPORT_HOME), not the fuller 04-reports.html sheet
// (SAMPLE_REPORT) that /reports (Task 10) will use.
test('the home report shows every answer from the approved home sheet, including the zero-vote one', () => {
  render(<HomePage />);
  const paper = document.querySelector('[data-theme="light"]');
  for (const answer of SAMPLE_REPORT_HOME.round.answers) {
    expect(within(paper).getByText(answer.text)).toBeInTheDocument();
  }
  // The zero-vote answer specifically: kept, not quietly dropped.
  const zeroVote = SAMPLE_REPORT_HOME.round.answers.find((a) => a.votes === 0);
  expect(within(paper).getByText(zeroVote.votesText)).toBeInTheDocument();
});

test('the home report shows the next step only the home sheet has', () => {
  render(<HomePage />);
  const paper = document.querySelector('[data-theme="light"]');
  const homeOnlyStep = SAMPLE_REPORT_HOME.round.nextSteps.find(
    (step) => !SAMPLE_REPORT.round.nextSteps.includes(step),
  );
  expect(homeOnlyStep).toBeTruthy();
  expect(within(paper).getByText(homeOnlyStep)).toBeInTheDocument();
});

test('the home report does not show content that belongs only to the fuller /reports sheet', () => {
  render(<HomePage />);
  const paper = document.querySelector('[data-theme="light"]');
  const fullOnlyQuestion = SAMPLE_REPORT.round.discussionQuestions[0];
  expect(within(paper).queryByText(fullOnlyQuestion)).not.toBeInTheDocument();
});

test('the two report views are one invented session, and neither uses "favorite"', () => {
  // The answers and bylines are defined once in content/sampleReport.js and
  // spread into both views, so the two sheets cannot drift into different
  // sessions. Since 2026-09-25 the home view carries its own COUNTS (points,
  // what the real report prints) and its own standings (no Correct column),
  // so the rows are no longer the same objects; their words still are.
  const words = (view) => view.round.answers.map((a) => [a.text, a.by.split(' · ')[0]]);
  expect(words(SAMPLE_REPORT_HOME)).toEqual(words(SAMPLE_REPORT));
  expect(SAMPLE_REPORT_HOME.standings.map((s) => s.name))
    .toEqual(SAMPLE_REPORT.standings.slice(0, 3).map((s) => s.name));

  const everything = JSON.stringify(SAMPLE_REPORT_HOME) + JSON.stringify(SAMPLE_REPORT);
  expect(everything.toLowerCase()).not.toMatch(/favou?rite/);
});

test('the home sheet counts what the real report counts: points from ranked ballots, and no Correct column', () => {
  // Each player ranks a top three, scored 3/2/1 (game/get-results.js), and
  // GameReport.jsx prints "N points". Twenty ballots hand out 120 points.
  const answers = SAMPLE_REPORT_HOME.round.answers;
  for (const a of answers) expect(a.votesText).toBe(`${a.votes} points`);
  expect(answers.reduce((sum, a) => sum + a.votes, 0)).toBe(20 * (3 + 2 + 1));
  render(<HomePage />);
  const paper = document.querySelector('[data-theme="light"]');
  expect(within(paper).queryByText(/\bvotes\b/)).toBeNull();
  // rejects: a "Correct" column the real report's Final Scores do not have.
  expect(within(paper).queryByRole('columnheader', { name: /correct/i })).toBeNull();
  expect(within(paper).getAllByRole('columnheader')).toHaveLength(3);
  // A trivia question pays at most 15 (10 + up to 5 for speed; websocket/
  // message.js), and the session has six questions, so no total can pass 90.
  for (const s of SAMPLE_REPORT_HOME.standings) expect(Number(s.points)).toBeLessThanOrEqual(6 * 15);
});

/* ------------------------------------------------------- fix round 2: the
 * sheet's footer buttons looked like live buttons but did nothing —
 * SampleReport renders them as inert, aria-hidden spans, and its
 * `footerLinks` prop is gone entirely. Since 2026-09-25 the home sheet draws
 * the real report toolbar's two buttons, Print and Save report, instead of
 * "Export PDF" / "Copy shareable link". */
test('the sample sheet on home has no live links or buttons of its own', () => {
  render(<HomePage />);
  const article = screen.getByRole('article', { name: /sample session report/i });
  expect(within(article).queryAllByRole('link')).toHaveLength(0);
  expect(within(article).queryAllByRole('button')).toHaveLength(0);
  expect(within(article).getByText('Print')).toHaveAttribute('aria-hidden', 'true');
  expect(within(article).getByText('Save report')).toHaveAttribute('aria-hidden', 'true');
});

test('the home page still has its own, real link to /reports outside the sheet', () => {
  render(<HomePage />);
  const article = screen.getByRole('article', { name: /sample session report/i });
  const reportsLink = screen.getByRole('link', { name: /see a full sample report/i });
  expect(reportsLink).toHaveAttribute('href', '/reports');
  expect(article).not.toContainElement(reportsLink);
});

/* =========================================================== refresh 2026-09-22
 * docs/design/refresh-2026-09-22/RATIONALE.md §1 (the front page) and §6
 * steps 1–2. Behaviour and DOM structure only: jsdom has no layout engine,
 * so nothing below measures a width, an offset or a viewport. The CSS-as-text
 * half of the contract (reduced motion, the wash contrast, the 1px rule) is
 * in marketingPalette.test.js.
 */
describe('the front page, refreshed (2026-09-22)', () => {
  test('the product is in the first viewport: the hero carries the drawn RESULTS still and the phone, as decoration', () => {
    render(<HomePage />);
    const hero = document.getElementById('top');
    const stage = hero.querySelector('.mk-hero-stage');
    expect(stage).not.toBeNull();
    expect(stage).toHaveAttribute('aria-hidden', 'true');
    expect(stage.querySelector('.mk-device--tv')).not.toBeNull();
    expect(stage.querySelector('.mk-device--phone')).not.toBeNull();
    // Open question 2's recommended answer: RESULTS trivia, not VOTE — one
    // correct row carrying the headline, shares beside every option.
    expect(stage.querySelector('.mk-ss-bar.mk-ss-right')).not.toBeNull();
    expect(stage.querySelectorAll('.mk-ss-bar')).toHaveLength(4);
    // A right answer pays 10 plus up to 5 for speed (websocket/message.js):
    // the drawing shows a number one question can actually pay.
    expect(within(stage).getByText('+14 pts')).toBeInTheDocument();
    // No caption under either device: the headline is the caption.
    expect(stage.querySelector('.mk-device-cap')).toBeNull();
  });

  test('the headline is the approved sentence, carried as four authored lines that rise once', () => {
    render(<HomePage />);
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1).toHaveClass('mk-rise');
    const lines = [...h1.querySelectorAll(':scope > span')].map((s) => s.textContent);
    expect(lines).toEqual(HOME.hero.headlineLines);
    expect(lines).toHaveLength(4);
    // Approved 2026-09-25 (docs/design/front-page-copy-2026-09-25/COPY.md).
    expect(lines.join(' ')).toBe('Bring your team a new idea. Hear what everyone makes of it.');
  });

  test('one filled amber control above the fold: exactly one mk-btn-primary inside .mk-hero', () => {
    render(<HomePage />);
    const hero = document.querySelector('.mk-hero');
    expect(hero.querySelectorAll('.mk-btn-primary')).toHaveLength(1);
    // Join is still a button and still works (the test above proves the
    // navigation); it is just not a second primary.
    expect(within(hero).getByRole('button', { name: /join/i })).not.toHaveClass('mk-btn-primary');
    // The shell root carries the class HomePage.css scopes the nav-door
    // outline to, so no other marketing page inherits it.
    expect(document.querySelector('.mk-root')).toHaveClass('mk-home');
  });

  test('kickers survive only at the two ends of the climb: #top and #summit', () => {
    render(<HomePage />);
    const kickers = [...document.querySelectorAll('.mk-kicker')];
    expect(kickers).toHaveLength(2);
    expect(kickers.map((k) => k.closest('section').id)).toEqual(['top', 'summit']);
    // Plain labels since 2026-09-25; the ridge scene still draws the climb.
    expect(kickers.map((k) => k.textContent)).toEqual(['For offsites, workshops and retros', 'The report']);
  });

  test('the scaffold tells are gone: no 01/02/03 numerals, no problem cards, no flow cards', () => {
    render(<HomePage />);
    expect(document.querySelector('.mk-stmt-n')).toBeNull();
    expect(document.querySelector('.mk-stmt')).toBeNull();
    expect(document.querySelector('.mk-problem-grid')).toBeNull();
    expect(document.querySelector('.mk-flow')).toBeNull();
    expect(document.querySelector('.mk-flow-n')).toBeNull();
    const problem = document.getElementById('problem');
    expect(problem.querySelectorAll('.mk-stmts article')).toHaveLength(3);
    expect(problem.textContent).not.toMatch(/\b0[123]\b/);
  });

  test('the four steps are an ordered sequence — the order is information, so those numerals stay', () => {
    render(<HomePage />);
    const material = document.getElementById('material');
    const seq = within(material).getByRole('list');
    expect(seq.tagName).toBe('OL');
    expect(seq).toHaveClass('mk-seq');
    const numerals = [...seq.querySelectorAll('.mk-seq-n')].map((n) => n.textContent);
    expect(numerals).toEqual(['1', '2', '3', '4']);
    // The material note keeps its copy; its 1px rule is asserted in the palette test.
    expect(material.querySelector('.mk-material-note')).toHaveTextContent(/private stays private/i);
  });

  test('each mode states its fact once: no paragraph repeating the first list item', () => {
    render(<HomePage />);
    const modes = document.getElementById('modes');
    expect(modes.querySelector('.mk-mode-copy > p')).toBeNull();
    for (const mode of HOME.modes.items) {
      expect(mode.text).toBeUndefined();
      expect(mode.list).toHaveLength(3);
    }
    // The honesty line is still on the page: trivia has no vote.
    expect(within(modes).getByText(/no vote here: people answer, then you show the results/i)).toBeInTheDocument();
  });

  test('the tally is a performing block: bars declared at zero with the real value in --w, counts that land on the content’s points', async () => {
    render(<HomePage />);
    const tally = document.querySelector('.mk-tally');
    // jsdom has no IntersectionObserver, so the hook falls back to "in view"
    // at once — the final frame, never a blank block.
    expect(tally).toHaveClass('mk-tally--in');
    const bars = [...tally.querySelectorAll('.mk-tally-track i')];
    expect(bars.map((b) => b.style.getPropertyValue('--w'))).toEqual(HOME.room.tally.rows.map((r) => `${r.width}%`));
    // No inline width: the CSS owns the growth from 0 to --w.
    for (const bar of bars) expect(bar.style.width).toBe('');
    const counts = [...tally.querySelectorAll('[data-count]')];
    expect(counts.map((c) => Number(c.dataset.count))).toEqual(HOME.room.tally.rows.map((r) => r.points));
    await waitFor(() => {
      expect(counts.map((c) => c.textContent)).toEqual(HOME.room.tally.rows.map((r) => String(r.points)));
    });
    // Points, not votes: each player ranks a top three, scored 3/2/1
    // (game/get-results.js). Twenty ballots hand out 120, and the rows add up.
    expect(HOME.room.tally.unit).toBe('points');
    expect(HOME.room.tally.rows.reduce((sum, r) => sum + r.points, 0)).toBe(20 * (3 + 2 + 1));
    for (const n of tally.querySelectorAll('.mk-tally-n')) expect(n).toHaveTextContent(/ points$/);
    // The answer nobody picked is still kept, and still says so.
    expect(within(tally).getByText(/nobody picked stays in the report/i)).toBeInTheDocument();
  });

  test('the room’s list says when answers reach the front screen: at the vote, not as they arrive', () => {
    // It used to promise arrivals on the front screen "as they are
    // submitted". During ASK the stage shows the question and a count; the
    // answers go up when the vote opens (GameHostPage.jsx).
    render(<HomePage />);
    const room = document.getElementById('room');
    expect(within(room).getByText(/when you move to the vote, every answer goes up on the front screen/i)).toBeInTheDocument();
    expect(room.textContent).not.toMatch(/as they are submitted|arrive live/i);
  });

  test('the two photographs sit where §4 places them, captioned in the wash band, served from our own origin', () => {
    render(<HomePage />);
    const room = document.getElementById('room');
    const summit = document.getElementById('summit');
    const roomPhoto = room.querySelector('.mk-art--photo');
    const sheetPhoto = summit.querySelector('.mk-art--photo');
    expect(roomPhoto).not.toBeNull();
    expect(sheetPhoto).not.toBeNull();
    expect(sheetPhoto).toHaveClass('mk-art--sheet');
    for (const fig of [roomPhoto, sheetPhoto]) {
      expect(fig.tagName).toBe('FIGURE');
      const img = fig.querySelector('img');
      expect(img.getAttribute('src')).toMatch(/^\/assets\/hero\/[a-z0-9-]+\.webp$/);
      expect(img.getAttribute('alt')).toMatch(/\S/);
      expect(img).toHaveAttribute('loading', 'lazy');
      const cap = fig.querySelector('figcaption.mk-art-wash');
      expect(cap).not.toBeNull();
      expect(cap.textContent).toMatch(/\S/);
    }
    // The room photo is beside the tally; the sheet photo is beside the report.
    expect(room.querySelector('.mk-react-grid')).toContainElement(roomPhoto);
    expect(summit.querySelector('.mk-summit-grid')).toContainElement(sheetPhoto);
    expect(summit.querySelector('.mk-summit-aside')).toContainElement(sheetPhoto);
  });

  test('every hero photograph exists on disk under budget and has a CREDITS.json entry with its licence', () => {
    const fs = require('fs');
    const path = require('path');
    const dir = path.join(__dirname, '..', '..', 'public', 'assets', 'hero');
    const credits = JSON.parse(fs.readFileSync(path.join(dir, 'CREDITS.json'), 'utf8'));
    const byFile = Object.fromEntries(credits.images.map((i) => [i.file, i]));
    const BUDGET = { 'room-looking-up-1024.webp': 180 * 1024, 'summit-held-768.webp': 160 * 1024 };
    const used = Object.values(HOME.photos).map((p) => path.basename(p.src));
    expect(used.sort()).toEqual(Object.keys(BUDGET).sort());
    for (const file of used) {
      expect(fs.statSync(path.join(dir, file)).size).toBeLessThanOrEqual(BUDGET[file]);
      expect(byFile[file]).toBeDefined();
      expect(byFile[file].license).toMatch(/\S/);
      expect(byFile[file].source).toMatch(/\S/);
    }
  });
});
