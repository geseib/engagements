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
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

  test('it is the same renderer the host opens from the rounds screen', () => {
    // "the same item that is avail when you click the previous round". A second
    // renderer would drift; this asserts the shared component's own markup.
    const { container } = mount();
    expect(container.querySelector('.past-round__body')).toBeTruthy();
    expect(container.querySelector('.past-round__summary')).toBeTruthy();
  });

  test('the room’s controls are not offered to a participant', () => {
    // Regenerating the summary re-runs a Bedrock call for the whole room.
    mount();
    expect(screen.queryByRole('button', { name: /Regenerate|Generate summary/ })).toBeNull();
  });
});

describe('the composer', () => {
  test('is closed until a section is chosen', () => {
    // A text box with no stated subject collects remarks about nothing. The
    // owner asked for the chat-style flow: pick the section, then write.
    mount();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  test('opens on the section that was clicked, and says which', () => {
    // Scoped to the composer: "AI summary" is also the section's own heading,
    // and that ambiguity is the point — the composer has to name its subject
    // independently, because on a phone the heading may be scrolled off.
    const { container } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Comment on the AI summary' }));
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    const composer = container.querySelector('.fbr__composer');
    expect(composer).toBeTruthy();
    expect(composer.querySelector('.fbr__on-anchor').textContent).toBe('AI summary');
    expect(composer.textContent).toMatch(/Commenting on/i);
  });

  test('states plainly that the comment will carry a name', () => {
    /*
      THE DISCLOSURE, and it is the deliberate half of the anonymity decision.

      Participants have spent the session under "Your name is not attached to it
      until voting closes" (player-redesign/07-ask-call.html, live at
      PlayerPage.jsx). A feedback round always runs attributed, because
      get-results.js reveals authors unconditionally on entering RESULTS — so
      carrying the earlier assumption into a comment would be the actual privacy
      failure here. It is stated before anyone types, not discovered afterwards.
    */
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Comment on the AI summary' }));
    expect(screen.getByText('Your name will be shown with this comment.')).toBeInTheDocument();
  });

  test('will not send an empty comment', () => {
    const { props } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Comment on the AI summary' }));
    fireEvent.click(screen.getByRole('button', { name: /Post comment/ }));
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  test('sends the anchor the section supplied, not one it re-derived', async () => {
    const { props } = mount();
    // Response 2 — both rows carry rank 1, so an anchor taken from the printed
    // badge would file this against response 1.
    fireEvent.click(screen.getByRole('button', { name: 'Comment on response 2' }));
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'This is the only one that touches the customer.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Post comment/ }));

    await waitFor(() => expect(props.onSubmit).toHaveBeenCalled());
    expect(props.onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      anchorKind: 'response',
      anchorRef: '1',
      anchorLabel: 'Response 2 — Sam Ortiz',
      text: 'This is the only one that touches the customer.',
    }));
  });

  test('closes and clears once the comment lands', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Comment on the AI summary' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'A remark.' } });
    fireEvent.click(screen.getByRole('button', { name: /Post comment/ }));
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
  });

  test('keeps the words on screen when the send fails', async () => {
    /*
      A composer that clears on failure has thrown away what somebody wrote.
      This is the one place the participant's own prose exists — it is not
      recoverable from anywhere — so the text stays and the error is shown
      beside it.
    */
    const onSubmit = jest.fn().mockResolvedValue({ ok: false, error: 'the host has closed this round' });
    mount({ onSubmit });
    fireEvent.click(screen.getByRole('button', { name: 'Comment on the AI summary' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Worth keeping.' } });
    fireEvent.click(screen.getByRole('button', { name: /Post comment/ }));

    await waitFor(() => expect(screen.getByText(/the host has closed this round/)).toBeInTheDocument());
    expect(screen.getByRole('textbox')).toHaveValue('Worth keeping.');
  });

  test('can be abandoned without posting', () => {
    // Every dialog needs a way out that is not the commit.
    const { props } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Comment on the AI summary' }));
    fireEvent.click(screen.getByRole('button', { name: /Cancel/ }));
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  test('counts what has been typed, and refuses more than the ceiling', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Comment on the AI summary' }));
    const box = screen.getByRole('textbox');
    expect(box).toHaveAttribute('maxLength', '1000');
    fireEvent.change(box, { target: { value: 'four' } });
    expect(screen.getByText('4 characters')).toBeInTheDocument();
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
    expect(screen.queryByRole('button', { name: /Comment on/ })).toBeNull();
  });
});
