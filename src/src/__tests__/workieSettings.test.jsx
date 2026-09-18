/**
 * WORKIE, AS ONE SETTING A BUILDER CAN READ.
 *
 * Two fields have always existed on a question set — `personaId` (the voice)
 * and `promptId` (how each round is summed up) — and they rendered as two
 * unrelated form rows a long way apart, labelled "Workie's Voice" and "AI
 * Summary Prompt". Nothing on the screen said they were the same subject, and
 * on an environment with no personas seeded the voice control was a <select>
 * with exactly one option, which reads as "there are no voices" rather than
 * "this is the default and it is the right one".
 *
 * THREE THINGS ARE PINNED HERE.
 *
 *   1. ONE GROUP, PLAIN WORDS. A "Workie" group holding two labelled rows —
 *      *Its voice* and *How it sums up each round* — each with one line of help.
 *
 *   2. A STORED ID THAT RESOLVES TO NOTHING IS SAID OUT LOUD (ruling W4).
 *      A set can hold an id it was given months ago, or one dropped when it was
 *      copied between organisations. `edit-question-set.js` now answers 400 for
 *      a CHANGED dangling value and grandfathers an unchanged one, precisely so
 *      a rename does not fail — which converges only if the builder can SEE the
 *      dangling value and clear it. So the control names it and offers one
 *      click to drop it.
 *
 *   3. THE SETUP DIALOG ONLY PROMISES WHAT WILL HAPPEN. It claimed "This
 *      question set brings its own summary approach" from the mere presence of
 *      `promptId`, with no idea whether that id resolves. It now checks the id
 *      against the prompt list it fetches.
 *
 * WHAT IS DELIBERATELY *NOT* ASSERTED: geometry. jsdom has no layout engine, so
 * "reads as one group" is pinned as containment and labelling, and the CSS that
 * draws the box is measured as text in setEditorChipsPalette.test.js.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import QuestionSetEditor from '../components/QuestionSetEditor';
import GameSetupDialog from '../components/GameSetupDialog';
import { authFetch } from '../auth/authFetch';

jest.mock('../auth/authFetch', () => ({ authFetch: jest.fn() }));

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const SET = {
  id: 'ivy-retro',
  name: 'Ivy Retro',
  engagementType: 'call-and-answer',
  totalQuestions: 12,
  categoryCount: 2,
  activeVersion: 1,
};

/**
 * Four prompts, chosen the way hostWorkieSettings.test.jsx chose its four: one
 * for this set's format, one for every format, one for another format, and one
 * in the PUBLIC scope. The last is P4 — `get-ai-prompts.js` lists public rows
 * and the resolver `edit-question-set.js` writes through accepts only org and
 * platform, so offering one would be offering a choice that cannot be saved.
 */
const PROMPTS = [
  { promptId: 'lessons-learned', name: 'Lessons Learned', status: 'active', gameType: 'call-and-answer', category: 'Retro', scope: 'platform' },
  { promptId: 'themes', name: 'Common Themes', status: 'active', gameType: 'all', scope: 'org', orgId: 'org_a' },
  { promptId: 'quiz-recap', name: 'Quiz Recap', status: 'active', gameType: 'trivia', scope: 'platform' },
  { promptId: 'open-mic', name: 'Open Mic', status: 'active', gameType: 'call-and-answer', scope: 'public' },
];

const PERSONAS = [
  { personaId: 'sage', name: 'Sage', tagline: 'measured and dry' },
  { personaId: 'coach', name: 'Coach', tagline: 'all encouragement' },
];

/** Lenient: the editor also loads versions, questions and media on mount. */
function mockEditorApi() {
  authFetch.mockImplementation(async (url, options = {}) => {
    const method = (options.method || 'GET').toUpperCase();
    if (method === 'PUT' && String(url).includes('/admin/edit-question-set/')) {
      return jsonResponse(200, { message: 'ok', updated: {} });
    }
    return jsonResponse(200, {});
  });
}

const renderEditor = (props = {}) => render(
  <QuestionSetEditor
    questionSet={SET}
    availablePrompts={PROMPTS}
    availablePersonas={PERSONAS}
    onSaved={jest.fn()}
    onChanged={jest.fn()}
    onCancel={jest.fn()}
    {...props}
  />,
);

const voiceSelect = () => document.getElementById('edit-persona-id');
const promptSelect = () => document.getElementById('edit-prompt-id');
const optionLabels = (select) => Array.from(select.options).map((o) => o.textContent.trim());
const edits = () => authFetch.mock.calls
  .filter(([url, opt]) => (opt?.method || '') === 'PUT' && String(url).includes('/admin/edit-question-set/'))
  .map(([, opt]) => JSON.parse(opt.body || '{}'));

beforeEach(() => {
  window.API_BASE = 'https://api.test/dev/';
  authFetch.mockReset();
});

/* ------------------------------------------------------------ one group --- */

describe('the editor shows Workie as one setting with two plain rows', () => {
  // rejects: the shipped layout — "AI Summary Prompt" and "Workie's Voice" as
  // two unrelated rows in a run of eight, with nothing saying they are one
  // subject.
  test('both controls live inside one group headed Workie', () => {
    mockEditorApi();
    renderEditor();
    const group = screen.getByTestId('workie-group');
    expect(within(group).getByRole('heading', { name: /^workie$/i })).toBeTruthy();
    expect(group.contains(voiceSelect())).toBe(true);
    expect(group.contains(promptSelect())).toBe(true);
  });

  // rejects: keeping the jargon. "AI Summary Prompt" names the implementation;
  // the builder is choosing how each round gets summed up.
  test('the rows are labelled in the words a builder would use', () => {
    mockEditorApi();
    renderEditor();
    expect(screen.getByLabelText(/^its voice$/i)).toBe(voiceSelect());
    expect(screen.getByLabelText(/^how it sums up each round$/i)).toBe(promptSelect());
    expect(screen.queryByLabelText(/AI Summary Prompt/i)).toBeNull();
    expect(screen.queryByLabelText(/Workie's Voice/i)).toBeNull();
  });

  // rejects: a group heading with no help, which is a label pretending to be an
  // explanation. One line per row, and one for the group.
  test('each row carries one line of plain help', () => {
    mockEditorApi();
    renderEditor();
    expect(screen.getByTestId('workie-group-help').textContent).toMatch(/after each round/i);
    expect(screen.getByTestId('workie-voice-help').textContent).toMatch(/register/i);
    expect(screen.getByTestId('workie-prompt-help').textContent).toMatch(/summary approach/i);
  });
});

/* ------------------------------------------------- an empty environment --- */

describe('an environment with nothing seeded says so in words', () => {
  // rejects: the reported state. `scripts/seed-personas.js` has no write API and
  // may simply never have been run on a tier; the control then offers one
  // option and says nothing, which reads as a broken picker.
  test('no personas: the voice row says there are none, and keeps its default', () => {
    mockEditorApi();
    renderEditor({ availablePersonas: [] });
    expect(screen.getByTestId('workie-voice-empty').textContent)
      .toMatch(/No voices are set up on this environment yet/i);
    // The select STAYS. hostWorkieSettings.test.jsx pins a refused persona list
    // as "a select with exactly one option" — the words are added beside it,
    // they do not replace it.
    expect(optionLabels(voiceSelect())).toHaveLength(1);
  });

  test('no prompts: the summary row says there are none, and keeps its default', () => {
    mockEditorApi();
    renderEditor({ availablePrompts: [] });
    expect(screen.getByTestId('workie-prompt-empty').textContent)
      .toMatch(/No summary approaches are set up on this environment yet/i);
    expect(optionLabels(promptSelect())).toHaveLength(1);
  });

  // rejects: a sentence that fires whenever the picker is untouched — it must
  // describe the ENVIRONMENT, not the selection.
  test('neither line appears when the lists arrived', () => {
    mockEditorApi();
    renderEditor();
    expect(screen.queryByTestId('workie-voice-empty')).toBeNull();
    expect(screen.queryByTestId('workie-prompt-empty')).toBeNull();
  });
});

/* ---------------------------------------------- W4: a value that dangles --- */

describe('a stored id that resolves to nothing is named, and clearable', () => {
  // rejects: the silent failure. A <select> whose value is not among its options
  // renders as though the FIRST option were chosen, so a set carrying a dead
  // persona id looked exactly like a set carrying none — right up until the
  // save, which Task 1 now refuses with a 400 if the value was touched.
  test('a dangling voice is called out, with the id it is stuck on', () => {
    mockEditorApi();
    renderEditor({ questionSet: { ...SET, personaId: 'ghost' } });
    const notice = screen.getByTestId('workie-voice-unavailable');
    expect(notice.textContent).toMatch(/does not offer/i);
    expect(notice.textContent).toMatch(/ghost/);
    expect(notice.textContent).toMatch(/adapt to the session/i);
  });

  test('a dangling summary approach is called out the same way', () => {
    mockEditorApi();
    renderEditor({ questionSet: { ...SET, promptId: 'ghost-prompt' } });
    const notice = screen.getByTestId('workie-prompt-unavailable');
    expect(notice.textContent).toMatch(/does not offer/i);
    expect(notice.textContent).toMatch(/ghost-prompt/);
  });

  // rejects: naming the problem and leaving the builder to guess the cure. The
  // whole point of W4 is that the dangling value CONVERGES rather than festering
  // behind a grandfather clause.
  test('one click clears the dangling voice', () => {
    mockEditorApi();
    renderEditor({ questionSet: { ...SET, personaId: 'ghost' } });
    fireEvent.click(within(screen.getByTestId('workie-voice-unavailable')).getByRole('button'));
    expect(screen.queryByTestId('workie-voice-unavailable')).toBeNull();
    expect(voiceSelect().value).toBe('');
  });

  test('one click clears the dangling summary approach', () => {
    mockEditorApi();
    renderEditor({ questionSet: { ...SET, promptId: 'ghost-prompt' } });
    fireEvent.click(within(screen.getByTestId('workie-prompt-unavailable')).getByRole('button'));
    expect(screen.queryByTestId('workie-prompt-unavailable')).toBeNull();
    expect(promptSelect().value).toBe('');
  });

  // rejects: a Clear that only changes the screen. An empty string is what the
  // backend reads as "clear it" (buildEditPayload), and clearing is always
  // allowed by the resolver — that is the escape hatch out of the 400.
  test('clearing and saving sends the cleared field', async () => {
    mockEditorApi();
    renderEditor({ questionSet: { ...SET, promptId: 'ghost-prompt' } });
    fireEvent.click(within(screen.getByTestId('workie-prompt-unavailable')).getByRole('button'));
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() => expect(edits()).toHaveLength(1));
    expect(edits()[0].promptId).toBe('');
  });

  // rejects: two voices on one row. `PromptShapePreview` answers an id it cannot
  // find with "this prompt uses the standard shape" — a sentence about a prompt
  // that is not there, printed immediately under a warning saying it is not there.
  test('the shape preview stands down for a prompt that is not there', () => {
    mockEditorApi();
    renderEditor({ questionSet: { ...SET, promptId: 'ghost-prompt' } });
    expect(document.querySelector('.prompt-shape-preview')).toBeNull();
    // It is back the moment the dead id is cleared.
    fireEvent.click(within(screen.getByTestId('workie-prompt-unavailable')).getByRole('button'));
    expect(document.querySelector('.prompt-shape-preview')).toBeTruthy();
  });

  // rejects: crying wolf. A value that IS in the list gets no warning — it gets
  // its name, so the builder can read the choice without opening the picker.
  test('a value that resolves is named rather than warned about', () => {
    mockEditorApi();
    renderEditor({ questionSet: { ...SET, personaId: 'sage', promptId: 'lessons-learned' } });
    expect(screen.queryByTestId('workie-voice-unavailable')).toBeNull();
    expect(screen.queryByTestId('workie-prompt-unavailable')).toBeNull();
    expect(screen.getByTestId('workie-voice-help').textContent).toMatch(/Sage/);
    expect(screen.getByTestId('workie-prompt-help').textContent).toMatch(/Lessons Learned/);
  });
});

/* --------------------------------------------------------- P4: the scope --- */

describe('the picker never offers a scope the writer would refuse', () => {
  // rejects: offering a public prompt. `get-ai-prompts.js` queries org, platform
  // AND public; `shared/workie-refs.js` resolves org then platform only. No admin
  // path creates a public prompt today, so this is latent rather than broken —
  // and latent is exactly when it is cheap to close.
  test('a public-scoped prompt is not an option', () => {
    mockEditorApi();
    renderEditor();
    const labels = optionLabels(promptSelect()).join('|');
    expect(labels).toMatch(/Lessons Learned/);
    expect(labels).toMatch(/Common Themes/);
    expect(labels).not.toMatch(/Open Mic/);
  });

  // rejects: closing P4 by filtering the list the count is taken FROM. The
  // sentence is `availablePrompts.length - choices.length`, and a caller (or a
  // helper) that pre-filters the raw list makes the count zero and the sentence
  // a lie. hostWorkieSettings.test.jsx pins the same sentence from the host side.
  test('the hidden-prompt sentence survives', () => {
    mockEditorApi();
    renderEditor();
    expect(screen.getByText(/prompts? for other game types are hidden/i)).toBeTruthy();
  });
});

/* ------------------------------------------- the setup dialog's promise --- */

const SETS = [
  { id: 'plain', name: 'Plain Set', totalQuestions: 9, engagementType: 'call-and-answer', hasImages: false },
  { id: 'lp', name: 'Leadership Principles', totalQuestions: 10, engagementType: 'call-and-answer', hasImages: false, promptId: 'lessons-learned' },
  { id: 'ghosted', name: 'Ghosted', totalQuestions: 4, engagementType: 'call-and-answer', hasImages: false, promptId: 'ghost-prompt' },
];

function mockPromptApi({ status = 200, throws = false } = {}) {
  authFetch.mockImplementation(async (url) => {
    if (throws) throw new Error('no session');
    if (/\/admin\/ai-prompts$/.test(String(url))) {
      return status === 200
        ? jsonResponse(200, { prompts: PROMPTS })
        : jsonResponse(status, { error: 'nope' });
    }
    return jsonResponse(200, {});
  });
  return {
    promptCalls: () => authFetch.mock.calls.filter(([url]) => /\/admin\/ai-prompts$/.test(String(url))),
  };
}

function renderDialog(overrides = {}) {
  return render(
    <GameSetupDialog
      isFirstEngagement
      eventTitle=""
      onEventTitleChange={jest.fn()}
      questionSets={SETS}
      personas={PERSONAS}
      categories={[{ name: 'Retro', questionCount: 9 }]}
      activeCategoryIds={new Set(['Retro'])}
      onToggleCategory={jest.fn()}
      onQuestionSetChange={jest.fn()}
      onCancel={jest.fn()}
      onCreate={jest.fn()}
      {...overrides}
    />,
  );
}

const setSelect = () => screen.getByLabelText(/question set/i);
const plan = () => screen.getByTestId('gsd-workie-plan');

describe('the setup dialog only promises what will happen', () => {
  // rejects: reading `promptId` as proof. The id is a reference into a library
  // this host may not be able to read — an org prompt survives a copy into
  // another org today — and the sentence was written as a promise.
  test('a set whose prompt resolves is promised, and says so', async () => {
    mockPromptApi();
    renderDialog();
    fireEvent.change(setSelect(), { target: { value: 'platform:lp' } });
    await waitFor(() => expect(plan().textContent).toMatch(/brings its own summary approach/i));
    expect(plan().textContent).not.toMatch(/standard/i);
  });

  // THE HEADLINE. rejects: the shipped claim, which this set has always earned
  // by carrying a string.
  test('a set whose prompt is not in the fetched list gets the standard sentence', async () => {
    mockPromptApi();
    renderDialog();
    fireEvent.change(setSelect(), { target: { value: 'platform:ghosted' } });
    await waitFor(() => expect(plan().textContent).toMatch(/standard Call & Answer way/));
    expect(plan().textContent).not.toMatch(/brings its own/i);
  });

  // rejects: treating a list that never arrived as proof of absence. A 403, a
  // 500 or a request that could not be signed says nothing about the set, and
  // answering it with "the standard way" would be the SAME over-claim pointed
  // the other way.
  test('a list that would not load is not evidence against the set', async () => {
    mockPromptApi({ status: 500 });
    renderDialog();
    fireEvent.change(setSelect(), { target: { value: 'platform:ghosted' } });
    await waitFor(() => expect(plan()).toBeTruthy());
    expect(plan().textContent).toMatch(/brings its own summary approach/i);
  });

  test('a thrown request is caught rather than left unhandled', async () => {
    mockPromptApi({ throws: true });
    renderDialog();
    fireEvent.change(setSelect(), { target: { value: 'platform:plain' } });
    await waitFor(() => expect(plan().textContent).toMatch(/standard Call & Answer way/));
  });

  // rejects: a fetch in the render body, which would re-read the list on every
  // keystroke in the event-title field.
  test('the prompt list is read once, when the dialog opens', async () => {
    const { promptCalls } = mockPromptApi();
    renderDialog();
    await waitFor(() => expect(promptCalls()).toHaveLength(1));
    fireEvent.change(setSelect(), { target: { value: 'platform:lp' } });
    fireEvent.change(setSelect(), { target: { value: 'platform:plain' } });
    expect(promptCalls()).toHaveLength(1);
  });
});
