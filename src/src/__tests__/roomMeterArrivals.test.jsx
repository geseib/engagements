/**
 * ARRIVALS IN THE METER — refresh-2026-09-22 RATIONALE §6 step 5, applied
 * to the FEEDBACK round's comments (the owner, 2026-09-22: "a way to get
 * that info up on the screen … click on those would allow everyone to see
 * them").
 *
 * The meter gains an `arrivals` slot: the last few comments as they land,
 * newest brightest, and NEVER who wrote it. A click is the host featuring one.
 *
 * THE CARDS ARE THE COMMENTS AND NOTHING ELSE (the owner, 2026-09-24: "the
 * small type is not needed and it doesnt seem like a designer put this part
 * together"). The "Arriving" label and each card's small uppercase "On …"
 * line are gone; what a comment is about is said once, at a readable size,
 * on the featured quote (FeedbackWall.jsx). And the featured one leaves the
 * list — it is on the wall, and the same words twice in one viewport is the
 * stage's own rule broken.
 */
import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import RoomMeter from '../components/stage/RoomMeter';

const C = (id, text, label, over = {}) => ({ commentId: id, text, anchorLabel: label, playerName: 'Ada Lovelace', ...over });
const three = [
  C('c1', 'Sharp.', 'the summary'),
  C('c2', 'Only this one touches the customer.', 'Response 2 — Sam'),
  C('c3', 'Two of these are the same move.', 'Results'),
];

describe('the arrivals list', () => {
  test('renders the latest three, newest first, dimming with age', () => {
    const four = [...three, C('c4', 'Fourth.', 'Results')];
    const { container } = render(<RoomMeter phase="FEEDBACK" heading="Comments" body="4" arrivals={{ items: four, onPick: () => {} }} />);
    expect(container.querySelector('.meter').classList.contains('arrivals')).toBe(true);
    expect(container.querySelector('.meter h5')).toBeNull();
    const arr = [...container.querySelectorAll('.arr')];
    expect(arr.map((a) => a.querySelector('.ans').textContent)).toEqual(['Fourth.', 'Two of these are the same move.', 'Only this one touches the customer.']);
    expect(arr.map((a) => a.className)).toEqual(['arr', 'arr older', 'arr oldest']);
  });

  test('each card is the comment alone: no "On …" line, and never who wrote it', () => {
    const { container } = render(<RoomMeter phase="FEEDBACK" heading="Comments" body="3" arrivals={{ items: three, onPick: () => {} }} />);
    expect(container.querySelector('.arr .n')).toBeNull();
    expect([...container.querySelectorAll('.arr')].map((a) => a.textContent))
      .toEqual(['Two of these are the same move.', 'Only this one touches the customer.', 'Sharp.']);
    expect(container.textContent).not.toMatch(/Ada Lovelace|Response 2|summary/);
  });

  test('a click features that comment, by id', () => {
    const onPick = jest.fn();
    const { container } = render(<RoomMeter phase="FEEDBACK" heading="Comments" body="3" arrivals={{ items: three, onPick }} />);
    fireEvent.click(container.querySelectorAll('.arr')[1]);
    expect(onPick).toHaveBeenCalledWith('c2');
    // A control the host presses: a button, so it is reachable without a mouse.
    expect(container.querySelectorAll('.arr')[1].tagName).toBe('BUTTON');
  });

  test('the featured one leaves the list: it is on the wall, and is never shown twice', () => {
    const { container } = render(<RoomMeter phase="FEEDBACK" heading="Comments" body="3" arrivals={{ items: three, onPick: () => {}, featuredId: 'c2' }} />);
    const texts = [...container.querySelectorAll('.arr .ans')].map((a) => a.textContent);
    expect(texts).toEqual(['Two of these are the same move.', 'Sharp.']);
    expect(container.querySelector('.arr[data-featured]')).toBeNull();
  });

  test('with one featured, the list still shows the latest three of the rest', () => {
    const four = [...three, C('c4', 'Fourth.', 'Results')];
    const { container } = render(<RoomMeter phase="FEEDBACK" heading="Comments" body="4" arrivals={{ items: four, onPick: () => {}, featuredId: 'c4' }} />);
    expect([...container.querySelectorAll('.arr .ans')].map((a) => a.textContent))
      .toEqual(['Two of these are the same move.', 'Only this one touches the customer.', 'Sharp.']);
  });

  test('no arrivals, no list: the count stands alone', () => {
    const { container } = render(<RoomMeter phase="FEEDBACK" heading="Comments" body="0" arrivals={{ items: [], onPick: () => {} }} />);
    expect(container.querySelector('.meter').classList.contains('arrivals')).toBe(false);
    expect(container.querySelector('.arr')).toBeNull();
    expect(container.querySelector('h5')).toBeNull();
  });

  test('the waiting list and the arrivals never share a meter', () => {
    // Two lists in one column is the reflow the old ruling feared; a caller
    // that passes both gets the arrivals and no names.
    const { container } = render(
      <RoomMeter phase="FEEDBACK" heading="Comments" body="3"
        arrivals={{ items: three, onPick: () => {} }}
        waiting={{ names: ['Dana'], mode: 'pinned', onPreview: () => {}, onPreviewEnd: () => {}, onPin: () => {} }} />
    );
    expect(container.querySelector('.waiting')).toBeNull();
    expect(container.querySelectorAll('.arr')).toHaveLength(3);
  });
});
