import React, { useMemo } from 'react';
import Icon from './Icon';
import { gameTypeLabel, normalizeGameType } from '../config/gameTypes';

/**
 * THE PROMPT LIBRARY — the list half of the Prompts admin section.
 *
 * WHY IT IS ITS OWN FILE, AND PURE. Exactly the QuestionSetsPanel arrangement,
 * for exactly its reasons: everything this screen decides happens here, where
 * it can be mounted, and fetching stays in AIPromptManager. It takes props and
 * calls back; it holds no state of its own and knows nothing about `authFetch`.
 *
 * WHAT REPLACED WHAT — the owner's standing ask was that this section be
 * "designed thoughtfully like the question set management", so the four
 * differences between the two screens are the work:
 *
 * 1. A CARD GRID BECAME A TABLE. Every prompt was a card carrying name,
 *    status, type, category, description and three icon buttons — the same
 *    "forty-one cards is a wall" the sets screen rejected (admin RATIONALE §4).
 *    A prompt library is an index; you scan it for one row and open it.
 *
 * 2. ONE EMPTY STATE BECAME TWO. `filteredPrompts.length === 0` printed "No
 *    prompts found. Create your first AI prompt to get started!" — the same
 *    sentence whether nothing exists or four filters exclude everything. The
 *    sets screen separates them because they are different situations with
 *    different exits, and the second one had no exit at all here.
 *
 * 3. THE FILTERS GAINED THEIR DROP-EXITS. Counting what each active filter is
 *    costing is one pass over an array already in memory, and it turns a dead
 *    end into N one-click ways out. A filter is only offered when dropping it
 *    actually produces rows.
 *
 * 4. THE WARNINGS BECAME CHIPS IN A COLUMN rather than badges wrapped into a
 *    meta line. `Not a summary prompt` and `Broken record` are the two states
 *    that mean a row does not work, and they were reading as decoration beside
 *    the ordinary type and category badges.
 *
 * The filter CONTROLS keep their markup (`.prompt-filters`, and the select
 * order game type / category / status). Three tests address them positionally,
 * and the derivation they cover — categories per game type — is a fix worth
 * more than the tidiness of renaming its container.
 */

/*
  WHAT THE `categoryKey` / `categoryOptions` / `flagSummaryUsability` PROPS ARE FOR.

  There were THREE prompt UIs (admin RATIONALE §9, "One prompt library"), and
  AIGenerationPromptEditor was the third — a `.prompts-grid` of `.prompt-card`s
  over the SAME `AIPROMPTS` table this panel reads. Pointing it here rather than
  restyling it in place is the whole point of AUDIT §6.2 item 9.

  The two record shapes are not identical, and the three props below are exactly
  the differences, so the panel is told about them instead of being forked:

  1. THE SECOND AXIS HAS TWO NAMES. Summary prompts carry `category`
     (`lessons-learned`, `general`, …); generation rows written by
     `populate-generation-prompts.js:502` carry `scenarioType` and no `category`
     at all. Same column, different attribute — `categoryKey`.

  2. GENERATION SCENARIOS HAVE LABELS, CATEGORIES DO NOT. `scenarioType` is a
     slug (`amazon-principles`) with a written label (`Amazon Leadership
     Principles`) the card grid never showed. `categoryOptions` therefore takes
     `{ value, label }` as well as the plain strings AIPromptManager passes.

  3. "NOT A SUMMARY PROMPT" IS INFORMATION ONLY WHERE IT CAN BE FALSE. The
     backend sets `summaryPromptStatus: 'unusable'` on every generation-format
     record (`get-ai-prompts.js:129-133`) — which is the point on the summary
     library, and is true of literally every row on a list filtered to
     `promptType=generation`. A chip on all N rows is not a warning, it is a
     watermark, so that screen passes `flagSummaryUsability={false}`.

  Everything else — the table, the two empty states, the drop-exits, the
  chips — is shared, which is what made the audit item worth doing.
*/

/** Does this prompt survive a filter combination? One place, so the drop-counts
 *  below cannot drift from the list they describe. */
export function matchesPromptFilters(
  prompt,
  { search = '', gameType = 'all', category = 'all', status = 'all' },
  { categoryKey = 'category' } = {}
) {
  if (gameType !== 'all' && normalizeGameType(prompt.gameType) !== normalizeGameType(gameType)) {
    return false;
  }
  if (category !== 'all' && prompt[categoryKey] !== category) return false;
  if (status !== 'all' && prompt.status !== status) return false;

  const needle = search.trim().toLowerCase();
  if (needle) {
    const hay = [prompt.name, prompt.description, ...(prompt.tags || [])]
      .filter(Boolean)
      .map((v) => String(v).toLowerCase());
    if (!hay.some((v) => v.includes(needle))) return false;
  }
  return true;
}

const STATUS_LABEL = { active: 'Active', draft: 'Draft', archived: 'Archived' };

/** The chip modifier for a status. Unknown statuses get the neutral chip rather
 *  than no chip, so a row written by a script is still legible. */
function statusChipClass(status) {
  if (status === 'active') return 'plib-chip--on';
  if (status === 'archived') return 'plib-chip--off';
  return 'plib-chip--warn';
}

/** `['general', …]` and `[{ value, label }, …]` are both accepted, so the two
 *  callers keep the shape each already has. */
function asOption(option) {
  return typeof option === 'string' ? { value: option, label: option } : option;
}

export default function PromptLibraryPanel({
  prompts = [],
  loading = false,
  filters,
  onFilterChange,
  /** The category options for the currently selected game type. Derived by the
   *  caller from the same table the editor uses; passing it keeps this
   *  component free of that vocabulary. Strings or `{ value, label }`. */
  categoryOptions = [],
  gameTypeOptions = [],
  /** Which attribute holds the second axis, and what it is called on screen.
   *  See the header block — generation rows spell it `scenarioType`. */
  categoryKey = 'category',
  categoryHeading = 'Category',
  categoryFilterAllLabel = 'All Categories',
  /** Draw the "Not a summary prompt" chip. False on a list that is already
   *  filtered to generation prompts, where it is true of every row. */
  flagSummaryUsability = true,
  /** The "nothing exists" copy. It has to say what a prompt IS, and the two
   *  libraries hold different things. */
  emptyHeading = 'No prompts yet',
  emptyBody = 'A summary prompt is what Workie says after a round. Until one exists, every session'
    + ' of every engagement type falls back to the shipped default for its type.',
  onEdit,
  onAdvise,
  onDelete,
  onCreate,
  onPopulateDefaults,
}) {
  const { search = '', gameType = 'all', category = 'all', status = 'all' } = filters || {};

  const shown = useMemo(
    () => prompts.filter(
      (p) => matchesPromptFilters(p, { search, gameType, category, status }, { categoryKey })
    ),
    [prompts, search, gameType, category, status, categoryKey]
  );

  const catOptions = useMemo(() => (categoryOptions || []).map(asOption), [categoryOptions]);
  /* A row whose category is not in the currently offered list still has to
     render, so the raw value is the fallback rather than a blank. */
  const catLabel = (value) => {
    const hit = catOptions.find((o) => o.value === value);
    return (hit && hit.label) || value;
  };

  /*
    THE EXITS FROM "NOTHING MATCHES" — QuestionSetsPanel's `drops`, same
    reasoning. Dropping a filter that leads to another empty screen is not an
    exit, so a candidate is only offered when it produces rows.
  */
  const drops = useMemo(() => {
    const base = { search, gameType, category, status };
    const candidates = [];
    if (search.trim()) {
      candidates.push({ key: 'search', label: `Search “${search.trim()}”`, next: { ...base, search: '' } });
    }
    if (gameType !== 'all') {
      candidates.push({ key: 'gameType', label: `Type: ${gameTypeLabel(gameType)}`, next: { ...base, gameType: 'all' } });
    }
    if (category !== 'all') {
      candidates.push({
        key: 'category',
        label: `${categoryHeading}: ${catLabel(category)}`,
        next: { ...base, category: 'all' },
      });
    }
    if (status !== 'all') {
      candidates.push({
        key: 'status',
        label: `Status: ${STATUS_LABEL[status] || status}`,
        next: { ...base, status: 'all' },
      });
    }
    return candidates
      .map((c) => ({
        ...c,
        count: prompts.filter((p) => matchesPromptFilters(p, c.next, { categoryKey })).length,
      }))
      .filter((c) => c.count > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompts, search, gameType, category, status, categoryKey, categoryHeading, catOptions]);

  const set = (patch) => onFilterChange && onFilterChange({ search, gameType, category, status, ...patch });
  const clearAll = () => set({ search: '', gameType: 'all', category: 'all', status: 'all' });

  const activeFilterCount = (search.trim() ? 1 : 0)
    + (gameType !== 'all' ? 1 : 0)
    + (category !== 'all' ? 1 : 0)
    + (status !== 'all' ? 1 : 0);
  const nothingExists = prompts.length === 0;

  return (
    <div className="plib">
      <div className="prompt-controls">
        <div className="prompt-filters">
          {/* Order is load-bearing: game type, category, status. Three tests
              address these positionally — see the header. */}
          <select
            value={gameType}
            onChange={(e) => {
              // The category list is derived from the game type, so a category
              // that is no longer offered would otherwise stay selected and
              // silently filter everything out.
              set({ gameType: e.target.value, category: 'all' });
            }}
            className="filter-select"
            aria-label="Filter by engagement type"
          >
            <option value="all">All Game Types</option>
            {gameTypeOptions.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>

          <select
            value={category}
            onChange={(e) => set({ category: e.target.value })}
            className="filter-select"
            aria-label={`Filter by ${categoryHeading.toLowerCase()}`}
          >
            <option value="all">{categoryFilterAllLabel}</option>
            {catOptions.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>

          <select
            value={status}
            onChange={(e) => set({ status: e.target.value })}
            className="filter-select"
            aria-label="Filter by status"
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="draft">Draft</option>
            <option value="archived">Archived</option>
          </select>

          <input
            type="search"
            placeholder="Search prompts..."
            aria-label="Search prompts"
            value={search}
            onChange={(e) => set({ search: e.target.value })}
            className="search-input"
          />

          <span className="plib-count">
            {prompts.length} prompt{prompts.length === 1 ? '' : 's'}
            {shown.length !== prompts.length ? ` · ${shown.length} shown` : ''}
          </span>
        </div>

        {/*
          A CONTROL IS DRAWN ONLY WHERE IT DOES SOMETHING. Rule 2 of the design
          system: "gate the affordance on the handler existing, never render one
          that does nothing" — a dead button is the one people reach for first.
          The generation library has no shipped-defaults installer of its own,
          so it passes no `onPopulateDefaults` and no such button appears.
        */}
        <div className="prompt-control-actions">
          {onPopulateDefaults && (
            <button
              className="btn-secondary"
              type="button"
              onClick={onPopulateDefaults}
              disabled={loading}
            >
              <Icon name="Target" weight="duotone" size={16} color="var(--primary)" /> Populate Default Prompts
            </button>
          )}
          {onCreate && (
            <button
              className="btn-primary create-prompt-btn"
              type="button"
              onClick={onCreate}
            >
              <Icon name="Plus" weight="bold" size={16} color="currentColor" /> Create New Prompt
            </button>
          )}
        </div>
      </div>

      {loading && nothingExists && <div className="loading-state">Loading prompts...</div>}

      {!loading && nothingExists && (
        /*
          NOTHING EXISTS. Distinct from "nothing matches", with its own words
          and its own verb — and it says what a prompt IS, because this is the
          one screen where somebody has to find out.
        */
        <div className="plib-empty" data-testid="plib-empty">
          <Icon name="Sparkle" weight="duotone" size={40} color="var(--muted)" />
          <h3>{emptyHeading}</h3>
          <p>{emptyBody}</p>
          <div className="plib-paths">
            {onCreate && (
              <button type="button" className="btn-primary" onClick={onCreate}>
                <Icon name="Plus" weight="bold" size={16} color="currentColor" /> Write one
              </button>
            )}
            {onPopulateDefaults && (
              <button type="button" className="btn-secondary" onClick={onPopulateDefaults}>
                <Icon name="Target" weight="duotone" size={16} color="var(--primary)" /> Install the shipped defaults
              </button>
            )}
          </div>
        </div>
      )}

      {!nothingExists && shown.length === 0 && (
        /*
          NOTHING MATCHES. The shipped screen printed "Create your first AI
          prompt to get started!" here — over a library that already held
          prompts, with no way back except guessing which of four controls was
          the culprit.
        */
        <div className="plib-nomatch" data-testid="plib-nomatch">
          <h3>
            No prompts match {activeFilterCount === 1 ? 'this filter' : `these ${activeFilterCount} filters`}
          </h3>
          <p>
            {prompts.length} prompt{prompts.length === 1 ? '' : 's'} exist
            {prompts.length === 1 ? 's' : ''}.
            {drops.length ? ' Removing any one of these gets you results:' : ''}
          </p>
          <div className="plib-drops">
            {drops.map((drop) => (
              <button
                key={drop.key}
                type="button"
                className="plib-drop"
                onClick={() => set(
                  drop.key === 'search' ? { search: '' } : { [drop.key]: 'all' }
                )}
              >
                <Icon name="X" weight="bold" size={12} color="currentColor" />
                {drop.label} <em>— {drop.count} prompt{drop.count === 1 ? '' : 's'}</em>
              </button>
            ))}
          </div>
          <button type="button" className="plib-btn-link" onClick={clearAll}>
            Clear all filters
          </button>
        </div>
      )}

      {!nothingExists && shown.length > 0 && (
        <table className="plib-tbl">
          <thead>
            <tr>
              <th className="plib-col-name">Prompt</th>
              <th className="plib-col-type">Type</th>
              <th className="plib-col-cat">{categoryHeading}</th>
              <th className="plib-col-state">State</th>
              <th className="plib-col-acts" />
            </tr>
          </thead>
          <tbody>
            {shown.map((prompt) => (
              <tr key={prompt.promptId || prompt.name}>
                <td>
                  <span className="plib-nm">{prompt.name}</span>
                  {prompt.description && <span className="plib-sub">{prompt.description}</span>}
                  {prompt.tags && prompt.tags.length > 0 && (
                    <span className="plib-tags">
                      {prompt.tags.map((tag) => (
                        <span key={tag} className="plib-tag">{tag}</span>
                      ))}
                    </span>
                  )}
                </td>
                <td>
                  <span className="plib-chip plib-chip--type">
                    {gameTypeLabel(prompt.gameType)}
                  </span>
                </td>
                <td className="plib-cat">
                  {prompt[categoryKey] ? catLabel(prompt[categoryKey]) : '—'}
                </td>
                <td>
                  <div className="plib-states">
                    <span className={`plib-chip ${statusChipClass(prompt.status)}`}>
                      {STATUS_LABEL[prompt.status] || prompt.status || 'Draft'}
                    </span>
                    {prompt.isDefault && (
                      <span
                        className="plib-chip plib-chip--warn"
                        title={`Runs for every ${gameTypeLabel(prompt.gameType)} set in this environment that has no prompt of its own.`}
                      >
                        Default
                      </span>
                    )}
                    {/* A generation-format prompt attached to a question set
                        does nothing at runtime — the summary engine rejects it
                        and silently uses the game-type default. */}
                    {flagSummaryUsability && prompt.summaryPromptStatus === 'unusable' && (
                      <span
                        className="plib-chip plib-chip--bad"
                        title={`Cannot be used as a summary prompt: ${prompt.summaryPromptDefect || 'wrong format'}`}
                      >
                        <Icon name="Warning" weight="fill" size={12} color="currentColor" /> Not a summary prompt
                      </span>
                    )}
                    {prompt.malformed && (
                      <span
                        className="plib-chip plib-chip--bad"
                        title="This record has no promptId attribute. It cannot be attached to a question set safely — run scripts/cull-ai-prompts.js."
                      >
                        <Icon name="Warning" weight="fill" size={12} color="currentColor" /> Broken record
                      </span>
                    )}
                  </div>
                </td>
                <td>
                  <div className="plib-rowact">
                    {onEdit && (
                      <button
                        type="button"
                        className="plib-btn"
                        onClick={() => onEdit(prompt)}
                        title="Edit this prompt"
                      >
                        Edit
                      </button>
                    )}
                    {onAdvise && (
                      <button
                        type="button"
                        className="plib-btn"
                        onClick={() => onAdvise(prompt)}
                        title="Ask the AI advisor about this prompt"
                      >
                        Advisor
                      </button>
                    )}
                    {onDelete && (
                      <button
                        type="button"
                        className="plib-btn plib-btn--ghostdanger"
                        onClick={() => onDelete(prompt.promptId)}
                        title="Archive this prompt"
                      >
                        Archive
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
