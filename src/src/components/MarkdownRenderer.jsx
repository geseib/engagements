import React, { useMemo } from 'react';

/*
 * Markdown renderer for AI summaries.
 *
 * Two things to know before editing.
 *
 * 1. THE INPUT IS UNTRUSTED. It is model output, and it is drawn on the host's
 *    authenticated page. formatInlineText() still ends in
 *    dangerouslySetInnerHTML — that is how bold and italics survive inside a
 *    sentence — but it now escapes the source text BEFORE inserting any markup
 *    of its own. The ordering is the whole fix: escape first, then build. A
 *    model writing <b>x</b> gets literal angle brackets on screen; a model
 *    writing **x** gets a <strong>. Anything that inserts model text into the
 *    HTML string after the escape step reopens the hole.
 *
 * 2. WHAT IT DRAWS IS A CONTRACT. lambda-functions/game/personas.js tells every
 *    prompt author what this file can render. Adding or removing a construct
 *    here without updating buildOutputContract() there puts the two out of
 *    step, and the failure is silent: unsupported syntax does not error, it
 *    falls into the paragraph catch-all and reaches a projector as raw source
 *    characters.
 *
 * Supported: headings # to ###### (h2-h6), paragraphs, ordered and unordered
 * lists (one level), pipe tables, blockquotes, horizontal rules, fenced code
 * blocks, and inline **bold** / *italic* / `code` / [links](http…).
 *
 * Deliberately NOT supported, and named as unsupported in the contract:
 * images, raw HTML, footnotes, task lists, strikethrough, and nested lists —
 * an indented sub-item is flattened into the list above it.
 *
 * Parsing is memoized on `content` and the component is wrapped in React.memo
 * so it does not re-parse on every unrelated re-render of the live host page.
 */

/**
 * Escape first, build markup second. See note 1 above.
 *
 * The NUL strip is not cosmetic: formatInlineText parks code spans behind a
 * NUL-delimited placeholder while it runs the emphasis passes, and that only
 * holds if the input can never contain one itself.
 */
const escapeHtml = (text) =>
  String(text)
    .replace(/\u0000/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/*
 * Only these schemes become an href. A prefix check is not enough on its own:
 * ' javascript:', 'JaVaScRiPt:' and 'java\tscript:' are all treated as
 * javascript: by browsers, so control characters and whitespace come out
 * before the comparison. Anything else — including a bare 'www.example.com' —
 * is left as plain text rather than guessed at.
 */
const SAFE_URL = /^(?:https?:\/\/|mailto:|\/|#)/i;
const isSafeUrl = (url) => SAFE_URL.test(String(url).replace(/[\u0000-\u0020]/g, ''));

function MarkdownRenderer({ content, className = '' }) {
  const elements = useMemo(() => {
  if (!content) return null;

  const lines = content.split('\n');
  const elements = [];
  let listItems = [];
  let inList = false;
  let listType = 'ul';
  let tableRows = [];
  let inTable = false;
  let tableHeaders = [];
  let quoteLines = [];
  let fenceLines = null; // non-null == inside a fence

  const flushList = () => {
    if (listItems.length > 0) {
      const ListTag = listType;
      elements.push(
        <ListTag key={elements.length} className="markdown-list">
          {listItems}
        </ListTag>
      );
      listItems = [];
      inList = false;
    }
  };

  const flushTable = () => {
    if (tableRows.length > 0) {
      elements.push(
        <table key={elements.length} className="markdown-table">
          {tableHeaders.length > 0 && (
            <thead>
              <tr>
                {tableHeaders.map((header, i) => (
                  <th key={i} className="markdown-th">{formatInlineText(header)}</th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {tableRows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td key={j} className="markdown-td">{formatInlineText(cell)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
      tableRows = [];
      tableHeaders = [];
      inTable = false;
    }
  };

  const flushQuote = () => {
    if (quoteLines.length > 0) {
      const captured = quoteLines;
      quoteLines = [];
      elements.push(
        <blockquote key={elements.length} className="markdown-quote">
          {captured.map((q, i) => (
            <p key={i} className="markdown-p">{formatInlineText(q)}</p>
          ))}
        </blockquote>
      );
    }
  };

  /*
   * Code is the one construct whose contents must NOT be parsed. Before this
   * the fence line became a paragraph and its body went through the normal
   * line loop, so a '#' comment inside a snippet rendered as an H2 and a
   * '| x |' line rendered as a table. The body is emitted as a React text
   * child, which React escapes — dangerouslySetInnerHTML never sees it.
   */
  const flushFence = () => {
    if (fenceLines !== null) {
      const body = fenceLines.join('\n');
      fenceLines = null;
      elements.push(
        <pre key={elements.length} className="markdown-pre">
          <code className="markdown-code-block">{body}</code>
        </pre>
      );
    }
  };

  const flushBlocks = () => { flushList(); flushTable(); flushQuote(); };

  // Inline formatting. Escaped input, then markup inserted on top of it.
  const formatInlineText = (text) => {
    if (!text) return '';

    let formatted = escapeHtml(text);

    /*
     * Code spans are lifted out before the emphasis passes so that `**x**`
     * inside backticks stays literal, then put back at the end. The
     * placeholder uses a character the escape step cannot produce.
     */
    const codeSpans = [];
    formatted = formatted.replace(/`([^`]+)`/g, (_m, code) => {
      codeSpans.push(code);
      return `\u0000c${codeSpans.length - 1}\u0000`;
    });

    // Links: [text](url). The (?<!!) guard leaves ![alt](url) images alone
    // rather than half-parsing them into an anchor with a stray '!' in front.
    formatted = formatted.replace(/(?<!!)\[([^\]]*)\]\(([^)\s]+)\)/g, (whole, label, url) =>
      isSafeUrl(url)
        ? `<a class="markdown-link" href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`
        : whole
    );

    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    formatted = formatted.replace(/__(.*?)__/g, '<strong>$1</strong>');
    formatted = formatted.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
    formatted = formatted.replace(/(?<!_)_([^_]+)_(?!_)/g, '<em>$1</em>');

    formatted = formatted.replace(/\u0000c(\d+)\u0000/g, (_m, i) => `<code>${codeSpans[Number(i)]}</code>`);

    return <span dangerouslySetInnerHTML={{ __html: formatted }} />;
  };

  // List items often arrive as "**Lead phrase**: supporting detail".
  // Split that into a bold lead + a quieter rest so the big-screen
  // (projector) Field Notes can render each point as a headline over a
  // caption. Falls back to normal inline formatting when there's no
  // leading bold lead-in, and the wrapper stays inline in the light
  // views (only big-screen CSS stacks it), so nothing else changes.
  const formatListItem = (text) => {
    const m = text && text.match(/^\*\*(.+?)\*\*\s*[:—–-]?\s*([\s\S]*)$/);
    if (m && m[2].trim()) {
      return (
        <span className="md-point">
          <strong className="md-lead">{m[1]}</strong>
          <span className="md-rest">{formatInlineText(m[2])}</span>
        </span>
      );
    }
    return formatInlineText(text);
  };

  lines.forEach((line, index) => {
    const trimmedLine = line.trim();

    // Fences first: nothing inside one is markdown.
    if (/^(```|~~~)/.test(trimmedLine)) {
      if (fenceLines === null) {
        flushBlocks();
        fenceLines = [];
      } else {
        flushFence();
      }
      return;
    }
    if (fenceLines !== null) {
      fenceLines.push(line);
      return;
    }

    // Skip empty lines
    if (!trimmedLine && !inList && !inTable) {
      flushBlocks();
      return;
    }

    // Blockquotes (> quoted line), grouped while they run consecutively.
    if (/^>\s?/.test(trimmedLine)) {
      flushList();
      flushTable();
      quoteLines.push(trimmedLine.replace(/^>\s?/, ''));
      return;
    }
    flushQuote();

    /*
     * Table rows. The old test was `includes('|')`, which turned any prose
     * sentence carrying a pipe into a one-row table on the projector.
     * A row must now be fenced by pipes at both ends — which is also what the
     * output contract asks prompt authors to write.
     */
    if (trimmedLine.startsWith('|') && trimmedLine.endsWith('|') && trimmedLine.length > 2) {
      const cells = trimmedLine.slice(1, -1).split('|').map((cell) => cell.trim());

      // Check if this is a header separator row (| --- | --- |)
      if (cells.every((cell) => cell.match(/^:?-+:?$/))) {
        // This is a separator, previous row becomes headers
        if (tableRows.length > 0) {
          tableHeaders = tableRows.pop();
        }
        return;
      }

      if (!inTable) {
        flushList();
        inTable = true;
      }

      tableRows.push(cells);
      return;
    }

    // If we were in a table but this line isn't a table, flush it
    if (inTable) {
      flushTable();
    }

    /*
     * Headings. This used to be a startsWith('## ') cascade, so '#### x'
     * matched no branch and fell through to the paragraph catch-all — four
     * hashes printed on a projector. Levels 1-3 keep their existing h2/h3/h4
     * tags and class names because styles.css and stage.css style them by
     * name; 4-6 extend the same ladder and stop at h6.
     */
    const heading = trimmedLine.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushList();
      const level = Math.min(heading[1].length + 1, 6);
      const Tag = `h${level}`;
      elements.push(
        <Tag key={index} className={`markdown-h${level}`}>
          {formatInlineText(heading[2])}
        </Tag>
      );
    }
    // Horizontal rule (---, ***, ___). Sits below the table branch so a
    // header separator row is never eaten as a rule.
    else if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmedLine)) {
      flushList();
      elements.push(<hr key={index} className="markdown-hr" />);
    }
    // Ordered list items
    else if (trimmedLine.match(/^\d+\.\s/)) {
      if (!inList || listType !== 'ol') {
        flushList();
        inList = true;
        listType = 'ol';
      }
      const content = trimmedLine.replace(/^\d+\.\s/, '');
      listItems.push(
        <li key={`${index}-li`} className="markdown-li">
          {formatListItem(content)}
        </li>
      );
    }
    // Unordered list items
    else if (trimmedLine.match(/^[-*+]\s/)) {
      if (!inList || listType !== 'ul') {
        flushList();
        inList = true;
        listType = 'ul';
      }
      const content = trimmedLine.replace(/^[-*+]\s/, '');
      listItems.push(
        <li key={`${index}-li`} className="markdown-li">
          {formatListItem(content)}
        </li>
      );
    }
    // Regular paragraphs
    else if (trimmedLine) {
      flushList();
      elements.push(
        <p key={index} className="markdown-p">
          {formatInlineText(trimmedLine)}
        </p>
      );
    }
  });

  // Flush anything still open. The fence flush matters: a summary truncated
  // mid-block would otherwise lose its tail silently.
  flushFence();
  flushBlocks();

  return elements;
  }, [content]);

  if (!elements) return null;

  return (
    <div className={`markdown-content ${className}`}>
      {elements}
    </div>
  );
}

export default React.memo(MarkdownRenderer);
