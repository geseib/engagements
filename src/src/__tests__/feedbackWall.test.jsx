/**
 * THE FEEDBACK WALL — components/stage/FeedbackWall.jsx, and the credit line
 * config/comments.js writes for it.
 *
 * The owner, 2026-09-24, looking at the shipped wall: "the small type is not
 * needed and it doesnt seem like a designer put this part together." What the
 * room saw: a kicker repeating the headline; two lines of body copy on a
 * class (`.lede`) no stylesheet defines, so they fell to the page's ~13px UI
 * size on a projector; a "7 comments so far" line stating the meter's number
 * a second time; and the featured quote's author and anchor in label-size
 * uppercase beneath it.
 *
 * Now: the question, one instruction line at body size, and — once the host
 * features one — the comment as a pull quote at the primary tier, credited
 * in sentence case at body size ("Dana Reyes on Priya Shah's response"). The
 * question steps down a tier so the quote leads. Pressing the quote takes it
 * down (the same toggle the meter's card used).
 *
 * rejects: a kicker; `.lede`; a count on the wall; a credit in label-size
 * uppercase; a featured quote the host cannot take down; a response's author
 * named on an anonymous round's credit when the label carried no name.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import FeedbackWall from '../components/stage/FeedbackWall';
import { wallCreditFor } from '../config/comments';

const COMMENT = {
  commentId: 'c7', text: 'Reading the board async only works if someone owns the board.',
  playerName: 'Dana Reyes', anchorKind: 'response', anchorRef: '1', anchorLabel: 'Response 2 — Priya Shah',
};

describe('wallCreditFor — what the featured comment was about, as a phrase', () => {
  test.each([
    [{ anchorKind: 'summary', anchorLabel: 'AI summary' }, 'on the summary'],
    [{ anchorKind: 'results', anchorLabel: 'Results' }, 'on the results'],
    [{ anchorKind: 'response', anchorLabel: 'Response 2 — Priya Shah' }, 'on Priya Shah’s response'],
    [{ anchorKind: 'response', anchorLabel: 'Response 2' }, 'on response 2'],
    [{ anchorKind: 'response', anchorLabel: 'Response 11 — James' }, 'on James’s response'],
    [{ anchorLabel: 'Something new' }, 'on Something new'],
    [{}, ''],
    [null, ''],
  ])('%j → %p', (comment, phrase) => {
    expect(wallCreditFor(comment)).toBe(phrase);
  });
});

describe('the wall while comments arrive', () => {
  test('the question at the hero tier, and one instruction line on a stage class', () => {
    const { container } = render(<FeedbackWall featured={null} onTakeDown={() => {}} />);
    const hero = container.querySelector('h1.hero');
    expect(hero.textContent).toBe('What do you make of it?');
    expect(hero.classList.contains('fb-question')).toBe(false);
    const ask = container.querySelector('p.fb-ask');
    expect(ask.textContent).toMatch(/on your phone/);
  });

  test('no kicker, no `.lede`, and no count (the meter carries it)', () => {
    const { container } = render(<FeedbackWall featured={null} onTakeDown={() => {}} />);
    expect(container.querySelector('.kicker')).toBeNull();
    expect(container.querySelector('.lede')).toBeNull();
    expect(container.textContent).not.toMatch(/so far|comments?\b.*\d|\d.*comments?/i);
  });
});

describe('the wall with a comment featured', () => {
  test('the quote leads, and the question steps down a tier', () => {
    const { container } = render(<FeedbackWall featured={COMMENT} onTakeDown={() => {}} />);
    expect(container.querySelector('h1.hero').classList.contains('fb-question')).toBe(true);
    expect(container.querySelector('.fb-quote .say').textContent).toBe(COMMENT.text);
    expect(container.querySelector('.fb-quote .mark').getAttribute('aria-hidden')).toBe('true');
  });

  test('credited in sentence case: the author, then what it was about', () => {
    const { container } = render(<FeedbackWall featured={COMMENT} onTakeDown={() => {}} />);
    const by = container.querySelector('.fb-quote .by');
    expect(by.textContent).toBe('Dana Reyes on Priya Shah’s response');
    expect(by.querySelector('b').textContent).toBe('Dana Reyes');
  });

  test('with no author on the row, the credit is only what it was about', () => {
    const { container } = render(<FeedbackWall featured={{ ...COMMENT, playerName: undefined }} onTakeDown={() => {}} />);
    expect(container.querySelector('.fb-quote .by').textContent).toBe('On Priya Shah’s response');
  });

  test('pressing the quote takes it down, by id, and it is a button', () => {
    const onTakeDown = jest.fn();
    const { container } = render(<FeedbackWall featured={COMMENT} onTakeDown={onTakeDown} />);
    // The quote is the button's name (a screen reader reads the comment); the
    // hint is its title.
    const quote = screen.getByRole('button', { name: new RegExp(COMMENT.text.slice(0, 20)) });
    expect(quote).toBe(container.querySelector('.fb-quote'));
    expect(quote.getAttribute('title')).toMatch(/take it down/i);
    fireEvent.click(quote);
    expect(onTakeDown).toHaveBeenCalledWith('c7');
  });
});
