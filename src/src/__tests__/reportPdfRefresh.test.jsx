/**
 * THE SAVED PDF DRAWS THE REPORT'S OWN DESIGN — the report refresh of
 * 2026-10-31 (docs/design/report-refresh/).
 *
 * THE BUG, first. html2pdf clones the element it is given into an overlay on
 * <body>, outside every ancestor. The report's stylesheet was scoped under
 * `.report-paper`, the CONTAINER's class, so not one rule reached the clone:
 * the saved PDF was drawn by styles.css's 2025 report rules (gradient cards,
 * emoji medals, "The taskHow…" run together, a heading split across a page).
 * On screen nothing looked wrong. jsdom cannot render, so what is pinned here
 * is the CONTRACT that makes the clone correct:
 *   1. the <article> carries its own scope (report-paper, data-theme="light"),
 *      and every document rule in GameReport.css is rooted at `.report-doc`;
 *   2. no class the document renders is styled by styles.css (a leak);
 *   3. the parts saveReport.js hands html2pdf are shallow copies of the
 *      article in PDF mode, so the scope travels with every part;
 *   4. inherited text properties from <body> are reset at the root.
 * The rendering itself was verified by running the shipped html2pdf over a
 * realistic fixture in Chromium and reading the pages (see the commit).
 *
 * Then the rest of the refresh: the session's date and host on the cover, the
 * running head and foot stamped on each page, break rules that keep headings
 * with what they introduce, greyscale-safe marks, and the size guard.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render } from '@testing-library/react';

const mockWorkers = [];
jest.mock('html2pdf.js', () => () => {
  const calls = [];
  const pdf = {
    pages: 3,
    internal: { getNumberOfPages: () => pdf.pages, pageSize: { getWidth: () => 8.5, getHeight: () => 11 } },
    setPage: (n) => calls.push(['setPage', n]),
    setFillColor() {}, lines: () => calls.push(['mark']), setFont() {}, setFontSize() {}, setTextColor() {},
    text: (t) => calls.push(['text', t]), getTextWidth: (t) => String(t).length * 0.05,
    setDrawColor() {}, setLineWidth() {}, line() {}, addPage: () => calls.push(['addPage']),
  };
  const worker = {
    calls, pdf,
    set: (opt) => { calls.push(['set', opt]); return worker; },
    from: (el) => { calls.push(['from', el]); return worker; },
    toContainer: () => worker,
    toCanvas: () => worker,
    toPdf: () => { calls.push(['toPdf']); return worker; },
    get: () => worker,
    then: (fn) => { fn(pdf); return worker; },
    outputPdf: async () => { calls.push(['output']); return 'data:application/pdf;base64,QUJD'; },
  };
  mockWorkers.push(worker);
  return worker;
});

import { ReportDocument, sessionDateOf, hostNameOf, runningFor } from '../components/GameReport';
import { partsFor, drawReportPdf, PDF_MODE_CLASS } from '../utils/saveReport';
import {
  MAX_CANVAS_PX, PDF_INNER_IN, PDF_MARGIN_IN, REPORT_PDF_PASSES, partHeightPx, pdfText, stampRunningHeads,
} from '../config/reportPdf';

const src = (...p) => path.join(__dirname, '..', ...p);
const stripCss = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '');
const CSS = stripCss(fs.readFileSync(src('components', 'GameReport.css'), 'utf8'));
const GLOBAL = stripCss(fs.readFileSync(src('styles.css'), 'utf8'));
const HOST = fs.readFileSync(src('GameHostPage.jsx'), 'utf8');

/** Every selector in a stylesheet, @media preludes and keyframe steps left out. */
function selectorsOf(css) {
  const out = [];
  const re = /([^{}]+)\{/g;
  let m;
  while ((m = re.exec(css))) {
    const prelude = m[1].trim();
    if (prelude.startsWith('@') || /^(from|to|\d+%)$/.test(prelude)) continue;
    prelude.split(',').map((s) => s.trim()).filter(Boolean).forEach((s) => out.push(s));
  }
  return out;
}

/** Every class a stylesheet's selectors name. */
const classesIn = (css) => new Set(selectorsOf(css).flatMap((s) => [...s.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((x) => x[1])));

const answers = (list) => list.map(([answerText, playerName, f, s, t], i) => ({
  answerText, playerName, firstPlace: f, secondPlace: s, thirdPlace: t, totalScore: f * 3 + s * 2 + t,
  rank: i + 1, rankDisplay: ['🥇 1st Place', '🥈 2nd Place', '🥉 3rd Place'][i] || `${i + 1}th Place`,
  voteBreakdown: `${f} first, ${s} second, ${t} third`,
}));

const fixture = {
  gameId: '4417',
  eventTitle: 'Platform Team Offsite — Big Bets',
  gameType: 'call-and-answer',
  startedAt: '2026-10-28T15:00:00Z',
  createdAt: '2026-10-20T09:00:00Z',
  hostName: 'Dana Whitfield',
  scoringConfig: { firstPlacePoints: 3, secondPlacePoints: 2, thirdPlacePoints: 1 },
  eventDetails: 'Half-day offsite for the platform engineering group.',
  questionSetData: { description: 'Three rounds. Answer, read, vote.', category: 'Platform Engineering' },
  players: [
    { playerName: 'Priya Raman', totalScore: 34, joinedAt: '2026-10-28T15:02:10Z' },
    { playerName: 'Marcus Hale', totalScore: 29, joinedAt: '2026-10-28T15:02:31Z' },
  ],
  questions: [{
    questionNumber: 1,
    questionData: { title: 'If we had unlimited people, what should we build?', detail: 'Forget the roadmap.', category: 'Big Bets' },
    aiSummary: { markdownResponse: '## Summary\nThe room split.\n\n- One\n\n1. Two' },
    answers: answers([['A tech-debt remover', 'Marcus Hale', 5, 2, 1], ['A grass-seeding robot', 'Priya Raman', 2, 3, 2]]),
    comments: [{ commentId: 'c1', anchorLabel: 'Response 1', anchorExcerpt: 'A tech-debt remover', text: 'Half a joke.', playerName: 'Priya Raman', featured: true }],
  }, {
    questionNumber: 2,
    questionData: { title: 'Proof', category: 'Proof' },
    aiSummary: { summaryText: 'Ops.', discussionQuestions: ['Why?'], nextSteps: ['Film it.'] },
    answers: answers([['The runbook', 'Priya Raman', 4, 2, 1]]),
    comments: [],
  }],
};

const trivia = {
  ...fixture,
  gameType: 'trivia',
  questions: [{
    questionNumber: 1,
    questionData: { title: 'Context window?', optionA: 'Tokens out', optionB: 'One request', correctAnswer: 'OptionB' },
    aiSummary: null, answers: [],
  }],
};

describe('the bug: the clone html2pdf draws carries the report\'s own scope', () => {
  // rejects: the article without its own scope — the exact shape that shipped
  // the 2025 dashboard as every saved PDF. Fails on the pre-refresh markup,
  // whose <article> had only `report-doc`.
  test('the <article> itself is report-doc, report-paper and data-theme="light"', () => {
    const { container } = render(<ReportDocument reportData={fixture} />);
    const doc = container.querySelector('article');
    expect(doc.classList.contains('report-doc')).toBe(true);
    expect(doc.classList.contains('report-paper')).toBe(true);
    expect(doc.getAttribute('data-theme')).toBe('light');
  });

  // rejects: a document rule scoped under the container. Fails on the
  // pre-refresh sheet, which had ~150 `.report-paper .x` document rules.
  test('every rule outside the screen shell is rooted at .report-doc', () => {
    const SHELL = /^(\.report-container\.report-paper|\.report-paper \.report-(toolbar|tool|tool-group|tool--primary|state|state-spinner|state-actions|noprint)\b|\.report-paper button$|\.report-container \.report-doc$|\.expanded-qr-overlay$|html$|body$|body > \*)/;
    const stray = selectorsOf(CSS).filter((s) => !s.startsWith('.report-doc') && !SHELL.test(s));
    expect(stray).toEqual([]);
  });

  // rejects: a class the article renders that styles.css also styles. That is
  // the leak itself: equal or lower specificity than a global rule, and the
  // global rule's other properties still apply. MarkdownRenderer's own classes
  // are global by design; inside the report every one is restyled under .rpt-md.
  test('no class the document renders is styled by styles.css', () => {
    const globals = classesIn(GLOBAL);
    const rendered = new Set();
    for (const data of [fixture, trivia]) {
      const { container, unmount } = render(<ReportDocument reportData={data} />);
      container.querySelectorAll('[class]').forEach((n) => n.classList.forEach((c) => rendered.add(c)));
      unmount();
    }
    const MARKDOWN = /^(markdown-|md-)/;
    const leaks = [...rendered].filter((c) => globals.has(c) && !MARKDOWN.test(c));
    expect(leaks).toEqual([]);
    for (const c of [...rendered].filter((x) => MARKDOWN.test(x) && globals.has(x) && x !== 'markdown-content')) {
      expect(selectorsOf(CSS).some((s) => s.startsWith('.report-doc .rpt-md') && s.includes(`.${c}`))).toBe(true);
    }
  });

  // rejects: <body>'s inherited text properties reaching the clone. stage.css
  // gives body `tabular-nums`, which made every hyphen draw as "Half- day" in
  // html2canvas; the root resets it and its neighbours.
  test('inherited text properties are reset at the document root', () => {
    const root = /(?:^|\n)\.report-doc\s*\{([^}]*)\}/.exec(CSS)[1];
    for (const decl of [/font-variant-numeric:\s*normal/, /letter-spacing:\s*normal/, /text-transform:\s*none/, /font-style:\s*normal/]) {
      expect(root).toMatch(decl);
    }
    expect(CSS).not.toMatch(/tabular-nums/);
  });

  test('the cover marks are inline paths, never an SVG <use>', () => {
    const { container } = render(<ReportDocument reportData={fixture} />);
    expect(container.querySelectorAll('svg path').length).toBeGreaterThanOrEqual(4);
    expect(container.querySelector('use')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });
});

describe('the parts handed to html2pdf', () => {
  const mount = (data) => render(<ReportDocument reportData={data} />).container.querySelector('article');

  test('the cover is a part of its own; every part is the article in PDF mode', () => {
    const doc = mount(fixture);
    const { parts } = partsFor(doc, { maxPartPx: 16000 });
    expect(parts.length).toBe(2);
    expect(parts[0].children).toHaveLength(1);
    expect(parts[0].firstElementChild.classList.contains('rpt-cover')).toBe(true);
    for (const p of parts) {
      expect(p.tagName).toBe('ARTICLE');
      expect([...p.classList]).toEqual(expect.arrayContaining(['report-doc', 'report-paper', PDF_MODE_CLASS]));
      expect(p.getAttribute('data-theme')).toBe('light');
      expect(p.isConnected).toBe(false);
    }
    // Nothing dropped, nothing doubled, nothing left in PDF mode on screen.
    const total = parts.reduce((n, p) => n + p.children.length, 0);
    expect(total).toBe(doc.children.length);
    expect(doc.classList.contains(PDF_MODE_CLASS)).toBe(false);
  });

  // rejects: one canvas for a report past the 32,000 px ceiling. Heights are
  // stubbed (jsdom has no layout): eight 5,000 px sections at a 16,000 px
  // budget pack three to a part.
  test('a long report is cut at its sections so no canvas passes the ceiling', () => {
    const doc = mount({ ...fixture, questions: Array.from({ length: 6 }, (_, i) => ({ ...fixture.questions[1], questionNumber: i + 1 })) });
    const spy = jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
      if (this.tagName === 'ARTICLE') {
        const n = this.children.length;
        return { top: 0, bottom: n * 5000, height: n * 5000, left: 0, right: 0, width: 0 };
      }
      const i = Array.prototype.indexOf.call(this.parentNode ? this.parentNode.children : [], this);
      return { top: i * 5000, bottom: (i + 1) * 5000, height: 5000, left: 0, right: 0, width: 0 };
    });
    try {
      const { parts, tallestPx } = partsFor(doc, { maxPartPx: 16000 });
      expect(parts.length).toBeGreaterThan(2);
      expect(tallestPx).toBeLessThanOrEqual(16000);
      for (const p of parts.slice(1)) expect(p.children.length).toBeLessThanOrEqual(3);
    } finally {
      spy.mockRestore();
    }
  });

  test('an element with no part markers (a Build Room report) is one part', () => {
    const el = document.createElement('div');
    el.className = 'brr-sheet';
    el.innerHTML = '<h1>Room</h1><p>Body</p>';
    const { parts } = partsFor(el, { maxPartPx: 16000 });
    expect(parts).toHaveLength(1);
    expect(parts[0].classList.contains('brr-sheet')).toBe(true);
    expect(parts[0].classList.contains(PDF_MODE_CLASS)).toBe(true);
    expect(parts[0].children).toHaveLength(2);
  });

  test('the budget per part keeps every canvas under the ceiling at each pass', () => {
    for (const pass of REPORT_PDF_PASSES) expect(partHeightPx(pass.scale) * pass.scale).toBeLessThan(MAX_CANVAS_PX);
  });

  // rejects: stamping before the pages exist, or output before the stamp; and
  // drawing a second part onto the cover's page.
  test('each part starts a page; the head and foot are stamped before the file is written', async () => {
    mockWorkers.length = 0;
    const doc = mount(fixture);
    const b64 = await drawReportPdf({ element: doc, title: fixture.eventTitle, pass: REPORT_PDF_PASSES[0], running: runningFor(fixture) });
    expect(b64).toBe('QUJD');
    const names = mockWorkers[0].calls.map((c) => c[0]);
    expect(names.filter((n) => n === 'from')).toHaveLength(2);
    expect(names.indexOf('addPage')).toBeGreaterThan(names.indexOf('toPdf'));
    expect(names.indexOf('addPage')).toBeLessThan(names.lastIndexOf('from'));
    const texts = mockWorkers[0].calls.filter((c) => c[0] === 'text').map((c) => c[1]);
    expect(texts).toContain('Page 2 of 3');
    expect(names.lastIndexOf('text')).toBeLessThan(names.indexOf('output'));
  });
});

describe('the running head and foot', () => {
  const fakePdf = (pages) => {
    const calls = [];
    return {
      calls,
      internal: { getNumberOfPages: () => pages, pageSize: { getWidth: () => 8.5, getHeight: () => 11 } },
      setPage: (n) => calls.push(['page', n]),
      setFillColor() {}, lines() {}, setFont() {}, setFontSize() {}, setTextColor() {},
      text: (t, x, y, o) => calls.push(['text', t, x, y, o]),
      getTextWidth: (t) => String(t).length * 0.06,
      setDrawColor() {}, setLineWidth() {}, line: (...a) => calls.push(['line', ...a]),
    };
  };

  test('every page after the cover carries the head, the session and "Page n of N"', () => {
    const pdf = fakePdf(5);
    const stamped = stampRunningHeads(pdf, runningFor(fixture));
    expect(stamped).toEqual([2, 3, 4, 5]);
    const texts = pdf.calls.filter((c) => c[0] === 'text').map((c) => c[1]);
    expect(texts).toContain('ENGAGE · SESSION REPORT');
    expect(texts).toContain('Platform Team Offsite — Big Bets');
    expect(texts).toContain('Session 4417 · 28 October 2026');
    expect(texts.filter((t) => /^Page \d of 5$/.test(t))).toEqual(['Page 2 of 5', 'Page 3 of 5', 'Page 4 of 5', 'Page 5 of 5']);
  });

  test('in the margins, never over the text block', () => {
    const pdf = fakePdf(2);
    stampRunningHeads(pdf, runningFor(fixture));
    for (const [, , , y] of pdf.calls.filter((c) => c[0] === 'text')) {
      expect(y < PDF_MARGIN_IN[0] || y > 11 - PDF_MARGIN_IN[2]).toBe(true);
    }
  });

  test('a document without a cover is stamped from page 1', () => {
    expect(stampRunningHeads(fakePdf(2), { title: 'Build Room' })).toEqual([1, 2]);
  });

  test('a long title is cut to fit beside the brand, with an ellipsis', () => {
    const pdf = fakePdf(2);
    stampRunningHeads(pdf, { ...runningFor(fixture), title: 'A very long session title '.repeat(10) });
    const title = pdf.calls.filter((c) => c[0] === 'text' && c[4] && c[4].align === 'right' && !/^Page/.test(c[1]))[0][1];
    expect(title.endsWith('…')).toBe(true);
    expect(title.length).toBeLessThan(120);
  });

  test('text Helvetica cannot draw is dropped, typographic punctuation kept', () => {
    expect(pdfText('Offsite — “Big” Bets…')).toBe('Offsite — “Big” Bets…');
    expect(pdfText('東京 Offsite')).toBe('Offsite');
    expect(pdfText('  a  b ')).toBe('a b');
  });
});

describe('the session\'s date and host, not the build date', () => {
  test('Held is the day play started, else the day it was created, else nothing', () => {
    expect(sessionDateOf(fixture).toISOString()).toBe('2026-10-28T15:00:00.000Z');
    expect(sessionDateOf({ createdAt: '2026-10-20T09:00:00Z' }).toISOString()).toBe('2026-10-20T09:00:00.000Z');
    expect(sessionDateOf({})).toBeNull();
    expect(sessionDateOf({ startedAt: 'not a date' })).toBeNull();
  });

  // rejects: `new Date()` on the cover, which printed a Friday retro of a
  // Wednesday session as held on Friday.
  test('the cover prints the session\'s date and host', () => {
    const { container } = render(<ReportDocument reportData={fixture} />);
    const facts = container.querySelector('.rpt-facts').textContent;
    expect(facts).toContain('Held');
    expect(facts).toContain('28 October 2026');
    expect(facts).toContain('Hosted by');
    expect(facts).toContain('Dana Whitfield');
  });

  test('with neither date, there is no Held; "Unknown Host" is no host', () => {
    const { container } = render(<ReportDocument reportData={{ ...fixture, startedAt: null, createdAt: null, hostName: 'Unknown Host' }} />);
    const facts = container.querySelector('.rpt-facts').textContent;
    expect(facts).not.toContain('Held');
    expect(facts).not.toContain('Hosted by');
    expect(hostNameOf({ hostName: 'Unknown Host' })).toBe('');
    expect(runningFor({ gameId: '9', eventTitle: 'X' }).footLeft).toBe('Session 9');
  });

  // rejects: the rebuild in GameHostPage dropping them again — the reason the
  // cover had no date or host to show although create-report.js sent both.
  test('GameHostPage forwards startedAt, createdAt, hostName and scoringConfig', () => {
    expect(HOST).toMatch(/startedAt:\s*report\.startedAt/);
    expect(HOST).toMatch(/createdAt:\s*report\.createdAt/);
    expect(HOST).toMatch(/hostName:\s*report\.hostName/);
    expect(HOST).toMatch(/scoringConfig:\s*report\.scoringConfig/);
  });
});

describe('headings never part from what they introduce', () => {
  test('a round\'s opener, question and task are one unbreakable unit', () => {
    const { container } = render(<ReportDocument reportData={fixture} />);
    const unit = container.querySelector('.rpt-opener-unit');
    expect(unit.classList.contains('report-keep')).toBe(true);
    expect(unit.querySelector('.rpt-opener-title')).not.toBeNull();
    expect(unit.querySelector('.rpt-lead')).not.toBeNull();
    expect(unit.querySelector('.rpt-task-label').textContent).toBe('The task');
  });

  test('each sub-head travels with its first row', () => {
    for (const data of [fixture, trivia]) {
      const { container, unmount } = render(<ReportDocument reportData={data} />);
      const groups = [...container.querySelectorAll('.rpt-keepnext')];
      expect(groups.length).toBeGreaterThan(0);
      for (const g of groups) {
        expect(g.classList.contains('report-keep')).toBe(true);
        expect(g.querySelector('h2, h3')).not.toBeNull();
      }
      const responses = container.querySelector('.rpt-responses .rpt-keepnext');
      if (responses) expect(responses.querySelector('.rpt-resp')).not.toBeNull();
      const choices = container.querySelector('.rpt-choices .rpt-keepnext');
      if (choices) expect(choices.querySelector('.rpt-choice')).not.toBeNull();
      unmount();
    }
  });

  // html2pdf's slicer cuts wherever the page ends, through a line of text if
  // it must. Its 'css' mode reads computed break-inside, so the PDF mode makes
  // every line-bearing element and every keep unit unbreakable.
  test('the PDF mode makes text and keep units unbreakable', () => {
    for (const sel of ['.report-keep', 'p', 'li', 'blockquote', 'h2', 'h3']) {
      expect(selectorsOf(CSS).includes(`.report-doc.report-pdf ${sel}`)).toBe(true);
    }
    expect(CSS).toMatch(/\.report-doc\.report-pdf h4,[\s\S]*?\{\s*break-inside:\s*avoid/);
  });

  // rejects: a cover that spills a blank sliver onto page 2, or a page box the
  // stamps would overprint.
  test('the cover is one page tall in the PDF, and Print uses the same page box', () => {
    expect(PDF_INNER_IN.height).toBeCloseTo(9.4, 5);
    expect(CSS).toMatch(/\.report-doc\.report-pdf \.rpt-cover\s*\{[^}]*height:\s*calc\(9\.4in - \d+px\)/);
    expect(CSS).toMatch(/@page\s*\{[^}]*margin:\s*0\.75in 0\.75in 0\.85in/);
    expect(PDF_MARGIN_IN).toEqual([0.75, 0.75, 0.85, 0.75]);
  });
});

describe('greyscale-safe, and amber never carries text', () => {
  test('rank, top-voted, champion and correct are said in words; no emoji medals', () => {
    const { container } = render(<ReportDocument reportData={fixture} />);
    const text = container.textContent;
    expect(container.querySelector('.rpt-resp--top .rpt-flag').textContent).toBe('Top-voted');
    expect(container.querySelector('.rpt-standing--champion').textContent).toContain('Session champion');
    expect(container.querySelector('.comment-featured').textContent).toBe('Shown to the room');
    expect(text).not.toMatch(/[\u{1F947}-\u{1F949}]/u);
    expect(text).not.toMatch(/1st Place/);
  });

  test('the cover leads with the result: counts and the top-voted response with its points', () => {
    const { container } = render(<ReportDocument reportData={fixture} />);
    const strip = container.querySelector('.rpt-strip');
    expect([...strip.querySelectorAll('.rpt-strip-count')].map((n) => n.textContent)).toEqual(['2People', '2Rounds', '3Responses']);
    expect(strip.querySelector('.rpt-strip-key').textContent).toContain('“A tech-debt remover”');
    expect(strip.querySelector('.rpt-strip-key').textContent).toContain('Round 1 · 20 points · 5 first-choice votes');
  });

  test('Workie\'s read is labelled as AI analysis, not the host\'s words', () => {
    const { container } = render(<ReportDocument reportData={fixture} />);
    const reads = container.querySelectorAll('.rpt-workie');
    expect(reads).toHaveLength(2);
    for (const r of reads) expect(r.textContent).toMatch(/AI analysis of the responses, not the host’s words/);
  });

  test('no colour declaration reads the amber mark token', () => {
    const decls = [...CSS.matchAll(/(?:^|[;{\s])color:\s*([^;}]+)/g)].map((m) => m[1]);
    expect(decls.some((v) => /--rpt-amber|#F6A94C/i.test(v))).toBe(false);
    expect(CSS).toMatch(/--rpt-accent-ink:\s*var\(--accent-text\)/);
  });
});

/*
 * TRIVIA: WHY IT'S RIGHT, AND HOW THE ROOM ANSWERED (owner, 2026-10-31: "if
 * there is info in the question set as to why it is right, that should be
 * included"). `answerDetails` has always been in the payload and was never
 * printed; `triviaTally` is new (create-report.js, tests/report-trivia-tally.js).
 */
describe('a trivia round: why it is right, and the room\'s counts', () => {
  const tallied = {
    ...trivia,
    questions: [{
      questionNumber: 1,
      questionData: {
        title: 'Context window?', optionA: 'Tokens out', optionB: 'One request', optionC: 'Memory',
        correctAnswer: 'OptionB', answerDetails: 'It is everything the model reads at once.',
        background: 'AUTHOR NOTES FOR WORKIE',
      },
      triviaTally: { answered: 10, correct: 7, options: [
        { slot: 'A', letter: 'A', count: 2, correct: false },
        { slot: 'B', letter: 'B', count: 7, correct: true },
        { slot: 'C', letter: 'C', count: 1, correct: false },
      ] },
      aiSummary: null, answers: [],
    }],
  };

  test('the set\'s explanation sits under the right answer, labelled', () => {
    const { container } = render(<ReportDocument reportData={tallied} />);
    const why = container.querySelectorAll('.rpt-why');
    expect(why).toHaveLength(1);
    expect(why[0].closest('.rpt-choice').classList.contains('rpt-choice--correct')).toBe(true);
    expect(why[0].querySelector('.rpt-why-label').textContent).toBe('Why it’s right');
    expect(why[0].textContent).toContain('It is everything the model reads at once.');
  });

  // The author's background is Workie's material, "never shown to players".
  test('never the question\'s background', () => {
    const { container } = render(<ReportDocument reportData={tallied} />);
    expect(container.textContent).not.toContain('AUTHOR NOTES FOR WORKIE');
  });

  test('no explanation, no empty block', () => {
    const bare = JSON.parse(JSON.stringify(tallied));
    bare.questions[0].questionData.answerDetails = '   ';
    const { container } = render(<ReportDocument reportData={bare} />);
    expect(container.querySelector('.rpt-why')).toBeNull();
  });

  test('each option carries its count, share and a bar; the right one a tick and the word', () => {
    const { container } = render(<ReportDocument reportData={tallied} />);
    const rows = [...container.querySelectorAll('.rpt-choice')];
    expect(rows.map((r) => r.querySelector('.rpt-choice-count').textContent)).toEqual(['2 picked20%', '7 picked70%', '1 picked10%']);
    expect(rows.map((r) => r.querySelector('.rpt-choice-bar i').style.width)).toEqual(['20%', '70%', '10%']);
    const right = container.querySelector('.rpt-choice--correct');
    expect(right.querySelector('.rpt-tag--correct').textContent).toBe('Correct');
    expect(right.querySelector('.rpt-tag--correct svg.rpt-tick path')).not.toBeNull();
    expect(container.querySelector('.rpt-choices .rpt-sub-note').textContent).toBe('10 answered · 70% correct');
  });

  // The tally's correct flag and drawn letter are the scorer's; a question
  // that skips a slot shows the letter the room saw.
  test('the right answer and the letters follow the tally', () => {
    const holey = JSON.parse(JSON.stringify(tallied));
    holey.questions[0].questionData = { title: 'Q', optionA: 'One', optionC: 'Three', correctAnswer: 'OptionC' };
    holey.questions[0].triviaTally = { answered: 3, correct: 2, options: [
      { slot: 'A', letter: 'A', count: 1, correct: false }, { slot: 'C', letter: 'B', count: 2, correct: true }] };
    const { container } = render(<ReportDocument reportData={holey} />);
    expect([...container.querySelectorAll('.rpt-choice-letter')].map((n) => n.textContent)).toEqual(['A', 'B']);
    expect(container.querySelector('.rpt-choice--correct').textContent).toContain('Three');
  });

  test('a report from before the counts still marks the right answer, with no count column', () => {
    const { container } = render(<ReportDocument reportData={trivia} />);
    expect(container.querySelector('.rpt-choice-count')).toBeNull();
    expect(container.querySelector('.rpt-choice--correct').textContent).toContain('One request');
  });

  test('the choices are inside the opener\'s unit, so the question never strands without them', () => {
    const { container } = render(<ReportDocument reportData={tallied} />);
    expect(container.querySelector('.rpt-opener-unit .rpt-choices')).not.toBeNull();
  });
});
