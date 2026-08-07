import React, { useMemo } from 'react';

// Enhanced Markdown renderer for AI summaries
// Supports: headers, paragraphs, lists, bold, italics, tables
// Parsing is memoized on `content` and the component is wrapped in React.memo so
// it does not re-parse on every unrelated re-render of the live host page.
function MarkdownRenderer({ content, className = '' }) {
  const elements = useMemo(() => {
  if (!content) return null;

  // Split content into lines for processing
  const lines = content.split('\n');
  const elements = [];
  let listItems = [];
  let inList = false;
  let listType = 'ul';
  let tableRows = [];
  let inTable = false;
  let tableHeaders = [];

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

  // Format inline text with bold and italic support
  const formatInlineText = (text) => {
    if (!text) return '';
    
    // Handle bold (**text** or __text__)
    let formatted = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    formatted = formatted.replace(/__(.*?)__/g, '<strong>$1</strong>');
    
    // Handle italic (*text* or _text_)
    formatted = formatted.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
    formatted = formatted.replace(/(?<!_)_([^_]+)_(?!_)/g, '<em>$1</em>');
    
    // Handle inline code (`code`)
    formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>');
    
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

    // Skip empty lines
    if (!trimmedLine && !inList && !inTable) {
      flushList();
      flushTable();
      return;
    }

    // Table rows (| cell1 | cell2 | cell3 |)
    if (trimmedLine.includes('|') && trimmedLine.length > 2) {
      const cells = trimmedLine.split('|').map(cell => cell.trim()).filter(cell => cell);
      
      // Check if this is a header separator row (| --- | --- |)
      if (cells.every(cell => cell.match(/^-+$/))) {
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

    // Headers
    if (trimmedLine.startsWith('## ')) {
      flushList();
      elements.push(
        <h3 key={index} className="markdown-h3">
          {formatInlineText(trimmedLine.substring(3))}
        </h3>
      );
    } else if (trimmedLine.startsWith('### ')) {
      flushList();
      elements.push(
        <h4 key={index} className="markdown-h4">
          {formatInlineText(trimmedLine.substring(4))}
        </h4>
      );
    } else if (trimmedLine.startsWith('# ')) {
      flushList();
      elements.push(
        <h2 key={index} className="markdown-h2">
          {formatInlineText(trimmedLine.substring(2))}
        </h2>
      );
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
    else if (trimmedLine.match(/^[-*]\s/)) {
      if (!inList || listType !== 'ul') {
        flushList();
        inList = true;
        listType = 'ul';
      }
      const content = trimmedLine.replace(/^[-*]\s/, '');
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

  // Flush any remaining list items or tables
  flushList();
  flushTable();

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