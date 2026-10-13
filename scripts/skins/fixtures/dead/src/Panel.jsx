// fixture for deadSelectors.js --selftest. fx-comment is named only here, in a comment.
/* and fx-comment again in a block comment */
export default function Panel({ phase, open, el }) {
  if (open) el.classList.add('fx-open');
  return (
    <div className="fx-panel">
      <h2 className={`fx-title ${open ? 'is-open' : ''}`}>Title</h2>
      <span className={`fx-phase-${phase}`} />
    </div>
  );
}
