import React, { useCallback, useEffect, useState } from 'react';
import PromptBeforeAfter from './PromptBeforeAfter';
import StatusMessage from './StatusMessage';
import {
  REPO_FIELD_LABEL, fieldText, shortDate, shortDateTime,
} from '../utils/repoPromptMatch';

/**
 * THE VERSIONS TAB — docs/design/prompt-versions/ frame 3, inside the editor.
 *
 * Every version of this prompt, newest first: when it was saved, by whom, and
 * how it came to exist. View one, compare it with the live one, or make it
 * live again. Making a version live moves a pointer and nothing else — no
 * version is deleted or rewritten, and the one that was live stays in the
 * list (update-ai-prompt.js `makeVersionLive`).
 *
 * MAKE LIVE IS PRESSED TWICE, armed in place: the first press turns the button
 * into "Make vN live again?" and says, in the foot, what the second press does.
 * It is a reversible act, so it does not earn a dialog — and a dialog opened
 * from inside the editor's dialog is the one thing the container rule forbids.
 *
 * `api` is `{ list(), get(version), makeLive(version) }`, each a promise —
 * AIPromptManager wires them to GET/PUT admin/ai-prompts; a test passes fakes.
 */

const HOW_LABEL = {
  edit: 'Edited here',
  upload: 'Uploaded a file',
  repo: 'From the repo',
  archive: 'Imported from the archive',
  seed: 'Seeded default',
  unknown: 'Before version history',
};

export function howLabel(v) {
  const base = HOW_LABEL[v && v.how] || HOW_LABEL.unknown;
  if (v && v.how === 'repo' && v.repoCommitDate) return `${base} (deploy ${shortDate(v.repoCommitDate)})`;
  return base;
}

const PARTS = ['instructions', 'outputFormat', 'outputSections', 'template', 'description'];

export default function PromptVersionsPanel({ api, live, dirty = false, onMadeLive, onCount }) {
  const [state, setState] = useState({ loading: true, error: '', versions: [] });
  const [shown, setShown] = useState(null);        // { version, mode: 'view'|'compare', content }
  const [armed, setArmed] = useState(null);        // version number armed for make-live
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const body = await api.list();
      const versions = Array.isArray(body && body.versions) ? body.versions : [];
      setState({ loading: false, error: '', versions, listingError: body && body.listingError });
      if (onCount) onCount(versions.length);
    } catch (e) {
      setState({ loading: false, error: e.message, versions: [] });
    }
  }, [api, onCount]);

  useEffect(() => { load(); }, [load]);

  const liveEntry = state.versions.find((v) => v.live);

  const open = async (version, mode) => {
    setArmed(null);
    setNotice('');
    if (shown && shown.version === version && shown.mode === mode) { setShown(null); return; }
    try {
      const body = await api.get(version);
      setShown({ version, mode, content: (body && body.content) || {} });
    } catch (e) {
      setNotice(`Version ${version} could not be read: ${e.message}`);
    }
  };

  const makeLive = async (version) => {
    if (armed !== version) { setArmed(version); setNotice(''); return; }
    setBusy(true);
    setNotice('');
    try {
      await api.makeLive(version);
      setArmed(null);
      setShown(null);
      await load();
      setNotice(`v${version} is live. The version that was live stays in the list.`);
      if (onMadeLive) onMadeLive(version);
    } catch (e) {
      setNotice(`v${version} was not made live — ${e.message} Nothing was changed.`);
    } finally {
      setBusy(false);
    }
  };

  if (state.loading && state.versions.length === 0) {
    return <div className="pmgr-advisor-body pmgr-ver" data-testid="pmgr-versions"><p className="pmgr-ver-hint">Loading versions…</p></div>;
  }
  if (state.error) {
    return (
      <div className="pmgr-advisor-body pmgr-ver" data-testid="pmgr-versions">
        <StatusMessage message={`The versions could not be loaded (${state.error}). Nothing has changed.`} tone="error" />
        <button type="button" className="btn-secondary" onClick={load}>Try again</button>
      </div>
    );
  }

  return (
    <div className="pmgr-advisor-body pmgr-ver" data-testid="pmgr-versions">
      {state.listingError && (
        <p className="pmgr-ver-hint" data-testid="pmgr-versions-partial">
          Only the versions recorded since version history began are listed — the stored files could not be read
          ({state.listingError}).
        </p>
      )}
      <table className="pmgr-ver-tbl">
        <thead>
          <tr>
            <th className="pmgr-ver-col-v">Version</th>
            <th className="pmgr-ver-col-saved">Saved</th>
            <th className="pmgr-ver-col-by">By</th>
            <th className="pmgr-ver-col-how">How</th>
            <th className="pmgr-ver-col-acts" />
          </tr>
        </thead>
        <tbody>
          {state.versions.map((v) => (
            <tr key={v.version} data-testid={`pmgr-ver-row-${v.version}`}>
              <td><strong>v{v.version}</strong></td>
              <td>{shortDateTime(v.savedAt)}</td>
              <td className="pmgr-ver-by" title={v.by || ''}>{v.by || '—'}</td>
              <td>
                {howLabel(v)}
                {v.live && <span className="pmgr-ver-live" data-testid={`pmgr-ver-live-${v.version}`}>Live</span>}
                {v.missing && <span className="pmgr-ver-missing">File missing</span>}
              </td>
              <td>
                <div className="pmgr-ver-acts">
                  <button type="button" className="btn-secondary" onClick={() => open(v.version, 'view')} disabled={v.missing}
                    data-testid={`pmgr-ver-view-${v.version}`}>
                    View
                  </button>
                  {!v.live && (
                    <button type="button" className="btn-secondary" onClick={() => open(v.version, 'compare')} disabled={v.missing}
                      data-testid={`pmgr-ver-compare-${v.version}`}>
                      Compare with live
                    </button>
                  )}
                  {!v.live && (
                    <button
                      type="button"
                      className={`btn-secondary pmgr-ver-make${armed === v.version ? ' pmgr-ver-make--armed' : ''}`}
                      onClick={() => makeLive(v.version)}
                      disabled={busy || dirty || v.missing}
                      title={dirty ? 'Save or discard the edits in the Edit tab first.' : undefined}
                      data-testid={`pmgr-ver-make-${v.version}`}
                    >
                      {armed === v.version ? `Make v${v.version} live again?` : 'Make live'}
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {shown && (
        <div className="pmgr-ver-shown" data-testid={`pmgr-ver-${shown.mode}`}>
          {shown.mode === 'view' && PARTS.filter((f) => fieldText(f, shown.content[f])).map((f) => (
            <section key={f} className="result-section">
              <h4>v{shown.version} · {REPO_FIELD_LABEL[f] || f}</h4>
              <pre className="pmgr-ver-pre">{fieldText(f, shown.content[f])}</pre>
            </section>
          ))}
          {shown.mode === 'compare' && PARTS
            .filter((f) => fieldText(f, shown.content[f]) || fieldText(f, live && live[f]))
            .map((f) => (
              <PromptBeforeAfter
                key={f}
                title={`${REPO_FIELD_LABEL[f] || f}: v${shown.version} → live${liveEntry ? ` (v${liveEntry.version})` : ''}`}
                before={fieldText(f, shown.content[f])}
                after={fieldText(f, live && live[f])}
                testId={`pmgr-ver-cmp-${f}`}
                changedWord="differs"
              />
            ))}
        </div>
      )}

      <div className="pmgr-ver-foot">
        {armed !== null && (
          <span className="pmgr-ver-armed" role="status" data-testid="pmgr-ver-armed">
            Press again to make v{armed} live.{liveEntry ? ` v${liveEntry.version} stays in the list.` : ''}
          </span>
        )}
        {dirty && armed === null && (
          <span className="pmgr-ver-hint">Save or discard the edits in the Edit tab before making another version live.</span>
        )}
        {notice && <StatusMessage message={notice} />}
        <span className="pmgr-ver-hint">
          Nothing here is ever deleted. A Workie read already written keeps what it was given; the next one reads the
          live version.
        </span>
      </div>
    </div>
  );
}
