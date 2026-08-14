/**
 * A HOST'S OWN QUESTION SETS — components/HostQuestionSetsDialog.jsx, and the
 * way in to it from components/GameSetupDialog.jsx.
 *
 * The owner: *"exposing the create question sets to the hosts … only question
 * sets that are created by a host can be edited by that host. admins can edit
 * all question sets … the interface for entry to this is create engagements."*
 *
 * WHAT THIS FILE CAN AND CANNOT PROVE. It proves the AFFORDANCES: that a host is
 * not shown a control for something they cannot do, that the way in exists where
 * the owner asked for it, and that a refusal from the API is shown rather than
 * swallowed. It does NOT prove the permission — a hidden button is not a
 * permission, and the enforcement lives in `auth/authorizer.js` and
 * `admin/shared/question-set-access.js`, driven by hand-made events with no UI
 * anywhere near them in `tests/question-set-ownership.js`. Both halves are
 * needed and neither substitutes for the other.
 *
 * THE SESSIONS/UPLOAD PANEL PATTERN: one mocked module (`../auth/authFetch`), a
 * `jsonResponse` helper, a router that throws on an unmatched URL, and no
 * `AuthProvider` — these components do not call `useAuth`, so mocking it would
 * be mocking a module they do not import.
 *
 * `canManage` IS THE SERVER'S ANSWER, and the fixtures below carry it exactly as
 * `admin/get-question-sets.js` projects it. Nothing here re-derives it from a
 * group claim: two implementations of one rule is how a console ends up offering
 * what the API refuses.
 *
 * NO GEOMETRIC ASSERTIONS. jsdom has no layout engine.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import HostQuestionSetsDialog from '../components/HostQuestionSetsDialog';
import GameSetupDialog from '../components/GameSetupDialog';
import { authFetch } from '../auth/authFetch';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

/**
 * The list exactly as the admin projection returns it for a HOST caller:
 * `canManage` true only on what they created, `createdBy` absent (it is
 * projected for admins only), `mine` alongside it.
 */
const HOST_VIEW = [
  {
    id: 'ivy-retro', name: 'Ivy Retro', description: 'Made last Tuesday',
    engagementType: 'call-and-answer', totalQuestions: 12, categoryCount: 2,
    active: true, hasImages: false, canManage: true, mine: true, createdByName: 'ivy',
  },
  {
    id: 'raj-quiz', name: 'Raj Quiz', description: "Raj's",
    engagementType: 'trivia', totalQuestions: 40, categoryCount: 4,
    active: true, hasImages: false, canManage: false, mine: false, createdByName: 'raj',
  },
  {
    id: 'eighties', name: '80s Trivia', description: 'House content',
    engagementType: 'trivia', totalQuestions: 100, categoryCount: 8,
    active: true, hasImages: false, canManage: false, mine: false, createdByName: null,
  },
];

/** The same rows as an ADMIN sees them: canManage everywhere. */
const ADMIN_VIEW = HOST_VIEW.map((set) => ({ ...set, canManage: true, mine: set.mine }));

/**
 * `GET /question-sets/{setId}/questions` for Ivy Retro — the route the mounted
 * editor reads. It carries NO authorizer (template-clean.yaml:405-422), which is
 * why a host can open the editor at all.
 */
const IVY_QUESTIONS = {
  setId: 'ivy-retro',
  questions: [
    {
      id: 'c001#001', Category: 'Retro', title: 'WHAT WENT WRONG', QuestionNumber: 1,
      questionDetail: 'Pick one incident.', Tags: ['retro'],
    },
    {
      id: 'c001#002', Category: 'Retro', title: 'WHAT WOULD YOU CHANGE', QuestionNumber: 2,
      questionDetail: 'One thing only.', Tags: ['retro'],
    },
  ],
};

function mockApi({
  sets = HOST_VIEW, editStatus = 200, editBody = null, deleteStatus = 200, uploadStatus = 200,
  questions = IVY_QUESTIONS,
} = {}) {
  let listCalls = 0;
  // THE THREE ROUTES A HOST IS REFUSED, counted rather than left to throw.
  // tests/question-set-ownership.js:276-290 asserts the refusals against the
  // real authorizer; what matters HERE is that the mounted editor never asks.
  // Routing them (instead of letting the router's throw catch it) is deliberate:
  // the editor swallows a failed version load into an empty list, so a thrown
  // "unhandled request" would be indistinguishable from a panel that renders and
  // silently shows nothing. A counter can tell those apart.
  const refused = { versions: 0, download: 0, ai: 0 };
  authFetch.mockImplementation(async (url, options = {}) => {
    const method = (options.method || 'GET').toUpperCase();
    if (method === 'GET' && /\/admin\/question-sets$/.test(url)) {
      listCalls += 1;
      return jsonResponse(200, { questionSets: typeof sets === 'function' ? sets(listCalls) : sets });
    }
    // The editor's own reads and writes.
    if (method === 'GET' && /\/question-sets\/[^/]+\/questions$/.test(url)) {
      return jsonResponse(200, questions);
    }
    if (/\/admin\/question-sets\/[^/]+\/versions/.test(url)) {
      refused.versions += 1;
      return jsonResponse(403, { error: 'Admin access required' });
    }
    if (method === 'GET' && url.includes('/admin/download-question-set/')) {
      refused.download += 1;
      return jsonResponse(403, { error: 'Admin access required' });
    }
    if (url.includes('/admin/ai-generate-questions')) {
      refused.ai += 1;
      return jsonResponse(403, { error: 'Admin access required' });
    }
    if (method === 'PUT' && url.includes('/admin/edit-question-set/')) {
      return editStatus === 200
        ? jsonResponse(200, editBody || { message: 'ok', updated: { description: 'Renamed too' } })
        : jsonResponse(editStatus, editBody || { error: 'This question set belongs to someone else. You can only change sets you created.' });
    }
    if (method === 'DELETE' && url.includes('/admin/question-sets/')) {
      return deleteStatus === 200
        ? jsonResponse(200, { message: 'Question set "Ivy Retro" deleted successfully', itemsDeleted: 15 })
        : jsonResponse(deleteStatus, { error: 'This question set belongs to someone else. You can only change sets you created.' });
    }
    if (method === 'POST' && url.includes('/admin/upload-questions')) {
      const body = JSON.parse(options.body || '{}');
      return uploadStatus === 200
        // The replace answer carries the fields the Questions panel reports back
        // ("Version 3 of … is now live with 2 questions"); the create answer is
        // the upload panel's.
        ? jsonResponse(200, body.replaceSetId
          ? { message: 'ok', version: 3, questionCount: 2, setName: 'Ivy Retro' }
          : { message: 'Successfully created question set "Fresh"' })
        : jsonResponse(uploadStatus, { error: 'nope' });
    }
    if (method === 'GET' && url.includes('/admin/download-template')) {
      return jsonResponse(200, { filename: 'caa-template.csv', content: 'Category,Title' });
    }
    throw new Error(`Unhandled request: ${method} ${url}`);
  });
  return {
    editUrls: () => authFetch.mock.calls.filter((c) => (c[1]?.method || 'GET') === 'PUT').map((c) => c[0]),
    refused,
    uploads: () => authFetch.mock.calls
      .filter(([url, opt]) => opt?.method === 'POST' && url.includes('/admin/upload-questions'))
      .map(([, opt]) => JSON.parse(opt.body)),
  };
}

async function openDialog(props = {}, options) {
  const api = mockApi(options);
  const utils = render(<HostQuestionSetsDialog onClose={jest.fn()} {...props} />);
  await waitFor(() => expect(screen.queryByText(/loading your question sets/i)).toBeNull());
  return { ...utils, ...api };
}

const rowFor = (name) => screen.getByText(name).closest('tr');

beforeEach(() => {
  authFetch.mockReset();
  window.API_BASE = 'https://api.example.test/dev/';
});

/* ------------------------------------------------------------- the shelf --- */

describe('a host sees their own sets, and only controls they can use', () => {
  test('their set is listed with Rename and Delete', async () => {
    // rejects: filtering the list to nothing, or rendering it read-only — the
    // feature the owner asked for is that a host CAN change what they made.
    await openDialog();
    const row = rowFor('Ivy Retro');
    expect(within(row).getByRole('button', { name: /rename/i })).toBeTruthy();
    expect(within(row).getByRole('button', { name: /delete/i })).toBeTruthy();
  });

  test("another host's set carries no control that needs authority over it", async () => {
    // THE HEADLINE AFFORDANCE, restated for a shelf that is now listed rather
    // than counted. rejects: drawing Rename or Delete on somebody else's work —
    // an invitation, and a disabled one is a lie about what could be requested.
    //
    // Copy-and-edit is deliberately NOT in that category and is asserted below:
    // it needs no permission over the original, reads a route that is
    // unauthenticated, and writes a set the host will own.
    await openDialog();
    for (const name of ['Raj Quiz', '80s Trivia']) {
      const row = screen.getByText(name).closest('tr');
      expect(within(row).queryByRole('button', { name: /rename/i })).toBeNull();
      expect(within(row).queryByRole('button', { name: /delete/i })).toBeNull();
    }
  });

  test('exactly two controls exist — one Rename, one Delete', async () => {
    // rejects: `canManage` being ignored and every row drawing its pair. Counting
    // is what catches a filter that was written and then not applied.
    await openDialog();
    expect(screen.getAllByRole('button', { name: /^rename$/i })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /^delete$/i })).toHaveLength(1);
  });

  test('the library the host cannot change is listed, and the rule is stated', async () => {
    // rejects: hiding the other sets silently, which leaves a host who can PLAY
    // 41 sets wondering where 40 of them went. They used to be a count; the
    // owner asked for an edit affordance here, so a count is no longer enough —
    // you cannot put a button on a number.
    await openDialog();
    expect(screen.getByText('Raj Quiz')).toBeTruthy();
    expect(screen.getByText('80s Trivia')).toBeTruthy();
    expect(screen.getByText(/made by an administrator/i)).toBeTruthy();
  });

  test('a house set offers a copy, and says so before it is pressed', async () => {
    // rejects: labelling it "Edit questions" like the row above. Editing a set
    // you own makes a new VERSION of that set; editing a house set gives you a
    // NEW SET and leaves the original alone. Those are different outcomes and
    // the person has to be able to tell which one they are about to get.
    await openDialog();
    const row = screen.getByText('80s Trivia').closest('tr');
    expect(within(row).getByRole('button', { name: /copy and edit/i })).toBeTruthy();
    expect(within(row).queryByRole('button', { name: /^edit questions$/i })).toBeNull();
  });

  test('editing a house set saves a copy and leaves the original alone', async () => {
    // THE OTHER HALF OF THE OWNER'S MODEL, and the mirror of the owned-set test
    // below: editing a set you own makes a new VERSION of it; editing a set an
    // administrator made gives you a NEW SET.
    //
    // rejects: handing the editor a house set with canManage stripped or forced
    // true. QuestionsPanel forks on exactly that flag, so a shelf that passes a
    // set claiming to be manageable would send `replaceSetId` and overwrite the
    // administrator's set — the label promises a copy and the save would take
    // the original. Asserting the button's text cannot catch that; only the
    // request body can.
    // Its own list: the shared fixture's house sets are `trivia`, and the mocked
    // questions route serves one call-and-answer body for every set id, so those
    // rows load without the options and correct answer a trivia row needs and
    // the save is refused on validation before it ever reaches the fork branch.
    // That is the fixture disagreeing with itself, not the product — so this
    // test supplies a house set whose type matches the questions it will get.
    const HOUSE_CALL_AND_ANSWER = [
      HOST_VIEW[0],
      {
        id: 'house-retro', name: 'House Retro', description: 'House content',
        engagementType: 'call-and-answer', totalQuestions: 12, categoryCount: 2,
        active: true, hasImages: false, canManage: false, mine: false, createdByName: null,
      },
    ];
    const { uploads } = await openDialog({}, { sets: HOUSE_CALL_AND_ANSWER });

    const row = screen.getByText('House Retro').closest('tr');
    fireEvent.click(within(row).getByRole('button', { name: /copy and edit/i }));
    await screen.findByTestId('question-0');

    fireEvent.click(within(screen.getByTestId('question-0')).getByRole('button', { name: /^edit$/i }));
    const form = await screen.findByRole('dialog', { name: /^edit question$/i });
    fireEvent.change(within(form).getByLabelText('Title *'), { target: { value: 'MY OWN TAKE' } });
    fireEvent.click(within(form).getByRole('button', { name: /^done$/i }));

    // The save button says which save it is BEFORE it is pressed — "Save as my
    // own copy…", not "Save" — and the ellipsis is honest: it opens a naming
    // step rather than writing anything. That is the promise being kept.
    fireEvent.click(screen.getAllByRole('button', { name: /save as my own copy/i })[0]);

    // It names the original and promises to leave it alone, before anything is
    // written. Targeted by its label rather than by role, because this dialog is
    // one of the two raw .modal-overlay divs that never registered with the
    // Modal primitive and so carries no role="dialog" — tracked separately.
    expect(await screen.findByLabelText('Name the new set')).toBeTruthy();
    expect(screen.getByText(/the original is left exactly as it is/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^create the set$/i }));

    await waitFor(() => expect(uploads()).toHaveLength(1));
    const [body] = uploads();
    expect(body.replaceSetId).toBeUndefined();
    expect(body.customTitle).toBeTruthy();
    expect(body.fileContent).toContain('MY OWN TAKE');
  });

  test('an admin, on the same screen, sees every set as manageable', async () => {
    // rejects: hardcoding "hosts see only their own" as a local rule instead of
    // rendering the server's canManage. An admin may change any set, and this is
    // the same component.
    await openDialog({}, { sets: ADMIN_VIEW });
    expect(screen.getAllByRole('button', { name: /^rename$/i })).toHaveLength(3);
    expect(screen.queryByText(/other sets are available to play/i)).toBeNull();
  });

  test('a host with nothing of their own gets an empty state, not an empty table', async () => {
    // rejects: the console's three-path empty state being reused — two of those
    // three paths are admin-only routes, so it would advertise buttons that are
    // not here.
    await openDialog({}, { sets: HOST_VIEW.map((s) => ({ ...s, canManage: false })) });
    expect(screen.getByText(/you haven't made a question set yet/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /generate with ai/i })).toBeNull();
  });
});

/* ----------------------------------------------------------------- rename -- */

describe('rename', () => {
  test('saves to the edit route for that set and re-reads the list', async () => {
    await openDialog();
    fireEvent.click(within(rowFor('Ivy Retro')).getByRole('button', { name: /rename/i }));
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'Ivy Retro v2' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    // rejects: posting to the wrong route, or building the URL without the set
    // id — both of which would 404 or edit the wrong row.
    await waitFor(() => expect(
      authFetch.mock.calls.some(([url, opt]) =>
        (opt?.method === 'PUT') && url.endsWith('/admin/edit-question-set/ivy-retro'))
    ).toBe(true));

    // rejects: leaving the list stale after a successful save, which is the
    // "did that work?" state the delete dialog was rebuilt to remove.
    await waitFor(() => expect(
      authFetch.mock.calls.filter(([url, opt]) =>
        (opt?.method || 'GET') === 'GET' && /question-sets$/.test(url)).length
    ).toBe(2));
  });

  test('Save is refused locally while the name is blank', async () => {
    // rejects: sending `{ name: '' }`, which the handler rejects with a 400 —
    // a round trip to learn what the form already knows.
    await openDialog();
    fireEvent.click(within(rowFor('Ivy Retro')).getByRole('button', { name: /rename/i }));
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
  });

  test("a 403 from the API is shown in the API's own words", async () => {
    // THE OTHER HALF OF "A HIDDEN BUTTON IS NOT A PERMISSION". If the list and
    // the handler ever disagree about ownership, the handler is the one that
    // decided, so its sentence is what the person must read.
    // rejects: swallowing the error, or replacing it with a local guess like
    // "Something went wrong" that says nothing about why.
    await openDialog({}, { editStatus: 403 });
    fireEvent.click(within(rowFor('Ivy Retro')).getByRole('button', { name: /rename/i }));
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/belongs to someone else/i);
    // rejects: closing the editor on a failure, which loses what was typed and
    // makes the refusal look like a save.
    expect(screen.getByLabelText(/^name$/i)).toBeTruthy();
  });
});

/* ------------------------------------------------- editing the questions --- */

/**
 * THE SHARED EDITOR, MOUNTED HERE. The owner: *"expose the same style (maybe the
 * same modal etc) to the host question set screens. why recreate everything."*
 *
 * So these tests are about a MOUNT, not about a new screen: what they assert is
 * that the console's own `QuestionSetEditor` appears, that the three controls
 * whose routes a host is refused do not, and that the write a host IS allowed
 * goes out on the route that allows it.
 */
describe('a host edits the questions in a set they own', () => {
  const openEditor = async (name = 'Ivy Retro') => {
    fireEvent.click(within(rowFor(name)).getByRole('button', { name: /edit questions/i }));
    // The working copy arrives from `GET question-sets/{id}/questions`, so wait
    // for a row rather than for the panel — the panel renders while loading.
    await screen.findByTestId('question-0');
    return screen.getByTestId('questions-panel');
  };

  test('the affordance is drawn on manageable rows and nowhere else', async () => {
    // rejects: putting the button in the dialog header, or on every row and
    // relying on the 403. `mine` is `sets.filter((set) => set.canManage)` — the
    // SERVER's answer, from the same function `requireSetManager` enforces with
    // — so the control cannot exist for a set the replace would refuse.
    await openDialog();
    expect(screen.getAllByRole('button', { name: /^edit questions$/i })).toHaveLength(1);
    expect(within(rowFor('Ivy Retro')).getByRole('button', { name: /^edit questions$/i })).toBeTruthy();
  });

  test('an admin on the same screen gets one per row', async () => {
    // rejects: hardcoding "one editable set" or re-deriving ownership locally.
    // Same component, same rule, three manageable rows.
    await openDialog({}, { sets: ADMIN_VIEW });
    expect(screen.getAllByRole('button', { name: /^edit questions$/i })).toHaveLength(3);
  });

  test('it opens the console editor itself, with the set’s real questions', async () => {
    // rejects: a host-only re-implementation of the editor, which is the thing
    // the owner asked NOT to happen. These are QuestionSetEditor's own heading
    // and QuestionsPanel's own testid, rendered from the real components.
    await openDialog();
    await openEditor();
    expect(screen.getByRole('heading', { name: /edit question set/i })).toBeTruthy();
    expect(screen.getByText('WHAT WENT WRONG')).toBeTruthy();
    expect(screen.getByText('WHAT WOULD YOU CHANGE')).toBeTruthy();
  });

  test('the editor stays inside the host dialog’s scrim subtree', async () => {
    // NOT A GEOMETRIC ASSERTION — jsdom has no layout engine. This is DOM
    // CONTAINMENT, which is what the stacking actually depends on:
    // `.qsets-scrim--over` is fixed with z-index 10001 and so is its own
    // stacking context, which is the only reason a z-index-60 scrim and a
    // z-index-9999 `.modal-overlay` paint ABOVE it rather than behind.
    // rejects: hoisting the editor out through `afterContent` or a portal, which
    // would drop `.modal-overlay`'s 9999 beside `.new-game-overlay`'s 10000 —
    // and would also degrade `Modal.topmostEntry()`, which decides by
    // containment, to its mount-order tiebreak.
    await openDialog();
    const panel = await openEditor();
    const over = document.querySelector('.qsets-scrim--over');
    expect(over).not.toBeNull();
    expect(over.contains(panel)).toBe(true);
  });

  test('the three admins-only controls are absent, and their routes untouched', async () => {
    // THE POINT OF THE FLAGS. Each of these 403s for a host
    // (tests/question-set-ownership.js:276-290 asserts every one against the
    // real authorizer), so drawing the control would be an invitation to a
    // refusal. rejects: mounting the editor with its defaults.
    const { refused } = await openDialog();
    await openEditor();
    expect(screen.queryByRole('button', { name: /download csv/i })).toBeNull();
    expect(screen.queryByRole('heading', { name: /^versions$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /promote/i })).toBeNull();

    fireEvent.click(screen.getAllByRole('button', { name: /add a question/i })[0]);
    await screen.findByRole('dialog', { name: /new question/i });
    expect(screen.queryByRole('button', { name: /draft this with ai/i })).toBeNull();

    // rejects: hiding the Versions panel but still asking for the list. The
    // editor swallows a failed version load into an empty list, so a request
    // that 403s would look exactly like a set with no history.
    expect(refused).toEqual({ versions: 0, download: 0, ai: 0 });
  });

  test('an edit saves back to the host’s own set, on the route hosts may call', async () => {
    // THE FEATURE. `POST /admin/upload-questions` with `replaceSetId` is on
    // HOST_ADMIN_ROUTES and ownership-guarded end to end by `requireSetManager`
    // (upload-questions.js:183), proved against the real handler in
    // tests/question-set-ownership.js:571-617. rejects: the mount being
    // read-only, or the save forking into a new set for a set the host owns —
    // `customTitle` instead of `replaceSetId` would silently strand the edit in
    // a copy.
    const { uploads } = await openDialog();
    await openEditor();

    fireEvent.click(within(screen.getByTestId('question-0')).getByRole('button', { name: /^edit$/i }));
    const form = await screen.findByRole('dialog', { name: /^edit question$/i });
    fireEvent.change(within(form).getByLabelText('Title *'), { target: { value: 'WHAT WENT RIGHT' } });
    fireEvent.click(within(form).getByRole('button', { name: /^done$/i }));

    fireEvent.click(screen.getAllByRole('button', { name: /^save$/i })[0]);

    await waitFor(() => expect(uploads()).toHaveLength(1));
    const [body] = uploads();
    expect(body.replaceSetId).toBe('ivy-retro');
    expect(body.customTitle).toBeUndefined();
    expect(body.fileContent).toContain('WHAT WENT RIGHT');
  });

  test('Escape closes the editor when there is nothing to lose', async () => {
    // rejects: an editor that cannot be dismissed from the keyboard, and rejects
    // Escape reaching past it and closing the whole shelf — `Modal` answers the
    // innermost dialog only, and here that is the editor.
    await openDialog();
    await openEditor();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('questions-panel')).toBeNull());
    expect(screen.getByRole('dialog', { name: /your question sets/i })).toBeTruthy();
  });

  test('Escape declines while an unsaved working copy is open', async () => {
    // THE WORK-LOSS GUARD. The Questions panel holds edits that exist nowhere
    // but this tab; the editor's own Cancel asks before dropping them, and
    // Escape is answered by the Modal, which cannot reach that dialog. rejects:
    // wiring Escape straight to close, which throws an afternoon away on one
    // keypress with no question asked.
    await openDialog();
    await openEditor();
    fireEvent.click(within(screen.getByTestId('question-0')).getByRole('button', { name: /^edit$/i }));
    const form = await screen.findByRole('dialog', { name: /^edit question$/i });
    fireEvent.change(within(form).getByLabelText('Title *'), { target: { value: 'CHANGED' } });
    fireEvent.click(within(form).getByRole('button', { name: /^done$/i }));
    await screen.findByTestId('unsaved-bar');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByTestId('questions-panel')).toBeTruthy();
    expect(screen.getByTestId('unsaved-bar')).toBeTruthy();
  });
});

/* ----------------------------------------------------------------- delete -- */

describe('delete', () => {
  test('opens the shared confirm dialog for that set', async () => {
    // rejects: wiring Delete straight to the request. The shared dialog is the
    // one that survived Q1 — it closes on acknowledgement, not on send.
    await openDialog();
    fireEvent.click(within(rowFor('Ivy Retro')).getByRole('button', { name: /^delete$/i }));
    const modal = await screen.findByRole('dialog', { name: /delete this question set/i });
    expect(within(modal).getByText(/Ivy Retro/)).toBeTruthy();
  });

  test('does not offer "deactivate instead" — that is admin curation', async () => {
    // The Active toggle is `POST /admin/toggle-question-set`, which stays
    // admins-only. rejects: passing onDeactivate through and giving a host a
    // button that 403s.
    await openDialog();
    fireEvent.click(within(rowFor('Ivy Retro')).getByRole('button', { name: /^delete$/i }));
    await screen.findByRole('dialog', { name: /delete this question set/i });
    expect(screen.queryByRole('button', { name: /deactivate it instead/i })).toBeNull();
  });
});

/* ----------------------------------------------------------------- create -- */

describe('create', () => {
  test('the upload form is the shared one, with the admin machinery switched off', async () => {
    await openDialog();
    fireEvent.click(screen.getByRole('button', { name: /new question set/i }));

    // Still the real form: the type control and the CSV upload are the point.
    expect(screen.getByLabelText(/engagement type/i)).toBeTruthy();
    expect(screen.getByLabelText(/csv file/i)).toBeTruthy();

    // rejects: handing a host the console's form whole. Each of these is either
    // an admins-only route or a library-curation field, and every one of them
    // would be a dead or refused control here.
    expect(screen.queryByRole('button', { name: /AI .* builder/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /manual builder/i })).toBeNull();
    expect(screen.queryByLabelText(/AI summary prompt/i)).toBeNull();
    expect(screen.queryByLabelText(/custom instructions/i)).toBeNull();
    expect(screen.queryByLabelText(/AI context instructions/i)).toBeNull();
  });

  test('the template download stays, because it is how a host starts', async () => {
    // rejects: switching off the whole Create section along with the builders.
    // `GET /admin/download-template` is on the host route list precisely so this
    // works, and without a template nobody knows the columns.
    await openDialog();
    fireEvent.click(screen.getByRole('button', { name: /new question set/i }));
    expect(screen.getByRole('button', { name: /^download call & answer template$/i })).toBeTruthy();
  });

  test('the dialog opens on the format the create screen is already using', async () => {
    // rejects: defaulting to call-and-answer regardless. A host who picked
    // Trivia and then went to make a set means a trivia set, and the type
    // decides how the importer reads their columns.
    await openDialog({ engagementType: 'trivia' });
    fireEvent.click(screen.getByRole('button', { name: /new question set/i }));
    expect(screen.getByLabelText(/engagement type/i).value).toBe('trivia');
  });
});

/* ------------------------------------------------- the way in, from create -- */

describe('the entry point is the create-engagement screen', () => {
  const SETS = [
    { id: 'ivy-retro', name: 'Ivy Retro', totalQuestions: 12, engagementType: 'call-and-answer' },
  ];

  const mountSetup = (props = {}) => render(
    <GameSetupDialog
      eventTitle="Q3 Offsite"
      questionSets={SETS}
      categories={[]}
      onCreate={jest.fn()}
      {...props}
    />
  );

  test('the create screen offers a way to your question sets', async () => {
    // THE OWNER'S PLACEMENT, ASSERTED. rejects: putting the entry anywhere else,
    // or only in the admin console — which is the screen most hosts cannot open.
    mockApi();
    mountSetup();
    expect(screen.getByRole('button', { name: /your question sets/i })).toBeTruthy();
  });

  test('with no sets of that format the offer becomes "make one"', async () => {
    // rejects: one label for both states. "Your question sets" is a strange
    // thing to click when you have none.
    mockApi();
    mountSetup({ questionSets: [] });
    expect(screen.getByRole('button', { name: /make a question set/i })).toBeTruthy();
  });

  test('the empty-set help no longer sends the host to the admin console', async () => {
    // THE DEAD END THIS REPLACES. The shipped copy read "Build one in the
    // question set editor, then come back" — the editor is the admin console,
    // and it named that dead end to the exact person least able to open it.
    // rejects: the old sentence coming back.
    mockApi();
    mountSetup({ questionSets: [] });
    expect(screen.queryByText(/in the question set editor/i)).toBeNull();
    expect(screen.getByText(/Make one now/i)).toBeTruthy();
  });

  test('clicking it opens the sets dialog over the create screen', async () => {
    mockApi();
    mountSetup();
    fireEvent.click(screen.getByRole('button', { name: /your question sets/i }));
    expect(await screen.findByRole('dialog', { name: /your question sets/i })).toBeTruthy();
  });

  test('a set made here is selectable immediately, without a page reload', async () => {
    // The page owns `questionSets` and re-reads it on mount, not on demand, and
    // this component cannot ask it to. rejects: dropping the merge, which leaves
    // a host staring at a picker that does not contain the set they just spent
    // five minutes making.
    let fetched = 0;
    mockApi({
      sets: () => {
        fetched += 1;
        return fetched === 1 ? HOST_VIEW : [
          ...HOST_VIEW,
          {
            id: 'fresh', name: 'Fresh Set', engagementType: 'call-and-answer',
            totalQuestions: 8, active: true, canManage: true, mine: true,
          },
        ];
      },
    });
    mountSetup();
    fireEvent.click(screen.getByRole('button', { name: /your question sets/i }));
    await screen.findByRole('dialog', { name: /your question sets/i });

    // A second list read is what a create/rename/delete triggers.
    await waitFor(() => expect(screen.getByText('Ivy Retro')).toBeTruthy());
    fireEvent.click(within(rowFor('Ivy Retro')).getByRole('button', { name: /rename/i }));
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'Ivy Retro v2' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      const picker = document.getElementById('gsd-set');
      expect(within(picker).getByText(/Fresh Set/)).toBeTruthy();
    });
  });

  test('inactive sets are never merged into the picker', async () => {
    // The admin projection carries inactive sets; the public picker endpoint
    // does not, because an inactive set is one an admin has taken out of play.
    // rejects: merging the admin list wholesale and putting a withdrawn set back
    // in front of every host.
    mockApi({
      sets: [
        ...HOST_VIEW,
        {
          id: 'retired', name: 'Retired Set', engagementType: 'call-and-answer',
          totalQuestions: 5, active: false, canManage: true, mine: true,
        },
      ],
    });
    mountSetup();
    fireEvent.click(screen.getByRole('button', { name: /your question sets/i }));
    await screen.findByRole('dialog', { name: /your question sets/i });
    await waitFor(() => expect(screen.getByText('Ivy Retro')).toBeTruthy());

    const picker = document.getElementById('gsd-set');
    expect(within(picker).queryByText(/Retired Set/)).toBeNull();
  });
});
