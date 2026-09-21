import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import QuestionPreview, { QuestionViewSwitch } from '../components/QuestionPreview';
import { previewRows, previewCategories, stepSelection } from '../config/questionPreview';
import { toRow, editableRows, savedKeys } from '../utils/questionRows';

/**
 * THE PREVIEW — the list's mechanics, the card, and the one rule about :root.
 *
 * Rendered for real; nothing is mocked. jsdom has no layout engine, so nothing
 * here asserts a size or a position (spec 2026-09-19 §7).
 */
const SET_ID = 'true-crime';
const trivia = (id, fields) => toRow({
  id, optionA: 'Ted Bundy', optionB: 'David Berkowitz', optionC: 'John Wayne Gacy', optionD: 'Richard Ramirez',
  correctAnswer: 'OptionB', difficulty: 'easy', ...fields,
});
const makeRows = () => [
  trivia('c001#001', {
    title: 'Which killer was caught by a parking ticket?', questionDetail: 'New York, 1977.',
    category: 'History', answerDetails: 'Stopped for parking beside a hydrant.',
  }),
  trivia('c002#001', {
    title: 'The Green River case', questionDetail: 'Solved by DNA in 2001.',
    category: 'Method', difficulty: 'hard', correctAnswer: 'OptionC',
  }),
  trivia('c001#002', {
    title: 'Who was dubbed the Night Stalker?', questionDetail: '',
    category: 'History', difficulty: 'medium', correctAnswer: 'OptionD',
    customInstructions: 'Pick the name, not the nickname.',
  }),
];

const renderPreview = (props = {}) => render(
  <QuestionPreview rows={makeRows()} gameType="trivia" setInstruction="Answer for your table." setId={SET_ID} {...props} />
);
const listbox = () => screen.getByRole('listbox', { name: 'Questions' });
const options = () => within(listbox()).getAllByRole('option');
const cardTitle = () => screen.getByTestId('preview-screen').querySelector('h1.q')?.textContent;

describe('the list — the in-session browser\'s mechanics', () => {
  test('every live question, with a count line', () => {
    renderPreview();
    expect(options()).toHaveLength(3);
    expect(screen.getByTestId('preview-count')).toHaveTextContent('Showing 3 of 3');
  });

  test('a removed row is not listed — it will not exist once the set is saved', () => {
    const rows = makeRows();
    rows[1] = { ...rows[1], removed: true };
    renderPreview({ rows });
    expect(listbox().textContent).not.toContain('Green River');
    expect(screen.getByTestId('preview-count')).toHaveTextContent('Showing 2 of 2');
  });

  test('a row is its title on one line, whole on hover, and "Category · difficulty"', () => {
    renderPreview();
    const first = options()[0];
    // rejects: a truncation with no recovery, which is a deletion.
    expect(first.querySelector('.qprev-row-title')).toHaveAttribute('title', 'Which killer was caught by a parking ticket?');
    expect(first.querySelector('.qprev-row-meta')).toHaveTextContent('History · easy');
    // The meta line is cut the same way. Difficulty is written last, so it is
    // the first thing lost — and nothing else in the preview shows it.
    expect(first.querySelector('.qprev-row-meta')).toHaveAttribute('title', 'History · easy');
  });

  test('a row carries the question\'s detail, between the title and the meta', () => {
    // The owner, on the shipped preview: "the question list could be wider and
    // the preview narrower. so that you can read the questions from the list. i
    // like a bit of how the list looks in the session questions menu" — the
    // in-session browser's `.setup-qb__row` (styles.css), which is a title,
    // then the detail, then the meta. The detail is what the preview's row did
    // not have, and the width the list was given is what makes room for it.
    renderPreview();
    const first = options()[0];
    expect(first.querySelector('.qprev-row-detail')).toHaveTextContent('New York, 1977.');
    expect([...first.children].map((el) => el.className)).toEqual([
      'qprev-row-title', 'qprev-row-detail', 'qprev-row-meta',
    ]);
  });

  test('a long detail is clamped rather than cut, and carries its whole text on title=', () => {
    // A reduction with no recovery is a deletion (engage-design hard rule 7).
    // Clamped in CSS with the stage's own idiom (`-webkit-line-clamp`,
    // styles/stage.css), never sliced in JS: the whole string stays in the DOM,
    // so the title= and the text agree and what a reader copies out of the row
    // is the detail rather than a fragment of it.
    const long = 'The ticket was written beside a hydrant in Yonkers on the night of the last '
      + 'shooting, and the car it was written for belonged to a man the task force had already '
      + 'interviewed twice without ever asking him where he had been.';
    const rows = makeRows();
    rows[0] = { ...rows[0], detail: long };
    renderPreview({ rows });
    const line = options()[0].querySelector('.qprev-row-detail');
    expect(line).toHaveAttribute('title', long);
    expect(line).toHaveTextContent(long);
    expect(Number(declared(['.qprev-row-detail'], '-webkit-line-clamp'))).toBe(2);
  });

  test('a question with no detail gets no empty line where the detail would be', () => {
    // rejects: an always-rendered span. An empty one leaves a blank line, and a
    // set whose questions have details unevenly then reads as ragged rows with
    // nothing on screen saying why. The in-session browser renders the detail
    // the same way, only when there is one (SessionSetupPanel.jsx:759).
    renderPreview();
    const nightStalker = options()[2];
    expect(nightStalker).toHaveTextContent('Who was dubbed the Night Stalker?');
    expect(nightStalker.querySelector('.qprev-row-detail')).toBeNull();
  });

  test('no row carries an answer — the answer appears only in the card, in Reveal', () => {
    renderPreview();
    const list = listbox().textContent;
    for (const option of ['Ted Bundy', 'David Berkowitz', 'John Wayne Gacy', 'Richard Ramirez', 'hydrant']) {
      expect(list).not.toContain(option);
    }
  });

  test('search matches the title', () => {
    renderPreview();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'green river' } });
    expect(options().map((o) => o.textContent)).toEqual([expect.stringContaining('The Green River case')]);
    expect(screen.getByTestId('preview-count')).toHaveTextContent('Showing 1 of 3');
  });

  test('search matches the detail too, and says so', () => {
    renderPreview();
    const box = screen.getByRole('searchbox');
    expect(box).toHaveAttribute('placeholder', 'Search titles and details…');
    fireEvent.change(box, { target: { value: 'dna' } });
    expect(options()).toHaveLength(1);
    expect(options()[0]).toHaveTextContent('The Green River case');
  });

  test('Escape clears a search with text in it and stops there; an empty box lets it through', () => {
    // rejects: the Escape reaching `document`, where a dialog around the
    // editor (components/Modal.jsx) closes on it — and rejects stopping every
    // Escape, which would take the dialog's keyboard exit away.
    const heard = jest.fn();
    document.addEventListener('keydown', heard);
    try {
      renderPreview();
      const box = screen.getByRole('searchbox');
      fireEvent.change(box, { target: { value: 'green river' } });
      fireEvent.keyDown(box, { key: 'Escape' });
      expect(box).toHaveValue('');
      expect(options()).toHaveLength(3);
      expect(heard).not.toHaveBeenCalled();
      fireEvent.keyDown(box, { key: 'Escape' });
      expect(heard).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener('keydown', heard);
    }
  });

  test('category chips narrow the list, and pressing the lit one returns to All', () => {
    renderPreview();
    const chips = within(screen.getByRole('group', { name: 'Category' }));
    fireEvent.click(chips.getByRole('button', { name: 'History' }));
    expect(options()).toHaveLength(2);
    expect(chips.getByRole('button', { name: 'History' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(chips.getByRole('button', { name: 'History' }));
    expect(options()).toHaveLength(3);
    expect(chips.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('no chips when there is only one category — a filter that filters nothing is not offered', () => {
    renderPreview({ rows: makeRows().map((r) => ({ ...r, category: 'History' })) });
    expect(screen.queryByRole('group', { name: 'Category' })).toBeNull();
  });
});

describe('selection', () => {
  test('the first visible question is selected to begin with', () => {
    renderPreview();
    expect(options()[0]).toHaveAttribute('aria-selected', 'true');
    expect(cardTitle()).toBe('Which killer was caught by a parking ticket?');
    expect(screen.getByTestId('preview-position')).toHaveTextContent('1 / 3');
  });

  test('clicking a row shows it in the card', () => {
    renderPreview();
    fireEvent.click(options()[2]);
    expect(options()[2]).toHaveAttribute('aria-selected', 'true');
    expect(cardTitle()).toBe('Who was dubbed the Night Stalker?');
    expect(screen.getByTestId('preview-position')).toHaveTextContent('3 / 3');
  });

  test('↓ and ↑ step through the visible rows and wrap at both ends', () => {
    renderPreview();
    fireEvent.keyDown(listbox(), { key: 'ArrowDown' });
    expect(cardTitle()).toBe('The Green River case');
    fireEvent.keyDown(listbox(), { key: 'ArrowDown' });
    fireEvent.keyDown(listbox(), { key: 'ArrowDown' });
    expect(cardTitle()).toBe('Which killer was caught by a parking ticket?');   // wrapped
    fireEvent.keyDown(listbox(), { key: 'ArrowUp' });
    expect(cardTitle()).toBe('Who was dubbed the Night Stalker?');               // wrapped back
  });

  test('↓ steps through the FILTERED rows, not the whole set', () => {
    renderPreview();
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    fireEvent.keyDown(listbox(), { key: 'ArrowDown' });
    expect(cardTitle()).toBe('Who was dubbed the Night Stalker?');
    // The position counts the visible list too (spec §4.4) — rejects "3 / 3",
    // the whole set's arithmetic.
    expect(screen.getByTestId('preview-position')).toHaveTextContent('2 / 2');
  });

  test('↑ and ↓ belong to the search box while you are typing in it', () => {
    renderPreview();
    fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'ArrowDown' });
    expect(cardTitle()).toBe('Which killer was caught by a parking ticket?');
  });

  test('a handled ↑/↓ never reaches a window listener — the stage pages on those keys', () => {
    // rejects: letting the key bubble. config/stagePaging.js pageIntentFor turns
    // a bare ↓ into a page turn on the projector.
    const heard = jest.fn();
    window.addEventListener('keydown', heard);
    try {
      renderPreview();
      fireEvent.keyDown(listbox(), { key: 'ArrowDown' });
      expect(cardTitle()).toBe('The Green River case');
      expect(heard).not.toHaveBeenCalled();

      // AND WITH NOTHING VISIBLE TO STEP THROUGH. rejects: returning before the
      // key is stopped when the search matches nothing — the key is still the
      // preview's, and it still turned the projector's page.
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz' } });
      expect(screen.queryByRole('listbox')).toBeNull();
      for (const target of [
        screen.getByRole('button', { name: 'Clear search' }),
        screen.getByRole('button', { name: 'All' }),
        screen.getByRole('button', { name: 'Reveal' }),
      ]) {
        fireEvent.keyDown(target, { key: 'ArrowDown' });
        fireEvent.keyDown(target, { key: 'ArrowUp' });
      }
      expect(heard).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', heard);
    }
  });

  test('a selection filtered out moves to the first visible row, and stays there', () => {
    renderPreview();
    fireEvent.click(options()[1]);                                   // Green River (Method)
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    expect(cardTitle()).toBe('Which killer was caught by a parking ticket?');
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    // rejects: snapping back to Green River when the filter clears.
    expect(cardTitle()).toBe('Which killer was caught by a parking ticket?');
  });

  test('an unsaved edit shows the moment the working copy changes', () => {
    const rows = makeRows();
    const { rerender } = render(<QuestionPreview rows={rows} gameType="trivia" setId={SET_ID} />);
    fireEvent.click(options()[1]);
    const edited = rows.map((r, i) => (i === 1 ? { ...r, title: 'The Green River case, reopened', edited: true } : r));
    rerender(<QuestionPreview rows={edited} gameType="trivia" setId={SET_ID} />);
    // Same uid, so the selection holds and the card shows the new words.
    expect(cardTitle()).toBe('The Green River case, reopened');
  });
});

/*
 * "EDIT Q14" FROM THE NEEDS-CHANGES BANNER, IN PREVIEW. The Questions tab
 * resolves the banner's question id to its row and hands the uid in as
 * `selectRequest` (questionsPanelPreview.test.jsx holds the panel to that;
 * setEditorShare.test.jsx drives the banner end to end). Here: what the
 * preview does with it.
 */
describe('a request to show one question', () => {
  let scrollIntoView;
  let original;
  beforeEach(() => {
    scrollIntoView = jest.fn();
    original = window.HTMLElement.prototype.scrollIntoView;
    window.HTMLElement.prototype.scrollIntoView = scrollIntoView;
  });
  afterEach(() => {
    window.HTMLElement.prototype.scrollIntoView = original;
  });

  /** One set of rows for the whole test, so the uids a request names stay put. */
  function renderWithRows(rows = makeRows()) {
    const view = render(<QuestionPreview rows={rows} gameType="trivia" setId={SET_ID} />);
    const ask = (selectRequest, nextRows = rows) => view.rerender(
      <QuestionPreview rows={nextRows} gameType="trivia" setId={SET_ID} selectRequest={selectRequest} />
    );
    return { rows, ask };
  }

  test('it selects the question and scrolls its row into view, the way ↑/↓ do', () => {
    const { rows, ask } = renderWithRows();
    ask({ uid: rows[2].uid });
    expect(options()[2]).toHaveAttribute('aria-selected', 'true');
    expect(cardTitle()).toBe('Who was dubbed the Night Stalker?');
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(options()[2]);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
  });

  test('a search and a chip that hide the question are cleared — else the selection would move straight to the first row', () => {
    const { rows, ask } = renderWithRows();
    fireEvent.click(screen.getByRole('button', { name: 'History' }));     // hides Green River (Method)
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'killer' } });
    expect(options()).toHaveLength(1);
    ask({ uid: rows[1].uid });
    expect(screen.getByRole('searchbox')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    expect(options()).toHaveLength(3);
    expect(options()[1]).toHaveAttribute('aria-selected', 'true');
    expect(cardTitle()).toBe('The Green River case');
    expect(scrollIntoView.mock.contexts[0]).toBe(options()[1]);
  });

  test('a filter that does not hide the question is left as it was', () => {
    const { rows, ask } = renderWithRows();
    fireEvent.click(screen.getByRole('button', { name: 'History' }));     // Which killer, Night Stalker
    ask({ uid: rows[2].uid });
    expect(screen.getByRole('button', { name: 'History' })).toHaveAttribute('aria-pressed', 'true');
    expect(options()).toHaveLength(2);
    expect(options()[1]).toHaveAttribute('aria-selected', 'true');
    expect(cardTitle()).toBe('Who was dubbed the Night Stalker?');
  });

  test('each request is acted on once: the list can move on from it, and a new request brings it back', () => {
    const { rows, ask } = renderWithRows();
    const first = { uid: rows[2].uid };
    ask(first);
    expect(cardTitle()).toBe('Who was dubbed the Night Stalker?');
    fireEvent.click(options()[0]);
    // The same request, with the working copy changed under it (an edit):
    // rejects snapping back to the question every time a row changes.
    const edited = rows.map((r, i) => (i === 0 ? { ...r, title: 'Which killer, reworded?', edited: true } : r));
    ask(first, edited);
    expect(cardTitle()).toBe('Which killer, reworded?');
    // A second click on the banner is a new object.
    ask({ uid: rows[2].uid }, edited);
    expect(cardTitle()).toBe('Who was dubbed the Night Stalker?');
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  test('a request for a question the list does not hold — a removed one — changes nothing here', () => {
    // The Questions tab never sends one (it takes a removed question to the
    // Table, where its Restore is); this holds the preview to not looping on it.
    const rows = makeRows();
    rows[1] = { ...rows[1], removed: true };
    const { ask } = renderWithRows(rows);
    fireEvent.click(options()[1]);                                          // Night Stalker
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'stalker' } });
    ask({ uid: rows[1].uid });
    expect(screen.getByRole('searchbox')).toHaveValue('stalker');
    expect(cardTitle()).toBe('Who was dubbed the Night Stalker?');
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});

describe('the card', () => {
  test('it is the stage\'s card on a Table-ladder dusk screen, inside a dusk preview', () => {
    // The list around it used to be paper and the card the one dusk island in
    // it. The editor moved onto the product's dark ground (the owner: *"we are
    // entirely dark background throughout, except for question set editors and
    // previews"*), so both are dusk now — and the card is dusk for the reason
    // it always was, which is that it IS the stage.
    renderPreview();
    const pane = screen.getByTestId('preview-screen');
    expect(pane).toHaveClass('qprev-screen', 'stage-ladder-table');
    expect(pane).toHaveAttribute('data-theme', 'dark');
    expect(screen.getByTestId('question-preview')).toHaveAttribute('data-theme', 'dark');
    // The ASK DOM: heading, full prompt, options, how-to-answer.
    expect(pane.querySelector('h1.q')).not.toBeNull();
    expect(pane.querySelector('p.qdetail[data-drop="4"]')).toHaveTextContent('New York, 1977.');
    expect(pane.querySelectorAll('.opts .opt')).toHaveLength(4);
  });

  test('no expand affordance — the preview has nothing to expand into', () => {
    renderPreview();
    const h1 = screen.getByTestId('preview-screen').querySelector('h1.q');
    expect(h1.hasAttribute('data-expandable')).toBe(false);
    expect(h1.hasAttribute('title')).toBe(false);
  });

  test('the how-to-answer line is the question\'s own, then the set\'s', () => {
    // rejects: the §3.4 trap, in place — an editor row's own instruction losing
    // to the set's because toRow spells it singular.
    renderPreview();
    const howTo = () => screen.getByTestId('preview-screen').querySelector('p.qdetail[data-drop="3"]').textContent;
    expect(howTo()).toBe('Answer for your table.');
    fireEvent.click(options()[2]);
    expect(howTo()).toBe('Pick the name, not the nickname.');
  });

  test('an unsaved upload shows as the file the room will get', () => {
    const rows = makeRows();
    rows[0] = { ...rows[0], image: 'son-of-sam.jpg' };
    renderPreview({ rows });
    expect(screen.getByTestId('preview-screen').querySelector('img.stage-art'))
      .toHaveAttribute('src', `sets/${SET_ID}/son-of-sam.jpg`);
  });
});

describe('ASK and Reveal', () => {
  const phaseGroup = () => screen.queryByRole('group', { name: 'What the card shows' });

  test('the toggle is offered wherever there is something to reveal: trivia always, any format with a reveal written', () => {
    // CORRECTED 2026-09-19. This test was "only trivia has anything to reveal"
    // — the spec's rule, and wrong: an art set is call-and-answer and keeps the
    // artwork's real title in answerDetails. What it guarded still holds: with
    // nothing behind it, there is no control.
    const noReveal = () => makeRows().map((r) => ({ ...r, answerDetails: '' }));
    const { unmount } = renderPreview({ rows: noReveal() });
    expect(phaseGroup()).not.toBeNull();                        // trivia: the answer itself
    expect(within(phaseGroup()).getByRole('button', { name: 'ASK' })).toHaveAttribute('aria-pressed', 'true');
    unmount();
    for (const gameType of ['call-and-answer', 'poll', 'wavelength']) {
      const bare = renderPreview({ gameType, rows: noReveal() });
      expect(phaseGroup()).toBeNull();                          // nothing to reveal, no control
      bare.unmount();
      const revealing = renderPreview({ gameType });            // makeRows()[0] carries a reveal
      expect(phaseGroup()).not.toBeNull();
      revealing.unmount();
    }
    // A reveal on a question marked for removal is not one: it will not exist once saved.
    const rows = makeRows();
    rows[0] = { ...rows[0], removed: true };
    renderPreview({ gameType: 'call-and-answer', rows });
    expect(phaseGroup()).toBeNull();
  });

  test('an art set reveals the artwork\'s real title: the card as in ASK, and the reveal below it', () => {
    // rejects: gating Reveal on trivia, which left the preview no way to show
    // an art answer — and rejects drawing it ON the card: the stage's RESULTS
    // never shows answerDetails (it reaches players only in the round report).
    const art = (id, fields) => toRow({ id, category: 'Renaissance', school: 'Leonardo da Vinci', ...fields });
    const rows = [
      art('c001#001', { title: 'THE ENIGMATIC SMILE', image: 'smile.jpg',
        answerDetails: 'Real title: Mona Lisa. Stolen from the Louvre in 1911.' }),
      art('c001#002', { title: 'A SWIRLING NIGHT SKY', image: 'night.jpg', answerDetails: 'Real title: The Starry Night.' }),
      art('c001#003', { title: 'AN UNTITLED STUDY', image: 'study.jpg' }),
    ];
    renderPreview({ rows, gameType: 'call-and-answer' });
    const pane = () => screen.getByTestId('preview-screen');
    const asAsked = pane().innerHTML;
    fireEvent.click(within(phaseGroup()).getByRole('button', { name: 'Reveal' }));
    expect(pane().innerHTML).toBe(asAsked);
    expect(pane().querySelector('img.stage-art')).toHaveAttribute('src', `sets/${SET_ID}/smile.jpg`);
    expect(pane().querySelector('p.qdetail[data-drop-note="How to answer"]')).not.toBeNull();
    const note = screen.getByTestId('preview-note');
    expect(note).toHaveTextContent('Reveal — shown only after the round');
    expect(note).toHaveTextContent('Real title: Mona Lisa. Stolen from the Louvre in 1911.');
    expect(pane()).not.toContainElement(note);

    // Decided for the SET, so it holds still while paging: a question with no
    // reveal written keeps the control, shows its card, and shows no note.
    fireEvent.click(options()[2]);
    expect(within(phaseGroup()).getByRole('button', { name: 'Reveal' })).toHaveAttribute('aria-pressed', 'true');
    expect(cardTitle()).toBe('AN UNTITLED STUDY');
    expect(screen.queryByTestId('preview-note')).toBeNull();
    fireEvent.click(options()[1]);
    expect(screen.getByTestId('preview-note')).toHaveTextContent('Real title: The Starry Night.');
  });

  test('Reveal is the RESULTS option treatment, with no bar and no share', () => {
    renderPreview();
    fireEvent.click(within(phaseGroup()).getByRole('button', { name: 'Reveal' }));
    const pane = screen.getByTestId('preview-screen');
    expect([...pane.querySelectorAll('.opt.correct .txt')].map((n) => n.textContent)).toEqual(['David Berkowitz']);
    expect(pane.querySelectorAll('.opt.dim')).toHaveLength(3);
    expect(pane.querySelector('.fill')).toBeNull();
    expect(pane.querySelector('.pct')).toBeNull();
  });

  test('the toggle sticks: every question you move to shows its answer', () => {
    renderPreview();
    fireEvent.click(within(phaseGroup()).getByRole('button', { name: 'Reveal' }));
    fireEvent.keyDown(listbox(), { key: 'ArrowDown' });
    expect(within(phaseGroup()).getByRole('button', { name: 'Reveal' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('preview-screen').querySelector('.opt.correct .txt'))
      .toHaveTextContent('John Wayne Gacy');
  });

  /*
   * THE QUESTION STAYS ABOVE ITS ANSWER. Reveal used to draw the options alone,
   * so a sticky Reveal showed every question you moved to as four answers with
   * nothing saying what was asked. The spec's §1 sketch is drawn in Reveal and
   * has the question above them. The heading alone would not be enough: the
   * trivia generator writes the title as a label and the question as asked into
   * the detail (lambda-functions/admin/ai-generate-trivia.js).
   *
   * Order is DOCUMENT order, which jsdom models; nothing here is geometry.
   */
  const follows = (earlier, later) => Boolean(
    earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING
  );

  test('Reveal keeps the question above its answer: the heading, the picture and the question as asked', () => {
    const rows = makeRows();
    rows[0] = { ...rows[0], image: 'son-of-sam.jpg' };
    renderPreview({ rows });
    fireEvent.click(within(phaseGroup()).getByRole('button', { name: 'Reveal' }));
    const pane = screen.getByTestId('preview-screen');
    const heading = pane.querySelector('h1.q');
    const picture = pane.querySelector('img.stage-art');
    const asked = pane.querySelector('p.qdetail[data-drop-note="Full prompt"]');
    const answer = pane.querySelector('.opt.correct');
    expect(heading).toHaveTextContent('Which killer was caught by a parking ticket?');
    expect(picture).toHaveAttribute('src', `sets/${SET_ID}/son-of-sam.jpg`);
    expect(asked).toHaveTextContent('New York, 1977.');
    expect(answer).toHaveTextContent('David Berkowitz');
    expect(follows(heading, picture)).toBe(true);
    expect(follows(picture, asked)).toBe(true);
    expect(follows(asked, answer)).toBe(true);
    // The how-to-answer line is ASK's: in Reveal the answering is over, and the
    // stage's RESULTS never draws it either.
    expect(pane.querySelector('p.qdetail[data-drop-note="How to answer"]')).toBeNull();
    // Still no expand affordance: the preview has nothing to expand into.
    expect(heading.hasAttribute('data-expandable')).toBe(false);
  });

  test('every question you move to in Reveal arrives with its question above its answer', () => {
    renderPreview();
    fireEvent.click(within(phaseGroup()).getByRole('button', { name: 'Reveal' }));
    const pane = () => screen.getByTestId('preview-screen');

    fireEvent.keyDown(listbox(), { key: 'ArrowDown' });
    expect(cardTitle()).toBe('The Green River case');
    expect(pane().querySelector('p.qdetail[data-drop-note="Full prompt"]')).toHaveTextContent('Solved by DNA in 2001.');
    expect(pane().querySelector('.opt.correct .txt')).toHaveTextContent('John Wayne Gacy');
    expect(follows(pane().querySelector('h1.q'), pane().querySelector('.opt.correct'))).toBe(true);

    // A question with no detail: its heading, then its answer, and no empty line.
    fireEvent.click(options()[2]);
    expect(cardTitle()).toBe('Who was dubbed the Night Stalker?');
    expect(pane().querySelector('p.qdetail')).toBeNull();
    expect(pane().querySelector('.opt.correct .txt')).toHaveTextContent('Richard Ramirez');
    expect(follows(pane().querySelector('h1.q'), pane().querySelector('.opt.correct'))).toBe(true);
  });

  test('the reveal text sits below the screen, marked as not on it — only in Reveal, only when present', () => {
    renderPreview();
    expect(screen.queryByTestId('preview-note')).toBeNull();                 // ASK
    fireEvent.click(within(phaseGroup()).getByRole('button', { name: 'Reveal' }));
    const note = screen.getByTestId('preview-note');
    expect(note).toHaveTextContent('Reveal — shown only after the round');
    expect(note).toHaveTextContent('Stopped for parking beside a hydrant.');
    expect(screen.getByTestId('preview-screen')).not.toContainElement(note);
    fireEvent.keyDown(listbox(), { key: 'ArrowDown' });                      // no answerDetails
    expect(screen.queryByTestId('preview-note')).toBeNull();
  });
});

describe('the three empty states, which are different situations', () => {
  test('a set with no questions says there is nothing to preview', () => {
    renderPreview({ rows: [] });
    expect(screen.getByText(/This set has no questions yet, so there is nothing to preview/)).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  test('a set whose every question is marked for removal says so, and names the way back', () => {
    // rejects: "This set has no questions yet" — false, the set has questions
    // marked for removal, and the way back is Restore or Discard, not adding one.
    renderPreview({ rows: makeRows().map((r) => ({ ...r, removed: true })) });
    const line = screen.getByText(/nothing to preview/);
    expect(line).toHaveTextContent(
      'Every question is marked for removal, so there is nothing to preview. '
      + 'Restore one in the Table, or discard your changes.',
    );
    expect(line).not.toHaveTextContent(/no questions yet/);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  test('nothing matching the search says so, offers the way out, and the screen says nothing is selected', () => {
    renderPreview();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz' } });
    expect(screen.getByText('No questions match “zzz”.')).toBeInTheDocument();
    expect(screen.getByTestId('preview-screen')).toHaveTextContent('Nothing is selected.');
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(options()).toHaveLength(3);
  });
});

describe('Edit', () => {
  test('it hands the Questions tab the whole selected row', () => {
    const rows = makeRows();
    const onEditQuestion = jest.fn();
    render(<QuestionPreview rows={rows} gameType="trivia" setId={SET_ID} onEditQuestion={onEditQuestion} />);
    fireEvent.click(options()[1]);
    fireEvent.click(screen.getByRole('button', { name: /edit this question/i }));
    expect(onEditQuestion).toHaveBeenCalledWith(rows[1]);
  });

  test('without a handler there is no Edit — never a dead control', () => {
    renderPreview();
    expect(screen.queryByRole('button', { name: /edit this question/i })).toBeNull();
  });

  test('held, it is disabled and says why on its own title, and pressing it hands nothing over', () => {
    // The Questions tab holds Edit while a Save is written and read back: the
    // read-back replaces every row, so the row Edit would open is about to go.
    // rejects: an Edit that stays live through that, and one held with no
    // reason — a control that does nothing and does not say why.
    const onEditQuestion = jest.fn();
    render(<QuestionPreview rows={makeRows()} gameType="trivia" setId={SET_ID}
      onEditQuestion={onEditQuestion} editBlocked="Wait for the save to finish." />);
    const edit = screen.getByRole('button', { name: /edit this question/i });
    expect(edit).toBeDisabled();
    expect(edit).toHaveAttribute('title', 'Wait for the save to finish.');
    fireEvent.click(edit);
    expect(onEditQuestion).not.toHaveBeenCalled();
  });
});

describe('the root is never touched', () => {
  test('mounting, using and unmounting the preview leaves document.documentElement exactly as it was', () => {
    // rejects: re-profiling the projector. The live stage keeps its display
    // profile on the root (components/stage/Stage.jsx) — spec §3.1.
    const root = document.documentElement;
    const before = root.className;
    root.className = 'd-room';
    const records = [];
    const observer = new MutationObserver((list) => records.push(...list));
    observer.observe(root, { attributes: true });
    try {
      const { unmount } = renderPreview();
      fireEvent.keyDown(listbox(), { key: 'ArrowDown' });
      fireEvent.click(within(screen.getByRole('group', { name: 'What the card shows' })).getByRole('button', { name: 'Reveal' }));
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'green' } });
      unmount();
      records.push(...observer.takeRecords());
      expect(records).toEqual([]);
      expect(root.className).toBe('d-room');
      expect(root.classList.contains('d-table')).toBe(false);
    } finally {
      observer.disconnect();
      root.className = before;
    }
  });
});

describe('the view switch', () => {
  test('Table and Preview, one pressed', () => {
    const onChange = jest.fn();
    render(<QuestionViewSwitch mode="table" onChange={onChange} />);
    const group = within(screen.getByRole('group', { name: 'How the questions are shown' }));
    expect(group.getByRole('button', { name: 'Table' })).toHaveAttribute('aria-pressed', 'true');
    expect(group.getByRole('button', { name: 'Preview' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(group.getByRole('button', { name: 'Preview' }));
    expect(onChange).toHaveBeenCalledWith('preview');
  });

  test('Preview, blocked, is disabled and says why on its own title', () => {
    render(<QuestionViewSwitch mode="table" onChange={() => {}} previewBlocked="This set has no questions yet, so there is nothing to preview." />);
    const preview = screen.getByRole('button', { name: 'Preview' });
    expect(preview).toBeDisabled();
    expect(preview).toHaveAttribute('title', 'This set has no questions yet, so there is nothing to preview.');
  });
});

/*
 * WHAT THE SHEET DOES TO THE MARKUP. jsdom loads no stylesheet and lays nothing
 * out, so these read QuestionPreview.css as text and hold the rendered markup
 * to what it declares. Green means the markup and the sheet still agree; it
 * cannot show where a browser puts the ellipsis or how it paints the ring.
 */
const SHEET = require('fs')
  .readFileSync(require('path').join(__dirname, '..', 'components', 'QuestionPreview.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

/** Every rule in the sheet, in source order. An @media prelude is dropped; its rules are kept. */
const RULES = [...SHEET.replace(/@media[^{]*\{/g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(([, head, body]) => ({ selectors: head.split(',').map((s) => s.trim()), body }));

/**
 * The value the sheet last gives `prop` in a rule naming one of `selectors`
 * exactly. Every selector that could match here is one class, or one class and
 * a pseudo-class, so source order is the cascade.
 */
function declared(selectors, prop) {
  let value = null;
  for (const rule of RULES) {
    if (!rule.selectors.some((s) => selectors.includes(s))) continue;
    const m = rule.body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`));
    if (m) value = m[1].trim();
  }
  return value;
}

describe('what the sheet does to the markup', () => {
  const classes = (el) => [...el.classList].map((c) => `.${c}`);
  const ancestors = (el) => {
    const out = [];
    for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) out.push(node);
    return out;
  };
  const name = (el) => el.getAttribute('aria-label') || el.textContent.trim();
  /** What a keyboard can land on, in document order. */
  const controls = () => [...document.body.querySelectorAll('button, input, select, textarea, a[href], [tabindex]')]
    .filter((el) => !el.disabled && el.tabIndex >= 0);
  /** Does the sheet clip this element's descendants — outlines included? */
  const clips = (el) => ['overflow', 'overflow-x', 'overflow-y']
    .some((prop) => /^(hidden|clip|auto|scroll)\b/.test(declared(classes(el), prop) || ''));
  /** The ring the sheet draws when `el` has keyboard focus. */
  const ringOf = (el) => {
    const focus = classes(el).map((c) => `${c}:focus-visible`);
    return {
      outline: declared(focus, 'outline'),
      offset: declared(focus, 'outline-offset'),
      shadow: declared(focus, 'box-shadow'),
    };
  };
  const px = (value) => Number((String(value || '').match(/-?[\d.]+(?=px)/) || [0])[0]);
  const hasOutline = ({ outline }) => Boolean(outline) && !/^(none|0)\b/.test(outline);
  const drawsRing = (ring) => hasOutline(ring) || (Boolean(ring.shadow) && ring.shadow !== 'none');
  /** Entirely inside the control's own border edge, where no ancestor's clip can reach it. */
  const drawnInside = (ring) => (hasOutline(ring)
    ? px(ring.offset) + px(ring.outline) <= 0
    : /\binset\b/.test(ring.shadow || ''));

  const renderEverything = () => render(
    <>
      <QuestionViewSwitch mode="preview" onChange={() => {}} />
      <QuestionPreview rows={makeRows()} gameType="trivia" setId={SET_ID} onEditQuestion={() => {}} />
    </>
  );

  test('every control a keyboard can reach draws a focus ring', () => {
    renderEverything();
    const reached = new Set(controls());
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz' } });   // brings "Clear search"
    controls().forEach((el) => reached.add(el));
    // the premise, so this cannot pass by reaching nothing
    expect([...reached].map(name)).toEqual(expect.arrayContaining([
      'Table', 'Preview', 'Search titles and details', 'All', 'Questions', 'ASK', 'Reveal',
      'Edit this question', 'Clear search',
    ]));
    expect([...reached].filter((el) => !drawsRing(ringOf(el))).map(name)).toEqual([]);
  });

  test('a control whose container clips draws its ring inside itself, where the clip cannot cut it', () => {
    // rejects: the outward ring on a segment. The segmented groups clip — so
    // the pressed tint takes their rounded corners — and a segment sits flush
    // on that edge: an outward ring loses its top, bottom and outer end, and
    // survives only as a bar inside the NEIGHBOURING segment, pointing at the
    // wrong control. Seen in Chromium on ASK, Reveal, Table and Preview.
    renderEverything();
    const clipped = controls().filter((el) => ancestors(el).some(clips));
    // the premise: the groups do clip, so this cannot pass by finding nothing
    expect(clipped.map(name)).toEqual(expect.arrayContaining(['Table', 'Preview', 'ASK', 'Reveal']));
    expect(clipped.filter((el) => !drawnInside(ringOf(el))).map(
      (el) => `${name(el)}: outline ${ringOf(el).outline}, offset ${ringOf(el).offset}`,
    )).toEqual([]);
  });

  test('a held Edit does not look like a live one', () => {
    // rejects: holding Edit with nothing on screen to show it. `.qprev-btn`
    // sets its own colour, and an author's colour outranks the browser's
    // greyed text for a disabled button — so with no :disabled rule of its
    // own, the held Edit is drawn exactly as the live one: a control that
    // looks pressable and does nothing. QuestionPreviewPalette.test.js
    // measures the colour it is drawn in.
    const held = declared(['.qprev-btn:disabled'], 'color');
    expect(held).not.toBeNull();
    expect(held).not.toBe(declared(['.qprev-btn'], 'color'));
  });

  test('every line the sheet cuts short carries its whole string on title=', () => {
    // rejects: a reduction with no recovery, which is a deletion (engage-design
    // hard rule 7). The meta line shared the title's cut and not its title=.
    // BOTH WAYS THE SHEET SHORTENS A LINE count: the one-line ellipsis, and the
    // multi-line clamp the row's detail is drawn with — a clamp hides its tail
    // exactly as an ellipsis does, and the first cut of the detail line had no
    // title= at all.
    renderEverything();
    const cutBy = RULES
      .filter((rule) => /text-overflow\s*:\s*ellipsis|-webkit-line-clamp\s*:\s*[1-9]/.test(rule.body))
      .flatMap((rule) => rule.selectors);
    const cut = cutBy.flatMap((selector) => [...document.querySelectorAll(selector)]);
    // the premise: the sheet does cut something the preview renders
    expect(cut.length).toBeGreaterThan(0);
    expect(cut.filter((el) => el.getAttribute('title') !== el.textContent).map((el) => el.textContent)).toEqual([]);
  });
});

/*
 * THE WORKING COPY READ BACK AFTER A SAVE. The Questions tab reads the set back
 * once a Save lands, and every row arrives with a new uid — uids are minted per
 * read (utils/questionRows.js `nextUid`) — so a selection held by uid is lost
 * unless the preview finds the question again. questionsPanelPreview.test.jsx
 * drives the Save; here the read-back is handed straight in, built by the
 * panel's own reader (`editableRows`) from what the importer stored.
 */
describe('the place survives the working copy being read back', () => {
  const wire = (row, id) => ({
    id, Category: row.category, title: row.title, questionDetail: row.detail,
    optionA: row.optionA, optionB: row.optionB, optionC: row.optionC, optionD: row.optionD,
    correctAnswer: row.correctAnswer, difficulty: row.difficulty,
  });
  const position = () => screen.getByTestId('preview-position').textContent;

  test('a question added since the last save is found where the save put it, not at its old place', () => {
    // rejects: finding it by position. It was third in the working copy, and
    // the set comes back in key order, where the save put it second — beside
    // the History question it was written under.
    const [killer, green] = makeRows();
    const added = toRow({
      title: 'Who was dubbed the Night Stalker?', category: 'History', optionA: 'Ted Bundy',
      optionB: 'Richard Ramirez', correctAnswer: 'OptionB', difficulty: 'hard',
    }, { origin: 'new' });
    expect(added.sk).toBe('');
    const { rerender } = render(<QuestionPreview rows={[killer, green, added]} gameType="trivia" setId={SET_ID} />);
    fireEvent.click(options()[2]);
    expect(position()).toBe('3 / 3');

    const back = editableRows({ questions: [wire(killer, 'c001#001'), wire(green, 'c002#001'), wire(added, 'c001#002')] });
    rerender(<QuestionPreview rows={back} gameType="trivia" setId={SET_ID} />);
    expect(cardTitle()).toBe('Who was dubbed the Night Stalker?');
    expect(position()).toBe('2 / 3');
  });

  test('a question the save renumbered is found under its new key, not its old one', () => {
    // rejects: matching the key the question had before the save. Removing
    // the first History question renumbers the rest: the cipher question was
    // c001#003, and once saved c001#003 is the Bundy question.
    const [killer, green, stalker] = makeRows();
    const cipher = trivia('c001#003', { title: 'Whose cipher was solved in 2020?', category: 'History' });
    const bundy = trivia('c001#004', { title: 'Who was Ted Bundy?', category: 'History' });
    const working = [{ ...killer, removed: true }, stalker, cipher, bundy, green];
    const { rerender } = render(<QuestionPreview rows={working} gameType="trivia" setId={SET_ID} />);
    fireEvent.click(options()[1]);
    expect(cardTitle()).toBe('Whose cipher was solved in 2020?');

    const back = editableRows({ questions: [
      wire(stalker, 'c001#001'), wire(cipher, 'c001#002'), wire(bundy, 'c001#003'), wire(green, 'c002#001'),
    ] });
    rerender(<QuestionPreview rows={back} gameType="trivia" setId={SET_ID} />);
    expect(cardTitle()).toBe('Whose cipher was solved in 2020?');
    expect(position()).toBe('2 / 4');
  });

  test('a set read back without the question keeps the place by position, the last place at most', () => {
    // A replace from a CSV, say: nothing of the old working copy is left to
    // find. rejects: jumping to the top when the question is gone.
    const { rerender } = render(<QuestionPreview rows={makeRows()} gameType="trivia" setId={SET_ID} />);
    fireEvent.click(options()[1]);
    const other = (n) => toRow({ id: `c001#00${n}`, title: `Replaced ${n}`, category: 'Other', optionA: 'A', optionB: 'B', correctAnswer: 'OptionA' });
    rerender(<QuestionPreview rows={[other(1), other(2), other(3)]} gameType="trivia" setId={SET_ID} />);
    expect(cardTitle()).toBe('Replaced 2');

    fireEvent.click(options()[2]);
    rerender(<QuestionPreview rows={[other(1), other(2)].map((r) => ({ ...r, uid: `${r.uid}-again` }))} gameType="trivia" setId={SET_ID} />);
    expect(cardTitle()).toBe('Replaced 2');
    expect(position()).toBe('2 / 2');
  });
});

describe('savedKeys — the key the importer will store each row under', () => {
  // lambda-functions/admin/upload-questions.js numbers categories in the order
  // they first appear and questions within their category, over the rows it
  // accepts. tests/question-set-roundtrip.js holds this mirror to the real
  // importer; these are its rules, one at a time.
  const row = (title, category, extra = {}) => toRow({ title, category }, extra);

  test('categories by first appearance, questions counted within their category', () => {
    const rows = [row('a', 'History'), row('b', 'Method'), row('c', 'History')];
    const keys = savedKeys(rows);
    expect(rows.map((r) => keys.get(r.uid))).toEqual(['c001#001', 'c002#001', 'c001#002']);
  });

  test('a category is one category whatever its case or spacing, as the importer folds it', () => {
    const rows = [row('a', 'World Series'), row('b', 'world  series ')];
    const keys = savedKeys(rows);
    expect(rows.map((r) => keys.get(r.uid))).toEqual(['c001#001', 'c001#002']);
  });

  test('a removed row, and one the importer would skip, take no key and shift nothing', () => {
    const rows = [row('a', 'History', { removed: true }), row('', 'History'), row('c', ''), row('d', 'History')];
    const keys = savedKeys(rows);
    expect(rows.map((r) => keys.get(r.uid))).toEqual([undefined, undefined, undefined, 'c001#001']);
  });
});

describe('the list, as data (config/questionPreview.js)', () => {
  test('previewRows: keyed by uid, tombstones dropped, and no answer in any value', () => {
    const rows = makeRows();
    rows[2] = { ...rows[2], removed: true };
    const list = previewRows(rows);
    expect(list.map((r) => r.id)).toEqual([rows[0].uid, rows[1].uid]);
    const values = list.flatMap((r) => Object.values(r));
    for (const answer of ['Ted Bundy', 'David Berkowitz', 'John Wayne Gacy', 'Richard Ramirez', 'OptionB',
      'Stopped for parking beside a hydrant.']) {
      expect(values).not.toContain(answer);
    }
  });

  test('previewRows: a row added this session has an id too', () => {
    // rejects: browserRow on the raw row — a toRow row has no `id`, and its sk
    // is empty until it is saved.
    const added = toRow({ title: 'Brand new', category: 'History' }, { origin: 'new' });
    expect(added.sk).toBe('');
    expect(previewRows([added])[0].id).toBe(added.uid);
  });

  test('previewCategories: the categories in use, in the order they first appear', () => {
    expect(previewCategories(previewRows(makeRows()))).toEqual(['History', 'Method']);
  });

  test('stepSelection: steps, wraps, and starts from the top when lost', () => {
    expect(stepSelection(['a', 'b', 'c'], 'a', 1)).toBe('b');
    expect(stepSelection(['a', 'b', 'c'], 'c', 1)).toBe('a');
    expect(stepSelection(['a', 'b', 'c'], 'a', -1)).toBe('c');
    expect(stepSelection(['a', 'b', 'c'], 'zz', 1)).toBe('a');
    expect(stepSelection([], 'a', 1)).toBeNull();
  });
});

describe('the category is the preview card\'s first line', () => {
  test('the selected question\'s category opens the card, in the stage\'s own kicker', () => {
    renderPreview();
    const tag = screen.getByTestId('preview-category');
    expect(tag).toHaveTextContent('History');
    // The stage's eyebrow class, so this sheet still styles nothing on the screen.
    expect(tag).toHaveClass('kicker');
    // At the TOP of the card: before the question itself.
    const card = tag.closest('.qprev-card');
    expect(card.firstElementChild).toBe(tag);
    // …and inside the dusk screen, not in the paper chrome around it.
    expect(tag.closest('[data-testid="preview-screen"]')).not.toBeNull();
  });

  test('a question with no category gets no line, not a placeholder', () => {
    // rejects: "No category" dressed up as a category on the card.
    renderPreview({ rows: makeRows().map((r) => ({ ...r, category: '' })) });
    expect(screen.queryByTestId('preview-category')).toBeNull();
  });
});
