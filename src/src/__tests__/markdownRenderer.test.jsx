/**
 * MarkdownRenderer — what the projector can actually draw, and what it must
 * refuse to execute.
 *
 * Two reasons this file exists.
 *
 * THE SECURITY ONE. formatInlineText() builds an HTML string and hands it to
 * dangerouslySetInnerHTML. Its input is model output. Nothing escaped it, so a
 * <script> or an <img onerror> in an AI summary was injected as live HTML on
 * the host's page. The escaping tests below are the ones that matter.
 *
 * THE FORMATTING ONE. Everything the renderer does not understand falls into
 * the paragraph catch-all and reaches a projector as raw source characters —
 * '#### Heading', '[text](url)', a fence whose CONTENTS were being parsed as
 * markdown so a '#' comment became an H2. The contract in personas.js now
 * tells prompt authors what is drawable; these tests are what makes that
 * contract true.
 *
 * jsdom has no layout engine. The '**Lead**: detail' idiom's projector
 * geometry — a headline over a caption — is therefore asserted at the DOM and
 * class level only. That the classes exist is testable here; that they stack
 * on the big screen is CSS, and is not.
 */
import React from 'react';
import { render } from '@testing-library/react';
import fs from 'fs';
import path from 'path';
import MarkdownRenderer from '../components/MarkdownRenderer';

const src = (...p) => path.join(__dirname, '..', ...p);

/** Source with every comment removed — a previous agent's test passed on one. */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/([^:'"`\\])\/\/.*$/gm, '$1');
}

const draw = (md) => render(<MarkdownRenderer content={md} />).container;

describe('MarkdownRenderer — model output is not trusted HTML', () => {
  // Rejects: removing the HTML escaping from formatInlineText.
  test('a <script> in model output is text, not a script element', () => {
    const c = draw('Here it is: <script>window.__pwned = 1</script> done');
    expect(c.querySelector('script')).toBeNull();
    expect(c.textContent).toContain('<script>window.__pwned = 1</script>');
  });

  // Rejects: removing the HTML escaping (the payload that fires without a
  // script tag, so it survives a fix that only strips <script>).
  test('an <img onerror> is text, not an element with a handler', () => {
    const c = draw('Look: <img src=x onerror="window.__pwned = 1"> ok');
    expect(c.querySelector('img')).toBeNull();
    expect(c.querySelector('[onerror]')).toBeNull();
    expect(c.textContent).toContain('<img src=x onerror=');
  });

  // Rejects: escaping applied AFTER the markup is inserted (which would turn
  // the renderer's own <strong> into visible tags), or escaping the markup.
  test('escaping does not cost us **bold**, *italic* or `code`', () => {
    const c = draw('**bold** and *italic* and `code`');
    expect(c.querySelector('strong')).not.toBeNull();
    expect(c.querySelector('strong').textContent).toBe('bold');
    expect(c.querySelector('em').textContent).toBe('italic');
    expect(c.querySelector('code').textContent).toBe('code');
  });

  // Rejects: escaping '<' and '>' but not '&', or escaping '&' last — both
  // produce double-escaped '&amp;lt;' rubbish on screen.
  test('an ampersand survives as an ampersand, not as an entity', () => {
    const c = draw('Marks & Spencer, 5 < 6');
    expect(c.textContent).toContain('Marks & Spencer');
    expect(c.textContent).toContain('5 < 6');
    expect(c.textContent).not.toContain('&amp;');
  });

  // Rejects: running the emphasis passes over code spans instead of lifting
  // them out first, which turns the asterisks a snippet is quoting into bold.
  test('markdown inside a code span stays literal', () => {
    const c = draw('use `**stars**` for bold');
    expect(c.querySelector('code').textContent).toBe('**stars**');
    expect(c.querySelector('strong')).toBeNull();
  });

  // Rejects: dropping the NUL strip from escapeHtml. The code-span placeholder
  // is NUL-delimited and is only unforgeable while the input cannot contain one.
  test('a NUL in model output cannot forge a code-span placeholder', () => {
    const c = draw(`plain ${String.fromCharCode(0)}c0${String.fromCharCode(0)} text`);
    expect(c.querySelector('code')).toBeNull();
    expect(c.textContent).toContain('plain c0 text');
  });

  // Rejects: a model writing <b>…</b> having it honoured as HTML — the whole
  // point of escaping is that markdown is the only markup language here.
  test('the model cannot smuggle formatting in as raw HTML', () => {
    const c = draw('<b>not bold</b>');
    expect(c.querySelector('b')).toBeNull();
    expect(c.textContent).toContain('<b>not bold</b>');
  });

  // Rejects: adding link support without validating the scheme.
  test('a javascript: link is not turned into an anchor', () => {
    const c = draw('[click me](javascript:window.__pwned = 1)');
    expect(c.querySelector('a')).toBeNull();
    expect(c.textContent).toContain('click me');
  });

  // Rejects: scheme validation by naive prefix match (case, or leading control
  // characters, both defeat `startsWith('javascript:')`).
  test('scheme validation is not fooled by case or control characters', () => {
    for (const url of ['JaVaScRiPt:alert(1)', 'java\tscript:alert(1)', ' javascript:alert(1)']) {
      const c = draw(`[x](${url})`);
      expect(c.querySelector('a')).toBeNull();
    }
  });
});

describe('MarkdownRenderer — headings', () => {
  // Rejects: the startsWith('## ') cascade, under which '#### x' matched no
  // branch and fell through to the paragraph catch-all.
  test('#### through ###### are headings, not paragraphs of hashes', () => {
    const c = draw('#### Four\n\n##### Five\n\n###### Six');
    expect(c.querySelector('h5')).not.toBeNull();
    expect(c.querySelector('h5').textContent).toBe('Four');
    expect(c.textContent).not.toContain('####');
    expect(c.querySelectorAll('p').length).toBe(0);
  });

  // Rejects: level arithmetic with no cap, which yields an <h7> for '######'.
  test('###### stops at h6 rather than inventing an h7', () => {
    const c = draw('###### Six');
    expect(c.querySelector('h7')).toBeNull();
    expect(c.querySelector('h6').textContent).toBe('Six');
  });

  // Rejects: any rewrite that shifts the existing levels. styles.css and
  // stage.css style .markdown-h2/h3/h4 by name; renumbering them silently
  // unstyles every AI summary on the projector.
  test('the existing #/##/### → h2/h3/h4 mapping and classes are unchanged', () => {
    const c = draw('# One\n\n## Two\n\n### Three');
    expect(c.querySelector('h2').className).toBe('markdown-h2');
    expect(c.querySelector('h2').textContent).toBe('One');
    expect(c.querySelector('h3').className).toBe('markdown-h3');
    expect(c.querySelector('h4').className).toBe('markdown-h4');
  });

  // Rejects: a heading regex with the space made optional, which would eat a
  // '#hashtag' at the start of a line.
  test('a hash with no space after it is not a heading', () => {
    const c = draw('#NotAHeading');
    expect(c.querySelector('h2')).toBeNull();
    expect(c.querySelector('p').textContent).toBe('#NotAHeading');
  });
});

describe('MarkdownRenderer — links', () => {
  // Rejects: no link support at all (the plan's list of silently dropped
  // syntax), which printed '[Docs](https://…)' verbatim on a projector.
  test('an http link becomes a safe anchor', () => {
    const c = draw('See [the docs](https://example.com/a?b=1&c=2) for more.');
    const a = c.querySelector('a');
    expect(a).not.toBeNull();
    expect(a.textContent).toBe('the docs');
    expect(a.getAttribute('href')).toBe('https://example.com/a?b=1&c=2');
    expect(a.getAttribute('rel')).toContain('noopener');
  });

  // Rejects: a link regex with no '!' guard, which would swallow the image
  // syntax and render a broken half-anchor with a stray '!' in front of it.
  test('an image is left alone rather than half-parsed as a link', () => {
    const c = draw('![a chart](https://example.com/c.png)');
    expect(c.querySelector('a')).toBeNull();
    expect(c.querySelector('img')).toBeNull();
    expect(c.textContent).toContain('![a chart](https://example.com/c.png)');
  });
});

describe('MarkdownRenderer — blockquotes and rules', () => {
  // Rejects: no blockquote support — '> quoted' printed its own '>' on screen.
  test('> lines become one blockquote without their markers', () => {
    const c = draw('> first line\n> second line');
    const q = c.querySelector('blockquote');
    expect(q).not.toBeNull();
    expect(q.textContent).toContain('first line');
    expect(q.textContent).toContain('second line');
    expect(c.textContent).not.toContain('>');
  });

  // Rejects: no horizontal-rule support — '---' printed as three dashes.
  test('--- on its own line is a rule', () => {
    const c = draw('above\n\n---\n\nbelow');
    expect(c.querySelector('hr')).not.toBeNull();
    expect(c.textContent).not.toContain('---');
  });

  // Rejects: a loosened rule detector hoisted above the table branch — the
  // plausible shape of "also handle - - - and ___". Verified by mutation: the
  // strict /^(-{3,}|\*{3,}|_{3,})$/ below the table branch cannot reach a
  // separator row, but /^[-*_\s|]{3,}$/ above it eats every table's header.
  test('a table separator row is not mistaken for a rule', () => {
    const c = draw('| A | B |\n| --- | --- |\n| 1 | 2 |');
    expect(c.querySelector('hr')).toBeNull();
    expect(c.querySelectorAll('th').length).toBe(2);
  });
});

describe('MarkdownRenderer — fenced code', () => {
  // Rejects: no fence handling. This is the exact reported defect: the fence
  // line became a <p> and its CONTENTS were parsed as markdown, so a '#'
  // comment became an H2 and a '| x |' line became a table.
  test('a fence is code, and its contents are not parsed as markdown', () => {
    const c = draw('```\n# not a heading\n| not | a table |\n**not bold**\n```');
    const pre = c.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(c.querySelector('h2')).toBeNull();
    expect(c.querySelector('table')).toBeNull();
    expect(c.querySelector('strong')).toBeNull();
    expect(pre.textContent).toContain('# not a heading');
    expect(pre.textContent).toContain('**not bold**');
    expect(c.textContent).not.toContain('```');
  });

  // Rejects: rendering fence contents through dangerouslySetInnerHTML.
  test('a fence containing HTML is still inert', () => {
    const c = draw('```html\n<script>window.__pwned = 1</script>\n```');
    expect(c.querySelector('script')).toBeNull();
    expect(c.querySelector('pre').textContent).toContain('<script>');
  });

  // Rejects: dropping the unterminated-fence flush, which would silently
  // swallow the tail of any summary the model truncated mid-block.
  test('an unclosed fence still renders what it captured', () => {
    const c = draw('```\nstill here\n');
    expect(c.querySelector('pre').textContent).toContain('still here');
  });
});

describe('MarkdownRenderer — tables', () => {
  // Rejects: over-tightening the detection to the point that real tables die.
  test('a pipe table with a separator gets headers and cells', () => {
    const c = draw('| Answer | Votes |\n| --- | --- |\n| Blue | 4 |\n| Red | 2 |');
    const th = [...c.querySelectorAll('th')].map((n) => n.textContent);
    expect(th).toEqual(['Answer', 'Votes']);
    expect(c.querySelectorAll('tbody tr').length).toBe(2);
  });

  // Rejects: the includes('|') test, under which any prose sentence carrying a
  // pipe became a one-row table on the projector.
  test('a sentence containing a pipe is prose, not a table', () => {
    const line = 'We shipped it | then we tested it, which is the wrong order.';
    const c = draw(line);
    expect(c.querySelector('table')).toBeNull();
    expect(c.querySelector('p').textContent).toBe(line);
  });
});

describe('MarkdownRenderer — lists and the Lead idiom', () => {
  // Rejects: a rewrite that loses the ordered/unordered distinction.
  test('ordered and unordered lists keep their tag', () => {
    expect(draw('1. one\n2. two').querySelector('ol')).not.toBeNull();
    expect(draw('- one\n- two').querySelector('ul')).not.toBeNull();
  });

  // Rejects: removing formatListItem. jsdom has no layout engine, so this is
  // asserted at the class level: that .md-lead and .md-rest exist and carry
  // the right halves. Whether they stack as headline-over-caption is CSS
  // (styles.css `.big-screen-mode … .md-lead`) and is NOT verified here.
  test('`**Lead**: detail` splits into .md-lead and .md-rest', () => {
    const c = draw('- **The room split**: nobody had a majority.');
    expect(c.querySelector('.md-lead').textContent).toBe('The room split');
    expect(c.querySelector('.md-rest').textContent).toBe('nobody had a majority.');
  });

  // Rejects: making the split unconditional, which would leave an empty
  // caption under every fully-bold bullet.
  test('a bullet that is all lead and no detail is not split', () => {
    const c = draw('- **Just a bold bullet**');
    expect(c.querySelector('.md-lead')).toBeNull();
    expect(c.querySelector('li strong').textContent).toBe('Just a bold bullet');
  });
});

describe('the fallback render paths on the host page', () => {
  const host = stripComments(fs.readFileSync(src('GameHostPage.jsx'), 'utf8'));

  /*
   * Asserted on source rather than rendered. Reaching these two branches in
   * jsdom means driving GameHostPage into FIELD_NOTES and into the report with
   * an AI summary that has no markdownResponse; the render-level assertion is
   * the whole of MarkdownRenderer above, and this pins only the wiring.
   */

  // Rejects: reverting either fallback to a bare <p>, which is how '**bold**'
  // came to show as literal asterisks on a projector.
  test('both fallbacks route their text through MarkdownRenderer', () => {
    expect(host).toMatch(/content=\{currentAIInsights\.summary\}/);
    expect(host).toMatch(/content=\{aiSummary\.summaryText\}/);
    expect(host).not.toMatch(/<p[^>]*>\{currentAIInsights\.summary\}/);
    expect(host).not.toMatch(/<p[^>]*>\{aiSummary\.summaryText\}/);
  });
});
