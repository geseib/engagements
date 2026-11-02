import React, { useCallback, useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import Button from './ui/Button';
import HelpButton from './HelpButton';
import QuestionSetEditor from './QuestionSetEditor';
import { helpFor } from '../config/help/screens';
import { authFetch } from '../auth/authFetch';
import { navigateTo } from '../auth/navigate';
import { adminApiUrl } from '../utils/adminApi';
import { gameTypeLabel } from '../config/gameTypes';
import './QuestionSetPage.css';

/**
 * A QUESTION SET IS A PLACE, NOT A MODAL INSIDE A MODAL (experience plan 5e;
 * audit E §1.5 Q1).
 *
 * Editing one question from the start screen used to be four layers deep:
 * the start screen → the shelf dialog → the set editor dialog → the question
 * dialog. The skill's own rule — "a detail with panels and tables is a place"
 * (engage-design §6) — held in the console and was broken on the host's side.
 *
 * Now the set has its own address, `/sets/<id>`, and its own page:
 *
 *   - From the shelf (HostQuestionSetsDialog) the page REPLACES the shelf rather
 *     than stacking on it, and the address bar moves to `/sets/<id>` with
 *     pushState, so the browser's Back returns to the shelf. The shelf keeps
 *     its state underneath (search, notices), because it stays mounted.
 *   - Opened directly (a reload, a pasted link), App.jsx routes `/sets/<id>` to
 *     QuestionSetPage, which reads the set, the prompt library and the voice
 *     library itself, exactly as the shelf does, and Back returns to wherever
 *     the person came from (else the main menu).
 *
 * What the stacked dialogs held is all here, because it is the same editor:
 * details, categories, questions (add, edit, delete, reorder, pull from
 * another set, Add questions with Workie), the images, and the set's Workie.
 *
 * THE WAY BACK GOES THROUGH THE EDITOR'S OWN requestClose (via `closeRef`), so
 * an unsaved working copy is asked about from the bar's Back, from the
 * browser's Back and from Escape alike — never silently dropped.
 */

/** The host's flags, for a reason each (HostQuestionSetsDialog's comment). */
export const HOST_EDITOR_FLAGS = Object.freeze({
  showVersions: false,
  showDownload: false,
  showAIAssist: false,
});

/** The address of a set's page. */
export function setPath(set) {
  const id = encodeURIComponent(String(set?.id || ''));
  const scope = set?.scope ? `?scope=${encodeURIComponent(String(set.scope))}` : '';
  return `/sets/${id}${scope}`;
}

/** `/sets/<id>` → { id, scope } or null. */
export function setFromLocation(loc = (typeof window !== 'undefined' ? window.location : null)) {
  if (!loc) return null;
  const m = /^\/sets\/([^/]+)\/?$/.exec(loc.pathname || '');
  if (!m) return null;
  let id = '';
  try { id = decodeURIComponent(m[1]); } catch (e) { return null; }
  if (!id) return null;
  const scope = new URLSearchParams(loc.search || '').get('scope') || '';
  return { id, scope };
}

/**
 * The place itself: the bar (Back, the set's name, help) over the editor.
 * Presentational; the caller decides what Back does and supplies the data.
 */
export function QuestionSetPlace({
  questionSet,
  backLabel = 'Your question sets',
  onBack,
  notice = null,
  onDismissNotice,
  editorProps = {},
  titleId = 'qsp-title',
  /** Handed this place's Back, for a caller that hears the browser's Back. */
  backRef = null,
}) {
  const closeRef = useRef(null);
  const name = questionSet?.name || questionSet?.id || 'Question set';
  /* Back asks the editor first: it confirms an unsaved working copy, then
     calls onCancel, which is `onBack`. */
  const back = useCallback(() => {
    if (closeRef.current) closeRef.current();
    else if (onBack) onBack();
  }, [onBack]);
  if (backRef) backRef.current = back;

  return (
    <div className="qsp" data-theme="dark" data-testid="set-place">
      <header className="qsp-bar">
        <Button
          variant="tertiary"
          size={36}
          className="qsp-back"
          onClick={back}
          aria-label={backLabel === 'Back' ? 'Back' : `Back to ${backLabel.toLowerCase()}`}
          data-testid="set-place-back"
        >
          <Icon name="ArrowLeft" weight="bold" size={16} color="currentColor" /> {backLabel}
        </Button>
        <div className="qsp-titles">
          <p className="qsp-eyebrow">
            Question set{questionSet?.engagementType ? ` · ${gameTypeLabel(questionSet.engagementType)}` : ''}
          </p>
          <h1 id={titleId} className="qsp-title" title={name}>{name}</h1>
        </div>
        <HelpButton {...helpFor('host-set-editor')} variant="inline" size="small" tooltip="Help: editing a question set" className="help-button-quiet" />
      </header>
      {notice && notice.text && (
        <div className={`qsp-notice${notice.tone === 'error' ? ' qsp-notice--error' : ''}`} role={notice.tone === 'error' ? 'alert' : 'status'}>
          <Icon name={notice.tone === 'error' ? 'Warning' : 'Check'} weight="fill" size={16} color="currentColor" />
          <span>{notice.text}</span>
          {onDismissNotice && (
            <Button variant="tertiary" size={36} onClick={onDismissNotice}>Dismiss</Button>
          )}
        </div>
      )}
      <main className="qsp-body">
        <QuestionSetEditor
          key={questionSet?.id}
          questionSet={questionSet}
          {...editorProps}
          /* After the caller's props, so no host mount can turn them back on. */
          {...HOST_EDITOR_FLAGS}
          inPlace
          closeRef={closeRef}
          onCancel={onBack}
        />
      </main>
    </div>
  );
}

/** The two Workie lists, read once; `null` until one genuinely answers (ruling W6). */
function useWorkieLists() {
  const [availablePrompts, setAvailablePrompts] = useState(null);
  const [availablePersonas, setAvailablePersonas] = useState(null);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await authFetch(adminApiUrl('admin/ai-prompts'));
        if (!res.ok) { console.warn(`Prompt library unavailable (${res.status})`); return; }
        const data = await res.json().catch(() => ({}));
        if (live) setAvailablePrompts((data.prompts || []).filter((p) => p.status === 'active'));
      } catch (e) { console.warn('Prompt library unavailable:', e); }
    })();
    (async () => {
      try {
        const res = await authFetch(adminApiUrl('admin/personas'));
        if (!res.ok) { console.warn(`Voice library unavailable (${res.status})`); return; }
        const data = await res.json().catch(() => ({}));
        if (live) setAvailablePersonas(data.personas || []);
      } catch (e) { console.warn('Voice library unavailable:', e); }
    })();
    return () => { live = false; };
  }, []);
  return { availablePrompts, availablePersonas };
}

/** Where Back goes from a page opened directly: back in history, else the main menu. */
function leavePage() {
  const ref = typeof document !== 'undefined' ? document.referrer || '' : '';
  const sameOrigin = ref && typeof window !== 'undefined' && ref.startsWith(window.location.origin);
  if (sameOrigin && window.history.length > 1) window.history.back();
  else navigateTo('/');
}

/**
 * `/sets/<id>` opened directly. Reads the set from the host's own list
 * (`GET /admin/question-sets`, the ownership-bearing projection the shelf
 * reads), so `canManage` is the SERVER's answer here too.
 */
export default function QuestionSetPage({ setId, scope = '', onLeave = leavePage }) {
  const [sets, setSets] = useState(null);
  const [setAllowance, setSetAllowance] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null);
  const [currentId, setCurrentId] = useState(setId);
  const { availablePrompts, availablePersonas } = useWorkieLists();

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await authFetch(adminApiUrl('admin/question-sets'));
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || `Could not load this question set (HTTP ${res.status}).`);
        return undefined;
      }
      setSets(body.questionSets || []);
      setSetAllowance(body.setAllowance || null);
      return body.questionSets || [];
    } catch (e) {
      setError(`Could not load this question set: ${e.message}`);
      return undefined;
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const set = (sets || []).find((s) => s.id === currentId && (!scope || String(s.scope || '') === scope))
    || (sets || []).find((s) => s.id === currentId)
    || null;

  if (error) {
    return (
      <div className="qsp qsp--page" data-theme="dark">
        <div className="qsp-state" role="alert">
          <h1 className="qsp-title">This question set did not load</h1>
          <p>{error}</p>
          <div className="qsp-state-acts">
            <Button variant="primary" size={44} onClick={() => load()}>Try again</Button>
            <Button size={44} onClick={onLeave}>Back</Button>
          </div>
        </div>
      </div>
    );
  }
  if (!sets) {
    return (
      <div className="qsp qsp--page" data-theme="dark">
        <p className="qsp-state" role="status">Loading the question set…</p>
      </div>
    );
  }
  if (!set) {
    return (
      <div className="qsp qsp--page" data-theme="dark">
        <div className="qsp-state" role="status">
          <h1 className="qsp-title">No question set here</h1>
          <p>
            This link names a set that is not in your library — it may have been deleted, or it
            belongs to another organisation.
          </p>
          <div className="qsp-state-acts">
            <Button size={44} onClick={onLeave}>Back</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="qsp-page-frame">
      <QuestionSetPlace
        questionSet={set}
        backLabel="Back"
        onBack={onLeave}
        notice={notice}
        onDismissNotice={() => setNotice(null)}
        editorProps={{
          setAllowance,
          availableSets: sets,
          availablePrompts,
          availablePersonas,
          onSaved: async (message) => { await load(); setNotice({ text: message, tone: 'success' }); },
          onChanged: () => load(),
          /* A copy was made: this page now shows THEIR set, at its own address. */
          onCopied: async (newSetId, message) => {
            await load();
            setCurrentId(newSetId);
            if (window.history?.replaceState) window.history.replaceState(window.history.state, '', setPath({ id: newSetId }));
            setNotice({ text: message, tone: 'success' });
          },
        }}
      />
    </div>
  );
}
