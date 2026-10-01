import React, { useEffect, useRef, useState } from 'react';
import Modal from './Modal';
import Icon from './Icon';
import SessionOptions, { SessionCategories, SessionBriefing } from './SessionOptions';
import rules from '../../../lambda-functions/websocket/events/agenda-rules';
import goalRules from '../../../lambda-functions/websocket/session-goal';
import { NAMES_DEFAULT, namesMode } from '../config/surveyNames';
import {
  addItem, updateItem, removeItem, signDeckUpload, putDeckFile,
} from '../utils/eventsApi';
import { countPages } from '../utils/pdfDeck';
import { listPersonas, listSetCategories } from '../utils/sessionSetupApi';
import {
  hasRunningOrder, offersRunningOrder, runningOrderHref, RUNNING_ORDER_LABEL,
} from '../config/runningOrder';
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
 *   mode 'add', a presentation      04-add-presentation's form: title,
 *                                   presenter, length, description, and its
 *                                   slides as one PDF (below)
 *   mode 'add', an activity         the same form, led by "Led by" — the
 *                                   owner's "custom choice" (events M1b)
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
 * menu's own sentence and the choices here are KEPT (03's last note). Any 404
 * or 409 also asks the builder to reload the agenda (`onRefused`); the dialog
 * stays open on the reloaded rows, and "Goes after" follows the row it named.
 *
 * WHO LEADS IT (events M1b). Every kind but a break has one optional name,
 * labelled for its kind — Facilitator, Presenter or Led by
 * (agenda-rules.ledByLabel) — sent as `ledBy`. An add sends it only when a
 * name was typed; an edit always sends it, so it can be cleared. An
 * engagement's "Title on the agenda" is also what its session is called when
 * roadmap M3 starts it, and the field says so.
 *
 * A PRESENTATION'S SLIDES (the owner, 27 Sep 2026: "can the presentation show
 * pdf presentation with arrow key forward/backward through the pages?"). One
 * optional PDF, up to 50 MB. Choosing it checks it here (agenda-rules
 * checkDeckFile), counts its pages with pdf.js — a file pdf.js cannot open is
 * refused before a byte moves — and uploads it at once, straight to storage
 * through a signed URL, with its progress; Save then names the upload
 * (`deck: { key, name, pages }`) and the server proves it a PDF. An item that
 * has slides offers Replace and Remove PDF; neither lands until Save, so
 * Close without saving leaves the slides as they were. While a file is
 * uploading, Save waits.
 *
 * EVERY SESSION OPTION (events M1b; owner: "all of the options that you get
 * when setting up each engagement"). Once an engagement's set is chosen, the
 * dialog renders the create dialog's own options — SessionCategories,
 * SessionBriefing (Call & Answer) and the SessionOptions fold, never a copy —
 * wrapped in the `.gsd` scope whose tokens they wear. What they say travels as
 * `settings`, under the create payload's own keys, for exactly the keys the
 * format has (agenda-rules.settingsFor); an edit seeds from the item's own. The
 * goal is bounded by the pinned version's size, and Add waits while Workie is
 * still drafting a briefing.
 *
 * THE RUNNING ORDER (QA drive 2026-09-29, finding #4). The options offer
 * only the shuffle switch; choosing the order itself happens on the
 * item's stage (Session → Questions). An edit of a trivia, Call & Answer,
 * poll or wavelength item says so and links there, in a new tab
 * (config/runningOrder.js) — and says the one catch: saving an edit starts
 * the item's preview afresh (items.js lets a prepared session go), so the
 * order goes with it. An add says where the door will be once it is added.
 *
 * @param {string}   code      the event
 * @param {'add'|'edit'} mode
 * @param {string}   type      the item's kind (agenda-rules.ITEM_TYPES)
 * @param {object}   [item]    edit: the item, as GET /events/{code} gives it
 * @param {object[]} items     the agenda now, in order — for "Goes after" and
 *                             "On this agenda"
 * @param {object[]} sets      the console's question sets (GET /admin/question-sets)
 * @param {Function} [onRefused] (error) => void — a 404 or 409 refusal: the
 *                             builder reloads the agenda, and this dialog
 *                             stays open and reads the new `items`
 */
const AT_START = 'AT_START';
const AT_END = 'AT_END';

/** The headings that are not "Add <Kind>" / "Edit <Kind>" (04 draws "Add a presentation"). */
const HEADINGS = {
  [rules.PRESENTATION]: ['Add a presentation', 'Edit presentation'],
  [rules.CUSTOM]: ['Add an activity', 'Edit activity'],
  [rules.BREAK]: ['Add a break', 'Edit break'],
};

function numbered(items) {
  let n = 0;
  return items.map((it) => (it.type === rules.BREAK ? null : (n += 1)));
}

export default function EventItemDialog({
  code, mode, type, item = null, items = [], sets = [], onClose, onSaved, onRemoved, onRefused,
}) {
  const editing = mode === 'edit';
  const unreadable = editing && Boolean(item && item.decryptFailed);
  const isBreak = type === rules.BREAK;
  const picking = !editing && rules.isEngagement(type);
  const numbers = numbered(items);
  const label = rules.TYPE_LABELS[type] || 'item';
  const leads = rules.hasLeader(type);
  const leaderLabel = rules.ledByLabel(type);

  const [baseline] = useState(() => ({
    title: editing ? item.title : (isBreak ? 'Break' : ''),
    minutes: String(editing ? item.minutes : 15),
    description: editing ? item.description : '',
    ledBy: editing ? (item.ledBy || '') : '',
    after: AT_END,
    setKey: '',
  }));
  const [title, setTitle] = useState(baseline.title);
  const [titleTouched, setTitleTouched] = useState(editing);
  const [minutes, setMinutes] = useState(baseline.minutes);
  const [description, setDescription] = useState(baseline.description);
  const [ledBy, setLedBy] = useState(baseline.ledBy);
  /* "Goes after" is held as WHICH ROW it follows — AT_START, AT_END or that
     row's itemId — never as an index. An index is only true of the agenda it
     was read from; after a refusal the builder reloads (onRefused) and a
     co-host's insert would shift it. The position sent is worked out from the
     agenda as it is at the moment of sending (final review M2). */
  const [after, setAfter] = useState(baseline.after);
  const [setKey, setSetKey] = useState(baseline.setKey);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  /* THE SLIDES (a presentation only). `deckChange` is undefined while the
     host has not touched them, null once they chose Remove PDF, and the new
     upload once one has landed; `deckWork` is a file being read or sent. */
  const slidesField = rules.hasDeck(type) && !unreadable;
  const [deckChange, setDeckChange] = useState(undefined);
  const [deckWork, setDeckWork] = useState(null);
  const [deckError, setDeckError] = useState('');
  const fileRef = useRef(null);
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);
  const deckBefore = editing && item.deck && item.deck.pages ? item.deck : null;
  const deckShown = deckChange === undefined ? deckBefore : deckChange;

  /* THE SESSION OPTIONS (events M1b). `options` holds SessionOptions' keys;
     the categories and the briefing are held beside it, as the create dialog
     holds them. An edit seeds from the item's settings; an item added before
     M1b has none, and reads as the create dialog's defaults. */
  const engagement = rules.isEngagement(type);
  const isSurvey = type === 'survey';
  const seeded = rules.settingsFor(type, editing ? item.settings : {});
  const [options, setOptions] = useState(() => ({
    anonymousResponses: seeded.anonymousResponses !== false,
    randomizeQuestions: seeded.randomizeQuestions !== false,
    names: seeded.names || NAMES_DEFAULT,
    target: seeded.target === undefined ? null : seeded.target,
    personaId: seeded.personaId || '',
    promptId: seeded.promptId || '',
    aiContext: seeded.aiContext || '',
    eventDetails: seeded.eventDetails || '',
  }));
  const [chosenCats, setChosenCats] = useState(() => new Set(seeded.categoryIds || []));
  const [briefing, setBriefing] = useState(seeded.briefing || null);
  const [briefingWorking, setBriefingWorking] = useState(false);
  const [namesTouched, setNamesTouched] = useState(editing);
  const [personas, setPersonas] = useState([]);
  const [categories, setCategories] = useState([]);

  const keyOf = (s) => `${s.scope || 'platform'}|${s.id}`;
  const candidates = picking
    ? sets.filter((s) => s.active !== false && !s.decryptFailed && rules.canonicalSetType(s.engagementType) === type)
    : [];
  const needle = search.trim().toLowerCase();
  const shownSets = needle ? candidates.filter((s) => String(s.name || '').toLowerCase().includes(needle)) : candidates;
  const chosen = candidates.find((s) => keyOf(s) === setKey) || null;

  /* The set the options are about: the one chosen in the picker, or the one
     an edited item pins. Its size bounds the goal — the pinned version's own
     count on an edit (event-store.describeSet), the picked version's on an
     add. Its VERSION (fix round 1) is what the categories are read at too:
     an edited item's categories must come from the version it PLAYS, not
     whatever the set has been replaced by since — the pinned version on an
     edit, the version about to be pinned on an add. */
  const optionsSet = editing
    ? (item.setRef ? { setId: item.setRef.setId, scope: item.setRef.scope || 'platform', version: item.setRef.version } : null)
    : (chosen ? { setId: chosen.id, scope: chosen.scope || 'platform', version: chosen.activeVersion } : null);
  const questionCount = editing
    ? Number(item.set && item.set.questionCount) || 0
    : Number(chosen && chosen.questionCount) || 0;
  const setPromptId = editing
    ? ((sets.find((s) => item.setRef && s.id === item.setRef.setId && (s.scope || 'platform') === (item.setRef.scope || 'platform')) || {}).promptId || '')
    : ((chosen && chosen.promptId) || '');
  const showOptions = engagement && !unreadable && Boolean(optionsSet);
  const optionsKey = optionsSet ? `${optionsSet.scope}|${optionsSet.setId}|${optionsSet.version ?? ''}` : '';
  const goalProblem = engagement && !isSurvey
    ? (goalRules.checkTarget(options.target, questionCount).error || '')
    : '';

  // Both fetches are gated on `showOptions` (fix round 1): an unreadable
  // item's options are never shown, and neither list is anyone's business
  // to fetch for it.
  useEffect(() => {
    if (!showOptions) return undefined;
    let live = true;
    listPersonas(type).then((list) => { if (live) setPersonas(list); });
    return () => { live = false; };
  }, [showOptions, type]);

  useEffect(() => {
    if (!showOptions || isSurvey) return undefined;
    let live = true;
    listSetCategories(optionsSet.setId, optionsSet.scope, optionsSet.version).then((list) => { if (live) setCategories(list); });
    return () => { live = false; };
  }, [showOptions, optionsKey, isSurvey]); // eslint-disable-line react-hooks/exhaustive-deps

  /** The settings this item stores: only the keys its format has. Category
      ids are SORTED (fix round 1) so toggling one off and back on again is
      not a change — a Set's own iteration order is insertion order, and
      without this a no-op toggle would trip `dirty` and reorder what is sent. */
  const settingsNow = () => rules.settingsFor(type, {
    ...options,
    categoryIds: Array.from(chosenCats).sort(),
    briefing: briefing && briefing.text && briefing.text.trim() ? briefing : null,
  });
  const [settingsBaseline] = useState(() => JSON.stringify(settingsNow()));
  const toggleCategory = (name) => setChosenCats((prev) => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });
  const changeOptions = (patch) => {
    if ('names' in patch) setNamesTouched(true);
    setOptions((prev) => ({ ...prev, ...patch }));
  };

  const hereAt = (s) => {
    const i = items.findIndex((it) => it.setRef && it.setRef.setId === s.id
      && (it.setRef.scope || 'platform') === (s.scope || 'platform'));
    return i >= 0 ? numbers[i] : null;
  };

  const dirty = title !== baseline.title || minutes !== baseline.minutes || description !== baseline.description
    || ledBy !== baseline.ledBy || after !== baseline.after || setKey !== baseline.setKey
    || (engagement && JSON.stringify(settingsNow()) !== settingsBaseline) || briefingWorking
    || deckChange !== undefined || Boolean(deckWork);

  const requestClose = () => {
    if (busy) return;
    if (dirty && !window.confirm('Close without saving? What you chose will be lost.')) return;
    onClose();
  };

  /* A 404 (the item, or the event, is gone) or a 409 (the agenda changed,
     or a cap was reached) means the agenda behind this dialog is out of
     date: the builder reloads it, and this dialog stays open with every
     choice kept (03's last note), now reading the reloaded `items`. */
  const refused = (err) => {
    if (onRefused && err && (err.status === 404 || err.status === 409)) onRefused(err);
  };

  /* A PDF chosen: checked, counted, uploaded — in that order, and each refusal
     said in the field's own words before anything is sent. */
  const takeFile = async (file) => {
    if (!file) return;
    const checked = rules.checkDeckFile(file);
    if (checked.error) {
      setDeckError(checked.error);
      return;
    }
    const { name } = checked.value;
    setDeckError('');
    setDeckWork({ name, reading: true, progress: 0 });
    try {
      let pages;
      try {
        pages = await countPages(file);
      } catch (_) {
        throw new Error(`“${name}” could not be opened as a PDF. Save it as a PDF again, then choose it.`);
      }
      if (!live.current) return;
      const fields = rules.checkDeckFields({ key: 'pending', name, pages });
      if (fields.error) throw new Error(fields.error);
      setDeckWork({ name, reading: false, progress: 0 });
      const { upload } = await signDeckUpload(code, file);
      await putDeckFile(upload, file, (progress) => {
        if (live.current) setDeckWork({ name, reading: false, progress });
      });
      if (live.current) setDeckChange({ key: upload.key, name, pages, bytes: file.size });
    } catch (err) {
      if (live.current) setDeckError((err && err.message) || 'The PDF did not upload. Try again.');
    } finally {
      if (live.current) setDeckWork(null);
    }
  };

  const choose = (s) => {
    const changed = keyOf(s) !== setKey;
    setSetKey(keyOf(s));
    if (!titleTouched) setTitle(s.name || '');
    if (changed) {
      // A different set has different categories; its goal bound moves too.
      setChosenCats(new Set());
      setCategories([]);
      // A survey set may carry its own Names default — it seeds the choice
      // until the host picks, as the create dialog does.
      if (isSurvey && !namesTouched) {
        setOptions((prev) => ({ ...prev, names: namesMode(s.namesDefault).id }));
      }
    }
  };

  const submit = async (e) => {
    if (e) e.preventDefault();
    if (briefingWorking) return; // The button disables, but Enter in a field still submits the form.
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
    const leader = rules.checkLedBy(ledBy, type);
    if (leader.error) {
      setError(leader.error);
      return;
    }
    if (goalProblem) {
      setError(goalProblem);
      return;
    }
    const settings = engagement ? { settings: settingsNow() } : {};
    // The slides, only when they changed: a new upload by its key, or null to
    // take them off. An add never sends null.
    const slides = deckChange === undefined || (!editing && !deckChange) ? {} : {
      deck: deckChange ? { key: deckChange.key, name: deckChange.name, pages: deckChange.pages } : null,
    };
    let position = null;
    if (!editing && after !== AT_END) {
      const anchor = after === AT_START ? -1 : items.findIndex((it) => it.itemId === after);
      if (after !== AT_START && anchor < 0) {
        // The row it was to follow went in the reload. Never guess a place.
        setAfter(AT_END);
        setError('The item this was to go after is no longer on the agenda. Choose where it goes.');
        return;
      }
      position = anchor + 1;
    }
    setBusy(true);
    setError('');
    try {
      if (editing) {
        await updateItem(code, item.itemId, {
          ...checked.value, ...(leads ? { ledBy: leader.value } : {}), ...settings, ...slides,
        });
      } else {
        await addItem(code, {
          type,
          ...checked.value,
          ...(leads && leader.value ? { ledBy: leader.value } : {}),
          // The default "goes after the last item" is not sent at all — the
          // server appends when `position` is absent (carried note: never
          // null, never items.length).
          ...(position === null ? {} : { position }),
          ...(chosen ? {
            setRef: {
              scope: chosen.scope || 'platform', orgId: chosen.orgId || '', setId: chosen.id,
              version: chosen.activeVersion === undefined ? null : chosen.activeVersion,
            },
          } : {}),
          ...settings,
          ...slides,
        });
      }
      onSaved();
    } catch (err) {
      // Everything chosen stays: the host reads the reason and decides.
      setError(err.message || 'The item was not saved.');
      setBusy(false);
      refused(err);
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
      refused(err);
    }
  };

  /* The select's value: 0 is "At the start", i + 1 is "after items[i]". At
     the end (the default) shows as after the last row, whatever the last row
     now is. */
  const afterIndex = (() => {
    if (after === AT_START) return 0;
    const i = after === AT_END ? -1 : items.findIndex((it) => it.itemId === after);
    return i >= 0 ? i + 1 : items.length;
  })();

  const heading = unreadable
    ? 'This item could not be read'
    : (HEADINGS[type] || [`Add ${label}`, `Edit ${label}`])[editing ? 1 : 0];

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
              {!unreadable && type === rules.PRESENTATION && 'A talk. Add its slides as a PDF and the stage shows them, a slide at a time.'}
              {!unreadable && type === rules.CUSTOM && 'Anything else on the day: networking, lunch with a speaker, an open discussion. It sits on the agenda, with nothing to answer.'}
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
                aria-describedby={rules.isEngagement(type) ? 'evb-title-hint' : undefined}
              />
              {rules.isEngagement(type) && (
                <span className="evb-hint" id="evb-title-hint">
                  Also the session’s name on the stage when you start it.
                </span>
              )}
            </div>
            {leads && (
              <div className="evb-field evb-span2">
                <label className="evb-label" htmlFor="evb-ledby">
                  {leaderLabel} <span className="evb-dim">· optional</span>
                </label>
                <input
                  id="evb-ledby"
                  className="evb-input"
                  value={ledBy}
                  maxLength={rules.LED_BY_MAX}
                  placeholder="Their name"
                  onChange={(e) => setLedBy(e.target.value)}
                />
              </div>
            )}
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
                <select
                  id="evb-after"
                  className="evb-input"
                  value={afterIndex}
                  onChange={(e) => {
                    const i = Number(e.target.value);
                    setAfter(i === 0 ? AT_START : items[i - 1].itemId);
                  }}
                >
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
            {slidesField && (
              <div className="evb-field evb-span4" data-testid="item-slides">
                <span className="evb-label" id="evb-deck-label">
                  Slides <span className="evb-dim">· optional, one PDF</span>
                </span>
                <div className="evb-deck" role="group" aria-labelledby="evb-deck-label">
                  {deckWork ? (
                    <>
                      <Icon name="FilePdf" weight="bold" size={18} color="currentColor" />
                      <span className="evb-deck-name" title={deckWork.name}>{deckWork.name}</span>
                      <span className="evb-deck-meta" role="status">
                        {deckWork.reading ? 'Reading the PDF…' : `Uploading… ${Math.round(deckWork.progress * 100)}%`}
                      </span>
                    </>
                  ) : deckShown ? (
                    <>
                      <Icon name="FilePdf" weight="bold" size={18} color="currentColor" />
                      <span className="evb-deck-name" title={deckShown.name}>{deckShown.name || 'Slides'}</span>
                      <span className="evb-deck-meta">
                        {rules.slidesLabel(deckShown.pages)}
                        {deckShown.bytes ? ` · ${rules.formatBytes(deckShown.bytes)}` : ''}
                        {deckChange ? ' · not saved yet' : ''}
                      </span>
                      <span className="evb-deck-acts">
                        <button type="button" className="evb-btn evb-btn--sm" onClick={() => fileRef.current && fileRef.current.click()} disabled={busy}>
                          Replace
                        </button>
                        <button type="button" className="evb-btn evb-btn--sm" onClick={() => { setDeckError(''); setDeckChange(deckBefore ? null : undefined); }} disabled={busy}>
                          Remove PDF
                        </button>
                      </span>
                    </>
                  ) : (
                    <>
                      <button type="button" className="evb-btn" onClick={() => fileRef.current && fileRef.current.click()} disabled={busy}>
                        <Icon name="FilePdf" weight="bold" size={15} color="currentColor" /> Choose a PDF
                      </button>
                      <span className="evb-deck-meta">
                        {deckChange === null ? 'The slides come off when you save.' : `Up to ${rules.formatBytes(rules.DECK_MAX_BYTES)}.`}
                      </span>
                    </>
                  )}
                  <input
                    ref={fileRef}
                    type="file"
                    accept="application/pdf,.pdf"
                    hidden
                    data-testid="deck-file"
                    aria-label="Choose a PDF of the slides"
                    onChange={(e) => {
                      const file = e.target.files && e.target.files[0];
                      e.target.value = '';
                      takeFile(file);
                    }}
                  />
                </div>
                <span className="evb-hint">
                  PowerPoint, Keynote and Google Slides all save as PDF. On the stage, ← and → (or a clicker) turn the slides.
                </span>
                {deckError && <p className="evb-error" role="alert">{deckError}</p>}
              </div>
            )}
          </div>
          <p className="evb-hint">
            {leads
              ? 'The title, the description and the name are what the room sees, and every phone, laptop or tablet that joins.'
              : 'The title and description are what the room sees, and every phone, laptop or tablet that joins.'}
            {picking && ' The set’s own name stays in the console.'}
          </p>
          {showOptions && (
            /* THE CREATE DIALOG'S OWN OPTIONS, never a copy
               (components/SessionOptions.jsx), in the `.gsd` scope whose
               tokens they wear — the same dusk card and field this dialog's
               surface is (sessionOptionsPalette.test.js). */
            <div className="gsd evb-sopts" data-testid="item-session-options">
              {!isSurvey && (categories.length > 0 ? (
                <SessionCategories
                  idPrefix="evb-so"
                  categories={categories}
                  selected={chosenCats}
                  onToggle={toggleCategory}
                />
              ) : chosenCats.size > 0 && (
                /* An empty list here is NOT "every category" (fix round 1):
                   this item already narrowed its categories, and a fetch
                   that has not come back must not read as though the grid
                   had confirmed sending them all. */
                <p className="evb-hint" data-testid="evb-so-categories-unavailable">
                  This item plays only the categories chosen before; the list could not be loaded.
                </p>
              ))}
              {type === 'call-and-answer' && (
                <SessionBriefing value={briefing} onChange={setBriefing} onWorkingChange={setBriefingWorking} />
              )}
              {options.personaId && personas.length === 0 && (
                /* Same honesty for a stored voice the persona list cannot
                   confirm (fix round 1) — the select still carries it. */
                <p className="evb-hint" data-testid="evb-so-persona-unavailable">
                  This item plays the voice chosen before; the list of voices could not be loaded.
                </p>
              )}
              <SessionOptions
                idPrefix="evb-so"
                gameType={type}
                value={options}
                onChange={changeOptions}
                personas={personas}
                setPromptId={setPromptId}
                namesDefault={!editing && chosen ? chosen.namesDefault : ''}
                questionCount={questionCount}
              />
            </div>
          )}
          {editing && offersRunningOrder(item) && (
            <div className="evb-field evb-order" data-testid="item-running-order">
              <span className="evb-label" id="evb-order-label">Running order</span>
              <p className="evb-hint" id="evb-order-hint">
                Choose which questions come first, and in what order, on its stage: Session → Questions.
                {' '}Changing the question set or its session options afterwards starts its preview afresh and clears that order. The title, description and length can change any time.
              </p>
              <a
                className="evb-btn evb-btn--sm"
                href={runningOrderHref(code, item)}
                target="_blank"
                rel="noopener noreferrer"
                aria-describedby="evb-order-hint"
                title="Opens its stage in a new tab, on the running order"
              >
                <Icon name="ListNumbers" weight="bold" size={13} color="currentColor" /> {RUNNING_ORDER_LABEL}
              </a>
            </div>
          )}
          {!editing && hasRunningOrder(type) && (
            <p className="evb-hint" data-testid="item-running-order-later">
              To choose which questions come first, use <b>Order</b> on its row once it is on the agenda.
            </p>
          )}
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
                <button
                  type="submit"
                  className="evb-btn evb-btn--primary"
                  disabled={busy || briefingWorking || Boolean(deckWork)}
                  title={briefingWorking ? 'Waiting for Workie to finish the briefing'
                    : deckWork ? 'Waiting for the PDF to finish uploading' : undefined}
                >
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
