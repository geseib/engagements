import React, { useCallback, useEffect, useMemo, useState } from 'react';
import './RemoteQuestionBrowser.css';
import Icon from './Icon';
import QuestionCard from './QuestionCard';
import { remoteQuestionRow, questionForCard, filterRemoteRows } from '../config/hostRemote';
import { canReveal, revealText, stepSelection } from '../config/questionPreview';
import { resolveInstruction } from '../config/instructions';
import { normalizeGameType } from '../config/gameTypes';
import { authFetch } from '../auth/authFetch';

/**
 * The host's phone browsing the question set — `17-remote.html`, right phone.
 *
 * IT IS A PANE NOW, NOT A SCREEN, and that is the only thing about it that has
 * changed. It used to render its own `.hr` root, its own bar and its own dock,
 * with "Back to the round" filling the thumb arc — so for as long as the host
 * was reading four options they could not advance the round. The owner asked
 * for two more lists beside this one ("the players, the rounds, the
 * questions"), which would have made that trade three times as often, so the
 * chrome moved out to `RemoteSessionPanel`: one bar with one way back, one
 * dock that goes on carrying the primary action, three tabs under it.
 *
 * THE ASYMMETRY WITH THE STAGE BROWSER IS THE FEATURE, not a bug to reconcile.
 * `config/setupPanel.js:browserRow` strips the options out of every row on
 * purpose, because the stage's browser renders on the projector and a set that
 * records `correctAnswer` as the option's own TEXT would put the answer on the
 * wall. This browser renders on a phone in the host's hand, so it carries the
 * options AND the CORRECT flag. The mockup states the rule in one line and it is
 * printed at the foot of the list rather than left in a spec:
 *
 *   "Correct answers appear here and nowhere else. The stage lists the same
 *    questions without them."
 *
 * It owns one fetch — `GET question-sets/{setId}/questions`, the same endpoint
 * `GameHostPage.fetchQuestionsForBrowsing` calls, whole set in one request so
 * the search filters client-side and costs nothing. Asking is delegated to the
 * remote, which owns the cooldown and the error flash.
 *
 * ── THE PREVIEW ───────────────────────────────────────────────────────────
 *
 *   *"how does a host preview the questions. that same feature should be avail
 *    for the host"*
 *
 * The set editor's preview (components/QuestionPreview.jsx) puts the list and
 * the card side by side. A phone has one column, so here they are two views of
 * one pane: `Preview` on a row swaps the list for the card, `All questions`
 * swaps back, and `Previous` / `Next` page without leaving the card. Everything
 * else is the same feature by construction rather than by resemblance —
 *
 *   THE CARD IS components/QuestionCard.jsx, the component the live stage
 *   renders. Nothing here draws a question of its own, so nothing here can
 *   drift from the room.
 *
 *   NO ADAPTER BETWEEN THE WIRE AND THE CARD, WITH ONE EXCEPTION, AND IT IS A
 *   VALUE RATHER THAN A NAME. The browsing endpoint already answers in the
 *   card's own field names — `title`, `questionDetail`, `image` (the stored
 *   media key, exactly what the stage is handed), `optionA…`, `correctAnswer`,
 *   `customInstructions` (admin/get-question-set-questions.js). The set editor
 *   needs `stagedQuestion` only because it holds EDITOR rows, which spell three
 *   of those differently; a second spelling here would be a second thing to
 *   keep in step for no gain.
 *   The exception is `correctAnswer`, which the endpoint returns AS STORED while
 *   `game/get-question.js` rewrites it to the option's own text before the room
 *   sees it. `questionForCard` does that rewrite, because without it the card
 *   marks two options on a question whose filled slots are not contiguous — the
 *   whole argument is next to that function.
 *
 *   REVEAL IS A DELIBERATE STEP AND IT IS STICKY. Offered for the SET, never
 *   for the question on the card (`canReveal`), so the control holds still while
 *   paging; and held in this component's state, so a host paging a trivia set
 *   presses it once rather than thirty times.
 *
 *   THE REVEAL TEXT IS NOT ON THE CARD. The stage's RESULTS never draws
 *   `answerDetails` — it reaches players only in the round report — so it sits
 *   below the screen, labelled. A host reading it off something that looked like
 *   the room's screen would be reading out what the room cannot see.
 *
 *   THE TABLE LADDER REACHES THE CARD THROUGH `.stage-ladder-table`
 *   (styles/stage.css), never through `:root`. The host's projector window can
 *   be live while this phone is in hand, and `components/stage/Stage.jsx` keeps
 *   the display profile on the document element: re-classing it from here would
 *   resize the room's screen mid-session.
 *
 * THE INSTRUCTION LINE IS RESOLVED WITHOUT A SET-LEVEL INSTRUCTION, because
 * this endpoint does not return one. It costs almost nothing:
 * `admin/upload-questions.js:594` writes the set's instruction onto every
 * question row at import, so `resolveInstruction` finds it as the question's
 * own. The one case that can differ from the room is a set whose instruction
 * was changed afterwards at the set level alone — there the card falls back to
 * the game type's default line.
 */

const apiBase = () => window.API_BASE || '';

/** Why Previous and Next are held when the list holds one question. */
const ONLY_ONE = 'This is the only question in the list.';

/**
 * WHAT THE SET FAILED TO SAY, in one place because two surfaces say it: the
 * row in the list, and the preview's Reveal when it can mark nothing. One fact,
 * one sentence — a second wording would read as a second problem.
 */
const NO_RIGHT_ANSWER = 'This set does not say which option is right.';

export default function RemoteQuestionBrowser({
  setId,
  gameType = '',
  unaskedCount = null,
  busy = false,
  onAsk,
}) {
  const [questions, setQuestions] = useState(null);
  const [setName, setSetName] = useState('');
  const [search, setSearch] = useState('');
  const [failed, setFailed] = useState(false);
  const [asking, setAsking] = useState(null);
  // Which question the preview is showing, or null for the list.
  const [previewId, setPreviewId] = useState(null);
  // STICKY: flip to Reveal once and every question paged to arrives revealed.
  const [phase, setPhase] = useState('ASK');

  useEffect(() => {
    if (!setId) return undefined;

    let cancelled = false;
    (async () => {
      try {
        // authFetch: this route now carries the Cognito authorizer. The phone
        // remote is a host surface and is signed in, so the token is there —
        // a plain fetch here would 401 the browser and render 'unavailable'.
        const res = await authFetch(`${apiBase()}question-sets/${setId}/questions`);
        if (cancelled) return;
        if (!res.ok) { setFailed(true); setQuestions([]); return; }
        const data = await res.json();
        if (cancelled) return;
        setQuestions(Array.isArray(data.questions) ? data.questions : []);
        setSetName(data.setName || '');
      } catch {
        if (!cancelled) { setFailed(true); setQuestions([]); }
      }
    })();

    return () => { cancelled = true; };
  }, [setId]);

  /*
    THE ROWS AND THE QUESTIONS THEY CAME FROM, in one pass.

    The list reads a `remoteQuestionRow` (a title, a meta line, the options and
    the flag); the card reads the WIRE question. Both are needed at once, and the
    row's id is computed inside `remoteQuestionRow` from three possible
    spellings, so the map is built where that answer already exists rather than
    by deriving the id a second time here.
  */
  const { rows, sources } = useMemo(() => {
    const list = [];
    const map = new Map();
    for (const question of questions || []) {
      // ONE ANSWER FEEDS BOTH: `questionForCard` resolves the stored spelling to
      // the option's own text, exactly as the wire does for the room, and the row
      // is read off that same value. Decoding twice is how the list came to flag
      // one option while the card marked another.
      const staged = questionForCard(question);
      const row = remoteQuestionRow(staged);
      if (row.id === undefined) continue;
      list.push(row);
      map.set(row.id, staged);
    }
    return { rows: list, sources: map };
  }, [questions]);

  const shown = useMemo(() => filterRemoteRows(rows, search), [rows, search]);

  // The card and config/instructions.js both compare `trivia` as a literal, so
  // an alias or a capital from the server would draw a trivia question as free
  // text — no options, and another game's instruction line.
  const type = normalizeGameType(gameType);

  const ask = useCallback(async (row) => {
    if (busy || asking) return;
    setAsking(row.id);
    try {
      await onAsk(row);
    } finally {
      setAsking(null);
    }
  }, [busy, asking, onAsk]);

  /*
    THE PREVIEWED ROW, RESOLVED FROM THE LIST ON EVERY RENDER — never held.

    This browser reads the set once per `setId`, so the only thing that moves the
    list under an open preview is the host switching the session's set, and then
    the question on the card may not be in the new one. Falling back to the list
    is the honest move: the list shows what there is NOW, and a card drawing a
    question from a set the session no longer plays is a question the host
    cannot ask.
  */
  const open = previewId === null ? null : shown.find((row) => row.id === previewId) || null;
  useEffect(() => {
    if (previewId !== null && !open) setPreviewId(null);
  }, [previewId, open]);

  // Offered for the SET, not for the question on the card
  // (config/questionPreview.js `canReveal`): trivia always, any other format
  // once one question carries a reveal — an art set keeps the artwork's real
  // title there. So the control does not come and go while paging.
  const revealable = useMemo(() => canReveal(questions || [], type), [questions, type]);
  const reveal = revealable && phase === 'REVEAL';

  const step = (delta) => {
    const next = stepSelection(shown.map((row) => row.id), previewId, delta);
    if (next !== null) setPreviewId(next);
  };

  // "Strategic Pricing Plays · 31 unasked". The count is the SERVER's
  // `categoryCounts.totalRemaining` — how many questions the game can still
  // reach — and is simply absent when the game has not started and no counts
  // exist yet, rather than being back-filled with the list length, which would
  // report every asked question as unasked.
  const kicker = [
    setName || 'Question set',
    typeof unaskedCount === 'number' ? `${unaskedCount} unasked` : null,
  ].filter(Boolean).join(' · ');

  /* The line that says why this surface may carry the answer. Printed under the
     list and under the card, because under the card it is more true, not less:
     Reveal marks the correct option there. */
  const privateNote = (
    <p className="hr-wait-private hrq-private">
      <b>Private</b> Correct answers appear here and nowhere else. The stage lists the
      same questions without them.
    </p>
  );

  if (open) {
    const question = sources.get(open.id) || null;
    const note = revealText(question);
    const single = shown.length <= 1;
    // What the held steps point at with aria-describedby, below.
    const heldId = 'hrq-preview-only-one';

    return (
      <div className="hrq hrq--preview" data-testid="hrq-preview">
        {/* EVERYTHING THE HOST OPERATES SITS ABOVE THE CARD, and that is a
            phone decision rather than a taste one. A stage composition in a
            390px column wraps into something taller than the fold — a
            four-option trivia card measures past 600px — so controls placed
            under it would be reached by scrolling past the whole question, and
            paging from down there would change options under a heading the host
            could no longer see. Above it, the thumb stays put and the question
            changes where the eye already is. */}
        <div className="hrqp-bar">
          <button className="hrqp-back" type="button" onClick={() => setPreviewId(null)}>
            <Icon name="ArrowLeft" weight="bold" size={18} color="currentColor" />
            All questions
          </button>
          {revealable && (
            <div className="hrqp-seg" role="group" aria-label="What the card shows">
              <button
                type="button"
                className="hrqp-seg-btn"
                aria-pressed={!reveal}
                onClick={() => setPhase('ASK')}
              >
                ASK
              </button>
              <button
                type="button"
                className="hrqp-seg-btn"
                aria-pressed={reveal}
                onClick={() => setPhase('REVEAL')}
              >
                Reveal
              </button>
            </div>
          )}
        </div>

        {/* THE POSITION RIDES BETWEEN THE TWO CONTROLS THAT MOVE IT, because
            that is what it is about: which of these the card is on, and how many
            Next has left. Both steps wrap, so with one question in the list they
            would each land back on the question already on screen — held and
            saying why, rather than live and doing nothing, and rather than
            disappearing, which would make the chrome change shape as a search
            narrows. */}
        <div className="hrqp-step">
          <button
            className="hr-btn hr-btn--ghost"
            type="button"
            disabled={single}
            title={single ? ONLY_ONE : undefined}
            aria-describedby={single ? heldId : undefined}
            onClick={() => step(-1)}
          >
            <Icon name="CaretLeft" weight="bold" size={16} color="currentColor" />
            Previous
          </button>
          <span className="hrqp-pos" data-testid="hrq-preview-position">
            {`${shown.indexOf(open) + 1} / ${shown.length}`}
          </span>
          <button
            className="hr-btn hr-btn--ghost"
            type="button"
            disabled={single}
            title={single ? ONLY_ONE : undefined}
            aria-describedby={single ? heldId : undefined}
            onClick={() => step(1)}
          >
            Next
            <Icon name="CaretRight" weight="bold" size={16} color="currentColor" />
          </button>
        </div>

        {/* PRINTED, NOT HOVERED. `title=` is the one channel a mouse has and the
            one a finger does not, so on the surface this feature is FOR the reason
            the two steps are held reached nobody. It is a line of copy rather
            than a change to the controls: the doc block above argues for leaving
            them in place and saying why, and a line appearing as a search narrows
            to one result is information, where a control vanishing under the
            thumb is a moving target. `aria-describedby` carries the same words to
            a screen reader that is on the button rather than reading past it. */}
        {single && (
          <p className="hrqp-held" id={heldId} data-testid="hrq-preview-only">
            {ONLY_ONE}
          </p>
        )}

        {/* THE ROOM'S SCREEN. The stage's own card, at the Table profile, on the
            stage's own ground — and not one rule of it is this sheet's
            (hostRemotePreviewPalette.test.js holds that).
            REVEAL KEEPS ITS QUESTION (`withQuestion`): the toggle is sticky, so
            every question paged to arrives already revealed, and the options
            alone would be four answers with nothing saying what was asked.
            ONLY TRIVIA'S CARD CHANGES IN REVEAL — its answer is ON the card, the
            correct option marked. Any other format's reveal is text the stage
            never draws, so its card stays exactly as in ASK and the reveal is
            the note below. Sent as REVEAL it would render nothing at all
            (QuestionCard returns null off trivia): a blank screen where the room
            would see the question. */}
        <div
          className="hrqp-screen stage-ladder-table"
          data-testid="hrq-preview-screen"
        >
          <div className="hrqp-card">
            <QuestionCard
              phase={reveal && type === 'trivia' ? 'REVEAL' : 'ASK'}
              question={question}
              gameType={type}
              instruction={resolveInstruction(question, '', type)}
              withQuestion
            />
          </div>
        </div>

        {/* THE THIRD THING REVEAL CAN MEAN, and the one it used to leave unsaid.
            Trivia's answer is ON the card, so trivia normally needs no note — but
            when the stored answer places against none of the options the card has
            nothing to mark, and Reveal dimmed all four and printed nothing: a
            control that looked like it fired. The row in the list already says
            this in words, so the same sentence is said here (NO_RIGHT_ANSWER),
            and it is one sentence because it is one fact.
            OFF THE SCREEN, like every other note: it is about the card, not on it,
            and the room's screen never carries an apology. */}
        {reveal && type === 'trivia' && open.answerUnresolved && (
          <p className="hrqp-note hrqp-note--unresolved" data-testid="hrq-preview-unresolved">
            <b>Reveal</b>
            {NO_RIGHT_ANSWER}
          </p>
        )}

        {/* NOT ON THE SCREEN, AND SAID SO. Two lines, because Reveal is offered
            for the set: on the one question of a call-and-answer set that
            carries no answer of its own, a Reveal that changed nothing would
            read as a broken control rather than as an empty field. Trivia needs
            no such line — there the card itself just changed. */}
        {reveal && (note ? (
          <p className="hrqp-note" data-testid="hrq-preview-note">
            <b>Reveal — shown only after the round</b>
            {note}
          </p>
        ) : type !== 'trivia' && (
          <p className="hrqp-note" data-testid="hrq-preview-note">
            <b>Reveal</b>
            This question carries no reveal of its own.
          </p>
        ))}

        {/* WHAT THE ROW COULD ALREADY DO. The host opened the preview to decide,
            and deciding means asking this one next; without it the view would be
            a dead end they have to back out of. */}
        <button
          className="hr-btn hr-btn--ghost hrq-ask"
          type="button"
          disabled={busy || asking !== null}
          onClick={() => ask(open)}
        >
          {asking === open.id ? 'Working…' : 'Ask this next'}
        </button>

        {privateNote}
      </div>
    );
  }

  return (
    <div className="hrq">
      {/* The set's own name and how much of it is left, kept from the screen
          this used to be: a host who opened the browser to choose needs to know
          which set they are choosing FROM, and "31 unasked" is the number that
          says whether choosing is even necessary. */}
      <p className="hrq-kicker">{kicker}</p>

      <label className="hrq-search">
        <Icon name="MagnifyingGlass" weight="bold" size={18} color="var(--muted)" />
        <input
          type="search"
          value={search}
          placeholder="Search titles…"
          aria-label="Search questions"
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>

      {questions === null && <p className="hr-hint">Reading the question set…</p>}

      {failed && (
        <p className="hr-flash hr-flash--error" role="alert">
          <Icon name="Warning" weight="fill" size={18} color="currentColor" />
          Could not read the question set.
        </p>
      )}

      {questions !== null && !failed && shown.length === 0 && (
        <p className="hr-hint">
          {rows.length === 0 ? 'This set has no questions.' : 'Nothing matches that search.'}
        </p>
      )}

      {shown.map((row) => (
        <article className="hrq-card" key={row.id}>
          <h2 className="hrq-title">{row.title}</h2>
          {(row.category || row.difficulty) && (
            <p className="hrq-meta">
              {[row.category, row.difficulty].filter(Boolean).join(' · ')}
            </p>
          )}
          {row.detail && <p className="hrq-detail">{row.detail}</p>}

          {row.options.length > 0 && (
            <ol className="hrq-opts">
              {row.options.map((option) => (
                <li key={option.letter} className={option.correct ? 'is-right' : ''}>
                  <b>{option.letter}</b>
                  <span>
                    {option.text}
                    {option.correct && <em className="hrq-correct">Correct</em>}
                  </span>
                </li>
              ))}
            </ol>
          )}

          {/* The set claims an answer that matches none of its own options.
              Said out loud: the host is about to read these to a room. The
              preview's Reveal says the same sentence when it can mark nothing. */}
          {row.answerUnresolved && (
            <p className="hrq-unresolved">{NO_RIGHT_ANSWER}</p>
          )}

          {/* TWO ACTIONS, AND THE COMMITTING ONE IS SECOND. Preview only changes
              what this phone shows; "Ask this next" moves the room. The label
              carries the question's title so a screen reader hears which of
              thirty Previews it is on. */}
          <div className="hrq-actions">
            <button
              className="hr-btn hr-btn--ghost"
              type="button"
              aria-label={`Preview “${row.title}”`}
              onClick={() => setPreviewId(row.id)}
            >
              <Icon name="Eye" weight="bold" size={16} color="currentColor" />
              Preview
            </button>
            <button
              className="hr-btn hr-btn--ghost"
              type="button"
              disabled={busy || asking !== null}
              onClick={() => ask(row)}
            >
              {asking === row.id ? 'Working…' : 'Ask this next'}
            </button>
          </div>
        </article>
      ))}

      {shown.length > 0 && privateNote}
    </div>
  );
}
