import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { authFetch } from '../auth/authFetch';
import Icon from './Icon';
import Modal from './Modal';
import { DialogHead, DialogFoot } from './ui/DialogParts';
import StatusMessage from './StatusMessage';
import ListControls from './ListControls';
import useListControls from '../hooks/useListControls';
import { GAME_TYPE_LIST, gameTypeLabel } from '../config/gameTypes';
import { formatWhen } from '../config/tableCells';
import { setTopicLabel } from '../config/setTopics';
import { nextTier } from '../config/tierHosts';
import { archiveGameType } from '../utils/archiveFiltering';
import {
  TIERS,
  archiveTier,
  archiveScope,
  displayTags,
  groupSnapshots,
  selectionKey,
  exportSelection,
  describeExport,
  describeRestore,
  formatExported,
  lastBackups,
  relativeTime,
  PICKER_SORTS,
  pickerRows,
  describePlanEntry,
  restoreChecks,
  checkCount,
} from '../utils/archiveItems';
import { promoteLink, readPromotion, withoutPromotion } from '../utils/archivePromotion';
import './ArchivePanel.css';

/**
 * THE ARCHIVE SCREEN — backups of Engage's library and the public library, shared by every tier.
 *
 * Built to docs/design/admin-redesign/20-archive.html and 21-archive-down.html, on the idiom
 * every library screen shares: one table, the ListControls bar with drop-exits, and Modal
 * confirms that state the consequence. The three tabs and the two card grids they rendered
 * are gone — RATIONALE §10: "Cards for the archive. Rejected. 214 items."
 *
 * Every call goes to this tier's own routes: `admin/archive/*` (admin/archive-items.js) and the
 * export and import routes. Nothing calls the archive service itself. The archive accepts only
 * signed AWS requests, and who may use it is decided by the tier's own sign-in. See
 * docs/superpowers/specs/2026-09-14-archive-full-fidelity-design.md §4.7.
 *
 * WHICH ENVIRONMENT IS THE FIRST QUESTION. Every tier reads every tier's backups, so each row
 * says where it came from, the list filters by it, and an import names the environment it is
 * about to write to before anything happens.
 *
 * ONE OVERRIDE OF THE MOCKUP, ARGUED HERE. 20-archive.html carries a note headed "Importing is
 * not a copy" about the CSV era's losses. Since the full-fidelity snapshots of 2026-09-15 a
 * set survives the archive both ways, and the same-name behaviour the mockup calls
 * unimplemented — write it as a new version of the existing set — is exactly what import does.
 * The note would be a lie now, so the panel under the table states what actually happens.
 *
 * FILTERING IS THE BROWSER'S. The list is read once and filtered in memory through
 * config/listControls.js, like Question sets and Sessions; the tier's `?type=` and `search`
 * routes stay for other callers. At the archive's size a round trip per filter buys nothing.
 *
 * AN OUTAGE IS NOT AN EMPTY ARCHIVE (21). A failed load used to set the list to [] and render
 * "No archive items found" — on a promotion tool, the difference between "wait" and "nothing
 * was ever exported". A request that never got an answer renders the outage state, with the
 * request that failed and the way to move a set by hand meanwhile.
 *
 * PROMOTION (docs/design/archive-promotion/REVIEW.md, improvements 1–5). The tiers share only
 * the archive, so "Promote to test…" is an export here plus a link to the next tier's Archive
 * carrying the batch (utils/archivePromotion.js). Arriving on that link selects exactly that
 * batch and opens the restore dialog, which starts with a dry run: per item, a new set or a
 * new version of the live one, its counts, and whether it arrives active. After a restore each
 * set is read back and its counts are shown beside the snapshot's, and `onRestored` refreshes
 * the console's own list of sets so Shared library shows them without a fresh sign-in. On prod
 * the confirm names PROD and asks for the word typed: it is the write every customer sees.
 */
const archiveRoute = (suffix) => `${window.API_BASE}admin/archive/${suffix}`;
const importRoute = () => `${window.API_BASE}admin/import-from-archive`;
const readBody = (response) => response.json().catch(() => ({}));
const libraryLabel = (scope) => (scope === 'public' ? 'Public library' : 'Engage library');
/** A status the archive service itself returns when it is not there to answer. */
const isOutage = (status) => [0, 502, 503, 504].includes(Number(status));
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
/** A restored set's own address in the console: Shared library with that set open (AdminPage `?set=`). */
const setHref = (id) => `/admin?section=questionsets&set=${encodeURIComponent(id)}&setScope=platform`;

const formatFileSize = (bytes) => {
  if (!bytes) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
};

/*
  The three axes of 20-archive.html. `all: ''` on each so the "All …" option
  value is the empty string — what the selects have always carried, and what
  every test drives them with.
*/
const LIST_CONFIG = {
  searchFields: ['Title', 'Description', (item) => displayTags(item)],
  axes: {
    tier: { all: '', get: (item) => archiveTier(item) || 'unknown' },
    type: { all: '', get: (item) => (item.ContentType === 'prompt' ? 'prompt' : 'questionset') },
    gameType: { all: '', get: (item) => archiveGameType(item) || '' },
  },
};
const DROP_LABELS = {
  search: (needle) => `Search “${needle}”`,
  tier: (value) => `Environment: ${value}`,
  type: (value) => `Type: ${value === 'prompt' ? 'Prompts' : 'Question sets'}`,
  gameType: (value) => `Engagement type: ${gameTypeLabel(value)}`,
};

const ArchivePanel = ({ environment, onRestored }) => {
  const tierName = environment && environment.id && environment.id !== 'unknown' ? environment.id : 'this environment';
  const tier = TIERS.includes(environment && environment.id) ? environment.id : '';
  const isProd = tier === 'prod';
  const promoteTo = nextTier(tier);
  const [items, setItems] = useState([]);
  // 'loading' | 'ready' | 'down' — and 'down' carries why, so the outage screen can say so.
  const [loadState, setLoadState] = useState('loading');
  const [downReason, setDownReason] = useState('');
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const [report, setReport] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  // One dialog at a time: { kind: 'import' } | { kind: 'export' } | { kind: 'delete', item }.
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(null);
  // The export dialog's own loads and picks.
  const [localSets, setLocalSets] = useState([]);
  const [localPrompts, setLocalPrompts] = useState([]);
  const [localPending, setLocalPending] = useState(0);
  const [pickedSets, setPickedSets] = useState(() => new Set());
  const [pickedPrompts, setPickedPrompts] = useState(() => new Set());
  const [pickSearch, setPickSearch] = useState('');
  const [pickSort, setPickSort] = useState('name');
  // The restore dialog's dry run: { state: 'loading' | 'ready' | 'error', plan, failed, error }.
  const [plan, setPlan] = useState(null);
  const planRequest = useRef(0);
  const [typed, setTyped] = useState('');
  // What the last export or restore handed on: the archive ids, and where they can go next.
  const [exportResult, setExportResult] = useState(null);
  const [restoreResult, setRestoreResult] = useState(null);
  const [copied, setCopied] = useState(false);
  // Arrived on a promotion link: read once, consumed once the list is in.
  const [incoming] = useState(() => (typeof window !== 'undefined' ? readPromotion(window.location.search) : null));
  const incomingDone = useRef(false);
  const [promoBanner, setPromoBanner] = useState(null);

  const {
    state: { search, tier: tierFilter, type, gameType },
    set,
    shown,
    drops,
    activeFilterCount,
    clearOne,
    clearAll,
  } = useListControls(items, LIST_CONFIG, { labels: DROP_LABELS });
  const rows = useMemo(() => groupSnapshots(shown), [shown]);

  const loadArchiveItems = useCallback(async () => {
    setLoadState('loading');
    setError(null);
    setDownReason('');
    try {
      const response = await authFetch(archiveRoute('items'));
      const data = await readBody(response);
      if (!response.ok) {
        if (isOutage(response.status)) {
          setDownReason(`HTTP ${response.status}`);
          setLoadState('down');
          return;
        }
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      setItems(data.items || []);
      setLoadState('ready');
    } catch (err) {
      console.error('Failed to load archive items:', err);
      // A TypeError is the browser saying the request never got an answer —
      // the archive relay is down, not refusing. Anything else is the tier's
      // own words, shown as its own words.
      if (err instanceof TypeError) {
        setDownReason(err.message);
        setLoadState('down');
      } else {
        setError(`Failed to load archive items: ${err.message}`);
        setLoadState('ready');
      }
    }
  }, []);

  useEffect(() => { loadArchiveItems(); }, [loadArchiveItems]);

  const loadLocalContent = async () => {
    setLocalPending((n) => n + 1);
    setError(null);
    try {
      const [setsResponse, promptsResponse] = await Promise.all([
        authFetch(`${window.API_BASE}admin/question-sets`),
        authFetch(`${window.API_BASE}admin/ai-prompts`),
      ]);
      if (setsResponse.ok) setLocalSets((await setsResponse.json()).questionSets || []);
      if (promptsResponse.ok) setLocalPrompts((await promptsResponse.json()).prompts || []);
    } catch (err) {
      console.error('Failed to load local content:', err);
      setError('Failed to load local content. Please try again.');
    } finally {
      setLocalPending((n) => Math.max(0, n - 1));
    }
  };

  // Organisation content is encrypted per organisation and never archived, so it is not offered.
  const exportableSets = useMemo(() => localSets.filter((qs) => (qs.scope || 'platform') !== 'org'), [localSets]);
  // Only Engage's prompts: nothing writes public prompts, and org prompts are never archived.
  const exportablePrompts = useMemo(() => localPrompts.filter((p) => (p.scope || 'platform') === 'platform'), [localPrompts]);

  /*
    THE EXPORT PICKER'S ROWS (improvement 5): searchable by name and id, sortable, and each
    one says whether and when it was last backed up FROM THIS TIER — matched on the snapshot's
    `source:<scope>/<id>` tag in the archive list this panel already holds.
  */
  const lastBacked = useMemo(() => lastBackups(items, tier), [items, tier]);
  const setRows = useMemo(() => exportableSets.map((qs) => ({
    key: selectionKey(qs.scope, qs.id),
    id: qs.id,
    name: qs.name || qs.id,
    type: qs.engagementType ? gameTypeLabel(qs.engagementType) : '',
    last: lastBacked.get(`${qs.scope || 'platform'}/${qs.id}`) || '',
    active: qs.active !== false,
    topic: qs.topic ? setTopicLabel(qs.topic) : '',
    scope: qs.scope,
    totalQuestions: qs.totalQuestions,
  })), [exportableSets, lastBacked]);
  const promptRows = useMemo(() => exportablePrompts.map((prompt) => {
    const id = prompt.promptId || prompt.id;
    return {
      key: id,
      id,
      name: prompt.name || id,
      type: prompt.gameType ? gameTypeLabel(prompt.gameType) : '',
      last: lastBacked.get(`platform/${id}`) || '',
      status: prompt.status || '',
      isDefault: Boolean(prompt.isDefault),
    };
  }), [exportablePrompts, lastBacked]);
  const shownSetRows = useMemo(() => pickerRows(setRows, { search: pickSearch, sort: pickSort }), [setRows, pickSearch, pickSort]);
  const shownPromptRows = useMemo(() => pickerRows(promptRows, { search: pickSearch, sort: pickSort }), [promptRows, pickSearch, pickSort]);
  const now = Date.now();
  const lastLabel = (row) => (row.last ? `Last backed up ${relativeTime(row.last, now)}` : 'Never backed up here');

  const toggleIn = (setter) => (key) => setter((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const toggleSelected = toggleIn(setSelected);
  const togglePickedSet = toggleIn(setPickedSets);
  const togglePickedPrompt = toggleIn(setPickedPrompts);
  /** "Select all" means all SHOWN: a search narrows what it takes, and keeps earlier picks. */
  const pickAllShown = (setter, rowsShown) => setter((current) => new Set([...current, ...rowsShown.map((r) => r.key)]));

  const shownIds = rows.map(({ item }) => item.ArchiveId);
  const allShownSelected = shownIds.length > 0 && shownIds.every((id) => selected.has(id));
  const toggleAllShown = () => setSelected((current) => {
    const next = new Set(current);
    if (allShownSelected) shownIds.forEach((id) => next.delete(id));
    else shownIds.forEach((id) => next.add(id));
    return next;
  });

  const openExport = () => {
    setPickedSets(new Set());
    setPickedPrompts(new Set());
    setPickSearch('');
    setDialog({ kind: 'export' });
    loadLocalContent();
  };
  // Closing drops any preview still on its way: it answers a dialog that is no longer open.
  const closeDialog = () => { if (!busy) { planRequest.current += 1; setDialog(null); } };

  /** Open the restore dialog for these ids, and ask the tier what restoring them would do. */
  const openImport = async (ids) => {
    const selectedItems = [...ids];
    if (selectedItems.length === 0) return;
    setTyped('');
    setError(null);
    setDialog({ kind: 'import' });
    setPlan({ state: 'loading' });
    planRequest.current += 1;
    const asked = planRequest.current;
    try {
      const response = await authFetch(importRoute(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedItems, dryRun: true }),
      });
      const data = await readBody(response);
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      if (asked === planRequest.current) setPlan({ state: 'ready', plan: data.plan || [], failed: data.failed || [] });
    } catch (err) {
      console.error('Restore preview failed:', err);
      if (asked === planRequest.current) setPlan({ state: 'error', error: err.message });
    }
  };

  /*
    A PROMOTION LINK, CONSUMED ONCE. Select exactly the ids that are in the archive, say how
    many came and from where, strip the link from the address (so a reload or Back does not
    reopen the dialog) and go straight to the preview.
  */
  useEffect(() => {
    if (!incoming || incomingDone.current || loadState !== 'ready') return;
    incomingDone.current = true;
    const known = new Set(items.map((item) => item.ArchiveId));
    const found = incoming.ids.filter((id) => known.has(id));
    setSelected(new Set(found));
    setPromoBanner({ count: found.length, asked: incoming.ids.length, from: incoming.from });
    try {
      window.history.replaceState(window.history.state, '', withoutPromotion(window.location.href));
    } catch (_) { /* an address that cannot be rewritten only means a reload asks again */ }
    if (found.length > 0) openImport(found);
  }, [incoming, loadState, items]); // eslint-disable-line react-hooks/exhaustive-deps

  const copyIds = async (ids) => {
    try {
      await navigator.clipboard.writeText(ids.join(','));
      setCopied(true);
    } catch (err) {
      setError('Could not copy to the clipboard. The ids are shown under the button.');
    }
  };

  const handleDownload = async (item) => {
    try {
      const response = await authFetch(archiveRoute(`items/${encodeURIComponent(item.ArchiveId)}`));
      const data = await readBody(response);
      if (!response.ok || !data.downloadUrl) throw new Error(data.error || `HTTP ${response.status}`);
      window.open(data.downloadUrl, '_blank');
    } catch (err) {
      console.error('Download failed:', err);
      setError(`Download failed: ${err.message}`);
    }
  };

  const confirmDelete = async () => {
    const { item } = dialog;
    setBusy('delete');
    setError(null);
    try {
      const response = await authFetch(archiveRoute(`items/${encodeURIComponent(item.ArchiveId)}`), { method: 'DELETE' });
      const data = await readBody(response);
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setNotice(`Deleted the backup "${item.Title}".`);
      setSelected((current) => { const next = new Set(current); next.delete(item.ArchiveId); return next; });
      setDialog(null);
      loadArchiveItems();
    } catch (err) {
      console.error('Delete failed:', err);
      setError(`Delete failed: ${err.message}`);
    } finally {
      setBusy(null);
    }
  };

  // On prod the word is typed before the button wakes. Test and dev confirm with one press.
  const typedOk = !isProd || typed.trim().toLowerCase() === 'prod';
  const planSettled = Boolean(plan) && plan.state !== 'loading';

  const confirmImport = async () => {
    const selectedItems = [...selected];
    if (selectedItems.length === 0 || busy || !typedOk) return;
    setBusy('import');
    setError(null);
    setNotice('');
    setReport([]);
    setRestoreResult(null);
    try {
      const response = await authFetch(importRoute(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedItems }),
      });
      const result = await readBody(response);
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      setReport(describeRestore(result));
      const restoredIds = ((result.results && result.results.successful) || []).map((r) => r.archiveId).filter(Boolean);
      setRestoreResult({ ids: restoredIds, checks: restoreChecks(result) });
      setExportResult(null);
      setPromoBanner(null);
      setSelected(new Set());
      setDialog(null);
      // The console's own list of sets (Shared library) was read before this restore.
      if (onRestored && restoredIds.length > 0) onRestored();
    } catch (err) {
      console.error('Import failed:', err);
      setError(`Import failed: ${err.message}`);
    } finally {
      setBusy(null);
    }
  };

  const exportPicked = async (exportType, { promote = false } = {}) => {
    const selectedItems = exportType === 'questionsets'
      ? exportSelection(pickedSets)
      : [...pickedPrompts].map((id) => ({ scope: 'platform', id }));
    if (selectedItems.length === 0 || busy) return;
    setBusy(promote ? 'promote' : 'export');
    setError(null);
    setNotice('');
    setReport([]);
    setExportResult(null);
    setRestoreResult(null);
    setCopied(false);
    try {
      const response = await authFetch(`${window.API_BASE}admin/export-to-archive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedItems, exportType }),
      });
      const result = await readBody(response);
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      setReport(describeExport(result));
      const ids = ((result.results && result.results.successful) || []).map((r) => r.archiveId).filter(Boolean);
      setExportResult(ids.length ? { ids, promoted: promote } : null);
      setDialog(null);
      loadArchiveItems();
    } catch (err) {
      console.error('Export failed:', err);
      setError(`Export failed: ${err.message}`);
    } finally {
      setBusy(null);
    }
  };

  const count = `${plural(items.length, 'item')}`
    + (shown.length !== items.length ? ` · ${shown.length} shown` : '')
    + (selected.size > 0 ? ` · ${selected.size} selected` : '');
  const nothingExists = loadState === 'ready' && items.length === 0;
  const titleOf = (archiveId) => {
    const found = items.find((item) => item.ArchiveId === archiveId);
    return found ? found.Title : archiveId;
  };

  /** One group of the export picker: its head, its actions, and its rows. */
  const pickGroup = ({ title, all, shownRows, picked, setPicked, toggle, exportType, noun, renderMeta }) => (
    <section className="arch-group">
      <div className="arch-group-head">
        <h3>{title} ({shownRows.length === all.length ? all.length : `${shownRows.length} of ${all.length}`})</h3>
        <div className="arch-group-acts">
          <button type="button" className="arch-btn arch-btn--sm" onClick={() => pickAllShown(setPicked, shownRows)} disabled={shownRows.length === 0}>Select all</button>
          <button type="button" className="arch-btn arch-btn--sm" onClick={() => setPicked(new Set())}>Clear</button>
          <button type="button" className={`arch-btn arch-btn--sm${promoteTo ? '' : ' arch-btn--primary'}`} onClick={() => exportPicked(exportType)} disabled={picked.size === 0 || Boolean(busy)}>
            {busy === 'export' ? 'Backing up…' : `Export ${plural(picked.size, noun)}`}
          </button>
          {promoteTo && (
            <button type="button" className="arch-btn arch-btn--sm arch-btn--primary" onClick={() => exportPicked(exportType, { promote: true })} disabled={picked.size === 0 || Boolean(busy)}>
              {busy === 'promote' ? 'Exporting…' : `Promote to ${promoteTo}…`}
            </button>
          )}
        </div>
      </div>
      <ul className="arch-picklist">
        {shownRows.map((row) => (
          <li key={row.key} data-testid={`archive-pick-${row.id}`}>
            <label>
              <input type="checkbox" aria-label={`Select ${row.name}`} checked={picked.has(row.key)} onChange={() => toggle(row.key)} />
              <span className="arch-pick-main">
                <span className="arch-nm" title={row.name}>{row.name}</span>
                <span className="arch-sub" title={row.id}>{[row.id, row.topic, row.type].filter(Boolean).join(' · ')}</span>
              </span>
              <span className="arch-pick-meta">
                {renderMeta(row)}
                <span className={`arch-dim${row.last ? '' : ' arch-never'}`} data-testid="archive-last">{lastLabel(row)}</span>
              </span>
            </label>
          </li>
        ))}
        {all.length === 0 && <li className="arch-dim arch-pick-empty">No {noun}s here to back up.</li>}
        {all.length > 0 && shownRows.length === 0 && (
          <li className="arch-dim arch-pick-empty">No {noun} matches “{pickSearch}”.</li>
        )}
      </ul>
    </section>
  );

  return (
    <section className="arch">
      {/* No heading of its own: the console's work head already says "Archive" and what it is. */}
      <div className="arch-head">
        <div className="arch-head-grow" />
        <button type="button" className="arch-btn" onClick={openExport} disabled={busy === 'export' || busy === 'promote'}>
          <Icon name="UploadSimple" weight="bold" size={14} color="currentColor" /> Export from {tierName}…
        </button>
        <button
          type="button"
          className="arch-btn arch-btn--primary"
          onClick={() => openImport(selected)}
          disabled={selected.size === 0 || busy === 'import'}
        >
          <Icon name="DownloadSimple" weight="bold" size={14} color="currentColor" /> Import {selected.size} selected
        </button>
      </div>

      <StatusMessage message={error} tone="error" className="arch-alert arch-alert--error" />
      <StatusMessage message={notice} tone="success" className="arch-alert arch-alert--success" />

      {promoBanner && (
        <div className="arch-promo" role="status" data-testid="archive-promotion-banner">
          <Icon name="ArrowRight" weight="bold" size={20} color="var(--secondary)" />
          <div className="arch-grow">
            <strong>
              {plural(promoBanner.count, 'item')} promoted from {promoBanner.from || 'another environment'} — review and restore
            </strong>
            {promoBanner.count < promoBanner.asked && (
              <span className="arch-promo-sub">
                {promoBanner.asked - promoBanner.count} of the {promoBanner.asked} archive ids in the link {promoBanner.asked - promoBanner.count === 1 ? 'is' : 'are'} not in the archive.
              </span>
            )}
          </div>
          {promoBanner.count > 0 && !dialog && (
            <button type="button" className="arch-btn arch-btn--primary" onClick={() => openImport(selected)} disabled={selected.size === 0}>
              Review and restore
            </button>
          )}
        </div>
      )}

      {report.length > 0 && (
        <ul className="arch-report" data-testid="archive-report">
          {report.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}
        </ul>
      )}

      {exportResult && (
        <section className={`arch-next${exportResult.promoted ? ' arch-next--promote' : ''}`} data-testid="archive-export-result">
          {exportResult.promoted && promoteTo && (
            <>
              <h3>{plural(exportResult.ids.length, 'item')} ready for {promoteTo}</h3>
              <p>
                Open {promoteTo}&rsquo;s Archive to review and restore them. You sign in there, and nothing
                changes on {promoteTo} until you confirm.
              </p>
            </>
          )}
          <div className="arch-acts">
            {exportResult.promoted && promoteTo && (
              <a className="arch-btn arch-btn--primary arch-btn--big" href={promoteLink(promoteTo, exportResult.ids, tier)} target="_blank" rel="noopener noreferrer">
                Open {promoteTo}&rsquo;s Archive <Icon name="ArrowSquareOut" weight="bold" size={14} color="currentColor" />
              </a>
            )}
            <button type="button" className="arch-btn" onClick={() => copyIds(exportResult.ids)}>{copied ? 'Copied' : 'Copy archive ids'}</button>
            {!exportResult.promoted && promoteTo && (
              <a className="arch-btn arch-btn--link" href={promoteLink(promoteTo, exportResult.ids, tier)} target="_blank" rel="noopener noreferrer">
                Promote these to {promoteTo}
              </a>
            )}
          </div>
          <code className="arch-mono arch-ids" title={exportResult.ids.join(',')}>{exportResult.ids.join(',')}</code>
        </section>
      )}

      {restoreResult && (restoreResult.checks.length > 0 || (promoteTo && restoreResult.ids.length > 0)) && (
        <section className="arch-next" data-testid="archive-restore-check">
          {restoreResult.checks.length > 0 && (
            <>
              <h3>Checked after the restore</h3>
              <table className="arch-tbl arch-checktbl">
                <thead>
                  <tr>
                    <th className="arch-col-cset">Set</th>
                    <th className="arch-col-cnum">Questions</th>
                    <th className="arch-col-cnum">Categories</th>
                    <th className="arch-col-cstate">Against the backup</th>
                    <th className="arch-col-copen" />
                  </tr>
                </thead>
                <tbody>
                  {restoreResult.checks.map(({ archiveId, id, name, check }) => (
                    <tr key={archiveId || id} data-testid={`archive-check-${id}`}>
                      <td><span className="arch-nm" title={name}>{name}</span></td>
                      <td className="arch-num">{checkCount(check.questions)}</td>
                      <td className="arch-num">{checkCount(check.categories)}</td>
                      <td>
                        {check.matches
                          ? <span className="arch-ok">Matches</span>
                          : <span className="arch-bad" title={check.error || ''}>{check.error ? 'Could not check' : 'Does not match'}</span>}
                      </td>
                      <td><div className="arch-rowact"><a className="arch-btn arch-btn--sm" href={setHref(id)}>Open the set</a></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {promoteTo && restoreResult.ids.length > 0 && (
            <div className="arch-acts">
              <a className="arch-btn arch-btn--primary" href={promoteLink(promoteTo, restoreResult.ids, tier)} target="_blank" rel="noopener noreferrer">
                Promote these to {promoteTo} <Icon name="ArrowSquareOut" weight="bold" size={14} color="currentColor" />
              </a>
            </div>
          )}
        </section>
      )}

      {loadState === 'loading' && <p className="arch-loading">Loading archive items…</p>}

      {loadState === 'down' && (
        <div className="arch-down" role="alert">
          <Icon name="WarningOctagon" weight="duotone" size={36} color="var(--danger-text)" />
          <h3>The archive did not answer</h3>
          <p>
            The archive relay returned nothing. It is a separate stack from this environment, so this
            says nothing about your sets, prompts or sessions — only that promotion between
            environments is unavailable right now.
          </p>
          <div className="arch-acts">
            <button type="button" className="arch-btn arch-btn--primary" onClick={loadArchiveItems}>
              <Icon name="ArrowsClockwise" weight="bold" size={14} color="currentColor" /> Try again
            </button>
          </div>
          <p className="arch-fine">
            To move a set by hand meanwhile: download its CSV from Question sets and upload it in the
            other environment.
          </p>
          <code className="arch-mono">GET {archiveRoute('items')} — {downReason || 'no response'}</code>
        </div>
      )}

      {nothingExists && (
        <div className="arch-empty">
          <Icon name="Package" weight="duotone" size={40} color="var(--muted)" />
          <h3>Nothing has been backed up yet</h3>
          <p>
            Export from {tierName} puts a copy of a set or prompt here, where every environment can
            restore it.
          </p>
        </div>
      )}

      {loadState === 'ready' && items.length > 0 && (
        <>
          <ListControls
            scope="arch"
            search={{
              value: search,
              onChange: (value) => set({ search: value }),
              ariaLabel: 'Search title, description',
              placeholder: 'Search title, description…',
            }}
            selects={[
              {
                key: 'tier',
                value: tierFilter,
                onChange: (value) => set({ tier: value }),
                ariaLabel: 'Environment',
                options: [
                  { value: '', label: 'All environments' },
                  ...TIERS.map((t) => ({ value: t, label: t })),
                  { value: 'unknown', label: 'unknown' },
                ],
              },
              {
                key: 'type',
                value: type,
                onChange: (value) => set({ type: value }),
                ariaLabel: 'Content type',
                options: [
                  { value: '', label: 'Question sets & prompts' },
                  { value: 'questionset', label: 'Question sets' },
                  { value: 'prompt', label: 'Prompts' },
                ],
              },
              {
                key: 'gameType',
                value: gameType,
                onChange: (value) => set({ gameType: value }),
                ariaLabel: 'Engagement type',
                options: [
                  { value: '', label: 'All engagement types' },
                  ...GAME_TYPE_LIST.map((meta) => ({ value: meta.id, label: meta.label })),
                ],
              },
            ]}
            count={count}
          />

          {shown.length === 0 ? (
            <div className="arch-nomatch">
              <h3>No items match {activeFilterCount === 1 ? 'this filter' : `these ${activeFilterCount} filters`}</h3>
              <p>
                {plural(items.length, 'item')} exist{items.length === 1 ? 's' : ''}.
                {drops.length ? ' Removing any one of these gets you results:' : ''}
              </p>
              <div className="arch-drops">
                {drops.map((drop) => (
                  <button key={drop.key} type="button" className="arch-drop" onClick={() => clearOne(drop.key)}>
                    <Icon name="X" weight="bold" size={12} color="currentColor" />
                    {drop.label} <em>— {plural(drop.count, 'item')}</em>
                  </button>
                ))}
              </div>
              <button type="button" className="arch-btn arch-btn--link" onClick={clearAll}>Clear all filters</button>
            </div>
          ) : (
            <table className="arch-tbl">
              <thead>
                <tr>
                  <th className="arch-col-sel">
                    <input type="checkbox" aria-label="Select all shown" checked={allShownSelected} onChange={toggleAllShown} />
                  </th>
                  <th className="arch-col-item">Item</th>
                  <th className="arch-col-from">From</th>
                  <th className="arch-col-type">Type</th>
                  <th className="arch-col-size">Size</th>
                  <th className="arch-col-when">Exported</th>
                  <th className="arch-col-acts" />
                </tr>
              </thead>
              <tbody>
                {rows.map(({ item, latest, snapshots }) => {
                  const itemTier = archiveTier(item);
                  const scope = archiveScope(item);
                  const tags = displayTags(item);
                  const kind = archiveGameType(item);
                  const isSelected = selected.has(item.ArchiveId);
                  const sub = [item.Description, tags.join(' · ')].filter(Boolean).join(' · ');
                  return (
                    <tr key={item.ArchiveId} data-testid={`archive-item-${item.ArchiveId}`} className={`arch-row${isSelected ? ' arch-row--sel' : ''}`}>
                      <td className="arch-sel">
                        <input
                          type="checkbox"
                          aria-label={`Select ${item.Title}`}
                          checked={isSelected}
                          onChange={() => toggleSelected(item.ArchiveId)}
                        />
                      </td>
                      <td>
                        <span className="arch-nm" title={item.Title}>{item.Title}</span>
                        <span className="arch-sub" title={sub}>{sub || '—'}</span>
                        {(scope || snapshots > 1) && (
                          <span className="arch-states">
                            {scope && <span className="arch-chip arch-chip--off">{libraryLabel(scope)}</span>}
                            {snapshots > 1 && (
                              <span className="arch-chip" data-testid="archive-item-snapshot">
                                {latest ? `Latest of ${snapshots} backups` : 'Earlier backup'}
                              </span>
                            )}
                          </span>
                        )}
                      </td>
                      <td>
                        <span className={`arch-chip arch-chip--tier arch-chip--tier-${itemTier || 'unknown'}`} data-testid="archive-item-tier">
                          {itemTier || 'unknown'}
                        </span>
                      </td>
                      <td>
                        <span className="arch-chip arch-chip--type">
                          {item.ContentType === 'prompt' ? 'Prompt' : (kind ? gameTypeLabel(kind) : '—')}
                        </span>
                      </td>
                      <td className="arch-num">{formatFileSize(item.FileSize)}</td>
                      <td className="arch-when" title={item.CreatedAt || ''} data-testid="archive-item-when">{formatExported(item.CreatedAt)}</td>
                      <td>
                        <div className="arch-rowact">
                          <button type="button" className="arch-btn arch-btn--sm" onClick={() => handleDownload(item)} title="Download this backup as a file">
                            Download
                          </button>
                          <button type="button" className="arch-btn arch-btn--sm arch-btn--ghostdanger" onClick={() => setDialog({ kind: 'delete', item })} title="Delete this backup from the shared archive">
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {selected.size > 0 && (
            <section className="arch-import" aria-live="polite">
              <h3>Importing {plural(selected.size, 'item')} into {tierName}</h3>
              <p>
                A set that already exists is written as a new version and switched to; the version it
                replaces stays in its history. An active Engage set is live for every organisation.
              </p>
            </section>
          )}
        </>
      )}

      {dialog && dialog.kind === 'import' && (
        <Modal
          overlayClassName="arch arch-scrim"
          contentClassName={`arch-modal arch-modal--wide${isProd ? ' arch-modal--prod' : ''}`}
          labelledBy="arch-import-title"
          onClose={closeDialog}
          closeOnBackdrop={() => !busy}
          closeOnEscape={() => !busy}
        >
          <DialogHead
            titleId="arch-import-title"
            title={isProd
              ? <>Restore {plural(selected.size, 'backup')} into PROD?</>
              : <>Restore {plural(selected.size, 'backup')} into {tierName}?</>}
            titlesClassName="arch-grow"
            icon={<Icon name={isProd ? 'Warning' : 'DownloadSimple'} weight="fill" size={20} color={isProd ? 'var(--danger-text)' : 'var(--primary)'} />}
            onClose={closeDialog}
            closeDisabled={Boolean(busy)}
            closeClassName="arch-x"
          />
          <div className="arch-modal-body">
            {isProd && (
              <p className="arch-prodwarn" data-testid="archive-prod-warning">
                <strong>This writes to PROD.</strong> Every customer organisation reads Engage&rsquo;s
                library here: a set that arrives active is live for all of them at once.
              </p>
            )}

            {plan && plan.state === 'loading' && <p className="arch-loading">Checking what each backup would do here…</p>}
            {plan && plan.state === 'error' && (
              <p className="arch-fine" role="alert">The preview could not be made ({plan.error}). The restore can still go ahead.</p>
            )}
            {plan && plan.state === 'ready' && (
              <ul className="arch-plan" data-testid="archive-plan">
                {plan.plan.map((entry) => {
                  const shownEntry = describePlanEntry(entry);
                  return (
                    <li key={entry.archiveId} data-testid={`archive-plan-${entry.archiveId}`}>
                      <span className="arch-pick-main">
                        <span className="arch-nm" title={entry.name || titleOf(entry.archiveId)}>{entry.name || titleOf(entry.archiveId)}</span>
                        <span className="arch-sub">{shownEntry.counts}</span>
                      </span>
                      <span className="arch-pick-meta">
                        <span className={`arch-chip${entry.mode === 'new-version' ? ' arch-chip--version' : ''}`}>{shownEntry.verdict}</span>
                        <span className={`arch-chip${shownEntry.live ? ' arch-chip--live' : ' arch-chip--off'}`}>{shownEntry.arrival}</span>
                      </span>
                    </li>
                  );
                })}
                {plan.failed.map((entry) => (
                  <li key={entry.archiveId} className="arch-plan-no" data-testid={`archive-plan-${entry.archiveId}`}>
                    <span className="arch-pick-main">
                      <span className="arch-nm" title={titleOf(entry.archiveId)}>{titleOf(entry.archiveId)}</span>
                      <span className="arch-sub arch-bad" title={entry.error}>{entry.refused ? 'Will not be restored' : 'Could not be read'}: {entry.error}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <p>
              A set that already exists gets a new version and switches to it; the version it replaces
              stays in its history.
            </p>
            {!isProd && <p>An active Engage set is live for every organisation the moment it is restored.</p>}

            {isProd && (
              <label className="arch-typed">
                <span>Type <strong>prod</strong> to confirm</span>
                <input
                  type="text"
                  className="arch-input arch-input--plain"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="Type prod to confirm"
                />
              </label>
            )}
            <StatusMessage message={error} tone="error" className="arch-alert arch-alert--error" />
          </div>
          <DialogFoot cancel={<button type="button" className="arch-btn" onClick={closeDialog} disabled={Boolean(busy)}>Cancel</button>}>
            <button
              type="button"
              className={`arch-btn ${isProd ? 'arch-btn--dangersolid' : 'arch-btn--primary'}`}
              onClick={confirmImport}
              disabled={Boolean(busy) || !planSettled || !typedOk}
            >
              {busy === 'import' ? 'Restoring…' : (isProd ? `Restore ${selected.size} into PROD` : `Restore ${selected.size}`)}
            </button>
          </DialogFoot>
        </Modal>
      )}

      {dialog && dialog.kind === 'delete' && (
        <Modal
          overlayClassName="arch arch-scrim"
          contentClassName="arch-modal"
          labelledBy="arch-del-title"
          onClose={closeDialog}
          closeOnBackdrop={() => !busy}
          closeOnEscape={() => !busy}
        >
          <DialogHead titleId="arch-del-title" title={<>Delete the backup “{dialog.item.Title}”?</>} titlesClassName="arch-grow" sub={<>{formatWhen(dialog.item.CreatedAt)} · from {archiveTier(dialog.item) || 'an unknown environment'}</>} subClassName="arch-dim" icon={<Icon name="Warning" weight="fill" size={20} color="var(--danger-text)" />} onClose={closeDialog} closeDisabled={Boolean(busy)} closeClassName="arch-x" />
          <div className="arch-modal-body">
            <p>
              Every environment shares this archive: deleting it here removes it for dev, test and
              prod alike. The set it was made from is not touched.
            </p>
            <StatusMessage message={error} tone="error" className="arch-alert arch-alert--error" />
          </div>
          <DialogFoot cancel={<button type="button" className="arch-btn" onClick={closeDialog} disabled={Boolean(busy)}>Cancel</button>}>
            <button type="button" className="arch-btn arch-btn--dangersolid" onClick={confirmDelete} disabled={Boolean(busy)}>
              {busy === 'delete' ? 'Deleting…' : 'Delete the backup'}
            </button>
          </DialogFoot>
        </Modal>
      )}

      {dialog && dialog.kind === 'export' && (
        <Modal
          overlayClassName="arch arch-scrim"
          contentClassName="arch-modal arch-modal--wide"
          labelledBy="arch-export-title"
          onClose={closeDialog}
          closeOnBackdrop={() => !busy}
          closeOnEscape={() => !busy}
        >
          <DialogHead titleId="arch-export-title" title={<>Back up from {tierName}</>} titlesClassName="arch-grow" sub={`Engage and public content only. Organisation content is encrypted per organisation and is never archived.${promoteTo ? ` Promote to ${promoteTo}… backs up and gives you a link that opens ${promoteTo}'s Archive with them selected.` : ''}`} subClassName="arch-dim" icon={<Icon name="UploadSimple" weight="fill" size={20} color="var(--primary)" />} onClose={closeDialog} closeDisabled={Boolean(busy)} closeClassName="arch-x" />
          <div className="arch-modal-body">
            <StatusMessage message={error} tone="error" className="arch-alert arch-alert--error" />
            {localPending > 0 ? (
              <p className="arch-loading">Loading local content…</p>
            ) : (
              <>
                <div className="arch-filters arch-pickbar">
                  <div className="arch-search">
                    <Icon name="MagnifyingGlass" weight="bold" size={14} color="var(--muted)" />
                    <input
                      type="search"
                      className="arch-input"
                      value={pickSearch}
                      onChange={(e) => setPickSearch(e.target.value)}
                      placeholder="Search name or id…"
                      aria-label="Search name or id"
                    />
                  </div>
                  <select className="arch-input arch-select" value={pickSort} onChange={(e) => setPickSort(e.target.value)} aria-label="Sort by">
                    {PICKER_SORTS.map((option) => <option key={option.value} value={option.value}>Sort: {option.label}</option>)}
                  </select>
                </div>
                {pickGroup({
                  title: 'Question sets',
                  all: setRows,
                  shownRows: shownSetRows,
                  picked: pickedSets,
                  setPicked: setPickedSets,
                  toggle: togglePickedSet,
                  exportType: 'questionsets',
                  noun: 'set',
                  renderMeta: (row) => (
                    <>
                      <span className={`arch-chip${row.active ? ' arch-chip--live' : ' arch-chip--off'}`}>{row.active ? 'Active' : 'Inactive'}</span>
                      <span className="arch-chip arch-chip--off">{libraryLabel(row.scope)}</span>
                      {row.totalQuestions != null && <span className="arch-dim">{plural(row.totalQuestions, 'question')}</span>}
                    </>
                  ),
                })}
                {pickGroup({
                  title: 'Prompts',
                  all: promptRows,
                  shownRows: shownPromptRows,
                  picked: pickedPrompts,
                  setPicked: setPickedPrompts,
                  toggle: togglePickedPrompt,
                  exportType: 'prompts',
                  noun: 'prompt',
                  renderMeta: (row) => (
                    <>
                      {row.status && <span className={`arch-chip${row.status === 'active' ? ' arch-chip--live' : ' arch-chip--off'}`}>{row.status === 'active' ? 'Active' : row.status}</span>}
                      {row.isDefault && <span className="arch-chip">Default</span>}
                    </>
                  ),
                })}
              </>
            )}
          </div>
          <DialogFoot>
            <button type="button" className="arch-btn" onClick={closeDialog} disabled={Boolean(busy)}>Close</button>
          </DialogFoot>
        </Modal>
      )}
    </section>
  );
};

export default ArchivePanel;
