import React from 'react';
import '../Row.css';

/**
 * Gallery fixture for `.ui-row` (unit L11). Sample data only; no network.
 * Shows each selected form (aria-selected on a table row, aria-current on a
 * link, .is-selected on a list item) in dusk and paper. Hover is a pointer
 * state and cannot be shown statically: point at an unselected row.
 *
 * The inline styles are layout and role reads for the fixture's own frame
 * only; the component itself is the class.
 */
const SETS = [
  { name: 'Strategy offsite: opening round', count: 12 },
  { name: 'Product review, week 41', count: 8, selected: true },
  { name: 'All-hands trivia', count: 20 },
];

const frame = {
  background: 'var(--bg)', color: 'var(--text)', padding: 16, borderRadius: 8, flex: '1 1 320px',
};
const cell = { padding: '8px 12px', textAlign: 'left' };

function Sheet({ theme }) {
  return (
    <div data-theme={theme} style={frame}>
      <p style={{ margin: '0 0 8px', color: 'var(--muted)' }}>{theme === 'dark' ? 'Dusk' : 'Paper'}</p>
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <tbody>
          {SETS.map((s) => (
            <tr key={s.name} className="ui-row" aria-selected={s.selected ? 'true' : undefined}>
              <td style={cell}>{s.name}</td>
              <td style={{ ...cell, color: 'var(--muted)', width: 96 }}>{`${s.count} questions`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <nav aria-label={`${theme} sections`} style={{ display: 'grid', gap: 2, marginTop: 12 }}>
        <a className="ui-row" href="#gallery-ui-row" style={{ ...cell, color: 'inherit', textDecoration: 'none' }}>Question sets</a>
        <a className="ui-row" href="#gallery-ui-row" aria-current="page" style={{ ...cell, color: 'inherit', textDecoration: 'none' }}>Sessions</a>
      </nav>
      <ul style={{ listStyle: 'none', margin: '12px 0 0', padding: 0 }}>
        <li className="ui-row" style={cell}>An ordinary list item</li>
        <li className="ui-row is-selected" style={cell}>A selected list item</li>
      </ul>
    </div>
  );
}

export default function RowFixture() {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
      <Sheet theme="dark" />
      <Sheet theme="light" />
    </div>
  );
}
