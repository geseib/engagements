import React, { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import {
  SURVEY_KINDS, surveyKindMeta, kindLabel, previewLine, convertKind,
} from '../config/surveyKinds';
import './SurveyQuestionFields.css';

/**
 * A SURVEY QUESTION IN THE SET EDITOR.
 *
 * The pieces the Questions panel (components/QuestionsPanel.jsx) adds for a
 * survey set, drawn in docs/design/survey-redesign/04-editor.html (the row and
 * the Add menu), 05-edit-question.html (the form, a rating chosen) and
 * 06-kind-fields.html (the other four kinds). The panel's working copy, its
 * tombstones, its reorder and its one Save are untouched: a survey question is
 * a row like any other, and this file only draws what a kind adds to it.
 *
 * What a person reads about a kind — its name, icon, sentence, preview line,
 * and what switching away would lose — is config/surveyKinds.js. What a row
 * holds and how it is written is utils/questionRows.js. Nothing here decides
 * either; it renders them.
 */

/* ------------------------------------------------------------------ rows -- */

/** The Kind chip on a row: an icon AND a word, never the icon alone. */
export function SurveyKindChip({ row }) {
  const meta = surveyKindMeta(row && row.kind);
  return (
    <span className="sqf sqf-cell-kind">
      <span className="sqf-kind">
        <Icon name={meta.icon} weight="bold" size={13} color="currentColor" />
        {kindLabel(row)}
      </span>
    </span>
  );
}

/**
 * The one-line answer preview under a question's title: the leading figure in
 * the text ink ("1–5", "4 options"), the rest muted.
 */
export function SurveyPreviewLine({ row }) {
  const line = previewLine(row);
  const [head, ...rest] = line.split(' · ');
  return (
    <span className="sqf sqf-prev" title={line}>
      <b>{head}</b>{rest.length ? ` · ${rest.join(' · ')}` : ''}
    </span>
  );
}

/** Required, or Optional — in words, on every row. */
export function SurveyRequiredMark({ required }) {
  return (
    <span className={`sqf sqf-req${required ? ' on' : ''}`}>
      {required ? 'Required' : 'Optional'}
    </span>
  );
}

/* -------------------------------------------------------------- Add menu -- */

/**
 * ADD QUESTION NAMES THE KIND FIRST (mockup 04): the kind decides every field
 * that follows, so it is the first thing chosen, as a menu of five sentences.
 *
 * A real menu button. Opening it moves focus to the first kind; ↑ ↓ move it
 * (and wrap), Home and End jump, Enter or a click picks, Escape closes and
 * gives focus back to the button, Tab or a click anywhere else closes it.
 */
export function SurveyAddMenu({ onAdd, onPull, disabled = false, title }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef(null);
  const triggerRef = useRef(null);
  const itemRefs = useRef([]);

  const items = [
    ...SURVEY_KINDS.map((k) => ({ key: k.id, icon: k.icon, label: k.label, blurb: k.blurb, pick: () => onAdd(k.id) })),
    ...(onPull ? [{
      key: 'pull', icon: 'Books', label: 'From another set',
      blurb: 'Copy questions from a survey or poll you already have.', pick: onPull, rule: true,
    }] : []),
  ];

  const close = (refocus) => {
    setOpen(false);
    if (refocus && triggerRef.current) triggerRef.current.focus();
  };

  useEffect(() => {
    if (open && itemRefs.current[active]) itemRefs.current[active].focus();
  }, [open, active]);

  // A click outside the menu closes it, as every menu does.
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const choose = (item) => {
    setOpen(false);
    item.pick();
  };

  const onMenuKey = (e) => {
    const last = items.length - 1;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i >= last ? 0 : i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i <= 0 ? last : i - 1)); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(last); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(items[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === 'Tab') setOpen(false);
  };

  const openAt = (index) => { setActive(index); setOpen(true); };

  return (
    <span className="sqf sqf-add" ref={wrapRef}>
      <button
        type="button"
        ref={triggerRef}
        className="btn-primary btn-small"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        title={title}
        onClick={() => (open ? setOpen(false) : openAt(0))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); openAt(0); }
          if (e.key === 'ArrowUp') { e.preventDefault(); openAt(items.length - 1); }
        }}
      >
        <Icon name="Plus" weight="bold" size={14} color="currentColor" /> Add question{' '}
        <Icon name="CaretDown" weight="bold" size={12} color="currentColor" />
      </button>
      {open && (
        <div className="sqf-menu" role="menu" aria-label="Add a question of this kind" onKeyDown={onMenuKey}>
          {items.map((item, i) => (
            <React.Fragment key={item.key}>
              {item.rule && <hr className="sqf-menu-rule" />}
              <button
                type="button"
                role="menuitem"
                className="sqf-menu-item"
                tabIndex={i === active ? 0 : -1}
                ref={(el) => { itemRefs.current[i] = el; }}
                onClick={() => choose(item)}
                onMouseEnter={() => setActive(i)}
              >
                <Icon name={item.icon} weight="bold" size={17} color="currentColor" />
                <div><b>{item.label}</b><span>{item.blurb}</span></div>
              </button>
            </React.Fragment>
          ))}
        </div>
      )}
    </span>
  );
}

/* ------------------------------------------------------------ the form -- */

const LETTERS = 'ABCDEFGH';
const SCALES = [
  { id: '1-5', label: '1–5', low: '1', high: '5' },
  { id: '1-10', label: '1–10', low: '1', high: '10' },
  { id: '0-10', label: '0–10 recommend score', low: '0', high: '10' },
  { id: 'stars', label: 'Stars', low: '1 star', high: '5 stars' },
];
const LIMITS = { choice: [2, 8], rank: [3, 7] };
const defaultLimit = (length) => (length === 'short' ? 280 : 500);

/** '' is "not set" (null), never zero; anything else is the number typed. */
const numberOrNull = (value) => (value === '' ? null : Number(value));

/** "a, b and c" — what a switch would lose, as one sentence. */
const inWords = (list) => (list.length < 2 ? list.join('')
  : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`);

/** A pressed-button segment: one of N, the choice named by aria-pressed. */
function Segment({ labelledBy, options, value, onChange }) {
  return (
    <div className="sqf-seg" role="group" aria-labelledby={labelledBy}>
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={value === o.id} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A checkbox whose whole label is the target, with its explanation under it. */
function Switch({ checked, onChange, label, children }) {
  return (
    <label className="sqf-switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}<small>{children}</small></span>
    </label>
  );
}

/** The editable list a choice or a ranking keeps — two to eight, three to seven. */
function OptionList({ draft, onChange, idOf, noun, keyOf }) {
  const [min, max] = LIMITS[draft.kind];
  const options = Array.isArray(draft.options) ? draft.options : [];
  const setAt = (i, value) => onChange({ ...draft, options: options.map((o, j) => (j === i ? value : o)) });
  const Noun = noun[0].toUpperCase() + noun.slice(1);
  return (
    <>
      <ol className="sqf-optlist" aria-labelledby={idOf('options-label')}>
        {options.map((o, i) => (
          // Keyed by place: the options are bare strings with no identity of
          // their own, and two may read the same while being typed.
          <li className="sqf-o" key={i}>
            <span className="sqf-k" aria-hidden="true">{keyOf(i)}</span>
            <input
              type="text"
              className="form-input"
              aria-label={`${Noun} ${keyOf(i)}`}
              value={o}
              onChange={(e) => setAt(i, e.target.value)}
            />
            <button
              type="button"
              className="sqf-x"
              aria-label={`Remove ${noun} ${keyOf(i)}`}
              title={options.length <= min ? `A question like this needs at least ${min}` : `Remove ${noun} ${keyOf(i)}`}
              disabled={options.length <= min}
              onClick={() => onChange({ ...draft, options: options.filter((_, j) => j !== i) })}
            >
              <Icon name="X" weight="bold" size={14} color="currentColor" />
            </button>
          </li>
        ))}
      </ol>
      <button
        type="button"
        className="btn-secondary btn-small sqf-addline"
        disabled={options.length >= max}
        title={options.length >= max ? `${max} is the most a question like this can have` : undefined}
        onClick={() => onChange({ ...draft, options: [...options, ''] })}
      >
        <Icon name="Plus" weight="bold" size={12} color="currentColor" /> Add {noun === 'option' ? 'an option' : 'an item'}
      </button>
    </>
  );
}

function RatingFields({ draft, set, idOf }) {
  const scale = SCALES.find((s) => s.id === (draft.scale || '1-5')) || SCALES[0];
  return (
    <>
      <div className="sqf-field">
        <span className="sqf-lab" id={idOf('scale-label')}>Scale</span>
        <Segment labelledBy={idOf('scale-label')} options={SCALES} value={scale.id} onChange={(id) => set({ scale: id })} />
      </div>
      <div className="sqf-row">
        <div className="form-group">
          <label htmlFor={idOf('lowLabel')}>Label under {scale.low}</label>
          <input id={idOf('lowLabel')} type="text" className="form-input" value={draft.lowLabel || ''}
            onChange={(e) => set({ lowLabel: e.target.value })} />
        </div>
        <div className="form-group">
          <label htmlFor={idOf('highLabel')}>Label under {scale.high}</label>
          <input id={idOf('highLabel')} type="text" className="form-input" value={draft.highLabel || ''}
            onChange={(e) => set({ highLabel: e.target.value })} />
        </div>
      </div>
    </>
  );
}

function ChoiceFields({ draft, onChange, set, idOf }) {
  const several = draft.allowMultiple === true;
  return (
    <>
      <div className="sqf-field">
        <span className="sqf-lab" id={idOf('options-label')}>Options <span className="sqf-dim">— 2 to 8</span></span>
        <OptionList draft={draft} onChange={onChange} idOf={idOf} noun="option" keyOf={(i) => LETTERS[i] || String(i + 1)} />
      </div>
      <div className="sqf-field">
        <span className="sqf-lab" id={idOf('picks-label')}>People can pick</span>
        <div className="sqf-line">
          <Segment
            labelledBy={idOf('picks-label')}
            options={[{ id: 'one', label: 'One' }, { id: 'several', label: 'Several' }]}
            value={several ? 'several' : 'one'}
            onChange={(id) => set({ allowMultiple: id === 'several' })}
          />
          <label className="sqf-dim" htmlFor={idOf('maxPicks')}>up to</label>
          <input
            id={idOf('maxPicks')}
            type="number"
            className="sqf-num"
            min={2}
            max={8}
            placeholder="any"
            value={several && draft.maxPicks !== null && draft.maxPicks !== undefined ? draft.maxPicks : ''}
            disabled={!several}
            title={several ? 'Leave it empty to let people pick any number' : 'Choose Several first'}
            onChange={(e) => set({ maxPicks: numberOrNull(e.target.value) })}
          />
        </div>
      </div>
      <Switch checked={draft.allowOther === true} onChange={(v) => set({ allowOther: v })}
        label="Add ‘Something else’ with a box">
        Write-ins are listed under the chart and never counted as an option.
      </Switch>
      <Switch checked={draft.shuffle === true} onChange={(v) => set({ shuffle: v })}
        label="Shuffle the order for each person">
        Stops the first option winning because it was first.
      </Switch>
    </>
  );
}

function YesNoFields({ draft, set, idOf }) {
  const asking = Boolean(draft.followUpWhen);
  return (
    <>
      <div className="sqf-row">
        <div className="form-group">
          <label htmlFor={idOf('yesLabel')}>Yes reads</label>
          <input id={idOf('yesLabel')} type="text" className="form-input" placeholder="Yes" value={draft.yesLabel || ''}
            onChange={(e) => set({ yesLabel: e.target.value })} />
        </div>
        <div className="form-group">
          <label htmlFor={idOf('noLabel')}>No reads</label>
          <input id={idOf('noLabel')} type="text" className="form-input" placeholder="No" value={draft.noLabel || ''}
            onChange={(e) => set({ noLabel: e.target.value })} />
        </div>
      </div>
      <Switch checked={draft.unsure === true} onChange={(v) => set({ unsure: v })} label="Offer ‘Not sure’">
        A third, smaller button. Counted, never folded into No.
      </Switch>
      {/* Off keeps the question typed below in the row, unwritten — the CSV
          carries a follow-up question only while there is a follow-up — so
          turning it back on brings the words back. */}
      <Switch checked={asking} onChange={(v) => set({ followUpWhen: v ? 'no' : '' })} label="Ask why">
        A box opens under the answer, on the same screen.
      </Switch>
      {asking && (
        <div className="sqf-sub">
          <div className="sqf-row">
            <div className="form-group sqf-narrow">
              <label htmlFor={idOf('followUpWhen')}>When they say</label>
              <select id={idOf('followUpWhen')} className="form-select" value={draft.followUpWhen}
                onChange={(e) => set({ followUpWhen: e.target.value })}>
                <option value="no">No</option>
                <option value="yes">Yes</option>
                <option value="any">Either</option>
              </select>
            </div>
            <div className="form-group">
              <label htmlFor={idOf('followUpPrompt')}>Ask</label>
              <input id={idOf('followUpPrompt')} type="text" className="form-input" value={draft.followUpPrompt || ''}
                placeholder="What would change your mind?"
                onChange={(e) => set({ followUpPrompt: e.target.value })} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function RankFields({ draft, onChange, set, idOf }) {
  const topMode = draft.rankTop !== null && draft.rankTop !== undefined;
  const count = (draft.options || []).length;
  return (
    <>
      <div className="sqf-field">
        <span className="sqf-lab" id={idOf('options-label')}>Items to put in order <span className="sqf-dim">— 3 to 7</span></span>
        <OptionList draft={draft} onChange={onChange} idOf={idOf} noun="item" keyOf={(i) => String(i + 1)} />
      </div>
      <div className="sqf-field">
        <span className="sqf-lab" id={idOf('rank-label')}>How much ranking</span>
        <div className="sqf-line">
          <Segment
            labelledBy={idOf('rank-label')}
            options={[{ id: 'all', label: 'All of them' }, { id: 'top', label: 'Just the top' }]}
            value={topMode ? 'top' : 'all'}
            onChange={(id) => set({ rankTop: id === 'top' ? Math.max(1, Math.min(3, count - 1)) : null })}
          />
          <input
            type="number"
            className="sqf-num"
            aria-label="Top how many"
            min={1}
            max={Math.max(1, count - 1)}
            value={topMode ? draft.rankTop : ''}
            disabled={!topMode}
            title={topMode ? undefined : 'Choose Just the top first'}
            onChange={(e) => set({ rankTop: e.target.value === '' ? '' : Number(e.target.value) })}
          />
        </div>
        <p className="sqf-help">Past four, people guess. The results read by average place, and unranked items count as last.</p>
      </div>
    </>
  );
}

function TextFields({ draft, set, idOf }) {
  const length = draft.textLength || 'long';
  const switchLength = (next) => {
    // A limit still at the old length's default follows the length; one the
    // author chose stays theirs.
    const limit = draft.maxLength;
    const atDefault = limit === null || limit === undefined || limit === defaultLimit(length);
    set({ textLength: next, ...(atDefault ? { maxLength: defaultLimit(next) } : {}) });
  };
  return (
    <>
      <div className="sqf-field">
        <span className="sqf-lab" id={idOf('length-label')}>Length</span>
        <Segment
          labelledBy={idOf('length-label')}
          options={[{ id: 'short', label: 'Short — a line' }, { id: 'long', label: 'Long — a paragraph' }]}
          value={length}
          onChange={switchLength}
        />
      </div>
      <div className="sqf-row">
        <div className="form-group sqf-narrow">
          <label htmlFor={idOf('maxLength')}>Up to</label>
          <input id={idOf('maxLength')} type="number" className="sqf-num" min={20} max={2000}
            value={draft.maxLength === null || draft.maxLength === undefined ? '' : draft.maxLength}
            onChange={(e) => set({ maxLength: numberOrNull(e.target.value) })} />
        </div>
        <div className="form-group">
          <label htmlFor={idOf('placeholder')}>Placeholder <span className="sqf-dim">— optional</span></label>
          <input id={idOf('placeholder')} type="text" className="form-input" value={draft.placeholder || ''}
            placeholder="What you’d tell a colleague who missed it"
            onChange={(e) => set({ placeholder: e.target.value })} />
        </div>
      </div>
      <Switch checked={draft.themes !== false} onChange={(v) => set({ themes: v })}
        label="Let Workie group the answers into themes">
        On close. You still read every answer; themes only sort them.
      </Switch>
    </>
  );
}

const KIND_FIELDS = {
  rating: RatingFields,
  choice: ChoiceFields,
  yesno: YesNoFields,
  rank: RankFields,
  text: TextFields,
};

/**
 * THE SURVEY QUESTION FORM (mockups 05 and 06): the kind first, then the
 * question, its detail, the kind's own fields, and Needs an answer. Category
 * is not shown — every survey row is filed under `Survey`, which blankRow and
 * the panel's Done fill in.
 *
 * SWITCHING KIND NEVER THROWS ANYTHING AWAY WITHOUT ASKING. `convertKind` says
 * what a switch would lose, in words. Nothing lost (Choice ↔ Ranking keep their
 * list; a default rating has nothing to lose) switches at once; anything lost
 * is asked about HERE, inside this dialog, in the panel's own confirm strip —
 * never in a second modal over it (docs/design/admin-container-rule.md).
 *
 * `phonePreview` IS THE SLOT FOR MOCKUP 05's PHONE. The player's survey inputs
 * are Phase 2, so there is nothing to show yet and QuestionsPanel passes
 * nothing; the day there is, the preview (an iframe of the participant surface
 * fed this draft) goes in here and the form makes room beside it.
 */
export default function SurveyQuestionFields({ draft, onChange, idOf, phonePreview = null }) {
  const [pendingSwitch, setPendingSwitch] = useState(null); // { kind, row, loses }
  const set = (fields) => onChange({ ...draft, ...fields });
  const Fields = KIND_FIELDS[draft.kind];

  const requestKind = (kind) => {
    if (kind === draft.kind) return;
    const { row, loses } = convertKind(draft, kind);
    if (loses.length) setPendingSwitch({ kind, row, loses });
    else { setPendingSwitch(null); onChange(row); }
  };

  return (
    <div className={`sqf sqf-form${phonePreview ? ' has-preview' : ''}`}>
      <div className="sqf-main">
        <div className="sqf-field">
          <span className="sqf-lab" id={idOf('kind-label')}>Kind</span>
          <div className="sqf-kindbar" role="group" aria-labelledby={idOf('kind-label')}>
            {SURVEY_KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                className="sqf-opt"
                aria-pressed={draft.kind === k.id}
                onClick={() => requestKind(k.id)}
              >
                <Icon name={k.icon} weight="bold" size={15} color="currentColor" />
                {k.label}
              </button>
            ))}
          </div>
          <p className="sqf-help">
            Multiple choice and Ranking share a list, so switching between them keeps it. Any other
            switch asks first when it would throw something away.
          </p>
        </div>

        {pendingSwitch && (
          <div className="qs-form-discard" role="alert">
            <p>
              <Icon name="Warning" weight="fill" size={16} color="var(--primary)" />{' '}
              <strong>Make this {surveyKindMeta(pendingSwitch.kind).label}?</strong>{' '}
              It would lose {inWords(pendingSwitch.loses)}. The question itself and Needs an answer stay.
            </p>
            <div className="qs-panel-actions">
              <button type="button" className="btn-secondary btn-small" onClick={() => setPendingSwitch(null)}>
                Keep it {kindLabel(draft)}
              </button>
              <button
                type="button"
                className="btn-danger btn-small"
                onClick={() => { onChange(pendingSwitch.row); setPendingSwitch(null); }}
              >
                Switch and lose {pendingSwitch.loses.length === 1 ? 'it' : 'them'}
              </button>
            </div>
          </div>
        )}

        <div className="form-group">
          <label htmlFor={idOf('title')}>Question</label>
          <input id={idOf('title')} type="text" className="form-input" value={draft.title || ''}
            onChange={(e) => set({ title: e.target.value })} />
        </div>
        <div className="form-group">
          <label htmlFor={idOf('detail')}>
            Detail <span className="sqf-dim">— optional, shown under the question</span>
          </label>
          <input id={idOf('detail')} type="text" className="form-input" value={draft.detail || ''}
            onChange={(e) => set({ detail: e.target.value })} />
        </div>

        {Fields && <Fields draft={draft} onChange={onChange} set={set} idOf={idOf} />}

        <Switch checked={draft.required === true} onChange={(v) => set({ required: v })} label="Needs an answer">
          Required questions can’t be skipped. Keep it to the one or two you must have.
        </Switch>
      </div>

      {phonePreview && (
        <div className="sqf-side">
          <span className="sqf-lab">On a phone</span>
          {phonePreview}
        </div>
      )}
    </div>
  );
}
