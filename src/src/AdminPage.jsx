import React, { useState, useEffect, useRef } from 'react';
import AIScenarioBuilder from './components/AIScenarioBuilder';
import TriviaAIBuilder from './components/TriviaAIBuilder';
import PollAIBuilder from './components/PollAIBuilder';
import SurveyAIBuilder from './components/SurveyAIBuilder';
import AIPromptManager from './components/AIPromptManager';
import AIGenerationPromptEditor from './components/AIGenerationPromptEditor';
import ArchivePanel from './components/ArchivePanel';
import UserManagement from './components/UserManagement';
import SessionsPanel from './components/SessionsPanel';
import HelpButton from './components/HelpButton';
import IssueFab from './components/IssueFab';
import PlatformOrgsPanel from './components/PlatformOrgsPanel';
import { useAuth } from './auth/AuthContext';
import './BuilderPage.css';
import { authFetch } from './auth/authFetch';
import Icon from './components/Icon';
import QuestionSetEditor from './components/QuestionSetEditor';
import QuestionSetsPanel from './components/QuestionSetsPanel';
import QuestionSetDeleteDialog from './components/QuestionSetDeleteDialog';
import QuestionSetUploadPanel from './components/QuestionSetUploadPanel';
import AdminShell from './components/AdminShell';
import OrgSwitcher from './components/OrgSwitcher';
import TeamPanel from './components/TeamPanel';
import BillingPanel from './components/BillingPanel';
import PrivacyPanel from './components/PrivacyPanel';
import {
  sectionsFor, sectionIdsFor, defaultSectionIdFor, sectionById, FOOT_SECTIONS,
  PLATFORM_GROUP, PLATFORM_MODE,
} from './config/consoleSections';
import { getActiveOrgId, setActiveOrgId } from './auth/authFetch';
import { adminApiUrl } from './utils/adminApi';
import { describeEnvironment } from './utils/adminEnvironment';
import {
  SECTION_PARAM, sectionFromSearch, searchForSection, searchMatchesSection,
} from './config/adminSection';
import { tagsToCsvCell } from './utils/tags';
import { csvRow, buildCsv, optionsToCsvCell, allowMultipleToCsvCell } from './utils/csv';

const API_BASE = window.API_BASE;

/**
 * THE SECTIONS, as places rather than tabs.
 *
 * Order and default both changed, for the reason RATIONALE.md §9 gives: every
 * other screen in this console is downstream of a question set, and the console
 * used to open on AI Prompts. "Game Management" is "Sessions" for the same
 * reason the mockups call it that — a tab that can only delete, and only by an
 * id it never shows you, is not management.
 *
 * A subtitle here must be true. Sessions says it has no list, because it has no
 * list: GET /games is deployed and this console has never called it.
 */
const ADMIN_SECTIONS = [
  {
    id: 'questionsets',
    label: 'Question sets',
    icon: 'Books',
    title: 'Question sets',
    subtitle: 'The thing every session is built from.',
    // Converted to dusk in the same change that converted its markup. A panel
    // moved onto the dark work field while still carrying the paper theme's
    // #333 body copy measures 1.4:1 against #0F1A2E — see the header of
    // components/QuestionSetsPanel.css and __tests__/questionSetsPalette.test.js.
    contentTheme: 'dark',
  },
  {
    id: 'games',
    label: 'Sessions',
    icon: 'GameController',
    title: 'Sessions',
    subtitle: 'What hosts have run. Data here expires: 90 days from creation, 7 days after last play.',
    contentTheme: 'dark',
  },
  {
    id: 'prompts',
    label: 'Prompts',
    icon: 'Sparkle',
    title: 'Prompts',
    subtitle: 'Generation prompts build questions; analysis prompts are what Workie says afterwards.',
    // Converted to dusk in the same change that repainted AIPromptManager.css.
    // The two halves are not separable: this flip alone puts `--pc-ink #1a1a1a`
    // on `--bg #0F1A2E` at 1.3:1, and the repaint alone puts #F4EDE4 on the
    // light field at 1.2:1. __tests__/promptEditorPalette.test.js asserts both
    // ends, which is why the assertion it used to make — "the section still
    // carries no contentTheme" — had to be rewritten in this change too.
    // AUDIT §6.2 items 11-15.
    contentTheme: 'dark',
  },
  {
    id: 'archive',
    label: 'Archive',
    icon: 'Package',
    title: 'Archive',
    subtitle: 'A shared, public service. The same store backs all three environments.',
  },
  {
    id: 'users',
    label: 'Users',
    icon: 'UsersThree',
    title: 'Users',
    subtitle: 'Registration lands people in pending. Somebody has to move them.',
    contentTheme: 'dark',
  },
];

const ADMIN_FOOT_SECTIONS = [
  {
    id: 'settings',
    label: 'Settings',
    icon: 'Gear',
    title: 'Settings',
    subtitle: 'Three switches, stored in this browser only.',
  },
];

const ADMIN_SECTION_BY_ID = Object.fromEntries(
  [...ADMIN_SECTIONS, ...ADMIN_FOOT_SECTIONS].map((section) => [section.id, section])
);

/* Derived from the section lists rather than written out again: a section added
   above must become linkable by existing, not by somebody remembering a second
   list. `sectionFromSearch` validates against this, so an id that is not here
   falls back instead of rendering an empty work area. */
const ADMIN_SECTION_IDS = Object.keys(ADMIN_SECTION_BY_ID);
const DEFAULT_ADMIN_SECTION = 'questionsets';

function AdminPage() {
  console.log('🔧 AdminPage component loading with AI builders...');

  const { currentUser, signOut } = useAuth();
  const [questionSets, setQuestionSets] = useState([]);
  const [questionSetsLoading, setQuestionSetsLoading] = useState(true);
  /*
    The session-delete state that used to live here — deleteGameId,
    deleteStatus, isDeleting, showDeleteConfirm, deleteMode — moved into
    components/SessionsPanel.jsx along with the screen it drove. Deleting a
    session is now something you do from the row that names it.

    The same has now happened to the question-set screen, and for the same
    reason: this file cannot be mounted in jsdom (useAuth hard-throws), so
    anything that stays here is untestable. Gone with it:

      - the four filter states and filterQuestionSets(), into
        components/QuestionSetsPanel.jsx, which owns the list, the filters and
        both empty states;
      - every upload-form field, handleFileSelect and handleUploadQuestionSet,
        into components/QuestionSetUploadPanel.jsx;
      - questionSetDeleteStatus / isDeletingQuestionSet /
        showQuestionSetDeleteConfirm, into
        components/QuestionSetDeleteDialog.jsx, which owns its own busy and
        outcome state and stays open until the server answers.

    `engagementType` stays here because the AI builder modals below read it —
    but it is now RENDERED as exactly one <select>, inside the upload panel.
    Two controls over one state was Q6.
  */
  const [engagementType, setEngagementType] = useState('call-and-answer');

  // The set whose delete dialog is open, or null.
  const [deletingSet, setDeletingSet] = useState(null);
  // Whether the creation panel under the list is open.
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  // Debug mode
  const [debugMode, setDebugMode] = useState(() => {
    return localStorage.getItem('admin_debug_mode') === 'true';
  });

  // Prompt improvement debug mode
  const [promptDebugMode, setPromptDebugMode] = useState(() => {
    return localStorage.getItem('prompt_debug_mode') === 'true';
  });

  // WebSocket mode
  const [webSocketMode, setWebSocketMode] = useState(() => {
    const setting = localStorage.getItem('admin_websocket_mode');
    return setting !== null ? setting === 'true' : true; // Default to true
  });
  
  // Edit mode
  const [editMode, setEditMode] = useState(false);
  
  /*
    Which place is open. Question sets, not AI Prompts: RATIONALE.md §9 — every
    other screen in this console is downstream of a question set.

    SEEDED FROM THE URL, not from the constant. `useState`'s argument is the
    INITIAL value, so this reads the address bar once, on mount, and the state
    owns it from then on — which is what makes a reload land where you were and
    a pasted /admin?section=users open Users. `config/adminSection.js` carries
    the argument for the parameter and for validating it.
  */
  const [activeTab, setActiveTab] = useState(() => sectionFromSearch(
    typeof window !== 'undefined' ? window.location.search : '',
    ADMIN_SECTION_IDS,
    DEFAULT_ADMIN_SECTION,
  ));
  /*
    THE ORGANISATIONS THIS ACCOUNT BELONGS TO, and which one it is acting for.

    `GET /orgs` is not only a read: it PROVISIONS the caller's personal
    organisation on first call and returns it in the same response. So this one
    request is what gives a newly-approved host somewhere to put their work, and
    it has to happen before anything offers to create a set or a session — a
    host with no organisation creates content that belongs to nobody.

    Deliberately NOT in AuthContext: that context is loaded by the player and
    entry surfaces too, and a participant joining a session must not be made to
    fetch a list of organisations they do not have.
  */
  const [orgs, setOrgs] = useState([]);
  const [orgsLoaded, setOrgsLoaded] = useState(false);
  const [activeOrgId, setActiveOrgIdState] = useState(() => getActiveOrgId());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch(adminApiUrl('orgs'));
        if (!res.ok) throw new Error(`orgs returned ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        const list = Array.isArray(data.orgs) ? data.orgs : [];
        setOrgs(list);
        /*
          Reconcile the remembered choice against what the server says. An id
          in localStorage the account is no longer a member of must NOT be sent
          — the authorizer resolves an org you do not belong to to NO org, so
          the console would silently act unscoped rather than as the team the
          chip is showing.
        */
        const remembered = getActiveOrgId();
        /* Platform mode is a legitimate remembered value and is NOT an org, so
           it must survive this reconciliation. Without this it fails the
           membership test on every load, gets replaced by the personal org, and
           the console silently drops out of the mode one page after entering
           it — which reads as the switcher not working. Staff only: a stored
           mode on an account that has since lost the group falls through to an
           organisation rather than to a console every route refuses. */
        const staff = (currentUser?.groups || []).includes(PLATFORM_GROUP);
        if (staff && remembered === PLATFORM_MODE) {
          setActiveOrgIdState(PLATFORM_MODE);
          return;
        }
        const valid = list.some((o) => o.orgId === remembered);
        const next = valid ? remembered : (list.find((o) => o.type === 'personal') || list[0])?.orgId || '';
        if (next !== remembered) setActiveOrgId(next);
        setActiveOrgIdState(next);
      } catch (err) {
        console.error('Could not load organisations:', err);
      } finally {
        if (!cancelled) setOrgsLoaded(true);
      }
    })();
    return () => { cancelled = true; };
    /*
      MOUNT ONLY, and `currentUser?.groups` is deliberately not a dependency.

      It is read inside — the platform-mode branch needs to know whether this
      account is still staff — and the rule would have it listed. It must not
      be: `groups` is a fresh array on every render, so listing it re-runs this
      effect on every render, and this effect is the one that PROVISIONS a
      personal organisation and refetches the list. That is a request loop, on
      the request that writes.
    */
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /*
    ── WHO THIS PERSON IS RIGHT NOW ──────────────────────────────────────────

    Three values, and each one was a defect before it was a variable.

    `onPlatform` — Engage staff acting AS Engage rather than inside any org.
    An exclusive mode chosen in the switcher; see config/consoleSections.js for
    why it is not a group of links stacked onto the org nav.

    `activeOrg` — null in platform mode ON PURPOSE. Every org-scoped panel is
    gated on it, so the mode cannot half-apply: there is no state where the nav
    says Engage and a panel below it is still showing an organisation's rows.

    `orgRole` — reads `yourRole` FIRST, and that is a bug fix, not a preference.
    `GET /orgs` answers with `yourRole` (admin/orgs/list-my-orgs.js) because
    `role` on an org row would read as the org's role rather than the caller's.
    This read `activeOrg.role`, got undefined for everybody, and undefined is
    not an admin role — so EVERY team owner was rendered the member nav and lost
    Plan & usage and Data & privacy while still being the person who pays. It
    was reported as "missing most of the menu items". `role` is kept as a
    fallback because the switcher's own fixtures and mockups use it.
  */
  const isStaff = (currentUser?.groups || []).includes(PLATFORM_GROUP);
  const onPlatform = isStaff && activeOrgId === PLATFORM_MODE;
  const activeOrg = onPlatform
    ? null
    : (orgs.find((o) => o.orgId === activeOrgId) || null);
  const orgRole = activeOrg ? (activeOrg.yourRole || activeOrg.role || '') : '';
  const consoleIdentity = {
    groups: currentUser?.groups || [],
    orgRole,
    orgType: activeOrg?.type,
    orgName: activeOrg?.name,
    mode: onPlatform ? PLATFORM_MODE : '',
  };

  // Usage is fetched only when the Plan & usage section is actually open —
  // it is a per-org read nobody needs while looking at question sets.
  const [orgUsage, setOrgUsage] = useState(null);
  const [orgUsageError, setOrgUsageError] = useState('');
  useEffect(() => {
    if (activeTab !== 'billing' || !activeOrgId) return undefined;
    let cancelled = false;
    (async () => {
      try {
        setOrgUsageError('');
        const res = await authFetch(adminApiUrl(`orgs/${activeOrgId}/usage`));
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        // The server's message, never a local guess — the rule every panel on
        // this page follows.
        if (!res.ok) { setOrgUsageError(data.error || `Could not read usage (${res.status}).`); return; }
        setOrgUsage(data);
      } catch (err) {
        if (!cancelled) setOrgUsageError(err.message || 'Could not read usage.');
      }
    })();
    return () => { cancelled = true; };
  }, [activeTab, activeOrgId]);

  /**
   * Take this organisation's own copy of a set Engage or another org publishes.
   *
   * The list is refetched rather than patched: the copy arrives with a server-
   * minted id (a slug that may have been suffixed to avoid colliding with a set
   * this org already had), so guessing it here would show a row that does not
   * exist under a name that is not its own.
   */
  const handleCopySet = async (set) => {
    setNotice({ kind: 'info', text: `Copying ${set.name}…` });
    try {
      const res = await authFetch(
        adminApiUrl(`question-sets/${encodeURIComponent(set.id)}/copy`),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scope: set.scope || 'platform' }),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `The server answered ${res.status}.`);
      await fetchQuestionSets();
      setNotice({
        kind: 'success',
        text: `${body.name} is now yours to change. It is a copy — editing it does not touch the original.`,
      });
    } catch (err) {
      setNotice({ kind: 'error', text: err.message || 'Could not copy that set.' });
    }
  };

  const handleSwitchOrg = (orgId) => {
    setActiveOrgId(orgId);
    /*
      A full reload, not a state update. Every panel on this page has already
      fetched its org's content, and there is no single place that owns all of
      it — a soft switch would leave one team's question sets on screen under
      another team's name, which is the worst possible failure for a tenancy
      feature. Reloading is cheap and unambiguous.
    */
    window.location.reload();
  };

  // The set being edited. Every field of the editor itself now lives in
  // components/QuestionSetEditor.jsx — this page only decides which set is open
  // and shows the confirmation after the editor closes.
  const [editingSetId, setEditingSetId] = useState('');
  /*
    ONE BANNER for everything this page does on the question-set screen's
    behalf: a save that landed, a toggle that failed, an AI-generated set that
    uploaded, a delete that finished. Tone is explicit state — it used to be
    inferred by sniffing the status string for a ✅, which silently broke the
    moment the copy changed.
  */
  const [notice, setNotice] = useState(null); // { text, tone } | null

  // Available prompts for selection
  const [availablePrompts, setAvailablePrompts] = useState([]);
  // The persona library, read from GET /admin/personas. Personas live under
  // SK='PERSONA#' which get-ai-prompts.js hard-filters out, so they need their
  // own endpoint — this is the list that used to be unreachable (D8).
  const [availablePersonas, setAvailablePersonas] = useState([]);

  // AI Scenario Builder
  const [showAIScenarioBuilder, setShowAIScenarioBuilder] = useState(false);

  // AI Trivia Builder
  const [showTriviaAIBuilder, setShowTriviaAIBuilder] = useState(false);

  // AI Poll Builder
  const [showPollAIBuilder, setShowPollAIBuilder] = useState(false);

  // AI Survey Builder
  const [showSurveyAIBuilder, setShowSurveyAIBuilder] = useState(false);

  // Upload section expand/collapse
  const [isUploadSectionExpanded, setIsUploadSectionExpanded] = useState(false);

  /*
    WHICH PROMPT LIBRARY IS OPEN — `null`, `'generation'` or `'analysis'`.

    ONE PIECE OF STATE REPLACED TWO, AND THAT IS THE FIX. It was
    `showGenerationPromptEditor` (a full-screen overlay rendered in the
    top-level fragment beside <IssueFab>, outside every section) and
    `showAnalysisPrompts` (an inline expander below a card in the section). The
    owner: *"the way you get to the Question set AI generator prompts and the
    Engagement results prompts on the prompt admin screen is slightly
    different. they should be the same."* They were reached differently because
    they were STORED differently, so making them the same means one variable
    with three values, not two booleans that happen to be styled alike.

    A single value also makes the two mutually exclusive for free. With two
    booleans it was possible — and easy — to have the analysis list expanded
    underneath while the generation overlay covered it.
  */
  const [promptLibrary, setPromptLibrary] = useState(null);

  const defaultInstructions = "How would you apply this concept in your current role or organization? Consider the specific challenges and opportunities in your context.";

  // Sign-out handler
  const handleSignOut = () => {
    if (window.confirm('Are you sure you want to sign out?')) {
      signOut();
      window.location.href = '/auth';
    }
  };

  // Fetch available AI prompts for selection
  const fetchAvailablePrompts = async () => {
    try {
      const response = await authFetch(`${API_BASE}admin/ai-prompts`);
      if (response.ok) {
        const data = await response.json();
        // Filter to only active prompts for the dropdown
        const activePrompts = (data.prompts || []).filter(prompt => prompt.status === 'active');
        setAvailablePrompts(activePrompts);
      }
    } catch (error) {
      console.error('Error fetching available prompts:', error);
    }
  };

  // Fetch the persona library. Unfiltered on purpose: the editor's engagement
  // type is itself editable, so filtering here would make voices appear and
  // disappear mid-edit. The endpoint's gameType filter is for the host's
  // create dialog, where the type is already fixed.
  const fetchAvailablePersonas = async () => {
    try {
      const response = await authFetch(`${API_BASE}admin/personas`);
      if (!response.ok) {
        console.warn(`Persona list unavailable (${response.status})`);
        return;
      }
      const data = await response.json();
      setAvailablePersonas(data.personas || []);
    } catch (error) {
      console.error('Error fetching personas:', error);
    }
  };

  /** Display name for a stored personaId, or a warning when it resolves to nothing. */
  const personaLabel = (personaId) => {
    const match = availablePersonas.find((p) => p.personaId === personaId);
    return match ? match.name : `${personaId} (unknown — Workie will adapt instead)`;
  };

  // Load prompts when component mounts
  useEffect(() => {
    fetchAvailablePrompts();
    fetchAvailablePersonas();
  }, []);

  /**
   * Open a set. It is a PLACE now, not a section further down the same scroll.
   *
   * What used to be here: `setActiveTab('questionsets')` then a 100ms timeout
   * that queried `.edit-section`, scrolled it into view, painted
   * `element.style.background = '#fff3cd'` with a `#ffc107` border — a
   * light-theme yellow on a dark palette — and reverted both three seconds
   * later. It existed because the form was rendered *after* a list of forty-one
   * rows and nothing else identified which row was open. Once the detail
   * replaces the list and carries the set's name as the screen title, there is
   * nothing to scroll to and nothing to flash. See RATIONALE.md §2.
   */
  const handleEditQuestionSet = (questionSet) => {
    setEditMode(true);
    setEditingSetId(questionSet.id);
    setNotice(null);
    setActiveTab('questionsets');
  };

  /**
   * Leaving for another section leaves the detail place too. A place you can
   * still be inside while looking at Users is not a place.
   *
   * AND IT IS WRITTEN TO THE ADDRESS BAR. `pushState`, so Back returns to the
   * section you came from instead of leaving the console — see the header of
   * config/adminSection.js for why this is a query parameter and not a path
   * segment. pushState does not fire popstate, so the listener below cannot
   * loop with this.
   */
  /*
    THE LANDING SECTION IS NOW PER-PERSON, AND THE URL HAS TO KNOW.

    It used to be the constant `questionsets` for everybody, so the two places
    below could name that constant directly. With a computed nav it is the first
    item of the first group — `orgs` for Engage staff in platform mode, and
    `questionsets` inside an organisation — and canonicalising against the wrong
    one writes `?section=orgs` for a URL that is ALREADY the landing screen.
    That is precisely the defect the canonicaliser exists to prevent: two URLs
    rendering the same screen, so Back needs two presses to leave it.

    A ref rather than the value, because these callbacks are defined above the
    point where `fallbackSection` is computed and must read it at CALL time.
  */
  const landingRef = useRef(DEFAULT_ADMIN_SECTION);
  /* Set the moment the person navigates. The canonicaliser below must never run
     after that: it uses replaceState, and replacing an entry pushState has just
     created deletes the history that feature exists to build. */
  const navigatedRef = useRef(false);
  /* Canonicalise once, and once only. */
  const canonicalisedRef = useRef(false);
  /* The section actually ON SCREEN, which is not always `activeTab`: a URL
     naming a section this account cannot address falls back, and the address
     bar has to be canonicalised against what the person is looking at rather
     than against what they asked for. */
  const resolvedRef = useRef(DEFAULT_ADMIN_SECTION);

  const handleNavigate = (sectionId) => {
    if (sectionId !== activeTab) {
      setEditMode(false);
      setEditingSetId('');
    }
    setActiveTab(sectionId);
    navigatedRef.current = true;
    if (typeof window !== 'undefined' && window.history?.pushState) {
      const search = searchForSection(window.location.search, sectionId, landingRef.current);
      window.history.pushState({ [SECTION_PARAM]: sectionId }, '', `${window.location.pathname}${search}`);
    }
  };

  /*
    BACK AND FORWARD, and the one line that makes them real.

    pushState alone changes the URL and nothing else: press Back and the address
    bar returns to the previous section while the screen stays where it was —
    which is worse than no history at all, because now the URL is lying. The
    browser announces that move as `popstate` and nothing else; this is the only
    place that hears it.

    Read from `window.location`, not from `event.state`. A history entry created
    before this code shipped, or by anything else on the page, has a null state,
    and the URL is the thing that is always right.

    The detail place closes on the way, for the same reason handleNavigate closes
    it: being inside a set editor while the screen says Users is not a place.
  */
  useEffect(() => {
    const onPop = () => {
      const next = sectionFromSearch(
        window.location.search, ADMIN_SECTION_IDS, DEFAULT_ADMIN_SECTION,
      );
      setActiveTab((current) => {
        if (current !== next) {
          setEditMode(false);
          setEditingSetId('');
        }
        return next;
      });
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  /*
    CANONICALISE ON ARRIVAL, with replaceState so no history entry is spent.

    Three URLs mean the landing section: /admin, /admin?section=questionsets, and
    /admin?section=anything-unrecognised. The first is the one that gets written.
    Without this, a bookmark of the second would make Back require two presses to
    leave a screen it never visibly changed, and the third would leave the
    address bar naming a section that is not on screen.
  */
  useEffect(() => {
    if (typeof window === 'undefined' || !window.history?.replaceState) return;
    /*
      WAITS FOR THE ORGANISATIONS, THEN RUNS EXACTLY ONCE.

      Until they arrive the landing section is a guess, and canonicalising
      against a guess rewrites the address bar twice per load — once wrongly.
      But waiting means this effect has a dependency, and an effect that re-runs
      here is worse than one that runs early: it calls replaceState, so a second
      run lands on the entry `handleNavigate` has just pushed and silently
      deletes it. Both guards are load-bearing.
    */
    if (!orgsLoaded || canonicalisedRef.current || navigatedRef.current) return;
    canonicalisedRef.current = true;
    const landing = landingRef.current;
    const showing = resolvedRef.current;
    if (searchMatchesSection(window.location.search, showing, landing)) return;
    const search = searchForSection(window.location.search, showing, landing);
    window.history.replaceState(
      { [SECTION_PARAM]: showing }, '', `${window.location.pathname}${search}`,
    );
    // Mount only: after this, handleNavigate owns the URL. Re-running on
    // activeTab would replace the entry pushState just created and delete the
    // history this feature exists to build.
  }, [orgsLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCancelEdit = () => {
    setEditMode(false);
    setEditingSetId('');
    setNotice(null);
  };

  /**
   * A field save landed inside QuestionSetEditor. Close the editor, keep the
   * confirmation on screen and re-read the list so the row shows what the
   * backend actually wrote.
   */
  const handleEditorSaved = async (message) => {
    setNotice({ text: message, tone: 'success' });
    setEditMode(false);
    setEditingSetId('');
    await fetchQuestionSets();
  };

  const handleToggleDebugMode = () => {
    const newDebugMode = !debugMode;
    setDebugMode(newDebugMode);
    localStorage.setItem('admin_debug_mode', newDebugMode.toString());
    
    // Also set a global variable for other components to access
    window.DEBUG_MODE = newDebugMode;
    
    console.log(`🐛 DEBUG MODE ${newDebugMode ? 'ENABLED' : 'DISABLED'}`, { newDebugMode, localStorage: localStorage.getItem('admin_debug_mode'), windowDebugMode: window.DEBUG_MODE });
  };

  const handleTogglePromptDebugMode = () => {
    const newPromptDebugMode = !promptDebugMode;
    setPromptDebugMode(newPromptDebugMode);
    localStorage.setItem('prompt_debug_mode', newPromptDebugMode.toString());
    
    // Also set a global variable for other components to access
    window.PROMPT_DEBUG_MODE = newPromptDebugMode;
    
    console.log(`🔍 PROMPT DEBUG MODE ${newPromptDebugMode ? 'ENABLED' : 'DISABLED'}`, { newPromptDebugMode, localStorage: localStorage.getItem('prompt_debug_mode'), windowPromptDebugMode: window.PROMPT_DEBUG_MODE });
  };

  const handleToggleWebSocketMode = () => {
    const newWebSocketMode = !webSocketMode;
    setWebSocketMode(newWebSocketMode);
    localStorage.setItem('admin_websocket_mode', newWebSocketMode.toString());
    
    // Also set a global variable for other components to access
    window.WEBSOCKET_MODE = newWebSocketMode;
    
    console.log(`🔌 WEBSOCKET MODE ${newWebSocketMode ? 'ENABLED' : 'DISABLED'}`, { newWebSocketMode, localStorage: localStorage.getItem('admin_websocket_mode'), windowWebSocketMode: window.WEBSOCKET_MODE });
  };

  // Set initial global modes
  useEffect(() => {
    window.DEBUG_MODE = debugMode;
    window.PROMPT_DEBUG_MODE = promptDebugMode;
    window.WEBSOCKET_MODE = webSocketMode;
  }, [debugMode, promptDebugMode, webSocketMode]);

  const handleToggleActive = async (setId, currentActive) => {
    try {
      const newActive = !currentActive;
      const response = await authFetch(`${API_BASE}admin/toggle-question-set/${setId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ active: newActive })
      });

      const result = await response.json();

      if (response.ok) {
        // Update the local state immediately for better UX
        setQuestionSets(prevSets => 
          prevSets.map(set => 
            set.id === setId ? { ...set, active: newActive } : set
          )
        );
        console.log(`Question set ${setId} ${newActive ? 'activated' : 'deactivated'}`);
      } else {
        // Was `alert()`, in a console that has imported StatusMessage since it
        // was written. A modal browser dialog on a failed toggle stops the
        // world, cannot be styled, and leaves no trace once dismissed; the
        // banner above the list is where every other outcome on this screen
        // already reports itself.
        console.error('Failed to toggle active status:', result.error);
        setNotice({ text: `Failed to toggle active status: ${result.error}`, tone: 'error' });
      }
    } catch (error) {
      console.error('Toggle active error:', error);
      setNotice({ text: `Failed to toggle active status: ${error.message}`, tone: 'error' });
    }
  };

  const handleToggleQuickstart = async (setId, quickstartEnabled) => {
    try {
      const response = await authFetch(`${API_BASE}admin/toggle-quickstart/${setId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ quickstart: quickstartEnabled })
      });

      const result = await response.json();

      if (response.ok) {
        // Update the local state immediately for better UX
        setQuestionSets(prevSets => 
          prevSets.map(set => 
            set.id === setId ? { ...set, quickstart: quickstartEnabled } : set
          )
        );
        console.log(`Question set ${setId} quickstart ${quickstartEnabled ? 'enabled' : 'disabled'}`);
      } else {
        console.error('Failed to toggle quickstart status:', result.error);
        setNotice({ text: `Failed to toggle quickstart status: ${result.error}`, tone: 'error' });
      }
    } catch (error) {
      console.error('Toggle quickstart error:', error);
      setNotice({ text: `Failed to toggle quickstart status: ${error.message}`, tone: 'error' });
    }
  };

  useEffect(() => {
    fetchQuestionSets();
  }, []);

  const fetchQuestionSets = async () => {
    try {
      // Use admin endpoint to get all question sets (including inactive)
      const res = await authFetch(`${API_BASE}admin/question-sets`);
      const json = await res.json();
      setQuestionSets(json.questionSets || []);
    } catch (error) {
      console.error('Error fetching question sets:', error);
    } finally {
      // So the list can tell "still loading" from "there are none" — the two
      // states the shipped screen printed the same sentence for.
      setQuestionSetsLoading(false);
    }
  };

  /*
    Filtering, sorting and both empty states moved into QuestionSetsPanel. What
    was here was a second useEffect writing a second copy of the list into
    `filteredQuestionSets`, plus a hand-written type filter listing four of the
    five engagement types — the drift config/gameTypes.js exists to prevent.
  */

  /*
    handleDownloadTemplate, handleFileSelect and handleUploadQuestionSet moved
    into components/QuestionSetUploadPanel.jsx with the form they drove.

    handleFileSelect is the one worth naming. It read the file and then did

        const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());

    — a naive split that mis-parses any quoted comma, i.e. most real files — and
    used the result only to guess a description. Everything else about the file
    was discovered by the server, after the write. The panel runs
    utils/csvPreflight.js over the same quote-aware parser the replace preview
    already used, and reports what will happen BEFORE anything is sent.
  */

  // Handle AI-generated scenarios
  const handleScenariosGenerated = async (scenarioData) => {
    setShowAIScenarioBuilder(false);

    // scenarioData carries the scenarios, the set-level metadata, and the round
    // DIRECTION the builder was steered with. The direction has to reach the
    // SETS row or it steers one generation and is then forgotten — a set that
    // was generated as Apply would read back as Produce for the editor, the
    // library and every later regeneration.
    const { scenarios, metadata, roundKind, roundKindBrief, createdSet } = scenarioData;

    // THE WORKER ALREADY MADE IT. Uploading again would be refused — the
    // importer will not write over a set that exists — and would report that
    // refusal as a failure over a set that is sitting there. So this path
    // writes NOTHING: it re-reads the list and opens the draft.
    if (createdSet?.setId) {
      await fetchQuestionSets();
      handleEditQuestionSet({ id: createdSet.setId });
      setNotice({
        text: `"${createdSet.setName}" was created while the generator ran. It is switched off `
          + 'until you review it and turn it on.',
        tone: 'success',
      });
      return;
    }

    // Convert scenarios to CSV format and upload
    const csvContent = generateScenariosCSV(scenarios);
    const timestamp = Date.now();

    try {
      setNotice({ text: 'Processing AI-generated scenarios…', tone: 'pending' });

      const response = await authFetch(`${API_BASE}admin/upload-questions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileName: `${metadata.title.replace(/[^a-zA-Z0-9]/g, '_')}-${timestamp}.csv`,
          fileContent: csvContent,
          customTitle: metadata.title,
          customDescription: metadata.description,
          customInstructions: metadata.customInstructions,
          aiContextInstructions: metadata.aiContextInstructions,
          engagementType: engagementType,
          ...(roundKind ? { roundKind } : {}),
          ...(roundKindBrief ? { roundKindBrief } : {}),
          isAIGenerated: true
        })
      });

      const result = await response.json();

      if (response.ok) {
        setNotice({ text: `${result.message} — question set created. Open it from the list to review it.`, tone: 'success' });
        await fetchQuestionSets(); // Refresh the list
      } else {
        setNotice({ text: `Upload failed: ${result.error || 'Unknown error'}`, tone: 'error' });
      }
    } catch (error) {
      console.error('Upload error:', error);
      setNotice({ text: `Upload failed: ${error.message}`, tone: 'error' });
    }
  };

  const generateScenariosCSV = (scenarios) => {
    const headers = 'Category,Question#,Title,Detail_lesson,School,CustomInstruction,Tags';

    // First, group scenarios by category
    const scenariosByCategory = {};
    scenarios.forEach(scenario => {
      const category = scenario.category || 'AI Generated';
      if (!scenariosByCategory[category]) {
        scenariosByCategory[category] = [];
      }
      scenariosByCategory[category].push(scenario);
    });

    // Generate CSV rows with proper category-relative numbering
    const rows = [];
    Object.keys(scenariosByCategory).forEach(category => {
      scenariosByCategory[category].forEach((scenario, index) => {
        const questionNumber = index + 1; // Category-relative numbering (1, 2, 3 for each category)
        rows.push(csvRow([
          category,
          questionNumber,
          scenario.title,
          scenario.detail,
          scenario.school || 'Professional Development',
          scenario.customInstructions || '',
          tagsToCsvCell(scenario.tags)
        ]));
      });
    });

    return buildCsv(headers, rows);
  };

  // Handle AI-generated trivia
  const handleTriviaGenerated = async (triviaData) => {
    setShowTriviaAIBuilder(false);

    // triviaData includes both questions and metadata
    const { questions, metadata, createdSet } = triviaData;

    // THE WORKER ALREADY MADE IT — same rule as handleScenariosGenerated.
    // Uploading again would be refused and the refusal would be reported as a
    // failure over a set that exists.
    if (createdSet?.setId) {
      await fetchQuestionSets();
      handleEditQuestionSet({ id: createdSet.setId });
      setNotice({
        text: `"${createdSet.setName}" was created while the generator ran. It is switched off `
          + 'until you review it and turn it on.',
        tone: 'success',
      });
      return;
    }

    // Convert trivia to CSV format and upload
    const csvContent = generateTriviaCSV(questions);
    const timestamp = Date.now();

    try {
      setNotice({ text: 'Processing AI-generated trivia questions…', tone: 'pending' });

      const response = await authFetch(`${API_BASE}admin/upload-questions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileName: `${metadata.title.replace(/[^a-zA-Z0-9]/g, '_')}-${timestamp}.csv`,
          fileContent: csvContent,
          customTitle: metadata.title,
          customDescription: metadata.description,
          customInstructions: metadata.customInstructions,
          aiContextInstructions: metadata.aiContextInstructions,
          engagementType: 'trivia',
          isAIGenerated: true
        })
      });

      const result = await response.json();

      if (response.ok) {
        setNotice({ text: `${result.message} — trivia set created. Open it from the list to review it.`, tone: 'success' });
        await fetchQuestionSets(); // Refresh the list
      } else {
        setNotice({ text: `Upload failed: ${result.error || 'Unknown error'}`, tone: 'error' });
      }
    } catch (error) {
      console.error('Upload error:', error);
      setNotice({ text: `Upload failed: ${error.message}`, tone: 'error' });
    }
  };

  const generateTriviaCSV = (questions) => {
    // Use the new CSV format that matches upload-questions.js expectations
    const headers = 'Category,Question#,Title,QuestionDetail,AnswerDetails,School,OptionA,OptionB,OptionC,OptionD,OptionE,OptionF,CorrectAnswer,Difficulty,Tags';
    
    // First, group questions by category
    const questionsByCategory = {};
    questions.forEach(trivia => {
      const category = trivia.category || 'General';
      if (!questionsByCategory[category]) {
        questionsByCategory[category] = [];
      }
      questionsByCategory[category].push(trivia);
    });
    
    // Generate CSV rows with proper category-relative numbering
    const rows = [];
    Object.keys(questionsByCategory).forEach(category => {
      questionsByCategory[category].forEach((trivia, index) => {
        const questionNumber = index + 1; // Category-relative numbering (1, 2, 3 for each category)
        
        // Get the correct answer - keep as OptionA format for backend processing
        const correctAnswer = Array.isArray(trivia.correctAnswer) ? trivia.correctAnswer.join(',') : trivia.correctAnswer;
        
        // Build the row with new format that matches what upload-questions.js expects
        rows.push(csvRow([
          category,
          questionNumber,
          trivia.title,
          trivia.questionDetail || trivia.detail || '',
          trivia.answerDetails || '',
          trivia.school || 'General',
          trivia.optionA || '',
          trivia.optionB || '',
          trivia.optionC || '',
          trivia.optionD || '',
          trivia.optionE || '',
          trivia.optionF || '',
          correctAnswer,
          trivia.difficulty,
          tagsToCsvCell(trivia.tags)
        ]));
      });
    });

    return buildCsv(headers, rows);
  };

  // Handle AI-generated polls
  const handlePollGenerated = async (pollData) => {
    setShowPollAIBuilder(false);

    // pollData carries the questions, the set-level metadata, and the round
    // DIRECTION the builder was steered with. Same reasoning as
    // handleScenariosGenerated: a direction that does not reach the SETS row
    // steers one generation and is then forgotten.
    const { questions, metadata, roundKind, roundKindBrief, createdSet } = pollData;

    // THE WORKER ALREADY MADE IT — same rule as handleScenariosGenerated.
    if (createdSet?.setId) {
      await fetchQuestionSets();
      handleEditQuestionSet({ id: createdSet.setId });
      setNotice({
        text: `"${createdSet.setName}" was created while the generator ran. It is switched off `
          + 'until you review it and turn it on.',
        tone: 'success',
      });
      return;
    }

    // Convert polls to CSV format and upload
    const csvContent = generatePollCSV(questions);
    const timestamp = Date.now();

    try {
      setNotice({ text: 'Processing AI-generated poll questions…', tone: 'pending' });

      const response = await authFetch(`${API_BASE}admin/upload-questions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileName: `${metadata.title.replace(/[^a-zA-Z0-9]/g, '_')}-${timestamp}.csv`,
          fileContent: csvContent,
          customTitle: metadata.title,
          customDescription: metadata.description,
          customInstructions: metadata.customInstructions,
          aiContextInstructions: metadata.aiContextInstructions,
          engagementType: 'poll',
          ...(roundKind ? { roundKind } : {}),
          ...(roundKindBrief ? { roundKindBrief } : {}),
          isAIGenerated: true
        })
      });

      const result = await response.json();

      if (response.ok) {
        setNotice({ text: `${result.message} — poll set created. Open it from the list to review it.`, tone: 'success' });
        await fetchQuestionSets(); // Refresh the list
      } else {
        setNotice({ text: `Upload failed: ${result.error || 'Unknown error'}`, tone: 'error' });
      }
    } catch (error) {
      console.error('Upload error:', error);
      setNotice({ text: `Upload failed: ${error.message}`, tone: 'error' });
    }
  };

  const generatePollCSV = (questions) => {
    // ONE `Options` column, pipe-separated — see optionsToCsvCell(). This used
    // to emit Option1..Option5, which upload-questions.js does not read and has
    // no fallback for, so every AI-generated poll set imported with zero
    // options. Do not "restore" the numbered columns.
    const headers = 'Category,Question#,Title,Detail_lesson,School,CustomInstruction,Options,AllowMultiple,Tags';

    // First, group questions by category
    const questionsByCategory = {};
    questions.forEach(poll => {
      const category = poll.category || 'General';
      if (!questionsByCategory[category]) {
        questionsByCategory[category] = [];
      }
      questionsByCategory[category].push(poll);
    });
    
    // Generate CSV rows with proper category-relative numbering
    const rows = [];
    Object.keys(questionsByCategory).forEach(category => {
      questionsByCategory[category].forEach((poll, index) => {
        const questionNumber = index + 1; // Category-relative numbering (1, 2, 3 for each category)

        rows.push(csvRow([
          category,
          questionNumber,
          poll.title,
          poll.detail || '',
          poll.school || 'General',
          poll.customInstructions || '',
          optionsToCsvCell(poll.options),
          allowMultipleToCsvCell(poll.allowMultiple),
          tagsToCsvCell(poll.tags)
        ]));
      });
    });

    return buildCsv(headers, rows);
  };

  // Handle AI-generated surveys
  const handleSurveyGenerated = async (surveyData) => {
    setShowSurveyAIBuilder(false);

    // surveyData includes survey and metadata
    const { survey, metadata } = surveyData;

    // Export survey as JSON file
    const jsonContent = JSON.stringify(survey, null, 2);
    const timestamp = Date.now();
    const fileName = `survey-${survey.title.replace(/[^a-zA-Z0-9]/g, '_')}-${timestamp}.json`;

    try {
      setNotice({ text: 'Exporting AI-generated survey…', tone: 'pending' });

      // Create download link for JSON
      const blob = new Blob([jsonContent], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      setNotice({ text: `Survey "${survey.title}" exported as a JSON file with ${survey.questions.length} questions. It is NOT a question set: the importer rejects survey uploads and no session plays one.`, tone: 'success' });

    } catch (error) {
      console.error('Survey export error:', error);
      setNotice({ text: `Survey export failed: ${error.message}`, tone: 'error' });
    }
  };


  /*
    DELETING A SET now lives in components/QuestionSetDeleteDialog.jsx, which
    owns its own busy and outcome state, sends the request BEFORE closing
    anything, and closes only on acknowledgement.

    Two things were here and are gone. `handleDeleteQuestionSet` was DEAD — the
    only wired path was the row button, and its 'Please select a question set to
    delete' branch belonged to a selector this screen has not had for months, so
    it is deleted rather than wired. And `confirmDeleteQuestionSet` wrote
    `questionSetDeleteStatus` on all four outcomes into a variable rendered
    nowhere, while `isDeletingQuestionSet` was never read at all.
  */

  /** The dialog reports the outcome; the page re-reads the list and keeps it. */
  const handleSetDeleted = async (message) => {
    setDeletingSet(null);
    setNotice({ text: message, tone: 'success' });
    await fetchQuestionSets();
  };

  /** The reversible neighbour offered inside the delete dialog. */
  const handleDeactivateInstead = async (set) => {
    setDeletingSet(null);
    await handleToggleActive(set.id, set.active);
    setNotice({
      text: `“${set.name || set.id}” is deactivated. It no longer appears in the host's picker, and nothing was deleted.`,
      tone: 'success',
    });
  };

  /** One place decides which builder a type opens. It used to be inline in a
   *  button that sat beside a second copy of the engagement-type select. */
  const handleOpenBuilder = (type) => {
    if (type === 'poll') setShowPollAIBuilder(true);
    else if (type === 'trivia') setShowTriviaAIBuilder(true);
    else if (type === 'survey') setShowSurveyAIBuilder(true);
    else setShowAIScenarioBuilder(true);
  };

  /** The three ranked paths from mockup 02, and the header's New set button. */
  const handleCreatePath = (path) => {
    setIsCreateOpen((open) => (path === 'new' ? !open : true));
    if (path === 'ai') handleOpenBuilder(engagementType);
  };

  /*
    THE SHELL. What used to be here: a `.parallax` section loading three .webp
    layers from cdn.prod.website-files.com — a third-party CDN dependency on an
    authenticated operator console, occupying roughly 250px of the fold — with
    the title, the user's name, a Host link and Sign Out absolutely positioned
    on top of it in inline styles; then a horizontal strip of six tab buttons
    that scrolled away with the document.

    The hero images are NOT rendered. They are also not deleted: AdminShell
    takes a `hero` node, so the owner's open question
    (docs/design/admin-redesign/OPEN-QUESTIONS.md) can be answered either way by
    passing one here. See the header comment in components/AdminShell.jsx.
  */
  const environment = describeEnvironment({ env: window.ENV, apiBase: API_BASE });

  // The set open in the detail place, or null when the list is the place.
  const editingSet =
    editMode && editingSetId
      ? questionSets.find((set) => set.id === editingSetId) || { id: editingSetId }
      : null;

  /*
    THE NAV IS COMPUTED, and that is the change rather than a detail.

    An org member, an org admin, a personal space and Engage staff must not see
    the same console — most importantly, the platform view has NO content
    section at all, because after this change staff cannot open a customer's
    sets without a logged, expiring grant. `config/consoleSections.js` owns
    that decision as a pure function so it can be tested without React.
  */
  const navGroups = sectionsFor(consoleIdentity);
  const visibleIds = sectionIdsFor(consoleIdentity);
  const fallbackSection = defaultSectionIdFor(consoleIdentity) || DEFAULT_ADMIN_SECTION;
  /* Published to the callbacks above, which run after this line has. */
  landingRef.current = orgsLoaded ? fallbackSection : DEFAULT_ADMIN_SECTION;
  /*
    A bookmarked `?section=billing` on an account that no longer has billing
    lands on the default rather than on a blank work area. The old list was
    static, so this could not happen; with a computed nav it can, and silently.

    GATED ON `orgsLoaded`, AND THAT IS THE WHOLE OF IT. Until `GET /orgs`
    answers there is no active organisation, so `sectionsFor` returns the
    platform sections or none — and applying the fallback against that empty
    set throws away the section the URL asked for, on every first paint. A
    deep link to ?section=users would bounce to the landing section and rewrite
    the address bar before the page had finished loading, which looks like the
    link was wrong rather than early.

    So the URL is trusted while the answer is still in flight, and only
    reconciled once we actually know what this account can see.
  */
  const resolvedTab = (!orgsLoaded || visibleIds.includes(activeTab))
    ? activeTab
    : fallbackSection;
  resolvedRef.current = resolvedTab;

  /*
    THE WORK-HEAD DESCRIPTOR — title, subtitle and content theme.

    `consoleSections` owns the nav LABEL; the longer title and the sentence
    under it stay here, because they are copy about a screen rather than an
    entry in a list. Three of them are new and have no entry in
    `ADMIN_SECTION_BY_ID`, and the fallback chain quietly landed every one of
    them on Question sets — so the Team screen was headed "Question sets" with
    every test green except the one that reads the h1.
  */
  const NEW_SECTION_HEADS = {
    members: {
      id: 'members',
      title: 'Members',
      subtitle: 'Who can host for this organisation, and who has been invited.',
      contentTheme: 'dark',
    },
    billing: {
      id: 'billing',
      title: 'Plan & usage',
      subtitle: 'What this period has used, and what it costs. Nothing is ever cut off mid-session.',
      contentTheme: 'dark',
    },
    privacy: {
      id: 'privacy',
      title: 'Data & privacy',
      subtitle: 'What is stored, who has read it, and how to take it away.',
      contentTheme: 'dark',
    },
  };

  const navSection = sectionById(consoleIdentity, resolvedTab);

  /*
    THE NAV LABEL IS THE NAME OF THE SCREEN, and the heading follows it.

    Not a special case — a rule, because the alternative already bit: the
    platform section keeps the id `users` but is labelled "Accounts" (managing
    Cognito accounts is a platform job, and "Users" beside "Members" in one
    console is two words for two genuinely different things). The stale title in
    ADMIN_SECTION_BY_ID still said "Users", so the nav entry and the h1 it
    opened disagreed about what the screen was called.

    So: the label wins wherever the nav knows the section, and this page
    supplies only the subtitle and the theme.
  */
  const base = NEW_SECTION_HEADS[resolvedTab]
    || ADMIN_SECTION_BY_ID[resolvedTab]
    || ADMIN_SECTION_BY_ID.questionsets;
  const section = navSection
    ? { ...base, id: resolvedTab, title: navSection.label }
    : base;

  return (
    <>
      <AdminShell
        navGroups={navGroups.map((group) => ({
          ...group,
          items: group.items.map((item) =>
            (item.id === 'questionsets'
              // No count until there is one to state. A "0" beside Question
              // sets while the list is still loading is an empty state that
              // lies, and this console has three of those already.
              ? { ...item, count: questionSets.length || undefined }
              : item)),
        }))}
        footNavItems={FOOT_SECTIONS.length ? FOOT_SECTIONS : ADMIN_FOOT_SECTIONS}
        orgSwitcher={
          orgsLoaded ? (
            /* PROP NAMES MATTER MORE THAN THEY LOOK. This passed `orgs` and
               `onSwitch`; the component's props are `organisations` and
               `onSelect`, so it received an empty list, took its "nothing to
               name" branch and rendered NOTHING — on dev there was no switcher
               on the page at all, and therefore no way to change organisation
               or reach the platform console. React says nothing about a prop
               that is simply not there, which is why adminOrgWiring.test.jsx
               now mounts this and looks. */
            <OrgSwitcher
              organisations={orgs}
              activeOrgId={activeOrgId}
              platform={isStaff}
              onSelect={handleSwitchOrg}
              onCreate={() => { window.location.href = '/admin?section=members'; }}
            />
          ) : null
        }
        activeId={resolvedTab}
        onNavigate={handleNavigate}
        environment={environment}
        currentUser={currentUser}
        onSignOut={handleSignOut}
        breadcrumb={
          editingSet ? { parentLabel: 'Question sets', onBack: handleCancelEdit } : null
        }
        title={editingSet ? editingSet.name || editingSet.id : section.title}
        subtitle={editingSet ? undefined : section.subtitle}
        /*
          Wave D converts the tabs one at a time, so the theme is per-section
          rather than per-console. Users and Sessions are dusk now; the rest are
          still the paper-theme markup AdminShell.css documents, and a section
          that has not been converted must not be dropped onto the dark field —
          #333 body copy on #0F1A2E is 1.4:1.
        */
        contentTheme={editingSet ? 'light' : section.contentTheme || 'light'}
        actions={(
          <>
            {/* IN THE HEADER, BESIDE HELP — not floating over the console.
                These two are the same kind of thing (ask for something, get
                help), so they belong in the same place and look alike. */}
            <IssueFab context="admin" placement="inline" />
            <HelpButton section="admin" variant="header" size="medium" />
          </>
        )}
      >
        {editingSet ? (
          /*
            THE DETAIL PLACE. The editor replaces the work area rather than
            being appended below the list it came from, which is the whole of
            RATIONALE.md §2: no scroll-jump, no three-second yellow flash, and
            the set's name is on screen for as long as you are editing it.
          */
          <QuestionSetEditor
            questionSet={editingSet}
            availablePrompts={availablePrompts}
            availablePersonas={availablePersonas}
            // Every set the caller can see, for the Questions panel's
            // "pull from another set" picker. Already loaded for the list, so
            // the picker costs no request of its own.
            availableSets={questionSets}
            defaultInstructions={defaultInstructions}
            onSaved={handleEditorSaved}
            onChanged={fetchQuestionSets}
            onCancel={handleCancelEdit}
          />
        ) : (
          <>
          {/* Tab Content */}
          {activeTab === 'prompts' && (
            /*
              THE PROMPTS SECTION: A CHOOSER, AND TWO PLACES IT LEADS TO.

              No `.tab-content` wrapper and no `.admin-section` card — the same
              two removals the Users and Question sets tabs already made, for the
              same two reasons. `.tab-content` carries a 500px min-height and a
              fade-in written for the paper tabs; `.admin-section` is a white
              card, which on a dusk work field is the "why are these the only
              things that are on a light background" the owner asked about.
              AUDIT §6.2 item 14.

              WHAT REPLACED THE TWO ENTRANCES. Both libraries used to be reached
              from a card here, and neither of them the same way: Generation
              opened a fixed-position overlay rendered outside this section
              entirely, Analysis toggled a third panel open UNDERNEATH the two
              cards. Now each tile replaces this chooser with its library, and
              `.padm-back` brings you back — one entrance shape, one exit,
              whichever library you are in. That is also what the container rule
              asks for: a list plus its editor is a place in the console, not a
              section appended below another section (RATIONALE §2).
            */
            <div className="padm">
              {promptLibrary === null && (
                <ul className="padm-choose">
                  <li>
                    <button
                      type="button"
                      className="padm-card"
                      onClick={() => setPromptLibrary('generation')}
                    >
                      <span className="padm-card-h">
                        <Icon name="NotePencil" weight="bold" size={18} color="var(--primary)" />
                        Question set generator prompts
                      </span>
                      <span className="padm-card-b">
                        The instruction the AI is given when it writes a new question set.
                        One per engagement type and scenario — lessons learned, interview
                        prep, general knowledge trivia, opinion polls.
                      </span>
                      {/*
                        NO COUNT ON THIS TILE, and that is a decision rather than
                        an omission. This console has never fetched the
                        generation prompts before the library opens, and a
                        number it cannot know is worse than no number: "0
                        prompts" over a library holding eleven of them is the
                        empty state that lies, one screen earlier.
                      */}
                      <span className="padm-card-n">Open the library</span>
                    </button>
                    <div className="padm-card-aside">
                      <HelpButton section="ai-prompts" variant="inline" size="small" tooltip="Help: AI Prompts Management" />
                    </div>
                  </li>

                  <li>
                    <button
                      type="button"
                      className="padm-card"
                      onClick={() => setPromptLibrary('analysis')}
                    >
                      <span className="padm-card-h">
                        {/* Workie's own face, not a Phosphor glyph. It is the
                            mascot the owner names this library by ("what Workie
                            says"), and it is the one thing on this screen that
                            is recognised rather than read. `.workie-icon-small`
                            is styles.css:6602 and this is now its only caller. */}
                        <img src="/workie.png" alt="" className="workie-icon-small" />
                        Engagement results prompts
                      </span>
                      <span className="padm-card-b">
                        What Workie says after a round. Each engagement type has one default;
                        a question set can pin its own.
                      </span>
                      <span className="padm-card-n">Open the library</span>
                    </button>
                    <div className="padm-card-aside">
                      <HelpButton section="ai-prompts" variant="inline" size="small" tooltip="Help: AI Prompts Management" />
                    </div>
                  </li>
                </ul>
              )}

              {promptLibrary !== null && (
                <>
                  {/*
                    ONE BACK CONTROL FOR BOTH LIBRARIES, rendered here rather
                    than inside each of them. Two copies is how the two
                    entrances drifted apart in the first place; one element with
                    one handler cannot.
                  */}
                  <button
                    type="button"
                    className="padm-back"
                    onClick={() => setPromptLibrary(null)}
                  >
                    <Icon name="CaretLeft" weight="bold" size={13} color="currentColor" />
                    Prompts
                  </button>

                  {promptLibrary === 'generation' && <AIGenerationPromptEditor />}
                  {promptLibrary === 'analysis' && <AIPromptManager />}
                </>
              )}
            </div>
          )}

          {activeTab === 'questionsets' && (
            /*
              THE LIST AND THE CREATION PANEL. No `.tab-content` wrapper: that
              class carries a 500px min-height and a fade-in written for the
              paper tabs, and this screen owns its own frame now (same reason
              the Users tab dropped it in Wave D part one).

              The creation panel is passed as a CHILD so it renders inside the
              same `.qs` scope and below the list — which is where it has always
              been. What changed is that the empty state no longer tells you to
              upload "above": clicking a creation path opens this panel, and
              when the list is empty there are no rows between the two.
            */
            <QuestionSetsPanel
              questionSets={questionSets}
              loading={questionSetsLoading}
              notice={notice}
              onDismissNotice={() => setNotice(null)}
              onEdit={handleEditQuestionSet}
              onDelete={(set) => setDeletingSet(set)}
              onToggleActive={(set) => handleToggleActive(set.id, set.active)}
              onToggleQuickstart={(set, next) => handleToggleQuickstart(set.id, next)}
              onCreate={handleCreatePath}
              /* Only inside an organisation: there is nowhere to copy TO in
                 platform mode, and the endpoint refuses without an org. */
              onCopy={activeOrg ? handleCopySet : undefined}
              createOpen={isCreateOpen}
            >
              {(isCreateOpen || questionSets.length === 0) && (
                <QuestionSetUploadPanel
                  /* Only when the person PRESSED something. The condition above
                     also renders this panel on arrival when the library is
                     empty, and scrolling then would move the page in response
                     to nothing. */
                  scrollIntoViewOnMount={isCreateOpen}
                  engagementType={engagementType}
                  onEngagementTypeChange={setEngagementType}
                  availablePrompts={availablePrompts}
                  defaultInstructions={defaultInstructions}
                  onOpenBuilder={handleOpenBuilder}
                  onUploaded={fetchQuestionSets}
                />
              )}
            </QuestionSetsPanel>
          )}

          {activeTab === 'games' && (
            /*
              THE SESSIONS LIST. What used to be here: one red card with a
              Single/All radio pair, a free-text "Enter Game ID" box and a
              Delete button — no list at all, so removing one session required
              an id this console never displayed. GET /games has been deployed
              the whole time and admin had never called it. See
              components/SessionsPanel.jsx and RATIONALE.md §9.

              The set counts are passed so the empty state can say the likeliest
              reason a host could not start anything, and so delete-all can name
              what survives it. They are undefined until the list has loaded, on
              purpose: SessionsPanel says nothing rather than printing a zero.
            */
            <SessionsPanel
              environment={environment}
              inactiveSetCount={
                questionSets.length
                  ? questionSets.filter((set) => !set.active).length
                  : undefined
              }
              totalSetCount={questionSets.length || undefined}
            />
          )}

          {activeTab === 'archive' && (
            <div className="tab-content">
              <ArchivePanel />
            </div>
          )}

          {/* No .tab-content wrapper: that class carries a 500px min-height and
              a fade-in written for the paper tabs, and the converted screens
              own their own frame. */}
          {activeTab === 'users' && <UserManagement />}

          {/* ── The tenancy sections ──────────────────────────────────────
              Each is a pure props/callbacks component so it can be mounted in
              jsdom on its own — AdminPage cannot be (`useAuth` hard-throws),
              which is why every panel on this page is built that way. */}
          {/* ── The platform console ──────────────────────────────────────
              Gated on `onPlatform`, not merely on the section id: the id is
              reachable from a bookmarked ?section=orgs, and a staff screen must
              be a thing you are DOING rather than a URL you kept. The server
              re-checks the group on every call regardless. */}
          {resolvedTab === 'orgs' && onPlatform && <PlatformOrgsPanel />}

          {resolvedTab === 'moderation' && onPlatform && (
            <div className="tab-content">
              <p style={{ maxWidth: '62ch' }}>
                Nothing reaches this queue yet. Sets become public by being
                submitted for review, and that pipeline — the safety pass and the
                approve/reject decision — is not built. This screen is here so the
                nav matches what the platform console will hold; it is not an
                empty queue meaning everything has been reviewed.
              </p>
            </div>
          )}

          {resolvedTab === 'members' && activeOrg && (
            <TeamPanel orgId={activeOrg.orgId} orgName={activeOrg.name} />
          )}

          {resolvedTab === 'billing' && activeOrg && (
            <BillingPanel
              planId={activeOrg.plan || (activeOrg.type === 'personal' ? 'personal' : 'team')}
              usage={orgUsage?.usage}
              period={orgUsage?.period}
              history={orgUsage?.history}
              error={orgUsageError}
              onUpgrade={() => { window.location.href = '/admin?section=members'; }}
            />
          )}

          {resolvedTab === 'privacy' && activeOrg && (
            /*
              The access log, export and delete endpoints do not exist yet, so
              the panel is mounted against its defaults. Its empty state says
              "nobody at Engage has read anything", which is TRUE today and is
              the honest thing to show — and it distinguishes that from a load
              FAILURE, because an error rendered as an empty log would claim
              nobody looked when the truth is that we do not know.
            */
            <PrivacyPanel org={{ id: activeOrg.orgId, name: activeOrg.name }} />
          )}

          {activeTab === 'settings' && (
            <div className="tab-content">
              {/* WebSocket Mode Toggle */}
              <div className="admin-section debug-section">
                <div className="section-title-with-help">
                  <h2><Icon name="Broadcast" weight="bold" size={16} color="var(--success)" /> Real-time Communication</h2>
                  <HelpButton section="websocket-settings" variant="inline" size="small" tooltip="Help: WebSocket & Real-time Settings" />
                </div>
                <p className="section-description">Real-time WebSocket communication is now the default. Toggle off to use HTTP polling instead.</p>
                
                <div className="debug-controls">
                  <label className="debug-toggle">
                    <input
                      type="checkbox"
                      checked={webSocketMode}
                      onChange={handleToggleWebSocketMode}
                    />
                    <span className="toggle-label">
                      Enable WebSocket Mode (Real-time Updates)
                      {webSocketMode && <span className="debug-active">ACTIVE</span>}
                    </span>
                  </label>
                  <p className="debug-description">
                    When enabled, the game uses WebSocket connections for real-time state updates. 
                    When disabled, uses HTTP polling mode for compatibility with restrictive networks.
                    {!webSocketMode && <strong> Currently using HTTP polling mode.</strong>}
                  </p>
                </div>
              </div>

              {/* Debug Mode Toggle */}
              <div className="admin-section debug-section">
                <h2><Icon name="Bug" weight="bold" size={16} color="currentColor" /> Debug Settings</h2>
                <p className="section-description">Development and debugging tools for AI functionality.</p>
                
                <div className="debug-controls">
                  <label className="debug-toggle">
                    <input
                      type="checkbox"
                      checked={debugMode}
                      onChange={handleToggleDebugMode}
                    />
                    <span className="toggle-label">
                      Show AI Prompts in Debug Mode
                      {debugMode && <span className="debug-active">ACTIVE</span>}
                    </span>
                  </label>
                  <p className="debug-description">
                    When enabled, the actual AI prompts sent to the model will be displayed above AI summary outputs in both the AI-ify dialog and results page.
                  </p>
                  
                  <label className="debug-toggle">
                    <input
                      type="checkbox"
                      checked={promptDebugMode}
                      onChange={handleTogglePromptDebugMode}
                    />
                    <span className="toggle-label">
                      Prompt Improvement Debug Mode
                      {promptDebugMode && <span className="debug-active">ACTIVE</span>}
                    </span>
                  </label>
                  <p className="debug-description">
                    When enabled, shows all prompt variables and their actual data values in a side panel during gameplay on the host screen results page. Useful for debugging and improving AI prompts.
                  </p>
                </div>
              </div>
            </div>
          )}
          </>
        )}
      </AdminShell>


      {/*
        The session-delete confirmation that used to sit here stated severity
        ("This action cannot be undone!") and no consequence, and reported
        itemsDeleted only afterwards. It now lives in SessionsPanel, states the
        count before the press, names what survives, and names the environment.
        RATIONALE.md §8.
      */}

      {/*
        THE SET-DELETE DIALOG. See components/QuestionSetDeleteDialog.jsx: it
        stays open until the server answers, renders the outcome, offers the
        reversible neighbour, and closes only on acknowledgement.
      */}
      {deletingSet && (
        <QuestionSetDeleteDialog
          questionSet={deletingSet}
          onCancel={() => setDeletingSet(null)}
          onDeleted={handleSetDeleted}
          onDeactivate={handleDeactivateInstead}
        />
      )}

      {/* AI Scenario Builder Modal */}
      {showAIScenarioBuilder && (
        <AIScenarioBuilder
          onClose={() => setShowAIScenarioBuilder(false)}
          onScenariosGenerated={handleScenariosGenerated}
          engagementType={engagementType}
        />
      )}

      {/* AI Trivia Builder Modal */}
      {showTriviaAIBuilder && (
        <TriviaAIBuilder
          onClose={() => setShowTriviaAIBuilder(false)}
          onTriviaGenerated={handleTriviaGenerated}
        />
      )}

      {/* AI Poll Builder Modal */}
      {showPollAIBuilder && (
        <PollAIBuilder
          onClose={() => setShowPollAIBuilder(false)}
          onPollGenerated={handlePollGenerated}
        />
      )}

      {/* AI Survey Builder Modal */}
      {showSurveyAIBuilder && (
        <SurveyAIBuilder
          onClose={() => setShowSurveyAIBuilder(false)}
          onSurveyGenerated={handleSurveyGenerated}
        />
      )}

      {/*
        AIGenerationPromptEditor USED TO BE MOUNTED HERE, in the top-level
        fragment beside <IssueFab> — outside AdminShell, outside the work body,
        outside the section it belonged to and outside the console's theme. That
        placement is why it had to be a fixed-position overlay, why it inherited
        `data-theme="light"` from <html> while the section around it went dusk,
        and half of why the two prompt libraries were reached differently. It is
        rendered inside the prompts section now; see the `.padm` block above.
      */}

      {/* GitHub Issue Reporting FAB */}
    </>
  );
}

export default AdminPage;