import React, { useCallback, useEffect, useState } from 'react';
import Icon from './Icon';
import Modal from './Modal';
import SetImageBadge from './SetImageBadge';
import QuestionSetUploadPanel from './QuestionSetUploadPanel';
import QuestionSetDeleteDialog from './QuestionSetDeleteDialog';
import QuestionSetEditor from './QuestionSetEditor';
import { authFetch } from '../auth/authFetch';
import { adminApiUrl } from '../utils/adminApi';
import { gameTypeLabel } from '../config/gameTypes';
import { buildEditPayload, editableSnapshot, summarizeEditResult } from '../utils/questionSetEditing';
import './QuestionSetsPanel.css';

/**
 * THE HOST'S QUESTION SETS — opened from the create-engagement screen.
 *
 * The owner: *"exposing the create question sets to the hosts … only question
 * sets that are created by a host can be edited by that host … the interface
 * for entry to this is create engagements."*
 *
 * A HOST IS NOT AN ADMIN, AND THIS MUST NOT READ AS THE CONSOLE LEAKING. The
 * admin Question Sets tab is a library manager: forty-one rows, filters, sort,
 * active/quickstart curation, versions, media, the prompt library, the AI
 * builders. None of that is a host's job and most of it is a route a host cannot
 * call. What a host wants, standing in front of a room ten minutes before it
 * starts, is three verbs — make one, fix the name on one, throw one away — over
 * a shelf that is theirs. So this is a small dialog over the create screen, not
 * a tab, and it shows a SHELF rather than a library.
 *
 * WHAT IT SHOWS, AND WHY ONLY THAT. Rows are filtered to `canManage`, which the
 * SERVER computes with the same function the edit and delete handlers enforce
 * with (`admin/shared/question-set-access.js`, projected by
 * `admin/get-question-sets.js`). So a control can never appear for an action the
 * API would refuse. The library's other sets are counted in one sentence and
 * given no controls at all — a disabled Delete on somebody else's set is an
 * invitation and a lie, and hiding their existence entirely would leave a host
 * wondering where the sets they can PLAY went. They can play all of them; they
 * can change theirs.
 *
 * THE AFFORDANCE IS NOT THE PERMISSION. Everything here would still be refused
 * by the API if the request were made by hand: `auth/authorizer.js` decides who
 * reaches the route, `question-set-access.js` decides which row they may change,
 * and `tests/question-set-ownership.js` drives both with hand-made events and no
 * UI. This component draws what is true; it does not enforce it. That is why
 * every failed request below renders the SERVER's message rather than a local
 * guess — if the two ever disagree, the person sees the one that decided.
 *
 * FETCHES ITS OWN LIST, ON PURPOSE. `GameSetupDialog` is a pure props component
 * whose test mocks nothing, and `GameHostPage` cannot be mounted in jsdom at
 * all. Keeping the network here leaves both of those true and gives this dialog
 * the ownership-bearing projection (`GET /admin/question-sets`) that the public
 * picker endpoint deliberately does not carry.
 */

/** The picker shape, from the admin projection. Only ACTIVE sets can be played. */
function toPickerSets(sets) {
  return sets
    .filter((set) => set.active)
    .map((set) => ({
      id: set.id,
      name: set.name,
      totalQuestions: set.totalQuestions ?? set.questionCount ?? 0,
      hasImages: set.hasImages === true,
      engagementType: set.engagementType,
    }));
}

export default function HostQuestionSetsDialog({
  /** The format the create screen is on, so a new set defaults to it. */
  engagementType = 'call-and-answer',
  onClose,
  /**
   * Called with the full refreshed list whenever it changes, so the create
   * screen's picker can offer a set the moment it exists instead of after a
   * page reload.
   */
  onSetsChanged,
}) {
  const [sets, setSets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null);       // { text, tone }
  const [creating, setCreating] = useState(false);
  const [newSetType, setNewSetType] = useState(engagementType);
  const [editing, setEditing] = useState(null);     // { id, name, description, busy }
  const [deleting, setDeleting] = useState(null);   // a set
  // The set whose QUESTIONS are open in the shared editor, and whether that
  // editor is holding an unsaved working copy.
  const [editingQuestions, setEditingQuestions] = useState(null);
  const [editorDirty, setEditorDirty] = useState(false);

  const load = useCallback(async (announce) => {
    setLoading(true);
    setError('');
    try {
      const response = await authFetch(adminApiUrl('admin/question-sets'));
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(result.error || `Could not load your question sets (HTTP ${response.status}).`);
        return undefined;
      }
      const all = result.questionSets || [];
      setSets(all);
      if (onSetsChanged) onSetsChanged(toPickerSets(all));
      if (announce) setNotice({ text: announce, tone: 'success' });
      // Returned so a caller that is showing ONE of these rows can re-point at
      // the fresh copy rather than keeping the stale object it opened with.
      return all;
    } catch (e) {
      setError(`Could not load your question sets: ${e.message}`);
      return undefined;
    } finally {
      setLoading(false);
    }
  }, [onSetsChanged]);

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // `canManage` is the SERVER's answer, computed by the same function the edit
  // and delete handlers enforce with. Never re-derived here from a group claim:
  // two implementations of one rule is how a UI ends up offering what the API
  // refuses.
  const mine = sets.filter((set) => set.canManage);
  /*
    HOUSE SETS ARE NOW LISTED, NOT COUNTED.
    They used to be a sentence — "N other sets are available to play" — because
    the only controls on offer were Rename and Delete, and a disabled Delete on
    somebody else's set is an invitation to ask for a permission that does not
    exist. Copy-and-edit is a different kind of control: it needs no permission
    over the original at all, so the reason for withholding it does not apply.
  */
  const house = sets.filter((set) => !set.canManage);
  const theirs = house.length;

  const saveEdit = async () => {
    const target = sets.find((set) => set.id === editing.id);
    if (!target || !editing.name.trim()) return;
    setEditing({ ...editing, busy: true });
    try {
      const payload = buildEditPayload(
        editing.name,
        { ...editableSnapshot(target), description: editing.description.trim() },
        editableSnapshot(target)
      );
      const response = await authFetch(
        adminApiUrl(`admin/edit-question-set/${encodeURIComponent(editing.id)}`),
        { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        // THE REAL ANSWER, NOT A LOCAL GUESS. A 403 here means the API and this
        // list disagree about who owns the set; the API is the one that decided,
        // so its sentence is what gets shown.
        setNotice({ text: result.error || `Save failed (HTTP ${response.status}).`, tone: 'error' });
        setEditing({ ...editing, busy: false });
        return;
      }
      setEditing(null);
      await load(summarizeEditResult(payload.name, result.updated));
    } catch (e) {
      setNotice({ text: `Save failed: ${e.message}`, tone: 'error' });
      setEditing({ ...editing, busy: false });
    }
  };

  return (
    <Modal
      overlayClassName="qsets qsets--onlight qsets-scrim qsets-scrim--over"
      contentClassName="qsets-modal qsets-modal--wide"
      labelledBy="hqs-title"
      onClose={() => onClose && onClose()}
    >
      <header>
        <Icon name="Books" weight="duotone" size={20} color="var(--primary)" />
        <div className="qsets-grow">
          <h2 id="hqs-title">Your question sets</h2>
          <p className="qsets-dim">
            Sets you made. You can rename or delete these; everything else in the library stays
            as your administrator left it.
          </p>
        </div>
        {/*
          THE SAME `×` IN THE SAME CORNER as the editor this dialog opens and as
          QuestionsPanel's question dialog inside that. It replaced a text
          "Close" button, which was the only surface in this three-deep stack
          spelling the control differently — and the corner is where people look
          first, so it is the one that has to be predictable.
        */}
        <button
          type="button"
          className="qs-dialog-close"
          onClick={() => onClose && onClose()}
          aria-label="Close your question sets"
          title="Close your question sets"
          data-testid="hqs-close"
        >
          ×
        </button>
      </header>

      <div className="qsets-modal-body">
        {notice && notice.text && (
          <div
            className={`qsets-alert${notice.tone === 'error' ? ' qsets-alert--error' : ' qsets-alert--success'}`}
            role={notice.tone === 'error' ? 'alert' : 'status'}
          >
            <Icon
              name={notice.tone === 'error' ? 'Warning' : 'Check'}
              weight="fill"
              size={16}
              color="currentColor"
            />
            <span>{notice.text}</span>
            <button type="button" className="qsets-alert-close" onClick={() => setNotice(null)}>
              Dismiss
            </button>
          </div>
        )}

        {error && (
          <div className="qsets-alert qsets-alert--error" role="alert">
            <Icon name="Warning" weight="fill" size={16} color="currentColor" />
            <span>{error}</span>
            <button type="button" className="qsets-alert-close" onClick={() => load()}>
              Try again
            </button>
          </div>
        )}

        {loading && sets.length === 0 && <p className="qsets-loading">Loading your question sets…</p>}

        {!loading && !error && mine.length === 0 && (
          /*
            NOT the console's three-path empty state. Two of those three paths
            are admin-only routes, and a host reading "Generate with AI" would
            be reading about a button that is not here.
          */
          <div className="qsets-empty">
            <Icon name="Books" weight="duotone" size={34} color="var(--muted)" />
            <h3>You haven&apos;t made a question set yet</h3>
            <p>
              Download the template for the format you want, fill in your questions, and upload
              it. It becomes yours: only you and an administrator can change it.
            </p>
          </div>
        )}

        {mine.length > 0 && (
          <table className="qsets-tbl">
            <thead>
              <tr>
                <th className="qsets-col-set">Set</th>
                <th className="qsets-col-type">Format</th>
                <th className="qsets-col-qs">Qs</th>
                <th className="qsets-col-acts" />
              </tr>
            </thead>
            <tbody>
              {mine.map((set) => (
                editing && editing.id === set.id ? (
                  <tr key={set.id}>
                    <td colSpan={4}>
                      <div className="qsets-field">
                        <label htmlFor={`hqs-name-${set.id}`}>Name</label>
                        <input
                          id={`hqs-name-${set.id}`}
                          type="text"
                          className="qsets-input"
                          value={editing.name}
                          disabled={editing.busy}
                          onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                        />
                      </div>
                      <div className="qsets-field">
                        <label htmlFor={`hqs-desc-${set.id}`}>Description</label>
                        <input
                          id={`hqs-desc-${set.id}`}
                          type="text"
                          className="qsets-input"
                          value={editing.description}
                          disabled={editing.busy}
                          onChange={(event) => setEditing({ ...editing, description: event.target.value })}
                        />
                      </div>
                      <div className="qsets-actions">
                        <button
                          type="button"
                          className="qsets-btn qsets-btn--primary"
                          disabled={editing.busy || !editing.name.trim()}
                          onClick={saveEdit}
                        >
                          {editing.busy ? 'Saving…' : 'Save'}
                        </button>
                        <button
                          type="button"
                          className="qsets-btn"
                          disabled={editing.busy}
                          onClick={() => setEditing(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={set.id}>
                    <td>
                      <span className="qsets-nm">
                        {set.name}
                        <SetImageBadge hasImages={set.hasImages} />
                      </span>
                      {!set.active && <span className="qsets-sub">Not offered in the picker</span>}
                    </td>
                    <td>
                      <span className="qsets-chip qsets-chip--type">{gameTypeLabel(set.engagementType)}</span>
                    </td>
                    <td className="qsets-num">{set.totalQuestions ?? 0}</td>
                    <td>
                      <div className="qsets-rowact">
                        {/*
                          THE SAME EDITOR THE CONSOLE USES, on a row the SERVER
                          said `canManage` on. It is drawn here and nowhere else
                          for the same reason Rename and Delete are: `mine` is
                          `sets.filter((set) => set.canManage)`, computed by
                          `admin/shared/question-set-access.js` and projected by
                          `admin/get-question-sets.js`, so the control cannot
                          appear for a set the replace would refuse.

                          Rename edits the NAME. This edits the QUESTIONS — the
                          thing a host actually came to change, and until now the
                          only way to change one was to re-upload the whole CSV.
                        */}
                        <button
                          type="button"
                          className="qsets-btn qsets-btn--sm"
                          onClick={() => { setEditorDirty(false); setEditingQuestions(set); }}
                        >
                          Edit questions
                        </button>
                        <button
                          type="button"
                          className="qsets-btn qsets-btn--sm"
                          onClick={() => setEditing({
                            id: set.id,
                            name: set.name || '',
                            description: set.description || '',
                            busy: false,
                          })}
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          className="qsets-btn qsets-btn--sm qsets-btn--ghostdanger"
                          onClick={() => setDeleting(set)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              ))}
            </tbody>
          </table>
        )}

        {!loading && theirs > 0 && (
          /*
            THE HOUSE SHELF, AND THE ONE CONTROL THAT MAKES SENSE ON IT.

            The owner's model: editing a set you own makes a new VERSION of it;
            editing a set an administrator made gives you a NEW SET of your own.
            The second half is what this section is for.

            Copy-and-edit needs no permission over the original — it reads the
            questions (that route is unauthenticated) and writes a set the host
            owns, through `POST admin/upload-questions` with `customTitle`, which
            is on the host route list and stamps them as the creator. Rename and
            Delete are still absent, and still for the original reason: those
            need authority over somebody else's row, and offering a disabled
            control invites a request for a permission that does not exist.

            The outcome is in the button, not in a dialog afterwards. "Copy and
            edit" is a different promise from "Edit questions" one table up, and
            the person should be able to tell which they are getting before they
            press it — QuestionsPanel then honours that promise on save, since it
            already routes a save from a caller without `canManage` into a new
            set rather than a replace.
          */
          <>
            <p className="qsets-dim">
              {theirs} set{theirs === 1 ? '' : 's'} below {theirs === 1 ? 'was' : 'were'} made by an
              administrator. You can play {theirs === 1 ? 'it' : 'them'} as {theirs === 1 ? 'it is' : 'they are'},
              or take your own copy to change — the original stays untouched.
            </p>
            <table className="qsets-tbl">
              <tbody>
                {house.map((set) => (
                  <tr key={set.id} data-testid={`house-${set.id}`}>
                    <td className="qsets-col-set">
                      <span className="qsets-nm">{set.name || set.id}</span>
                    </td>
                    <td className="qsets-col-type">{gameTypeLabel(set.engagementType)}</td>
                    <td className="qsets-col-qs">{set.totalQuestions || 0}</td>
                    <td className="qsets-col-acts">
                      <div className="qsets-rowact">
                        <button
                          type="button"
                          className="qsets-btn qsets-btn--sm"
                          onClick={() => { setEditorDirty(false); setEditingQuestions(set); }}
                          title={`Take your own copy of ${set.name || set.id} and edit it`}
                        >
                          Copy and edit
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        <div className="qsets-head">
          <span className="qsets-head-grow" />
          <button
            type="button"
            className="qsets-btn qsets-btn--primary"
            onClick={() => setCreating(!creating)}
          >
            <Icon name="Plus" weight="bold" size={14} color="currentColor" />
            {creating ? 'Hide new set' : 'New question set'}
          </button>
        </div>

        {creating && (
          /*
            THE SHARED FORM, NOT A COPY. The CSV contract and its preflight are
            identical for both audiences; what is switched off is the admin
            machinery around it — the AI builders (admins-only routes, modals
            owned by AdminPage), the prompt library, /builder, and the two
            instruction fields that belong to library curation rather than to
            getting a room playing. An unset promptId resolves a
            type-appropriate default at run time, so nothing is lost by not
            asking.
          */
          <QuestionSetUploadPanel
            /* Unconditional here: this only renders when `creating` is true,
               which only a press can make it. The dialog body is the scroller
               (`.qsets-modal` is `overflow: auto`, `max-height: 86vh`), and a
               host with several sets plus the house shelf above them has the
               same off-screen form the console had. */
            scrollIntoViewOnMount
            engagementType={newSetType}
            onEngagementTypeChange={setNewSetType}
            showAIBuilder={false}
            showManualBuilder={false}
            showSummaryPrompt={false}
            showAdvancedFields={false}
            heading="New question set"
            intro={
              <>
                Download the template for the format you want, fill it in, and upload it. The
                format decides how your columns are read, so pick it first.
              </>
            }
            onUploaded={(message) => {
              setCreating(false);
              load(message);
            }}
          />
        )}
      </div>

      {/*
        THE WAY OUT AT THE BOTTOM TOO. `.qsets-modal` is `max-height: 86vh;
        overflow: auto` and its header does not stick, so a host with a shelf of
        sets and the New question set form open has scrolled the header — and
        with it the only close control — off the top. Escape and the backdrop
        both still work here (this scrim gates neither), but neither is
        discoverable and neither exists on a tablet. `.qsets-modal footer`
        already carries the layout; it was simply never used on this dialog.
      */}
      <footer>
        <span className="qsets-grow" />
        <button type="button" className="qsets-btn" onClick={() => onClose && onClose()}>
          Close
        </button>
      </footer>

      {editingQuestions && (
        /*
          THE ADMIN EDITOR, MOUNTED HERE — not a host copy of it. The owner:
          *"expose the same style (maybe the same modal etc) to the host question
          set screens. why recreate everything."* So this is
          `components/QuestionSetEditor.jsx` verbatim, with three flags off.

          A DOM DESCENDANT OF `.qsets-scrim--over`, DELIBERATELY, and not hoisted
          out through `afterContent`. `.qsets-scrim--over` is `position: fixed`
          with z-index 10001, so it is its own STACKING CONTEXT, and a positioned
          child of it stacks inside that context whatever its z-index — which is
          why `.qsets-scrim`'s 60 paints above the dialog here and why the delete
          dialog below already works. Hoisted, this scrim would land beside
          `.new-game-overlay`'s 10000 instead of inside it, and the question
          dialog the editor opens (`.modal-overlay`, z-index 9999) would paint
          BEHIND the host dialog. `Modal.topmostEntry()` decides by DOM
          containment for the same reason, so hoisting would also degrade Escape
          to its mount-order tiebreak.

          `.qsets-modal`'s `overflow: auto` does not clip any of it: every layer
          from here down is `position: fixed`, whose containing block is the
          viewport, so overflow on an ancestor cannot reach it. That is also what
          keeps `CategoryPicker`'s absolutely-positioned `.qs-cat-list` safe —
          it sits inside the question dialog, which is fixed.

          ESCAPE IS GATED ON THE WORKING COPY. The editor's Cancel already asks
          before dropping unsaved questions; Escape is answered by this Modal,
          which cannot reach that dialog, so it simply declines while there is
          something to lose. Same predicate shape as QuestionsPanel's own
          `closeOnEscape={() => !aiBusy}`.
        */
        <Modal
          overlayClassName="qsets-scrim"
          contentClassName="qsets-editor-frame"
          label={`Edit ${editingQuestions.name || editingQuestions.id}`}
          closeOnBackdrop={false}
          closeOnEscape={() => !editorDirty}
          onClose={() => setEditingQuestions(null)}
        >
          <QuestionSetEditor
            questionSet={editingQuestions}
            availableSets={sets}
            /*
              OFF, AND EACH FOR A ROUTE REASON. Download and the three version
              routes are admins-only in `auth/authorizer.js`; AI generation is
              admins-only AND Bedrock spend, which is the owner's call to make,
              not this component's. The flags mean that call is one boolean.
            */
            showVersions={false}
            showDownload={false}
            showAIAssist={false}
            onDirtyChange={setEditorDirty}
            onSaved={(message) => { setEditingQuestions(null); load(message); }}
            onChanged={async () => {
              const all = await load();
              const fresh = (all || []).find((item) => item.id === editingQuestions.id);
              // Re-point rather than close: a questions save is not a reason to
              // put the host back on the shelf, but the header's counts and the
              // next version number come off this object.
              if (fresh) setEditingQuestions(fresh);
            }}
            onCancel={() => setEditingQuestions(null)}
          />
        </Modal>
      )}

      {deleting && (
        /*
          THE SHARED DIALOG, UNCHANGED. It needs no ownership prop: it is only
          ever opened from a row the server already said `canManage` on, and
          the handler refuses regardless. `onDeactivate` is deliberately not
          passed — the Active toggle is admin curation, and offering a host a
          "deactivate instead" button that 403s would be worse than not
          offering it.
        */
        <QuestionSetDeleteDialog
          questionSet={deleting}
          onCancel={() => setDeleting(null)}
          onDeleted={(message) => {
            setDeleting(null);
            load(message);
          }}
        />
      )}
    </Modal>
  );
}
