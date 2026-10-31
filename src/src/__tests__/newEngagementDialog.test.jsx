/**
 * THE REDESIGNED NEW ENGAGEMENT DIALOG (docs/design/new-engagement, README
 * §2 "Tests to add" and §8 "Tests to add or change"). Behaviour only — jsdom
 * has no layout engine, so nothing here measures a width.
 *
 * The bug the owner reported is half here (the dialog never shows or sends
 * one set's topics under another's) and half in setCategoryLoader.test.jsx
 * (the page's requests are latest-only).
 */
import React, { useState } from 'react';
import { render, screen, fireEvent, within, waitFor, act } from '@testing-library/react';
import GameSetupDialog from '../components/GameSetupDialog';
import HostQuestionSetsDialog from '../components/HostQuestionSetsDialog';
import SessionHistoryPanel from '../components/SessionHistoryPanel';
import Modal from '../components/Modal';
import Icon from '../components/Icon';
import { pickSet, chosenSet, chooser } from '../testUtils/setChooser';
import { setRefKey } from '../utils/setRef';

jest.mock('../auth/authFetch', () => ({
  __esModule: true,
  authFetch: jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ prompts: [], questionSets: [] }) })),
}));

const SETS = [
  { id: 'seta', name: 'Lessons from Different Schools', totalQuestions: 14, engagementType: 'call-and-answer' },
  { id: 'setb', name: 'Strategic Pricing Plays', totalQuestions: 47, engagementType: 'call-and-answer' },
  { id: 'space', name: 'Space Trivia', totalQuestions: 12, engagementType: 'trivia' },
  { id: 'pulse', name: 'Kickoff pulse', totalQuestions: 5, engagementType: 'survey' },
];
const A = [{ name: 'Architecture', questionCount: 8 }, { name: 'Law', questionCount: 6 }];
const B = [{ name: 'Pricing', questionCount: 30 }, { name: 'Ops', questionCount: 17 }];
const KEY_A = setRefKey({ id: 'seta' });
const KEY_B = setRefKey({ id: 'setb' });

const base = (over = {}) => ({
  isFirstEngagement: true,
  eventTitle: 'Team retro — October',
  onEventTitleChange: jest.fn(),
  questionSets: SETS,
  personas: [],
  categories: [],
  activeCategoryIds: new Set(),
  onToggleCategory: jest.fn(),
  onQuestionSetChange: jest.fn(),
  onCancel: jest.fn(),
  onCreate: jest.fn(),
  ...over,
});

/**
 * THE PAGE, SIMULATED: it owns the categories and the loader's status, and —
 * like the real page when the network is slow — it does NOT have the new set's
 * list yet when the dialog re-renders. `answer(key, list)` lands a response.
 */
function PageHarness({ initialKey = '', lists = {}, onCreate, onRetry, holdLoads = true, children }) {
  const [state, setState] = useState({ categories: [], active: new Set(), status: { key: initialKey, loading: false, error: '' } });
  PageHarness.answer = (key, list, error = '') => act(() => {
    setState({ categories: error ? [] : list, active: new Set(error ? [] : list.map((c) => c.name)), status: { key, loading: false, error } });
  });
  PageHarness.stale = (list) => act(() => {
    // A late response for some OTHER set lands in the page's list (the old
    // fetchCategories had no guard) while its status still names the chosen set.
    setState((s) => ({ ...s, categories: list, active: new Set(list.map((c) => c.name)) }));
  });
  return (
    <GameSetupDialog
      {...base({ onCreate, onRetryCategories: onRetry })}
      initialFormat="call-and-answer"
      categories={state.categories}
      activeCategoryIds={state.active}
      categoryStatus={state.status}
      onToggleCategory={(name) => setState((s) => {
        const active = new Set(s.active);
        if (active.has(name)) active.delete(name); else active.add(name);
        return { ...s, active };
      })}
      onQuestionSetChange={(id, scope) => {
        const key = id ? setRefKey({ id, scope }) : '';
        // The real loader clears at once and reports loading for the new key.
        if (holdLoads || !lists[key]) {
          setState({ categories: [], active: new Set(), status: { key, loading: Boolean(id), error: '' } });
        } else {
          setState({ categories: lists[key], active: new Set(lists[key].map((c) => c.name)), status: { key, loading: false, error: '' } });
        }
      }}
    >
      {children}
    </GameSetupDialog>
  );
}

const radio = (name) => screen.getByRole('radio', { name });
/* "How it runs" folded to its rail, as a host who hid it would have it. */
const hideHow = () => window.localStorage.setItem('engage.newEngagement.howItRuns', 'hidden');
afterEach(() => { try { window.localStorage.clear(); } catch (e) { /* blocked in one test */ } });
const createButton = () => screen.getByRole('button', { name: /create engagement|loading topics/i });
/* Round 4 (review A1): Create is aria-disabled until ready, never `disabled`,
   so it stays in the Tab order and is described by "Still needed". */
const notReady = (el) => { expect(el).toHaveAttribute('aria-disabled', 'true'); expect(el).not.toBeDisabled(); };
const live = () => document.querySelector('.gsd-sr[aria-live="polite"]');
const need = () => document.getElementById('gsd-need');

/* ── README §2: the bug ────────────────────────────────────────────────── */
describe('changing the set never shows the old set\'s topics (README §2)', () => {
  test('picking set B renders none of set A\'s topic names, even before B\'s fetch resolves', () => {
    render(<PageHarness />);
    pickSet(KEY_A);
    PageHarness.answer(KEY_A, A);
    expect(screen.getByText('Architecture')).toBeInTheDocument();
    pickSet(KEY_B);
    // B's request is still out: no Architecture, no Law — placeholders instead.
    expect(screen.queryByText('Architecture')).toBeNull();
    expect(screen.queryByText('Law')).toBeNull();
    expect(screen.getByText(/Loading this set’s topics/)).toBeInTheDocument();
    PageHarness.answer(KEY_B, B);
    expect(screen.getByText('Pricing')).toBeInTheDocument();
    expect(screen.queryByText('Architecture')).toBeNull();
  });

  test('a late response for set A, after set B is chosen, is not shown', () => {
    render(<PageHarness />);
    pickSet(KEY_A);
    pickSet(KEY_B);
    // The page's state now names A's list while B is chosen and still loading.
    PageHarness.stale(A);
    expect(screen.queryByText('Architecture')).toBeNull();
    // ...and even if the page claims to be done, a list for another key is not B's.
    PageHarness.answer(KEY_A, A);
    expect(screen.queryByText('Architecture')).toBeNull();
    notReady(createButton());
  });

  test('a failed fetch shows zero topics and an error line with Retry, not set A\'s', () => {
    const onRetry = jest.fn();
    render(<PageHarness onRetry={onRetry} />);
    pickSet(KEY_A);
    PageHarness.answer(KEY_A, A);
    pickSet(KEY_B);
    PageHarness.answer(KEY_B, [], 'Could not load this set’s topics (HTTP 500).');
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/Could not load this set’s topics/);
    expect(screen.queryByText('Architecture')).toBeNull();
    fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledWith('setb', 'platform');
  });

  test('Create is disabled, and says so, while the topics are loading', () => {
    render(<PageHarness />);
    pickSet(KEY_B);
    const button = screen.getByRole('button', { name: 'Loading topics…' });
    notReady(button);
    PageHarness.answer(KEY_B, B);
    expect(screen.getByRole('button', { name: 'Create engagement' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Create engagement' })).not.toHaveAttribute('aria-disabled');
  });

  test('Create never sends one set\'s topics for another', () => {
    const onCreate = jest.fn();
    const { rerender } = render(<GameSetupDialog {...base({ onCreate })} initialFormat="call-and-answer" categories={B}
      activeCategoryIds={new Set(['Architecture', 'Pricing'])} categoryStatus={{ key: '', loading: false, error: '' }} />);
    pickSet(KEY_B);
    // The page says B's list is in, but the selection still holds a name from A.
    rerender(<GameSetupDialog {...base({ onCreate })} initialFormat="call-and-answer" categories={B}
      activeCategoryIds={new Set(['Architecture', 'Pricing'])} categoryStatus={{ key: KEY_B, loading: false, error: '' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create engagement' }));
    expect(onCreate.mock.calls[0][0].categoryIds).toEqual(['Pricing']);
  });

  test('opening Change unmounts the topics, and "Keep the set I had" brings back the same selection', () => {
    render(<GameSetupDialog {...base()} initialFormat="call-and-answer" categories={A}
      activeCategoryIds={new Set(['Law'])} categoryStatus={{ key: KEY_A, loading: false, error: '' }} initialSetId="seta" />);
    expect(screen.getByText('Law').closest('button')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(chooser()).getByRole('button', { name: 'Change' }));
    expect(screen.queryByRole('group', { name: /topics in this set/i })).toBeNull();
    expect(screen.queryByText('Architecture')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Keep the set I had' }));
    expect(screen.getByText('Law').closest('button')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Architecture').closest('button')).toHaveAttribute('aria-pressed', 'false');
    expect(chosenSet()).toBe(KEY_A);
  });
});

/* ── README §8: the dialog ─────────────────────────────────────────────── */
describe('a first-time host', () => {
  /* Round 4: only Name it and Format on open; no Question set section. */
  test('nothing is chosen: only Name it and Format on open, no Question set section, and Create waits', () => {
    render(<GameSetupDialog {...base()} />);
    const group = screen.getByRole('radiogroup', { name: /pick a format/i });
    expect(within(group).getAllByRole('radio').every((r) => r.getAttribute('aria-checked') === 'false')).toBe(true);
    const headings = within(document.querySelector('.gsd-main')).getAllByRole('heading').map((h) => h.textContent);
    expect(headings).toEqual(['Name it', 'Pick a format']);
    // rejects: round 3's greyed "3 Questions — Choose a format first" waiting underneath
    expect(screen.queryByText(/Choose a format first/)).toBeNull();
    expect(screen.queryByRole('combobox', { name: /question set/i })).toBeNull();
    notReady(createButton());
    expect(document.querySelector('.new-game-dialog')).toHaveClass('gsd--full');
    // The gallery card says it in one plain sentence (frame 2-03); Good for lives in the guide.
    expect(screen.getByText('Everyone answers, reads all the answers and votes for their favourites.')).toBeInTheDocument();
    expect(screen.queryAllByText('Continues on its own page').length).toBe(0); // no onChooseOther here
  });

  test('the title has focus on open', async () => {
    render(<GameSetupDialog {...base()} />);
    await waitFor(() => expect(screen.getByLabelText(/name it/i)).toHaveFocus());
  });

  test('Enter in the title moves to the next empty decision — the format', async () => {
    render(<GameSetupDialog {...base()} />);
    fireEvent.keyDown(screen.getByLabelText(/name it/i), { key: 'Enter' });
    expect(radio('Call & Answer')).toHaveFocus();
  });

  test('"Retro" chooses Call & Answer and says why in one sentence', () => {
    render(<GameSetupDialog {...base()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retro' }));
    expect(screen.getByRole('button', { name: /Retro/ })).toHaveAttribute('aria-pressed', 'true');
    expect(radio('Call & Answer')).toHaveAttribute('aria-checked', 'true');
    const reason = document.querySelector('.gsd-reason');
    expect(reason).toHaveTextContent(/what went well, what should change/);
    // The paragraph is not a live region of its own: the one region speaks (A2).
    expect(reason).not.toHaveAttribute('aria-live');
    // The reason and the reveal are ONE message, not two that interrupt each other.
    expect(live().textContent).toMatch(/^For a retro: Call & Answer\. .*what went well.* Question set is below\.$/);
  });

  test('the Format guide: seven format cards as tabs, one Use button, and Use returns with that format', () => {
    render(<GameSetupDialog {...base({ onChooseOther: jest.fn() })} eventsAccess={{ enabled: true, canCreate: true }} />);
    fireEvent.click(screen.getByRole('button', { name: /compare formats/i }));
    expect(document.querySelector('.new-game-dialog')).toHaveClass('gsd--guide');
    const guide = screen.getByTestId('gsd-compare');
    const tabs = within(guide).getAllByRole('tab');
    expect(tabs).toHaveLength(7);
    // Each card's name is one text node (CSS keeps it on one line: gameSetupPalette.test.js).
    tabs.forEach((t) => {
      const name = document.getElementById(t.getAttribute('aria-labelledby'));
      expect(name.childNodes).toHaveLength(1);
      expect(name.childNodes[0].nodeType).toBe(3);
    });
    expect(within(guide).queryByRole('table')).toBeNull();
    expect(within(guide).getAllByRole('button', { name: /^Use / })).toHaveLength(1);
    fireEvent.click(within(guide).getByRole('tab', { name: 'Trivia' }));
    expect(within(guide).getByRole('tab', { name: 'Trivia' })).toHaveAttribute('aria-selected', 'true');
    expect(within(guide).getByRole('tabpanel')).toHaveTextContent('Ask a question with one right answer');
    fireEvent.click(screen.getByRole('button', { name: 'Use Trivia' }));
    expect(screen.queryByTestId('gsd-compare')).toBeNull();
    expect(document.querySelector('.new-game-dialog')).not.toHaveClass('gsd--guide');
    expect(radio('Trivia')).toHaveAttribute('aria-checked', 'true');
  });

  test('the guide\'s cards answer the arrow keys like tabs: they move and show', () => {
    render(<GameSetupDialog {...base()} initialFormat="call-and-answer" />);
    fireEvent.click(screen.getByRole('button', { name: /compare formats/i }));
    const first = screen.getByRole('tab', { name: 'Call & Answer' });
    expect(first).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Trivia' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Trivia' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('button', { name: 'Use Trivia' })).toBeInTheDocument();
  });

  test('one layout: no view switch; "How it runs" is open beside the form by default', () => {
    render(<GameSetupDialog {...base()} hasCreated lastFormat="trivia" initialFormat="trivia" />);
    expect(screen.queryByRole('radiogroup', { name: 'View' })).toBeNull();
    expect(screen.queryByRole('radio', { name: /Guided|Quick/ })).toBeNull();
    expect(document.querySelector('.new-game-dialog')).not.toHaveClass('gsd--compact');
    expect(screen.getByRole('heading', { name: 'How Trivia runs' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Hide/ })).toHaveAttribute('aria-expanded', 'true');
  });

  test('Hide folds the pane to a rail named for the format; Show brings it back; focus follows', () => {
    render(<GameSetupDialog {...base()} hasCreated lastFormat="call-and-answer" initialFormat="call-and-answer" />);
    const card = document.querySelector('.new-game-dialog').className;
    fireEvent.click(screen.getByRole('button', { name: /^Hide/ }));
    const rail = screen.getByRole('button', { name: 'Show how Call & Answer runs' });
    expect(rail).toHaveAttribute('aria-expanded', 'false');
    expect(rail).toHaveFocus();
    expect(document.querySelector('.gsd-wt')).toBeNull();
    expect(document.querySelector('.gsd-body')).toHaveClass('has-rail');
    // The dialog keeps its size: only the body's columns change.
    expect(document.querySelector('.new-game-dialog').className).toBe(card);
    expect(window.localStorage.getItem('engage.newEngagement.howItRuns')).toBe('hidden');
    // The rail follows the chips.
    fireEvent.click(radio('Trivia'));
    expect(screen.getByRole('button', { name: 'Show how Trivia runs' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show how Trivia runs' }));
    expect(screen.getByRole('heading', { name: 'How Trivia runs' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Hide/ })).toHaveFocus();
    expect(window.localStorage.getItem('engage.newEngagement.howItRuns')).toBeNull();
  });

  test('hidden is remembered: the next open starts on the rail', () => {
    hideHow();
    render(<GameSetupDialog {...base()} hasCreated lastFormat="poll" initialFormat="poll" />);
    expect(screen.getByRole('button', { name: 'Show how Poll runs' })).toBeInTheDocument();
    expect(document.querySelector('.gsd-wt')).toBeNull();
  });

  test('blocked storage changes nothing: the pane shows, and Hide still works', () => {
    const spy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const spySet = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    try {
      render(<GameSetupDialog {...base()} initialFormat="call-and-answer" />);
      expect(screen.getByRole('heading', { name: 'How Call & Answer runs' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /^Hide/ }));
      expect(screen.getByRole('button', { name: 'Show how Call & Answer runs' })).toBeInTheDocument();
    } finally { spy.mockRestore(); spySet.mockRestore(); }
  });

  /* Revision, 31 Oct: the gallery is for everyone until a set is picked —
     history no longer decides it. rejects: chips on open for a host with history */
  test.each([['shown', false], ['hidden', true]])('the gallery for everyone until a set is picked, then chips (pane %s)', (_, hidden) => {
    if (hidden) hideHow();
    const { unmount } = render(<GameSetupDialog {...base()} />);
    expect(document.querySelector('.gsd-fmt--gallery')).not.toBeNull();
    unmount();
    if (hidden) hideHow();
    render(<GameSetupDialog {...base()} hasCreated lastFormat="call-and-answer" />);
    expect(document.querySelector('.gsd-fmt--gallery')).not.toBeNull();
    expect(document.querySelector('.gsd-fmt--chips')).toBeNull();
    expect(screen.getByText('Planning a…')).toBeInTheDocument();
    fireEvent.click(radio('Call & Answer'));
    expect(document.querySelector('.gsd-fmt--gallery')).not.toBeNull();
    pickSet(KEY_B);
    expect(document.querySelector('.gsd-fmt--gallery')).toBeNull();
    expect(document.querySelector('.gsd-fmt--chips')).not.toBeNull();
  });

  /* Live check, round 3: a first-time host with nothing chosen saw an empty
     pane, the moment the storyboard helps most. */
  /* Round 4, Fork 1 A: present from the start, but quiet. */
  test('nothing chosen: the pane is quiet — one sentence and one labelled example stage, no index', () => {
    render(<GameSetupDialog {...base()} />);
    const pane = screen.getByRole('complementary', { name: 'How it runs' });
    expect(within(pane).getByRole('heading', { name: 'How it runs' })).toBeInTheDocument();
    expect(within(pane).getByText(/this side shows what happens in the room, stage by stage/)).toBeInTheDocument();
    expect(within(pane).getByTestId('gsd-wt-example')).toHaveTextContent('Example · Call & Answer, stage 1 of 6');
    // rejects: the full storyboard and its index on open (round 3)
    expect(within(pane).queryByRole('navigation')).toBeNull();
    expect(within(pane).queryAllByRole('listitem')).toHaveLength(0);
    // Hide is still there, on the thing it hides.
    expect(within(pane).getByRole('button', { name: /^Hide/ })).toBeInTheDocument();
  });

  test('a format chosen: the full storyboard and its index', () => {
    render(<GameSetupDialog {...base()} />);
    fireEvent.click(radio('Trivia'));
    const pane = screen.getByRole('complementary', { name: 'How it runs' });
    expect(within(pane).getByRole('heading', { name: 'How Trivia runs' })).toBeInTheDocument();
    expect(within(pane).getByRole('navigation', { name: 'Stages of Trivia' })).toBeInTheDocument();
    expect(within(pane).queryByTestId('gsd-wt-example')).toBeNull();
  });

  test('hovering or focusing a gallery card previews its storyboard, debounced; leaving returns to the example; choosing shows the choice', () => {
    jest.useFakeTimers();
    try {
      render(<GameSetupDialog {...base()} />);
      fireEvent.mouseEnter(radio('Trivia'));
      // Not yet: a pointer crossing the gallery does not flicker the pane.
      expect(screen.getByTestId('gsd-wt-example')).toBeInTheDocument();
      act(() => { jest.advanceTimersByTime(200); });
      expect(screen.getByRole('heading', { name: 'How Trivia runs' })).toBeInTheDocument();
      expect(screen.getByText('A preview of the card you are on. Click it, or press Enter, to choose it.')).toBeInTheDocument();
      fireEvent.mouseLeave(screen.getByRole('radiogroup', { name: /pick a format/i }));
      act(() => { jest.advanceTimersByTime(300); });
      expect(screen.getByTestId('gsd-wt-example')).toHaveTextContent('Example · Call & Answer');
      fireEvent.focus(radio('Poll'));
      act(() => { jest.advanceTimersByTime(200); });
      expect(screen.getByRole('heading', { name: 'How Poll runs' })).toBeInTheDocument();
      fireEvent.click(radio('Wavelength'));
      act(() => { jest.advanceTimersByTime(300); });
      expect(screen.getByRole('heading', { name: 'How Wavelength runs' })).toBeInTheDocument();
      expect(screen.queryByText(/A preview of the card you are on/)).toBeNull();
    } finally { jest.useRealTimers(); }
  });

  test('the preview never speaks: nothing in the pane is a live region', () => {
    jest.useFakeTimers();
    try {
      render(<GameSetupDialog {...base()} />);
      fireEvent.mouseEnter(radio('Trivia'));
      act(() => { jest.advanceTimersByTime(200); });
      const pane = screen.getByRole('complementary', { name: 'How it runs' });
      expect(pane.querySelector('[aria-live]')).toBeNull();
      expect(pane.closest('[aria-live]')).toBeNull();
    } finally { jest.useRealTimers(); }
  });

  test('a phone with nothing chosen: the fold carries the example too', () => {
    const before = window.matchMedia;
    window.matchMedia = (q) => ({ matches: /max-width: (600|900)px/.test(q), media: q, addEventListener() {}, removeEventListener() {} });
    try {
      render(<GameSetupDialog {...base()} />);
      expect(document.querySelector('details.gsd-how-fold summary').textContent).toMatch('How it runs — an example');
    } finally { window.matchMedia = before; }
  });

  test('an edit has no Hide and no storyboard', () => {
    render(<GameSetupDialog {...base()} mode="edit" initialValues={{ gameType: 'trivia', title: 'Quiz', questionSetId: 'space' }} />);
    expect(screen.queryByRole('button', { name: /^Hide/ })).toBeNull();
    expect(document.querySelector('.gsd-wt')).toBeNull();
  });
});

/* REVISION, 31 OCT (README round 4): the owner, "Why can't we get it to
   appear like the first timer we need to support those that forgot or
   clicked ahead". Every new engagement opens with no format chosen; the last
   format is tagged and is where the keyboard lands, so a repeat host is still
   one key per decision. */
describe('a host with history', () => {
  test('opens exactly like a first-timer: the gallery and "Planning a…", no format chosen, the quiet example, no Question set; the last card says so', () => {
    render(<GameSetupDialog {...base()} hasCreated lastFormat="trivia" />);
    // rejects: the last format preselected on open (round 4 before 31 Oct)
    const radios = within(screen.getByRole('radiogroup', { name: /format/i })).getAllByRole('radio');
    expect(radios.filter((r) => r.getAttribute('aria-checked') === 'true')).toEqual([]);
    const pane = screen.getByRole('complementary', { name: 'How it runs' });
    expect(within(pane).getByRole('heading', { name: 'How it runs' })).toBeInTheDocument();
    expect(within(pane).getByTestId('gsd-wt-example')).toHaveTextContent('Example · Call & Answer, stage 1 of 6');
    expect(screen.queryByRole('heading', { name: 'How Trivia runs' })).toBeNull();
    // rejects: Question set already open for a host with history
    expect(screen.queryByRole('heading', { name: 'Question set' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: /choose a question set/i })).toBeNull();
    expect(need()).toHaveTextContent('Still needed: a format and a question set.');
    // rejects: chips for a host with history (round 2's rule, retired 31 Oct)
    expect(screen.getByRole('heading', { name: 'Pick a format' })).toBeInTheDocument();
    expect(document.querySelector('.gsd-fmt--chips')).toBeNull();
    expect(screen.getByText('Planning a…')).toBeInTheDocument();
    expect(radio('Trivia').closest('button')).toHaveTextContent('You used it last.');
    expect(screen.getAllByText('You used it last.')).toHaveLength(1);
    // Round 3's one layout: the same card as a first-timer's.
    expect(document.querySelector('.new-game-dialog')).toHaveClass('gsd--full');
    expect(document.querySelector('.new-game-dialog')).not.toHaveClass('gsd--compact');
    // ⌘ on a Mac, Ctrl elsewhere — jsdom is not a Mac.
    expect(screen.getByRole('button', { name: /create engagement/i })).toHaveAttribute('aria-keyshortcuts', 'Meta+Enter Control+Enter');
  });

  test('focus entering the gallery lands on the last card, and Space picks it', () => {
    render(<GameSetupDialog {...base()} hasCreated lastFormat="trivia" />);
    const radios = within(screen.getByRole('radiogroup', { name: /format/i })).getAllByRole('radio');
    // The roving tab stop is the last card, not the first.
    expect(radios.filter((r) => r.tabIndex === 0)).toEqual([radio('Trivia')]);
    // In the Tab order the group's one stop follows Compare formats and the
    // meeting chips: every stop between the title and it is one of those.
    const form = document.querySelector('.gsd-main');
    const all = Array.from(form.querySelectorAll('button, input, [tabindex]'))
      .filter((el) => el.tabIndex >= 0 && !el.disabled);
    const title = all.indexOf(screen.getByLabelText(/name it/i));
    const stop = all.indexOf(radio('Trivia'));
    const between = all.slice(title + 1, stop);
    expect(between[0]).toBe(screen.getByRole('button', { name: /compare formats/i }));
    between.slice(1).forEach((el) => expect(el).toHaveClass('gsd-meet-chip'));
    expect(all.slice(stop + 1).some((el) => el.getAttribute('role') === 'radio')).toBe(false);
    // Enter in the title goes straight to it.
    const input = screen.getByLabelText(/name it/i);
    input.focus();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(radio('Trivia')).toHaveFocus();
    fireEvent.keyDown(radio('Trivia'), { key: ' ' });
    expect(radio('Trivia')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('heading', { name: 'Question set' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'How Trivia runs' })).toBeInTheDocument();
  });

  test('the history read landing after open tags the last format and moves the tab stop, but chooses nothing and is not "work in hand"', () => {
    const props = base();
    const { rerender } = render(<GameSetupDialog {...props} />);
    rerender(<GameSetupDialog {...props} hasCreated lastFormat="trivia" />);
    expect(radio('Trivia')).toHaveAttribute('aria-checked', 'false');
    expect(radio('Trivia').tabIndex).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: /close without creating/i }));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  test('once the format is chosen the recents are one click away, and a Tab into the search does not open the full chooser', () => {
    const props = base();
    render(<GameSetupDialog {...props} hasCreated lastFormat="call-and-answer" recentSetUses={new Map([[KEY_B, Date.now()]])} />);
    expect(screen.queryByRole('listbox', { name: 'Used by you lately' })).toBeNull();
    fireEvent.click(radio('Call & Answer'));
    fireEvent.focus(screen.getByRole('combobox', { name: /choose a question set/i }));
    expect(screen.queryByTestId('set-chooser-row')).toBeNull();
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Used by you lately' })).getByRole('option'));
    expect(props.onQuestionSetChange).toHaveBeenLastCalledWith('setb', 'platform');
  });

  test('a first-timer\'s tab stop is still the first format', () => {
    render(<GameSetupDialog {...base()} />);
    const radios = within(screen.getByRole('radiogroup', { name: /format/i })).getAllByRole('radio');
    expect(radios.filter((r) => r.tabIndex === 0)).toEqual([radio('Call & Answer')]);
  });
});

describe('the format radio group', () => {
  test('exactly one tab stop, and the arrow keys move and choose', () => {
    render(<GameSetupDialog {...base()} initialFormat="call-and-answer" />);
    const radios = within(screen.getByRole('radiogroup', { name: /format/i })).getAllByRole('radio');
    expect(radios.filter((r) => r.tabIndex === 0)).toEqual([radio('Call & Answer')]);
    fireEvent.keyDown(radio('Call & Answer'), { key: 'ArrowRight' });
    expect(radio('Trivia')).toHaveAttribute('aria-checked', 'true');
    expect(radio('Trivia')).toHaveFocus();
    expect(radio('Trivia').tabIndex).toBe(0);
    fireEvent.keyDown(radio('Trivia'), { key: 'ArrowLeft' });
    expect(radio('Call & Answer')).toHaveAttribute('aria-checked', 'true');
  });

  test('arrowing C&A → Trivia → C&A restores the set the host had (README §6)', () => {
    const props = base();
    render(<GameSetupDialog {...props} hasCreated lastFormat="call-and-answer" initialFormat="call-and-answer" />);
    pickSet(KEY_B);
    fireEvent.keyDown(radio('Call & Answer'), { key: 'ArrowRight' });
    expect(chosenSet()).toBe('');
    fireEvent.keyDown(radio('Trivia'), { key: 'ArrowLeft' });
    expect(chosenSet()).toBe(KEY_B);
    expect(props.onQuestionSetChange).toHaveBeenLastCalledWith('setb', 'platform');
  });
});

describe('⌘/Ctrl+Enter', () => {
  test('creates only when Create could be pressed', () => {
    const props = base({ eventTitle: '' });
    const { rerender } = render(<GameSetupDialog {...props} initialFormat="call-and-answer" />);
    pickSet(KEY_B);
    fireEvent.keyDown(screen.getByLabelText(/name it/i), { key: 'Enter', ctrlKey: true });
    expect(props.onCreate).not.toHaveBeenCalled(); // no title yet
    rerender(<GameSetupDialog {...props} eventTitle="Retro" initialFormat="call-and-answer" />);
    fireEvent.keyDown(screen.getByLabelText(/name it/i), { key: 'Enter', metaKey: true });
    expect(props.onCreate).toHaveBeenCalledTimes(1);
  });

  test('on Build Room it moves the focus to Continue and never leaves on its own', () => {
    const onChooseOther = jest.fn();
    render(<GameSetupDialog {...base({ onChooseOther })} initialFormat="call-and-answer" />);
    fireEvent.click(radio('Build Room'));
    fireEvent.keyDown(screen.getByLabelText(/name it/i), { key: 'Enter', ctrlKey: true });
    expect(onChooseOther).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Set up the Build Room' })).toHaveFocus();
    expect(screen.getByText(/moves to Continue; press Enter there to go/)).toBeInTheDocument();
  });
});

describe('the hand-offs and the survey', () => {
  test('a survey says people can answer as soon as it opens, and the button opens it', () => {
    render(<GameSetupDialog {...base()} initialFormat="survey" />);
    // Until the set is in, the foot says what is still needed (round 4).
    expect(need()).toHaveTextContent('Still needed: a question set.');
    pickSet(setRefKey({ id: 'pulse' }));
    expect(screen.getByText(/People can answer as soon as you open it\. There is no separate Start\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open the survey' })).toBeInTheDocument();
    // The walkthrough's first step says so too.
    expect(screen.getByRole('heading', { name: /Open it/ })).toBeInTheDocument();
  });

  test('Event on the Free plan replaces the price line with the plan, and Continue is disabled', () => {
    render(<GameSetupDialog {...base({ onChooseOther: jest.fn() })} initialFormat="call-and-answer"
      eventsAccess={{ enabled: true, canCreate: false, offerPlanName: 'Standard plan' }} />);
    fireEvent.click(radio('Event'));
    expect(screen.getByTestId('gsd-event-plan')).toHaveTextContent('Events come with the Standard plan.');
    expect(screen.queryByTestId('gsd-event-price')).toBeNull();
    notReady(screen.getByRole('button', { name: 'Continue to the event' }));
  });

  test('Event on a paid plan states the price', () => {
    render(<GameSetupDialog {...base({ onChooseOther: jest.fn() })} initialFormat="call-and-answer"
      eventsAccess={{ enabled: true, canCreate: true, offerPlanName: '' }} />);
    fireEvent.click(radio('Event'));
    expect(screen.getByTestId('gsd-event-price')).toHaveTextContent(/an event, counted when it first goes live/);
  });
});

describe('names and Workie, said plainly', () => {
  test('Call & Answer states the names rule beside the questions, and Change opens it', () => {
    render(<GameSetupDialog {...base()} initialFormat="call-and-answer" initialSetId="setb" />);
    expect(screen.getByTestId('gsd-namesline')).toHaveTextContent('Names are hidden until the vote closes');
    fireEvent.click(screen.getByRole('button', { name: 'Change how names are shown' }));
    expect(document.querySelector('details.gsd-adv').open).toBe(true);
    expect(screen.getByRole('checkbox', { name: /anonymous responses/i })).toHaveFocus();
  });

  test('Workie is introduced in one line', () => {
    render(<GameSetupDialog {...base()} initialFormat="call-and-answer" initialSetId="setb" />);
    expect(screen.getByText(/Workie is Engage’s AI assistant/)).toBeInTheDocument();
  });

  test('no invented durations: no minutes anywhere on the form', () => {
    render(<GameSetupDialog {...base()} />);
    expect(screen.queryByText(/\b\d+\s*min/)).toBeNull();
  });
});

/* ── The live dev tests, 30 Oct 2026 (reviews/devtest-1/2/3) ─────────── */
describe('live dev test fixes', () => {
  test('E1: pick a recent with Enter, then Ctrl+Enter creates (focus stays in the dialog)', () => {
    const onCreate = jest.fn();
    render(<GameSetupDialog {...base({ onCreate })} hasCreated lastFormat="call-and-answer" initialFormat="call-and-answer"
      recentSetUses={new Map([[KEY_B, Date.now()]])} />);
    const box = screen.getByRole('combobox', { name: /choose a question set/i });
    box.focus();
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(screen.getByRole('button', { name: 'Change' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement, { key: 'Enter', ctrlKey: true });
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  test('E1: Ctrl+Enter on <body> while the dialog is open still creates', () => {
    const onCreate = jest.fn();
    render(<GameSetupDialog {...base({ onCreate })} initialFormat="call-and-answer" />);
    pickSet(KEY_B);
    document.activeElement.blur();
    fireEvent.keyDown(document.body, { key: 'Enter', ctrlKey: true });
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  test('E2: Ctrl+Enter while topics load is queued, says so, and creates when they arrive', () => {
    const onCreate = jest.fn();
    render(<PageHarness onCreate={onCreate} />);
    pickSet(KEY_B);
    fireEvent.keyDown(document.body, { key: 'Enter', ctrlKey: true });
    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Waiting for topics…' })).toBeInTheDocument();
    expect(screen.getByText(/created as soon as they arrive/)).toBeInTheDocument();
    PageHarness.answer(KEY_B, B);
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate.mock.calls[0][0].categoryIds).toEqual(['Pricing', 'Ops']);
  });

  test('E6: on a plan without events, Ctrl+Enter says why instead of claiming a move', () => {
    render(<GameSetupDialog {...base({ onChooseOther: jest.fn() })} initialFormat="call-and-answer"
      eventsAccess={{ enabled: true, canCreate: false, offerPlanName: 'Standard plan' }} />);
    fireEvent.click(radio('Event'));
    fireEvent.keyDown(screen.getByLabelText(/name it/i), { key: 'Enter', ctrlKey: true });
    expect(screen.getByText(/Events come with the Standard plan, so there is nothing to continue to/)).toBeInTheDocument();
    expect(screen.queryByText(/moved to Continue/)).toBeNull();
  });

  test('B4: "Use Trivia" in the Format guide lets go of the Retro chip and its line', () => {
    render(<GameSetupDialog {...base()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retro' }));
    fireEvent.click(screen.getByRole('button', { name: /compare formats/i }));
    fireEvent.click(screen.getByRole('tab', { name: 'Trivia' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use Trivia' }));
    expect(screen.getByRole('button', { name: 'Retro' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByText(/For a retro/)).toBeNull();
    expect(radio('Trivia')).toHaveFocus();
  });

  test('H4: the Format guide takes the focus to its heading, and Back returns it to the link', () => {
    render(<GameSetupDialog {...base()} />);
    fireEvent.click(screen.getByRole('button', { name: /compare formats/i }));
    expect(screen.getByRole('heading', { name: 'Format guide' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: /back to the form/i }));
    expect(screen.getByRole('button', { name: /compare formats/i })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: /compare formats/i }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('button', { name: /compare formats/i })).toHaveFocus();
  });

  test('B5: Esc in the empty set search does not ask to discard; the discard bar goes when the host goes back to the form', () => {
    const props = base();
    render(<GameSetupDialog {...props} initialFormat="call-and-answer" />);
    fireEvent.keyDown(screen.getByRole('combobox', { name: /choose a question set/i }), { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    // Work in hand without a set picked (round 4: Advanced waits for the set).
    fireEvent.click(radio('Trivia'));
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole('button', { name: /Browse all/ }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByRole('button', { name: /create engagement/i })).toBeInTheDocument();
  });

  test('B7: compact draws no pinned summary row over the topics', () => {
    render(<GameSetupDialog {...base()} hasCreated lastFormat="call-and-answer" initialFormat="call-and-answer" categories={A}
      activeCategoryIds={new Set(['Law'])} initialSetId="seta" />);
    expect(document.querySelector('.gsd-compact-sum')).toBeNull();
    expect(screen.queryByText(/all 2 topics/)).toBeNull();
  });

  test('B8: switched-off topics come back with the set after a format round trip', () => {
    render(<PageHarness holdLoads={false} lists={{ [KEY_A]: A }} />);
    pickSet(KEY_A);
    fireEvent.click(screen.getByText('Law').closest('button'));
    expect(screen.getByText('Law').closest('button')).toHaveAttribute('aria-pressed', 'false');
    fireEvent.keyDown(radio('Call & Answer'), { key: 'ArrowRight' });
    fireEvent.keyDown(radio('Trivia'), { key: 'ArrowLeft' });
    expect(chosenSet()).toBe(KEY_A);
    expect(screen.getByText('Law').closest('button')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('Architecture').closest('button')).toHaveAttribute('aria-pressed', 'true');
  });

  /* Round 2 (devtest 5 N1): the next Tab stop after the format chips is the
     set search. "Compare formats" sits top right of the step, BEFORE the
     chips in the Tab order, never between. */
  /* Revision, 31 Oct: everyone opens on the gallery, whose "Planning a…"
     chips sit between Compare formats and the cards. */
  test('O3/E4/N1: title → Compare formats → meeting chips → formats → search, nothing between the formats and the search', () => {
    render(<GameSetupDialog {...base()} hasCreated lastFormat="call-and-answer" initialFormat="call-and-answer" />);
    const form = document.querySelector('.gsd-main');
    const all = Array.from(form.querySelectorAll('button, input, [tabindex]'))
      .filter((el) => el.tabIndex >= 0 && !el.disabled);
    const title = all.indexOf(screen.getByLabelText(/name it/i));
    const guide = all.indexOf(screen.getByRole('button', { name: /compare formats/i }));
    const fmt = all.indexOf(radio('Call & Answer'));
    const search = all.indexOf(screen.getByRole('combobox', { name: /choose a question set/i }));
    expect(guide).toBe(title + 1);
    all.slice(guide + 1, fmt).forEach((el) => expect(el).toHaveClass('gsd-meet-chip'));
    expect(search).toBe(fmt + 1);
  });

  /* THE FAST PATH for a host who repeats themselves (revision 31 Oct): no
     format is chosen on open and everyone starts at the gallery, but the
     last format is where the keyboard lands — title, Enter (to the last
     card), Enter (picks it, on to the set search, the recents one keystroke
     away), Enter (the recent), ⌘/Ctrl+Enter. Tab from the title reaches the
     same card after Compare formats and the "Planning a…" chips. */
  test('the keyboard path: title → Enter → Enter → Enter → Ctrl+Enter creates, and the keycaps show for every host', async () => {
    const onCreate = jest.fn();
    const KEY_SPACE = setRefKey({ id: 'space' });
    render(<GameSetupDialog {...base({ onCreate })} hasCreated lastFormat="trivia"
      recentSetUses={new Map([[KEY_SPACE, Date.now()]])} />);
    expect(document.querySelector('.gsd-fmt--gallery')).not.toBeNull();
    expect(document.querySelector('.btn-primary .gsd-kbd')).toHaveAttribute('aria-hidden', 'true');
    const title = screen.getByLabelText(/name it/i);
    title.focus();
    fireEvent.keyDown(title, { key: 'Enter' });
    expect(radio('Trivia')).toHaveFocus();
    expect(radio('Trivia')).toHaveAttribute('aria-checked', 'false');
    fireEvent.keyDown(radio('Trivia'), { key: 'Enter' });
    expect(radio('Trivia')).toHaveAttribute('aria-checked', 'true');
    const box = await screen.findByRole('combobox', { name: /choose a question set/i });
    await waitFor(() => expect(box).toHaveFocus());
    expect(within(screen.getByRole('listbox', { name: 'Used by you lately' })).getByRole('option')).toBeInTheDocument();
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(chosenSet()).toBe(KEY_SPACE);
    // The set is picked: the gallery folds to chips.
    expect(document.querySelector('.gsd-fmt--chips')).not.toBeNull();
    fireEvent.keyDown(document.activeElement, { key: 'Enter', ctrlKey: true });
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  /* Round 4 (review A7): closed by default, so the revealed Question set is
     not pushed two screens down; opening it does not touch the laptop pane. */
  test('a phone: "How it runs" is a closed fold under Format, saying how many stages', () => {
    const before = window.matchMedia;
    window.matchMedia = (q) => ({ matches: /max-width: (600|900)px/.test(q), media: q, addEventListener() {}, removeEventListener() {} });
    try {
      render(<GameSetupDialog {...base()} hasCreated lastFormat="call-and-answer" initialFormat="call-and-answer" />);
      const fold = document.querySelector('details.gsd-how-fold');
      expect(fold).not.toBeNull();
      expect(fold.open).toBe(false);
      expect(fold.querySelector('summary').textContent).toBe('How Call & Answer runs, 6 stages');
      fold.open = true;
      fireEvent(fold, new Event('toggle'));
      expect(within(fold).getAllByRole('listitem').length).toBe(7);
      expect(window.localStorage.getItem('engage.newEngagement.howItRuns')).toBeNull();
      expect(screen.getByRole('button', { name: 'Compare' })).toBeInTheDocument();
    } finally { window.matchMedia = before; }
  });

  test('N1: Enter on a format chip chooses it and moves on to the set search', async () => {
    render(<GameSetupDialog {...base()} hasCreated lastFormat="call-and-answer" initialFormat="call-and-answer" />);
    fireEvent.keyDown(radio('Call & Answer'), { key: 'ArrowRight' });
    fireEvent.keyDown(radio('Trivia'), { key: 'Enter' });
    await waitFor(() => expect(screen.getByRole('combobox', { name: /choose a question set/i })).toHaveFocus());
  });


  test('V4: Background for Workie is one closed line until opened', () => {
    render(<GameSetupDialog {...base()} initialFormat="call-and-answer" initialSetId="setb" />);
    const fold = document.querySelector('details.gsd-brief-fold');
    expect(fold).not.toBeNull();
    expect(fold.open).toBe(false);
    // Round 4: "Background for Workie · Optional", no uppercase header above it.
    expect(fold.querySelector('summary').textContent).toBe('Background for WorkieOptional');
    expect(screen.queryByText(/every one has a safe default/i)).toBeNull();
  });

  test('C1/N6: this chooser says Ready-made and Whose, never Unfiled; the shared label is untouched', () => {
    const sets = [
      { id: 'lib', scope: 'platform', name: 'Library set', totalQuestions: 4, engagementType: 'call-and-answer', topic: '' },
      { id: 'mine', scope: 'org', mine: true, name: 'My set', totalQuestions: 4, engagementType: 'call-and-answer', topic: '' },
    ];
    render(<GameSetupDialog {...base()} questionSets={sets} initialFormat="call-and-answer" />);
    fireEvent.click(screen.getByRole('button', { name: /Browse all/ }));
    const list = chooser();
    expect(within(list).getByRole('columnheader', { name: 'Whose' })).toBeInTheDocument();
    expect(within(list).getAllByText('Ready-made').length).toBeGreaterThan(0);
    expect(within(list).queryByText('Engage')).toBeNull();
    expect(within(list).queryByText(/Unfiled/)).toBeNull();
    // eslint-disable-next-line global-require
    expect(require('../utils/setOwnerTag').setOwnerLabel(sets[0])).not.toBe('Ready-made');
  });

  test('N4: no Tags column when no set has a tag', () => {
    render(<GameSetupDialog {...base()} initialFormat="call-and-answer" />);
    fireEvent.click(screen.getByRole('button', { name: /Browse all/ }));
    expect(within(chooser()).queryByRole('columnheader', { name: 'Tags' })).toBeNull();
  });

  /* Round 4: a host with no set of their own sees one link, "Make your own set". */
  test('B3: "Make your own set" opens the sets dialog on the new-set panel, above the shelf', async () => {
    render(<GameSetupDialog {...base()} initialFormat="call-and-answer" />);
    expect(screen.queryByRole('button', { name: 'Your question sets' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Make your own set' }));
    expect(await screen.findByText('How do you want to make it?')).toBeInTheDocument();
  });

  test('"Your question sets" shows only to a host who owns a set of this format', () => {
    const sets = [...SETS, { id: 'mine', scope: 'org', mine: true, name: 'My retro', totalQuestions: 4, engagementType: 'call-and-answer' }];
    render(<GameSetupDialog {...base()} questionSets={sets} initialFormat="call-and-answer" />);
    expect(screen.getByRole('button', { name: 'Your question sets' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Make a new set' })).toBeInTheDocument();
    // Trivia: the host owns none, so one link.
    fireEvent.click(radio('Trivia'));
    expect(screen.queryByRole('button', { name: 'Your question sets' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Make your own set' })).toBeInTheDocument();
  });

  test('phone (frames 10/10b): formats folded behind More, Create says Create', () => {
    const before = window.matchMedia;
    window.matchMedia = (q) => ({ matches: /max-width: 600px/.test(q), media: q, addEventListener() {}, removeEventListener() {} });
    const names = () => within(screen.getByRole('radiogroup', { name: /format/i })).getAllByRole('radio')
      .map((r) => r.getAttribute('data-format'));
    try {
      const { unmount } = render(<GameSetupDialog {...base()} hasCreated lastFormat="call-and-answer" />);
      // The gallery, as rows, for a host with history too; no meeting chips on a phone.
      expect(document.querySelector('.gsd-fmt--gallery')).not.toBeNull();
      expect(screen.queryByText('Planning a…')).toBeNull();
      expect(names()).toEqual(['call-and-answer', 'trivia', 'poll']);
      fireEvent.click(screen.getByRole('button', { name: /Wavelength, Survey/ }));
      expect(names().length).toBe(5);
      expect(screen.getByRole('button', { name: /^Create$/ })).toBeInTheDocument();
      expect(document.querySelector('.new-game-dialog')).toHaveClass('gsd--phone');
      unmount();
      // A last format past the fold is still drawn, so the keyboard can land on it.
      render(<GameSetupDialog {...base()} hasCreated lastFormat="survey" />);
      expect(names()).toEqual(['call-and-answer', 'trivia', 'poll', 'survey']);
      expect(radio('Survey').tabIndex).toBe(0);
    } finally { window.matchMedia = before; }
  });
});

describe('round 2: focus home, the sessions dialog, icons', () => {
  /* H4 remainder (devtest 6): the host page swaps its whole tree for the
     dialog, so the button that opened it is unmounted — and a fresh one
     mounted on close. Focus must land on that fresh button. */
  function Page({ withWork = false }) {
    const [open, setOpen] = useState(false);
    if (!open) return <button type="button" className="wel-action is-primary" onClick={() => setOpen(true)}>Create engagement</button>;
    return <GameSetupDialog {...base({ onCancel: () => setOpen(false) })} initialFormat={withWork ? 'call-and-answer' : ''} />;
  }
  test.each([
    ['the X on a clean form', (s) => fireEvent.click(s.getByRole('button', { name: /close without creating/i }))],
    ['Cancel on a clean form', (s) => fireEvent.click(s.getByRole('button', { name: /^cancel$/i }))],
    ['Escape on a clean form', () => fireEvent.keyDown(document, { key: 'Escape' })],
  ])('closing by %s returns focus to the button that opened it', (_, close) => {
    render(<Page />);
    const opener = screen.getByRole('button', { name: 'Create engagement' });
    opener.focus();
    fireEvent.click(opener);
    close(screen);
    expect(screen.getByRole('button', { name: 'Create engagement' })).toHaveFocus();
  });

  test('Discard, after work in hand, returns focus to the opener too', () => {
    render(<Page withWork />);
    const opener = screen.getByRole('button', { name: 'Create engagement' });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.click(radio('Trivia'));
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^discard$/i }));
    expect(screen.getByRole('button', { name: 'Create engagement' })).toHaveFocus();
  });

  test('N2: "Your sessions" goes through the shared Modal, labelled by its heading, focus moved in', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'GameHostPage.jsx'), 'utf8');
    const at = src.indexOf('contentClassName="new-game-dialog reports-modal"');
    expect(at).toBeGreaterThan(-1);
    const block = src.slice(src.lastIndexOf('<Modal', at), at + 400);
    expect(block).toMatch(/labelledBy="shist-title"/);
    expect(block).toMatch(/initialFocus="#shist-title"/);
    expect(block).toMatch(/onClose=\{closeHistory\}/);
  });

  test('N2: with Modal, the sessions list is a named dialog, its heading takes focus, Esc closes', () => {
    const onClose = jest.fn();
    render(
      <Modal overlayClassName="new-game-overlay" contentClassName="new-game-dialog reports-modal"
        labelledBy="shist-title" onClose={onClose} closeOnBackdrop={false} initialFocus="#shist-title">
        <SessionHistoryPanel sessions={[]} questionSets={[]} mode="select" onClose={onClose} />
      </Modal>,
    );
    expect(screen.getByRole('dialog', { name: /Your sessions/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Your sessions/ })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  test('N1/N3: on a phone the sessions list is cards; names wrap with their full text in title=', () => {
    const css = require('fs').readFileSync(require('path').join(__dirname, '..', 'components', 'SessionHistoryPanel.css'), 'utf8');
    const phone = css.slice(css.lastIndexOf('@media (max-width: 600px)'));
    expect(phone).toMatch(/\.shist \.shist__tbl tr \{[^}]*display:\s*flex/);
    expect(phone).toMatch(/\.shist \.shist__btn \{[^}]*min-height:\s*44px/);
    expect(css).toMatch(/\.shist \.shist__nm \{[^}]*white-space:\s*normal/);
    render(<SessionHistoryPanel sessions={[{ gameId: '7158', title: 'UX QA — Round 2 speed run', gameType: 'trivia', byMe: true, createdAt: '2026-10-30T09:00:00Z' }]} questionSets={[]} mode="select" />);
    expect(screen.getByText('UX QA — Round 2 speed run').closest('.shist__nm')).toHaveAttribute('title', 'UX QA — Round 2 speed run');
    expect(screen.getByRole('columnheader', { name: 'Actions' })).toBeInTheDocument();
  });

  test('L5: a decorative icon is hidden from assistive tech; a named one is not', () => {
    const { container } = render(<><Icon name="Check" /><Icon name="Info" aria-label="About" /></>);
    const svgs = container.querySelectorAll('svg');
    expect(svgs[0]).toHaveAttribute('aria-hidden', 'true');
    expect(svgs[1]).not.toHaveAttribute('aria-hidden');
  });
});

describe('round 3: discard means discard, the drawer pushes, focus home from the sessions list', () => {
  const readCss = (file) => require('fs').readFileSync(require('path').join(__dirname, '..', 'components', file), 'utf8');

  /* devtest 7 R1 / devtest 8 R3-2: the title is the page's in create mode.
     The page here owns it exactly as GameHostPage does. */
  function TitlePage() {
    const [open, setOpen] = useState(false);
    const [title, setTitle] = useState('');
    if (!open) return <button type="button" className="wel-action is-primary" onClick={() => setOpen(true)}>Create engagement</button>;
    return (
      <GameSetupDialog
        {...base({ onCancel: () => setOpen(false) })}
        eventTitle={title}
        onEventTitleChange={setTitle}
        initialFormat=""
      />
    );
  }

  test('R1: × then Discard empties the title; reopening starts blank and new typing does not append', () => {
    render(<TitlePage />);
    fireEvent.click(screen.getByRole('button', { name: 'Create engagement' }));
    fireEvent.change(screen.getByLabelText(/name it/i), { target: { value: 'probe — not saved' } });
    fireEvent.click(screen.getByRole('button', { name: /close without creating/i }));
    fireEvent.click(screen.getByRole('button', { name: /^discard$/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Create engagement' }));
    expect(screen.getByLabelText(/name it/i)).toHaveValue('');
    fireEvent.change(screen.getByLabelText(/name it/i), { target: { value: 'Draft B' } });
    expect(screen.getByLabelText(/name it/i)).toHaveValue('Draft B');
  });

  test('R1: Discard in create mode tells the page to empty the title before closing', () => {
    const onEventTitleChange = jest.fn();
    const onCancel = jest.fn();
    const { rerender } = render(<GameSetupDialog {...base({ onEventTitleChange, onCancel, eventTitle: '' })} initialFormat="" />);
    rerender(<GameSetupDialog {...base({ onEventTitleChange, onCancel, eventTitle: 'Draft A' })} initialFormat="" />);
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^discard$/i }));
    expect(onEventTitleChange).toHaveBeenLastCalledWith('');
    expect(onCancel).toHaveBeenCalled();
  });

  test('R1: the page empties its title on every close of New engagement', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'GameHostPage.jsx'), 'utf8');
    const at = src.indexOf('onEventTitleChange={setEventTitle}');
    const block = src.slice(at, src.indexOf('onCreate={handleStartNewGame}', at));
    expect(block).toMatch(/onCancel=\{\(\) => \{[^}]*setEventTitle\(''\)/);
  });

  test('R3-1: with the walkthrough beside the form every format chip is in the form column and can be chosen', () => {
    render(<GameSetupDialog {...base()} hasCreated lastFormat="call-and-answer" initialFormat="call-and-answer" onChooseOther={jest.fn()} />);
    const pane = screen.getByRole('complementary', { name: 'How it runs' });
    const radios = within(screen.getByRole('radiogroup', { name: /format/i })).getAllByRole('radio');
    expect(radios.length).toBeGreaterThanOrEqual(6);
    // By format id, re-found each time: a hand-off folds the gallery to chips.
    const ids = radios.map((r) => r.getAttribute('data-format'));
    ids.forEach((id) => {
      const r = () => document.querySelector(`[role="radio"][data-format="${id}"]`);
      expect(pane.contains(r())).toBe(false);
      fireEvent.click(r());
      expect(r()).toHaveAttribute('aria-checked', 'true');
    });
    // The pane is a grid column beside the form, never laid over it.
    expect(document.querySelector('.gsd-body')).toHaveClass('has-side');
  });

  /* devtest 8 R3-3: the start screen can draw its Sessions button after the
     list closes, not in the same commit. Focus must still find it. */
  function SessionsPage() {
    const [open, setOpen] = useState(false);
    const [welcome, setWelcome] = useState(true);
    if (open) {
      return (
        <Modal overlayClassName="new-game-overlay" contentClassName="new-game-dialog reports-modal"
          labelledBy="shist-title" onClose={() => { setOpen(false); setTimeout(() => setWelcome(true), 30); }}
          closeOnBackdrop={false} initialFocus="#shist-title">
          <SessionHistoryPanel sessions={[]} questionSets={[]} mode="select" />
        </Modal>
      );
    }
    if (!welcome) return <p>Loading…</p>;
    return (
      <>
        <button type="button" className="wel-btn wel-btn-line">Question sets</button>
        <button type="button" className="wel-btn wel-btn-line" onClick={() => { setWelcome(false); setOpen(true); }}>Sessions</button>
      </>
    );
  }

  test('R3-3: Esc on Your sessions returns focus to the Sessions button, even when it is drawn late', async () => {
    render(<SessionsPage />);
    const opener = screen.getByRole('button', { name: 'Sessions' });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole('heading', { name: /Your sessions/ })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sessions' })).toHaveFocus());
  });

  test('R2: one blue focus ring in Your sessions, and none drawn round the heading', () => {
    const css = readCss('SessionHistoryPanel.css');
    const ring = css.slice(css.lastIndexOf('.shist button:focus-visible'));
    expect(ring).toMatch(/^[^}]*\.shist input:focus-visible[^}]*\.shist select:focus-visible[^}]*outline:\s*2px solid var\(--info\)/);
    expect(css).toMatch(/\.shist \.shist__title:focus \{[^}]*outline:\s*none/);
  });

  test('R3-4: on a phone the hidden Owner and Updated columns reserve no width, even in the wide list', () => {
    const css = readCss('SetChooser.css');
    const phone = css.slice(css.lastIndexOf('@media (max-width: 600px)'));
    expect(phone).toMatch(/\.schs\.schs--wide \.schs-tbl \.schs-c-own,\s*\.schs\.schs--wide \.schs-tbl \.schs-c-when \{ width: 0; \}/);
  });

  /* (R3 1366/1280, "the gallery cards drop only their picture", is retired in
     round 4: the gallery cards carry no picture at all.) */
  test('round 4: the gallery cards are text, with no picture to drop', () => {
    render(<GameSetupDialog {...base()} />);
    expect(document.querySelector('.gsd-fmt-art')).toBeNull();
    expect(readCss('GameSetupDialog.css')).not.toMatch(/\.gsd-fmt-art/);
  });
});

describe('after Create, the sessions list says what happened (live dev test B6/C10)', () => {
  const SESSION = {
    gameId: '1224', title: 'UX QA — Retro test', gameType: 'call-and-answer', questionSetId: 'seta',
    hostName: 'Host', byMe: true, started: false, createdAt: '2026-10-30T09:00:00Z', state: 'CREATED',
  };
  test('a confirmation with the code and the next step, Start on that row, the set by name, no "host Host"', () => {
    const onStart = jest.fn();
    render(<SessionHistoryPanel sessions={[SESSION]} questionSets={SETS} mode="select" onStart={onStart}
      done={{ gameId: '1224', title: 'UX QA — Retro test', verb: 'created' }} />);
    const done = screen.getByTestId('shist-done');
    expect(done).toHaveTextContent('Created “UX QA — Retro test”. Its code is 1224.');
    expect(done).toHaveTextContent(/nobody can join until you press Start/);
    fireEvent.click(within(done).getByRole('button', { name: /Start it now/ }));
    // (gameId, title), as the row's own Start calls it — never the row object
    // (issue #48 finding 1: POST /games/[object Object]/start).
    expect(onStart).toHaveBeenCalledWith('1224', 'UX QA — Retro test');
    expect(screen.getByText(/Set: Lessons from Different Schools/)).toBeInTheDocument();
    expect(screen.queryByText(/host Host/)).toBeNull();
  });
});

describe('the routes open straight into their builder (HostQuestionSetsDialog initialRoute)', () => {
  test('template and manual open the New question set panel; no route opens the shelf', async () => {
    const { unmount } = render(<HostQuestionSetsDialog engagementType="trivia" initialRoute="template" onClose={jest.fn()} />);
    expect(await screen.findByText('New question set', { selector: 'h3, h4, h2, legend, span, div' })).toBeInTheDocument();
    unmount();
    render(<HostQuestionSetsDialog engagementType="trivia" onClose={jest.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /New question set/ })).toBeInTheDocument());
    expect(screen.queryByText('How do you want to make it?')).toBeNull();
  });
});

describe('no set fits', () => {
  test('the no-match state offers the three make-your-own routes after the exits', () => {
    render(<GameSetupDialog {...base()} initialFormat="call-and-answer" />);
    fireEvent.click(screen.getByRole('button', { name: /Browse all/ }));
    fireEvent.change(screen.getByRole('combobox', { name: /Search 2 Call & Answer sets/ }), { target: { value: 'retro' } });
    const routes = screen.getByTestId('set-chooser-routes');
    expect(within(routes).getByRole('button', { name: /Write your own questions/ })).toBeInTheDocument();
    expect(within(routes).getByRole('button', { name: /Make a set with Workie/ })).toBeInTheDocument();
    expect(within(routes).getByRole('button', { name: /Fill in a spreadsheet/ })).toBeInTheDocument();
  });
});

/*
  ── ROUND 4: SHOW THE NEXT DECISION, NOT ALL OF THEM ─────────────────────
  docs/design/new-engagement README "Round 4" (the reveal rules table, Motion,
  Focus, Announcements, Create pressed early) and reviews/round-4.md. The
  owner approved Fork 1 A (a quiet pane from the start) and Fork 2 A (one rule
  for every host; history only preselects the last format).
*/
describe('round 4: the reveal rules', () => {
  const setHeading = () => screen.queryByRole('heading', { name: 'Question set' });
  const advanced = () => document.querySelector('details.gsd-adv');

  test('the title reveals nothing: typing it leaves the form as it was, and only the foot changes', () => {
    const props = base({ eventTitle: '' });
    const { rerender } = render(<GameSetupDialog {...props} />);
    expect(need()).toHaveTextContent('Still needed: a title, a format and a question set.');
    rerender(<GameSetupDialog {...props} eventTitle="Team retro" />);
    expect(setHeading()).toBeNull();
    expect(need()).toHaveTextContent('Still needed: a format and a question set.');
    expect(live().textContent).toBe('');
  });

  test('choosing a format reveals Question set, says so once, and does not move the focus', () => {
    render(<GameSetupDialog {...base()} />);
    expect(setHeading()).toBeNull();
    const ca = radio('Call & Answer');
    ca.focus();
    fireEvent.keyDown(ca, { key: ' ' });
    expect(setHeading()).toBeInTheDocument();
    // A section with its own heading, so heading navigation finds it (A3).
    expect(setHeading().closest('section')).toHaveAttribute('aria-labelledby', 'gsd-set-label');
    expect(live().textContent).toBe('Question set is below.');
    // rejects: a reveal that takes the focus away from the control just used
    expect(ca).toHaveFocus();
    expect(need()).toHaveTextContent('Still needed: a question set.');
  });

  // rejects: "Question set added below" on every arrow (review A2)
  test('arrowing through the formats announces the reveal once, not on every arrow', () => {
    render(<GameSetupDialog {...base()} />);
    fireEvent.click(radio('Call & Answer'));
    expect(live().textContent).toBe('Question set is below.');
    fireEvent.keyDown(radio('Call & Answer'), { key: 'ArrowRight' });
    expect(radio('Trivia')).toHaveAttribute('aria-checked', 'true');
    expect(live().textContent).toBe('');
    fireEvent.keyDown(radio('Trivia'), { key: 'ArrowLeft' });
    expect(live().textContent).toBe('');
    expect(setHeading()).toBeInTheDocument();
  });

  test('picking a set reveals the names card, Background for Workie and Advanced — not before', () => {
    render(<GameSetupDialog {...base()} initialFormat="call-and-answer" />);
    expect(setHeading()).toBeInTheDocument();
    expect(screen.queryByTestId('gsd-namesline')).toBeNull();
    expect(document.querySelector('details.gsd-brief-fold')).toBeNull();
    expect(advanced()).toBeNull();
    pickSet(KEY_B);
    expect(screen.getByTestId('gsd-namesline')).toHaveTextContent('Names are hidden until the vote closes');
    expect(document.querySelector('details.gsd-brief-fold')).not.toBeNull();
    expect(advanced()).not.toBeNull();
    // Nothing is said: they arrive below the set just picked (README, Announcements).
    expect(live().textContent).toBe('');
  });

  test('once shown they stay: switching format keeps Advanced, and each section shows only where it applies', () => {
    render(<GameSetupDialog {...base()} initialFormat="call-and-answer" />);
    pickSet(KEY_B);
    fireEvent.click(radio('Trivia'));
    expect(chosenSet()).toBe('');                 // a set belongs to one format
    expect(advanced()).not.toBeNull();            // …but what was revealed stays
    expect(screen.queryByTestId('gsd-namesline')).toBeNull(); // no names card for Trivia, as before
    expect(document.querySelector('details.gsd-brief-fold')).toBeNull();
    fireEvent.click(radio('Survey'));
    expect(screen.getByTestId('gsd-namesline')).toHaveTextContent(/Names:/);
    fireEvent.click(radio('Call & Answer'));
    expect(screen.getByTestId('gsd-namesline')).toHaveTextContent('Names are hidden until the vote closes');
    expect(document.querySelector('details.gsd-brief-fold')).not.toBeNull();
  });

  test('Build Room puts "Next:" in the set\'s slot and says so once per swap; going back restores the set', () => {
    render(<GameSetupDialog {...base({ onChooseOther: jest.fn() })} eventsAccess={{ enabled: true, canCreate: true }} initialFormat="call-and-answer" />);
    pickSet(KEY_B);
    fireEvent.click(radio('Build Room'));
    expect(setHeading()).toBeNull();
    const next = screen.getByRole('heading', { name: 'Next: the Build Room page' });
    expect(next.closest('[data-reveal="set"]')).not.toBeNull(); // the same slot
    expect(live().textContent).toBe('Next: the Build Room page, below.');
    expect(advanced()).toBeNull();                // hidden with the set
    fireEvent.click(radio('Event'));
    expect(screen.getByRole('heading', { name: 'Next: the event page' })).toBeInTheDocument();
    expect(live().textContent).toBe('Next: the event page, below.');
    fireEvent.click(radio('Call & Answer'));
    expect(chosenSet()).toBe(KEY_B);              // setByFormat, shipped
    expect(advanced()).not.toBeNull();            // and the options come back with it
    expect(live().textContent).toBe('');          // nothing new to say
  });

  /* Revision, 31 Oct: replaces "a host with history opens two decisions in". */
  test('a host with history opens no decisions in: no format, no Question set; choosing one reveals it with the recents', () => {
    render(<GameSetupDialog {...base()} hasCreated lastFormat="call-and-answer" recentSetUses={new Map([[KEY_B, Date.now()]])} />);
    expect(radio('Call & Answer')).toHaveAttribute('aria-checked', 'false');
    expect(setHeading()).toBeNull();
    expect(screen.queryByRole('listbox', { name: 'Used by you lately' })).toBeNull();
    expect(screen.getByTestId('gsd-wt-example')).toBeInTheDocument();
    fireEvent.click(radio('Call & Answer'));
    expect(setHeading()).toBeInTheDocument();
    expect(live().textContent).toBe('Question set is below.');
    expect(screen.getByRole('listbox', { name: 'Used by you lately' })).toBeInTheDocument();
    expect(screen.queryByTestId('gsd-namesline')).toBeNull();
    expect(advanced()).toBeNull();
    // The one-line explanation of a set is for a host with nothing used lately.
    expect(screen.queryByText(/The questions you will ask/)).toBeNull();
  });

  test('a first-timer with nothing used lately gets one line on what a set is, and Browse all beside the search', () => {
    render(<GameSetupDialog {...base()} />);
    fireEvent.click(radio('Call & Answer'));
    expect(screen.getByText('The questions you will ask. Start from a ready-made set; you can switch topics off once it is picked.')).toBeInTheDocument();
    const search = screen.getByRole('combobox', { name: /choose a question set/i });
    expect(search.closest('.schs-searchrow')).toContainElement(screen.getByRole('button', { name: 'Browse all 2 sets' }));
  });

  test('an edit shows everything from the start, with no entrance', () => {
    render(<GameSetupDialog {...base()} mode="edit" initialValues={{ gameType: 'call-and-answer', title: 'Retro', questionSetId: 'setb' }} />);
    expect(setHeading()).toBeInTheDocument();
    expect(screen.getByTestId('gsd-namesline')).toBeInTheDocument();
    expect(document.querySelector('details.gsd-brief-fold')).not.toBeNull();
    expect(advanced()).not.toBeNull();
    expect(document.querySelector('.gsd-reveal')).toBeNull();
    expect(screen.queryByText(/Still needed/)).toBeNull();
  });

  test('no step numbers, no ticks, no status line and no OPTIONAL header', () => {
    render(<GameSetupDialog {...base()} initialFormat="call-and-answer" initialSetId="setb" />);
    expect(document.querySelector('.gsd-step-n')).toBeNull();
    expect(document.querySelector('.gsd-stat')).toBeNull();
    expect(document.querySelector('.gsd-optional-h')).toBeNull();
    expect(screen.queryByRole('list', { name: 'Your decisions' })).toBeNull();
    // The title's help sits in the heading row beside its label.
    expect(document.querySelector('.gsd-title-row')).toContainElement(document.getElementById('gsd-title-help'));
  });
});

describe('round 4: the entrance', () => {
  test('a revealed section fades in once; swapping its contents later never plays it again', () => {
    jest.useFakeTimers();
    try {
      render(<GameSetupDialog {...base({ onChooseOther: jest.fn() })} />);
      fireEvent.click(radio('Call & Answer'));
      expect(document.querySelector('[data-reveal="set"]')).toHaveClass('gsd-reveal');
      act(() => { jest.advanceTimersByTime(500); });
      expect(document.querySelector('[data-reveal="set"]')).not.toHaveClass('gsd-reveal');
      // A format change, and a hand-off and back: the contents swap, no entrance.
      fireEvent.click(radio('Trivia'));
      expect(document.querySelector('[data-reveal="set"]')).not.toHaveClass('gsd-reveal');
      fireEvent.click(radio('Build Room'));
      fireEvent.click(radio('Call & Answer'));
      expect(document.querySelector('.gsd-reveal')).toBeNull();
    } finally { jest.useRealTimers(); }
  });

  test('the options fade in on the first set pick, and not again after a hand-off and back', () => {
    jest.useFakeTimers();
    try {
      render(<GameSetupDialog {...base({ onChooseOther: jest.fn() })} initialFormat="call-and-answer" />);
      pickSet(KEY_B);
      expect(document.querySelector('[data-reveal="after"]')).toHaveClass('gsd-reveal');
      act(() => { jest.advanceTimersByTime(500); });
      fireEvent.click(radio('Build Room'));
      expect(document.querySelector('[data-reveal="after"]')).toBeNull();
      fireEvent.click(radio('Call & Answer'));
      expect(document.querySelector('[data-reveal="after"]')).not.toHaveClass('gsd-reveal');
    } finally { jest.useRealTimers(); }
  });

  test('under prefers-reduced-motion there is no entrance at all', () => {
    const before = window.matchMedia;
    window.matchMedia = (q) => ({ matches: /prefers-reduced-motion: reduce/.test(q), media: q, addEventListener() {}, removeEventListener() {} });
    try {
      render(<GameSetupDialog {...base()} />);
      fireEvent.click(radio('Call & Answer'));
      expect(screen.getByRole('heading', { name: 'Question set' })).toBeInTheDocument();
      expect(document.querySelector('.gsd-reveal')).toBeNull();
    } finally { window.matchMedia = before; }
  });
});

describe('round 4: Create is never inert', () => {
  test('it is a tab stop while not ready, described by the foot\'s "Still needed", which is not live', () => {
    render(<GameSetupDialog {...base({ eventTitle: '' })} />);
    const create = createButton();
    notReady(create);
    expect(create.tabIndex).toBe(0);
    const need = document.getElementById('gsd-need');
    expect(need).toHaveTextContent('Still needed: a title, a format and a question set.');
    expect(create.getAttribute('aria-describedby').split(' ')).toContain('gsd-need');
    // rejects: a reason that speaks on every keystroke (review A5)
    expect(need).not.toHaveAttribute('aria-live');
    expect(need.closest('[aria-live]')).toBeNull();
  });

  test('pressed early it takes the focus to the first gap — title, then format, then set — and says which', async () => {
    const props = base({ eventTitle: '' });
    const { rerender } = render(<GameSetupDialog {...props} />);
    fireEvent.click(createButton());
    await waitFor(() => expect(screen.getByLabelText(/name it/i)).toHaveFocus());
    expect(live().textContent).toBe('Add a title first.');
    expect(props.onCreate).not.toHaveBeenCalled();

    rerender(<GameSetupDialog {...props} eventTitle="Retro" />);
    fireEvent.click(createButton());
    expect(radio('Call & Answer')).toHaveFocus(); // the group's one tab stop
    expect(live().textContent).toBe('Pick a format first.');

    fireEvent.click(radio('Call & Answer'));
    fireEvent.click(createButton());
    expect(screen.getByRole('combobox', { name: /choose a question set/i })).toHaveFocus();
    expect(live().textContent).toBe('Pick a question set first.');
    expect(props.onCreate).not.toHaveBeenCalled();
  });

  test('⌘/Ctrl+Enter early takes the same path', () => {
    const props = base({ eventTitle: 'Retro' });
    render(<GameSetupDialog {...props} />);
    fireEvent.keyDown(screen.getByLabelText(/name it/i), { key: 'Enter', ctrlKey: true });
    expect(radio('Call & Answer')).toHaveFocus();
    expect(live().textContent).toBe('Pick a format first.');
    expect(props.onCreate).not.toHaveBeenCalled();
  });

  test('pressed while only the topics are loading, it queues the create, as ⌘↵ does', () => {
    const onCreate = jest.fn();
    render(<PageHarness onCreate={onCreate} />);
    pickSet(KEY_B);
    fireEvent.click(createButton());
    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Waiting for topics…' })).toBeInTheDocument();
    PageHarness.answer(KEY_B, B);
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  test('ready: the foot says nobody can join until it starts, and Create fills', () => {
    render(<GameSetupDialog {...base()} initialFormat="call-and-answer" initialSetId="setb" />);
    expect(screen.queryByText(/Still needed/)).toBeNull();
    expect(screen.getByText('Nobody can join until you start it.')).toBeInTheDocument();
    expect(createButton()).not.toHaveAttribute('aria-disabled');
  });
});
