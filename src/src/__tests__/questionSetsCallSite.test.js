/**
 * THE WIRING BACK INTO AdminPage.jsx.
 *
 * `AdminPage.jsx` cannot be mounted in jsdom — `useAuth` hard-throws when the
 * context is null (`AuthContext.jsx:27-30`) and the only provider is the real
 * Cognito one, which is why `AdminPage.test.jsx` has failed 8/8 since it was
 * written. That gap is exactly where an extraction ships as DEAD CODE: three new
 * component files nobody renders, with the old markup still on screen.
 *
 * Same shape as `sessionsPanel.test.jsx`'s last describe and
 * `adminShellPalette.test.js`: read the source, strip the comments, assert.
 *
 * THE COMMENTS ARE STRIPPED FIRST, and this is not ceremony — a previous
 * agent's source assertion in this repo passed ON A COMMENT, which is why
 * `podium.test.jsx` carries a `stripComments()` helper. `AdminPage.jsx` now
 * documents every one of the removals below in prose, so every negative
 * assertion here would pass against the deleted code without the strip.
 */
const fs = require('fs');
const path = require('path');

/** Source with every comment removed. Copied from podium.test.jsx. */
const stripComments = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/([^:'"`\\])\/\/.*$/gm, '$1');

const page = stripComments(fs.readFileSync(path.join(__dirname, '..', 'AdminPage.jsx'), 'utf8'));

describe('the three extracted components are actually mounted', () => {
  test.each([
    ['QuestionSetsPanel', /import QuestionSetsPanel from '\.\/components\/QuestionSetsPanel'/, /<QuestionSetsPanel[\s>]/],
    ['QuestionSetUploadPanel', /import QuestionSetUploadPanel from '\.\/components\/QuestionSetUploadPanel'/, /<QuestionSetUploadPanel[\s>]/],
    ['QuestionSetDeleteDialog', /import QuestionSetDeleteDialog from '\.\/components\/QuestionSetDeleteDialog'/, /<QuestionSetDeleteDialog[\s>]/],
  ])('%s is imported and rendered', (_name, importRe, useRe) => {
    expect(page).toMatch(importRe);
    expect(page).toMatch(useRe);
  });
});

describe('Q1 — the dead handler and the state nothing rendered are gone', () => {
  test('handleDeleteQuestionSet is deleted rather than wired', () => {
    // It was DEAD: the only wired path was the row button via
    // handleDeleteQuestionSetFromList, and its 'Please select a question set to
    // delete' branch belonged to a selector this screen has not had for months.
    // rejects: reviving it, which would reintroduce a guard for a control that
    // does not exist.
    expect(page).not.toMatch(/handleDeleteQuestionSet\b(?!From)/);
    expect(page).not.toMatch(/Please select a question set to delete/);
  });

  test('the state that was written six times and rendered zero times is gone', () => {
    // rejects: leaving questionSetDeleteStatus behind in the page while the
    // dialog owns its own — two sources of truth for one outcome is how it
    // became unrendered in the first place.
    expect(page).not.toMatch(/questionSetDeleteStatus/);
    expect(page).not.toMatch(/isDeletingQuestionSet/);
    expect(page).not.toMatch(/showQuestionSetDeleteConfirm/);
  });

  test('the old modal markup does not survive beside the new dialog', () => {
    // rejects: two delete paths on one screen, which is what happened to
    // Sessions when its danger card was left in place beside the new list.
    expect(page).not.toMatch(/Confirm Question Set Deletion/);
    expect(page).not.toMatch(/Yes, Delete Question Set/);
  });

  test('the page reacts to the dialog’s outcome rather than assuming one', () => {
    // rejects: `onDeleted={() => setDeletingSet(null)}` — closing without
    // re-reading the list leaves the deleted row on screen until a reload.
    expect(page).toMatch(/onDeleted=\{handleSetDeleted\}/);
    expect(page).toMatch(/const handleSetDeleted[\s\S]{0,220}fetchQuestionSets\(\)/);
  });

  test('the reversible neighbour is wired to the toggle that already exists', () => {
    // rejects: a "deactivate instead" link that only closes the dialog. It has
    // to call the same endpoint the Active chip calls, or it is decoration.
    expect(page).toMatch(/onDeactivate=\{handleDeactivateInstead\}/);
    expect(page).toMatch(/const handleDeactivateInstead[\s\S]{0,300}handleToggleActive\(/);
  });
});

describe('Q2 and Q4 — the list, its filters and both empty states left this file', () => {
  test('the empty state that pointed "above" is gone', () => {
    // "No question sets found. Upload your first question set above to get
    // started" — while the upload form was BELOW it and collapsed by default.
    // rejects: restoring it here, where it cannot be rendered in a test.
    expect(page).not.toMatch(/Upload your first question set/);
    expect(page).not.toMatch(/No question sets found matching your filters/);
  });

  test('the hand-written type filter is gone', () => {
    // Four <option> elements listing four of five types. rejects: any
    // hand-written engagement-type option list surviving in this file.
    expect(page).not.toMatch(/<option value="wavelength">/);
    expect(page).not.toMatch(/<option value="call-and-answer">/);
    expect(page).not.toMatch(/selectedQuestionSetType/);
  });

  test('the second copy of the list is gone', () => {
    // filterQuestionSets() wrote a second array into filteredQuestionSets on
    // every keystroke. rejects: keeping it in sync with the panel's own filter
    // state, which is two implementations of one rule.
    expect(page).not.toMatch(/filteredQuestionSets/);
    expect(page).not.toMatch(/filterQuestionSets/);
  });

  test('loading is distinguishable from empty', () => {
    // rejects: passing only the array, which makes the first paint of a console
    // with 41 sets offer to create the first one.
    expect(page).toMatch(/loading=\{questionSetsLoading\}/);
  });
});

describe('Q6 — one engagement-type control', () => {
  test('AdminPage renders no engagement-type select of its own', () => {
    // Both duplicates lived here: id="engagement-type" in the upload accordion
    // and id="new-set-engagement-type" beside the AI builder buttons, over one
    // state. rejects: either of them coming back.
    expect(page).not.toMatch(/id="engagement-type"/);
    expect(page).not.toMatch(/id="new-set-engagement-type"/);
    expect(page).not.toMatch(/setEngagementType\(e\.target\.value\)/);
  });

  test('the state stays here, because the builder modals read it', () => {
    // rejects: moving engagementType into the panel, which would leave the four
    // builder modals reading a value nothing updates.
    expect(page).toMatch(/const \[engagementType, setEngagementType\] = useState/);
    expect(page).toMatch(/onEngagementTypeChange=\{setEngagementType\}/);
  });

  test('one function decides which builder a type opens', () => {
    // It used to be an inline if/else chain inside the button's onClick, beside
    // the duplicate select. rejects: a second copy of that chain.
    expect(page).toMatch(/const handleOpenBuilder = \(type\)/);
    expect(page).toMatch(/onOpenBuilder=\{handleOpenBuilder\}/);
  });
});

describe('Q5 — the hand-rolled CSV parse left this file', () => {
  test('the naive header split is gone', () => {
    // `lines[0].split(',').map(h => h.replace(/"/g, '').trim())` mis-parses any
    // quoted comma. rejects: it coming back anywhere in this file.
    expect(page).not.toMatch(/lines\[0\]\.split/);
    expect(page).not.toMatch(/replace\(\/"\/g, ''\)/);
    expect(page).not.toMatch(/handleFileSelect/);
  });
});

/* -------------------------------------------------------------------------- */

/**
 * THE HOST'S CALL SITE — components/HostQuestionSetsDialog.jsx.
 *
 * The owner: *"expose the same style (maybe the same modal etc) to the host
 * question set screens. why recreate everything."* The failure mode that answer
 * rules out is not a broken screen — it is a SECOND screen: a host-shaped copy
 * of the editor that drifts from the admin one a fix at a time. A behavioural
 * test cannot see that; it would pass just as happily against a duplicate. So it
 * is asserted here, at source level, the same way the three extractions above
 * are.
 */
const SRC = path.join(__dirname, '..');

/** Every .jsx under src/ and src/components, as { name, source-without-comments }. */
const modules = () => {
  const out = [];
  for (const dir of [SRC, path.join(SRC, 'components')]) {
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.jsx')) continue;
      out.push({ name, text: stripComments(fs.readFileSync(path.join(dir, name), 'utf8')) });
    }
  }
  return out;
};

/** Which modules RENDER a given component (as opposed to merely mentioning it). */
const rendererNames = (component) => modules()
  .filter((m) => new RegExp(`<${component}[\\s>]`).test(m.text))
  .map((m) => m.name)
  .sort();

const hostDialog = stripComments(
  fs.readFileSync(path.join(SRC, 'components', 'HostQuestionSetsDialog.jsx'), 'utf8'),
);

describe('the host mounts the shared editor rather than a copy of it', () => {
  test('the editor is rendered by exactly the two call sites, and nothing else', () => {
    // rejects: a HostQuestionSetEditor.jsx appearing beside it, which is the
    // thing the owner asked not to happen and the thing that no test of either
    // screen's behaviour would ever notice.
    expect(rendererNames('QuestionSetEditor')).toEqual([
      'AdminPage.jsx', 'HostQuestionSetsDialog.jsx',
    ]);
  });

  test('the questions panel still has exactly one owner', () => {
    // The host reaches it THROUGH the editor. rejects: wiring QuestionsPanel
    // into the host dialog directly as well, which would give the product two
    // add-a-question surfaces with two sets of guards on the same working copy.
    expect(rendererNames('QuestionsPanel')).toEqual(['QuestionSetEditor.jsx']);
  });

  test('the host mount turns off the three admins-only controls', () => {
    // Each is a route `auth/authorizer.js` refuses a host — the CSV download,
    // the version list/promote/delete, and AI generation. rejects: mounting the
    // editor with its defaults, which draws three controls that 403.
    expect(hostDialog).toMatch(/showVersions=\{false\}/);
    expect(hostDialog).toMatch(/showDownload=\{false\}/);
    expect(hostDialog).toMatch(/showAIAssist=\{false\}/);
  });

  test('the editor stays a DOM child of the host dialog, never an afterContent hoist', () => {
    // `.qsets-scrim--over` is fixed with z-index 10001 and so is its own stacking
    // context; the editor's scrim and the question dialog's `.modal-overlay`
    // stack INSIDE it. Hoisted through `afterContent` — the escape hatch
    // GameSetupDialog uses one level up — `.modal-overlay`'s 9999 would land
    // beside `.new-game-overlay`'s 10000 and paint BEHIND the host dialog, and
    // `Modal.topmostEntry()` would lose its containment answer too.
    // rejects: reaching for that hatch here because it worked there.
    expect(hostDialog).not.toMatch(/afterContent/);
  });

  test('AdminPage passes no flags, so the console keeps every default', () => {
    // THE BASELINE, IN SOURCE. The behavioural half is in
    // questionSetEditorQuestions.test.jsx; this is the half that catches someone
    // "tidying up" by pushing the host's flags on to the admin call site.
    const mount = page.slice(page.indexOf('<QuestionSetEditor'), page.indexOf('/>', page.indexOf('<QuestionSetEditor')));
    expect(mount).not.toMatch(/show(Versions|Download|AIAssist)/);
  });
});
