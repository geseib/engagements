/**
 * ARRIVALS IN THE METER — refresh-2026-09-22 RATIONALE §6 step 5, applied
 * to the FEEDBACK round's comments (the owner, 2026-09-22: "a way to get
 * that info up on the screen … click on those would allow everyone to see
 * them").
 *
 * The meter gains an `arrivals` slot: the last few comments as they land,
 * newest brightest, each saying what it is about and NEVER who wrote it —
 * the mockup's "Response 31" is a position, not a person. A click is the
 * host featuring one; the featured one is marked.
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
    expect(container.querySelector('.meter h5').textContent).toBe('Arriving');
    const arr = [...container.querySelectorAll('.arr')];
    expect(arr.map((a) => a.querySelector('.ans').textContent)).toEqual(['Fourth.', 'Two of these are the same move.', 'Only this one touches the customer.']);
    expect(arr.map((a) => a.className)).toEqual(['arr', 'arr older', 'arr oldest']);
  });

  test('says what each is about and never who wrote it', () => {
    const { container } = render(<RoomMeter phase="FEEDBACK" heading="Comments" body="3" arrivals={{ items: three, onPick: () => {} }} />);
    expect([...container.querySelectorAll('.arr .n')].map((n) => n.textContent)).toEqual(['On Results', 'On Response 2 — Sam', 'On the summary']);
    expect(container.textContent).not.toMatch(/Ada Lovelace/);
  });

  test('a click features that comment, by id', () => {
    const onPick = jest.fn();
    const { container } = render(<RoomMeter phase="FEEDBACK" heading="Comments" body="3" arrivals={{ items: three, onPick }} />);
    fireEvent.click(container.querySelectorAll('.arr')[1]);
    expect(onPick).toHaveBeenCalledWith('c2');
    // A control the host presses: a button, so it is reachable without a mouse.
    expect(container.querySelectorAll('.arr')[1].tagName).toBe('BUTTON');
  });

  test('the featured one is marked, and the mark says so in words', () => {
    const { container } = render(<RoomMeter phase="FEEDBACK" heading="Comments" body="3" arrivals={{ items: three, onPick: () => {}, featuredId: 'c2' }} />);
    const featured = container.querySelector('.arr[data-featured]');
    expect(featured.querySelector('.ans').textContent).toBe('Only this one touches the customer.');
    expect(featured.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelectorAll('.arr[aria-pressed="true"]')).toHaveLength(1);
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
