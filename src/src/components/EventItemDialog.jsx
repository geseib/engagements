import React, { useState } from 'react';
import Modal from './Modal';
import Icon from './Icon';
import rules from '../../../lambda-functions/websocket/events/agenda-rules';
import { addItem, updateItem, removeItem } from '../utils/eventsApi';
import './EventBuilder.css';

/**
 * ADD AN ENGAGEMENT, ADD A BREAK, EDIT OR REMOVE AN ITEM —
 * docs/design/agenda-redesign/03-add-item.html.
 *
 *   mode 'add', an engagement type  the set picker (sets of that type only),
 *                                   the title, length, place and description
 *   mode 'add', type 'break'        the same fields without a set; 03 draws no
 *                                   break dialog, so this is 03's form minus
 *                                   its picker
 *   mode 'edit'                     title, length, description; the set is
 *                                   named, not changed (a different set is a
 *                                   different item: remove this one and add
 *                                   that). "Remove from agenda" confirms INLINE
 *                                   — never a modal from a modal.
 *   mode 'edit', an item whose      no fields and no Save: its words could not
 *   words could not be read         be decrypted, so nothing can be edited. It
 *   (`item.decryptFailed`)          says so, and offers Remove and Close
 *                                   (final review M4).
 *
 * The version shown in the picker ("v3 · latest") is the one that will be
 * pinned; the server pins it again and holds it until the host presses
 * "Use vN" on the row. A set may appear twice on one agenda, and says so
 * ("On this agenda · 6"). The add menu opens this only below the caps; if a
 * co-host fills the last place meanwhile, the server refuses Add with the
 * menu's own sentence and the choices here are KEPT (03's last note).
 *
 * @param {string}   code      the event
 * @param {'add'|'edit'} mode
 * @param {string}   type      the item's kind (agenda-rules.ITEM_TYPES)
 * @param {object}   [item]    edit: the item, as GET /events/{code} gives it
 * @param {object[]} items     the agenda now, in order — for "Goes after" and
 *                             "On this agenda"
 * @param {object[]} sets      the console's question sets (GET /admin/question-sets)
 */
function numbered(items) {
  let n = 0;
  return items.map((it) => (it.type === rules.BREAK ? null : (n += 1)));
}

export default function EventItemDialog({
  code, mode, type, item = null, items = [], sets = [], onClose, onSaved, onRemoved,
}) {
  const editing = mode === 'edit';
  const unreadable = editing && Boolean(item && item.decryptFailed);
  const isBreak = type === rules.BREAK;
  const picking = !editing && rules.isEngagement(type);
  const numbers = numbered(items);
  const label = rules.TYPE_LABELS[type] || 'item';

  const [baseline] = useState(() => ({
    title: editing ? item.title : (isBreak ? 'Break' : ''),
    minutes: String(editing ? item.minutes : 15),
    description: editing ? item.description : '',
    position: items.length,
    setKey: '',
  }));
  const [title, setTitle] = useState(baseline.title);
  const [titleTouched, setTitleTouched] = useState(editing);
  const [minutes, setMinutes] = useState(baseline.minutes);
  const [description, setDescription] = useState(baseline.description);
  const [position, setPosition] = useState(baseline.position);
  const [setKey, setSetKey] = useState(baseline.setKey);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const keyOf = (s) => `${s.scope || 'platform'}|${s.id}`;
  const candidates = picking
    ? sets.filter((s) => s.active !== false && !s.decryptFailed && rules.canonicalSetType(s.engagementType) === type)
    : [];
  const needle = search.trim().toLowerCase();
  const shownSets = needle ? candidates.filter((s) => String(s.name || '').toLowerCase().includes(needle)) : candidates;
  const chosen = candidates.find((s) => keyOf(s) === setKey) || null;
  const hereAt = (s) => {
    const i = items.findIndex((it) => it.setRef && it.setRef.setId === s.id
      && (it.setRef.scope || 'platform') === (s.scope || 'platform'));
    return i >= 0 ? numbers[i] : null;
  };

  const dirty = title !== baseline.title || minutes !== baseline.minutes || description !== baseline.description
    || position !== baseline.position || setKey !== baseline.setKey;

  const requestClose = () => {
    if (busy) return;
    if (dirty && !window.confirm('Close without saving? What you chose will be lost.')) return;
    onClose();
  };

  const choose = (s) => {
    setSetKey(keyOf(s));
    if (!titleTouched) setTitle(s.name || '');
  };

  const submit = async (e) => {
    if (e) e.preventDefault();
    if (unreadable) return;
    if (picking && !chosen) {
      setError('Choose a question set for this item.');
      return;
    }
    const checked = rules.checkItemFields({ title, description, minutes: Number(minutes) }, type);
    if (checked.error) {
      setError(checked.error);
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (editing) {
        await updateItem(code, item.itemId, checked.value);
      } else {
        await addItem(code, {
          type,
          ...checked.value,
          // The default "goes after the last item" is not sent at all — the
          // server appends when `position` is absent (carried note: never
          // null, never items.length).
          ...(position === items.length ? {} : { position }),
          ...(chosen ? {
            setRef: {
              scope: chosen.scope || 'platform', orgId: chosen.orgId || '', setId: chosen.id,
              version: chosen.activeVersion === undefined ? null : chosen.activeVersion,
            },
          } : {}),
        });
      }
      onSaved();
    } catch (err) {
      // Everything chosen stays: the host reads the reason and decides.
      setError(err.message || 'The item was not saved.');
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError('');
    try {
      await removeItem(code, item.itemId);
      onRemoved(item.itemId);
    } catch (err) {
      setError(err.message || 'The item was not removed.');
      setBusy(false);
      setConfirmingRemove(false);
    }
  };

  const heading = unreadable
    ? 'This item could not be read'
    : (editing ? `Edit ${isBreak ? 'break' : label}` : (isBreak ? 'Add a break' : `Add ${label}`));

  return (
    <Modal
      overlayClassName="evb evb-scrim"
      contentClassName={`evb-modal${picking ? ' evb-modal--wide' : ''}`}
      labelledBy="evb-item-title"
      onClose={requestClose}
      closeOnBackdrop={() => !dirty && !busy}
      closeOnEscape={() => !dirty && !busy}
      theme="dark"
    >
      <form onSubmit={submit} noValidate>
        <header className="evb-modal-head">
          <div className="evb-grow">
            <h2 id="evb-item-title">{heading}</h2>
            <p>
              {unreadable && 'Its title and description could not be opened, so it cannot be edited. Remove it, and add it again if it is still wanted.'}
              {!unreadable && picking && `Pick the set. It plays as its own ${label} session, started by you, under the event's code.`}
              {!unreadable && !picking && isBreak && 'A return time on the agenda. Not counted, and not billed.'}
              {!unreadable && editing && !isBreak && item.set && item.set.name && (item.set.pinnedMissing
                ? `Pinned to ${item.set.name} · v${item.setRef.version}, which is no longer in the set.`
                : `Plays ${item.set.name}${item.setRef && item.setRef.version ? ` · v${item.setRef.version}` : ''}.`)}
            </p>
          </div>
          <button type="button" className="evb-x" onClick={requestClose} aria-label="Close" title="Close" disabled={busy}>×</button>
        </header>

        <div className="evb-modal-body">
          {!unreadable && (<>
          {picking && (
            <div className="evb-field evb-step">
              <span className="evb-label" id="evb-pick-label">Question set · {label} sets</span>
              <label className="evb-search">
                <Icon name="MagnifyingGlass" weight="bold" size={14} color="currentColor" />
                <input
                  className="evb-input"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={`Search ${label} sets`}
                  aria-label={`Search ${label} sets`}
                />
              </label>
              {candidates.length === 0 ? (
                <p className="evb-hint">No {label} sets yet. Make one in Question sets, then add it here.</p>
              ) : (
                <div className="evb-pick">
                  <table className="evb-pick-tbl" aria-labelledby="evb-pick-label">
                    <thead>
                      <tr>
                        <th className="evb-col-r" aria-label="Pick" />
                        <th>Set</th>
                        <th className="evb-col-plays">Plays</th>
                        <th className="evb-col-qs">Qs</th>
                        <th className="evb-col-here" aria-label="On this agenda" />
                      </tr>
                    </thead>
                    <tbody>
                      {shownSets.map((s) => {
                        const selected = keyOf(s) === setKey;
                        const here = hereAt(s);
                        return (
                          <tr key={keyOf(s)} aria-selected={selected} data-testid="set-row">
                            <td className="evb-col-r">
                              <input type="radio" name="evb-set" checked={selected} onChange={() => choose(s)} aria-label={s.name} />
                            </td>
                            <td title={s.name}>{s.name}</td>
                            <td>
                              <span className="evb-ver">
                                {s.activeVersion ? `v${s.activeVersion} · latest` : 'unversioned'}
                              </span>
                            </td>
                            <td className="evb-col-qs">{s.questionCount || 0}</td>
                            <td>{here && <span className="evb-chip evb-chip--warn">On this agenda · {here}</span>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          <div className="evb-grid evb-step">
            <div className="evb-field evb-span2">
              <label className="evb-label" htmlFor="evb-title">Title on the agenda</label>
              <input
                id="evb-title"
                className="evb-input"
                value={title}
                maxLength={rules.TITLE_MAX}
                onChange={(e) => { setTitle(e.target.value); setTitleTouched(true); }}
              />
            </div>
            <div className="evb-field">
              <label className="evb-label" htmlFor="evb-minutes">Planned length</label>
              <div className="evb-len">
                <input
                  id="evb-minutes"
                  className="evb-input"
                  inputMode="numeric"
                  value={minutes}
                  onChange={(e) => setMinutes(e.target.value.replace(/[^\d]/g, ''))}
                />
                <span className="evb-dim">min</span>
              </div>
            </div>
            {!editing && (
              <div className="evb-field">
                <label className="evb-label" htmlFor="evb-after">Goes after</label>
                <select id="evb-after" className="evb-input" value={position} onChange={(e) => setPosition(Number(e.target.value))}>
                  <option value={0}>At the start</option>
                  {items.map((it, i) => (
                    <option key={it.itemId} value={i + 1}>
                      {numbers[i] ? `${numbers[i]} · ${it.title}` : `Break · ${it.title}`}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="evb-field evb-span4">
              <label className="evb-label" htmlFor="evb-description">
                Description <span className="evb-dim">· on the agenda, before and during the event</span>
              </label>
              <textarea
                id="evb-description"
                className="evb-input evb-textarea"
                value={description}
                maxLength={rules.DESCRIPTION_MAX}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>
          <p className="evb-hint">
            The title and description are what the room sees, and every phone, laptop or tablet that joins.
            {picking && ' The set’s own name stays in the console.'}
          </p>
          </>)}
          {error && <p className="evb-error" role="alert">{error}</p>}
        </div>

        <footer className="evb-modal-foot">
          {editing && confirmingRemove ? (
            <div className="evb-confirm" data-testid="remove-confirm">
              <p>
                {unreadable ? 'Remove this item from the agenda?' : `Remove “${item.title}” from the agenda?`} The times after it move up.
              </p>
              <button type="button" className="evb-btn" onClick={() => setConfirmingRemove(false)} disabled={busy}>Keep it</button>
              <button type="button" className="evb-btn evb-btn--ghostdanger" onClick={remove} disabled={busy}>Remove</button>
            </div>
          ) : (
            <>
              {editing && (
                <button type="button" className="evb-btn evb-btn--ghostdanger" onClick={() => setConfirmingRemove(true)} disabled={busy}>
                  Remove from agenda
                </button>
              )}
              <button type="button" className="evb-btn" onClick={requestClose} disabled={busy}>Close</button>
              <span className="evb-grow" />
              {!unreadable && (
                <button type="submit" className="evb-btn evb-btn--primary" disabled={busy}>
                  {busy ? 'Saving…' : (editing ? 'Save' : 'Add to agenda')}
                </button>
              )}
            </>
          )}
        </footer>
      </form>
    </Modal>
  );
}
