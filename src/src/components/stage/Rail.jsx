import React from 'react';

/**
 * The persistent identity strip — the `.rail` grid area. Styled from
 * docs/design/host-redesign/02-ask-call-and-answer.html:149-196 (CSS) and
 * :768 (markup) — see ../../styles/stage.css for the ported rules.
 *
 * The title is a single text node on purpose (`.rail-title` is
 * `display:block` with `overflow:hidden;text-overflow:ellipsis;
 * white-space:nowrap`): text-overflow only applies to a block container
 * with inline content, and on a flex box with span children it is inert —
 * which is how the rail previously shipped clipping mid-glyph with no
 * ellipsis at all.
 *
 * The drop order is fixed and asymmetric: the title (1) goes first, then the
 * word JOIN (2), then the URL (3). The session code is never part of this
 * list — an earlier revision numbered it backwards and sacrificed the code
 * before the title, and the code is what the room actually needs to get in.
 */
export default function Rail({ title, context = {}, join = {}, timer }) {
  const hasJoin = Boolean(join && (join.code || join.url));

  return (
    <header className="rail">
      <span className="rail-title" data-drop="1">{title}</span>
      <span className="rail-ctx">
        {context.category && <span>{context.category}</span>}
        {context.category && context.round != null && <i>/</i>}
        {context.round != null && <b>{`Round ${context.round}`}</b>}
        {context.of != null && <span>{`of ${context.of}`}</span>}
      </span>
      {timer && <span className="rail-timer">{timer}</span>}
      {hasJoin && (
        <div className="rail-join">
          <span data-join-word="" data-drop="2">JOIN</span>
          {join.url && <span data-join-url="" data-drop="3">{join.url}</span>}
          {join.code && <code>{join.code}</code>}
        </div>
      )}
    </header>
  );
}
