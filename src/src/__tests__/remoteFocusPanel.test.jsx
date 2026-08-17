/**
 * THE PHONE'S CONTROL OVER THE ROOM'S SCREEN — components/RemoteFocusPanel.jsx
 * rendered, plus the wiring in HostRemote.jsx and GameHostPage.jsx read as
 * source.
 *
 * The panel is presentational and takes every action as a prop, so it renders
 * directly. What a mount CANNOT see is whether the two pages actually hand it
 * the right functions, whether the frame handler is removed as well as
 * registered, and whether the stage announces its own opens — so those are
 * source assertions against COMMENT-STRIPPED text, the pattern
 * `setupPanelCallSite.test.js` established and for the reason its header now
 * states correctly.
 *
 * No geometric assertions: jsdom has no layout engine. The CSS contract that
 * matters here — the 44px touch floor and the clamp that keeps the full text in
 * the DOM — is read from the stylesheet as text at the bottom.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent, within } from '@testing-library/react';
import RemoteFocusPanel from '../components/RemoteFocusPanel';

const answers = [
  { id: 'a1', playerName: 'Ada', answer: 'Because usage tracks value.' },
  { id: 'a2', playerName: 'Grace', answer: 'Because switching costs are high.' },
  { id: 'a3', playerName: 'Alan', answer: 'Because nobody has a substitute.' },
];

const renderPanel = (props = {}) => {
  const onFocus = jest.fn();
  render(
    <RemoteFocusPanel
      answers={answers}
      questionTitle="Where does pricing power come from?"
      labelFor={(answer, index) => answer.playerName || `Response ${index + 1}`}
      onFocus={onFocus}
      {...props}
    />,
  );
  return { onFocus };
};

const row = (name) => screen.getAllByTestId('focus-row')
  .find((r) => r.textContent.includes(name));

describe('what the panel says it does', () => {
  test('it states that these controls change the ROOM, not the phone', () => {
    // rejects: a bare "Enlarge" on a phone, which reads as "make this bigger
    // for me". The host is holding this precisely because they are not at the
    // laptop, and a control that quietly resized their own screen would be the
    // opposite of a remote.
    renderPanel();
    expect(screen.getByText(/room's screen/i)).toBeInTheDocument();
  });

  test('it names the question it would enlarge', () => {
    // rejects: an unlabelled button. The projector shows the question; the
    // phone in the host's hand does not, so "Enlarge the question" with no
    // question named is a button pressed on faith in front of a room.
    renderPanel();
    expect(screen.getByText('Where does pricing power come from?')).toBeInTheDocument();
  });
});

describe('enlarging the question', () => {
  test('pressing it asks for a question focus', () => {
    const { onFocus } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /enlarge the question/i }));
    expect(onFocus).toHaveBeenCalledWith({ focus: 'question' });
  });

  test('while it is showing, the same control shrinks it', () => {
    // rejects: a one-way button. The host must be able to undo from the same
    // place they did it, without working out which other control reverses it.
    const { onFocus } = renderPanel({ focus: { focus: 'question', index: null } });
    const button = screen.getByRole('button', { name: /shrink the question/i });
    expect(button).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(button);
    expect(onFocus).toHaveBeenCalledWith({ focus: 'none' });
  });

  test('with no question loaded there is nothing to enlarge', () => {
    renderPanel({ questionTitle: '' });
    expect(screen.getByRole('button', { name: /enlarge the question/i })).toBeDisabled();
  });
});

describe('putting one response on the wall', () => {
  test('every response offers Show the room', () => {
    renderPanel();
    expect(screen.getAllByTestId('focus-row')).toHaveLength(3);
    for (const r of screen.getAllByTestId('focus-row')) {
      expect(within(r).getByRole('button', { name: /show the room/i })).toBeInTheDocument();
    }
  });

  test('it sends the INDEX, not the answer', () => {
    // rejects: posting the answer id or text. The endpoint stores a position
    // into the round's rows, and an id would have to be resolved server-side on
    // a control pressed while a room waits.
    const { onFocus } = renderPanel();
    fireEvent.click(within(row('Grace')).getByRole('button', { name: /show the room/i }));
    expect(onFocus).toHaveBeenCalledWith({ focus: 'answer', index: 1 });
  });

  test('index 0 is sendable', () => {
    // rejects: any truthiness check on the index between here and the handler.
    // The first response is the one a host is most likely to enlarge.
    const { onFocus } = renderPanel();
    fireEvent.click(within(row('Ada')).getByRole('button', { name: /show the room/i }));
    expect(onFocus).toHaveBeenCalledWith({ focus: 'answer', index: 0 });
  });

  test('only ONE row can read as showing', () => {
    // rejects: a per-row flag. The focus is a single value, so two rows both
    // believing they are showing is a state the data cannot represent — and
    // deriving each row from the one focus is what keeps it that way.
    renderPanel({ focus: { focus: 'answer', index: 1 } });
    expect(screen.getAllByRole('button', { name: /stop showing/i })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /show the room/i })).toHaveLength(2);
    expect(row('Grace')).toHaveClass('is-showing');
  });

  test('the showing row toggles off rather than re-sending itself', () => {
    const { onFocus } = renderPanel({ focus: { focus: 'answer', index: 2 } });
    fireEvent.click(within(row('Alan')).getByRole('button', { name: /stop showing/i }));
    expect(onFocus).toHaveBeenCalledWith({ focus: 'none' });
  });

  test('a busy panel refuses every control', () => {
    // rejects: leaving the list live through the round trip. Two taps inside
    // one trip put two different responses on the wall in sequence.
    renderPanel({ busy: true, focus: { focus: 'answer', index: 0 } });
    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeDisabled();
    }
  });
});

describe('the state a host cannot work out', () => {
  test('when something is showing there is one unambiguous way back', () => {
    // rejects: relying on the toggles alone. A host whose phone was in a pocket
    // through two taps does not know WHICH control reverses what — this is the
    // one they can press without knowing.
    renderPanel({ focus: { focus: 'answer', index: 1 } });
    const clear = screen.getByTestId('focus-clear');
    expect(clear).toHaveTextContent(/back to the normal view/i);
  });

  test('with nothing showing that control is absent, not disabled', () => {
    // rejects: a permanently greyed button, which is a control that never means
    // anything — the same rule that keeps Skip off the results screen.
    renderPanel({ focus: { focus: 'none', index: null } });
    expect(screen.queryByTestId('focus-clear')).not.toBeInTheDocument();
  });
});

describe('before any responses have arrived', () => {
  test('the empty list says which kind of empty it is', () => {
    // rejects: an empty box. Responses arrive DURING the round, so an empty
    // list is the normal early state rather than a fault, and saying so stops
    // a host hunting for a control that is not due yet.
    renderPanel({ answers: [] });
    expect(screen.getByText(/no responses yet/i)).toBeInTheDocument();
    expect(screen.queryAllByTestId('focus-row')).toHaveLength(0);
  });

  test('the question can still be enlarged', () => {
    // The two halves are independent: a host reads the prompt out loud before
    // anybody has answered, and that is exactly when they want it big.
    renderPanel({ answers: [] });
    expect(screen.getByRole('button', { name: /enlarge the question/i })).toBeEnabled();
  });
});

describe('an anonymous round', () => {
  test('a row with no name is labelled by position, not by a placeholder', () => {
    // rejects: printing "Anonymous" or a blank. The label the phone shows is
    // the label the ROOM is about to see beside a full-screen answer, so a
    // component that invented a name here would de-anonymise a hidden round by
    // the act of enlarging one response. The server has already redacted
    // `playerName`; positional labelling is what the stage falls back to too.
    render(
      <RemoteFocusPanel
        answers={[{ id: 'a1', answer: 'Because usage tracks value.' }]}
        questionTitle="Q"
        labelFor={(answer, index) => answer.playerName || `Response ${index + 1}`}
      />,
    );
    expect(screen.getByText('Response 1')).toBeInTheDocument();
    expect(screen.queryByText(/anonymous/i)).not.toBeInTheDocument();
  });
});

/* ------------------------------------------------------------- the pages --- */

function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/([^:'"`\\])\/\/.*$/gm, '$1');
}

const src = (...p) => path.join(__dirname, '..', ...p);
const remote = stripComments(fs.readFileSync(src('HostRemote.jsx'), 'utf8'));
const host = stripComments(fs.readFileSync(src('GameHostPage.jsx'), 'utf8'));

describe('the remote is wired to it', () => {
  test('it renders the panel and passes the server\'s focus, not its own', () => {
    // rejects: a locally-held focus. The phone polls every 2s and is stale by
    // construction; a local copy would show "Show the room" for a response the
    // room is already reading.
    expect(remote).toMatch(/<RemoteFocusPanel/);
    expect(remote).toMatch(/focus=\{stageFocus\}/);
    expect(remote).toMatch(/const stageFocus = snapshot\?\.stageFocus \|\| NO_FOCUS/);
  });

  test('the post is authenticated', () => {
    // rejects: a plain fetch. /stage-focus carries the Cognito authorizer —
    // this control puts one named person's response full-screen on a wall, so
    // it is not a public route, and a bare fetch would 401 every time.
    // `[^;]*` and not `[^)]*`: the URL is a template literal containing
    // `apiBase()`, so a paren-excluding class stops before it ever reaches the
    // path and the assertion fails against correct code.
    expect(remote).toMatch(/authFetch\([^;]*stage-focus/);
    expect(remote).not.toMatch(/[^h]fetch\(`\$\{apiBase\(\)\}games\/\$\{gameId\}\/stage-focus/);
  });

  test('a press that changes nothing sends nothing', () => {
    expect(remote).toMatch(/if \(sameFocus\(next, stageFocus\)\) return;/);
  });

  test('it re-reads rather than patching its own copy', () => {
    // rejects: an optimistic local edit, which a failed write leaves lying —
    // the same reasoning toggleCategory already follows in this file.
    expect(remote).toMatch(/setStageFocus[\s\S]{0,1400}await pollState\(gameId\)/);
  });
});

describe('the stage follows and announces', () => {
  test('the frame handler is registered AND removed', () => {
    // rejects: a handler outliving its session and firing with a stale closure
    // — what the registered/removed symmetry check in hostControls.test.js
    // exists for after `gameEnded` shipped with one half missing.
    expect(host).toMatch(/onMessage\('stageFocusChanged'/);
    expect(host).toMatch(/offMessage\('stageFocusChanged'\)/);
  });

  test('a frame it should ignore is ignored, and ignoring is not closing', () => {
    // rejects: applying `focusFromFrame`'s null as a close, which would let a
    // late frame from a previous round shut the spotlight the host just opened.
    expect(host).toMatch(/const focus = focusFromFrame\(data, gameStateRef\.current\);\s*if \(!focus\) return;/);
  });

  test('the clamp reads a ref, not the state', () => {
    // rejects: reading `answers` from the frozen closure. This effect registers
    // once at first render when `answers` is [], so every incoming index would
    // be compared against 0 and the phone's spotlight would never open at all.
    expect(host).toMatch(/answerCount: answersRef\.current\.length/);
  });

  test('the stage announces its OWN opens, so the phone follows too', () => {
    // rejects: a one-way channel. Without this the host opens a spotlight on
    // the laptop and the phone still offers "Show the room" for it.
    expect(host).toMatch(/const openSpotlight = \(idx\) => \{[\s\S]{0,400}publishFocus\(/);
    expect(host).toMatch(/const expandQuestion = \(\) => \{[\s\S]{0,200}publishFocus\(\{ focus: 'question' \}\)/);
    expect(host).toMatch(/const closeSpotlight[\s\S]{0,400}publishFocus\(\{ focus: 'none' \}\)/);
  });

  test('every way into the spotlight goes through the one opener', () => {
    // rejects: a bare `setSpotlightIndex` left at one of the three call sites —
    // the card's click, its Enter/Space, and the spotlight's own arrows. One
    // forgotten site is a spotlight the phone never hears about.
    const bare = remoteless(host);
    expect(bare).not.toMatch(/onClick=\{\(\) => setSpotlightIndex\(idx\)\}/);
    expect(bare).not.toMatch(/onIndex=\{setSpotlightIndex\}/);
  });

  test('a restored focus waits for the answers it indexes into', () => {
    // rejects: applying it during restoreGameState. AnswerSpotlight reads
    // `answers[index].points`, so an index applied before the rows land THROWS
    // rather than rendering nothing — and `answerProgress` is no substitute,
    // since get-game-state only fills it for ASK# while a spotlight is a
    // RESULTS# thing.
    expect(host).toMatch(/pendingFocusRef\.current = gameStateData\.stageFocus/);
    expect(host).toMatch(/pendingFocusRef\.current[\s\S]{0,300}answerCount: answers\.length/);
  });
});

/** The host source with nothing removed — named so the intent above is plain. */
function remoteless(text) { return text; }

/* ------------------------------------------------------------------ CSS --- */

const CSS = fs.readFileSync(src('HostRemote.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function block(selector) {
  const at = CSS.indexOf(`${selector} {`);
  if (at === -1) return '';
  return CSS.slice(at, CSS.indexOf('}', at));
}

describe('the stylesheet contract', () => {
  test('the small button narrows its padding, never its height', () => {
    // rejects: shrinking below the 44px touch floor on the surface a hurried
    // thumb uses most, with a room watching.
    const small = block('.hr-btn--small');
    expect(small).toMatch(/padding:/);
    expect(small).not.toMatch(/min-height:/);
    expect(block('.hr-btn')).toMatch(/min-height:\s*48px/);
  });

  test('the response text is clamped in CSS, so the full string stays readable', () => {
    // rejects: truncating in JS with an ellipsis. A reduction with no recovery
    // is a deletion — the whole answer must remain in the DOM for a screen
    // reader and for anyone who wants to copy it.
    const text = block('.hr-focus__text');
    expect(text).toMatch(/-webkit-line-clamp/);
    expect(text).toMatch(/overflow:\s*hidden/);
  });

  test('the showing row is marked by more than colour', () => {
    // rejects: a background tint alone. The row carries a border change AND its
    // button reads "Stop showing", which is the fact rather than the hint.
    expect(block('.hr-focus__row.is-showing')).toMatch(/border-color:/);
  });

  test('a response and its button are stacked, not side by side', () => {
    // rejects: a two-column row, which on a 360px phone gives the text about
    // half the width — not enough to tell two answers apart, which is the
    // entire job of this list.
    expect(block('.hr-focus__row')).toMatch(/flex-direction:\s*column/);
  });
});
