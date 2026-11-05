/**
 * CHOOSE A QUESTION (docs/design/question-picker, approved 5 Nov 2026 with
 * every fork at its recommendation): one picker, four doors, one way back.
 *
 * Real renders with real assertions for the picker, its doors and the page's
 * open/close contract (useQuestionPicker, the hook the page itself uses).
 * The page's WIRING — that each door's prop reaches the one picker and that
 * its queue actions are the handlers the Session menu already used — is
 * pinned from comment-stripped source at the foot, as queueCallSite.test.jsx
 * does, because a door wired to a no-op renders an identical screen.
 *
 * jsdom has no layout engine: nothing here is geometric. The 1440, 1280 and
 * phone renders are browser checks (the PR's screenshots).
 */
import React, { useState } from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent, within, act, waitFor } from '@testing-library/react';

jest.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value }) => <div data-testid="qr" data-value={value} />,
  QRCodeCanvas: () => null,
}));
jest.mock('../auth/authFetch', () => ({
  ...jest.requireActual('../auth/authFetch'),
  authFetch: jest.fn((...args) => global.fetch(...args)),
}));

/* Imported after the mocks above, which jest hoists. */
import QuestionPicker from '../components/stage/QuestionPicker';
import useQuestionPicker from '../components/stage/useQuestionPicker';
import useQuestionPickerKey, { questionPickerKeyIntent } from '../components/stage/useQuestionPickerKey';
import PrivateChoice from '../components/PrivateChoice';
import PickLine from '../components/stage/PickLine';
import ConsoleRail from '../components/console/ConsoleRail';
import ConsoleFooter from '../components/console/ConsoleFooter';
import Dock from '../components/stage/Dock';
import SessionSetupPanel from '../components/stage/SessionSetupPanel';
import { keyLandedInPanel } from '../components/HostActionBar';
import HostRemote from '../HostRemote';
import CW from '../config/consoleWords';
import {
  PICKER_CHOICE_WORDS, pickerApplies, pickerBackLabel, serveNextKeys, filterPickerRows,
  categoryFacets, toggleCat, undoAskNextOps, previewOptions, queueIndex, CATS_ON,
} from '../config/questionPicker';
import { browserRow } from '../config/setupPanel';

/* ----------------------------------------------------------------- fixtures */

const categories = [{ name: 'Pricing' }, { name: 'Customers' }, { name: 'Product' }];
const categoryCounts = { '1-8': [3, 2, 1], '9-16': [], '17-24': [] };
/* Product switched off for the session. */
const categoryBitmasks = { 'HostMask1-8': '11000000', 'HostMask9-16': '00000000', 'HostMask17-24': '00000000' };

const questions = [
  { id: 'q-1', title: 'Pricing we would change', category: 'Pricing', questionDetail: 'If you could change one thing about how we price, what would it be?' },
  { id: 'q-2', title: 'The customer we under-serve', category: 'Customers' },
  { id: 'q-3', title: 'The discount we regret most', category: 'Pricing' },
  { id: 'q-4', title: 'A feature to cut', category: 'Product' },
  { id: 'q-5', title: 'What our best customers have in common', category: 'Customers' },
];
const TRIVIA = {
  id: 't-1',
  title: 'Which pricing change produced the largest gain?',
  category: 'Pricing',
  difficulty: 'Hard',
  optionA: 'A 5% list increase',
  optionB: 'Seat-based to usage-based billing',
  correctAnswer: 'OptionB',
  answerDetails: 'Because usage tracks value.',
};

const upNext = [
  { source: 'queued', questionId: 'QUESTION#q-2', title: 'The customer we under-serve', round: 4 },
  { source: 'auto', questionId: 'QUESTION#q-5', title: 'What our best customers have in common', round: 5 },
  { source: 'own', questionId: 'own:a1', title: 'My own', round: 6 },
  { source: 'auto', questionId: 'QUESTION#q-3', title: 'The discount we regret most', round: 7 },
  { source: 'auto', questionId: 'QUESTION#q-1', title: 'Pricing we would change', round: 8 },
];

/* A picker whose view lives in the harness, as it lives on the page. */
function Picker({ initialView = undefined, ...props }) {
  const [view, setView] = useState(initialView || { search: '', cats: [], show: 'unasked' });
  return (
    <QuestionPicker
      questions={questions}
      categories={categories}
      categoryCounts={categoryCounts}
      categoryBitmasks={categoryBitmasks}
      view={view}
      onViewChange={setView}
      backLabel="Round 3 · Answer"
      {...props}
    />
  );
}
const rows = () => screen.getAllByTestId('browser-row');
const titles = () => rows().map((r) => r.querySelector('.qpk-row-t').textContent);
const rowOf = (text) => rows().find((r) => r.textContent.includes(text));

/* ------------------------------------------------------------ the decisions */

describe('the decisions, without a DOM', () => {
  test('F7: Call & Answer, Trivia and Poll get it; survey, Wavelength and the Build Room do not; never once ended', () => {
    expect(pickerApplies('call-and-answer', 'ASK#003')).toBe(true);
    expect(pickerApplies('trivia', 'RESULTS#002')).toBe(true);
    expect(pickerApplies('poll', 'STARTED')).toBe(true);
    expect(pickerApplies('survey', 'STARTED')).toBe(false);
    expect(pickerApplies('wavelength', 'STARTED')).toBe(false);
    expect(pickerApplies('build', 'STARTED')).toBe(false);
    expect(pickerApplies('call-and-answer', 'ENDED')).toBe(false);
  });

  test('D6: the crumb names where it goes', () => {
    expect(pickerBackLabel({ from: 'menu', round: 3, step: 'Answer' })).toBe('Session menu');
    expect(pickerBackLabel({ from: 'key', round: 3, step: 'Answer' })).toBe('Round 3 · Answer');
    expect(pickerBackLabel({ from: 'part', round: 0, step: 'Lobby' })).toBe('Lobby');
  });

  test('F3: the set would serve next is the next three set questions, never your own or the round on screen', () => {
    expect(serveNextKeys(upNext)).toEqual(['q-2', 'q-5', 'q-3']);
    expect(serveNextKeys(upNext, { currentQuestionId: 'q-2' })).toEqual(['q-5', 'q-3', 'q-1']);
  });

  test('F4: categories filter the list and compose with search and Show', () => {
    const r = questions.map((q) => browserRow(q, { usedIds: ['q-3'], activeCategories: new Set(['Pricing', 'Customers']) }));
    const ids = (list) => list.map((x) => x.id);
    expect(ids(filterPickerRows(r, { cats: ['Pricing'], show: 'all' }))).toEqual(['q-1', 'q-3']);
    expect(ids(filterPickerRows(r, { cats: ['Pricing'], show: 'unasked' }))).toEqual(['q-1']);
    expect(ids(filterPickerRows(r, { cats: [CATS_ON], show: 'all' }))).toEqual(['q-1', 'q-2', 'q-3', 'q-5']);
    // the search reads the question's text too (matchDetail, D5)
    expect(ids(filterPickerRows(r, { search: 'how we price', show: 'all' }))).toEqual(['q-1']);
    expect(toggleCat({ cats: ['Pricing'] }, '')).toEqual({ cats: [] });
    expect(categoryFacets(r, { show: 'unasked' }).find((f) => f.name === 'Product')).toEqual({ name: 'Product', count: 1, off: true });
  });

  test('D7: Undo is the queue route\'s own ops — remove a new entry, or `later` once per place it moved', () => {
    expect(undoAskNextOps(-1)).toEqual(['remove']);
    expect(undoAskNextOps(0)).toEqual([]);
    expect(undoAskNextOps(3)).toEqual(['later', 'later', 'later']);
    expect(queueIndex(['q-2', 'QUESTION#q-1'], 'q-1')).toBe(1);
  });

  test('F7: the preview may show the options, never which is right', () => {
    expect(previewOptions(TRIVIA)).toEqual(['A 5% list increase', 'Seat-based to usage-based billing']);
    expect(previewOptions({ options: ['Monday', 'Friday'] })).toEqual(['Monday', 'Friday']);
    expect(JSON.stringify(previewOptions(TRIVIA))).not.toMatch(/OptionB|Because/);
  });
});

/* ------------------------------------------------------------- the picker */

describe('the picker', () => {
  test('it is a region named by its heading, not a dialog, and focus lands on the heading (review A1)', () => {
    render(<Picker />);
    const region = screen.getByRole('region', { name: /choose a question/i });
    expect(region).toHaveClass('qpk');
    expect(region).toHaveAttribute('data-theme', 'dark');
    expect(region.getAttribute('aria-modal')).toBeNull();
    expect(document.activeElement).toBe(within(region).getByRole('heading', { level: 2 }));
  });

  test('"The set would serve next" heads the list, with its rule in the title (F3, R6)', () => {
    render(<Picker upNext={upNext} questionQueue={['q-2']} />);
    const serve = screen.getByTestId('picker-serve-next');
    expect(within(serve).getByRole('heading')).toHaveAttribute('title', expect.stringMatching(/categories that are on/));
    expect(within(serve).getAllByTestId('browser-row').map((r) => r.dataset.key)).toEqual(['q-2', 'q-5', 'q-3']);
    // the queued head says Next and offers Unqueue
    expect(within(within(serve).getAllByTestId('browser-row')[0]).getByTestId('browser-queued-tag')).toHaveTextContent('Next');
    // the rest follow, without repeating those three
    const rest = screen.getByTestId('picker-rest');
    expect(within(rest).getAllByTestId('browser-row').map((r) => r.dataset.key)).toEqual(['q-1', 'q-4']);
    expect(rest).toHaveTextContent(/2 more/);
  });

  test('search matches the question text, and the count says the list is filtered', () => {
    render(<Picker />);
    fireEvent.change(screen.getByTestId('picker-search'), { target: { value: 'how we price' } });
    expect(titles()).toEqual(['Pricing we would change']);
    expect(screen.getByTestId('browser-count')).toHaveTextContent('Showing 1 of 5');
  });

  test('category boxes filter the list and never switch a category for the session (F4)', () => {
    const onToggleCategory = jest.fn();
    const onViewChange = jest.fn();
    // a picker given a toggle it must never call, and a spy on the view
    const { rerender } = render(<QuestionPicker questions={questions} categories={categories} categoryCounts={categoryCounts} categoryBitmasks={categoryBitmasks} view={{ search: '', cats: [], show: 'all' }} onViewChange={onViewChange} onToggleCategory={onToggleCategory} />);
    const pricing = screen.getByRole('checkbox', { name: 'Pricing, 2' });
    fireEvent.click(pricing);
    expect(onViewChange).toHaveBeenCalledWith(expect.objectContaining({ cats: ['Pricing'] }));
    expect(onToggleCategory).not.toHaveBeenCalled();
    rerender(<QuestionPicker questions={questions} categories={categories} categoryCounts={categoryCounts} categoryBitmasks={categoryBitmasks} view={{ search: '', cats: ['Pricing'], show: 'all' }} onViewChange={onViewChange} />);
    expect(titles()).toEqual(['Pricing we would change', 'The discount we regret most']);
    // a switched-off category is listed and says so in words (A4)
    expect(screen.getByRole('checkbox', { name: 'Product, off for this session, 1' })).toBeInTheDocument();
  });

  test('the category note links to the session switch instead of being one', () => {
    const onOpenCategories = jest.fn();
    render(<Picker onOpenCategories={onOpenCategories} />);
    fireEvent.click(screen.getByTestId('picker-open-categories'));
    expect(onOpenCategories).toHaveBeenCalledTimes(1);
  });

  test('"Nothing matches" is not "nothing exists": two empty states, two exits (hard rule 6)', () => {
    const { unmount } = render(<Picker questions={[]} />);
    expect(screen.getByText('No questions are available for this set.')).toBeInTheDocument();
    unmount();
    render(<Picker />);
    fireEvent.change(screen.getByTestId('picker-search'), { target: { value: 'zzz' } });
    const empty = screen.getByTestId('picker-empty-filter');
    fireEvent.click(within(empty).getByRole('button', { name: 'Clear the filters' }));
    expect(rows()).toHaveLength(5);
  });

  test('Not asked is the default; All brings asked questions back, tagged and held', () => {
    render(<Picker usedQuestionIds={['QUESTION#q-3']} />);
    expect(rows().map((r) => r.dataset.key)).not.toContain('q-3');
    fireEvent.click(screen.getByTestId('picker-show-all'));
    const asked = rowOf('The discount');
    expect(asked).toHaveClass('is-used');
    expect(within(asked).getByText('Asked')).toBeInTheDocument();
    expect(within(asked).getByRole('button', { name: /^Ask next:/ })).toBeDisabled();
  });

  test('no correct answer and no explanation reach any row or the preview', () => {
    const { container } = render(<Picker questions={[TRIVIA, ...questions]} gameType="trivia" />);
    // trivia rows show difficulty (F7)
    expect(rowOf('largest gain')).toHaveTextContent(/Hard/);
    // the preview shows the options, unmarked
    expect(screen.getByTestId('picker-preview-options')).toHaveTextContent('Seat-based to usage-based billing');
    expect(container.textContent).not.toMatch(/Because usage tracks value|Correct:|OptionB/);
    expect(container.querySelector('.correct, .is-right, [data-correct]')).toBeNull();
    // rows carry no option text at all
    for (const r of rows()) expect(r.textContent).not.toMatch(/5% list increase/);
  });

  test('a Poll\'s choice options preview the same way', () => {
    render(<Picker questions={[{ id: 'p-1', title: 'Best day to meet?', category: 'Pricing', options: ['Monday', 'Friday'] }]} gameType="poll" />);
    expect(screen.getByTestId('picker-preview-options')).toHaveTextContent('MondayFriday');
  });

  test('a planned rail row opens it on that row (D4)', () => {
    render(<Picker focusKey="q-5" />);
    expect(screen.getByTestId('picker-preview')).toHaveTextContent('What our best customers have in common');
    expect(rowOf('best customers')).toHaveAttribute('aria-current', 'true');
  });

  test('↑/↓ move a roving selection, the preview follows, and Enter asks next', () => {
    const onAskNext = jest.fn();
    render(<Picker onAskNext={onAskNext} />);
    const first = rows()[0];
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    const second = rows()[1];
    expect(document.activeElement).toBe(second);
    expect(second).toHaveAttribute('tabindex', '0');
    expect(first).toHaveAttribute('tabindex', '-1');
    expect(screen.getByTestId('picker-preview')).toHaveTextContent(second.querySelector('.qpk-row-t').textContent);
    fireEvent.keyDown(second, { key: 'Enter' });
    expect(onAskNext).toHaveBeenCalledWith(second.dataset.key, expect.anything());
  });

  test('/ focuses the search; inside it Esc clears the text first, then goes back', () => {
    const onClose = jest.fn();
    render(<Picker onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole('heading', { level: 2 }), { key: '/' });
    const search = screen.getByTestId('picker-search');
    expect(document.activeElement).toBe(search);
    fireEvent.change(search, { target: { value: 'pricing' } });
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(search).toHaveValue('');
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('Queue keeps it open; Ask next is the one that hands back', () => {
    const onQueue = jest.fn();
    const onClose = jest.fn();
    const onAskNext = jest.fn();
    render(<Picker onQueue={onQueue} onClose={onClose} onAskNext={onAskNext} />);
    fireEvent.click(within(rowOf('The discount')).getByRole('button', { name: /^Queue:/ }));
    expect(onQueue).toHaveBeenCalledWith(questions[2]);
    expect(onClose).not.toHaveBeenCalled();
    expect(onAskNext).not.toHaveBeenCalled();
    expect(screen.getByTestId('question-picker')).toBeInTheDocument();
  });

  test('after several Queues, Done\'s side says how many, with Undo (D7)', () => {
    const onUndoQueued = jest.fn();
    render(<Picker queuedHere={3} onUndoQueued={onUndoQueued} />);
    expect(screen.getByTestId('picker-queued-here')).toHaveTextContent('3 queued');
    fireEvent.click(screen.getByTestId('picker-queued-undo'));
    expect(onUndoQueued).toHaveBeenCalledTimes(1);
  });

  test('the crumb, Done and Esc each close in one press', () => {
    const onClose = jest.fn();
    render(<Picker onClose={onClose} />);
    expect(screen.getByTestId('picker-back')).toHaveAccessibleName('Back to Round 3 · Answer');
    fireEvent.click(screen.getByTestId('picker-back'));
    fireEvent.click(screen.getByTestId('picker-done'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  test('Esc under a dialog is the dialog\'s, not the picker\'s', () => {
    const onClose = jest.fn();
    render(
      <>
        <Picker onClose={onClose} />
        <div role="dialog" aria-modal="true">confirm</div>
      </>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  test('the search survives close and reopen within the session (D8)', () => {
    function Page() {
      const [view, setView] = useState({ search: '', cats: [], show: 'unasked' });
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>reopen</button>
          {open ? <QuestionPicker questions={questions} view={view} onViewChange={setView} onClose={() => setOpen(false)} /> : null}
        </>
      );
    }
    render(<Page />);
    fireEvent.change(screen.getByTestId('picker-search'), { target: { value: 'customer' } });
    fireEvent.click(screen.getByTestId('picker-done'));
    expect(screen.queryByTestId('question-picker')).toBeNull();
    fireEvent.click(screen.getByText('reopen'));
    expect(screen.getByTestId('picker-search')).toHaveValue('customer');
    expect(titles()).toEqual(['The customer we under-serve', 'What our best customers have in common']);
  });

  test('Space on a picker control is that control\'s; on its heading or a row it still advances (note 3)', () => {
    render(<Picker />);
    expect(keyLandedInPanel(screen.getByTestId('picker-done'))).toBe(true);
    expect(keyLandedInPanel(screen.getByRole('heading', { level: 2 }))).toBe(false);
    expect(keyLandedInPanel(rows()[0])).toBe(false);
  });
});

/* ----------------------------------------------- the way back, on the page */

/*
  The page's contract through the same hook the page uses: a real opener,
  the real picker, and the real one-screen choice.
*/
function Page({ twoSurfaces = true, withMenu = false }) {
  const [menu, setMenu] = useState(withMenu);
  const p = useQuestionPicker({
    twoSurfaces,
    menuOpen: menu,
    onMenuClose: () => setMenu(false),
    onMenuReturn: () => setMenu(true),
  });
  return (
    <>
      <details className="hc-sec" data-section="queue" open><summary>Round queue</summary></details>
      <button type="button" data-testid="opener" onClick={() => p.open({ from: 'rail' })}>Choose a question</button>
      {menu ? (
        <aside className="setup-panel">
          <button type="button" data-testid="up-next-choose" onClick={() => p.open({ from: 'menu' })}>Choose a question</button>
        </aside>
      ) : null}
      {p.choiceOpen ? (
        <PrivateChoice
          words={PICKER_CHOICE_WORDS}
          testIdPrefix="picker-choice"
          onConnectPhone={() => p.setChoiceOpen(false)}
          onHere={p.showHere}
          onClose={() => p.setChoiceOpen(false)}
        />
      ) : null}
      {p.picker ? (
        <QuestionPicker
          questions={questions}
          backLabel={p.picker.from === 'menu' ? 'Session menu' : 'Round 3 · Answer'}
          oneScreen={p.picker.oneScreen}
          onHide={p.picker.oneScreen ? p.hide : null}
          onClose={() => p.close()}
          onAskNext={() => p.close()}
        />
      ) : null}
    </>
  );
}

describe('the way back', () => {
  test.each([
    ['Esc', () => fireEvent.keyDown(document, { key: 'Escape' })],
    ['Done', () => fireEvent.click(screen.getByTestId('picker-done'))],
    ['the crumb', () => fireEvent.click(screen.getByTestId('picker-back'))],
    ['Ask next', () => fireEvent.click(screen.getAllByTestId('picker-ask-next')[0])],
  ])('%s closes it in one press, and focus returns to the opener', (_, press) => {
    render(<Page />);
    const opener = screen.getByTestId('opener');
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByTestId('question-picker')).toBeInTheDocument();
    press();
    expect(screen.queryByTestId('question-picker')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  test('when the opener has gone (or was the body), focus goes to the Round queue\'s heading, never to body (A5)', () => {
    render(<Page />);
    // the C key: nothing focused
    act(() => { document.activeElement.blur(); });
    fireEvent.click(screen.getByTestId('opener'));
    // a click does not move jsdom's focus; the opener recorded is the body
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.activeElement).toBe(document.querySelector('.hc-sec[data-section="queue"] summary'));
  });

  test('from the Session menu: the menu closes first, and the way back reopens it on its door', () => {
    render(<Page withMenu />);
    fireEvent.click(screen.getByTestId('up-next-choose'));
    expect(document.querySelector('.setup-panel')).toBeNull();
    expect(screen.getByTestId('picker-back')).toHaveTextContent('Session menu');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.querySelector('.setup-panel')).not.toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('up-next-choose'));
  });
});

/* -------------------------------------------------------------- one screen */

describe('one screen asks first (D9, F5)', () => {
  test('a door opens the private choice, phone first and focused, and no question is drawn', () => {
    render(<Page twoSurfaces={false} />);
    fireEvent.click(screen.getByTestId('opener'));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('The room can see this screen.');
    const phone = screen.getByTestId('picker-choice-phone');
    expect(document.activeElement).toBe(phone);
    // the phone option comes before Show them here
    // eslint-disable-next-line no-bitwise
    expect(phone.compareDocumentPosition(screen.getByTestId('picker-choice-here')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryAllByTestId('browser-row')).toHaveLength(0);
    for (const q of questions) expect(document.body.textContent).not.toContain(q.title);
  });

  test('Show them here draws it with the room line; Hide goes back to the choice', () => {
    render(<Page twoSurfaces={false} />);
    fireEvent.click(screen.getByTestId('opener'));
    fireEvent.click(screen.getByTestId('picker-choice-here'));
    expect(screen.getByTestId('picker-room-line')).toHaveTextContent('The room can see this list.');
    expect(screen.getByTestId('picker-preview')).toHaveTextContent(/the room can see this/i);
    fireEvent.click(screen.getByTestId('picker-hide'));
    expect(screen.queryAllByTestId('browser-row')).toHaveLength(0);
    expect(screen.getByTestId('picker-choice-phone')).toBeInTheDocument();
  });

  test('it asks every time: nothing is remembered', () => {
    render(<Page twoSurfaces={false} />);
    fireEvent.click(screen.getByTestId('opener'));
    fireEvent.click(screen.getByTestId('picker-choice-here'));
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByTestId('opener'));
    expect(screen.getByTestId('picker-choice-phone')).toBeInTheDocument();
    expect(screen.queryAllByTestId('browser-row')).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ the C key */

describe('the C key (D2, F6) has Q\'s guards', () => {
  const ev = (over = {}) => ({ key: 'c', target: document.body, ...over });
  test('c and C choose', () => {
    expect(questionPickerKeyIntent(ev())).toBe('choose');
    expect(questionPickerKeyIntent(ev({ key: 'C' }))).toBe('choose');
  });
  test('never while typing, with a modifier, on a repeat, or for a press already taken', () => {
    const input = document.createElement('input');
    const area = document.createElement('textarea');
    expect(questionPickerKeyIntent(ev({ target: input }))).toBeNull();
    expect(questionPickerKeyIntent(ev({ target: area }))).toBeNull();
    expect(questionPickerKeyIntent(ev({ metaKey: true }))).toBeNull();
    expect(questionPickerKeyIntent(ev({ ctrlKey: true }))).toBeNull();
    expect(questionPickerKeyIntent(ev({ altKey: true }))).toBeNull();
    expect(questionPickerKeyIntent(ev({ repeat: true }))).toBeNull();
    expect(questionPickerKeyIntent(ev({ defaultPrevented: true }))).toBeNull();
    expect(questionPickerKeyIntent(ev({ key: 'q' }))).toBeNull();
  });
  test('the hook fires on document only while enabled (never under a dialog: the page\'s `enabled`)', () => {
    const onChoose = jest.fn();
    function K({ enabled }) { useQuestionPickerKey({ enabled, onChoose }); return <input aria-label="typing" />; }
    const { rerender } = render(<K enabled={false} />);
    fireEvent.keyDown(document, { key: 'c' });
    expect(onChoose).not.toHaveBeenCalled();
    rerender(<K enabled />);
    fireEvent.keyDown(document, { key: 'c' });
    expect(onChoose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByLabelText('typing'), { key: 'c' });
    expect(onChoose).toHaveBeenCalledTimes(1);
  });
});

/* ---------------------------------------------------------------- the doors */

describe('every door opens the picker', () => {
  const railProps = {
    moment: 'ANSWERING',
    rounds: [
      { n: 2, title: 'Where do we lose deals?', state: 'done' },
      { n: 3, title: 'What would you stop doing?', state: 'now' },
      { n: 4, title: 'The customer we under-serve', state: 'next', key: 'q-2' },
      { n: 5, title: 'My own', state: 'later', key: 'own:a1', own: true },
    ],
    people: [],
    late: [],
  };

  test('the rail\'s Round queue: Choose a question, with its key', () => {
    const onChoose = jest.fn();
    render(<ConsoleRail {...railProps} onChoose={onChoose} />);
    const door = screen.getByTestId('rail-choose');
    expect(door).toHaveTextContent('Choose a question');
    expect(door).toHaveTextContent('C');
    fireEvent.click(door);
    expect(onChoose).toHaveBeenCalledWith({});
  });

  test('a planned rail row is a door to its own question; played rows and your own are not (D4)', () => {
    const onChoose = jest.fn();
    render(<ConsoleRail {...railProps} onChoose={onChoose} />);
    const planned = screen.getAllByTestId('rail-planned-row');
    expect(planned).toHaveLength(1);
    fireEvent.click(planned[0]);
    expect(onChoose).toHaveBeenCalledWith({ focusKey: 'q-2' });
  });

  test('no handler, no door', () => {
    render(<ConsoleRail {...railProps} />);
    expect(screen.queryByTestId('rail-choose')).toBeNull();
    expect(screen.queryByTestId('rail-planned-row')).toBeNull();
  });

  test('the rail\'s link is "All rounds" and opens Up next', () => {
    const onOpenSection = jest.fn();
    render(<ConsoleRail {...railProps} onOpenSection={onOpenSection} />);
    expect(CW.allRounds).toBe('All rounds');
    expect(screen.queryByText('Rounds and questions')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'All rounds' }));
    expect(onOpenSection).toHaveBeenCalledWith('up-next');
  });

  test('Your part now on the console: Change what\'s next', () => {
    const onChangeNext = jest.fn();
    render(<ConsoleFooter status={{ text: '' }} part={{ before: 'The room is answering.' }} onChangeNext={onChangeNext} />);
    fireEvent.click(screen.getByTestId('change-next'));
    expect(onChangeNext).toHaveBeenCalledTimes(1);
  });

  test('Your part now on one screen (the Dock): Change what\'s next', () => {
    const onChangeNext = jest.fn();
    render(<Dock lead="Your part now" status="The room is answering." onChangeNext={onChangeNext} />);
    fireEvent.click(screen.getByTestId('change-next'));
    expect(onChangeNext).toHaveBeenCalledTimes(1);
  });

  test('Session menu › Up next links to the same picker instead of keeping its own copy', () => {
    const onChoose = jest.fn();
    render(<SessionSetupPanel questions={questions} gameState="ASK#003" onChoose={onChoose} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Up next' }));
    const door = screen.getByTestId('up-next-choose');
    expect(door).toHaveTextContent('Choose a question');
    expect(screen.queryAllByTestId('browser-row')).toHaveLength(0);
    fireEvent.click(door);
    expect(onChoose).toHaveBeenCalledTimes(1);
  });
});

/* -------------------------------------------------------- Ask next and Undo */

describe('after Ask next: Next: … · Undo (D7)', () => {
  test('the line says what is next, and Undo is a real button', () => {
    const onUndo = jest.fn();
    const { rerender } = render(<PickLine notice={{ title: 'Pricing we would change', onUndo }} onChangeNext={() => {}} />);
    const line = screen.getByTestId('pick-notice');
    expect(line).toHaveAttribute('role', 'status');
    expect(line).toHaveTextContent('Next: Pricing we would change');
    // the notice replaces the quiet door while it stands
    expect(screen.queryByTestId('change-next')).toBeNull();
    fireEvent.click(screen.getByTestId('pick-undo'));
    expect(onUndo).toHaveBeenCalledTimes(1);
    // after Undo it says so, and offers nothing to press twice (A8)
    rerender(<PickLine notice={{ title: 'Pricing we would change', undone: true, onUndo }} />);
    expect(screen.getByTestId('pick-notice')).toHaveTextContent('Put back');
    expect(screen.queryByTestId('pick-undo')).toBeNull();
  });

  test('the console card and the Dock both carry it', () => {
    const notice = { title: 'Pricing we would change', onUndo: () => {} };
    const { unmount } = render(<ConsoleFooter status={{ text: '' }} pickNotice={notice} />);
    expect(screen.getByTestId('pick-notice')).toHaveTextContent('Next: Pricing we would change');
    unmount();
    render(<Dock lead="Your part now" status="x" pickNotice={notice} />);
    expect(screen.getByTestId('pick-notice')).toHaveTextContent('Next: Pricing we would change');
  });
});

/* ---------------------------------------------------------------- the phone */

const PHONE_Q = { id: '004', title: 'Pricing we would change', category: 'Pricing', questionDetail: 'How we price.' };
const PHONE_Q2 = { id: '005', title: 'The discount we regret most', category: 'Discounts' };
function servePhone({ queue = [], asked = [] } = {}) {
  const posts = [];
  global.fetch = jest.fn((url, init) => {
    const href = String(url);
    if (init?.method === 'POST') {
      if (href.includes('/get-results')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ voteTallies: {} }) });
      posts.push({ url: href, body: JSON.parse(init.body || '{}') });
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    }
    if (href.includes('/host-details')) return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    if (href.includes('/host-state')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          gameId: '4821',
          state: 'ASK#003',
          currentQuestion: 3,
          gameType: 'call-and-answer',
          gameMetadata: { title: 'Offsite', gameType: 'call-and-answer', questionSetId: 'pricing' },
          questionQueue: { queue, version: 1 },
        }),
      });
    }
    if (href.includes('/players')) return Promise.resolve({ ok: true, json: async () => ({ players: [], stats: { totalPlayers: 0 } }) });
    if (href.includes('/up-next')) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ upNext: [{ source: 'auto', questionId: 'QUESTION#005', title: PHONE_Q2.title, round: 4 }], blocked: [], advisories: [], excluded: [], asked }),
      });
    }
    if (href.includes('/categories')) return Promise.resolve({ ok: true, json: async () => ({ categories: [] }) });
    if (href.includes('/questions')) return Promise.resolve({ ok: true, json: async () => ({ questions: [PHONE_Q, PHONE_Q2], setName: 'Pricing' }) });
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
  });
  return posts;
}
async function connect() {
  render(<HostRemote />);
  fireEvent.change(screen.getByLabelText(/session code/i), { target: { value: '4821' } });
  fireEvent.click(screen.getByRole('button', { name: /connect/i }));
  const status = screen.getByText(/^(Live|Offline)$/);
  await waitFor(() => expect(status).toHaveTextContent(/^Live$/));
}

describe('the phone Remote gets the same picker (D10)', () => {
  beforeEach(() => { window.API_BASE = 'https://api.test/'; });

  test('the round view says what is next, and Change opens the picker sheet with ‹ Round', async () => {
    servePhone();
    await connect();
    const line = await screen.findByTestId('remote-next-line');
    expect(line).toHaveTextContent(`Next: ${PHONE_Q2.title}`);
    fireEvent.click(within(line).getByTestId('remote-next-change'));
    expect(await screen.findByTestId('remote-choose-sheet')).toBeInTheDocument();
    const back = screen.getByTestId('remote-choose-back');
    expect(back).toHaveTextContent('Round');
    expect(back).toHaveAccessibleName('Back to the round');
    fireEvent.click(back);
    expect(screen.queryByTestId('remote-choose-sheet')).toBeNull();
    expect(screen.getByTestId('remote-next-line')).toBeInTheDocument();
  });

  test('from Up next, the way back reads ‹ Up next and returns to the tab', async () => {
    servePhone();
    await connect();
    fireEvent.click(await screen.findByRole('button', { name: /^up next$/i }));
    fireEvent.click(await screen.findByTestId('remote-choose'));
    const back = screen.getByTestId('remote-choose-back');
    expect(back).toHaveTextContent('Up next');
    fireEvent.click(back);
    expect(screen.getByRole('tab', { name: /^up next$/i, selected: true })).toBeInTheDocument();
  });

  test('Show and Category filter the list; the search reads the question text', async () => {
    servePhone({ asked: ['QUESTION#005'] });
    await connect();
    fireEvent.click(await screen.findByTestId('remote-next-change'));
    await screen.findByText(PHONE_Q.title);
    // Not asked by default: the asked one is out
    expect(screen.queryByText(PHONE_Q2.title)).toBeNull();
    fireEvent.change(screen.getByTestId('hrq-show'), { target: { value: 'all' } });
    expect(screen.getByText(PHONE_Q2.title)).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('hrq-category'), { target: { value: 'Discounts' } });
    expect(screen.queryByText(PHONE_Q.title)).toBeNull();
    expect(screen.getByTestId('hrq-filtered')).toHaveTextContent('1 in Discounts');
    fireEvent.click(within(screen.getByTestId('hrq-filtered')).getByRole('button', { name: 'Clear' }));
    fireEvent.change(screen.getByLabelText('Search questions'), { target: { value: 'how we price' } });
    expect(screen.getByText(PHONE_Q.title)).toBeInTheDocument();
    expect(screen.queryByText(PHONE_Q2.title)).toBeNull();
  });

  test('Ask next returns to the round with Next: … · Undo, and Undo takes it back out', async () => {
    const posts = servePhone();
    await connect();
    fireEvent.click(await screen.findByTestId('remote-next-change'));
    await screen.findByText(PHONE_Q.title);
    fireEvent.click(screen.getByRole('button', { name: `Ask next “${PHONE_Q.title}”` }));
    const notice = await screen.findByTestId('remote-pick-notice');
    expect(notice).toHaveTextContent(`Next: ${PHONE_Q.title}`);
    expect(screen.queryByTestId('remote-choose-sheet')).toBeNull();
    expect(posts[0]).toMatchObject({ url: 'https://api.test/games/4821/queue', body: expect.objectContaining({ op: 'first', questionKey: '004' }) });
    fireEvent.click(screen.getByTestId('remote-pick-undo'));
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1].body).toMatchObject({ op: 'remove', questionKey: '004' });
    expect(await screen.findByTestId('remote-pick-notice')).toHaveTextContent('Put back');
  });
});

/* ------------------------------------------------------------------ the page */

function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/([^:'"`\\])\/\/.*$/gm, '$1');
}
const host = stripComments(fs.readFileSync(path.join(__dirname, '..', 'GameHostPage.jsx'), 'utf8'));

describe('the page wires every door to the one picker', () => {
  test('one QuestionPicker element, rendered in one of two places', () => {
    expect(host.match(/<QuestionPicker\b/g)).toHaveLength(1);
    expect(host).toMatch(/createPortal\(pickerEl, consoleSheetHost\)/);
    expect(host).toMatch(/view=\{pickerEl && !consoleOn \? pickerEl : viewStep/);
  });

  test('the four doors all call openPicker', () => {
    expect(host).toMatch(/onChoose: pickerOn \? \(\{ focusKey = null \} = \{\}\) => openPicker\(\{ from: focusKey \? 'row' : 'rail', focusKey \}\)/);
    expect(host).toMatch(/onChoose=\{pickerOn \? \(\) => openPicker\(\{ from: 'menu' \}\) : null\}/);
    expect(host).toMatch(/const changeNextDoor = pickerOn && nextRoundExists \? \(\) => openPicker\(\{ from: 'part' \}\) : null/);
    expect(host).toMatch(/onChoose: \(\) => openPicker\(\{ from: 'key' \}\)/);
    // Change what's next reaches both frames
    expect(host.match(/onChangeNext(: |=\{)changeNextDoor/g).length).toBeGreaterThanOrEqual(3);
  });

  test('the C key has Q\'s enabled, without the Call & Answer term, and never twice', () => {
    const block = host.slice(host.indexOf('useQuestionPickerKey({'), host.indexOf("onChoose: () => openPicker({ from: 'key' })"));
    expect(block).toMatch(/sessionPanelKeyOn && !createdSetup && !showWelcomeScreen/);
    expect(block).toMatch(/pickerApplies\(currentGameType, gameState\)/);
    expect(block).toMatch(/!picker && !pickerChoiceOpen/);
    expect(block).not.toMatch(/=== 'call-and-answer'/);
  });

  test('a round advance closes the picker (its asked marks are round-scoped)', () => {
    expect(host).toMatch(/const closeAllSidePanels = \(\) => \{\s*setSetupPanelOpen\(false\);\s*setPicker\(null\);/);
  });

  test('the one-screen choice is a dialog to the keys', () => {
    expect(host).toMatch(/ownChoiceOpen \|\| pickerChoiceOpen, showExpandedQR/);
  });

  test('Undo replays the queue route\'s ops, not a copy of the queue', () => {
    expect(host).toMatch(/runPickOps\(undoAskNextOps\(n\.before\)\.map/);
    expect(host).toMatch(/postQueueOp\(\{ apiBase: API_BASE, gameId, op: st\.op, questionKey: st\.key/);
  });
});
