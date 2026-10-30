/**
 * THE SET CHOOSER (issue #41; docs/design/set-chooser S0-S5).
 * components/SetChooser.jsx on config/setFinder.js.
 */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import SetChooser from '../components/SetChooser';
import { chooserConfig, recentUses, joinTags, splitTags, whenWords } from '../config/setFinder';
import { applyListControls, initialListState } from '../config/listControls';
import { setRefKey } from '../utils/setRef';

const NOW = Date.parse('2026-10-23T12:00:00Z');
const days = (n) => new Date(NOW - n * 86400000).toISOString();
const SETS = [
  { id: 'health', scope: 'org', mine: false, name: 'Team health check', description: 'How the team is doing', totalQuestions: 12, topic: 'business-work', tags: ['team-health', 'retro'], updatedAt: days(20) },
  { id: 'qp', scope: 'org', mine: true, name: 'Quarterly planning priorities', totalQuestions: 8, topic: 'business-work', tags: ['planning'], updatedAt: days(40) },
  { id: 'sprint', scope: 'org', mine: false, name: 'Sprint retro: what went well', totalQuestions: 10, topic: 'business-work', tags: ['retro', 'sprint'], updatedAt: days(3) },
  { id: 'pulse', scope: 'platform', name: 'Pulse: how is the week going?', totalQuestions: 5, topic: 'everyday-life', tags: ['pulse'], updatedAt: days(200) },
  { id: 'road', scope: 'public', name: 'Product roadmap trade-offs', totalQuestions: 9, topic: '', tags: ['roadmap'], updatedAt: days(60) },
];
const RECENT = new Map([[setRefKey(SETS[0]), NOW - 2 * 86400000], [setRefKey(SETS[1]), NOW - 14 * 86400000]]);

function mount(props = {}) {
  const onChange = jest.fn();
  const utils = render(
    <SetChooser sets={SETS} value="" onChange={onChange} recent={RECENT} formatLabel="Poll" teamName="TeamG" now={NOW} {...props} />,
  );
  return { onChange, ...utils };
}
const open = () => fireEvent.focus(screen.getByRole('combobox', { name: /Choose a question set/ }));
const rowNames = () => screen.getAllByTestId('set-chooser-row').map((r) => within(r).getByRole('radio').getAttribute('aria-label'));

describe('the rules (config/setFinder.js)', () => {
  const run = (state) => applyListControls(SETS, chooserConfig({ recent: RECENT, keyOf: setRefKey, now: NOW }), { ...initialListState(chooserConfig()), ...state }).map((s) => s.id);

  test('the search finds a word in the name, the description or a tag', () => {
    expect(run({ search: 'retro' }).sort()).toEqual(['health', 'sprint']);
    expect(run({ search: 'team is doing' })).toEqual(['health']);
  });

  test('several tags: a set with any of them', () => {
    expect(run({ tags: joinTags(['planning', 'pulse']) }).sort()).toEqual(['pulse', 'qp']);
    expect(splitTags('a, b,,c')).toEqual(['a', 'b', 'c']);
  });

  test('the date windows: used by me lately, this week, this month, older than 3 months', () => {
    expect(run({ updated: 'used' }).sort()).toEqual(['health', 'qp']);
    expect(run({ updated: 'week' })).toEqual(['sprint']);
    expect(run({ updated: 'month' }).sort()).toEqual(['health', 'sprint']);
    expect(run({ updated: 'older' })).toEqual(['pulse']);
  });

  test('recently used first, then the newest change', () => {
    expect(run({})).toEqual(['health', 'qp', 'sprint', 'road', 'pulse']);
  });

  test('recent uses come from this host\'s own sessions, the newest use per set', () => {
    const map = recentUses([
      { byMe: true, questionSetId: 'health', questionSetScope: 'org', lastPlayedAt: days(5) },
      { byMe: true, questionSetId: 'health', questionSetScope: 'org', createdAt: days(2) },
      { byMe: false, questionSetId: 'qp', questionSetScope: 'org', createdAt: days(1) },
      { byMe: true, questionSetId: '', createdAt: days(1) },
    ], setRefKey);
    expect([...map.keys()]).toEqual([setRefKey({ id: 'health', scope: 'org' })]);
    expect(map.get(setRefKey({ id: 'health', scope: 'org' }))).toBe(Date.parse(days(2)));
  });

  test('the when-words: used lately, else when it changed', () => {
    expect(whenWords(SETS[0], NOW - 14 * 86400000, NOW)).toBe('used 2 wk ago');
    expect(whenWords(SETS[0], 0, NOW)).toBe('3 wk ago');
  });
});

describe('folded (S0, S1b)', () => {
  test('nothing picked: a search line and the sets used lately, one click each', () => {
    const { onChange } = mount();
    expect(screen.getByRole('combobox', { name: 'Choose a question set: type to search 5 Poll sets' })).toBeInTheDocument();
    expect(screen.queryByTestId('set-chooser-row')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Team health check · TeamG/ }));
    expect(onChange).toHaveBeenCalledWith(setRefKey(SETS[0]), SETS[0]);
  });

  test('a set picked: one line with its questions, owner (the team\'s own name) and topic, and Change', () => {
    mount({ value: setRefKey(SETS[0]) });
    const line = screen.getByRole('group', { name: 'Question set' });
    expect(line.textContent).toMatch('Team health check');
    expect(line.textContent).toMatch('12 questions');
    expect(line.textContent).toMatch('TeamG');
    expect(line.textContent).toMatch('Business & Work');
    fireEvent.click(within(line).getByRole('button', { name: 'Change' }));
    expect(screen.getAllByTestId('set-chooser-row').length).toBe(5);
  });

  test('disabled (an edit): the pinned set, and no Change', () => {
    mount({ value: 'platform:gone', disabled: true, pinnedLabel: 'gone' });
    expect(screen.getByRole('group', { name: 'Question set' }).textContent).toMatch('gone');
    expect(screen.queryByRole('button', { name: 'Change' })).toBeNull();
  });
});

describe('open (S1, S2)', () => {
  test('used lately first, then all; owner counts name the team', () => {
    mount();
    open();
    expect(rowNames()).toEqual(['Team health check', 'Quarterly planning priorities', 'Sprint retro: what went well', 'Product roadmap trade-offs', 'Pulse: how is the week going?']);
    expect(screen.getByText('Used by you lately')).toBeInTheDocument();
    const whose = screen.getByRole('radiogroup', { name: 'Whose sets' });
    expect(within(whose).getAllByRole('radio').map((b) => b.textContent)).toEqual(['All5', 'Yours1', 'TeamG2', 'Engage1', 'Public1']);
  });

  test('typing narrows the list and the counts; each filter is a chip that comes off', () => {
    mount();
    open();
    fireEvent.change(screen.getByRole('combobox', { name: /Search 5 Poll sets/ }), { target: { value: 'retro' } });
    expect(rowNames().sort()).toEqual(['Sprint retro: what went well', 'Team health check']);
    expect(screen.getByRole('status').textContent).toMatch('2 of 5 sets in TeamG');
    const whose = screen.getByRole('radiogroup', { name: 'Whose sets' });
    expect(within(whose).getByRole('radio', { name: /TeamG/ }).textContent).toBe('TeamG2');
    fireEvent.click(screen.getByRole('button', { name: 'Remove Search “retro”' }));
    expect(rowNames().length).toBe(5);
  });

  test('tags: several at once, counted within the other filters', () => {
    mount();
    open();
    fireEvent.click(screen.getByRole('button', { name: /^Tag/ }));
    const tags = screen.getByRole('group', { name: 'Tags' });
    expect(within(tags).getByRole('checkbox', { name: /retro/ }).closest('label').textContent).toMatch('2');
    fireEvent.click(within(tags).getByRole('checkbox', { name: /planning/ }));
    fireEvent.click(within(tags).getByRole('checkbox', { name: /pulse/ }));
    expect(rowNames().sort()).toEqual(['Pulse: how is the week going?', 'Quarterly planning priorities']);
    expect(screen.getByRole('button', { name: 'Remove Tag: planning' })).toBeInTheDocument();
  });

  test('Updated: used by me lately', () => {
    mount();
    open();
    fireEvent.change(screen.getByRole('combobox', { name: 'Updated' }), { target: { value: 'used' } });
    expect(rowNames()).toEqual(['Team health check', 'Quarterly planning priorities']);
  });

  test('the keyboard: arrows move, Enter picks, Esc clears the search, then closes', () => {
    const { onChange } = mount();
    open();
    const box = screen.getByRole('combobox', { name: /Search 5 Poll sets/ });
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(setRefKey(SETS[1]), SETS[1]);
  });

  test('Esc clears the search first, then folds the chooser', () => {
    mount();
    open();
    const box = screen.getByRole('combobox', { name: /Search 5 Poll sets/ });
    fireEvent.change(box, { target: { value: 'zzz' } });
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(box).toHaveValue('');
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(screen.queryByTestId('set-chooser-row')).toBeNull();
  });

  test('an unreadable set is listed but cannot be picked', () => {
    const { onChange } = mount({ sets: [...SETS, { id: 'x', scope: 'org', name: null, decryptFailed: true }], isUnreadable: (s) => Boolean(s.decryptFailed) });
    open();
    const radio = screen.getByRole('radio', { name: 'x (unreadable)' });
    expect(radio).toBeDisabled();
    fireEvent.click(radio.closest('tr'));
    expect(onChange).not.toHaveBeenCalled();
  });

  test('Switch team lists the other teams and says the page reloads', () => {
    const onSwitchTeam = jest.fn();
    mount({ otherTeams: [{ orgId: 'o2', name: 'Acme' }], onSwitchTeam });
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Switch team' }));
    const menu = screen.getByRole('group', { name: 'Switch team' });
    expect(menu.textContent).toMatch('The page reloads in that team.');
    fireEvent.click(within(menu).getByRole('button', { name: 'Acme' }));
    expect(onSwitchTeam).toHaveBeenCalledWith('o2');
  });

  test('one team only: no Switch team', () => {
    mount({ otherTeams: [], onSwitchTeam: jest.fn() });
    open();
    expect(screen.queryByRole('button', { name: 'Switch team' })).toBeNull();
  });
});

describe('nothing matches (S3)', () => {
  test('each way out says what it would find, other formats too, and Make a new set', () => {
    const onPick = jest.fn();
    const onMakeSet = jest.fn();
    mount({ onMakeSet, otherFormats: [{ label: 'Call & Answer', sets: [{ id: 'off', scope: 'org', mine: true, name: 'Offsite ideas' }], onPick }] });
    open();
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Whose sets' })).getByRole('radio', { name: /Yours/ }));
    fireEvent.change(screen.getByRole('combobox', { name: /Search 5 Poll sets/ }), { target: { value: 'offsite' } });
    const empty = screen.getByTestId('set-chooser-empty');
    expect(empty.textContent).toMatch('No Poll sets match “offsite” · Yours'); // the words searched, not the chip label (devtest L4)
    expect(within(empty).getByRole('button', { name: /Other formats: Call & Answer/ }).textContent).toMatch('1 set');
    fireEvent.click(within(empty).getByRole('button', { name: /Other formats/ }));
    expect(onPick).toHaveBeenCalled();
    fireEvent.click(within(empty).getByRole('button', { name: 'Make a new set' }));
    expect(onMakeSet).toHaveBeenCalled();
  });

  test('an exit that leads nowhere is not offered', () => {
    mount();
    open();
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Whose sets' })).getByRole('radio', { name: /Public/ }));
    fireEvent.change(screen.getByRole('combobox', { name: /Search 5 Poll sets/ }), { target: { value: 'nothing-anywhere' } });
    const empty = screen.getByTestId('set-chooser-empty');
    // Every owner's sets still match nothing for that word: no such exit.
    expect(within(empty).queryByRole('button', { name: /every owner/ })).toBeNull();
    expect(within(empty).getByRole('button', { name: /Clear the search/ }).textContent).toMatch('1 set');
  });

  test('a drop-exit applies: Look in every owner\'s sets', () => {
    mount();
    open();
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Whose sets' })).getByRole('radio', { name: /Public/ }));
    fireEvent.change(screen.getByRole('combobox', { name: /Search 5 Poll sets/ }), { target: { value: 'pulse' } });
    const exit = within(screen.getByTestId('set-chooser-empty')).getByRole('button', { name: /every owner/ });
    expect(exit.textContent).toMatch('1 set');
    fireEvent.click(exit);
    expect(rowNames()).toEqual(['Pulse: how is the week going?']);
  });
});

describe('wide (owner, 26 Oct 2026: the narrow modal hid what a host needs)', () => {
  test('each row shows its description, topic and tags; the open state is reported', () => {
    const onOpenChange = jest.fn();
    mount({ wide: true, onOpenChange });
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    open();
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Name', 'Questions', 'Owner', 'Topic', 'Tags', 'Used / updated'] /* 'Qs' spelled out: New engagement README §9, "QS" → "Questions" */);
    const row = screen.getByRole('radio', { name: 'Team health check' }).closest('tr');
    expect(row.textContent).toMatch('How the team is doing');
    expect(row.textContent).toMatch('Business & Work');
    expect(within(row).getByText('team-health')).toBeInTheDocument();
    expect(screen.getByText('Used by you lately').getAttribute('colspan')).toBe('6');
  });

  test('not wide: four columns, no description', () => {
    mount();
    open();
    expect(screen.getAllByRole('columnheader').length).toBe(4);
    expect(screen.queryByText('How the team is doing')).toBeNull();
  });
});

describe('a narrow window (a browser at 820px, 26 Oct 2026)', () => {
  // rejects: hiding the Topic and Tags cells with CSS under a fixed table
  // layout, which slid Used / updated into a zero-width column.
  test('wide but under 900px: the extra columns are left out of the markup, header and cells alike', () => {
    const before = window.matchMedia;
    window.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
    try {
      mount({ wide: true });
      open();
      expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Name', 'Questions', 'Owner', 'Used / updated'] /* 'Qs' spelled out (README §9) */);
      const row = screen.getByRole('radio', { name: 'Team health check' }).closest('tr');
      expect(row.querySelectorAll('td').length).toBe(4);
      expect(row.textContent).toMatch('How the team is doing');
    } finally { window.matchMedia = before; }
  });
});

describe('whose sets offers only owners the list has', () => {
  // rejects: "Team 0" for a host in a personal space, a choice that never matches.
  test('a personal space (all org sets are mine): no Team button', () => {
    mount({ teamName: '', sets: SETS.map((s) => (s.scope === 'org' ? { ...s, mine: true } : s)) });
    open();
    const whose = screen.getByRole('radiogroup', { name: 'Whose sets' });
    expect(within(whose).getAllByRole('radio').map((b) => b.textContent)).toEqual(['All5', 'Yours3', 'Engage1', 'Public1']);
  });
});

/*
  RECENTS FIRST (docs/design/new-engagement frame 3, README §8 and the
  experienced-host review: "Tab into search must not throw the full chooser";
  "Draw the picker before a pick, recents one click away").
*/
describe('recents first (the New engagement dialog)', () => {
  const box = () => screen.getByRole('combobox', { name: /Choose a question set/ });

  test('focus with nothing picked shows the recents listbox, not the full chooser', () => {
    mount({ recentsFirst: true });
    fireEvent.focus(box());
    expect(screen.queryByTestId('set-chooser-row')).toBeNull();
    const list = screen.getByRole('listbox', { name: 'Used by you lately' });
    expect(within(list).getAllByRole('option').map((o) => o.querySelector('b').textContent))
      .toEqual(['Team health check', 'Quarterly planning priorities']);
    expect(screen.getByRole('button', { name: /Browse all 5 sets/ })).toBeInTheDocument();
  });

  test('one click on a recent picks it', () => {
    const { onChange } = mount({ recentsFirst: true });
    fireEvent.click(screen.getAllByRole('option')[1]);
    expect(onChange).toHaveBeenCalledWith(setRefKey(SETS[1]), SETS[1]);
  });

  test('↓ highlights a recent (announced through aria-activedescendant) and Enter picks it', () => {
    const { onChange } = mount({ recentsFirst: true });
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    const first = screen.getAllByRole('option')[0];
    expect(first).toHaveAttribute('aria-selected', 'true');
    expect(box()).toHaveAttribute('aria-activedescendant', first.id);
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(setRefKey(SETS[0]), SETS[0]);
  });

  test('↓ past the recents opens the full chooser', () => {
    mount({ recentsFirst: true });
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    fireEvent.keyDown(box(), { key: 'ArrowDown' });
    expect(screen.getAllByTestId('set-chooser-row').length).toBe(5);
  });

  test('typing opens the full chooser', () => {
    mount({ recentsFirst: true });
    fireEvent.change(box(), { target: { value: 'retro' } });
    expect(rowNames().sort()).toEqual(['Sprint retro: what went well', 'Team health check']);
  });

  test('Browse all opens the full chooser', () => {
    mount({ recentsFirst: true });
    fireEvent.click(screen.getByRole('button', { name: /Browse all/ }));
    expect(screen.getAllByTestId('set-chooser-row').length).toBe(5);
  });
});

/* LIVE DEV TESTS, 30 Oct 2026 (reviews/devtest-2 E1/E3, devtest-3 H3/H4/B5). */
describe('the keyboard model the live test asked for', () => {
  test('Enter in the empty search picks the first recent, and focus lands on Change', () => {
    const { onChange, rerender } = mount({ recentsFirst: true });
    const box = screen.getByRole('combobox', { name: /Choose a question set/ });
    box.focus();
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(setRefKey(SETS[0]), SETS[0]);
    rerender(<SetChooser sets={SETS} value={setRefKey(SETS[0])} onChange={onChange} recent={RECENT} formatLabel="Poll" teamName="TeamG" now={NOW} recentsFirst />);
    expect(screen.getByRole('button', { name: 'Change' })).toHaveFocus();
  });

  test('Esc in the search (recents showing) never reaches the dialog', () => {
    const outer = jest.fn();
    render(<div onKeyDown={outer}><SetChooser sets={SETS} value="" onChange={jest.fn()} recent={RECENT} now={NOW} recentsFirst /></div>);
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
    expect(outer).not.toHaveBeenCalled();
  });

  test('an arrow key on a row radio moves the highlight; it does not pick', () => {
    const { onChange } = mount();
    open();
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Team health check' }), { key: 'ArrowDown' });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getAllByTestId('set-chooser-row').length).toBe(5);
    const search = screen.getByRole('combobox', { name: /Search 5 Poll sets/ });
    expect(search).toHaveFocus();
    expect(document.getElementById(search.getAttribute('aria-activedescendant'))).toHaveAttribute('aria-label', 'Quarterly planning priorities');
  });

  test('the row radios are out of the Tab order, and aria-controls names only what is rendered', () => {
    mount();
    open();
    expect(screen.getAllByRole('radio', { name: /Team health|Quarterly/ }).every((r) => r.tabIndex === -1)).toBe(true);
    const search = screen.getByRole('combobox', { name: /Search 5 Poll sets/ });
    fireEvent.change(search, { target: { value: 'nothing-anywhere' } });
    expect(search.getAttribute('aria-controls')).toBeNull();
  });

  test('Keep the set I had puts the focus on Change, never on <body>', () => {
    mount({ value: setRefKey(SETS[0]) });
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep the set I had' }));
    expect(screen.getByRole('button', { name: 'Change' })).toHaveFocus();
  });
});

describe('the open chooser (frame 5a)', () => {
  test('rows are reachable with ↑↓: the highlighted row is the search\'s active descendant', () => {
    mount();
    open();
    const search = screen.getByRole('combobox', { name: /Search 5 Poll sets/ });
    fireEvent.keyDown(search, { key: 'ArrowDown' });
    const id = search.getAttribute('aria-activedescendant');
    expect(document.getElementById(id)).toHaveAttribute('aria-label', 'Quarterly planning priorities');
  });

  test('Change focuses the search; the current set says so in words; Esc twice keeps the set', () => {
    const { onChange } = mount({ value: setRefKey(SETS[0]) });
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    const search = screen.getByRole('combobox', { name: /Search 5 Poll sets/ });
    expect(search).toHaveFocus();
    const current = screen.getByRole('radio', { name: 'Team health check' }).closest('tr');
    expect(current).toHaveAttribute('aria-current', 'true');
    expect(current.textContent).toMatch('current');
    expect(screen.getByRole('button', { name: 'Keep the set I had' })).toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'zz' } });
    fireEvent.keyDown(search, { key: 'Escape' });
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(screen.queryByTestId('set-chooser-row')).toBeNull();
    expect(screen.getByRole('group', { name: 'Question set' }).textContent).toMatch('Team health check');
    expect(onChange).not.toHaveBeenCalled();
  });

  test('the no-match state lists the make-your-own routes after the exits', () => {
    const picks = { manual: jest.fn(), ai: jest.fn(), template: jest.fn() };
    mount({
      makeRoutes: [
        { id: 'manual', label: 'Write your own questions', onPick: picks.manual },
        { id: 'ai', label: 'Make a set with Workie', onPick: picks.ai },
        { id: 'template', label: 'Fill in a spreadsheet', onPick: picks.template },
      ],
    });
    open();
    fireEvent.change(screen.getByRole('combobox', { name: /Search 5 Poll sets/ }), { target: { value: 'nothing-anywhere' } });
    const empty = screen.getByTestId('set-chooser-empty');
    expect(within(empty).getByRole('button', { name: /Clear the search/ })).toBeInTheDocument();
    const routes = within(empty).getByTestId('set-chooser-routes');
    expect(within(routes).getAllByRole('button').map((b) => b.textContent))
      .toEqual(['Write your own questions', 'Make a set with Workie', 'Fill in a spreadsheet']);
    fireEvent.click(within(routes).getByRole('button', { name: 'Make a set with Workie' }));
    expect(picks.ai).toHaveBeenCalled();
  });
});
