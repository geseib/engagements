/**
 * THE SESSION REPORT — the component, its call site, and its print sheet.
 *
 * Three kinds of assertion, and the split is deliberate.
 *
 * 1. RENDERED. `GameReport` is now a component of its own, so for the first
 *    time the report can be mounted at all — inline in GameHostPage.jsx it
 *    could not be, because that page dies on the auth provider under jsdom.
 *    Everything about WHAT is on the page is asserted by rendering it.
 *
 * 2. SOURCE, at the call site. The wiring between GameHostPage and this
 *    component cannot be reached by rendering, for the same reason. Those
 *    assertions run against COMMENT-STRIPPED source, following the convention
 *    in setupPanelCallSite.test.js — a previous agent's test passed on a
 *    comment.
 *
 * 3. SOURCE, on the stylesheet. jsdom HAS NO LAYOUT ENGINE. It cannot tell you
 *    that a paragraph no longer splits across a page break or that the printed
 *    measure is right; a test that claimed to would pass with GameReport.css
 *    deleted. What is asserted here is only that the print sheet DECLARES the
 *    properties that do the work — @page, orphans/widows, the break rules —
 *    because those are the declarations a well-meaning tidy-up deletes.
 *
 *    The layout itself was verified by printing the component to PDF in a real
 *    headless Chromium and reading the pages. That is the only place a claim
 *    about width or page breaks can honestly be made, and it is not here.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent } from '@testing-library/react';
import GameReport, { ReportDocument } from '../components/GameReport';

const src = (...p) => path.join(__dirname, '..', ...p);

/** Source with every comment removed. */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/([^:'"`\\])\/\/.*$/gm, '$1');
}

const host = stripComments(fs.readFileSync(src('GameHostPage.jsx'), 'utf8'));
/* Comment-stripped, for the same reason the JS is: this file's own header
   comment contains the string "@media print", and the first version of the
   extractor below happily locked onto it. A test that passes on prose is not a
   test. */
const printCss = fs.readFileSync(src('components', 'GameReport.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

/** Only the @media print block — so a screen rule can never satisfy a print assertion. */
const printBlock = (() => {
  const at = printCss.indexOf('@media print');
  if (at === -1) return '';
  let depth = 0;
  for (let i = printCss.indexOf('{', at); i < printCss.length; i += 1) {
    if (printCss[i] === '{') depth += 1;
    if (printCss[i] === '}') { depth -= 1; if (depth === 0) return printCss.slice(at, i + 1); }
  }
  return printCss.slice(at);
})();

const reportData = {
  gameId: 'ENG-77',
  eventTitle: 'Northwind Q3 Offsite',
  gameType: 'poll',
  roundNoun: null,
  players: [
    { playerName: 'Amara', totalScore: 40 },
    { playerName: 'Devi', totalScore: 25 },
  ],
  questions: [{
    questionNumber: 1,
    questionData: { title: 'What do we protect?', detail: 'Background for the room.', category: 'Strategy' },
    aiSummary: {
      summaryText: 'The room split cleanly.',
      discussionQuestions: ['Which constraint is real?'],
      nextSteps: ['Name an owner.'],
    },
    answers: [{
      rank: 1, rankDisplay: '1st', answerText: 'Protect the handover ritual.',
      playerName: 'Amara', totalScore: 40, voteBreakdown: '3 first, 1 second',
    }],
  }],
};

const triviaData = {
  ...reportData,
  gameType: 'trivia',
  questions: [{
    questionNumber: 1,
    questionData: {
      title: 'Which shipped first?', category: 'Tech',
      optionA: 'The browser', optionB: 'The mobile call', optionC: 'The spreadsheet',
      correctAnswer: 'OptionB',
    },
    aiSummary: null,
    answers: [],
  }],
};

describe('the document renders everything the inline version did', () => {
  // rejects: the extraction quietly dropping a field. The report was moved out
  // of a 5,000-line file by hand; every one of these was on the old page and a
  // dropped line would look like nothing at all until a client asked where
  // their scores went.
  test('title block, rounds, responses and standings are all on the page', () => {
    render(<ReportDocument reportData={reportData} />);
    expect(screen.getByText('Northwind Q3 Offsite')).toBeInTheDocument();
    expect(screen.getByText('ENG-77')).toBeInTheDocument();
    expect(screen.getByText('What do we protect?')).toBeInTheDocument();
    expect(screen.getByText('Background for the room.')).toBeInTheDocument();
    expect(screen.getByText('Protect the handover ritual.')).toBeInTheDocument();
    expect(screen.getByText('3 first, 1 second')).toBeInTheDocument();
    expect(screen.getByText('40 points')).toBeInTheDocument();
    expect(screen.getByText('The room split cleanly.')).toBeInTheDocument();
    expect(screen.getByText('Which constraint is real?')).toBeInTheDocument();
    expect(screen.getByText('Name an owner.')).toBeInTheDocument();
    expect(screen.getByText('Final Scores')).toBeInTheDocument();
    expect(screen.getByText('Devi')).toBeInTheDocument();
  });

  // rejects: reading the round noun off question 1 only, and rejects losing
  // the pluralisation. Both halves need a set whose FIRST question carries no
  // image and whose second does — that is exactly the case that headed a
  // report "3 Rounds" while every row beneath it said "Artwork".
  test('the header counts the whole set with the set\'s own round noun', () => {
    const mixed = {
      ...reportData,
      gameType: 'call-and-answer',
      questions: [
        { ...reportData.questions[0], questionNumber: 1 },
        {
          ...reportData.questions[0],
          questionNumber: 2,
          questionData: { ...reportData.questions[0].questionData, image: 'starry-night.jpg' },
        },
      ],
    };
    const { container } = render(<ReportDocument reportData={mixed} />);
    const meta = [...container.querySelectorAll('.report-meta-item')].map((n) => n.textContent);
    // Two rounds, and the noun is the ARTWORK one the second question forces.
    expect(meta[2]).toBe('Artworks2');

    // And the singular still works — pluralRoundNoun, not a bare `${noun}s`.
    const one = render(<ReportDocument reportData={reportData} />).container;
    expect([...one.querySelectorAll('.report-meta-item')][2].textContent).toBe('Poll1');
  });

  // rejects: losing the correct-answer marker, or matching it by option TEXT
  // only (both `correctAnswer: 'OptionB'` and the literal text are in use).
  test('trivia marks exactly one choice correct', () => {
    const { container } = render(<ReportDocument reportData={triviaData} />);
    const correct = container.querySelectorAll('.trivia-option-report.correct-answer');
    expect(correct).toHaveLength(1);
    expect(correct[0].textContent).toContain('The mobile call');
    expect(container.querySelectorAll('.trivia-option-report')).toHaveLength(3);
  });

  // rejects: dropping `.report-keep` from the units the print sheet and the
  // html2pdf `pagebreak.avoid` list both key off. Without the class the
  // saved PDF slices quotations in half and nothing else fails.
  test('the indivisible units carry .report-keep', () => {
    const { container } = render(<ReportDocument reportData={triviaData} />);
    expect(container.querySelector('.report-answer, .report-keep')).not.toBeNull();
    for (const sel of ['.trivia-option-report', '.score-item', '.report-titleblock']) {
      const nodes = [...container.querySelectorAll(sel)];
      expect(nodes.length).toBeGreaterThan(0);
      for (const n of nodes) expect(n.classList.contains('report-keep')).toBe(true);
    }
  });
});

describe('the shell owns the wait, so the button is never dead', () => {
  // rejects: rendering nothing (or the document) while the report is still
  // being built. `POST games/{id}/report` rebuilds it on every open; the old
  // gate `showReport && reportData` fell through to the stage behind, which is
  // exactly the "the button does nothing" the owner reported.
  test('loading shows the wait and no document', () => {
    const { container } = render(<GameReport reportData={null} status="loading" onClose={() => {}} />);
    expect(screen.getByRole('status')).toHaveTextContent(/Building the session report/i);
    expect(container.querySelector('.report-doc')).toBeNull();
  });

  // rejects: an alert() on failure — which dismisses to a blank screen and
  // offers no way back — or a retry button wired to nothing.
  test('a failure is stated in place, with a way out of it', () => {
    const onRetry = jest.fn();
    const onBrowseAll = jest.fn();
    render(
      <GameReport
        reportData={null}
        status="error"
        error="create-report returned 502."
        onClose={() => {}}
        onRetry={onRetry}
        onBrowseAll={onBrowseAll}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('create-report returned 502.');
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getAllByRole('button', { name: /all session reports/i })[0]);
    expect(onBrowseAll).toHaveBeenCalledTimes(1);
  });

  // rejects: deleting the route back to the games-history list. The list is no
  // longer the front door, and the way to make sure that did not become
  // "deleted" is to require the report itself to offer it.
  test('the history list is still reachable from the report', () => {
    const onBrowseAll = jest.fn();
    render(<GameReport reportData={reportData} status="ready" onClose={() => {}} onBrowseAll={onBrowseAll} />);
    fireEvent.click(screen.getByRole('button', { name: /all session reports/i }));
    expect(onBrowseAll).toHaveBeenCalledTimes(1);
  });

  // rejects: dropping the document.title effect. It is not cosmetic — it is
  // the ONLY repeating identification a printed report gets. A browser will
  // not give you a running head (`@page` margin boxes are implemented by
  // nobody, and a position:fixed element is laid out modulo the page's content
  // height, so it cannot be put in the margin); the print dialog's own header
  // prints document.title on every sheet, and this is what fills it.
  test('the session names itself in the browser print header while open', () => {
    const before = document.title;
    const { unmount } = render(<GameReport reportData={reportData} status="ready" onClose={() => {}} />);
    expect(document.title).toBe('Northwind Q3 Offsite — Session report');
    unmount();
    expect(document.title).toBe(before);
  });

  // rejects: leaving the toolbar on the page. Buttons, hover affordances and
  // the close control are the "screenshot of an app" tell the owner named.
  test('every interactive control is inside the print-suppressed toolbar', () => {
    const { container } = render(
      <GameReport reportData={reportData} status="ready" onClose={() => {}} onBrowseAll={() => {}} />,
    );
    const toolbar = container.querySelector('.report-toolbar');
    expect(toolbar).not.toBeNull();
    expect(toolbar.classList.contains('report-noprint')).toBe(true);
    for (const btn of container.querySelectorAll('button')) {
      expect(toolbar.contains(btn)).toBe(true);
    }
  });
});

describe('the call site — the report button opens the report', () => {
  // rejects: the reported bug itself. `Session report` ran fetchGamesList and
  // opened the games-history modal, from which the host clicked Report a
  // second time on the session they were already running.
  test('handleViewReports goes straight to this session', () => {
    expect(host).toMatch(
      /const handleViewReports = async \(\) => \{\s*if \(gameId\) \{\s*generateReportForGame\(gameId, eventTitle\);/,
    );
    expect(host).not.toMatch(/const handleViewReports = async \(\) => \{\s*await fetchGamesList\(\);/);
  });

  // rejects: deleting the list rather than demoting it. It is still the right
  // answer when there is no session loaded, and it is still passed down.
  test('the list survives as handleBrowseReportHistory and is handed to the report', () => {
    expect(host).toMatch(/const handleBrowseReportHistory = async \(\) => \{/);
    expect(host).toMatch(/setReportsModalMode\('reports'\);\s*setShowReportsModal\(true\);/);
    expect(host).toMatch(/onBrowseAll=\{handleBrowseReportHistory\}/);
  });

  // rejects: restoring the `showReport && reportData` gate, which is the line
  // that made the wait look like a broken button.
  test('the render gate does not wait on the payload', () => {
    expect(host).toMatch(/if \(showReport\) \{/);
    expect(host).not.toMatch(/if \(showReport && reportData\)/);
    expect(host).toMatch(/status=\{reportStatus\}/);
  });

  // rejects: firing the request without putting the shell on screen first, and
  // rejects going back to alert() on failure.
  test('the shell is shown before the fetch, and failure is state not alert', () => {
    const fn = host.slice(host.indexOf('const generateReportForGame'));
    const body = fn.slice(0, fn.indexOf('\n  const playUrl'));
    expect(body).toMatch(/setReportStatus\('loading'\);\s*setShowReport\(true\);\s*try \{/);
    expect(body).toMatch(/setReportStatus\('error'\)/);
    expect(body).not.toMatch(/alert\(/);
  });
});

describe('the print stylesheet declares the properties that do the work', () => {
  // rejects: the whole print sheet being dropped, or being written outside a
  // print media block where it would also apply on screen.
  test('there is an @media print block, and it sets a page box', () => {
    expect(printBlock).not.toBe('');
    expect(printBlock).toMatch(/@page\s*\{[^}]*size:\s*Letter/i);
    expect(printBlock).toMatch(/@page\s*\{[^}]*margin:\s*[\d.]+in/i);
  });

  // rejects: deleting orphans/widows — the two properties that actually stop a
  // paragraph splitting badly, and the ones nobody sets. Verified to bite by
  // rendering: over a 33-step sweep of content heights, `orphans/widows: 1`
  // produced 8 page splits leaving one or two stranded lines and
  // `orphans/widows: 3` produced none.
  test('orphans and widows are set, and above 2', () => {
    const orphans = [...printBlock.matchAll(/orphans:\s*(\d+)/g)].map((m) => Number(m[1]));
    const widows = [...printBlock.matchAll(/widows:\s*(\d+)/g)].map((m) => Number(m[1]));
    expect(orphans.length).toBeGreaterThan(0);
    expect(widows.length).toBeGreaterThan(0);
    expect(Math.min(...orphans)).toBeGreaterThanOrEqual(3);
    expect(Math.min(...widows)).toBeGreaterThanOrEqual(3);
  });

  // rejects: losing `break-inside: avoid` on the small units — a quotation cut
  // away from the name of the person who said it, a standings row split down
  // the middle. These are the units that certainly fit on a page; the sections
  // around them are deliberately NOT in this list.
  test('the indivisible units are protected from a page break', () => {
    for (const sel of ['.report-answer', '.score-item', '.trivia-option-report', '.report-titleblock']) {
      const rule = new RegExp(`${sel.replace('.', '\\.')}\\s*\\{[^}]*break-inside:\\s*avoid`);
      expect(printBlock).toMatch(rule);
    }
  });

  // rejects: dropping `break-after: avoid` from headings, which is what lets a
  // section title strand alone at the foot of a page with its content
  // overleaf. Asserted on the heading rule specifically.
  test('no heading can be left at the foot of a page', () => {
    expect(printBlock).toMatch(/h1[^{]*h2[^{]*\{[^}]*break-after:\s*avoid/);
    expect(printBlock).toMatch(/\.report-question-header\s*\{[^}]*break-after:\s*avoid/);
  });

  // rejects: letting the SCREEN layout reach the printer — the owner's "width"
  // complaint in one assertion. The measure, the viewport height and the
  // scroll container all have to be undone or the page prints as a photograph
  // of a browser window.
  test('the screen container is neutralised on paper', () => {
    expect(printBlock).toMatch(/\.report-container\.report-paper\s*\{[^}]*min-height:\s*0/);
    expect(printBlock).toMatch(/\.report-paper \.report-doc\s*\{[^}]*max-width:\s*none/);
    expect(printBlock).toMatch(/\.report-paper \.report-doc\s*\{[^}]*box-shadow:\s*none/);
  });

  // rejects: keeping a fill without print-color-adjust, which Chrome drops —
  // the AI panel would silently become body copy and a machine's words would
  // read as the host's.
  test('the one retained fill is forced through', () => {
    expect(printBlock).toMatch(
      /\.report-ai-summary\s*\{[^}]*background:\s*#[0-9A-Fa-f]{3,6}[^}]*print-color-adjust:\s*exact/,
    );
  });

  // rejects: leaving the app's controls on the paper.
  test('the toolbar and the wait/failure states do not print', () => {
    expect(printBlock).toMatch(/\.report-noprint[\s\S]{0,400}?display:\s*none/);
    expect(printBlock).toMatch(/\.report-paper button[\s\S]{0,200}?display:\s*none/);
  });
});


/**
 * COMMENTS IN THE SESSION REPORT.
 *
 * The owner: *"these will get added to the round report and the over all report
 * as well. clearly called out as comments."*
 *
 * The round report and the session report are one builder, so the backend half
 * is a single change (`tests/comment-report-integration.js`). This is the half
 * that can still go wrong on its own: `GameHostPage` rebuilds `reportData` from
 * scratch, and anything not explicitly forwarded there is invisible to this
 * component no matter what the server sent.
 */
describe('comments in the session report', () => {
  const withComments = {
    gameId: '4821',
    eventTitle: 'Q3 offsite',
    players: [{ playerName: 'Ada', totalScore: 3 }],
    questions: [{
      questionNumber: '001',
      questionData: { title: 'Competitive response', detail: 'They cut price.' },
      answers: [{
        answerIndex: 0, answerText: 'Freeze discounting.', playerName: 'Ada',
        rank: 1, rankDisplay: '1st', totalScore: 3, voteBreakdown: '',
      }],
      comments: [
        {
          commentId: 'c1', anchorKind: 'response', anchorRef: '0',
          anchorLabel: 'Response 1 — Ada',
          anchorExcerpt: 'Freeze discounting.',
          text: 'This is the only one that touches the customer.',
          playerName: 'Lee Chen', submittedAt: '2026-08-27T10:00:00.000Z',
        },
        {
          commentId: 'c2', anchorKind: 'summary', anchorRef: '',
          anchorLabel: 'AI summary', anchorExcerpt: 'The room wants to defend price',
          text: 'Sharper than I expected.',
          playerName: 'Dana', submittedAt: '2026-08-27T10:01:00.000Z',
        },
      ],
    }],
  };

  test('each round’s comments are rendered', () => {
    render(<ReportDocument reportData={withComments} />);
    expect(screen.getByText('This is the only one that touches the customer.')).toBeInTheDocument();
    expect(screen.getByText('Sharper than I expected.')).toBeInTheDocument();
  });

  test('they are headed as comments, so nobody reads one as a response', () => {
    render(<ReportDocument reportData={withComments} />);
    expect(screen.getByText('Comments')).toBeInTheDocument();
  });

  test('each states which section it is about', () => {
    /*
      In the SESSION report a comment is read a long way from the round it
      belongs to — often on paper. "Too internal" against nothing is not a
      comment; against the section it names, it is. The label comes from the
      STORED value, so it survives the response itself expiring out of a
      rebuilt report.
    */
    const { container } = render(<ReportDocument reportData={withComments} />);
    const block = container.querySelector('.report-comments');
    expect(block.textContent).toContain('Response 1 — Ada');
    expect(block.textContent).toContain('AI summary');
  });

  test('each is attributed', () => {
    const { container } = render(<ReportDocument reportData={withComments} />);
    const authors = [...container.querySelectorAll('.comment-author')].map((n) => n.textContent);
    expect(authors).toEqual(['Lee Chen', 'Dana']);
  });

  test('a round with no comments renders no comment block at all', () => {
    // An empty "Comments" heading in a printed report is a heading over a blank
    // space, which reads as a printing fault.
    const bare = { ...withComments, questions: [{ ...withComments.questions[0], comments: [] }] };
    const { container } = render(<ReportDocument reportData={bare} />);
    expect(container.querySelector('.report-comments')).toBeNull();
  });

  test('an older report with no comments field at all still renders', () => {
    // Every report built before this feature. `comments` is simply absent.
    const old = { ...withComments, questions: [{ ...withComments.questions[0], comments: undefined }] };
    expect(() => render(<ReportDocument reportData={old} />)).not.toThrow();
  });

  test('the comment block is kept whole across a page break', () => {
    // The print sheet: a comment split across two pages loses the byline that
    // says whose it is, which is the one thing a reader needs.
    const css = fs.readFileSync(
      path.join(__dirname, '..', 'components', 'GameReport.css'), 'utf8',
    );
    expect(css).toMatch(/\.report-comment\b/);
  });
});

describe('GameHostPage forwards the comment count', () => {
  test('totalComments reaches the rebuilt reportData', () => {
    /*
      `GameHostPage` builds `gameData` from scratch and carries a comment saying
      anything not forwarded there is invisible to the report. `questions:
      report.detailedQuestions` already carries the nested comments; the session
      total is a separate key and has to be named. The object has no `gameStats`
      to pass through, so it goes top level.
    */
    const src = fs.readFileSync(path.join(__dirname, '..', 'GameHostPage.jsx'), 'utf8');
    const stripped = stripComments(src);
    expect(stripped).toMatch(/totalComments:/);
  });
});
