import React, { useCallback, useEffect, useState } from 'react';
import { authFetch } from '../auth/authFetch';
import { SKINS, DEFAULT_SKIN, isSkinId, skinById } from '../config/skins';
import { useSkin } from './SkinProvider';
import './SiteSkinPanel.css';

/**
 * ENGAGE SETTINGS — THE SITE LOOK (docs/design/themes/SPEC.md §5.4).
 *
 * Which skin every page of Engage wears, for every visitor, signed in or not.
 * Classic by default. Read from and written to GET / POST
 * /platform/settings/site-skin (lambda-functions/admin/orgs/platform-settings.js);
 * staff only — the nav lists this section in Engage mode, and the route
 * re-checks the staff group and writes the audit log before it changes
 * anything. Everyone else gets the change on their next page load (GET /site
 * is cached up to a minute); this tab follows at once.
 *
 * PREVIEW (SPEC Q7): "Preview in this browser" puts the chosen skin on this
 * browser only, without saving — so staff can walk a tier in Present before
 * anybody else sees it. It is remembered here until ended.
 *
 * THE SWATCH THE SPEC DREW IS NOT HERE, ON PURPOSE. SPEC §5.4 proposed a
 * preview swatch per skin "by temporarily scoping data-skin on the swatch".
 * That cannot render: each skin's values are declared on
 * `:root[data-skin="<id>"]` (styles/skins/*.css), so a data-skin on a nested
 * element matches nothing and would show Classic for both. The preview is
 * the whole page instead, which is also the honest one. This file sets no
 * data-skin of its own; SkinProvider owns the attribute.
 */
const API = () => window.API_BASE || '';
const URL_PATH = 'platform/settings/site-skin';

function formatDate(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function SiteSkinPanel() {
  const { preview, setPreview, setSiteSkin } = useSkin();
  const [data, setData] = useState(null);
  const [choice, setChoice] = useState(DEFAULT_SKIN);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await authFetch(`${API()}${URL_PATH}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `The server answered ${res.status}.`);
      setData(body);
      setChoice(isSkinId(body.skin) ? body.skin : DEFAULT_SKIN);
    } catch (err) {
      setData(null);
      setError(err.message || 'Could not read the setting.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const current = data && isSkinId(data.skin) ? data.skin : DEFAULT_SKIN;
  const changed = Boolean(data) && choice !== current;

  const save = async (e) => {
    e.preventDefault();
    if (!changed || saving) return;
    setSaving(true);
    setError('');
    setSaved('');
    try {
      const res = await authFetch(`${API()}${URL_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skin: choice, reason: reason.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `The server answered ${res.status}. Nothing was changed.`);
      setData(body);
      setReason('');
      setSiteSkin(body.skin);
      setSaved(`Saved. Engage wears ${skinById(body.skin).name} for everyone from their next page load, within a minute.`);
    } catch (err) {
      setError(err.message || 'Nothing was changed.');
    } finally {
      setSaving(false);
    }
  };

  const changedOn = data ? formatDate(data.updatedAt) : '';

  return (
    <div className="sks" data-theme="dark">
      {error && <p className="sks-alert" role="alert">{error}</p>}
      {loading && !data && <p className="sks-muted">Reading the setting…</p>}
      {data && (
        <form className="sks-set" aria-labelledby="sks-title" onSubmit={save}>
          <div className="sks-words">
            <h2 id="sks-title" className="sks-h">Site look</h2>
            <p className="sks-now">
              Now:
              {' '}
              <b>{skinById(current).name}</b>
              {data.isDefault ? ' (the default)' : ''}
            </p>
          </div>

          <fieldset className="sks-options">
            <legend className="sks-sr">Which look every page wears</legend>
            {SKINS.map((s) => {
              const id = `sks-skin-${s.id}`;
              return (
                <label key={s.id} htmlFor={id} className={`sks-option${choice === s.id ? ' is-selected' : ''}`}>
                  <input
                    id={id}
                    type="radio"
                    name="sks-skin"
                    value={s.id}
                    checked={choice === s.id}
                    onChange={() => { setChoice(s.id); setSaved(''); }}
                  />
                  <span className="sks-option-words">
                    <span className="sks-option-name">
                      {s.name}
                      {s.id === current && <span className="sks-inuse">In use</span>}
                    </span>
                    <span className="sks-option-desc">{s.description}</span>
                  </span>
                </label>
              );
            })}
          </fieldset>

          <div className="sks-field">
            <label htmlFor="sks-reason" className="sks-label">Why (written to the audit log)</label>
            <input
              id="sks-reason"
              className="sks-input"
              type="text"
              maxLength={600}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Optional"
            />
          </div>

          <div className="sks-actions">
            <button type="submit" className="sks-btn" disabled={!changed || saving}>
              {saving ? 'Saving…' : `Use ${skinById(choice).name} for everyone`}
            </button>
            <button
              type="button"
              className="sks-btn sks-btn--quiet"
              onClick={() => setPreview(preview === choice ? null : choice)}
            >
              {preview === choice ? 'End preview' : `Preview ${skinById(choice).name} in this browser`}
            </button>
          </div>

          {preview && (
            <p className="sks-note" role="status">
              {`This browser is previewing ${skinById(preview).name}. Everyone else sees ${skinById(current).name}.`}
              {' '}
              <button type="button" className="sks-link" onClick={() => setPreview(null)}>End preview</button>
            </p>
          )}
          {saved && <p className="sks-note sks-note--saved" role="status">{saved}</p>}
          <p className="sks-foot">
            {changedOn ? `Last changed ${changedOn} by Engage staff. ` : 'Never changed: every page wears Classic. '}
            A running Presentation or stage keeps its look until it is reloaded.
          </p>
        </form>
      )}
    </div>
  );
}
