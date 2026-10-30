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
      lastFormat="call-and-answer"
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
const createButton = () => screen.getByRole('button', { name: /create engagement|loading topics/i });

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
    expect(createButton()).toBeDisabled();
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
    expect(button).toBeDisabled();
    PageHarness.answer(KEY_B, B);
    expect(screen.getByRole('button', { name: 'Create engagement' })).toBeEnabled();
  });

  test('Create never sends one set\'s topics for another', () => {
    const onCreate = jest.fn();
    const { rerender } = render(<GameSetupDialog {...base({ onCreate })} lastFormat="call-and-answer" categories={B}
      activeCategoryIds={new Set(['Architecture', 'Pricing'])} categoryStatus={{ key: '', loading: false, error: '' }} />);
    pickSet(KEY_B);
    // The page says B's list is in, but the selection still holds a name from A.
    rerender(<GameSetupDialog {...base({ onCreate })} lastFormat="call-and-answer" categories={B}
      activeCategoryIds={new Set(['Architecture', 'Pricing'])} categoryStatus={{ key: KEY_B, loading: false, error: '' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create engagement' }));
    expect(onCreate.mock.calls[0][0].categoryIds).toEqual(['Pricing']);
  });

  test('opening Change unmounts the topics, and "Keep the set I had" brings back the same selection', () => {
    render(<GameSetupDialog {...base()} lastFormat="call-and-answer" categories={A}
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
  test('nothing is chosen, step 3 is visible but waits, and Create is disabled', () => {
    render(<GameSetupDialog {...base()} />);
    const group = screen.getByRole('radiogroup', { name: /pick a format/i });
    expect(within(group).getAllByRole('radio').every((r) => r.getAttribute('aria-checked') === 'false')).toBe(true);
    expect(screen.getByText(/Choose a format first/)).toBeInTheDocument();
    expect(createButton()).toBeDisabled();
    expect(document.querySelector('.new-game-dialog')).toHaveClass('gsd--full');
    // The gallery says what each format is good for, and which continue elsewhere.
    expect(screen.getByText('Good for: Retros, brainstorms.')).toBeInTheDocument();
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
    expect(screen.getByText(/what went well, what should change/)).toBeInTheDocument();
  });

  test('Compare shows every format side by side; "Use Trivia" returns to the form with Trivia', () => {
    render(<GameSetupDialog {...base()} />);
    fireEvent.click(screen.getByRole('button', { name: /compare side by side/i }));
    const table = within(screen.getByTestId('gsd-compare')).getByRole('table');
    expect(within(table).getByRole('rowheader', { name: 'Pace' })).toBeInTheDocument();
    expect(within(table).getByText(/Opens to answers the moment you create it/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Use Trivia' }));
    expect(screen.queryByTestId('gsd-compare')).toBeNull();
    expect(radio('Trivia')).toHaveAttribute('aria-checked', 'true');
  });

  test('"I know these" switches to compact and remembers it in this browser', () => {
    window.localStorage.clear();
    render(<GameSetupDialog {...base()} />);
    fireEvent.click(screen.getByRole('button', { name: /I know these/ }));
    expect(document.querySelector('.new-game-dialog')).toHaveClass('gsd--compact');
    expect(window.localStorage.getItem('engage.newEngagement.layout')).toBe('compact');
    window.localStorage.clear();
  });

  test('blocked storage changes nothing: the dialog still opens and switches', () => {
    const spy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const spySet = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    try {
      render(<GameSetupDialog {...base()} />);
      fireEvent.click(screen.getByRole('button', { name: /I know these/ }));
      expect(document.querySelector('.new-game-dialog')).toHaveClass('gsd--compact');
    } finally { spy.mockRestore(); spySet.mockRestore(); }
  });
});

describe('a host with history', () => {
  test('opens compact with the last format chosen and marked, and no side pane', () => {
    render(<GameSetupDialog {...base()} hasCreated lastFormat="trivia" />);
    expect(document.querySelector('.new-game-dialog')).toHaveClass('gsd--compact');
    expect(radio('Trivia')).toHaveAttribute('aria-checked', 'true');
    expect(radio('Trivia').closest('button').textContent).toMatch('last used');
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(screen.queryByText(/Three decisions\. Everything else/)).toBeNull();
    // ⌘ on a Mac, Ctrl elsewhere — jsdom is not a Mac.
    expect(screen.getByRole('button', { name: /create engagement/i })).toHaveAttribute('aria-keyshortcuts', 'Meta+Enter Control+Enter');
  });

  test('the history read landing after open chooses the last format, and is not "work in hand"', () => {
    const props = base();
    const { rerender } = render(<GameSetupDialog {...props} />);
    rerender(<GameSetupDialog {...props} hasCreated lastFormat="trivia" />);
    expect(radio('Trivia')).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('button', { name: /close without creating/i }));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  test('the recents are one click away, and a Tab into the search does not open the full chooser', () => {
    const props = base();
    render(<GameSetupDialog {...props} hasCreated lastFormat="call-and-answer" recentSetUses={new Map([[KEY_B, Date.now()]])} />);
    fireEvent.focus(screen.getByRole('combobox', { name: /choose a question set/i }));
    expect(screen.queryByTestId('set-chooser-row')).toBeNull();
    fireEvent.click(within(screen.getByRole('listbox', { name: 'Used by you lately' })).getByRole('option'));
    expect(props.onQuestionSetChange).toHaveBeenLastCalledWith('setb', 'platform');
  });
});

describe('the format radio group', () => {
  test('exactly one tab stop, and the arrow keys move and choose', () => {
    render(<GameSetupDialog {...base()} lastFormat="call-and-answer" />);
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
    render(<GameSetupDialog {...props} hasCreated lastFormat="call-and-answer" />);
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
    const { rerender } = render(<GameSetupDialog {...props} lastFormat="call-and-answer" />);
    pickSet(KEY_B);
    fireEvent.keyDown(screen.getByLabelText(/name it/i), { key: 'Enter', ctrlKey: true });
    expect(props.onCreate).not.toHaveBeenCalled(); // no title yet
    rerender(<GameSetupDialog {...props} eventTitle="Retro" lastFormat="call-and-answer" />);
    fireEvent.keyDown(screen.getByLabelText(/name it/i), { key: 'Enter', metaKey: true });
    expect(props.onCreate).toHaveBeenCalledTimes(1);
  });

  test('on Build Room it moves the focus to Continue and never leaves on its own', () => {
    const onChooseOther = jest.fn();
    render(<GameSetupDialog {...base({ onChooseOther })} lastFormat="call-and-answer" />);
    fireEvent.click(radio('Build Room'));
    fireEvent.keyDown(screen.getByLabelText(/name it/i), { key: 'Enter', ctrlKey: true });
    expect(onChooseOther).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Set up the Build Room' })).toHaveFocus();
    expect(screen.getByText(/moves to Continue; press Enter there to go/)).toBeInTheDocument();
  });
});

describe('the hand-offs and the survey', () => {
  test('a survey says people can answer as soon as it opens, and the button opens it', () => {
    render(<GameSetupDialog {...base()} lastFormat="survey" />);
    expect(screen.getByText(/People can answer as soon as you open it\. There is no separate Start\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open the survey' })).toBeInTheDocument();
    expect(screen.getByText('Collect')).toBeInTheDocument();
  });

  test('Event on the Free plan replaces the price line with the plan, and Continue is disabled', () => {
    render(<GameSetupDialog {...base({ onChooseOther: jest.fn() })} lastFormat="call-and-answer"
      eventsAccess={{ enabled: true, canCreate: false, offerPlanName: 'Standard plan' }} />);
    fireEvent.click(radio('Event'));
    expect(screen.getByTestId('gsd-event-plan')).toHaveTextContent('Events come with the Standard plan.');
    expect(screen.queryByTestId('gsd-event-price')).toBeNull();
    expect(screen.getByRole('button', { name: 'Continue to the event' })).toBeDisabled();
  });

  test('Event on a paid plan states the price', () => {
    render(<GameSetupDialog {...base({ onChooseOther: jest.fn() })} lastFormat="call-and-answer"
      eventsAccess={{ enabled: true, canCreate: true, offerPlanName: '' }} />);
    fireEvent.click(radio('Event'));
    expect(screen.getByTestId('gsd-event-price')).toHaveTextContent(/an event, counted when it first goes live/);
  });
});

describe('names and Workie, said plainly', () => {
  test('Call & Answer states the names rule beside the questions, and Change opens it', () => {
    render(<GameSetupDialog {...base()} lastFormat="call-and-answer" />);
    expect(screen.getByTestId('gsd-namesline')).toHaveTextContent('Names are hidden until the vote closes');
    fireEvent.click(screen.getByRole('button', { name: 'Change how names are shown' }));
    expect(document.querySelector('details.gsd-adv').open).toBe(true);
    expect(screen.getByRole('checkbox', { name: /anonymous responses/i })).toHaveFocus();
  });

  test('Workie is introduced in one line', () => {
    render(<GameSetupDialog {...base()} lastFormat="call-and-answer" />);
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
    render(<GameSetupDialog {...base({ onCreate })} hasCreated lastFormat="call-and-answer"
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
    render(<GameSetupDialog {...base({ onCreate })} lastFormat="call-and-answer" />);
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
    render(<GameSetupDialog {...base({ onChooseOther: jest.fn() })} lastFormat="call-and-answer"
      eventsAccess={{ enabled: true, canCreate: false, offerPlanName: 'Standard plan' }} />);
    fireEvent.click(radio('Event'));
    fireEvent.keyDown(screen.getByLabelText(/name it/i), { key: 'Enter', ctrlKey: true });
    expect(screen.getByText(/Events come with the Standard plan, so there is nothing to continue to/)).toBeInTheDocument();
    expect(screen.queryByText(/moved to Continue/)).toBeNull();
  });

  test('B4: "Use Trivia" in Compare lets go of the Retro chip and its line', () => {
    render(<GameSetupDialog {...base()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retro' }));
    fireEvent.click(screen.getByRole('button', { name: /compare side by side/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Use Trivia' }));
    expect(screen.getByRole('button', { name: 'Retro' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByText(/For a retro/)).toBeNull();
    expect(radio('Trivia')).toHaveFocus();
  });

  test('H4: Compare takes the focus to its heading, and Back returns it to the link', () => {
    render(<GameSetupDialog {...base()} />);
    fireEvent.click(screen.getByRole('button', { name: /compare side by side/i }));
    expect(screen.getByRole('heading', { name: 'Compare the formats' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: /back to the form/i }));
    expect(screen.getByRole('button', { name: /compare side by side/i })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: /compare side by side/i }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('button', { name: /compare side by side/i })).toHaveFocus();
  });

  test('B5: Esc in the empty set search does not ask to discard; the discard bar goes when the host goes back to the form', () => {
    const props = base();
    render(<GameSetupDialog {...props} lastFormat="call-and-answer" />);
    fireEvent.keyDown(screen.getByRole('combobox', { name: /choose a question set/i }), { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    fireEvent.change(screen.getByLabelText(/event details/i), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole('button', { name: /Browse all/ }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByRole('button', { name: /create engagement/i })).toBeInTheDocument();
  });

  test('B7: compact draws no pinned summary row over the topics', () => {
    render(<GameSetupDialog {...base()} hasCreated lastFormat="call-and-answer" categories={A}
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

  test('E8: compact "Show preview" adds only the side pane, not the beginner guide', () => {
    render(<GameSetupDialog {...base()} hasCreated lastFormat="call-and-answer" />);
    fireEvent.click(screen.getByRole('button', { name: /show preview/i }));
    expect(screen.getByRole('complementary')).toBeInTheDocument();
    expect(document.querySelector('.new-game-dialog')).toHaveClass('gsd--compact');
    expect(screen.queryByText(/Planning a/)).toBeNull();
    expect(screen.queryByText(/Three decisions\. Everything else/)).toBeNull();
    expect(screen.getByRole('button', { name: /hide preview/i })).toHaveAttribute('aria-pressed', 'true');
  });

  test('O3/E4: compact has no blurb, and Tab from the title reaches the formats before Format guide', () => {
    render(<GameSetupDialog {...base()} hasCreated lastFormat="call-and-answer" />);
    expect(screen.queryByText(/Open responses, then the room votes/)).toBeNull();
    const all = Array.from(document.querySelectorAll('button, input, [tabindex]'))
      .filter((el) => el.tabIndex >= 0 && !el.disabled);
    const fmt = all.indexOf(radio('Call & Answer'));
    const guide = all.indexOf(screen.getByRole('button', { name: /format guide/i }));
    expect(fmt).toBeGreaterThan(-1);
    expect(fmt).toBeLessThan(guide);
  });

  test('B3: "Make a new set" opens the sets dialog on the new-set panel, above the shelf', async () => {
    render(<GameSetupDialog {...base()} lastFormat="call-and-answer" />);
    fireEvent.click(screen.getByRole('button', { name: 'Make a new set' }));
    expect(await screen.findByText('How do you want to make it?')).toBeInTheDocument();
  });

  test('phone (frames 10/10b): formats folded behind More, Create says Create', () => {
    const before = window.matchMedia;
    window.matchMedia = (q) => ({ matches: /max-width: 600px/.test(q), media: q, addEventListener() {}, removeEventListener() {} });
    try {
      render(<GameSetupDialog {...base()} hasCreated lastFormat="call-and-answer" />);
      const group = screen.getByRole('radiogroup', { name: /format/i });
      expect(within(group).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Call & Answerlast used', 'Trivia', 'Poll']);
      fireEvent.click(screen.getByRole('button', { name: /^More/ }));
      expect(within(group).getAllByRole('radio').length).toBe(5);
      expect(screen.getByRole('button', { name: /^Create$/ })).toBeInTheDocument();
      expect(document.querySelector('.new-game-dialog')).toHaveClass('gsd--phone');
    } finally { window.matchMedia = before; }
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
    expect(onStart).toHaveBeenCalledWith(SESSION);
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
    render(<GameSetupDialog {...base()} lastFormat="call-and-answer" />);
    fireEvent.click(screen.getByRole('button', { name: /Browse all/ }));
    fireEvent.change(screen.getByRole('combobox', { name: /Search 2 Call & Answer sets/ }), { target: { value: 'retro' } });
    const routes = screen.getByTestId('set-chooser-routes');
    expect(within(routes).getByRole('button', { name: /Write your own questions/ })).toBeInTheDocument();
    expect(within(routes).getByRole('button', { name: /Make a set with Workie/ })).toBeInTheDocument();
    expect(within(routes).getByRole('button', { name: /Fill in a spreadsheet/ })).toBeInTheDocument();
  });
});
