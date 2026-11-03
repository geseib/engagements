/**
 * WHAT A PARTICIPANT DOES IN A FEEDBACK ROUND.
 *
 * The owner: *"there is a new round where every one can comment on what they
 * have heard, they should have a copy of the feedback report … so they can
 * read, copy paste. in fact there should be like in chat response they click on
 * a section … and the comments now can be seen in the resulting round of
 * feedback"*.
 *
 * ── THE PLAYER-PAGE PRINCIPLE THIS APPEARS TO BREAK ────────────────────────
 *
 * `docs/design/player-redesign/17-results-call.html` says of the results phase:
 * *"Names are on the main screen now. The top responses and the discussion
 * prompts are up there too — this page will not repeat them."* And
 * `19-between-rounds.html` opens with *"Nothing to do here."*
 *
 * The phone is a companion, not a second projector. That principle is intact:
 * it says the phone does not duplicate the stage WHILE THE PARTICIPANT HAS NO
 * TASK. In a feedback round they have one, and it cannot happen anywhere but on
 * the device they are holding. The report is here because it is the substrate
 * of the work, not because it is being mirrored.
 *
 * This is a separate component rather than another branch inside
 * `PlayerPage.jsx` (3,229 lines) for one practical reason: that page does not
 * mount under jsdom, and a surface that collects customer prose about named
 * people should be testable by rendering it.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import FeedbackRoundPanel from '../components/FeedbackRoundPanel';

const ROUND = {
  number: '003',
  ordinal: 3,
  title: 'Competitive response',
  detail: 'Our largest competitor cut list price 20% this morning.',
  options: [],
  answers: [
    { rank: 1, answer: 'Freeze all discretionary discounting.', playerName: 'Dana Whitfield' },
    { rank: 1, answer: 'Re-price the onboarding package.', playerName: 'Sam Ortiz' },
  ],
  aiSummary: { summaryText: 'The room wants to defend price.' },
};

function mount(over = {}) {
  const props = {
    gameId: '4821',
    playerName: 'Ada Lovelace',
    questionNumber: '003',
    round: ROUND,
    comments: [],
    onSubmit: jest.fn().mockResolvedValue({ ok: true }),
    ...over,
  };
  return { ...render(<FeedbackRoundPanel {...props} />), props };
}

describe('the report is on the participant’s own device', () => {
  test('the question, the responses and the summary are all readable here', () => {
    mount();
    expect(screen.getByText('Competitive response')).toBeInTheDocument();
    expect(screen.getByText(/Freeze all discretionary discounting/)).toBeInTheDocument();
    expect(screen.getByText(/The room wants to defend price/)).toBeInTheDocument();
  });

  test('it is RoundReport, in its phone layout: three sections with real headings', () => {
    // phone-comments D1/D10: h1 for the page, h2 for each section, in order —
    // Workie's read first (fork 1), "Anything else" last (D3).
    mount();
    expect(screen.getByRole('heading', { level: 1, name: 'Comment on round 3' })).toBeInTheDocument();
    const h2 = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(h2).toEqual(['Workie’s read', 'The responses · 2', 'Anything else about this round?']);
  });

  test('the room’s controls are not offered to a participant', () => {
    // Regenerating the summary re-runs a Bedrock call for the whole room.
    mount();
    expect(screen.queryByRole('button', { name: /Regenerate|Generate summary/ })).toBeNull();
  });

  // "Workie had: …" (question-background spec §4) is a HOST-ONLY hint. This
  // panel is the participant's own copy of RoundReport — same renderer PastRound
  // uses for the host — and must never pass RoundReport's `showWorkieContext`
  // prop, even though the round's aiSummary carries the flags.
  test('never shows what Workie had, even when the round carries the flags', () => {
    mount({
      round: {
        ...ROUND,
        aiSummary: {
          ...ROUND.aiSummary,
          contextUsed: {
            background: true, setNote: true, eventDetails: true,
            hostInstructions: true, briefing: true,
          },
        },
      },
    });
    expect(screen.queryByTestId('workie-context-hint')).toBeNull();
  });
});

/** The same round with ballot numbers, as get-results sends them since 3c. */
const BALLOTED = {
  ...ROUND,
  answers: [
    { rank: 1, answer: 'Freeze all discretionary discounting.', playerName: 'Dana Whitfield', ballot: 2, votes: 6 },
    { rank: 1, answer: 'Re-price the onboarding package.', playerName: 'Sam Ortiz', ballot: 1, votes: 4 },
  ],
};

const tap = (name) => fireEvent.click(screen.getByRole('button', { name }));
const sheet = () => screen.getByRole('region', { name: /^(Comment on|Reply to)/ });

describe('every action names what it comments on (D1, D9, D10)', () => {
  test('three named actions; never the bare "Comment"', () => {
    // rejects: the owner's "both comment 'buttons' appear to go with the
    // responses" — three buttons that all read "Comment".
    mount();
    expect(screen.getByRole('button', { name: 'Comment on Workie’s read' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Reply to this response: / })).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Comment on the whole round' })).toBeInTheDocument();
    for (const b of screen.getAllByRole('button')) expect(b.textContent.trim()).not.toBe('Comment');
  });

  test('a reply button’s name begins with its visible label and says whose response (WCAG 2.5.3)', () => {
    mount({ round: BALLOTED });
    const b = screen.getByRole('button', { name: /Re-price/ });
    expect(b.textContent).toBe('Reply to this response');
    expect(b.getAttribute('aria-label')).toBe('Reply to this response: Re-price the onboarding package. (Sam Ortiz, response 1)');
  });

  test('responses are named by ballot number in words, with their votes', () => {
    // rejects: the rank in a circle ("1", "1" on a tie) the room read as a ranking.
    mount({ round: BALLOTED });
    expect(screen.getByText('Response 2 · 6 votes, the most')).toBeInTheDocument();
    expect(screen.getByText('Response 1 · 4 votes')).toBeInTheDocument();
    expect(document.querySelector('.past-round__rank')).toBeNull();
  });

  test('the results button and the bar are not this component’s; the lede says every comment has one target', () => {
    mount();
    expect(screen.getByText(/Every comment is attached to one thing/)).toBeInTheDocument();
  });
});

describe('the compose sheet names its target three ways (D4)', () => {
  test('is closed until a target is chosen', () => {
    mount();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  test('Workie’s read: the heading, a periwinkle quote, and the card outlined', () => {
    const { container } = mount();
    tap('Comment on Workie’s read');
    expect(sheet()).toHaveAccessibleName('Comment on Workie’s read');
    expect(container.querySelector('.fbr__quote--workie')).toBeTruthy();
    expect(container.querySelector('.fbr__quote-text').textContent).toMatch(/defend price/);
    expect(container.querySelector('.fbr-card--workie.is-target')).toBeTruthy();
    // The box is named by the heading and described by the name rule.
    expect(screen.getByRole('textbox')).toHaveAccessibleName('Comment on Workie’s read');
    expect(screen.getByRole('textbox')).toHaveAccessibleDescription(
      'Your name is shown with this comment. Everyone in the session can read it, and the host may put it on the room’s screen.',
    );
  });

  test('one response: "Reply to Sam Ortiz’s response", its ballot number and author quoted, Post reply', () => {
    const { container } = mount({ round: BALLOTED });
    fireEvent.click(screen.getByRole('button', { name: /Re-price/ }));
    expect(sheet()).toHaveAccessibleName('Reply to Sam Ortiz’s response');
    expect(container.querySelector('.fbr__quote-head').textContent).toBe('Response 1 · Sam Ortiz');
    expect(screen.getByRole('button', { name: /Post reply/ })).toBeInTheDocument();
    const outlined = container.querySelectorAll('.is-target');
    expect(outlined).toHaveLength(1);
    expect(outlined[0].textContent).toMatch(/Re-price the onboarding package/);
  });

  test('on a round with no names the heading reads "Reply to response 2"', () => {
    const anon = { ...BALLOTED, answers: BALLOTED.answers.map(({ playerName, ...r }) => r) };
    mount({ round: anon });
    fireEvent.click(screen.getByRole('button', { name: /Freeze/ }));
    expect(sheet()).toHaveAccessibleName('Reply to response 2');
  });

  test('a closed survey promises the opposite, because it is the opposite', () => {
    mount({ namesShown: false });
    tap('Comment on Workie’s read');
    expect(screen.getByText('Your name is not shown with this comment.')).toBeInTheDocument();
    expect(screen.queryByText(/Your name is shown/)).toBeNull();
  });

  test('a survey’s rows are its questions: titled by question, commented on as questions', () => {
    const survey = {
      ...ROUND,
      kind: 'survey',
      answers: [
        { answer: '1. How useful was today overall? (a rating) 2 answered.' },
        { answer: '2. Which part helped most? (multiple choice) 2 answered.' },
      ],
    };
    mount({ round: survey, namesShown: false });
    expect(screen.getByRole('heading', { level: 1, name: 'Comment on the survey' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Results by question · 2' })).toBeInTheDocument();
    expect(screen.queryByText(/^Response \d/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Comment on this question: How useful/ }));
    expect(sheet()).toHaveAccessibleName('Comment on question 1');
  });

  test('counts what has been typed, and refuses more than the ceiling', () => {
    mount();
    tap('Comment on Workie’s read');
    const box = screen.getByRole('textbox');
    expect(box).toHaveAttribute('maxLength', '1000');
    fireEvent.change(box, { target: { value: 'four' } });
    expect(screen.getByText('4 / 1000')).toBeInTheDocument();
  });
});

describe('posting', () => {
  test('will not send an empty comment', () => {
    const { props } = mount();
    tap('Comment on Workie’s read');
    fireEvent.click(screen.getByRole('button', { name: /Post comment/ }));
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  test('sends the ballot anchor the card supplied (B1), even on a tie', async () => {
    // Both rows carry rank 1; the anchor is Sam's ballot number, 1.
    const { props } = mount({ round: BALLOTED });
    fireEvent.click(screen.getByRole('button', { name: /Re-price/ }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Only one that touches the customer.' } });
    fireEvent.click(screen.getByRole('button', { name: /Post reply/ }));
    await waitFor(() => expect(props.onSubmit).toHaveBeenCalled());
    expect(props.onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      anchorKind: 'response',
      anchorRef: '1',
      anchorBasis: 'ballot',
      anchorLabel: 'Response 1 — Sam Ortiz',
      questionNumber: '003',
      text: 'Only one that touches the customer.',
    }));
  });

  test('the sent state names the target inside its card, politely, and focus goes back (D6)', async () => {
    const onSubmit = jest.fn().mockResolvedValue({
      ok: true, comment: { commentId: 'mine1', anchorKind: 'response', anchorRef: '1', anchorBasis: 'ballot', text: 'x', playerName: 'Ada Lovelace' },
    });
    mount({ round: BALLOTED, onSubmit });
    const opener = screen.getByRole('button', { name: /Re-price/ });
    fireEvent.click(opener);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Could sales record the call?' } });
    fireEvent.click(screen.getByRole('button', { name: /Post reply/ }));
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('Reply posted under Sam Ortiz’s response (response 1).');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status.closest('li').textContent).toMatch(/Re-price the onboarding package/);
    expect(screen.queryByRole('textbox')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  test('a late post keeps the shipped "added later" sentence on the same confirmation', async () => {
    const onSubmit = jest.fn().mockResolvedValue({ ok: true, comment: { commentId: 'z', addedLater: true } });
    mount({ onSubmit });
    tap('Comment on Workie’s read');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Late thought.' } });
    fireEvent.click(screen.getByRole('button', { name: /Post comment/ }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Comment posted under Workie’s read. It is marked as added later.',
    );
  });

  test('keeps the words on screen when the send fails', async () => {
    const onSubmit = jest.fn().mockResolvedValue({ ok: false, error: 'the host has closed this round' });
    mount({ onSubmit });
    tap('Comment on Workie’s read');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Worth keeping.' } });
    fireEvent.click(screen.getByRole('button', { name: /Post comment/ }));
    await waitFor(() => expect(screen.getByText(/the host has closed this round/)).toBeInTheDocument());
    expect(screen.getByRole('textbox')).toHaveValue('Worth keeping.');
  });
});

describe('one way out, and it asks when there are words (D5)', () => {
  test('Cancel and the X close an empty sheet at once', () => {
    const { props } = mount();
    tap('Comment on Workie’s read');
    tap('Cancel');
    expect(screen.queryByRole('textbox')).toBeNull();
    tap('Comment on Workie’s read');
    tap('Close this box');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  test('with words, Cancel asks "Discard your reply?"; Keep writing keeps them, Discard drops them', () => {
    mount({ round: BALLOTED });
    fireEvent.click(screen.getByRole('button', { name: /Re-price/ }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Half a thought.' } });
    tap('Cancel');
    expect(screen.getByText('Discard your reply?')).toBeInTheDocument();
    tap('Keep writing');
    expect(screen.getByRole('textbox')).toHaveValue('Half a thought.');
    tap('Close this box');
    tap('Discard');
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  test('Escape goes through the same question', () => {
    mount();
    tap('Comment on Workie’s read');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Words.' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(screen.getByText('Discard your comment?')).toBeInTheDocument();
  });
});

describe('the lifted "has a draft" flag (fix round 1, item 6)', () => {
  // PlayerPage.jsx needs to know whether the composer holds unsent text to
  // decide whether it is safe to auto-close the player's own panel when the
  // round moves on. This component still owns the draft text itself — the
  // callback only reports true/false, never the prose.
  test('reports false while the composer is closed', () => {
    const onDraftChange = jest.fn();
    mount({ onDraftChange });
    expect(onDraftChange).toHaveBeenCalledWith(false);
  });

  test('reports true the moment something is typed', () => {
    const onDraftChange = jest.fn();
    mount({ onDraftChange });
    fireEvent.click(screen.getByRole('button', { name: 'Comment on Workie’s read' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'A remark.' } });
    expect(onDraftChange).toHaveBeenLastCalledWith(true);
  });

  test('reports false again once the draft is sent', async () => {
    const onDraftChange = jest.fn();
    mount({ onDraftChange });
    fireEvent.click(screen.getByRole('button', { name: 'Comment on Workie’s read' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'A remark.' } });
    fireEvent.click(screen.getByRole('button', { name: /Post comment/ }));
    await waitFor(() => expect(onDraftChange).toHaveBeenLastCalledWith(false));
  });

  test('reports false again once the draft is cancelled', () => {
    const onDraftChange = jest.fn();
    mount({ onDraftChange });
    fireEvent.click(screen.getByRole('button', { name: 'Comment on Workie’s read' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'A remark.' } });
    fireEvent.click(screen.getByRole('button', { name: /Cancel/ }));
    // Words in the box: Cancel asks first, and the draft stands until Discard.
    expect(onDraftChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onDraftChange).toHaveBeenLastCalledWith(false);
  });

  test('whitespace-only text is not a draft', () => {
    // Matches `send()`'s own rule (`text.trim()`) — a container must not be
    // told there is something worth keeping when there is nothing to post.
    const onDraftChange = jest.fn();
    mount({ onDraftChange });
    fireEvent.click(screen.getByRole('button', { name: 'Comment on Workie’s read' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } });
    expect(onDraftChange).toHaveBeenLastCalledWith(false);
  });

  test('the host-triggered caller, which passes no onDraftChange, is unaffected', () => {
    // No prop at all — must not throw when the composer opens or types.
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Comment on Workie’s read' }));
    expect(() => fireEvent.change(screen.getByRole('textbox'), { target: { value: 'x' } }))
      .not.toThrow();
  });
});

describe('what everyone has already said', () => {
  test('comments already on the round are shown', () => {
    // "the comments now can be seen in the resulting round of feedback".
    mount({
      comments: [{
        commentId: 'c1', anchorKind: 'summary', anchorRef: '', anchorLabel: 'AI summary',
        text: 'It misses the customer conversation.', playerName: 'Lee Chen',
      }],
    });
    expect(screen.getByText('It misses the customer conversation.')).toBeInTheDocument();
    expect(screen.getByText('Lee Chen')).toBeInTheDocument();
  });
});

describe('while the host is still preparing', () => {
  test('a missing round says so rather than rendering an empty report', () => {
    // The host builds the report, then opens the beat. A phone can arrive
    // between those two calls, and "not ready" is a state, not an error.
    mount({ round: null });
    expect(screen.getByText(/preparing/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Comment on|Reply to/ })).toBeNull();
  });
});

describe('the empty-responses text and retry (fix round 2)', () => {
  const EMPTY_ROUND = { ...ROUND, answers: [] };

  test('defaults to the original honest statement', () => {
    mount({ round: EMPTY_ROUND });
    expect(screen.getByText('Nobody responded to this round.')).toBeInTheDocument();
  });

  test('a caller can say something else instead — loading, for instance', () => {
    // PlayerPage.jsx's own panel is mid-fetch when it first opens: `answers`
    // is `[]` before the round trip resolves, and "Nobody responded" would be
    // a lie about a round nobody has checked yet.
    mount({ round: EMPTY_ROUND, answersEmptyText: "Loading the round's responses…" });
    expect(screen.getByText("Loading the round's responses…")).toBeInTheDocument();
    expect(screen.queryByText('Nobody responded to this round.')).toBeNull();
  });

  test('a retry button appears only when onRetryAnswers is given, and calls it', () => {
    const onRetryAnswers = jest.fn();
    mount({
      round: EMPTY_ROUND,
      answersEmptyText: 'The responses could not be loaded.',
      onRetryAnswers,
    });
    const retry = screen.getByRole('button', { name: /Try again/ });
    fireEvent.click(retry);
    expect(onRetryAnswers).toHaveBeenCalledTimes(1);
  });

  test('no retry button when onRetryAnswers is not given, even with custom text', () => {
    mount({ round: EMPTY_ROUND, answersEmptyText: 'No responses came in for this round.' });
    expect(screen.queryByRole('button', { name: /Try again/ })).toBeNull();
  });

  test('the responses themselves are unaffected — a non-empty round never shows this at all', () => {
    mount({ answersEmptyText: 'should never appear' });
    expect(screen.queryByText('should never appear')).toBeNull();
  });
});

describe('a moved-on round no longer disables Post (late items Task 2: comments.js keeps it as added later)', () => {
  test('the panel has no postDisabled switch and no "copy it" sentence; Post follows the draft', () => {
    mount({ postDisabled: true });
    fireEvent.click(screen.getByRole('button', { name: 'Comment on Workie’s read' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Worth keeping.' } });
    expect(screen.getByRole('button', { name: /Post comment/ })).not.toBeDisabled();
    expect(screen.queryByText(/copy it/i)).toBeNull();
  });
});

describe('switching target with words in the box asks before moving them (D5)', () => {
  const box = () => screen.getByRole('textbox');

  test('with an empty box the sheet simply moves', () => {
    mount({ round: BALLOTED });
    tap('Comment on Workie’s read');
    fireEvent.click(screen.getByRole('button', { name: /Re-price/ }));
    expect(screen.queryByText(/^Move your/)).toBeNull();
    expect(sheet()).toHaveAccessibleName('Reply to Sam Ortiz’s response');
  });

  test('"Keep it here" leaves the words and the target where they were', () => {
    // rejects: the shipped silent drop of the text on a switch (fault 8).
    mount({ round: BALLOTED });
    fireEvent.click(screen.getByRole('button', { name: /Re-price/ }));
    fireEvent.change(box(), { target: { value: 'Could sales record it?' } });
    fireEvent.click(screen.getByRole('button', { name: /Freeze/ }));
    expect(screen.getByText('Move your reply to Dana Whitfield’s response? Your words come with it.')).toBeInTheDocument();
    tap('Keep it here');
    expect(sheet()).toHaveAccessibleName('Reply to Sam Ortiz’s response');
    expect(box()).toHaveValue('Could sales record it?');
  });

  test('"Move it" carries the words to the new target', async () => {
    const { props } = mount({ round: BALLOTED });
    fireEvent.click(screen.getByRole('button', { name: /Re-price/ }));
    fireEvent.change(box(), { target: { value: 'Better here.' } });
    fireEvent.click(screen.getByRole('button', { name: /Freeze/ }));
    tap('Move it');
    expect(sheet()).toHaveAccessibleName('Reply to Dana Whitfield’s response');
    expect(box()).toHaveValue('Better here.');
    fireEvent.click(screen.getByRole('button', { name: /Post reply/ }));
    await waitFor(() => expect(props.onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      anchorRef: '2', anchorBasis: 'ballot', text: 'Better here.',
    })));
  });

  test('a draft anywhere still counts as a draft for the container', () => {
    const onDraftChange = jest.fn();
    mount({ round: BALLOTED, onDraftChange });
    tap('Comment on Workie’s read');
    fireEvent.change(box(), { target: { value: 'Kept.' } });
    tap('Comment on the whole round');
    expect(onDraftChange).toHaveBeenLastCalledWith(true);
  });
});

describe('comments live under the thing they are about, collapsed (D7)', () => {
  const COMMENTS = [
    // A reply by ballot number: Dana's response is ballot 2, the FIRST row.
    { commentId: 'c1', anchorKind: 'response', anchorRef: '2', anchorBasis: 'ballot', anchorLabel: 'Response 2 — Dana Whitfield', text: 'Agree, freeze it.', playerName: 'Lee Chen' },
    // An older reply (position anchor, no basis), placed by its quote.
    { commentId: 'c2', anchorKind: 'response', anchorRef: '0', anchorExcerpt: 'Re-price the onboarding package.', anchorLabel: 'Response 1 — Sam Ortiz', text: 'Paid onboarding works.', playerName: 'Ada Lovelace' },
    // An older reply whose response is gone: under Anything else, with its quote.
    { commentId: 'c3', anchorKind: 'response', anchorRef: '4', anchorExcerpt: 'A response that has since expired', anchorLabel: 'Response 5', text: 'Still true.', playerName: 'Lee Chen' },
    { commentId: 'c4', anchorKind: 'summary', anchorRef: '', text: 'Sharp read.', playerName: 'Lee Chen' },
    { commentId: 'c5', anchorKind: 'results', anchorRef: '', text: 'Two people mentioned the survey.', playerName: 'Said in the room' },
  ];

  test('each reply sits in its own card, behind "Show N replies", with yours marked', () => {
    const { container } = mount({ round: BALLOTED, comments: COMMENTS });
    const cards = container.querySelectorAll('.fbr-card--response');
    const dana = cards[0];
    const sam = cards[1];
    const danaToggle = within(dana).getByRole('button', { name: /Show 1 reply/ });
    expect(danaToggle).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById(danaToggle.getAttribute('aria-controls'))).not.toBeVisible();
    fireEvent.click(danaToggle);
    expect(within(dana).getByRole('button', { name: /Hide 1 reply/ })).toHaveAttribute('aria-expanded', 'true');
    expect(within(dana).getByText('Agree, freeze it.')).toBeVisible();
    // The older reply found Sam's card by its quote, and it is Ada's own.
    expect(within(sam).getByRole('button', { name: 'Show 1 reply (yours)' })).toBeInTheDocument();
    expect(within(sam).getByText('Paid onboarding works.')).not.toBeVisible();
  });

  test('two replies read "Show 2 replies", never "replys"', () => {
    // rejects: a plural made by adding "s" (seen in the 390px screenshot).
    const two = [COMMENTS[0], { ...COMMENTS[0], commentId: 'c1b', text: 'Me too.' }];
    mount({ round: BALLOTED, comments: two });
    expect(screen.getByRole('button', { name: 'Show 2 replies' })).toBeInTheDocument();
  });

  test('Workie’s comments are in Workie’s card; the whole round’s and the unplaced are last, quote and all', () => {
    const { container } = mount({ round: BALLOTED, comments: COMMENTS });
    const workie = container.querySelector('.fbr-card--workie');
    expect(within(workie).getByRole('button', { name: /Show 1 comment/ })).toBeInTheDocument();
    const last = container.querySelector('.fbr-card--else');
    expect(within(last).getByText('Two people mentioned the survey.')).toBeVisible();
    expect(within(last).getByText('Still true.')).toBeVisible();
    expect(within(last).getByText('A response that has since expired')).toBeInTheDocument();
  });

  test('"Open all replies" opens every response thread at once', () => {
    const { container } = mount({ round: BALLOTED, comments: COMMENTS });
    tap('Open all replies');
    expect(within(container.querySelector('.fbr-cards')).getByText('Agree, freeze it.')).toBeVisible();
    expect(within(container.querySelector('.fbr-cards')).getByText('Paid onboarding works.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Close all replies' })).toBeInTheDocument();
  });

  test('after posting, the card’s thread opens and yours reads "You · just now"', async () => {
    const posted = { commentId: 'new1', anchorKind: 'response', anchorRef: '1', anchorBasis: 'ballot', text: 'Mine.', playerName: 'Ada Lovelace' };
    const onSubmit = jest.fn().mockResolvedValue({ ok: true, comment: posted });
    const { rerender, props } = mount({ round: BALLOTED, onSubmit });
    fireEvent.click(screen.getByRole('button', { name: /Re-price/ }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Mine.' } });
    fireEvent.click(screen.getByRole('button', { name: /Post reply/ }));
    await screen.findByRole('status');
    // The container appends the posted comment, as PlayerPage does.
    rerender(<FeedbackRoundPanel {...props} comments={[posted]} />);
    expect(screen.getByText('You · just now')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Hide 1 reply' })).toBeInTheDocument();
  });
});

describe('the summary is called Workie’s read on the phone', () => {
  test('its heading and its action say Workie’s read, never "AI summary"', () => {
    const { container } = mount();
    expect(screen.getByRole('heading', { level: 2, name: 'Workie’s read' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Comment on Workie’s read' })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/AI summary/);
  });
});
