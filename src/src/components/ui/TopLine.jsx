import React from 'react';
import './TopLine.css';

/**
 * TOP LINE — the line across the top of the wall and the stage
 * (docs/design/themes/SPEC.md §6):
 *
 *   <TopLine left={<><b>Strategy offsite</b> · Round 5 of 8</>} right="Answering" />
 *
 * left      node, the session and where it is (wrap the emphasis in <b>)
 * right     node, the moment
 * className passed through, after the component's own class
 *
 * A side that is null, undefined or false is not rendered; the right side
 * keeps to the right either way. Muted line, --text emphasis, a --hair rule
 * beneath (2px under Call). Size and spacing are the caller's (TopLine.css).
 * Any other prop (id, aria-*, style) lands on the root.
 */
const shown = (v) => v !== null && v !== undefined && v !== false && v !== '';

export default function TopLine({ left, right, className, ...rest }) {
  const cls = ['ui-top-line', className].filter(Boolean).join(' ');
  return (
    <div className={cls} {...rest}>
      {shown(left) && <span className="ui-top-line-left">{left}</span>}
      {shown(right) && <span className="ui-top-line-right">{right}</span>}
    </div>
  );
}
