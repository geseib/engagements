import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { authFetch } from '../auth/authFetch';
import Icon from './Icon';
import Modal from './Modal';
import StatusMessage from './StatusMessage';
import ListControls from './ListControls';
import useListControls from '../hooks/useListControls';
import { GAME_TYPE_LIST, gameTypeLabel } from '../config/gameTypes';
import { formatWhen } from '../config/tableCells';
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
} from '../utils/archiveItems';
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
 */
const archiveRoute = (suffix) => `${window.API_BASE}admin/archive/${suffix}`;
const readBody = (response) => response.json().catch(() => ({}));
const libraryLabel = (scope) => (scope === 'public' ? 'Public library' : 'Engage library');
/** A status the archive service itself returns when it is not there to answer. */
const isOutage = (status) => [0, 502, 503, 504].includes(Number(status));
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

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

const ArchivePanel = ({ environment }) => {
  const tierName = environment && environment.id && environment.id !== 'unknown' ? environment.id : 'this environment';
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

  const {
    state: { search, tier, type, gameType },
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

  const toggleIn = (setter) => (key) => setter((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const toggleSelected = toggleIn(setSelected);
  const togglePickedSet = toggleIn(setPickedSets);
  const togglePickedPrompt = toggleIn(setPickedPrompts);

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
    setDialog({ kind: 'export' });
    loadLocalContent();
  };
  const closeDialog = () => { if (!busy) setDialog(null); };

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

  const confirmImport = async () => {
    const selectedItems = [...selected];
    if (selectedItems.length === 0 || busy) return;
    setBusy('import');
    setError(null);
    setNotice('');
    setReport([]);
    try {
      const response = await authFetch(`${window.API_BASE}admin/import-from-archive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedItems }),
      });
      const result = await readBody(response);
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      setReport(describeRestore(result));
      setSelected(new Set());
      setDialog(null);
    } catch (err) {
      console.error('Import failed:', err);
      setError(`Import failed: ${err.message}`);
    } finally {
      setBusy(null);
    }
  };

  const exportPicked = async (exportType) => {
    const selectedItems = exportType === 'questionsets'
      ? exportSelection(pickedSets)
      : [...pickedPrompts].map((id) => ({ scope: 'platform', id }));
    if (selectedItems.length === 0 || busy) return;
    setBusy('export');
    setError(null);
    setNotice('');
    setReport([]);
    try {
      const response = await authFetch(`${window.API_BASE}admin/export-to-archive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedItems, exportType }),
      });
      const result = await readBody(response);
      if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
      setReport(describeExport(result));
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

  return (
    <section className="arch">
      <div className="arch-head">
        <div className="arch-head-grow">
          <h2 className="arch-title">Archive</h2>
          <p className="arch-lede">One shared store, all environments.</p>
        </div>
        <button type="button" className="arch-btn" onClick={openExport} disabled={busy === 'export'}>
          <Icon name="UploadSimple" weight="bold" size={14} color="currentColor" /> Export from {tierName}…
        </button>
        <button
          type="button"
          className="arch-btn arch-btn--primary"
          onClick={() => setDialog({ kind: 'import' })}
          disabled={selected.size === 0 || busy === 'import'}
        >
          <Icon name="DownloadSimple" weight="bold" size={14} color="currentColor" /> Import {selected.size} selected
        </button>
      </div>

      <StatusMessage message={error} tone="error" className="arch-alert arch-alert--error" />
      <StatusMessage message={notice} tone="success" className="arch-alert arch-alert--success" />
      {report.length > 0 && (
        <ul className="arch-report" data-testid="archive-report">
          {report.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}
        </ul>
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
                value: tier,
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
                      <td className="arch-when">{formatWhen(item.CreatedAt)}</td>
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
          contentClassName="arch-modal"
          labelledBy="arch-import-title"
          onClose={closeDialog}
          closeOnBackdrop={() => !busy}
          closeOnEscape={() => !busy}
        >
          <header>
            <Icon name="DownloadSimple" weight="fill" size={20} color="var(--primary)" />
            <div className="arch-grow">
              <h2 id="arch-import-title">Restore {plural(selected.size, 'backup')} into {tierName}?</h2>
            </div>
            <button type="button" className="arch-x" onClick={closeDialog} disabled={Boolean(busy)} aria-label="Close" title="Close">×</button>
          </header>
          <div className="arch-modal-body">
            <p>
              A set that already exists gets a new version and switches to it; the version it replaces
              stays in its history.
            </p>
            <p>An active Engage set is live for every organisation the moment it is restored.</p>
            <StatusMessage message={error} tone="error" className="arch-alert arch-alert--error" />
          </div>
          <footer>
            <button type="button" className="arch-btn" onClick={closeDialog} disabled={Boolean(busy)}>Cancel</button>
            <button type="button" className="arch-btn arch-btn--primary" onClick={confirmImport} disabled={Boolean(busy)}>
              {busy === 'import' ? 'Restoring…' : `Restore ${selected.size}`}
            </button>
          </footer>
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
          <header>
            <Icon name="Warning" weight="fill" size={20} color="var(--danger-text)" />
            <div className="arch-grow">
              <h2 id="arch-del-title">Delete the backup “{dialog.item.Title}”?</h2>
              <p className="arch-dim">{formatWhen(dialog.item.CreatedAt)} · from {archiveTier(dialog.item) || 'an unknown environment'}</p>
            </div>
            <button type="button" className="arch-x" onClick={closeDialog} disabled={Boolean(busy)} aria-label="Close" title="Close">×</button>
          </header>
          <div className="arch-modal-body">
            <p>
              Every environment shares this archive: deleting it here removes it for dev, test and
              prod alike. The set it was made from is not touched.
            </p>
            <StatusMessage message={error} tone="error" className="arch-alert arch-alert--error" />
          </div>
          <footer>
            <button type="button" className="arch-btn" onClick={closeDialog} disabled={Boolean(busy)}>Cancel</button>
            <button type="button" className="arch-btn arch-btn--dangersolid" onClick={confirmDelete} disabled={Boolean(busy)}>
              {busy === 'delete' ? 'Deleting…' : 'Delete the backup'}
            </button>
          </footer>
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
          <header>
            <Icon name="UploadSimple" weight="fill" size={20} color="var(--primary)" />
            <div className="arch-grow">
              <h2 id="arch-export-title">Back up from {tierName}</h2>
              <p className="arch-dim">
                Engage and public content only. Organisation content is encrypted per organisation and is
                never archived.
              </p>
            </div>
            <button type="button" className="arch-x" onClick={closeDialog} disabled={Boolean(busy)} aria-label="Close" title="Close">×</button>
          </header>
          <div className="arch-modal-body">
            <StatusMessage message={error} tone="error" className="arch-alert arch-alert--error" />
            {localPending > 0 ? (
              <p className="arch-loading">Loading local content…</p>
            ) : (
              <>
                <section className="arch-group">
                  <div className="arch-group-head">
                    <h3>Question sets ({exportableSets.length})</h3>
                    <div className="arch-group-acts">
                      <button type="button" className="arch-btn arch-btn--sm" onClick={() => setPickedSets(new Set(exportableSets.map((qs) => selectionKey(qs.scope, qs.id))))}>Select all</button>
                      <button type="button" className="arch-btn arch-btn--sm" onClick={() => setPickedSets(new Set())}>Clear</button>
                      <button type="button" className="arch-btn arch-btn--sm arch-btn--primary" onClick={() => exportPicked('questionsets')} disabled={pickedSets.size === 0 || Boolean(busy)}>
                        {busy === 'export' ? 'Backing up…' : `Export ${plural(pickedSets.size, 'set')}`}
                      </button>
                    </div>
                  </div>
                  <ul className="arch-picklist">
                    {exportableSets.map((qs) => {
                      const key = selectionKey(qs.scope, qs.id);
                      return (
                        <li key={key}>
                          <label>
                            <input type="checkbox" aria-label={`Select ${qs.name}`} checked={pickedSets.has(key)} onChange={() => togglePickedSet(key)} />
                            <span className="arch-nm">{qs.name}</span>
                            <span className="arch-chip arch-chip--off">{libraryLabel(qs.scope)}</span>
                            {qs.totalQuestions != null && <span className="arch-dim">{plural(qs.totalQuestions, 'question')}</span>}
                          </label>
                        </li>
                      );
                    })}
                    {exportableSets.length === 0 && <li className="arch-dim">No sets here to back up.</li>}
                  </ul>
                </section>
                <section className="arch-group">
                  <div className="arch-group-head">
                    <h3>Prompts ({exportablePrompts.length})</h3>
                    <div className="arch-group-acts">
                      <button type="button" className="arch-btn arch-btn--sm" onClick={() => setPickedPrompts(new Set(exportablePrompts.map((p) => p.promptId || p.id)))}>Select all</button>
                      <button type="button" className="arch-btn arch-btn--sm" onClick={() => setPickedPrompts(new Set())}>Clear</button>
                      <button type="button" className="arch-btn arch-btn--sm arch-btn--primary" onClick={() => exportPicked('prompts')} disabled={pickedPrompts.size === 0 || Boolean(busy)}>
                        {busy === 'export' ? 'Backing up…' : `Export ${plural(pickedPrompts.size, 'prompt')}`}
                      </button>
                    </div>
                  </div>
                  <ul className="arch-picklist">
                    {exportablePrompts.map((prompt) => {
                      const id = prompt.promptId || prompt.id;
                      return (
                        <li key={id}>
                          <label>
                            <input type="checkbox" aria-label={`Select ${prompt.name}`} checked={pickedPrompts.has(id)} onChange={() => togglePickedPrompt(id)} />
                            <span className="arch-nm">{prompt.name}</span>
                            {prompt.gameType && <span className="arch-chip arch-chip--type">{gameTypeLabel(prompt.gameType)}</span>}
                            {prompt.isDefault && <span className="arch-chip">Default</span>}
                          </label>
                        </li>
                      );
                    })}
                    {exportablePrompts.length === 0 && <li className="arch-dim">No prompts here to back up.</li>}
                  </ul>
                </section>
              </>
            )}
          </div>
          <footer>
            <button type="button" className="arch-btn" onClick={closeDialog} disabled={Boolean(busy)}>Close</button>
          </footer>
        </Modal>
      )}
    </section>
  );
};

export default ArchivePanel;
