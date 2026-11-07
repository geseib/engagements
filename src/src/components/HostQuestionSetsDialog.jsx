import React, { useCallback, useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import Modal from './Modal';
import { DialogHead, DialogFoot } from './ui/DialogParts';
import Button from './ui/Button';
import HelpButton from './HelpButton';
import { helpFor } from '../config/help/screens';
import AIScenarioBuilder from './AIScenarioBuilder';
import TriviaAIBuilder from './TriviaAIBuilder';
import PollAIBuilder from './PollAIBuilder';
import SurveyAIBuilder from './SurveyAIBuilder';
import SetImageBadge from './SetImageBadge';
import QuestionSetUploadPanel from './QuestionSetUploadPanel';
import QuestionSetDeleteDialog from './QuestionSetDeleteDialog';
import { QuestionSetPlace, setPath } from './QuestionSetPage';
import { authFetch } from '../auth/authFetch';
import {
  isUnreadableSet, unreadableSetName,
  UNREADABLE_LABEL, UNREADABLE_REASON, UNREADABLE_SUB,
} from '../utils/unreadableSet';
import DraftsStrip from './DraftsStrip';
import DraftReview from './DraftReview';
import { listDrafts } from '../utils/draftsApi';
import { uploadGeneratedSet, generatedSetPendingNotice } from '../utils/generatedSetUpload';
import PlanLimitNotice from './PlanLimitNotice';
import { setOwnerLabel, setOwnerTitle, setOwnerIsOurs } from '../utils/setOwnerTag';
import { adminApiUrl } from '../utils/adminApi';
import { gameTypeLabel } from '../config/gameTypes';
import { buildEditPayload, editableSnapshot, summarizeEditResult } from '../utils/questionSetEditing';
import SetFilterBar, { SET_LIST_CONFIG, SET_FILTER_LABELS } from './SetFilterBar';
import useListControls from '../hooks/useListControls';
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

/*
  THE SAME FILTERS AS THE CONSOLE'S LIST, FROM THE SAME MODULE (SetFilterBar).
  The owner, 23 Oct 2026, asked for "search, filter by mine/team/public/engage
  or by date or by tag" as libraries grow; this dialog got the search box and
  nothing else, while the console got every filter. The owner, 7 Nov 2026:
  "why in the host home page question set explorer do they not feature the
  same filter treatments?" Now it does — type first, then topic, status, owner,
  date, sort and the shelf browse — through the console's own config, so a word
  or a filter finds the same sets in both, and a filter added there lands here.

  The header above ("filters, sort … None of that is a host's job") was written
  about the console's CURATION — Active toggles, versions, media, prompts —
  which a host still does not get. Finding a set in a growing library is a
  host's job, and the owner has said so twice.
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
  /*
    WHERE TO OPEN (docs/design/new-engagement frame 5c): the create screen's
    no-match state offers three ways to make a set, and each lands straight in
    its builder rather than on the shelf.
      'ai'       the AI builder for `engagementType` (Make a set with Workie)
      'template' the New question set panel: template, then upload
      'manual'   the same panel, whose routes include writing them by hand
      ''         the shelf, as before
  */
  initialRoute = '',
}) {
  const [sets, setSets] = useState([]);
  const [setAllowance, setSetAllowance] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(null);       // { text, tone }
  const [creating, setCreating] = useState(initialRoute === 'template' || initialRoute === 'manual');
  const [newSetType, setNewSetType] = useState(engagementType);
  const [editing, setEditing] = useState(null);     // { id, name, description, busy }
  const [deleting, setDeleting] = useState(null);   // a set
  // The set whose QUESTIONS are open in the shared editor, and whether that
  // editor is holding an unsaved working copy.
  const [editingQuestions, setEditingQuestions] = useState(null);
  const [editorDirty, setEditorDirty] = useState(false);
  /*
    THE SET'S ADDRESS (experience plan 5e). Opening a set moves the address bar
    to `/sets/<id>` (pushState, so nothing reloads and this shelf keeps its
    state), and the browser's Back returns here. A reload or a pasted link lands
    on the same page through App.jsx's `/sets/<id>` route. `pushedFrom` is the
    address to return to, and says the history entry is ours to pop.
  */
  const pushedFrom = useRef(null);
  const placeBack = useRef(null);
  const dirtyRef = useRef(false);
  dirtyRef.current = editorDirty;
  const editingId = editingQuestions ? editingQuestions.id : '';
  const editingScope = editingQuestions ? editingQuestions.scope : '';
  useEffect(() => {
    if (!editingId || typeof window === 'undefined' || !window.history?.pushState) return;
    if (pushedFrom.current !== null) return;
    pushedFrom.current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.history.pushState({ engageSetPlace: editingId }, '', setPath({ id: editingId, scope: editingScope }));
  }, [editingId, editingScope]);
  /** Leave the set's page for the shelf, and give the address bar back. */
  const closeSetPlace = useCallback(() => {
    setEditingQuestions(null);
    setEditorDirty(false);
    if (pushedFrom.current !== null && typeof window !== 'undefined') {
      const from = pushedFrom.current;
      pushedFrom.current = null;
      // Ours to pop while it is still the entry on top; otherwise only say
      // where we are, without spending a history entry.
      if (window.history.state && window.history.state.engageSetPlace) window.history.back();
      else window.history.replaceState(window.history.state, '', from);
    }
  }, []);
  /* The browser's Back while the set is open returns to the shelf. With an
     unsaved working copy the page is put back and the editor ASKS, exactly as
     its own exits do — the browser's Back must not be the one way out that
     drops an afternoon's work without a word. */
  useEffect(() => {
    if (!editingId) return undefined;
    const onPop = () => {
      if (pushedFrom.current === null) return;
      if (dirtyRef.current) {
        window.history.pushState({ engageSetPlace: editingId }, '', setPath({ id: editingId, scope: editingScope }));
        if (placeBack.current) placeBack.current();
        return;
      }
      pushedFrom.current = null;
      setEditingQuestions(null);
      setEditorDirty(false);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [editingId, editingScope]);
  /* Unmounted with the set open (the screen behind closed): put the address
     bar back where it was. */
  useEffect(() => () => {
    if (pushedFrom.current !== null && typeof window !== 'undefined' && window.history?.replaceState) {
      window.history.replaceState(null, '', pushedFrom.current);
      pushedFrom.current = null;
    }
  }, []);
  /** The search and the filters. One bar over both lists, not one each. */
  const controls = useListControls(sets, SET_LIST_CONFIG, { labels: SET_FILTER_LABELS });
  const { state: filters, set: setFilters, shown, drops, activeFilterCount, clearAll } = controls;
  /** The id of the set whose quickstart flag is currently in flight, or null. */
  const [quickstartBusy, setQuickstartBusy] = useState(null);
  /*
    WORKIE'S TWO LISTS — the prompt library and the persona library.

    THE BUG THESE FIX IS A MISSING PROP, NOT A MISSING FEATURE. The editor
    mounted below is `QuestionSetEditor` verbatim, and it already draws both
    controls; `AdminPage.jsx` hands it `availablePrompts` and
    `availablePersonas` and this dialog handed it neither. A select with only
    its own default option in it does not read as "nothing was passed", it
    reads as "this environment has none" — so a host looking for where Workie
    is chosen found two dead controls and concluded, reasonably, that the
    setting did not exist.

    BOTH ROUTES ARE ALREADY A HOST'S. `GET admin/ai-prompts` and
    `GET admin/personas` are in `HOST_ADMIN_ROUTES` (auth/authorizer.js), the
    second with a note saying its earlier absence "was an oversight, not a
    policy". Nothing here opens a route or asks for one.

    `null` UNTIL ONE GENUINELY ARRIVES (ruling W6). These started as `[]`, and
    the failure paths below leave them where they are, so a 403 reached the
    editor as an empty library — which the editor then reported to the host as
    "No voices are set up on this environment yet". That sentence is a
    diagnosis of the ENVIRONMENT, and a refused request is no evidence for it.
    An empty array now means the library answered and held nothing; `null`
    means nobody has said. The warns below are the operator's half of the same
    distinction; this is the host's.
  */
  const [availablePrompts, setAvailablePrompts] = useState(null);
  const [availablePersonas, setAvailablePersonas] = useState(null);
  /*
    WHICH BUILDER IS OPEN, or null. `showAIBuilder` was passed to
    QuestionSetUploadPanel without an `onOpenBuilder`, so the button rendered,
    passed its own test, and did nothing — the panel's onClick is
    `onOpenBuilder && onOpenBuilder(type)`, and the guard made the omission
    silent. The builders are mounted HERE for the same reason the editor is:
    the console owns them, this dialog is the host's way to the same thing, and
    a host copy of four large components would be four places to fix.
  */
  const [builder, setBuilder] = useState(() => {   // 'scenario' | 'trivia' | 'poll' | 'survey'
    if (initialRoute !== 'ai') return null;
    if (engagementType === 'trivia' || engagementType === 'poll' || engagementType === 'survey') return engagementType;
    return 'scenario';
  });
  /*
    GENERATIONS THE PERSON STARTED — now read from the SERVER (GET
    /admin/generation-drafts/list), not from this browser's memory: every run
    writes a draft that lasts thirty days, so the strip is the same on every
    device and still there days later. Read when the dialog opens and whenever
    a builder closes; the review it opens is what polls a running one.
  */
  const [drafts, setDrafts] = useState([]);
  const [reviewDraft, setReviewDraft] = useState(null);
  const refreshDrafts = useCallback(async () => {
    try {
      const res = await listDrafts();
      if (res && res.ok) setDrafts((res.data && res.data.drafts) || []);
    } catch (e) { /* the bell still says what waits */ }
  }, []);
  useEffect(() => { refreshDrafts(); }, [builder, refreshDrafts]);
  /** A builder's run finished into a draft: review it here. */
  const openDraftReview = ({ draftId, libraryKey = '' }) => {
    setBuilder(null);
    setReviewDraft({ draftId, libraryKey });
  };

  /*
    THE FOUR BUILDERS, ONE DOOR. QuestionSetUploadPanel hands back the format
    the host chose, and the builder is picked from it exactly as AdminPage does
    (handleOpenBuilder) — scenario is the default rather than an error, because
    call-and-answer is a scenario generation and every unlisted future type is
    closer to that than to trivia.
  */
  const openBuilder = (type) => {
    if (type === 'trivia') setBuilder('trivia');
    else if (type === 'poll') setBuilder('poll');
    else if (type === 'survey') setBuilder('survey');
    else setBuilder('scenario');
  };

  /*
    WHAT A FINISHED GENERATION DOES HERE. The builder that is open is the one
    finishing, so `builder` names the kind — the same four names
    utils/generatedSetUpload.js takes.

    USUALLY the worker already created the set — `createdSet` on the job row,
    see admin/shared/generated-set.js — so there is nothing to upload and
    uploading would be REFUSED anyway: the importer will not write over a set
    that exists, and it would report that refusal as a failure over a set
    sitting right there. So this re-reads the list and opens the draft, which is
    what AdminPage's own handler does with the same value.

    OTHERWISE the worker could not (the organisation is at its stored-set
    allowance, or the job is older than server-side creation), and the builder
    hands over the kept questions for the PAGE to upload. This used to close and
    re-read and nothing more: nothing was saved, and the builder had already
    forgotten the job, so there was nothing to go back to. It is now the
    console's own upload (uploadGeneratedSet, shared with AdminPage), and a
    plan-limit refusal is the plan-limit notice, as it is there.
  */
  const finishBuilder = async (result) => {
    const kind = builder;
    setBuilder(null);
    const created = result && result.createdSet;
    if (created?.setId) {
      const fresh = await load();
      const row = (fresh || []).find((item) => item.id === created.setId);
      setEditingQuestions(row || { id: created.setId, name: created.setName });
      setNotice({
        text: `“${created.setName}” was created while the generator ran. It is switched off `
          + 'until you review it and turn it on.',
        tone: 'success',
      });
      return;
    }
    setNotice(generatedSetPendingNotice(kind));
    // A scenario set is imported as the format the host picked, which is the
    // one the scenario builder was opened with. The other three are fixed.
    const outcome = await uploadGeneratedSet(kind, result, { engagementType: newSetType });
    setNotice(outcome.notice);
    if (outcome.ok) await load();
  };

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
      setSetAllowance(result.setAllowance || null);
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

  /*
    THE TWO WORKIE LISTS, READ ONCE WHEN THE DIALOG OPENS.

    ON MOUNT RATHER THAN ON THE EDITOR'S MOUNT, deliberately: the editor is
    opened and closed repeatedly against the same shelf, and hanging these off
    it would put two requests on the wire every time a host clicked into a set.
    They are small, unchanging, platform-wide lists — one read per dialog.

    A FAILURE IS SWALLOWED INTO AN EMPTY LIST, which is what both existing
    callers do (`AdminPage.jsx` fetchAvailablePrompts / fetchAvailablePersonas)
    and what this dialog needs: neither list is required to edit a set's
    questions, its name or anything else, so a 403, a 500 or a request that
    never leaves must cost the host that one picker and nothing more. The
    editor renders a select with only its default option in that case, which is
    the same thing it did before this existed.

    SWALLOWED ON SCREEN, NOT IN SILENCE. Both failure paths say so to the
    console, as AdminPage's two fetches of these same endpoints always have.
    Without it the only symptom is a picker holding one option — which is also
    exactly what a correctly working environment with no voices configured
    looks like, so there was no way to tell a missing library from an empty
    one, and a host reporting it left nobody anything to read.

    THE PROMPT LIST IS PASSED RAW (bar the status filter AdminPage applies).
    `QuestionSetEditor` runs `selectableSummaryPrompts()` on it itself and then
    reports `availablePrompts.length - choices.length` as "N prompts for other
    game types are hidden" — filtering here would make that count zero and the
    sentence a lie. Personas are unfiltered for AdminPage's stated reason: the
    engagement type is itself editable, so filtering by it would make voices
    appear and disappear mid-edit.
  */
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const response = await authFetch(adminApiUrl('admin/ai-prompts'));
        if (!response.ok) {
          console.warn(`Prompt library unavailable (${response.status}) — the summary-approach picker will offer its default only`);
          return;
        }
        const data = await response.json().catch(() => ({}));
        if (live) setAvailablePrompts((data.prompts || []).filter((p) => p.status === 'active'));
      } catch (e) {
        // Nothing to say on SCREEN — the picker degrades to its default option
        // — but plenty to say to whoever is asked why it is empty.
        console.warn('Prompt library unavailable:', e);
      }
    })();
    (async () => {
      try {
        const response = await authFetch(adminApiUrl('admin/personas'));
        if (!response.ok) {
          console.warn(`Voice library unavailable (${response.status}) — Workie will adapt to the session, which is the designed default`);
          return;
        }
        const data = await response.json().catch(() => ({}));
        if (live) setAvailablePersonas(data.personas || []);
      } catch (e) {
        // Same: the default on screen stays right, and the reason stops vanishing.
        console.warn('Voice library unavailable:', e);
      }
    })();
    return () => { live = false; };
  }, []);

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

  /*
    WHAT THE SEARCH SHOWS. Each list keeps its own total so its count can say
    "N of M" — a list that only shrank would read as sets having gone.

    A SET BEING WORKED ON IS NEVER HIDDEN. A host renaming "Retro" to
    "Sprint review" would otherwise watch the row vanish mid-word, taking its
    Save and Cancel with it; the same goes for the set whose editor or delete
    dialog is open, so closing it lands back on the row it came from.
  */
  const needle = String(filters.search || '').trim();
  const filtering = activeFilterCount > 0;
  // The search alone keeps its own words ("match “retro”"); any filter turns
  // the sentence into a count of what is narrowing the list.
  const onlySearch = Boolean(needle) && activeFilterCount === 1;
  const narrowedBy = onlySearch
    ? `“${needle}”`
    : activeFilterCount === 1 ? 'this filter' : `these ${activeFilterCount} filters`;
  const inHand = new Set([editing?.id, editingQuestions?.id, deleting?.id].filter(Boolean));
  // `shown` is filtered AND sorted over both lists; a row in hand that the
  // filters would drop is appended rather than lost.
  const passing = new Set(shown.map((set) => set.id));
  const ordered = [...shown, ...sets.filter((set) => inHand.has(set.id) && !passing.has(set.id))];
  const mineShown = ordered.filter((set) => set.canManage);
  const houseShown = ordered.filter((set) => !set.canManage);
  const countOf = (count, total) => (filtering ? `${count} of ${total}` : String(total));
  /*
    THE NO-MATCH LINE NAMES THE SEARCH AND OFFERS THE WAY BACK. "You have no
    sets" would be a lie about a host whose sets are one Esc away; the empty
    state above is for a host who has made none, and only that.
  */
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const nothingFound = filtering && sets.length > 0 && mineShown.length === 0 && houseShown.length === 0;
  /*
    THE WAY BACK, NAMED FOR WHAT IT UNDOES. With several filters in force the
    whole-list message also carries the console's drop-exits (computeDrops):
    each filter that, removed alone, brings rows back, with how many.
  */
  const noMatch = (sentence, testId, withDrops = false) => (
    <div className="qsets-nomatch" data-testid={testId}>
      <p>{sentence}{withDrops && !onlySearch && drops.length ? ' Removing any one of these gets you results:' : ''}</p>
      {withDrops && !onlySearch && drops.length > 0 && (
        <div className="qsets-drops">
          {drops.map((drop) => (
            <button key={drop.key} type="button" className="qsets-drop" onClick={() => controls.clearOne(drop.key)}>
              <Icon name="X" weight="bold" size={12} color="currentColor" />
              {drop.label} <em>— {drop.count} set{drop.count === 1 ? '' : 's'}</em>
            </button>
          ))}
        </div>
      )}
      <Button variant="tertiary" size="sm" className="qsets-clear" onClick={clearAll}>
        {onlySearch ? 'Clear the search' : 'Clear all filters'}
      </Button>
    </div>
  );

  /**
   * Put one of the host's own sets on the quickstart shelf, or take it off.
   *
   * THE SAME CHIP THE CONSOLE HAS, on the same route, drawn only on `mine`.
   * The owner: *"host question set lists, should allow quick starts easily
   * marked by clicking a tag on list just like the admin"*. House rows do not
   * get one for the reason Rename and Delete are absent from them — that would
   * be authority over somebody else's row, and `requireSetManager` in
   * `admin/toggle-quickstart.js` would refuse it.
   *
   * RELOADS RATHER THAN PATCHING STATE. `AdminPage.handleToggleQuickstart`
   * updates its local array optimistically; this does not, because the write
   * also moves `updatedAt` and this dialog is the thing that reports a set's
   * state back to the create screen through `onSetsChanged`. One refetch keeps
   * the shelf, the picker and the timestamp telling the same story.
   */
  const toggleQuickstart = async (set) => {
    const next = !set.quickstart;
    setQuickstartBusy(set.id);
    try {
      const response = await authFetch(
        adminApiUrl(`admin/toggle-quickstart/${encodeURIComponent(set.id)}`),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ quickstart: next }),
        }
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        // The SERVER's sentence, for the reason saveEdit gives: if this list and
        // the API disagree about who owns the set, the API is the one that
        // decided.
        setQuickstartBusy(null);
        setNotice({
          text: result.error || `Could not change quickstart (HTTP ${response.status}).`,
          tone: 'error',
        });
        return;
      }
      setQuickstartBusy(null);
      await load(
        next
          ? `“${set.name}” now appears on the quickstart menu.`
          : `“${set.name}” no longer appears on the quickstart menu.`
      );
    } catch (e) {
      setQuickstartBusy(null);
      setNotice({ text: `Could not change quickstart: ${e.message}`, tone: 'error' });
    }
  };

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

  /*
    THE SHARED FORM, NOT A COPY. The CSV contract and its preflight are
    identical for both audiences; what is switched off is the admin machinery
    around it — the prompt library and the two instruction fields that belong
    to library curation rather than to getting a room playing. An unset
    promptId resolves a type-appropriate default at run time. The builders
    are a host's now (auth/authorizer.js HOST_ADMIN_ROUTES).
  */
  const createPanel = creating ? (
    <QuestionSetUploadPanel
      // The dialog body is the scroller; bring the form into view.
      scrollIntoViewOnMount
      engagementType={newSetType}
      onEngagementTypeChange={setNewSetType}
      showAIBuilder
      onOpenBuilder={openBuilder}
      showManualBuilder
      showSummaryPrompt={false}
      showAdvancedFields={false}
      heading="New question set"
      intro={
        <>
          Pick the format first: it decides how your columns are read. Then fill in its
          template yourself, or copy its prompt into your own chatbot, and upload the file
          at the foot of this panel.
        </>
      }
      onUploaded={(message) => {
        setCreating(false);
        load(message);
      }}
    />
  ) : null;
  /** Opened on a make-a-set route: the panel goes above the shelf. */
  const newFirst = initialRoute === 'manual' || initialRoute === 'template';

  /*
    ONE THING ON SCREEN AT A TIME, NOT A STACK (experience plan 5e; audit E
    §1.5 Q1). The builders, a draft's review and the set editor used to open
    as dialogs INSIDE this one — four layers from the start screen to one
    question. Each now REPLACES the shelf while it is open, and the shelf comes
    back as it was when it closes: this component stays mounted, so the search,
    the notice and the list survive underneath.

    THE CONSOLE'S OWN BUILDERS, not host copies: the console owns them, and a
    host copy of four large components would be four places to fix.
  */
  if (builder === 'scenario') {
    return (
      <AIScenarioBuilder
        engagementType={newSetType}
        onClose={() => setBuilder(null)}
        onScenariosGenerated={finishBuilder}
        onDraftReady={openDraftReview}
      />
    );
  }
  if (builder === 'trivia') {
    return <TriviaAIBuilder onClose={() => setBuilder(null)} onTriviaGenerated={finishBuilder} onDraftReady={openDraftReview} />;
  }
  if (builder === 'poll') {
    return <PollAIBuilder onClose={() => setBuilder(null)} onPollGenerated={finishBuilder} onDraftReady={openDraftReview} />;
  }
  if (builder === 'survey') {
    /* THE PHASE 0 FIX (surveys phases 0+1, fix 2): a finished survey run
       creates a draft set like the other three, so it finishes through the
       same finishBuilder. */
    return <SurveyAIBuilder onClose={() => setBuilder(null)} onSurveyGenerated={finishBuilder} onDraftReady={openDraftReview} />;
  }

  if (reviewDraft) {
    /* THE ONE REVIEW SCREEN (components/DraftReview.jsx): accept, discard or
       restore. Accepting a new set lands it in the list; nothing is saved
       until then. */
    const closeReview = () => { setReviewDraft(null); refreshDrafts(); };
    return (
      <Modal
        overlayClassName="qsets qsets-scrim qsets-scrim--over"
        contentClassName="qsets-modal qsets-modal--wide"
        labelledBy="host-draft-review-title"
        onClose={closeReview}
        theme="dark"
      >
        <DialogHead titleId="host-draft-review-title" title="Review AI draft" titlesClassName="qsets-grow" sub="Nothing is saved until you accept." subClassName="qsets-dim" icon={<Icon name="Sparkle" weight="duotone" size={20} color="currentColor" />} onClose={closeReview} closeLabel="Close the review" closeClassName="qs-dialog-close" />
        <div className="qsets-modal-body">
          <DraftReview
            draftId={reviewDraft.draftId}
            libraryKey={reviewDraft.libraryKey}
            onClose={closeReview}
            onChanged={() => { load(); refreshDrafts(); }}
          />
        </div>
        <DialogFoot cancel={<Button size={44} onClick={closeReview}>Back to your question sets</Button>} />
      </Modal>
    );
  }

  if (editingQuestions) {
    /*
      THE SET IS A PLACE (components/QuestionSetPage.jsx): a page with its own
      address, `/sets/<id>`, that replaces this shelf instead of opening inside
      it. The same editor the console uses, with the host's three flags off
      (HOST_EDITOR_FLAGS: versions, download and AI drafting are admins-only
      routes and Bedrock spend), and the two Workie lists this shelf already
      read — so the set's Workie can be chosen here too.

      Inside `Modal` only for its behaviour — Escape, the Tab trap, focus
      restore — on an opaque full-viewport scrim, so it reads as a page.
      ESCAPE IS GATED ON THE WORKING COPY: the editor's own exits ask before
      dropping unsaved questions; Escape declines while there is something to
      lose.
    */
    return (
      <Modal
        overlayClassName="qsp-scrim"
        contentClassName="qsp-frame"
        labelledBy="qsp-title"
        theme="dark"
        closeOnBackdrop={false}
        closeOnEscape={() => !editorDirty}
        onClose={closeSetPlace}
      >
        <QuestionSetPlace
          questionSet={editingQuestions}
          backLabel="Your question sets"
          onBack={closeSetPlace}
          backRef={placeBack}
          /* The shelf's banner travels with the host: a set the generator just
             made opens here, and the sentence about it must not wait behind. */
          notice={notice && !notice.limit ? notice : null}
          onDismissNotice={() => setNotice(null)}
          editorProps={{
            setAllowance,
            availableSets: sets,
            availablePrompts,
            availablePersonas,
            onDirtyChange: setEditorDirty,
            onSaved: (message) => { closeSetPlace(); load(message); },
            onChanged: async () => {
              const all = await load();
              const fresh = (all || []).find((item) => item.id === editingQuestions.id);
              // Re-point rather than close: a questions save is not a reason to
              // put the host back on the shelf, but the counts come off this object.
              if (fresh) setEditingQuestions(fresh);
            },
          }}
        />
      </Modal>
    );
  }

  return (
    <Modal
      /* DUSK, LIKE THE TWO SCREENS THAT OPEN IT. This was `.qsets--onlight` — a
         paper re-tint written when the create-session card was white. That card
         (`.gsd`) and the welcome screen are both dusk now, which left this the
         one white dialog in the host's path: "slightly the wrong style". The
         theme is DECLARED, not inherited, because from the welcome screen this
         overlay is a sibling of `.wel-page` and would otherwise resolve to
         `<html data-theme="light">`. */
      overlayClassName="qsets qsets-scrim qsets-scrim--over"
      contentClassName="qsets-modal qsets-modal--wide qsets-modal--shelf"
      theme="dark"
      labelledBy="hqs-title"
      onClose={() => onClose && onClose()}
    >
      <DialogHead titleId="hqs-title" title="Your question sets" titlesClassName="qsets-grow" sub="Sets you made. You can rename or delete these; everything else in the library stays as your administrator left it." subClassName="qsets-dim" icon={<Icon name="Books" weight="duotone" size={20} color="var(--primary)" />} onClose={() => onClose && onClose()} closeLabel="Close your question sets" closeClassName="qs-dialog-close" closeProps={{ 'data-testid': "hqs-close" }}>
        {/* The setup guide's question-set section (Help Phase 3). */}
        <HelpButton {...helpFor('host-question-sets')} variant="inline" size="small" tooltip="Help: question sets" className="help-button-quiet" />
        {/*
          THE SAME `×` IN THE SAME CORNER as the editor this dialog opens and as
          QuestionsPanel's question dialog inside that. It replaced a text
          "Close" button, which was the only surface in this three-deep stack
          spelling the control differently — and the corner is where people look
          first, so it is the one that has to be predictable.
        */}
      </DialogHead>

      <div className="qsets-modal-body">
        {/* A PLAN LIMIT (`notice.limit`) is the shared notice — what ran out and
            what THIS reader can do about it (22-plan-limit-notice.html), as
            QuestionSetsPanel draws it in the console. Everything else is the
            one banner. A `pending` notice is neither success nor error, so it
            takes neither tint and no tick. */}
        {notice && notice.limit ? (
          <PlanLimitNotice refusal={notice.limit} outcome={notice.outcome} onDismiss={() => setNotice(null)} />
        ) : notice && notice.text ? (
          <div
            className={`qsets-alert${notice.tone === 'error' ? ' qsets-alert--error' : ''}${
              notice.tone === 'success' ? ' qsets-alert--success' : ''
            }`}
            role={notice.tone === 'error' ? 'alert' : 'status'}
          >
            <Icon
              name={notice.tone === 'error' ? 'Warning' : notice.tone === 'pending' ? 'Clock' : 'Check'}
              weight="fill"
              size={16}
              color="currentColor"
            />
            <span>{notice.text}</span>
            <button type="button" className="qsets-alert-close" onClick={() => setNotice(null)}>
              Dismiss
            </button>
          </div>
        ) : null}

        {/*
          A GENERATION THE PERSON STARTED, said where its RESULT will appear.

          Reported: "the question set doesnt get generated in the list until i
          click AI builder and see the status of the generation … it should still
          show up in the list with a review button to take you to the output."

          The job is real, it runs server-side whether or not anything is
          watching (the worker self-invokes; see admin/shared/generation-handler
          .js), and it takes minutes. Until now the only surface that knew was
          the modal it was started in — so closing that modal made a running job
          invisible, and an unchanged list reads as "nothing happened".

          `role="status"` and not `alert`: this is progress, not a problem, and
          an assertive live region would interrupt a screen reader mid-row.
        */}
        <DraftsStrip drafts={drafts} onOpen={(d) => setReviewDraft({ draftId: d.draftId, libraryKey: '' })} />

        {/* OPENED TO MAKE A SET (the create screen's "Make a new set" and its
            routes): the new-set panel comes FIRST, not 1,900px below every
            set in the library (live dev test 1 B3). */}
        {newFirst && createPanel}

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

        {sets.length > 0 && (
          /*
            ONE BAR OVER BOTH LISTS — the console's own (SetFilterBar), type
            first. A host looking for "the retro one" does not
            know, and should not need to know, whether it is theirs or the
            library's. Esc empties the box and stops there: the Modal answers Esc
            at the document, so stopping it here is what keeps a host who only
            meant to clear the search from losing the dialog. An empty box lets
            Esc through, and it closes the dialog as it does anywhere else.
          */
          <SetFilterBar
            sets={sets}
            controls={controls}
            search={{
              ariaLabel: 'Search your question sets and the library',
              testId: 'hqs-search',
              onKeyDown: (event) => {
                if (event.key === 'Escape' && filters.search) {
                  event.preventDefault();
                  event.stopPropagation();
                  setFilters({ search: '' });
                }
              },
            }}
          />
        )}

        {nothingFound && noMatch(
          onlySearch
            ? `No set matches “${needle}”. Searched the name, description and tags of your `
              + `${plural(mine.length, 'set', 'sets')} and ${plural(theirs, 'other', 'others')}.`
            : `No set matches ${narrowedBy}, across your `
              + `${plural(mine.length, 'set', 'sets')} and ${plural(theirs, 'other', 'others')}.`,
          'hqs-nomatch',
          true
        )}

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
              Download the template for the format you want (or copy its prompt into your own
              chatbot), fill in your questions, and upload it. It becomes yours: only you and an
              administrator can change it.
            </p>
          </div>
        )}

        {mine.length > 0 && !nothingFound && (
          <h3 className="qsets-listhead">
            Your sets <span className="qsets-count" data-testid="hqs-mine-count">{countOf(mineShown.length, mine.length)}</span>
          </h3>
        )}

        {mine.length > 0 && mineShown.length === 0 && !nothingFound && noMatch(
          mine.length === 1
            ? `Your one set does not match ${narrowedBy}.`
            : `None of your ${mine.length} sets match ${narrowedBy}.`,
          'hqs-mine-nomatch'
        )}

        {mineShown.length > 0 && (
          <table className="qsets-tbl">
            <thead>
              <tr>
                <th className="qsets-col-set">Set</th>
                <th className="qsets-col-type">Format</th>
                <th className="qsets-col-qs">Qs</th>
                <th className="qsets-col-state">Shelf</th>
                <th className="qsets-col-acts" />
              </tr>
            </thead>
            <tbody>
              {mineShown.map((set) => (
                editing && editing.id === set.id ? (
                  <tr key={set.id}>
                    <td colSpan={5}>
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
                        <Button
                          variant="secondary" size={36} className="qsets-lead"
                          disabled={editing.busy || !editing.name.trim()}
                          onClick={saveEdit}
                        >
                          {editing.busy ? 'Saving…' : 'Save'}
                        </Button>
                        <Button
                          variant="secondary" size={36}
                          disabled={editing.busy}
                          onClick={() => setEditing(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={set.id}>
                    <td>
                      {/*
                        THESE ARE THE ORG'S OWN SETS, WHICH IS THE ONLY CONTENT
                        THAT IS ENCRYPTED AT ALL — so this table is where a row
                        the server could not decrypt actually lands. `{set.name}`
                        on a nulled name leaves the row's only identifier blank
                        while Rename and Delete stay pointed at it. The house
                        table below already fell back to the id for a nameless
                        row; this one gets the same handle, and is told apart
                        from a set nobody titled.
                      */}
                      <span className="qsets-nm">
                        {isUnreadableSet(set) ? unreadableSetName(set) : set.name}
                        <SetImageBadge hasImages={set.hasImages} />
                      </span>
                      {isUnreadableSet(set) && (
                        <>
                          <span className="qsets-chip qsets-chip--bad" title={UNREADABLE_REASON}>
                            {UNREADABLE_LABEL}
                          </span>
                          <span className="qsets-sub">{UNREADABLE_SUB}</span>
                        </>
                      )}
                      {/*
                        WHAT IT IS, THEN WHAT FOLLOWS FROM THAT. "Not offered in
                        the picker" is a consequence phrased as a setting, and on
                        a freshly generated set it is the wrong sentence twice
                        over: the person is hunting for the thing they just made,
                        and what they need to know is that nobody has read it yet.

                        An inactive set the host switched off themselves is a
                        curation state and keeps the original line — only a
                        generation is unreviewed by construction.
                      */}
                      {!set.active && (
                        <span className="qsets-sub">
                          {set.isAIGenerated && !set.aiReviewedAt
                            ? 'Generated — review it, then switch it on'
                            : 'Not offered in the picker'}
                        </span>
                      )}
                    </td>
                    <td>
                      <span className="qsets-chip qsets-chip--type">{gameTypeLabel(set.engagementType)}</span>
                      {/* WHOSE IT IS — Yours / Team / Engage / Public, on every
                          row. The same rule the console uses, from the same
                          module, because two surfaces deriving "whose is this"
                          separately is two answers waiting to disagree. */}
                      <span
                        className={`qsets-chip${setOwnerIsOurs(set) ? '' : ' qsets-chip--off'}`}
                        title={setOwnerTitle(set)}
                      >
                        {setOwnerLabel(set)}
                      </span>
                      {/* Badged only where it changes what to DO: a generated
                          set nobody has read. Once it is switched on it is an
                          ordinary set and the badge would be noise. */}
                      {!set.active && set.isAIGenerated && !set.aiReviewedAt && (
                        <span className="qsets-chip qsets-chip--warn" title="Written by the generator and not reviewed yet.">
                          Draft
                        </span>
                      )}
                    </td>
                    <td className="qsets-num">{set.totalQuestions ?? 0}</td>
                    <td>
                      <div className="qsets-states">
                        {/*
                          A CHIP THAT IS A BUTTON, exactly as in the console's
                          list — same class, same lightning bolt, same fill-vs-
                          regular weight carrying the state.

                          THE TITLE CHANGES WHEN THE SET IS INACTIVE, and that
                          is not decoration. QuickstartMenu filters on
                          `quickstart && active`, so flagging a set the picker
                          is not offering does nothing visible anywhere. The
                          host would flip the chip, watch it light up, and find
                          the set still missing from the menu with no
                          explanation on screen.
                        */}
                        <button
                          type="button"
                          className={`qsets-chip ${set.quickstart ? 'qsets-chip--warn' : 'qsets-chip--off'}`}
                          onClick={() => toggleQuickstart(set)}
                          disabled={quickstartBusy === set.id}
                          aria-pressed={Boolean(set.quickstart)}
                          data-testid={`hqs-quickstart-${set.id}`}
                          title={
                            set.active
                              ? `Click to ${set.quickstart ? 'remove this set from' : 'offer this set on'} the quickstart menu`
                              : 'This set is not offered in the picker, so it stays off the quickstart menu until it is'
                          }
                        >
                          <Icon
                            name="Lightning"
                            weight={set.quickstart ? 'fill' : 'regular'}
                            size={12}
                            color="currentColor"
                          />
                          Quickstart
                        </button>
                      </div>
                    </td>
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
                        {/*
                          THE SAME DOOR, NAMED FOR WHAT IS BEHIND IT. "Edit
                          questions" is right for a set you already trust and
                          wrong for eight sentences a model wrote a minute ago
                          that nobody has read: the task is to READ them, and
                          then decide. One control, two labels, because the two
                          states are two different jobs.
                        */}
                        {/*
                          NEITHER NEEDS CONTENT THIS ROW DOES NOT HAVE. Edit
                          questions opens the editor on this set's rows and
                          Rename writes back over its name/description — both
                          read as blank or nulled on a row the server could not
                          decrypt, so opening either shows nothing to fix and a
                          save would write over whatever is still recoverable.
                          Delete alone needs no content and stays offered, same
                          as the console's QuestionSetsPanel for the same row.
                        */}
                        {!isUnreadableSet(set) && (
                          <>
                            <Button
                              variant="secondary" size="sm" className={`qsets-act${!set.active && set.isAIGenerated && !set.aiReviewedAt ? ' qsets-lead' : ''}`}
                              onClick={() => { setEditorDirty(false); setEditingQuestions(set); }}
                            >
                              {!set.active && set.isAIGenerated && !set.aiReviewedAt ? 'Review' : 'Edit questions'}
                            </Button>
                            <Button
                              variant="secondary" size="sm" className="qsets-act"
                              onClick={() => setEditing({
                                id: set.id,
                                name: set.name || '',
                                description: set.description || '',
                                busy: false,
                              })}
                            >
                              Rename
                            </Button>
                          </>
                        )}
                        <Button
                          variant="secondary" size="sm" className="qsets-act qsets-del"
                          onClick={() => setDeleting(set)}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              ))}
            </tbody>
          </table>
        )}

        {!loading && theirs > 0 && !nothingFound && (
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
            <h3 className="qsets-listhead">
              Everyone else&apos;s sets <span className="qsets-count" data-testid="hqs-house-count">{countOf(houseShown.length, theirs)}</span>
            </h3>
            <p className="qsets-dim">
              {theirs} set{theirs === 1 ? '' : 's'} below {theirs === 1 ? 'was' : 'were'} made by an
              administrator. You can play {theirs === 1 ? 'it' : 'them'} as {theirs === 1 ? 'it is' : 'they are'},
              or take your own copy to change — the original stays untouched.
            </p>
            {houseShown.length === 0 && noMatch(
              theirs === 1
                ? `The one other set does not match ${narrowedBy}.`
                : `None of the ${theirs} other sets match ${narrowedBy}.`,
              'hqs-house-nomatch'
            )}
            {houseShown.length > 0 && (
              <table className="qsets-tbl">
                <tbody>
                  {houseShown.map((set) => (
                    <tr key={set.id} data-testid={`house-${set.id}`}>
                      <td className="qsets-col-set">
                        <span className="qsets-nm">{set.name || set.id}</span>
                      </td>
                      <td className="qsets-col-type">
                        {gameTypeLabel(set.engagementType)}{' '}
                        {/* THE SHELF IS TWO LIBRARIES, NOT ONE. This section's
                            heading says "made by an administrator", which is true
                            of Engage's rows and NOT of a set another organisation
                            published — and the copy rule differs for neither, so
                            the row has to say which it is. Same module as the
                            table above. */}
                        <span
                          className={`qsets-chip${setOwnerIsOurs(set) ? '' : ' qsets-chip--off'}`}
                          title={setOwnerTitle(set)}
                        >
                          {setOwnerLabel(set)}
                        </span>
                      </td>
                      <td className="qsets-col-qs">{set.totalQuestions || 0}</td>
                      <td className="qsets-col-acts">
                        <div className="qsets-rowact">
                          <Button
                            variant="secondary" size="sm" className="qsets-act"
                            onClick={() => { setEditorDirty(false); setEditingQuestions(set); }}
                            title={`Take your own copy of ${set.name || set.id} and edit it`}
                          >
                            Copy and edit
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}

        <div className="qsets-head">
          <span className="qsets-head-grow" />
          <Button
            variant="primary" size={36}
            onClick={() => setCreating(!creating)}
          >
            <Icon name="Plus" weight="bold" size={14} color="currentColor" />
            {creating ? 'Hide new set' : 'New question set'}
          </Button>
        </div>

        {!newFirst && createPanel}
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
      <DialogFoot>
        <span className="qsets-grow" />
        <Button variant="secondary" size={44} onClick={() => onClose && onClose()}>
          Close
        </Button>
      </DialogFoot>

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
