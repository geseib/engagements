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

function mockApi({ sets = HOST_VIEW, editStatus = 200, editBody = null, deleteStatus = 200, uploadStatus = 200 } = {}) {
  let listCalls = 0;
  authFetch.mockImplementation(async (url, options = {}) => {
    const method = (options.method || 'GET').toUpperCase();
    if (method === 'GET' && /\/admin\/question-sets$/.test(url)) {
      listCalls += 1;
      return jsonResponse(200, { questionSets: typeof sets === 'function' ? sets(listCalls) : sets });
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
      return uploadStatus === 200
        ? jsonResponse(200, { message: 'Successfully created question set "Fresh"' })
        : jsonResponse(uploadStatus, { error: 'nope' });
    }
    if (method === 'GET' && url.includes('/admin/download-template')) {
      return jsonResponse(200, { filename: 'caa-template.csv', content: 'Category,Title' });
    }
    throw new Error(`Unhandled request: ${method} ${url}`);
  });
  return { editUrls: () => authFetch.mock.calls.filter((c) => (c[1]?.method || 'GET') === 'PUT').map((c) => c[0]) };
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

  test("another host's set is not listed at all, so it carries no controls", async () => {
    // THE HEADLINE AFFORDANCE. rejects: rendering every set and relying on the
    // API to say no — a Delete button on somebody else's work is an invitation,
    // and a disabled one is a lie about what could be requested.
    await openDialog();
    expect(screen.queryByText('Raj Quiz')).toBeNull();
    expect(screen.queryByText('80s Trivia')).toBeNull();
  });

  test('exactly two controls exist — one Rename, one Delete', async () => {
    // rejects: `canManage` being ignored and every row drawing its pair. Counting
    // is what catches a filter that was written and then not applied.
    await openDialog();
    expect(screen.getAllByRole('button', { name: /^rename$/i })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /^delete$/i })).toHaveLength(1);
  });

  test('the library the host cannot change is counted, and the rule is stated', async () => {
    // rejects: hiding the other sets silently, which leaves a host who can PLAY
    // 41 sets wondering where 40 of them went.
    await openDialog();
    expect(screen.getByText(/2 other sets are available to play/i)).toBeTruthy();
    expect(screen.getByText(/only an administrator can change them/i)).toBeTruthy();
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
