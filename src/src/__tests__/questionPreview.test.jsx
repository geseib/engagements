import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import QuestionPreview, { QuestionViewSwitch } from '../components/QuestionPreview';
import { previewRows, previewCategories, stepSelection } from '../config/questionPreview';
import { toRow } from '../utils/questionRows';

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

describe('the card', () => {
  test('it is the stage\'s card on a Table-ladder dusk screen, inside a paper preview', () => {
    renderPreview();
    const pane = screen.getByTestId('preview-screen');
    expect(pane).toHaveClass('qprev-screen', 'stage-ladder-table');
    expect(pane).toHaveAttribute('data-theme', 'dark');
    expect(screen.getByTestId('question-preview')).toHaveAttribute('data-theme', 'light');
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

  test('only trivia has anything to reveal, so only trivia gets the toggle', () => {
    const { unmount } = renderPreview();
    expect(phaseGroup()).not.toBeNull();
    expect(within(phaseGroup()).getByRole('button', { name: 'ASK' })).toHaveAttribute('aria-pressed', 'true');
    unmount();
    for (const gameType of ['call-and-answer', 'poll', 'wavelength']) {
      const view = renderPreview({ gameType });
      expect(phaseGroup()).toBeNull();
      view.unmount();
    }
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

describe('the two empty states, which are different situations', () => {
  test('a set with no questions says there is nothing to preview', () => {
    renderPreview({ rows: [] });
    expect(screen.getByText(/This set has no questions yet, so there is nothing to preview/)).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  test('a set whose every row is removed is the same situation', () => {
    renderPreview({ rows: makeRows().map((r) => ({ ...r, removed: true })) });
    expect(screen.getByText(/nothing to preview/)).toBeInTheDocument();
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

  test('every line the sheet cuts short carries its whole string on title=', () => {
    // rejects: an ellipsis with no recovery, which is a deletion (engage-design
    // hard rule 7). The meta line shared the title's cut and not its title=.
    renderEverything();
    const cutBy = RULES.filter((rule) => /text-overflow\s*:\s*ellipsis/.test(rule.body))
      .flatMap((rule) => rule.selectors);
    const cut = cutBy.flatMap((selector) => [...document.querySelectorAll(selector)]);
    // the premise: the sheet does cut something the preview renders
    expect(cut.length).toBeGreaterThan(0);
    expect(cut.filter((el) => el.getAttribute('title') !== el.textContent).map((el) => el.textContent)).toEqual([]);
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
