import React from 'react';
import Icon from '../Icon';
import { queueRows, queueSummary, QUEUE_MAX } from '../../config/questionQueue';
import { questionKey } from '../../config/setupPanel';

/**
 * THE RUNNING ORDER, AS A LIST THE HOST CAN REORDER.
 *
 * The owner's ask, verbatim: *"I want to think through a really nice way to
 * queue up multiple questions but they are not triggered until the end of the
 * round is selected by the host."*
 *
 * PRESENTATIONAL ON PURPOSE — every action is a prop and nothing here fetches.
 * That is the same deal `SessionSetupPanel` takes, and it is what lets this be
 * mounted in jsdom and asserted on. The arithmetic (what "move it up" means,
 * where the edges are) is NOT here either: it is `config/questionQueue.js`,
 * mirrored into the Lambda, so a component cannot invent a fifth opinion about
 * ordering. `queueRows` hands back `canMoveEarlier`/`canMoveLater` already
 * decided, and this file does no index arithmetic of its own.
 *
 * ── WHY IT RENDERS WHEN EMPTY ──────────────────────────────────────────────
 *
 * An empty queue draws its heading and one line of explanation rather than
 * nothing at all. A feature that is invisible until it is already in use is a
 * feature nobody finds: this exact mistake shipped once already this month,
 * when the help entry point went into a tab three levels down and the owner
 * reported *"i dont see the help anywhere"*. The empty line is also the only
 * place the queue/ask-next distinction is stated, and that distinction is the
 * entire point of the feature.
 *
 * ── THE HEAD ROW IS MARKED, AND IT IS NOT DECORATION ───────────────────────
 *
 * `#1` is what the next end-of-round will actually serve. A host reading this
 * list mid-session is reading it to answer exactly one question — "what happens
 * when I press Next?" — so the answer is a word ("Next"), not a colour.
 * Hard rule: a flag must never rely on its colour alone.
 *
 * ── A QUEUED QUESTION WHOSE ROW WE CANNOT FIND ─────────────────────────────
 *
 * `missing` comes back true when the queued key names a question the caller
 * could not hand us — the browser rows have not loaded yet, or the set was
 * replaced mid-session. The row STAYS, showing its key, because the server
 * still holds it and will still serve it; dropping it would make the host's own
 * choice disappear from the only surface that could remove it.
 */
export default function QueueList({
  queue = [],
  questions = [],
  busyKeys = [],
  upNext = [],
  /*
    Queue entries the SERVER says it will pass over — `blocked` from
    GET /up-next: not in the loaded set, or no reachable category. The server
    leaves them queued (restoring the set recovers them), and this list is how
    the host finds out they are parked instead of watching them be skipped in
    silence.
  */
  blocked = [],
  /*
    Queue entries that WILL be served but deserve a word — `advisories` from
    GET /up-next. Today that is one case: a one-off from a switched-off
    category. The owner: "it should not skip it. assume its a 1 off that the
    host wants to add from that category. (still leave it labeled as category
    off, but dont skip)."
  */
  advisories = [],
  /*
    The questions the host has DISABLED for this session — `excluded` from
    GET /up-next, with titles. Rendered as their own section with a way back:
    a veto with no undo is a trap, not a control.
  */
  excludedRows = [],
  onMove = () => {},
  onRemove = () => {},
  /*
    Rearranging an AUTO row. Null/omitted = the controls are not drawn — a
    caller with no way to materialise the plan must not offer buttons that
    cannot work. See config/questionQueue.js:materializePlanOps for what a
    press means: the displayed plan becomes queued rows, then the move applies.
  */
  onAutoMove = null,
  /*
    The third and fourth verbs of the owner's four-button column ("move
    up/move down/disable/move back out of the immediate queue"). `onDisable`
    receives (key, { queued }) so the caller knows whether to un-queue first;
    `onRestore` lifts a veto. Null = the disable column is not drawn.
  */
  onDisable = null,
  onRestore = null,
}) {
  const rows = queueRows(queue, { questions });
  const { count, full } = queueSummary(queue);
  const blockedByKey = new Map(
    blocked
      .filter((b) => b && b.key)
      .map((b) => [questionKey(String(b.key)), b.reason || 'blocked'])
  );
  // Served-but-labeled — the "Category off" one-offs. A key, not a reason:
  // there is exactly one advisory today and the tag is its whole payload.
  const advisoryKeys = new Set(
    advisories.filter((a) => a && a.key).map((a) => questionKey(String(a.key)))
  );
  const isParked = (row) => {
    const reason = blockedByKey.get(row.key);
    // The extra warn is for the reasons `missing` does not already cover —
    // `not-in-set` keeps the local "Not in this set" warn as its only label.
    return Boolean(reason && reason !== 'not-in-set' && !row.missing);
  };
  /*
    THE "Next" FLAG FOLLOWS THE FIRST ROW THE SERVE WILL ACTUALLY TAKE. With a
    parked head, position 1 is precisely NOT what the next end-of-round serves,
    and this flag exists to answer "what happens when I press Next?". Any
    server-blocked row is passed over here — including `not-in-set`, whose warn
    is rendered by `missing` instead.
  */
  const nextKey = (rows.find((row) => !blockedByKey.has(row.key)) || {}).key;
  /*
    CANONICALISED, because `busyKeys` comes from whatever the caller had in
    hand and both spellings of a question id are on the wire —
    `QUESTION#c005#001` from `get-question.js`, the bare form from the browsing
    endpoint. `queueRows` returns canonical keys, so a raw Set here compares two
    different spellings of the same question and never matches: the row stays
    live through its own round trip and the host can fire the op again.

    This is the same fault that killed the "Unasked only" filter for the whole
    of its life (config/setupPanel.js:154).
  */
  const busy = new Set(busyKeys.map((key) => questionKey(String(key))));

  /*
    The plan's automatic tail only. The server returns the whole running order —
    queued items first, then the walk — and the queued half is already rendered
    above from the QUEUE record, which is the copy the host can edit. Showing
    the server's copy of them too would state one fact about one object twice,
    and the two would disagree for the length of a round trip every time the
    host reorders.
  */
  const autoRows = upNext.filter((row) => row && row.source === 'auto');

  return (
    <section className="setup-q" aria-labelledby="setup-q-head">
      <div className="setup-q__head">
        <h3 className="setup-q__title" id="setup-q-head">Running order</h3>
        {/*
          The count is a fact about the queue and is stated ONCE. The cap only
          appears when it is close enough to matter — a permanent "0 of 24"
          teaches the host a limit they will never reach and states a second
          fact about the same object, which the console's own rule forbids.
        */}
        <span className="setup-q__count" data-testid="queue-count">
          {count === 0 ? 'Nothing queued' : `${count} queued`}
          {count >= QUEUE_MAX - 4 && ` of ${QUEUE_MAX}`}
        </span>
      </div>

      {count === 0 ? (
        <p className="setup-q__empty" data-testid="queue-empty">
          <b>Queue</b> adds a question to the running order — it waits until you end the
          current round. <b>Ask next</b> puts it on screen straight away.
        </p>
      ) : (
        <ol className="setup-q__list" data-testid="queue-list">
          {rows.map((row) => {
            const pending = busy.has(row.key);
            /*
              PARKED, BY THE SERVER'S OWN RULE. The reason comes from the same
              resolver the plan runs, so this tag and the serve can never
              disagree. `not-in-set` is left to the local `missing` warn below,
              which already covers it from the browser rows.
            */
            const parked = blockedByKey.get(row.key);
            const parkedHere = isParked(row);
            return (
              <li
                key={row.key}
                className={`setup-q__row ${row.key === nextKey ? 'is-next' : ''} ${row.missing ? 'is-missing' : ''}`}
                data-testid="queue-row"
              >
                <span className="setup-q__pos" aria-hidden="true">{row.position}</span>
                <span className="setup-q__main">
                  <span className="setup-q__name">
                    {/*
                      The key, not a placeholder, when the question is unknown.
                      "Untitled" would be a claim about the question; the key is
                      the only true thing we hold, and it is what the host would
                      need to say out loud to anyone debugging it.
                    */}
                    {row.missing ? row.key : (row.title || row.key)}
                  </span>
                  <span className="setup-q__meta">
                    {/* A parked head is NOT next — the serve passes over it, so
                        the flag saying otherwise would be the panel lying about
                        the one thing it exists to answer. The flag follows the
                        first row the drain will actually take. */}
                    {row.key === nextKey && (
                      <span className="setup-q__flag" data-testid="queue-next-flag">Next</span>
                    )}
                    {row.category && <span className="setup-q__cat">{row.category}</span>}
                    {row.missing && (
                      <span className="setup-q__warn" title="This question is not in the set now loaded. It stays queued, and the round will skip it if it cannot be served.">
                        Not in this set
                      </span>
                    )}
                    {parkedHere && (
                      <span
                        className="setup-q__warn"
                        data-testid="queue-parked"
                        title="This question has no category the session can reach, so rounds skip it. It stays queued."
                      >
                        Unreachable — skipped
                      </span>
                    )}
                    {/* Served anyway, said anyway. The owner: queueing is
                        reaching past the category toggles by name — "assume
                        its a 1 off". The tag keeps the fact visible without
                        threatening the round. */}
                    {advisoryKeys.has(row.key) && !row.missing && (
                      <span
                        className="setup-q__warn"
                        data-testid="queue-category-off"
                        title="Its category is switched off for automatic picks, but you queued this one by name, so it will be asked as a one-off."
                      >
                        Category off
                      </span>
                    )}
                  </span>
                </span>
                <span className="setup-q__acts">
                  {/*
                    THE FOUR-SLOT COLUMN, the owner's spec: "move up/move
                    down/disable/move back out of the immediate queue" — the
                    SAME four slots the auto rows carry, so the two lists'
                    buttons align down the panel.

                    DISABLED AT THE EDGES rather than absent, and the two are
                    not interchangeable: a control that disappears on the first
                    row makes every row's action column a different width and
                    the buttons move under the finger as the list reorders. The
                    predicate is `queueRows`', which is `queueMove`'s clamp —
                    not a second opinion about where the edges are.
                  */}
                  <button
                    type="button"
                    className="setup-q__btn"
                    disabled={!row.canMoveEarlier || pending}
                    onClick={() => onMove(row.key, 'earlier')}
                    aria-label={`Move ${row.title || row.key} earlier`}
                  >
                    <Icon name="ArrowUp" weight="bold" size={14} />
                  </button>
                  <button
                    type="button"
                    className="setup-q__btn"
                    disabled={!row.canMoveLater || pending}
                    onClick={() => onMove(row.key, 'later')}
                    aria-label={`Move ${row.title || row.key} later`}
                  >
                    <Icon name="ArrowDown" weight="bold" size={14} />
                  </button>
                  {onDisable && (
                    <button
                      type="button"
                      className="setup-q__btn setup-q__btn--drop"
                      disabled={pending}
                      onClick={() => onDisable(row.key, { queued: true })}
                      title="Don't ask this question at all this session. It moves to the Disabled list below, where you can bring it back."
                      aria-label={`Disable ${row.title || row.key} for this session`}
                    >
                      <Icon name="EyeSlash" weight="bold" size={14} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="setup-q__btn"
                    disabled={pending}
                    onClick={() => onRemove(row.key)}
                    title="Take it out of the queue. It goes back to the automatic order, wherever the walk puts it."
                    aria-label={`Move ${row.title || row.key} out of the queue`}
                  >
                    <Icon name="X" weight="bold" size={14} />
                  </button>
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {/*
        WHAT COMES AFTER THE QUEUE — the automatic walk, shown rather than left
        to be discovered a round at a time.

          "how much work to offer the up next to show the next several
           questions even if its just the built in queue. might create a obvious
           tag when the user queued it up just to distinguish."

        THE TAG IS ON THESE ROWS, NOT ON THE QUEUED ONES, and that asymmetry is
        deliberate. The queued rows already announce themselves: they are
        numbered, they are movable, and they sit under a heading that says
        Running order. It is the rows the host did NOT choose that need
        explaining, so the label goes where the question is.

        MOVABLE NOW, BY MATERIALISING. These are derived — the automatic
        walk's answer given the cursors, the enabled categories and what has
        already been asked — so there is no stored order to edit in place.
        What a press on ↑↓ does instead is turn the DISPLAYED plan into queued
        rows and then apply the move, which is the owner's own reading of the
        gesture: "if there was Q1 - A Q2 - B and Q3 - C. and i move B to the
        bottom in a way all of them now are manually adjusted." The rows
        re-render as queued (numbered, fully editable) on the next fetch,
        because that is genuinely what they have become.

        IT CAN GO STALE, and cheaply: toggling a category changes which
        questions are reachable. The caller re-fetches rather than caching, so
        this list is as current as the last poll and no warning is needed about
        a thing that repairs itself in two seconds.
      */}
      {autoRows.length > 0 && (
        <div className="setup-q__auto" data-testid="queue-auto">
          <p className="setup-q__auto-head">
            {count === 0 ? 'Coming up' : 'Then, automatically'}
          </p>
          <ol className="setup-q__list setup-q__list--auto" start={count + 1}>
            {autoRows.map((row, autoIndex) => {
              /*
                THE EDGES, in the materialised list this press will create:
                [...queue, ...autos]. The first auto can still move EARLIER
                when there are queued rows above it to swap past; the last
                shown auto cannot move LATER, because what lies beyond the
                displayed plan has not been planned and cannot be swapped with.
              */
              const canEarlier = autoIndex > 0 || count > 0;
              const canLater = autoIndex < autoRows.length - 1;
              const label = row.title || row.questionId;
              return (
                <li
                  key={row.questionId}
                  className="setup-q__row setup-q__row--auto"
                  data-testid="queue-auto-row"
                >
                  <span className="setup-q__pos" aria-hidden="true">{row.round}</span>
                  <span className="setup-q__main">
                    <span className="setup-q__name">{label}</span>
                    <span className="setup-q__meta">
                      <span className="setup-q__flag setup-q__flag--auto">Auto</span>
                      {row.categoryName && <span className="setup-q__cat">{row.categoryName}</span>}
                    </span>
                  </span>
                  {onAutoMove && (
                    <span className="setup-q__acts">
                      {/* Disabled at the edges, never removed — the same rule
                          the queued rows follow, for the same
                          buttons-move-under-the-finger reason. */}
                      <button
                        type="button"
                        className="setup-q__btn"
                        disabled={!canEarlier}
                        onClick={() => onAutoMove(row.questionId, 'earlier')}
                        title="Moving this makes the whole listed order manual — every Auto row above becomes a queued row you can edit."
                        aria-label={`Move ${label} earlier`}
                      >
                        <Icon name="ArrowUp" weight="bold" size={14} />
                      </button>
                      <button
                        type="button"
                        className="setup-q__btn"
                        disabled={!canLater}
                        onClick={() => onAutoMove(row.questionId, 'later')}
                        title="Moving this makes the whole listed order manual — every Auto row shown becomes a queued row you can edit."
                        aria-label={`Move ${label} later`}
                      >
                        <Icon name="ArrowDown" weight="bold" size={14} />
                      </button>
                      {onDisable && (
                        <button
                          type="button"
                          className="setup-q__btn setup-q__btn--drop"
                          onClick={() => onDisable(row.questionId, { queued: false })}
                          title="Don't ask this question at all this session. It moves to the Disabled list below, where you can bring it back."
                          aria-label={`Disable ${label} for this session`}
                        >
                          <Icon name="EyeSlash" weight="bold" size={14} />
                        </button>
                      )}
                      {/* The fourth slot, INERT here on purpose: an auto row
                          is not in the queue, so there is nothing to move it
                          back out of — but the slot exists so the four
                          buttons align with the queued rows above, which is
                          the owner's report ("the up down buttons dont align
                          ... they should"). */}
                      <button
                        type="button"
                        className="setup-q__btn"
                        disabled
                        title="Not in the queue — nothing to move out."
                        aria-label={`${label} is not in the queue`}
                      >
                        <Icon name="X" weight="bold" size={14} />
                      </button>
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {/*
        THE VETO LIST, WITH ITS WAY BACK. A disabled question is invisible to
        the queue, the automatic walk and the preview — this section is the
        only place it still exists on screen, so hiding it would make Disable
        a delete wearing a softer name. Rendered only when non-empty: unlike
        the queue's empty line, the disable control explains itself on every
        row above, so an empty section here would teach nothing.
      */}
      {excludedRows.length > 0 && onRestore && (
        <div className="setup-q__auto" data-testid="queue-disabled">
          <p className="setup-q__auto-head">Disabled this session</p>
          <ol className="setup-q__list setup-q__list--auto">
            {excludedRows.map((row) => (
              <li key={row.key} className="setup-q__row setup-q__row--auto" data-testid="queue-disabled-row">
                <span className="setup-q__pos" aria-hidden="true">·</span>
                <span className="setup-q__main">
                  <span className="setup-q__name">{row.title || row.key}</span>
                  <span className="setup-q__meta">
                    <span className="setup-q__warn">Will not be asked</span>
                  </span>
                </span>
                <span className="setup-q__acts">
                  <button
                    type="button"
                    className="setup-q__btn"
                    onClick={() => onRestore(row.key)}
                    title="Put it back into play — the automatic order picks it up again."
                    aria-label={`Restore ${row.title || row.key}`}
                  >
                    <Icon name="Eye" weight="bold" size={14} />
                  </button>
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/*
        The cap, said only when it binds. `queueSummary` decides, so the panel
        and the server agree about what "full" means.
      */}
      {full && (
        <p className="setup-q__full" data-testid="queue-full">
          {`The queue is full at ${QUEUE_MAX}. Remove one to add another.`}
        </p>
      )}
    </section>
  );
}
