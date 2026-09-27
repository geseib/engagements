/**
 * THE SESSION OPTIONS, RENDERED ALONE — components/SessionOptions.jsx (events
 * M1b, Task 3): the create dialog's category grid, Workie's briefing and its
 * Advanced fold, which the event item dialog renders too.
 *
 * rejects: a control that does not report its change under the create
 * payload's own key; an id that ignores its prefix (two dialogs, one id); the
 * shuffle offered on a survey or live in an edit; the anonymity card on a
 * format with no vote; the approach picker offering another format's prompts
 * or a generator; a SECOND COPY of these controls anywhere in the frontend.
 */
import fs from 'fs';
import path from 'path';
import React from 'react';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import SessionOptions, { SessionCategories, SessionBriefing } from '../components/SessionOptions';

const mockPrompts = [
  { promptId: 'lp-behavioral', name: 'LP Behavioural', gameType: 'call-and-answer', summaryPromptStatus: 'ok' },
  { promptId: 'trivia-vj', name: 'Trivia — VJ', gameType: 'trivia', summaryPromptStatus: 'ok' },
  { promptId: 'trivia-gen', name: 'Trivia generator', gameType: 'trivia', summaryPromptStatus: 'unusable' },
];
jest.mock('../auth/authFetch', () => ({
  __esModule: true,
  authFetch: jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ prompts: mockPrompts }) })),
}));

const VALUE = {
  anonymousResponses: true, randomizeQuestions: true, names: 'anonymous',
  personaId: '', promptId: '', aiContext: '', eventDetails: '',
};
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));
const mount = (props = {}) => {
  const onChange = jest.fn();
  render(
    <div className="gsd">
      <SessionOptions
        idPrefix="t"
        gameType="call-and-answer"
        value={VALUE}
        onChange={onChange}
        personas={[{ personaId: 'coach', name: 'Coach' }]}
        {...props}
      />
    </div>,
  );
  return onChange;
};

describe('every control reports its change under the payload\'s own key', () => {
  test('anonymous responses, shuffle, voice, approach, instructions and details', async () => {
    const onChange = mount();
    await settle();
    fireEvent.click(screen.getByRole('checkbox', { name: /anonymous responses/i }));
    expect(onChange).toHaveBeenLastCalledWith({ anonymousResponses: false });
    fireEvent.click(screen.getByRole('checkbox', { name: /shuffle the question order/i }));
    expect(onChange).toHaveBeenLastCalledWith({ randomizeQuestions: false });
    fireEvent.change(screen.getByLabelText("Workie's voice"), { target: { value: 'coach' } });
    expect(onChange).toHaveBeenLastCalledWith({ personaId: 'coach' });
    fireEvent.change(screen.getByLabelText('Summary approach'), { target: { value: 'lp-behavioral' } });
    expect(onChange).toHaveBeenLastCalledWith({ promptId: 'lp-behavioral' });
    fireEvent.change(screen.getByLabelText('Instructions for Workie'), { target: { value: 'Be brief.' } });
    expect(onChange).toHaveBeenLastCalledWith({ aiContext: 'Be brief.' });
    fireEvent.change(screen.getByLabelText('Event details'), { target: { value: 'Why we meet.' } });
    expect(onChange).toHaveBeenLastCalledWith({ eventDetails: 'Why we meet.' });
  });

  test('every id carries the prefix, so two dialogs never share one', async () => {
    mount();
    await settle();
    for (const id of ['t-persona', 't-prompt', 't-ai-context', 't-details']) {
      expect(document.getElementById(id)).not.toBeNull();
    }
    expect(document.getElementById('gsd-persona')).toBeNull();
  });
});

describe('what each format is offered', () => {
  test('a survey gets Names, and no anonymity card and no shuffle', async () => {
    const onChange = mount({ gameType: 'survey' });
    await settle();
    expect(screen.queryByRole('checkbox', { name: /anonymous responses/i })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /shuffle/i })).toBeNull();
    const names = screen.getByRole('radiogroup', { name: 'Names' });
    fireEvent.click(within(names).getAllByRole('radio')[2]);
    expect(onChange).toHaveBeenLastCalledWith({ names: 'named' });
  });

  test('trivia has no vote to hide; its approach picker offers only its usable summary prompts', async () => {
    mount({ gameType: 'trivia' });
    await settle();
    expect(screen.queryByRole('checkbox', { name: /anonymous responses/i })).toBeNull();
    const options = within(screen.getByLabelText('Summary approach')).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['The standard Trivia way (recommended)', 'Trivia — VJ']);
  });

  test('an edit locks the shuffle and says why', async () => {
    mount({ shuffleLocked: true });
    await settle();
    expect(screen.getByRole('checkbox', { name: /shuffle/i })).toBeDisabled();
    expect(screen.getByText(/Fixed once the session is created/)).toBeInTheDocument();
  });

  test('the set\'s own approach is named only when the library holds it', async () => {
    mount({ setPromptId: 'lp-behavioral' });
    await settle();
    const first = within(screen.getByLabelText('Summary approach')).getAllByRole('option')[0];
    expect(first).toHaveTextContent('What the set says (recommended)');
  });
});

describe('the categories and the briefing', () => {
  const CATS = [{ name: 'Leadership', questionCount: 20 }, { name: 'Ops', questionCount: 27 }];

  test('create: none picked means all of them, counted in questions', () => {
    const onToggle = jest.fn();
    render(<div className="gsd"><SessionCategories idPrefix="t" categories={CATS} selected={new Set()} onToggle={onToggle} /></div>);
    expect(screen.getByRole('group', { name: 'Categories' })).toBeInTheDocument();
    expect(screen.getByText('None picked, so all 2 are in · 47 questions')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Ops/ }));
    expect(onToggle).toHaveBeenCalledWith('Ops');
  });

  test('edit: an empty selection is refused in words', () => {
    render(<div className="gsd"><SessionCategories categories={CATS} selected={new Set()} editing /></div>);
    expect(screen.getByText(/Select at least one category/)).toBeInTheDocument();
  });

  test('the briefing is headed as Call & Answer only', () => {
    render(<div className="gsd"><SessionBriefing value={null} onChange={jest.fn()} /></div>);
    expect(screen.getByRole('heading', { name: /Workie’s briefing/ })).toHaveTextContent('Call & Answer only');
  });
});

describe('one copy of the options, never two', () => {
  const SRC = path.join(__dirname, '..');
  const sources = (dir, out = []) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__' && entry.name !== 'node_modules') sources(full, out);
      } else if (/\.jsx?$/.test(entry.name)) {
        out.push(full);
      }
    }
    return out;
  };

  // rejects: the item dialog (or anything else) growing its own copy of a
  // control this file owns — the owner asked for the SAME options.
  test.each([
    'className="gsd-adv"',
    'Shuffle the question order',
    'Instructions for Workie',
    'className="gsd-three-opt"',
    'category-button-grid',
  ])('only SessionOptions.jsx draws %s', (marker) => {
    const holders = sources(SRC)
      .filter((file) => fs.readFileSync(file, 'utf8').includes(marker))
      .map((file) => path.relative(SRC, file));
    expect(holders).toEqual([path.join('components', 'SessionOptions.jsx')]);
  });

  test('the create dialog renders all three', () => {
    const src = fs.readFileSync(path.join(SRC, 'components', 'GameSetupDialog.jsx'), 'utf8');
    expect(src).toMatch(/<SessionOptions\b/);
    expect(src).toMatch(/<SessionCategories\b/);
    expect(src).toMatch(/<SessionBriefing\b/);
  });
});
