import React, { useCallback, useEffect, useState } from 'react';
import { authFetch } from '../auth/authFetch';
import './ClaudeModelsPanel.css';

/**
 * ENGAGE SETTINGS — the Claude models switch (owner, 2026-10-11): "I want 5.5
 * to be the default API call in the session. I want the option to set these
 * in the admin pages … For now set this at the Engage level for everyone."
 *
 * Built from docs/design/claude-55-switch/index.html. One setting, read from
 * and written to GET / POST /platform/settings/claude-models
 * (lambda-functions/admin/orgs/platform-settings.js). Staff only: the nav
 * lists this in Engage mode, and the route re-checks the staff group and
 * writes the audit log before it changes anything.
 *
 * ON (the default, and what an absent row means): Bedrock Haiku 4.5 calls go
 * to Claude Haiku 5.5 and Bedrock Sonnet 4.6 calls to Claude Sonnet 5.5 on the
 * Anthropic API, falling back to Bedrock on any failure. OFF: Bedrock as
 * before. Where the tier has no Anthropic connection the switch is shown
 * disabled with the reason in words.
 *
 * No confirm: the change is reversible with the same click.
 */
const API = () => window.API_BASE || '';
const URL_PATH = 'platform/settings/claude-models';

const MODEL_ROWS = [
  { bedrock: 'Claude Haiku 4.5', api: 'Claude Haiku 5.5' },
  { bedrock: 'Claude Sonnet 4.6', api: 'Claude Sonnet 5.5' },
];

/** One model in a row: muted unless it is the one answering, which says In use. */
function Model({ name, where, short, active }) {
  return (
    <span className={`cms-model${active ? ' is-active' : ''}`} data-active={active || undefined}>
      <span className="cms-model-name">{name}</span>
      {/* Narrow screens hide the column headings, so each model says where it runs. */}
      <span className="cms-where" aria-hidden="true">{short}</span>
      <span className="cms-sr">{` on ${where}${active ? ', in use' : ', not in use'}`}</span>
      {active && <span className="cms-inuse" aria-hidden="true">In use</span>}
    </span>
  );
}

export const NOT_CONNECTED = 'Anthropic API not connected on this tier. Every call stays on Bedrock until its federation ids are set.';

export default function ClaudeModelsPanel() {
  const [data, setData] = useState(null);
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
    } catch (err) {
      setData(null);
      setError(err.message || 'Could not read the setting.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = async () => {
    if (!data || !data.connected || saving) return;
    const next = !data.anthropic55;
    setSaving(true);
    setError('');
    setSaved('');
    try {
      const res = await authFetch(`${API()}${URL_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ anthropic55: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `The server answered ${res.status}. Nothing was changed.`);
      setData(body);
      const secs = body.takesEffectWithinSeconds || 60;
      setSaved(next
        ? `Saved. Calls move to the 5.5 models within ${secs === 60 ? 'a minute' : `${secs} seconds`}.`
        : `Saved. Every call is on Bedrock within ${secs === 60 ? 'a minute' : `${secs} seconds`}.`);
    } catch (err) {
      setError(err.message || 'Nothing was changed.');
    } finally {
      setSaving(false);
    }
  };

  const on = Boolean(data && data.anthropic55);
  const connected = Boolean(data && data.connected);
  const effective55 = Boolean(data && data.effective === 'anthropic-5-5');

  return (
    <div className="cms" data-theme="dark">
      {error && <p className="cms-alert" role="alert">{error}</p>}
      {loading && !data && <p className="cms-muted">Reading the setting…</p>}
      {data && (
        <section className="cms-set" aria-labelledby="cms-claude-models">
          <div className="cms-top">
            <div className="cms-words">
              <h2 id="cms-claude-models" className="cms-h">Claude models</h2>
              <p className="cms-now">
                Now:
                {' '}
                <b>{effective55 ? 'Anthropic API, 5.5 models' : 'Bedrock, 4.x models'}</b>
                {effective55 && data.isDefault ? ' (the default)' : ''}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={on && connected}
              aria-labelledby="cms-claude-models cms-switch-label"
              className={`cms-switch${on && connected ? ' is-on' : ''}`}
              disabled={!connected || saving}
              onClick={toggle}
            >
              <span className="cms-track" aria-hidden="true" />
              <span id="cms-switch-label">Anthropic 5.5</span>
            </button>
          </div>

          {/* Both models on each row; the one actually answering is marked In use
              (owner, 2026-10-11). It follows what is in effect, so a tier with no
              Anthropic connection marks Bedrock whatever the setting says. */}
          <div className="cms-map">
            <div className="cms-maphead" aria-hidden="true">
              <span>Bedrock 4.x</span>
              <span>Anthropic API 5.5</span>
            </div>
            <ul aria-label="Which model answers">
              {MODEL_ROWS.map((row) => (
                <li key={row.api}>
                  <Model name={row.bedrock} where="Bedrock" short="Bedrock" active={!effective55} />
                  <Model name={row.api} where="the Anthropic API" short="Anthropic API" active={effective55} />
                </li>
              ))}
            </ul>
          </div>
          {!connected && <p className="cms-note" role="status">{NOT_CONNECTED}</p>}
          {connected && (saved
            ? <p className="cms-note cms-note--saved" role="status">{saved}</p>
            : (
              <p className="cms-foot">
                {on ? 'Turn it off to keep every call on Bedrock 4.x. ' : 'Turn it on to send these calls to the Anthropic API. '}
                A change reaches every function within a minute. A call that fails on the Anthropic API is answered by the Bedrock model. Other models, such as the staff picker&apos;s Opus, are not affected.
              </p>
            ))}
        </section>
      )}
    </div>
  );
}
