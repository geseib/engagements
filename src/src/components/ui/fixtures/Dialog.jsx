import React from 'react';
import '../Dialog.css';

/**
 * Gallery fixture for the modal look, `.ui-scrim` / `.ui-dialog` (unit L13).
 * Sample data only; no network, and no <Modal>: the behaviour primitive would
 * lock the gallery's scroll and trap its focus. Each scrim is pinned inside its
 * own frame (inline position: absolute) so several dialogs can sit on one page;
 * in a product it is position: fixed over the viewport.
 */
const frame = (height) => ({ position: 'relative', height, overflow: 'hidden', borderRadius: 8, flex: '1 1 340px' });
const pinned = { position: 'absolute' };

function Shell({ theme, variant, title, sub, children, foot, height = 380 }) {
  const id = `ui-dialog-fixture-${theme}-${variant || 'default'}`;
  return (
    <div style={frame(height)}>
      <div className="ui-scrim" style={pinned}>
        <div className={`ui-dialog${variant ? ` ui-dialog--${variant}` : ''}`} data-theme={theme} role="dialog" aria-labelledby={id}>
          <header className="ui-dialog-head">
            <div className="ui-dialog-titles">
              <h2 id={id} className="ui-dialog-title">{title}</h2>
              {sub && <p className="ui-dialog-sub">{sub}</p>}
            </div>
            <button type="button" className="ui-dialog-x" aria-label="Close">×</button>
          </header>
          <div className="ui-dialog-body">{children}</div>
          <footer className="ui-dialog-foot">{foot}</footer>
        </div>
      </div>
    </div>
  );
}

const exits = (go) => (
  <>
    <button type="button">Cancel</button>
    <button type="button">{go}</button>
  </>
);

export default function DialogFixture() {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
      <Shell theme="dark" title="Rename this set" sub="Hosts see the new name the next time they open the shelf." foot={exits('Rename')}>
        <p>Product review, week 41: an eleven-question poll with two saved reports.</p>
      </Shell>
      <Shell theme="light" title="Rename this set" sub="Hosts see the new name the next time they open the shelf." foot={exits('Rename')}>
        <p>Product review, week 41: an eleven-question poll with two saved reports.</p>
      </Shell>
      <Shell theme="dark" variant="small" title="Delete this set?" foot={exits('Delete set')} height={300}>
        <p>Two saved reports use it. They keep their copy of the questions.</p>
      </Shell>
      <Shell theme="light" variant="small" title="Delete this set?" foot={exits('Delete set')} height={300}>
        <p>Two saved reports use it. They keep their copy of the questions.</p>
      </Shell>
      <Shell theme="dark" variant="full" title="Generate questions" sub="Step 2 of 3: review the draft" foot={exits('Add 12 questions')} height={460}>
        {Array.from({ length: 12 }, (_, i) => (
          <p key={i}>{`Question ${i + 1}: what would you stop doing if the budget halved tomorrow?`}</p>
        ))}
      </Shell>
    </div>
  );
}
