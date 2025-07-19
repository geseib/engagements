import React from 'react';

// Simple Markdown renderer for AI summaries
// Supports basic formatting: headers, paragraphs, lists
function MarkdownRenderer({ content, className = '' }) {
  if (!content) return null;

  // Split content into lines for processing
  const lines = content.split('\n');
  const elements = [];
  let listItems = [];
  let inList = false;
  let listType = 'ul';

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

  lines.forEach((line, index) => {
    const trimmedLine = line.trim();

    // Skip empty lines
    if (!trimmedLine && !inList) {
      flushList();
      return;
    }

    // Headers
    if (trimmedLine.startsWith('## ')) {
      flushList();
      elements.push(
        <h3 key={index} className="markdown-h3">
          {trimmedLine.substring(3)}
        </h3>
      );
    } else if (trimmedLine.startsWith('### ')) {
      flushList();
      elements.push(
        <h4 key={index} className="markdown-h4">
          {trimmedLine.substring(4)}
        </h4>
      );
    } else if (trimmedLine.startsWith('# ')) {
      flushList();
      elements.push(
        <h2 key={index} className="markdown-h2">
          {trimmedLine.substring(2)}
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
          {content}
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
          {content}
        </li>
      );
    }
    // Regular paragraphs
    else if (trimmedLine) {
      flushList();
      elements.push(
        <p key={index} className="markdown-p">
          {trimmedLine}
        </p>
      );
    }
  });

  // Flush any remaining list items
  flushList();

  return (
    <div className={`markdown-content ${className}`}>
      {elements}
    </div>
  );
}

export default MarkdownRenderer;