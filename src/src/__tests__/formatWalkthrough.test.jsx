/**
 * THE STORYBOARD (docs/design/new-engagement README rounds 2 and 3;
 * config/formatWalkthrough.js, components/FormatWalkthrough.jsx). The owner,
 * 30 Oct 2026: "rather than having to click through prev and next if you just
 * scrolled through the stages. with an image and description." Behaviour
 * only: jsdom has no layout.
 */
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import FormatWalkthrough from '../components/FormatWalkthrough';
import { FORMAT_WALKTHROUGH, walkthroughFor } from '../config/formatWalkthrough';
import { PICKER_GAME_TYPES } from '../config/gameTypes';
import { BUILD_KIND, EVENT_KIND } from '../config/engagementKinds';
import { formatGuide } from '../config/formatGuide';

const OFFERED = [...PICKER_GAME_TYPES.map((t) => t.id), BUILD_KIND, EVENT_KIND];
const stages = () => within(screen.getByRole('list', { name: /stage by stage/ })).getAllByRole('listitem');

describe('every offered format has a storyboard', () => {
  test.each(OFFERED)('%s: 3–6 stages, each a picture, a title and a plain description, then "What you get"', (id) => {
    const walk = walkthroughFor(id);
    expect(walk).not.toBeNull();
    expect(walk.stages.length).toBeGreaterThanOrEqual(3);
    expect(walk.stages.length).toBeLessThanOrEqual(6);
    walk.stages.forEach((stage) => {
      expect(stage.title.length).toBeGreaterThan(0);
      expect(stage.text.length).toBeGreaterThan(20);
      expect(stage.art && stage.art.stage && stage.art.stage.kind).toBeTruthy();
    });
    expect(walk.get.text.length).toBeGreaterThan(0);
    expect(walk.get.art.stage.kind).toBe('report');
  });

  test('no storyboard for a format nobody offers', () => {
    expect(Object.keys(FORMAT_WALKTHROUGH).sort()).toEqual([...OFFERED].sort());
  });

  test('Call & Answer carries the owner\'s own example from the ask to the report', () => {
    const all = JSON.stringify(walkthroughFor('call-and-answer'));
    expect(all).toContain('If we had unlimited people and resources, what should we build?');
    ['A Rube Goldberg machine', 'A grass-seeding robot', 'An AI-enabled fax machine', 'A for-hire one-week enterprise tech-debt remover']
      .forEach((answer) => expect(all).toContain(answer));
    const titles = walkthroughFor('call-and-answer').stages.map((s) => s.title);
    expect(titles).toEqual(['The ask', 'Everyone answers', 'The responses, and the vote', 'The results, ranked', 'Workie’s read', 'Comments']);
  });

  test('the words the help holds: top three, no names while voting, names with the results; Wavelength never scores', () => {
    const ca = walkthroughFor('call-and-answer').stages.map((s) => s.text).join(' ');
    expect(ca).toMatch(/top three/);
    expect(ca).toMatch(/with no names/);
    expect(ca).toMatch(/Names go up with the results/);
    expect(ca).toMatch(/carries the writer’s name/);
    const wl = JSON.stringify(walkthroughFor('wavelength'));
    expect(wl).toMatch(/Nobody scores/);
    expect(wl).not.toMatch(/a word scores/);
    expect(JSON.stringify(walkthroughFor('poll'))).toMatch(/no right answer and no names/);
    expect(JSON.stringify(walkthroughFor(EVENT_KIND))).toMatch(/up to 16 items/);
  });

  test('the plain descriptions (owner, 30 Oct): Call & Answer in the owner\'s words, every format has one', () => {
    expect(formatGuide('call-and-answer').short).toBe('Ask the room a question. Everyone answers on their phone, reads all the answers and votes for their favourites.');
    OFFERED.forEach((id) => {
      const g = formatGuide(id);
      ['short', 'col', 'good', 'group', 'startsShort', 'get'].forEach((k) => expect([id, k, g[k].length > 0]).toEqual([id, k, true]));
    });
  });
});

describe('scrolling through it', () => {
  test('every stage is on the page at once, in order, ending with What you get; nothing to click through', () => {
    render(<FormatWalkthrough format="call-and-answer" label="Call & Answer" />);
    expect(screen.getByRole('heading', { name: 'How Call & Answer runs' })).toBeInTheDocument();
    const cards = stages();
    expect(cards).toHaveLength(7);
    expect(within(cards[0]).getByRole('heading', { name: /The ask/ })).toBeInTheDocument();
    expect(cards[0].querySelector('.gsd-sb-text').textContent).toMatch(/what should we build\?/);
    expect(within(cards[6]).getByRole('heading', { name: /What you get/ })).toBeInTheDocument();
    cards.forEach((c) => expect(c.querySelector('.gsd-wt-pic')).not.toBeNull());
    expect(screen.queryByRole('button', { name: /^(Next|Back|Play)/ })).toBeNull();
  });

  test('the stage index scrolls a stage into view and moves the focus to it', () => {
    const spy = jest.fn();
    const before = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = spy;
    try {
      render(<FormatWalkthrough format="trivia" label="Trivia" />);
      const index = screen.getByRole('navigation', { name: 'Stages of Trivia' });
      fireEvent.click(within(index).getByRole('button', { name: 'Stage 3: You reveal' }));
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }));
      expect(stages()[2]).toHaveFocus();
      fireEvent.click(within(index).getByRole('button', { name: 'What you get' }));
      expect(stages()[4]).toHaveFocus();
    } finally { Element.prototype.scrollIntoView = before; }
  });

  test('under reduced motion the index jumps without a smooth scroll', () => {
    const spy = jest.fn();
    const before = Element.prototype.scrollIntoView;
    const realMatch = window.matchMedia;
    Element.prototype.scrollIntoView = spy;
    window.matchMedia = (q) => ({ matches: /reduced-motion/.test(q), media: q, addEventListener() {}, removeEventListener() {} });
    try {
      render(<FormatWalkthrough format="poll" label="Poll" />);
      fireEvent.click(screen.getByRole('button', { name: 'Stage 2: Results fill in live' }));
      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }));
    } finally { Element.prototype.scrollIntoView = before; window.matchMedia = realMatch; }
  });

  // rejects: the owner's white screen (2026-10-30, b63ad9737). Round 2 kept a
  // current step, and from Call & Answer's last page a shorter format had no
  // such step; the first render with it read `.art` of undefined and took the
  // page down. The storyboard keeps no step, and this holds it so: from the
  // longest storyboard's last card, every other format still renders whole.
  test('from the last stage of the longest storyboard, every other format still renders', () => {
    const others = Object.keys(FORMAT_WALKTHROUGH).filter((f) => f !== 'call-and-answer');
    for (const other of others) {
      const { rerender, unmount } = render(<FormatWalkthrough format="call-and-answer" label="Call & Answer" />);
      fireEvent.click(screen.getByRole('button', { name: 'What you get' }));
      expect(screen.getAllByText('What you get').length).toBeGreaterThan(0);
      expect(() => rerender(<FormatWalkthrough format={other} label={other} />)).not.toThrow();
      const cards = stages();
      expect(cards).toHaveLength(walkthroughFor(other).stages.length + 1);
      expect(within(cards[0]).getByRole('heading', { name: new RegExp(walkthroughFor(other).stages[0].title) })).toBeInTheDocument();
      unmount();
    }
  });

  test('the room card keeps its words clear of the phone (dev check: the title ran under it)', () => {
    const { container } = render(<FormatWalkthrough format="call-and-answer" label="Call & Answer" />);
    expect(container.querySelector('.gsd-wt-pic')).toHaveClass('has-phone');
    const css = require('fs').readFileSync(require('path').join(__dirname, '..', 'components', 'GameSetupDialog.css'), 'utf8');
    const overlap = Number(css.match(/\.gsd \.gsd-wt-phone \{[^}]*width:\s*(\d+)px/)[1])
      - Number(css.match(/\.gsd \.gsd-wt-pic \{[^}]*padding-right:\s*(\d+)px/)[1]);
    const clear = Number(css.match(/\.gsd \.gsd-wt-pic\.has-phone \.gsd-wt-stage \{[^}]*padding-right:\s*(\d+)px/)[1]);
    expect(clear).toBeGreaterThan(overlap);
  });

  test('the guide lays the stages in a row that scrolls inside its panel, never the page', () => {
    const css = require('fs').readFileSync(require('path').join(__dirname, '..', 'components', 'GameSetupDialog.css'), 'utf8');
    expect(css).toMatch(/\.gsd \.gsd-wt--guide \.gsd-sb \{[^}]*flex-direction:\s*row;[^}]*overflow-x:\s*auto/);
  });

  test('no format yet: one plain line, no controls', () => {
    render(<FormatWalkthrough format="" />);
    expect(screen.getByText(/Choose a format to see how it runs/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
