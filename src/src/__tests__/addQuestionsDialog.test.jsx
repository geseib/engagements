/**
 * components/AddQuestionsDialog.jsx — the New set routes, pointed at a set.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent } from '@testing-library/react';
import AddQuestionsDialog from '../components/AddQuestionsDialog';
import { toRow } from '../utils/questionRows';
import { appendRequirement, appendCategoryDefaults, withAppendRequirement, briefFromSet } from '../utils/appendMode';
import AppendModeSwitch from '../components/AppendModeSwitch';
import { SetSizeField } from '../components/CountField';

const rows = [toRow({ Category: 'History', Title: 'a' }), toRow({ Category: 'Method', Title: 'b' })];

const draw = (props = {}) => {
  const handlers = { onClose: jest.fn(), onOpenBuilder: jest.fn(), onWriteOne: jest.fn(), onAddRows: jest.fn() };
  render(
    <AddQuestionsDialog
      setName="True crime"
      engagementType="trivia"
      categories={['History', 'Method']}
      counts={new Map([['History', 1], ['Method', 1]])}
      currentRows={rows}
      {...handlers}
      {...props}
    />
  );
  return handlers;
};

describe('AddQuestionsDialog', () => {
  it('asks where they go first — one mode or the other, the set\'s own by default', () => {
    draw();
    const existing = screen.getByRole('radio', { name: /categories this set already has/i });
    const fresh = screen.getByRole('radio', { name: /as new categories/i });
    expect(existing).toBeChecked();
    expect(fresh).not.toBeChecked();
    // The balance the mode protects is on screen: each category with its count.
    expect(screen.getByText('History (1) · Method (1)')).toBeInTheDocument();
  });

  it('offers the same three routes as a new set', () => {
    draw();
    expect(screen.getByRole('button', { name: /^AI .* builder/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/CSV of questions to add/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add a question/i })).toBeInTheDocument();
  });

  it('every route carries the chosen mode out with it', () => {
    const { onOpenBuilder, onWriteOne } = draw();
    fireEvent.click(screen.getByRole('radio', { name: /as new categories/i }));
    fireEvent.click(screen.getByRole('button', { name: /^AI .* builder/i }));
    fireEvent.click(screen.getByRole('button', { name: /add a question/i }));
    expect(onOpenBuilder).toHaveBeenCalledWith('new');
    expect(onWriteOne).toHaveBeenCalledWith('new');
  });

  it('a set with no categories can only add new ones, and is told why', () => {
    draw({ categories: [], counts: new Map(), currentRows: [] });
    expect(screen.getByRole('radio', { name: /categories this set already has/i })).toBeDisabled();
    expect(screen.getByText('This set has no categories yet.')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /as new categories/i })).toBeChecked();
  });

  it('survey sets are not offered a builder that makes no questions', () => {
    draw({ engagementType: 'survey', aiAvailable: false });
    expect(screen.queryByRole('button', { name: /^AI .* builder/i })).toBeNull();
  });

  it('has an X and a bottom exit', () => {
    const { onClose } = draw();
    fireEvent.click(screen.getByTestId('addq-close'));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('what a builder is told when it is adding', () => {
  const existing = { setName: 'True crime', mode: 'existing', categories: ['History', 'Method'] };
  const fresh = { ...existing, mode: 'new' };

  it('existing mode pins the category count and names, and says ONLY these', () => {
    expect(appendCategoryDefaults(existing)).toEqual({ numberOfCategories: 2, mustHaveCategories: 'History, Method' });
    expect(appendRequirement(existing)).toMatch(/Use ONLY these category names.*History, Method/);
  });

  it('new mode pins nothing and names what is taken', () => {
    expect(appendCategoryDefaults(fresh, { keep: 1 })).toEqual({ keep: 1 });
    expect(appendRequirement(fresh)).toMatch(/must NOT be used: History, Method/);
  });

  it('the requirement is appended to the operator\'s own, never replaces it', () => {
    expect(withAppendRequirement('Keep it light.', fresh)).toMatch(/^Keep it light\.\n\nThese questions/);
    expect(withAppendRequirement('Keep it light.', null)).toBe('Keep it light.');
  });

  it.each(['TriviaAIBuilder.jsx', 'PollAIBuilder.jsx', 'AIScenarioBuilder.jsx'])(
    '%s sends appendOnly so the worker creates no second set',
    (file) => {
      const src = fs.readFileSync(path.join(__dirname, '..', 'components', file), 'utf8');
      expect(src).toMatch(/appendOnly: true/);
      expect(src).toMatch(/withAppendRequirement\(/);
    },
  );
});

describe('adding starts from the brief the set was made from', () => {
  // The owner's own example, verbatim.
  it('reads the topic and the audience back out of a builder-made title', () => {
    expect(briefFromSet({
      name: 'Serial murders throughout time Trivia for Crime buffs',
      aiContextInstruction: 'These are hard-level trivia questions about Serial murders throughout time. Provide explanations for correct answers and encourage learning.',
    })).toMatchObject({ topic: 'Serial murders throughout time', audience: 'Crime buffs', difficulty: 'hard' });
  });

  it('a poll title reverses the same way', () => {
    expect(briefFromSet({ name: 'Remote work Polls for Managers' })).toMatchObject({ topic: 'Remote work', audience: 'Managers' });
  });

  it('a set no builder named still prefills: the whole name is the topic', () => {
    // rejects: an empty topic box over a set that plainly has a subject.
    expect(briefFromSet({ name: 'Q3 offsite', description: 'Icebreakers.' }))
      .toMatchObject({ topic: 'Q3 offsite', audience: '', context: 'Icebreakers.' });
  });

  it.each(['TriviaAIBuilder.jsx', 'PollAIBuilder.jsx', 'AIScenarioBuilder.jsx'])('%s starts from it and shows the mode switch', (file) => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'components', file), 'utf8');
    expect(src).toMatch(/appendTo\?\.brief\?\.audience/);
    expect(src).toMatch(/<AppendModeSwitch appendTo=\{appendTo\} \/>/);
  });
});

describe('the mode is visible, and changeable, inside the builder', () => {
  it('shows both destinations and reports a change', () => {
    const onModeChange = jest.fn();
    render(<AppendModeSwitch appendTo={{ setName: 'S', mode: 'existing', categories: ['History', 'Method'], onModeChange }} />);
    expect(screen.getByRole('radio', { name: /into this set’s categories/i })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: /into new categories/i }));
    expect(onModeChange).toHaveBeenCalledWith('new');
  });

  it('renders nothing when a builder is making a new set', () => {
    const { container } = render(<AppendModeSwitch appendTo={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('adding 25, or growing to 25? — the size field says which', () => {
  it('every figure says NEW, and the set\'s before and after are both stated', () => {
    render(<SetSizeField count={25} categories={5} onChange={() => {}} lockedCategories={['a', 'b', 'c', 'd', 'e']} adding={{ existingTotal: 40 }} />);
    expect(screen.getByText('New questions to add to each category')).toBeInTheDocument();
    expect(screen.getByTestId('set-size-total')).toHaveTextContent('Adding 25 new questions');
    expect(screen.getByTestId('set-size-grows')).toHaveTextContent('it goes from 40 to 65. Nothing existing is replaced.');
  });

  it('a new set says none of that', () => {
    render(<SetSizeField count={15} categories={3} onChange={() => {}} />);
    expect(screen.getByTestId('set-size-total')).toHaveTextContent('15 questions in total');
    expect(screen.queryByTestId('set-size-grows')).toBeNull();
  });
});

describe('adding never asks for a set title', () => {
  it('the scenario builder hides its Question Set Title field when adding', () => {
    // The owner: "you shouldnt get to set the question set title when adding
    // questions." Trivia and Poll have no such field; this was the only one.
    const src = fs.readFileSync(path.join(__dirname, '..', 'components', 'AIScenarioBuilder.jsx'), 'utf8');
    const at = src.indexOf('<label>Question Set Title</label>');
    const opener = src.slice(src.lastIndexOf('<div className="form-group"', at), at);
    expect(opener).toContain("style={isAppend(appendTo) ? { display: 'none' } : undefined}");
    // rejects: the bare `hidden` attribute, which `.form-group { display: flex }` defeats.
    expect(src).not.toMatch(/className="form-group" hidden=/);
    for (const file of ['TriviaAIBuilder.jsx', 'PollAIBuilder.jsx']) {
      expect(fs.readFileSync(path.join(__dirname, '..', 'components', file), 'utf8')).not.toMatch(/Set Title/i);
    }
  });
});
