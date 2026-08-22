/**
 * PAGING PROSE — the half of the pager that Field Notes needed and did not have.
 *
 * Nothing here measures anything, for the same reason nothing in
 * stagePaging.test.js does: jsdom has no layout engine, so a test asking whether
 * a page "fits" reads zero and passes with the feature deleted (RESUME.md,
 * Landmines). What is asserted is the mechanism — where a cut may fall, where it
 * may not, what a page is named, and what happens to an index when the summary
 * is rewritten underneath it.
 *
 * The costs below are counted in 34-character lines (`PROSE_MEASURE`, which is
 * `.notes li span{max-width:34ch}` from styles/stage.css). Test fixtures state
 * their budget explicitly rather than leaning on a profile, so a change to the
 * profile numbers cannot silently rewrite what these tests mean.
 */
import {
  PROSE_MEASURE, PROSE_BUDGET, DEFAULT_PROSE_BUDGET, PAGE_SIZE,
  proseBudgetFor, proseCost, proseBlocks, prosePages, prosePageSlice, pagerLabel,
} from '../config/stagePaging';

/** n lines' worth of plain text, at the module's own measure. */
const lines = (n, word = 'x') => `${word} `.repeat(Math.ceil((n * PROSE_MEASURE) / 2)).trim();

describe('the per-profile prose budget', () => {
  test('it is declared per profile and keeps the answer budget\'s ratios', () => {
    // rejects: one budget for all four profiles. TV's ladder is ~1.3x Room's on
    // every rung and the design spec says of TV in so many words that "less
    // content fits"; a single number is the version that goes on cutting off
    // the profile the owner reported.
    //
    // Also rejects re-deriving the ratios by taste: these are the SAME ladders
    // the answer budget divides, so 18:12:18:30 must stay 3:2:3:5.
    expect(PROSE_BUDGET.room).toBe(18);
    expect(PROSE_BUDGET.call).toBe(PROSE_BUDGET.room);
    expect(PROSE_BUDGET.tv).toBeLessThan(PROSE_BUDGET.room);
    expect(PROSE_BUDGET.table).toBeGreaterThan(PROSE_BUDGET.room);
    ['room', 'tv', 'call', 'table'].forEach((p) => {
      expect(PROSE_BUDGET[p] / PAGE_SIZE[p]).toBe(PROSE_BUDGET.room / PAGE_SIZE.room);
    });
  });

  test('an unknown profile falls back to Room, not to something permissive', () => {
    // rejects: a fallback of Infinity "so nothing is hidden", which is exactly
    // the defect — content off the bottom of a projector with nothing saying so.
    expect(proseBudgetFor('hologram')).toBe(DEFAULT_PROSE_BUDGET);
    expect(proseBudgetFor(undefined)).toBe(DEFAULT_PROSE_BUDGET);
    expect(DEFAULT_PROSE_BUDGET).toBe(PROSE_BUDGET.room);
  });
});

describe('what a block costs', () => {
  test('decoration is not billed to the page', () => {
    // personas.js asks the model for `**Lead phrase**: the rest of the point`,
    // and a link's href is the whole URL for a label of two words. Counting raw
    // source bills a page for characters the room never sees, which shows up as
    // pages a third empty.
    //
    // rejects: `Math.ceil(text.length / 34)` on the raw string.
    const plain = 'Thirty-one of forty answers were internal controls.';
    expect(proseCost(`**${plain}**`)).toBe(proseCost(plain));
    expect(proseCost('- [the docs](https://example.com/a/very/long/path/indeed)'))
      .toBe(proseCost('the docs'));
  });

  test('an empty block still occupies a line', () => {
    // rejects: returning 0, which lets an unbounded number of blocks onto one
    // page and makes prosePages loop-equivalent to no paging at all.
    expect(proseCost('')).toBe(1);
    expect(proseCost('   ')).toBe(1);
  });
});

describe('where a cut may fall', () => {
  test('a list item is its own block, so a long list is not a page-sized cliff', () => {
    // Discussion Questions and Next Steps are ALWAYS lists — personas.js asks
    // for "two or three numbered questions" and "two to four numbered, concrete
    // actions" — so a list held atomic is precisely the overflow this exists to
    // remove.
    //
    // rejects: treating a list as one block, which puts a ten-item list on one
    // over-budget page and leaves the tail cut off exactly as before.
    const blocks = proseBlocks('1. one\n2. two\n3. three');
    expect(blocks).toHaveLength(3);
    expect(blocks.map((b) => b.text)).toEqual(['1. one', '2. two', '3. three']);
  });

  test('a table is one block, and it is budgeted by its ROWS', () => {
    // THE BOUNDARY THAT WOULD REACH A PROJECTOR AS RAW CHARACTERS. Cut between
    // a table's header and its `| --- | --- |` and page two prints the pipes,
    // because MarkdownRenderer only recognises a separator directly under a row.
    //
    // The row count is the half that is falsifiable, and it is the half that
    // decides anything: a table occupies one screen line PER ROW however short
    // its cells are, so costing it by character count — three words across two
    // columns and four rows reading as "one line" — is how a page ends up
    // budgeted for a quarter of what it draws.
    //
    // rejects: dropping the table branch and letting rows fall through to the
    // paragraph catch-all, which is atomic by accident and mis-costed on purpose.
    const blocks = proseBlocks('| A | B |\n| --- | --- |\n| 1 | 2 |');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toContain('| --- | --- |');
    expect(blocks[0].lines).toBe(3);
  });

  test('a fenced code block is atomic, including the blank lines inside it', () => {
    // rejects: flushing on a blank line without checking whether a fence is
    // open — which cuts a snippet in half and leaves an unterminated fence on
    // each page, so both render as prose with backticks showing.
    const blocks = proseBlocks('```\nconst a = 1;\n\nconst b = 2;\n```');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text.split('\n')).toHaveLength(5);
  });

  test('a quote run is one block, and the prose under it is another', () => {
    // MarkdownRenderer groups consecutive `>` lines into ONE <blockquote> and
    // ends it at the first line that is not quoted. Both halves of that matter
    // here: a cut inside the run yields two quote boxes where the author wrote
    // one, and welding the following paragraph onto the quote makes an
    // unsplittable block out of two elements that page apart perfectly well.
    //
    // rejects: dropping the quote branch, which lets both lines and the
    // paragraph after them fall into a single paragraph run.
    expect(proseBlocks('> first line\n> second line\nplain prose after it')
      .map((b) => b.text))
      .toEqual(['> first line\n> second line', 'plain prose after it']);
  });

  test('a heading is its own block and knows its level and its name', () => {
    // The name is what the pager prints; the level is what decides whether it
    // forces a page. rejects: recording a heading as an ordinary paragraph,
    // which loses both.
    const [h2, h3] = proseBlocks('## Next Steps\n\n### Later');
    expect(h2).toMatchObject({ heading: true, level: 2, title: 'Next Steps' });
    expect(h3).toMatchObject({ heading: true, level: 3, title: 'Later' });
  });
});

describe('how the pages come out', () => {
  const contract = [
    '## Summary', lines(4),
    '## Discussion Questions', '1. ' + lines(3), '2. ' + lines(3),
    '## Next Steps', '1. ' + lines(3), '2. ' + lines(3),
  ].join('\n\n');

  test('the model\'s own sections are the pages', () => {
    // THE DESIGN DECISION THIS FILE EXISTS TO PIN. personas.js's
    // buildOutputContract() tells the model, non-negotiably, to "reply using
    // exactly these N headings, in this order" — so `##` is a boundary the
    // AUTHOR drew and cutting there cuts nothing in half. Three sections, three
    // pages, each flipped like a card.
    //
    // rejects: filling pages purely by budget, which would run the tail of
    // Summary onto the same page as the head of Discussion Questions whenever
    // the arithmetic happened to allow it.
    const pages = prosePages(contract, 18);
    expect(pages).toHaveLength(3);
    expect(pages.map((p) => p.section))
      .toEqual(['Summary', 'Discussion Questions', 'Next Steps']);
    expect(pages[1].text).toContain('## Discussion Questions');
    expect(pages[1].text).not.toContain('## Next Steps');
  });

  test('a sub-heading does NOT force a page', () => {
    // rejects: breaking on every heading. `###` is structure INSIDE a section;
    // breaking on it shreds a section the model deliberately subdivided into
    // one page per sub-heading, several of them nearly empty.
    const pages = prosePages('## One\n\n### a\n\nshort\n\n### b\n\nshort', 18);
    expect(pages).toHaveLength(1);
  });

  test('a section longer than the budget continues, keeping its name', () => {
    // THE FALLBACK, AND IT IS NOT OPTIONAL. get-ai-summary.js:201 stores
    // `markdownResponse: raw` when the reply does not parse, and a prompt may
    // declare its own shape — sections alone would then put everything on one
    // page, which is the defect the owner reported. The name carries forward so
    // a room looking at a continuation still knows what it is reading.
    //
    // rejects: paging by section only.
    const long = ['## Next Steps', ...Array.from({ length: 8 }, (u, i) => `${i + 1}. ${lines(3)}`)]
      .join('\n\n');
    const pages = prosePages(long, 12);
    expect(pages.length).toBeGreaterThan(1);
    pages.forEach((p) => expect(p.section).toBe('Next Steps'));
  });

  test('a numbered list keeps its ordinals across a page break', () => {
    // The positional-label trap, in its Field Notes form: a host says "question
    // four" while the projector says "1". The ordinal travels in the source and
    // MarkdownRenderer now honours it on <ol start>.
    //
    // rejects: renumbering, or re-emitting items without their markers.
    const long = ['## Next Steps', ...Array.from({ length: 8 }, (u, i) => `${i + 1}. ${lines(3)}`)]
      .join('\n\n');
    const pages = prosePages(long, 12);
    expect(pages[1].text.trim()).toMatch(/^\d+\. /);
    expect(pages[1].text.trim().startsWith('1. ')).toBe(false);
  });

  test('a heading is never the last thing on a page', () => {
    // rejects: a plain greedy fill. A page ending on a heading names a section
    // whose body is on the next page: the room reads a title, the host turns,
    // and the title is gone.
    // The heading FITS where it falls — eight lines of paragraph plus its own
    // one is nine of the ten — and it is the body underneath that does not.
    // A fixture where the heading itself overflows would break the page in the
    // right place for the wrong reason and prove nothing.
    const doc = [lines(8), '### Sub', lines(4)].join('\n\n');
    const pages = prosePages(doc, 10);
    expect(pages).toHaveLength(2);
    expect(pages[0].text).not.toContain('### Sub');
    expect(pages[1].text.startsWith('### Sub')).toBe(true);
  });

  test('a block bigger than a whole page is placed, not dropped', () => {
    // rejects: a fill loop that only ever places a block that fits, which
    // silently deletes the one paragraph the model wrote at length — the worst
    // possible failure on a stage whose whole rule is that a reduction with no
    // recovery is a deletion. Paging removes the pressure; it does not repeal
    // the fitter, which is still behind this doing what it does.
    const pages = prosePages(['short one', lines(40)].join('\n\n'), 6);
    expect(pages).toHaveLength(2);
    expect(pages[1].text).toBe(lines(40));
  });

  test('an empty summary is no pages at all', () => {
    // rejects: fabricating one blank page and a pager over it.
    expect(prosePages('', 18)).toEqual([]);
    expect(prosePages(null, 18)).toEqual([]);
  });
});

describe('the slice the component actually renders', () => {
  const doc = ['## A', lines(4), '## B', lines(4), '## C', lines(4)].join('\n\n');

  test('it hands back one page\'s markdown and where that page sits', () => {
    const slice = prosePageSlice(doc, 1, 18);
    expect(slice.pages).toBe(3);
    expect(slice.page).toBe(1);
    expect(slice.section).toBe('B');
    expect(slice.content).toContain('## B');
    expect(slice.content).not.toContain('## A');
  });

  test('a rewrite underneath a paged host clamps rather than blanks the stage', () => {
    // Redo rewrites the summary on screen while the host may already be on page
    // 3 of 4. rejects: leaving the raw index alone — an out-of-range index
    // renders an empty projector, indistinguishable from a crash at 25 feet.
    const slice = prosePageSlice('## A\n\nshort', 6, 18);
    expect(slice.page).toBe(0);
    expect(slice.content).toContain('short');
  });

  test('an empty summary is one empty page, never a negative index', () => {
    // rejects: pages: 0, which makes clampPage return -1.
    const slice = prosePageSlice('', 3, 18);
    expect(slice.pages).toBe(1);
    expect(slice.page).toBe(0);
    expect(slice.content).toBe('');
  });
});

describe('a rule never gets a page of its own', () => {
  // THE BLANK PAGE, reported live: "sometimes there is a blank page between
  // section of the workie response." The mechanism: a section body fills its
  // page to the budget, the decorative `---` after it overflows onto a page
  // of its own, and the next heading opens the page after that — so the room
  // turns to a page containing one thin line.
  test('an overflowing rule is dropped, not promoted to a page', () => {
    const md = ['## Jeff', lines(30), '---', '## Andy', lines(2)].join('\n\n');
    const pages = prosePages(md, 12);
    for (const page of pages) {
      expect(page.text.trim()).not.toBe('---');
    }
    // The sections on either side of the dropped rule are both intact.
    const all = pages.map((p) => p.text).join('\n');
    expect(all).toContain('## Jeff');
    expect(all).toContain('## Andy');
  });

  test('a rule that lands mid-page still renders exactly as before', () => {
    // rejects: fixing the blank page by deleting rules everywhere — an author
    // who drew a rule inside a section under budget keeps it.
    const md = ['## Notes', lines(2), '---', lines(2)].join('\n\n');
    const pages = prosePages(md, 18);
    expect(pages).toHaveLength(1);
    expect(pages[0].text).toContain('---');
  });

  test('two headings sandwiching a rule do not close a heading-only page', () => {
    // hasBody must not count a rule as body, or `## A / --- / ## B` would
    // close a page holding a title and a line — the orphan-title defect in a
    // new costume.
    const md = ['## A', '---', '## B', lines(2)].join('\n\n');
    const pages = prosePages(md, 18);
    expect(pages.every((p) => !/^## A[\s\S]*---\s*$/.test(p.text.trim()) || p.text.includes('## B'))).toBe(true);
    expect(pages[pages.length - 1].text).toContain(lines(2).slice(0, 10));
  });
});

describe('the pager line, when the items cannot be counted', () => {
  test('a caption replaces the range and keeps the position and the key hint', () => {
    // rejects: printing "lines 18–34 of 61" at a room, which is a number nobody
    // can act on and which changes every time the model rewrites. rejects, too,
    // dropping the "↑ ↓ to page" clause with the range — a position indicator
    // that does not say how to change position is a status light.
    const line = pagerLabel({ caption: 'Next Steps', page: 2, pages: 4 });
    expect(line).toBe('Next Steps · page 3 of 4 · ↑ ↓ to page');
  });

  test('with no caption the counted form is unchanged', () => {
    // rejects: a caption parameter that quietly changes the answer list's line
    // too. VOTE and RESULTS still print "Responses 4–6 of 20".
    expect(pagerLabel({ from: 4, to: 6, total: 20, page: 1, pages: 7 }))
      .toBe('Responses 4–6 of 20 · page 2 of 7 · ↑ ↓ to page');
  });
});
