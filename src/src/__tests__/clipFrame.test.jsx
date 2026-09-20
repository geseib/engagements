import React from 'react';
import { render, screen } from '@testing-library/react';
import ClipFrame from '../marketing/components/ClipFrame';
import { CLIPS } from '../marketing/content/clips';

jest.mock('../marketing/useScrollProgress', () => ({
  __esModule: true,
  default: jest.fn(),
  prefersReducedMotion: jest.fn(() => false),
}));

// eslint-disable-next-line global-require
const { prefersReducedMotion } = require('../marketing/useScrollProgress');

const SLOTS = ['trivia-host', 'trivia-player', 'poll-host', 'poll-player', 'join-qr', 'builder', 'report'];

afterEach(() => {
  prefersReducedMotion.mockReturnValue(false);
});

test('the manifest carries exactly the seven slots the spec defines', () => {
  expect(Object.keys(CLIPS).sort()).toEqual([...SLOTS].sort());
});

test.each(SLOTS)('%s describes itself to someone who cannot see it', (slot) => {
  expect(CLIPS[slot].alt.length).toBeGreaterThan(20);
  expect(CLIPS[slot].caption.length).toBeGreaterThan(5);
  expect(['tv', 'phone', 'laptop']).toContain(CLIPS[slot].frame);
});

test('with no recording yet, a slot is a captioned still — never a dead player', () => {
  const { container } = render(<ClipFrame slot="trivia-host" />);
  expect(container.querySelector('video')).toBeNull();
  expect(screen.getByRole('img', { name: CLIPS['trivia-host'].alt })).toBeInTheDocument();
  expect(screen.getByText(CLIPS['trivia-host'].caption)).toBeInTheDocument();
});

test('with a recording, it is a muted, looping, inline video that waits to be seen', () => {
  const clip = { ...CLIPS['poll-host'], poster: '/assets/marketing/poll-host.jpg', webm: '/assets/marketing/poll-host.webm', mp4: '/assets/marketing/poll-host.mp4' };
  const { container } = render(<ClipFrame slot="poll-host" clip={clip} />);
  const video = container.querySelector('video');
  expect(video).not.toBeNull();
  expect(video.muted).toBe(true);
  expect(video).toHaveAttribute('loop');
  expect(video).toHaveAttribute('playsinline');
  expect(video).toHaveAttribute('preload', 'none');
  expect(video).toHaveAttribute('poster', clip.poster);
  expect(video).not.toHaveAttribute('autoplay');
  expect([...container.querySelectorAll('source')].map((s) => s.getAttribute('type'))).toEqual(['video/webm', 'video/mp4']);
});

test('an unknown slot renders nothing rather than crashing the page', () => {
  const { container } = render(<ClipFrame slot="nope" />);
  expect(container).toBeEmptyDOMElement();
});

describe('every slot renders exactly one still, hidden from assistive tech except its alt', () => {
  test.each(SLOTS)('%s', (slot) => {
    const { container } = render(<ClipFrame slot={slot} />);
    const imgs = screen.getAllByRole('img', { name: CLIPS[slot].alt });
    expect(imgs).toHaveLength(1);
    expect(container.querySelector('video')).toBeNull();

    const stillRoot = imgs[0];
    // The still's contents must not be exposed as text to assistive tech: every
    // child of the role="img" element is folded into a single aria-hidden subtree.
    const visibleChildren = [...stillRoot.children].filter(
      (child) => child.getAttribute('aria-hidden') !== 'true',
    );
    expect(visibleChildren).toHaveLength(0);
  });
});

test('the design-annotation badge never ships', () => {
  const { container } = render(
    <>
      {SLOTS.map((slot) => <ClipFrame key={slot} slot={slot} />)}
    </>,
  );
  expect(container.querySelector('.mk-clip-badge')).toBeNull();
});

test('a `still` prop selects which drawing renders, independent of the slot', () => {
  const { container } = render(<ClipFrame slot="trivia-host" still="tour-ask" />);
  expect(screen.getByText(/single biggest cause of rework/i)).toBeInTheDocument();
  // The trivia-host slot's OWN still (a different question, a Reveal chip)
  // must not also be on the page.
  expect(container.querySelector('.mk-ss-cta')).toBeNull();
});

test("a still's alt text still comes from the slot's manifest entry, not the still name", () => {
  render(<ClipFrame slot="trivia-host" still="tour-ask" />);
  expect(screen.getByRole('img', { name: CLIPS['trivia-host'].alt })).toBeInTheDocument();
});

test('a `still` prop is ignored once a recording exists', () => {
  const clip = { ...CLIPS['trivia-host'], poster: '/assets/marketing/trivia-host.jpg' };
  const { container } = render(<ClipFrame slot="trivia-host" still="tour-ask" clip={clip} />);
  expect(container.querySelector('.mk-ss')).toBeNull();
  expect(screen.getByRole('img', { name: clip.alt })).toBeInTheDocument();
});

test('reduced motion keeps the poster image even when a full recording is supplied', () => {
  prefersReducedMotion.mockReturnValue(true);
  const clip = { ...CLIPS['poll-host'], poster: '/assets/marketing/poll-host.jpg', webm: '/assets/marketing/poll-host.webm', mp4: '/assets/marketing/poll-host.mp4' };
  const { container } = render(<ClipFrame slot="poll-host" clip={clip} />);
  expect(container.querySelector('video')).toBeNull();
  const img = screen.getByAltText(clip.alt);
  expect(img.tagName).toBe('IMG');
});
