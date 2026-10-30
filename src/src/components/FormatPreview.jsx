import React from 'react';
import { BUILD_KIND, EVENT_KIND } from '../config/engagementKinds';

/**
 * A FORMAT, DRAWN (docs/design/new-engagement README §3.3, frames 1, 1b, 4).
 *
 * A small picture of what the room sees, built from boxes so it costs no
 * image and no request. It is decoration: `aria-hidden`, with the caption
 * beside it carrying the meaning.
 *
 * PLAYS ONCE, AND THE RESTING CSS IS THE END STATE. The base rules in
 * GameSetupDialog.css draw the finished picture (Trivia's C green, the poll's
 * bars full, Call & Answer's winner amber). `play` > 0 adds `is-play`, whose
 * keyframes run FROM a start state back to those base rules, once, in under
 * two seconds. A new `play` value remounts the picture, so it replays on
 * hover, focus, choice or Replay. `prefers-reduced-motion` removes the
 * animation and leaves the end state, by construction: nothing here depends
 * on an animation finishing. gameSetupPalette.test.js holds every keyframe to
 * that rule and forbids an infinite one.
 */
const SLUG = {
  'call-and-answer': 'ca',
  trivia: 'tr',
  poll: 'po',
  wavelength: 'wl',
  survey: 'sv',
  [BUILD_KIND]: 'br',
  [EVENT_KIND]: 'ev',
};

function Art({ slug }) {
  switch (slug) {
    case 'ca':
      return (
        <>
          <i className="gsd-fp-ans is-win"><b /><em>9</em></i>
          <i className="gsd-fp-ans"><b /><em>4</em></i>
          <i className="gsd-fp-ans"><b /><em>2</em></i>
        </>
      );
    case 'tr':
      return (
        <span className="gsd-fp-grid">
          <i className="gsd-fp-opt">A</i>
          <i className="gsd-fp-opt">B</i>
          <i className="gsd-fp-opt is-right">C</i>
          <i className="gsd-fp-opt">D</i>
        </span>
      );
    case 'po':
      return (
        <>
          <i className="gsd-fp-bar"><b style={{ '--w': '82%' }} /></i>
          <i className="gsd-fp-bar"><b style={{ '--w': '46%' }} /></i>
          <i className="gsd-fp-bar"><b style={{ '--w': '20%' }} /></i>
        </>
      );
    case 'wl':
      return (
        <span className="gsd-fp-cloud">
          <i className="gsd-fp-word is-big">bridge ×5</i>
          <i className="gsd-fp-word">link</i>
          <i className="gsd-fp-word">span</i>
        </span>
      );
    case 'sv':
      return (
        <>
          <i className="gsd-fp-row"><b className="gsd-fp-tick" /><s /></i>
          <i className="gsd-fp-row"><b className="gsd-fp-tick" /><s /></i>
          <i className="gsd-fp-row"><b className="gsd-fp-tick" /><s /></i>
        </>
      );
    case 'br':
      return (
        <span className="gsd-fp-pair">
          <i className="gsd-fp-mock is-pick">A</i>
          <i className="gsd-fp-mock">B</i>
        </span>
      );
    case 'ev':
      return (
        <>
          <i className="gsd-fp-slot"><em>09:00</em><s /></i>
          <i className="gsd-fp-slot is-now"><em>09:20</em><s /></i>
          <i className="gsd-fp-slot"><em>09:45</em><s /></i>
        </>
      );
    default:
      return (
        <>
          <i className="gsd-fp-blank" />
          <i className="gsd-fp-blank" />
        </>
      );
  }
}

export default function FormatPreview({ format = '', play = 0, size = 'card' }) {
  const slug = SLUG[format] || 'none';
  return (
    <span
      key={play}
      className={`gsd-fp gsd-fp--${slug} gsd-fp--${size}${play > 0 ? ' is-play' : ''}`}
      aria-hidden="true"
      data-format={format || 'none'}
    >
      <Art slug={slug} />
    </span>
  );
}

/**
 * What the side pane's caption says the room and the phones do. The words
 * the room preview and the phone use for names are the shipped card's
 * (SessionOptions.jsx): hidden until the vote closes, then shown with the
 * results. README §6 "Names visible, in the shipped words".
 */
export function previewCaption(format, { view = 'room', anonymous = true } = {}) {
  const names = anonymous
    ? 'Names are hidden until the vote closes.'
    : 'Every answer carries its author’s name from the moment voting opens.';
  const room = {
    'call-and-answer': `Room: answers appear, then the room votes. ${names}`,
    trivia: 'Room: the question and four answers; the right one lights up with its explanation, then the scoreboard.',
    poll: 'Room: each result fills in live as people answer.',
    wavelength: 'Room: the words people gave, the ones the room shares most on top.',
    survey: 'Room: nothing to project. People answer on their phones in their own time.',
    [BUILD_KIND]: 'Room: Claude’s question, with the mockups or ideas to choose between.',
    [EVENT_KIND]: 'Room: your agenda, one item at a time, behind one join code.',
  };
  const phone = {
    'call-and-answer': `Phones: type an answer, then vote. ${anonymous ? 'Your name is hidden until the vote closes.' : 'Your name is shown with your answer.'}`,
    trivia: 'Phones: tap A, B, C or D.',
    poll: 'Phones: pick, rate, yes/no or a few words.',
    wavelength: 'Phones: type one word for the subject.',
    survey: 'Phones: a short form, answered whenever suits them.',
    [BUILD_KIND]: 'Phones: pick A or B and say why; suggest ideas any time.',
    [EVENT_KIND]: 'Phones: the same join code follows every item.',
  };
  const table = view === 'phone' ? phone : room;
  return table[format] || 'Choose a format to see what the room sees.';
}
