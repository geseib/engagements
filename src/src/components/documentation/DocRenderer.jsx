import React from 'react';
import './documentation.css';
import Icon from '../Icon';
import { GAME_TYPES, PICKER_GAME_TYPES, gameTypeMeta } from '../../config/gameTypes';
import { TEMPLATE_VARIABLES } from '../../config/templateVariables';

/**
 * ONE RENDERER FOR EVERY GUIDE, because eighteen hand-written components is how
 * sixteen of them came to say "this documentation section is currently under
 * development".
 *
 * The help system used to be two lists that had to agree and did not: a
 * hand-written table of contents in `HelpSystem.jsx` naming 18 guides across 5
 * roles, and a `switch` beneath it that could render 2. The other 16 fell to a
 * default branch apologising for itself. Nothing enforced the relationship, so
 * the table of contents was free to promise whatever it liked.
 *
 * The fix is not "write sixteen more components" — that leaves the same gap
 * open for the nineteenth. It is to make the guides DATA (`config/help/`) and
 * derive the contents from the corpus, so a guide that is advertised is a guide
 * that exists, by construction. Three other things fall out of that for free:
 *
 *   THE SEARCH BOX WORKS. It was rendered, it set `searchTerm`, and nothing
 *   ever read the value — a search field that quietly discards what you type.
 *   Searching prose trapped in JSX means walking a React tree; searching a data
 *   corpus is a filter.
 *
 *   THE CONTENT IS TESTABLE without mounting anything. A test can assert that
 *   every guide the contents offers resolves, that no guide is empty, and that
 *   the vocabulary below covers every block in the corpus.
 *
 *   THE DERIVED BLOCKS CANNOT DRIFT. `phases` and `gameTypes` read
 *   `config/gameTypes.js` rather than restating it. The shipped host guide had
 *   already drifted: it told hosts trivia runs a VOTE phase that is "automatic
 *   — no voting needed", when `GAME_TYPES.trivia.phases` is `['ASK','RESULTS']`
 *   and there is no vote phase to automate. It also named three question set
 *   types out of five.
 *
 * ADDING A BLOCK TYPE means adding a case here and to `BLOCK_TYPES`. An unknown
 * type renders nothing rather than crashing the modal, and a test asserts the
 * corpus uses no type this file does not handle — so the failure mode is a red
 * test, not a blank guide in front of a user.
 */

/** Every `t` value `renderBlock` handles. The corpus is tested against this. */
export const BLOCK_TYPES = [
  'p', 'h', 'steps', 'list', 'note', 'features', 'faq', 'keys',
  'phases', 'gameTypes', 'table', 'variables', 'code',
];

const NOTE_TONES = {
  info: { className: 'help-info-box', icon: 'Info' },
  tip: { className: 'help-tip-box', icon: 'Lightbulb' },
  warn: { className: 'help-warning-box', icon: 'Warning' },
};

/**
 * An item is either a bare string or `{ title, text }`. Both shapes appear all
 * over the corpus because both read correctly: a step with a name wants the
 * name in bold, a plain sentence does not want to invent one.
 */
function Item({ item }) {
  if (item && typeof item === 'object') {
    return (
      <>
        <strong>{item.title}</strong>
        {item.text ? <p>{item.text}</p> : null}
      </>
    );
  }
  return <>{item}</>;
}

function PhaseFlow({ gameType }) {
  const meta = gameTypeMeta(gameType);
  const described = {
    ASK: 'Everyone responds',
    VOTE: 'The room ranks the answers',
    RESULTS: 'Scores, and what the AI made of it',
  };
  return (
    <>
      <ol className="phase-flow">
        {meta.phases.map((phase, i) => (
          <React.Fragment key={phase}>
            {i > 0 && (
              <li className="phase-flow__arrow" aria-hidden="true">
                <Icon name="ArrowRight" weight="bold" size={18} color="var(--muted)" />
              </li>
            )}
            <li className="phase-flow__step">
              <span className="phase-flow__name">{phase}</span>
              <span className="phase-flow__desc">{described[phase]}</span>
            </li>
          </React.Fragment>
        ))}
      </ol>
      {!meta.phases.includes('VOTE') && (
        <p className="phase-flow__note">
          {`${meta.label} has no voting step — it goes straight from ASK to RESULTS.`}
        </p>
      )}
    </>
  );
}

/**
 * THE TYPES A HOST CAN ACTUALLY CREATE, from `PICKER_GAME_TYPES` — the same
 * derived list the create dialog itself renders from. Survey is deliberately
 * absent from both: the importer rejects survey uploads, so no survey set can
 * exist to play. Documenting it as an option would describe a dead end.
 */
function GameTypeTable() {
  return (
    <div className="help-table-wrap">
      <table className="help-table">
        <thead>
          <tr><th>Type</th><th>What it is</th><th>Phases</th></tr>
        </thead>
        <tbody>
          {PICKER_GAME_TYPES.map((type) => (
            <tr key={type.id}>
              <th scope="row">
                <Icon name={type.icon} weight="bold" size={16} color="currentColor" />
                {` ${type.label}`}
              </th>
              <td>{type.blurb}</td>
              <td>{type.phases.join(' → ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * PLACEHOLDER NAMES AND THEIR DESCRIPTIONS, FROM THE CATALOGUE.
 *
 * The guide picks WHICH placeholders are worth showing — that is editorial, and
 * dumping all ~60 into a help page helps nobody. What it does not get to do is
 * restate what one means. The old AI-prompts guide hand-wrote both halves and
 * had already drifted from the catalogue on the names alone: it documented
 * `{totalPlayers}` and `{gameContext}`, and the real variables are
 * `totalParticipants` and `sessionContext`. A prompt author following that
 * guide wrote placeholders that substitute to nothing.
 *
 * So the selection is here and the descriptions come from
 * `config/templateVariables.js`. A name that is not in the catalogue renders
 * nothing and fails a test, rather than teaching somebody a placeholder that
 * does not exist.
 */
function VariableList({ names }) {
  const rows = names
    .map((name) => TEMPLATE_VARIABLES.find((v) => v.name === name))
    .filter(Boolean);
  return (
    <div className="help-variables-grid">
      {rows.map((row) => (
        <div className="help-variable-item" key={row.name}>
          <code>{`{${row.name}}`}</code>
          <span>{row.description}</span>
        </div>
      ))}
    </div>
  );
}

export function renderBlock(block, key) {
  if (!block || typeof block !== 'object') return null;
  switch (block.t) {
    case 'p':
      return <p key={key}>{block.text}</p>;

    case 'h':
      return <h3 key={key}>{block.text}</h3>;

    case 'steps':
      return (
        <ol key={key} className="help-steps">
          {block.items.map((item, i) => <li key={i}><Item item={item} /></li>)}
        </ol>
      );

    case 'list':
      return (
        <ul key={key}>
          {block.items.map((item, i) => <li key={i}><Item item={item} /></li>)}
        </ul>
      );

    case 'note': {
      const tone = NOTE_TONES[block.tone] || NOTE_TONES.info;
      return (
        <div key={key} className={tone.className}>
          <h4>
            <Icon name={tone.icon} weight="duotone" size={16} color="var(--primary)" />
            {` ${block.title}`}
          </h4>
          {block.text ? <p>{block.text}</p> : null}
          {block.items ? (
            <ul>
              {block.items.map((item, i) => <li key={i}><Item item={item} /></li>)}
            </ul>
          ) : null}
        </div>
      );
    }

    case 'features':
      return (
        <div key={key} className="help-feature-grid">
          {block.items.map((item, i) => (
            <div key={i} className="help-feature-item">
              <span className="help-feature-icon">
                <Icon name={item.icon} weight="duotone" size={16} color="var(--primary)" />
              </span>
              <h4>{item.title}</h4>
              <p>{item.text}</p>
            </div>
          ))}
        </div>
      );

    case 'faq':
      return (
        <dl key={key} className="help-faq">
          {block.items.map((item, i) => (
            <React.Fragment key={i}>
              <dt>{item.q}</dt>
              <dd>{item.a}</dd>
            </React.Fragment>
          ))}
        </dl>
      );

    /*
      KEYBOARD SHORTCUTS AS A LIST OF <kbd>, not prose. A shortcut written into
      a sentence is a shortcut nobody scanning the page will find — and the
      round review now has enough of them (digits, arrows, Escape) that they
      need somewhere to live together.
    */
    case 'keys':
      return (
        <dl key={key} className="help-keys">
          {block.items.map((item, i) => (
            <React.Fragment key={i}>
              <dt><kbd>{item.keys}</kbd></dt>
              <dd>{item.text}</dd>
            </React.Fragment>
          ))}
        </dl>
      );

    case 'variables':
      return <VariableList key={key} names={block.names} />;

    case 'code':
      return (
        <div key={key} className="help-code-block">
          <pre>{block.text}</pre>
        </div>
      );

    case 'phases':
      return <PhaseFlow key={key} gameType={block.gameType} />;

    case 'gameTypes':
      return <GameTypeTable key={key} />;

    case 'table':
      return (
        <div key={key} className="help-table-wrap">
          <table className="help-table">
            <thead>
              <tr>{block.head.map((h, i) => <th key={i}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {block.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    j === 0
                      ? <th key={j} scope="row">{cell}</th>
                      : <td key={j}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    default:
      return null;
  }
}

/**
 * One guide. The `<h1>`/lede header matches what the two hand-written guides
 * rendered, so `documentation.css` did not have to change to accommodate this.
 */
export default function DocRenderer({ guide }) {
  if (!guide) return null;
  return (
    <div className="help-content-doc">
      <div className="help-doc-header">
        <h1>
          <Icon name={guide.icon || 'FileText'} weight="duotone" size={16} color="var(--primary)" />
          {` ${guide.title}`}
        </h1>
        <p>{guide.summary}</p>
      </div>

      {guide.sections.map((section, si) => (
        <div className="help-doc-section" key={section.title || si}>
          {section.title ? (
            <h2>
              <Icon
                name={section.icon || 'Circle'}
                weight="duotone"
                size={16}
                color="var(--primary)"
              />
              {` ${section.title}`}
            </h2>
          ) : null}
          {section.blocks.map((block, bi) => renderBlock(block, bi))}
        </div>
      ))}
    </div>
  );
}

/** Re-exported so a test can prove the derived blocks track the real table. */
export { GAME_TYPES };
