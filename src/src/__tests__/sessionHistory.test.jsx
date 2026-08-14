/**
 * GOING BACK THROUGH ROUNDS THAT ALREADY HAPPENED.
 *
 *   "once you move on to a new question it would be nice to go back through AI
 *    responses, and results screens. perhaphs there is even a session tab that
 *    list questions so far, and lists those."
 *
 * The owner chose both shapes when asked — a tab listing the rounds AND arrows
 * between neighbours — with each round showing the question, its results, its
 * AI summary, and a way to regenerate that summary.
 *
 * NO NEW BACKEND. `POST /games/{gameId}/report` already returns every one of
 * those fields; `roundsFrom` normalises what create-report.js emits. So most of
 * what can go wrong here is in the normalising and in the edges of the stepping,
 * which is what these test.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import PastRound from '../components/PastRound';
import {
  roundsFrom, roundSubtitle, hasSummary, indexOfRound,
} from '../config/sessionHistory';

/** A report payload shaped the way create-report.js actually emits one. */
const report = (overrides = []) => ({
  detailedQuestions: overrides,
});

const q = (number, extra = {}) => ({
  questionNumber: number,
  questionData: { title: `Round ${number}`, category: 'Strategy', ...(extra.questionData || {}) },
  answers: extra.answers || [],
  voteStats: extra.voteStats || null,
  aiSummary: extra.aiSummary ?? null,
});

describe('turning a report into a list of rounds', () => {
  // rejects: THE ORDERING BUG THIS IS MOST LIKELY TO HAVE. create-report builds
  //          `detailedQuestions` from a Map keyed by strings, and string order
  //          puts "10" before "2". A history list that shows round ten second
  //          is not a history list.
  test('rounds come back in the order they were played', () => {
    const rounds = roundsFrom(report([q('10'), q('2'), q('1')]));
    expect(rounds.map((r) => r.ordinal)).toEqual([1, 2, 10]);
  });

  // rejects: handing the AI-summary endpoint an unpadded number. It takes
  //          `questionId` in the padded form the rest of the system uses, so
  //          Regenerate on round 2 would address a round that does not exist.
  test('the round number is padded, ready to send back', () => {
    expect(roundsFrom(report([q('2')]))[0].number).toBe('002');
  });

  // rejects: losing the question. The owner asked for it explicitly, and a
  //          results screen with no question on it is unreadable a quarter of
  //          an hour later.
  test('the question survives, under either of its two names', () => {
    const withDetail = roundsFrom(report([q('1', {
      questionData: { title: 'What matters', detail: 'the long form' },
    })]))[0];
    expect(withDetail.title).toBe('What matters');
    expect(withDetail.detail).toBe('the long form');

    // Trivia rounds carry the same text under `questionDetail` instead.
    const trivia = roundsFrom(report([q('1', {
      questionData: { title: 'Capital?', questionDetail: 'Of France' },
    })]))[0];
    expect(trivia.detail).toBe('Of France');
  });

  // rejects: dropping the trivia options and the correct answer. A past round
  //          is exactly where somebody goes to check what the answer was.
  test('trivia options and the answer come through', () => {
    const round = roundsFrom(report([q('1', {
      questionData: {
        optionA: 'Berlin', optionB: 'Paris', optionD: 'Madrid',
        correctAnswer: 'OptionB', answerDetails: 'It has been since 987.',
      },
    })]))[0];
    // Blank slots are dropped rather than rendered as empty bullets.
    expect(round.options).toEqual(['Berlin', 'Paris', 'Madrid']);
    expect(round.correctAnswer).toBe('OptionB');
    expect(round.answerDetails).toBe('It has been since 987.');
  });

  // rejects: a payload with nothing in it throwing. A session in its first
  //          minutes has no report at all, which is the normal state, not an
  //          error.
  test('an empty or missing payload is an empty list', () => {
    expect(roundsFrom(null)).toEqual([]);
    expect(roundsFrom({})).toEqual([]);
    expect(roundsFrom(report([]))).toEqual([]);
  });

  // rejects: a summary object that exists but holds nothing readable being
  //          counted as a summary — generation failed part way, or the row is
  //          old. Both the list badge and the button's label key off this, and
  //          both would lie.
  test('an empty summary object does not count as a summary', () => {
    expect(hasSummary({ aiSummary: null })).toBe(false);
    expect(hasSummary({ aiSummary: {} })).toBe(false);
    expect(hasSummary({ aiSummary: { summaryText: '   ' } })).toBe(false);
    expect(hasSummary({ aiSummary: { summaryText: 'It went well.' } })).toBe(true);
    expect(hasSummary({ aiSummary: { discussionQuestions: ['Why?'] } })).toBe(true);
  });

  // rejects: a bare number where a sentence belongs, and a singular "1
  //          responses".
  test('the row subtitle reads as a sentence', () => {
    expect(roundSubtitle({ category: 'Strategy', answers: [1, 2] })).toBe('Strategy · 2 responses');
    expect(roundSubtitle({ category: '', answers: [1] })).toBe('1 response');
    expect(roundSubtitle({ answers: [] })).toBe('0 responses');
  });

  // rejects: looking a round up by position. The arrows step by position, but a
  //          caller opening a round from elsewhere has a NUMBER — and after
  //          sorting the two are not the same thing.
  test('a round can be found by its number, padded or not', () => {
    const rounds = roundsFrom(report([q('10'), q('2')]));
    expect(indexOfRound(rounds, '2')).toBe(0);
    expect(indexOfRound(rounds, '002')).toBe(0);
    expect(indexOfRound(rounds, 10)).toBe(1);
    expect(indexOfRound(rounds, 99)).toBe(-1);
  });
});

describe('reopening one round', () => {
  const rounds = roundsFrom(report([
    q('1', {
      questionData: { title: 'First question', detail: 'Some context' },
      answers: [{ answer: 'A good answer', playerName: 'Ada', rank: 1 }],
      aiSummary: { summaryText: 'The room agreed.', discussionQuestions: ['And then?'] },
    }),
    q('2', { questionData: { title: 'Second question' }, answers: [] }),
  ]));

  function mount(props = {}) {
    const onIndex = jest.fn();
    const onClose = jest.fn();
    const onRegenerate = jest.fn();
    const utils = render(
      <PastRound
        rounds={rounds}
        index={0}
        onIndex={onIndex}
        onClose={onClose}
        onRegenerate={onRegenerate}
        {...props}
      />,
    );
    return { ...utils, onIndex, onClose, onRegenerate };
  }

  // rejects: THE THREE THINGS THE OWNER ASKED A PAST ROUND TO SHOW, all at once.
  test('it shows the question, the results and the AI summary', () => {
    mount();
    expect(screen.getByText('First question')).toBeInTheDocument();
    expect(screen.getByText('Some context')).toBeInTheDocument();
    expect(screen.getByText('A good answer')).toBeInTheDocument();
    expect(screen.getByText('The room agreed.')).toBeInTheDocument();
    expect(screen.getByText('And then?')).toBeInTheDocument();
  });

  test('a null index renders nothing', () => {
    const { container } = mount({ index: null });
    expect(container).toBeEmptyDOMElement();
  });

  // rejects: an empty round rendering as a blank panel, which reads as a failed
  //          load and sends the host hunting for a bug that is not there.
  test('a round nobody answered says so', () => {
    mount({ index: 1 });
    expect(screen.getByText(/nobody responded/i)).toBeInTheDocument();
  });

  test('the X and the backdrop both close it', () => {
    const { onClose, container } = mount();
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(container.querySelector('.past-round__scrim'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  // rejects: dropping the arrows the owner explicitly chose alongside the list.
  test('the arrows step between neighbouring rounds', () => {
    const { onIndex } = mount();
    fireEvent.click(screen.getByRole('button', { name: /next round/i }));
    expect(onIndex).toHaveBeenCalledWith(1);
  });

  test('the pager is disabled at the ends', () => {
    const first = mount({ index: 0 });
    expect(screen.getByRole('button', { name: /previous round/i })).toBeDisabled();
    first.unmount();
    mount({ index: 1 });
    expect(screen.getByRole('button', { name: /next round/i })).toBeDisabled();
  });

  test('arrow keys step too, and stop once it closes', () => {
    const { onIndex, unmount } = mount();
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(onIndex).toHaveBeenCalledWith(1);
    unmount();
    onIndex.mockClear();
    fireEvent.keyDown(document, { key: 'ArrowRight' });
    expect(onIndex).not.toHaveBeenCalled();
  });

  // rejects: sending the index where the endpoint takes a padded round number.
  //          Round 2 at position 1 would regenerate whatever round "1" is.
  test('regenerate names the round, not its position', () => {
    const { onRegenerate } = mount({ index: 1 });
    fireEvent.click(screen.getByRole('button', { name: /generate summary/i }));
    expect(onRegenerate).toHaveBeenCalledWith('002');
  });

  // rejects: offering "Regenerate" over a round that has no summary, which
  //          invites the reasonable question of what is being regenerated.
  test('the button says what it will actually do', () => {
    const withOne = mount({ index: 0 });
    expect(screen.getByRole('button', { name: /^regenerate summary$/i })).toBeInTheDocument();
    withOne.unmount();
    mount({ index: 1 });
    expect(screen.getByRole('button', { name: /^generate summary$/i })).toBeInTheDocument();
  });

  // rejects: leaving the button live while a worker is running, so a host
  //          presses it four times and queues four generations.
  test('it says it is working and refuses a second press', () => {
    const { onRegenerate } = mount({ regenerating: ['001'] });
    const button = screen.getByRole('button', { name: /regenerating/i });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onRegenerate).not.toHaveBeenCalled();
  });

  // rejects: the dialog deciding anonymity for itself. Three sites re-deriving
  //          that predicate is what hid the names and the podium for a whole
  //          session; this one takes the caller's answer.
  test('the author label is the caller’s to decide', () => {
    mount({ labelFor: () => 'Response 1' });
    expect(screen.getByText('Response 1')).toBeInTheDocument();
    expect(screen.queryByText('Ada')).not.toBeInTheDocument();
  });
});

/*
 * THE SCROLL CONTRACT — the tallest dialog in the product after the prompt
 * editor, and jsdom cannot see any of it.
 */
describe('a long round can be scrolled', () => {
  const fs = require('fs');
  const path = require('path');
  const CSS = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');
  const block = (selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = CSS.match(new RegExp(`(^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm'));
    if (!m) throw new Error(`No rule for "${selector}" — renamed?`);
    return m[2];
  };

  // rejects: the flex trap, for the sixth time. A past round holds a question,
  //          every response AND a full summary, so it is the likeliest dialog
  //          in the product to overflow.
  test('the body is what scrolls', () => {
    const body = block('.past-round__body');
    expect(body).toMatch(/overflow-y:\s*auto/);
    expect(body).toMatch(/min-height:\s*0/);
  });

  // rejects: the pager or the Close button being what gets compressed — the
  //          exact shape of the iPad trap, where the way out left the screen.
  test('the way out does not shrink away', () => {
    expect(block('.past-round__head')).toMatch(/flex:\s*none/);
    expect(block('.past-round__nav')).toMatch(/flex:\s*none/);
  });

  test('the card is capped against the viewport', () => {
    expect(block('.past-round')).toMatch(/max-height:/);
    expect(block('.past-round')).toMatch(/flex-direction:\s*column/);
  });
});

/*
 * THE TAB EXISTS AND THE PAGE FEEDS IT — read as text, because SessionSetupPanel
 * needs the whole host page around it and GameHostPage cannot be mounted here.
 */
describe('the Rounds tab is wired to the page', () => {
  const fs = require('fs');
  const path = require('path');
  const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

  // rejects: shipping the dialog with no way to reach it.
  test('the tab is offered', () => {
    expect(strip(read('config', 'setupPanel.js'))).toMatch(/id:\s*'history'/);
  });

  // rejects: a tab that renders its empty state forever because nothing ever
  //          fetches — which is exactly how the Questions tab shipped once.
  test('the page loads rounds when the panel opens', () => {
    const host = strip(read('GameHostPage.jsx'));
    expect(host).toMatch(/if \(setupPanelOpen\) loadRounds\(\)/);
    expect(host).toMatch(/rounds=\{rounds\}/);
    expect(host).toMatch(/onOpenRound=\{setPastRoundIndex\}/);
  });

  // rejects: reusing the read-only report GET, which returns only a report that
  //          was already saved — so the tab would be empty for every session
  //          that had not generated one.
  test('it asks the route that assembles the rounds', () => {
    expect(strip(read('GameHostPage.jsx'))).toMatch(/games\/\$\{gameId\}\/report[\s\S]{0,120}method: 'POST'/);
  });

  /*
    SCOPED TO regenerateRoundSummary'S OWN BODY, and the first version was not.
    It asserted `generateNew=true` appeared somewhere in the file — and it does,
    in `fetchAISummary`'s retry, on a completely different call. So deleting it
    from the button's own request left the test green over a button that
    silently re-read the cache. Found by mutating; the same gap, in the same
    shape, as one caught in playerParticipation.test.js earlier today.
  */
  const regenBody = () => {
    const host = strip(read('GameHostPage.jsx'));
    const at = host.indexOf('const regenerateRoundSummary');
    expect(at).toBeGreaterThan(-1);
    return host.slice(at, host.indexOf('\n  };', at));
  };

  /*
    THE FIRST VERSION OF THIS ASSERTED THE WRONG THING, and the codebase told
    me so. It checked for a literal `generateNew=true` in this function, which
    meant it was checking that the button rolled its OWN fetch — and
    `aiSummaryWiring.test.js` exists precisely to forbid that. A second
    hand-rolled trigger has already shipped once as a bug: it carried its own
    `.catch` that logged and cleared the watchdog, so a throw left the host with
    no request in flight and no sign of it. `ERR_INTERNET_DISCONNECTED` lands
    exactly there.

    So the requirement is the opposite of what I first wrote: go through the one
    trigger that classifies its own failure.
  */
  // rejects: a second hand-rolled trigger, which is a shape that has shipped
  //          broken before — and which loses the offline case, the 4xx case and
  //          the classifier's specific message with it.
  test('regenerate goes through the one sanctioned trigger', () => {
    const body = regenBody();
    expect(body).toMatch(/await triggerAISummary\(/);
    expect(body).not.toMatch(/fetch\(/);
    expect(body).not.toMatch(/generateNew/);
  });

  // rejects: pasting a round number into a URL unencoded. Padded numbers are
  //          safe today, but the value comes off the payload.
  test('the round number is encoded', () => {
    expect(regenBody()).toMatch(/encodeURIComponent\(roundNumber\)/);
  });

  // rejects: swallowing a refused regeneration. The button releases and the
  //          host is told which failure it was — `headline` and `detail` are
  //          what the classifier actually returns, and reaching for a
  //          non-existent `message` would show the fallback sentence every
  //          time, discarding the specific one.
  test('a refused regeneration releases the button and says why', () => {
    const body = regenBody();
    expect(body).toMatch(/if \(!result\.ok\)/);
    expect(body).toMatch(/setRegeneratingRounds\(\(prev\) => prev\.filter/);
    expect(body).toMatch(/headline/);
    expect(body).toMatch(/detail/);
  });

  // rejects: leaving the button stuck. The 202 says "started", and only the
  //          socket frame says "finished" — so that frame has to release it.
  test('the summary-ready frame releases the button and refreshes the list', () => {
    const host = strip(read('GameHostPage.jsx'));
    const at = host.indexOf("onMessage('aiSummaryReady'");
    expect(at).toBeGreaterThan(-1);
    const handler = host.slice(at, at + 1200);
    expect(handler).toMatch(/setRegeneratingRounds/);
    expect(handler).toMatch(/loadRounds\(\)/);
  });
});
