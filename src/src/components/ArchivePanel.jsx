import React, { useState, useEffect, useMemo } from 'react';
import { authFetch } from '../auth/authFetch';
import Icon from './Icon';
import StatusMessage from './StatusMessage';
import { GAME_TYPE_LIST, gameTypeLabel } from '../config/gameTypes';
import {
  archiveGameType,
  filterArchiveItems,
  tagFilterOptions,
} from '../utils/archiveFiltering';
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

/**
 * THE ARCHIVE SCREEN — backups of Engage's library and the public library, shared by every tier.
 *
 * Every call goes to this tier's own routes: `admin/archive/*` (admin/archive-items.js) and the
 * export and import routes. Nothing calls the archive service itself. The archive accepts only
 * signed AWS requests, and who may use it is decided by the tier's own sign-in. See
 * docs/superpowers/specs/2026-09-14-archive-full-fidelity-design.md §4.7.
 *
 * WHICH ENVIRONMENT IS THE FIRST QUESTION. Every tier reads every tier's backups, so each item
 * says where it came from, the list filters by it, and an import names the environment it is
 * about to write to before anything happens.
 */
const archiveRoute = (suffix) => `${window.API_BASE}admin/archive/${suffix}`;
const readBody = (response) => response.json().catch(() => ({}));
const libraryLabel = (scope) => (scope === 'public' ? 'Public library' : 'Engage library');

const formatFileSize = (bytes) => {
  if (!bytes) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
};
const formatDate = (dateString) => new Date(dateString).toLocaleString();

const ArchivePanel = ({ environment }) => {
  const tierName = environment && environment.id && environment.id !== 'unknown' ? environment.id : 'this environment';
  const [activeTab, setActiveTab] = useState('browse');
  const [archiveItems, setArchiveItems] = useState([]);
  const [localQuestionSets, setLocalQuestionSets] = useState([]);
  const [localPrompts, setLocalPrompts] = useState([]);
  // Requests in flight. A count, not a boolean: the Export tab starts two loads at once, and
  // whichever finished first used to clear the other's loading state.
  const [pending, setPending] = useState(0);
  const loading = pending > 0;
  const begin = () => setPending((count) => count + 1);
  const end = () => setPending((count) => Math.max(0, count - 1));
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState('');
  const [report, setReport] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState('');
  // Game type, tag and environment are filtered in the browser. See utils/archiveFiltering.js.
  const [selectedGameType, setSelectedGameType] = useState('');
  const [selectedTag, setSelectedTag] = useState('');
  const [selectedTier, setSelectedTier] = useState('');
  const [selectedArchiveItems, setSelectedArchiveItems] = useState(new Set());
  const [selectedQuestionSets, setSelectedQuestionSets] = useState(new Set());
  const [selectedPrompts, setSelectedPrompts] = useState(new Set());

  useEffect(() => {
    loadArchiveItems();
    if (activeTab === 'export') {
      loadLocalContent();
    }
  }, [selectedType, activeTab]);

  const visibleItems = useMemo(
    () => filterArchiveItems(archiveItems, { gameType: selectedGameType, tag: selectedTag, tier: selectedTier }),
    [archiveItems, selectedGameType, selectedTag, selectedTier]
  );
  const rows = useMemo(() => groupSnapshots(visibleItems), [visibleItems]);
  const availableTags = useMemo(() => tagFilterOptions(archiveItems, selectedTag), [archiveItems, selectedTag]);
  // Organisation content is encrypted per organisation and never archived, so it is not offered.
  const exportableSets = useMemo(() => localQuestionSets.filter((qs) => (qs.scope || 'platform') !== 'org'), [localQuestionSets]);
  // Only Engage's prompts: nothing writes public prompts, and org prompts are never archived.
  const exportablePrompts = useMemo(() => localPrompts.filter((p) => (p.scope || 'platform') === 'platform'), [localPrompts]);

  // An empty grid means two different things, and saying which one saves a pointless re-search.
  const emptyMessage = archiveItems.length === 0
    ? 'No archive items found'
    : 'No archive items match the current filters';

  const toggle = (setter, current, key) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    setter(next);
  };

  const loadArchiveItems = async () => {
    begin();
    setError(null);
    try {
      const query = selectedType ? `?type=${encodeURIComponent(selectedType)}` : '';
      const response = await authFetch(archiveRoute(`items${query}`));
      const data = await readBody(response);
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setArchiveItems(data.items || []);
    } catch (err) {
      console.error('Failed to load archive items:', err);
      setError(`Failed to load archive items: ${err.message}`);
    } finally {
      end();
    }
  };

  const loadLocalContent = async () => {
    begin();
    setError(null);
    try {
      const questionSetsResponse = await authFetch(`${window.API_BASE}admin/question-sets`);
      if (questionSetsResponse.ok) {
        const questionSetsData = await questionSetsResponse.json();
        setLocalQuestionSets(questionSetsData.questionSets || []);
      }
      const promptsResponse = await authFetch(`${window.API_BASE}admin/ai-prompts`);
      if (promptsResponse.ok) {
        const promptsData = await promptsResponse.json();
        setLocalPrompts(promptsData.prompts || []);
      }
    } catch (err) {
      console.error('Failed to load local content:', err);
      setError('Failed to load local content. Please try again.');
    } finally {
      end();
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) {
      loadArchiveItems();
      return;
    }
    begin();
    setError(null);
    try {
      const response = await authFetch(archiveRoute('search'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchQuery, filters: selectedType ? { contentType: selectedType } : {} }),
      });
      const data = await readBody(response);
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setArchiveItems(data.items || []);
    } catch (err) {
      console.error('Search failed:', err);
      setError(`Search failed: ${err.message}`);
    } finally {
      end();
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

  const handleDelete = async (item) => {
    if (!window.confirm(`Delete the backup "${item.Title}"? Every environment shares this archive.`)) return;
    try {
      const response = await authFetch(archiveRoute(`items/${encodeURIComponent(item.ArchiveId)}`), { method: 'DELETE' });
      const data = await readBody(response);
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      setNotice(`Deleted the backup "${item.Title}".`);
      loadArchiveItems();
    } catch (err) {
      console.error('Delete failed:', err);
      setError(`Delete failed: ${err.message}`);
    }
  };

  const handleExportSelected = async (exportType) => {
    const selectedItems = exportType === 'questionsets'
      ? exportSelection(selectedQuestionSets)
      : [...selectedPrompts].map((id) => ({ scope: 'platform', id }));
    if (selectedItems.length === 0) {
      setError('Please select items to export');
      return;
    }
    begin();
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
      if (exportType === 'questionsets') setSelectedQuestionSets(new Set());
      else setSelectedPrompts(new Set());
      loadArchiveItems();
    } catch (err) {
      console.error('Export failed:', err);
      setError(`Export failed: ${err.message}`);
    } finally {
      end();
    }
  };

  const handleImportSelected = async () => {
    const selectedItems = [...selectedArchiveItems];
    if (selectedItems.length === 0) {
      setError('Please select items to import');
      return;
    }
    const count = selectedItems.length;
    const confirmed = window.confirm(
      `Restore ${count} backup${count === 1 ? '' : 's'} into ${tierName}? `
      + 'A set that already exists gets a new version and switches to it; the version it replaces stays in its history. '
      + 'An active Engage set is live for every organisation.'
    );
    if (!confirmed) return;
    begin();
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
      setSelectedArchiveItems(new Set());
    } catch (err) {
      console.error('Import failed:', err);
      setError(`Import failed: ${err.message}`);
    } finally {
      end();
    }
  };

  const renderArchiveItem = ({ item, latest, snapshots }, selectable) => {
    const tier = archiveTier(item);
    const scope = archiveScope(item);
    const tags = displayTags(item);
    const selected = selectedArchiveItems.has(item.ArchiveId);
    return (
      <div key={item.ArchiveId} className="archive-item" data-testid={`archive-item-${item.ArchiveId}`}>
        {selectable && (
          <div className="item-checkbox">
            <input
              type="checkbox"
              aria-label={`Select ${item.Title}`}
              checked={selected}
              onChange={() => toggle(setSelectedArchiveItems, selectedArchiveItems, item.ArchiveId)}
            />
          </div>
        )}
        <div className="item-header">
          <h4>{item.Title}</h4>
          <span className="item-type">{item.ContentType}</span>
        </div>

        {item.Description && <p className="item-description">{item.Description}</p>}

        <div className="item-tags">
          <span className={`tag tier tier-${tier || 'unknown'}`} data-testid="archive-item-tier">
            {tier ? `From ${tier}` : 'Environment not recorded'}
          </span>
          {scope && <span className="tag scope">{libraryLabel(scope)}</span>}
          {snapshots > 1 && (
            <span className="tag snapshot" data-testid="archive-item-snapshot">
              {latest ? `Latest of ${snapshots} backups` : 'Earlier backup'}
            </span>
          )}
        </div>

        <div className="item-meta">
          {archiveGameType(item) && (
            <span>
              <Icon name="GameController" weight="bold" size={16} color="currentColor" />
              {' '}{gameTypeLabel(archiveGameType(item))}
            </span>
          )}
          <span><Icon name="Folder" weight="bold" size={16} color="currentColor" /> {item.Category}</span>
          <span><Icon name="FileText" weight="bold" size={16} color="currentColor" /> {formatFileSize(item.FileSize)}</span>
          <span><Icon name="CalendarBlank" weight="bold" size={16} color="currentColor" /> {formatDate(item.CreatedAt)}</span>
        </div>

        {tags.length > 0 && (
          <div className="item-tags">
            {tags.map((tag, index) => <span key={`${tag}-${index}`} className="tag">{tag}</span>)}
          </div>
        )}

        <div className="item-actions">
          {selectable ? (
            <button className="btn-primary" onClick={() => toggle(setSelectedArchiveItems, selectedArchiveItems, item.ArchiveId)}>
              {selected ? 'Selected' : 'Select for Import'}
            </button>
          ) : (
            <>
              <button onClick={() => handleDownload(item)}>
                <Icon name="DownloadSimple" weight="bold" size={16} color="currentColor" /> Download
              </button>
              <button className="delete-btn" onClick={() => handleDelete(item)}>
                <Icon name="Trash" weight="bold" size={16} color="currentColor" /> Delete
              </button>
            </>
          )}
        </div>
      </div>
    );
  };

  const renderGrid = (selectable) => (
    loading ? (
      <div className="loading">Loading archive items...</div>
    ) : (
      <div className="archive-grid">
        {rows.length === 0
          ? <div className="no-items">{emptyMessage}</div>
          : rows.map((row) => renderArchiveItem(row, selectable))}
      </div>
    )
  );

  return (
    <div className="archive-panel">
      <div className="archive-header">
        <h3><Icon name="Books" weight="duotone" size={16} color="var(--primary)" /> Content Archive</h3>
        <div className="archive-tabs">
          <button className={`tab-btn ${activeTab === 'browse' ? 'active' : ''}`} onClick={() => setActiveTab('browse')}>
            <Icon name="MagnifyingGlass" weight="bold" size={16} color="currentColor" /> Browse Archive
          </button>
          <button className={`tab-btn ${activeTab === 'export' ? 'active' : ''}`} onClick={() => setActiveTab('export')}>
            <Icon name="UploadSimple" weight="bold" size={16} color="currentColor" /> Export to Archive
          </button>
          <button className={`tab-btn ${activeTab === 'import' ? 'active' : ''}`} onClick={() => setActiveTab('import')}>
            <Icon name="DownloadSimple" weight="bold" size={16} color="currentColor" /> Import from Archive
          </button>
        </div>
      </div>

      <div className="archive-filters">
        <div className="filter-group">
          <input
            type="text"
            placeholder="Search archive..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />
          <button onClick={handleSearch}>Search</button>
        </div>

        <div className="filter-group">
          <select aria-label="Environment" value={selectedTier} onChange={(e) => setSelectedTier(e.target.value)}>
            <option value="">All environments</option>
            {TIERS.map((tier) => <option key={tier} value={tier}>{tier}</option>)}
          </select>

          <select aria-label="Content type" value={selectedType} onChange={(e) => setSelectedType(e.target.value)}>
            <option value="">All Content Types</option>
            <option value="questionset">Question Sets</option>
            <option value="prompt">Prompts</option>
          </select>

          <select aria-label="Game type" value={selectedGameType} onChange={(e) => setSelectedGameType(e.target.value)}>
            <option value="">All Game Types</option>
            {GAME_TYPE_LIST.map((type) => (
              <option key={type.id} value={type.id}>{type.label}</option>
            ))}
          </select>

          <select aria-label="Tag" value={selectedTag} onChange={(e) => setSelectedTag(e.target.value)} disabled={availableTags.length === 0}>
            <option value="">All Tags</option>
            {availableTags.map((tag) => (
              <option key={tag} value={tag}>{tag}</option>
            ))}
          </select>
        </div>
      </div>

      <StatusMessage message={error} tone="error" className="error-message" />
      <StatusMessage message={notice} tone="success" />
      {report.length > 0 && (
        <ul className="archive-report" data-testid="archive-report">
          {report.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}
        </ul>
      )}

      {activeTab === 'browse' && renderGrid(false)}

      {activeTab === 'export' && (
        <div className="export-section">
          <h4><Icon name="UploadSimple" weight="bold" size={16} color="currentColor" /> Back up from {tierName}</h4>
          <p className="archive-note">
            Engage and public content only. Organisation content is encrypted per organisation and is never archived.
          </p>

          {loading ? (
            <div className="loading">Loading local content...</div>
          ) : (
            <>
              <div className="export-category">
                <div className="category-header">
                  <h5><Icon name="Books" weight="duotone" size={16} color="var(--primary)" /> Question Sets ({exportableSets.length})</h5>
                  <div className="bulk-actions">
                    <button
                      className="btn-secondary btn-small"
                      onClick={() => setSelectedQuestionSets(new Set(exportableSets.map((qs) => selectionKey(qs.scope, qs.id))))}
                    >
                      Select All
                    </button>
                    <button className="btn-secondary btn-small" onClick={() => setSelectedQuestionSets(new Set())}>Clear</button>
                    <button
                      className="btn-primary"
                      onClick={() => handleExportSelected('questionsets')}
                      disabled={selectedQuestionSets.size === 0}
                    >
                      <Icon name="UploadSimple" weight="bold" size={16} color="currentColor" /> Export Selected ({selectedQuestionSets.size})
                    </button>
                  </div>
                </div>

                <div className="archive-grid">
                  {exportableSets.map((qs) => {
                    const key = selectionKey(qs.scope, qs.id);
                    const selected = selectedQuestionSets.has(key);
                    return (
                      <div key={key} className="archive-item">
                        <div className="item-checkbox">
                          <input
                            type="checkbox"
                            aria-label={`Select ${qs.name}`}
                            checked={selected}
                            onChange={() => toggle(setSelectedQuestionSets, selectedQuestionSets, key)}
                          />
                        </div>
                        <div className="item-header">
                          <h4>{qs.name}</h4>
                          <span className="item-type">{libraryLabel(qs.scope)}</span>
                        </div>
                        {qs.description && <p className="item-description">{qs.description}</p>}
                        <div className="item-meta">
                          <span><Icon name="GameController" weight="bold" size={16} color="currentColor" /> {qs.engagementType}</span>
                          <span><Icon name="Question" weight="bold" size={16} color="currentColor" /> {qs.totalQuestions} questions</span>
                          <span><Icon name="CalendarBlank" weight="bold" size={16} color="currentColor" /> {qs.createdAt ? formatDate(qs.createdAt) : 'Unknown'}</span>
                        </div>
                        <div className="item-tags">
                          {qs.active && <span className="tag active">Active</span>}
                          {qs.isAIGenerated && <span className="tag ai">AI Generated</span>}
                        </div>
                        <div className="item-actions">
                          <button className="btn-primary" onClick={() => toggle(setSelectedQuestionSets, selectedQuestionSets, key)}>
                            {selected ? 'Selected' : 'Select for Export'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="export-category">
                <div className="category-header">
                  <h5><Icon name="Sparkle" weight="duotone" size={16} color="var(--primary)" /> AI Prompts ({exportablePrompts.length})</h5>
                  <div className="bulk-actions">
                    <button
                      className="btn-secondary btn-small"
                      onClick={() => setSelectedPrompts(new Set(exportablePrompts.map((p) => p.promptId || p.id)))}
                    >
                      Select All
                    </button>
                    <button className="btn-secondary btn-small" onClick={() => setSelectedPrompts(new Set())}>Clear</button>
                    <button
                      className="btn-primary"
                      onClick={() => handleExportSelected('prompts')}
                      disabled={selectedPrompts.size === 0}
                    >
                      <Icon name="UploadSimple" weight="bold" size={16} color="currentColor" /> Export Selected ({selectedPrompts.size})
                    </button>
                  </div>
                </div>

                <div className="archive-grid">
                  {exportablePrompts.map((prompt) => {
                    const id = prompt.promptId || prompt.id;
                    const selected = selectedPrompts.has(id);
                    return (
                      <div key={id} className="archive-item">
                        <div className="item-checkbox">
                          <input
                            type="checkbox"
                            aria-label={`Select ${prompt.name}`}
                            checked={selected}
                            onChange={() => toggle(setSelectedPrompts, selectedPrompts, id)}
                          />
                        </div>
                        <div className="item-header">
                          <h4>{prompt.name}</h4>
                          <span className="item-type">AI Prompt</span>
                        </div>
                        {prompt.description && <p className="item-description">{prompt.description}</p>}
                        <div className="item-meta">
                          <span><Icon name="GameController" weight="bold" size={16} color="currentColor" /> {prompt.gameType}</span>
                          <span><Icon name="Folder" weight="bold" size={16} color="currentColor" /> {prompt.category}</span>
                          <span><Icon name="CalendarBlank" weight="bold" size={16} color="currentColor" /> {prompt.createdAt ? formatDate(prompt.createdAt) : 'Unknown'}</span>
                        </div>
                        <div className="item-tags">
                          <span className={`tag ${prompt.status}`}>{prompt.status}</span>
                          {prompt.isDefault && <span className="tag default">Default</span>}
                        </div>
                        <div className="item-actions">
                          <button className="btn-primary" onClick={() => toggle(setSelectedPrompts, selectedPrompts, id)}>
                            {selected ? 'Selected' : 'Select for Export'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {activeTab === 'import' && (
        <div className="import-section">
          <h4><Icon name="DownloadSimple" weight="bold" size={16} color="currentColor" /> Restore into {tierName}</h4>
          <div className="import-header">
            <div className="bulk-actions">
              <button
                className="btn-secondary btn-small"
                onClick={() => setSelectedArchiveItems(new Set(visibleItems.map((item) => item.ArchiveId)))}
              >
                Select All
              </button>
              <button className="btn-secondary btn-small" onClick={() => setSelectedArchiveItems(new Set())}>Clear</button>
              <button className="btn-primary" onClick={handleImportSelected} disabled={selectedArchiveItems.size === 0 || loading}>
                <Icon name="DownloadSimple" weight="bold" size={16} color="currentColor" /> Import Selected ({selectedArchiveItems.size})
              </button>
            </div>
          </div>
          {renderGrid(true)}
        </div>
      )}
    </div>
  );
};

export default ArchivePanel;
