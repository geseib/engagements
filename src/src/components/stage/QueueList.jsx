import React, { useState } from 'react';
import Icon from '../Icon';
import Button from '../ui/Button';
import YoursMark from '../YoursMark';
import RowMenu from './RowMenu';
import { queueRows, queueSummary, QUEUE_MAX, isOwnKey } from '../../config/questionQueue';
import { questionKey } from '../../config/setupPanel';
import { ownQuestionWords as OQ } from '../../config/consoleWords';
import { numberRounds, baseFromPlan } from '../../config/roundNumbers';

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
 * ── ASK NEXT AND ASK NOW, ON EVERY ROW, AND ON BOTH HOST SURFACES ─────────
 *
 * The owner, testing on dev: *"when you click a question to 'ask next' on the
 * remote it actually switches the game to that one. The host screen does the
 * same thing ... 'ask next' in most people's mind means put it at the top of
 * the queue, not run it now."* So there are two verbs and they never share a
 * label: `onAskNext` puts the row at the head of this list (the `first` queue
 * op — the round in flight is untouched), `onAskNow` puts it on the room's
 * screen straight away. Both receive the CANONICAL key, whichever list the row
 * came from, because the caller hands it to a queue op or to next-question and
 * neither accepts the `QUESTION#` spelling.
 *
 * `variant="touch"` is the phone remote mounting this same list, so the host's
 * phone and the host's screen show one running order drawn by one component.
 * It changes geometry only (44px targets, titles that wrap, the actions on a
 * line of their own); every row, flag and label is the laptop's.
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
  /* Null = that control is not drawn, the same deal as `onAutoMove` below. The
     phone remote passes `onMove={null}`: four reorder targets at 44px do not
     fit beside a title in a 390px column, and the stage is where the order is
     arranged. */
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
  /*
    THE TWO ASKS. Null = not drawn, so a caller that cannot perform one never
    shows a button for it. `onAskNext(key, { title })` is the `first` queue op;
    `onAskNow(key, { title })` interrupts the room — the caller owns the guard
    for a round with answers still coming in, because only the caller knows the
    phase (the stage confirms in a dialog, the phone arms the button).
  */
  onAskNext = null,
  onAskNow = null,
  /* The row whose Ask now is ARMED on the phone — its first tap mid-round
     turned it into "Tap again to ask now". Null on the stage, which confirms
     in a dialog instead. */
  askNowArmedKey = null,
  /* Every ask button held while the caller is already moving the session
     (the phone's cooldown) — a double tap must not ask two questions. */
  askBusy = false,
  variant = 'panel',
  /*
    THE HOST'S OWN QUESTIONS (impromptu ask, README D5): `ownQuestions` from
    the queue route ({ key, title, status, askedRound }). A queued `own:` row
    is marked Yours and carries Edit, earlier/later and Remove — no Disable
    (nothing in the set to disable) and no asks. Remove arms in place, once,
    with no second dialog (reviews W-5). `onWrite` draws "Write a question"
    in the head; null draws nothing.
  */
  ownQuestions = [],
  onWrite = null,
  onEditOwn = null,
  onRemoveOwn = null,
  /*
    ONE NUMBERING WITH THE RAIL (owner, 3 Nov 2026: "its list in rounds does
    not line up"). `base` is the round the session is on — the one on screen,
    or the last one played — from the same place the rail's Round queue reads
    it (config/roundNumbers.js). Every row is numbered by its place in the
    SESSION, base + 1 onward, never by its place in the queue. Null: the
    server's plan says (its first row is the next round).
    `nowRound` ({ title, key }) draws the round on screen as the list's first,
    quiet row, numbered `base`, with no actions. Null draws none.
  */
  base = null,
  nowRound = null,
  /*
    THE SESSION MENU'S ROWS (docs/design/session-menu D9, fork F3): ↑ ↓ ⋯.
    Ask next, Ask now (with its warning), Put aside for this session and
    Remove move into one ⋯ per row; a Yours row's ⋯ holds Edit and Remove.
    The fixed action columns stay (e91062b41): every row draws the same up,
    down and ⋯ cells, empty rather than collapsed. Off (the phone, the
    tests that drive the old columns): the five cells as before.
  */
  rowMenu = false,
  /* Rows drawn before "N more · Show all" (the menu's default view draws
     five). Null: all of them. The numbering and the edge rules still read
     the whole list. */
  limit = null,
  /* The put-aside list under the rows. The Session menu draws it in Up next's
     More options instead (PutAsideList below), so it passes false. */
  showExcluded = true,
}) {
  const [showAll, setShowAll] = useState(false);
  const ownByKey = new Map((ownQuestions || []).filter((o) => o && o.key).map((o) => [o.key, o]));
  const [armedRemove, setArmedRemove] = useState(null);
  const rows = queueRows(queue, {
    questions: [...questions, ...[...ownByKey.values()].map((o) => ({ id: o.key, title: o.title }))],
  });
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
  const nowKey = nowRound && nowRound.key ? questionKey(String(nowRound.key)) : null;
  const autoRows = upNext.filter((row) => row && row.source === 'auto'
    // The plan read a moment before the round started can still list the
    // round now on screen; the rail drops it the same way.
    && !(nowKey && questionKey(String(row.questionId)) === nowKey));

  /*
    THE NUMBERS, from the one function the rail numbers with. A queued row the
    serve passes over (parked by the server, or an own question no longer
    waiting) takes no number, as it takes no round in the plan, so the list
    never skips one; the automatic rows carry on from the last queued number.
  */
  const roundBase = base !== null && Number.isFinite(Number(base)) ? Number(base) : baseFromPlan(upNext);
  const passedOver = (row) => {
    if (!row || row.auto) return false;
    if (blockedByKey.has(row.key)) return true;
    if (nowKey && row.key === nowKey) return true;
    const own = isOwnKey(row.key) ? ownByKey.get(row.key) : null;
    return Boolean(own && own.status && own.status !== 'queued');
  };
  const numbers = numberRounds(roundBase, [...rows, ...autoRows.map(() => ({ auto: true }))], passedOver);
  const numberOf = (i) => (numbers[i] === null || numbers[i] === undefined ? '·' : numbers[i]);
  /* `limit`: how many rows draw before "N more · Show all", queued first. */
  const capped = Number(limit) > 0 && !showAll;
  const shownQueued = capped ? Math.min(rows.length, Number(limit)) : rows.length;
  const shownAuto = capped ? Math.max(0, Math.min(autoRows.length, Number(limit) - shownQueued)) : autoRows.length;
  const hiddenRows = rows.length + autoRows.length - shownQueued - shownAuto;

  /*
    WHICH ROW "ASK NEXT" WOULD NOT MOVE — the one the next end-of-round serves
    already: the flagged queued row, or with nothing servable queued, the first
    automatic pick. Its Ask next is held rather than hidden, for the same
    buttons-move-under-the-finger reason the edge arrows are, and its Next flag
    (or its place at the top of the automatic order) already says why.
  */
  const servesNext = nextKey
    || (autoRows[0] ? questionKey(String(autoRows[0].questionId)) : null);
  const hasAsks = Boolean(onAskNext || onAskNow);
  const armedKey = askNowArmedKey ? questionKey(String(askNowArmedKey)) : null;

  /*
    The pair, drawn identically on a queued row and an automatic one so the two
    lists read as one running order. Ask next comes FIRST and Ask now second:
    the reversible, round-preserving verb is the one the eye meets first, and
    the one that interrupts the room is the one further along.
  */
  const askButtons = (key, label, pending = false) => {
    const armed = key === armedKey;
    const nowLabel = armed ? 'Tap again to ask now' : 'Ask now';
    return (
      <>
        {onAskNext && (
          <button
            type="button"
            className="setup-ask setup-ask--next"
            disabled={askBusy || pending || key === servesNext}
            onClick={() => onAskNext(key, { title: label })}
            title="Put it at the top of the running order. The round on screen carries on; this is asked when you end it."
            aria-label={`Ask next: ${label}`}
          >
            Ask next
          </button>
        )}
        {onAskNow && (
          <button
            type="button"
            className={`setup-ask setup-ask--now ${armed ? 'is-armed' : ''}`}
            disabled={askBusy}
            onClick={() => onAskNow(key, { title: label })}
            title="Put it on the room's screen straight away. The round on screen ends."
            aria-label={`${nowLabel}: ${label}`}
          >
            {nowLabel}
          </button>
        )}
      </>
    );
  };

  /*
    THE ACTION COLUMNS, FIXED (owner, 3 Nov 2026: the Yours row's ↑ ↓ did not
    line up with the automatic rows'). Every row with actions draws the SAME
    five cells — primary (Ask next · Ask now, or Edit), ↑, ↓, drop (hide, or
    remove a Yours row) and out (back out of the queue) — and a row without
    one of them leaves that cell EMPTY rather than collapsing it. Which
    columns exist is a fact about the LIST (what the caller can do), set once
    on the section, so the grid tracks are identical on every row.
  */
  const hasMove = Boolean(onMove || onAutoMove);
  const hasDrop = Boolean(onDisable || onRemoveOwn || onRemove || onRestore);
  const hasOut = Boolean(onRemove);
  /* With `rowMenu` the list has two columns of moves and one of ⋯, which
     takes the `out` track: the same named grid, so the cells still line up. */
  const colClasses = (rowMenu ? [
    hasMove ? 'setup-q--c-move' : '',
    'setup-q--c-out',
    'setup-q--menu',
  ] : [
    hasAsks ? 'setup-q--c-asks' : (onEditOwn ? 'setup-q--c-edit' : ''),
    hasMove ? 'setup-q--c-move' : '',
    hasDrop ? 'setup-q--c-drop' : '',
    hasOut ? 'setup-q--c-out' : '',
  ]).filter(Boolean).join(' ');
  /* ⋯ for a set row (queued or automatic): the asks, then put aside, then
     out of the queue. Ask now carries the line that says what it costs. */
  const setRowMenu = (key, label, { pending = false, queued = false, disable = false } = {}) => (
    <RowMenu
      label={`More for ${label}`}
      testId="queue-row-menu"
      items={[
        onAskNext && {
          id: 'ask-next',
          label: 'Ask next',
          note: 'Top of the running order; the round on screen carries on.',
          disabled: askBusy || pending || key === servesNext,
          onSelect: () => onAskNext(key, { title: label }),
        },
        onAskNow && {
          id: 'ask-now',
          label: 'Ask now',
          note: 'Ends the round on screen and asks this.',
          disabled: askBusy,
          onSelect: () => onAskNow(key, { title: label }),
        },
        disable && onDisable && {
          id: 'put-aside',
          label: 'Put aside for this session',
          disabled: pending,
          onSelect: () => onDisable(key, { queued }),
        },
        queued && onRemove && {
          id: 'remove',
          label: 'Take it out of the running order',
          disabled: pending,
          onSelect: () => onRemove(key),
        },
      ]}
    />
  );
  const actsCells = ({ primary = null, up = null, down = null, drop = null, out = null, outTestId }) => (
    <span className="setup-q__acts" data-testid="queue-acts">
      <span className="setup-q__cell setup-q__cell--primary" data-col="primary">{primary}</span>
      <span className="setup-q__cell setup-q__cell--up" data-col="up">{up}</span>
      <span className="setup-q__cell setup-q__cell--down" data-col="down">{down}</span>
      <span className="setup-q__cell setup-q__cell--drop" data-col="drop">{drop}</span>
      <span
        className="setup-q__cell setup-q__cell--out"
        data-col="out"
        data-testid={outTestId}
        aria-hidden={out ? undefined : 'true'}
      >
        {out}
      </span>
    </span>
  );
  const moveButton = (dir, { disabled, onClick, label, title }) => (
    <button
      type="button"
      className="setup-q__btn"
      disabled={disabled}
      onClick={onClick}
      title={title}
      aria-label={`Move ${label} ${dir}`}
    >
      <Icon name={dir === 'earlier' ? 'ArrowUp' : 'ArrowDown'} weight="bold" size={14} />
    </button>
  );

  return (
    <section
      className={`setup-q ${variant === 'touch' ? 'setup-q--touch' : ''} ${colClasses}`}
      aria-labelledby="setup-q-head"
    >
      <div className="setup-q__head">
        <h3 className="setup-q__title" id="setup-q-head">Running order</h3>
        {onWrite ? (
          <Button variant="secondary" size={variant === 'touch' ? 44 : 36} className="setup-q__write" onClick={onWrite} data-testid="queue-write">
            <Icon name="Plus" weight="bold" size={14} color="currentColor" />
            {OQ.write}
          </Button>
        ) : null}
        {/*
          The count is a fact about the queue and is stated ONCE. The cap only
          appears when it is close enough to matter — a permanent "0 of 24"
          teaches the host a limit they will never reach and states a second
          fact about the same object, which the console's own rule forbids.
        */}
        <span className="setup-q__count" data-testid="queue-count">
          {/* With nothing queued the list below is still full — of the
              AUTOMATIC order. A bare "Nothing queued" over six listed rows read
              to the owner as a bug ("it has questions queued, but says there
              are none"), so the count says what the rows are. */}
          {count === 0
            ? (autoRows.length > 0 ? 'Nothing queued — automatic order below' : 'Nothing queued')
            : `${count} queued`}
          {count >= QUEUE_MAX - 4 && ` of ${QUEUE_MAX}`}
        </span>
      </div>

      {/* THE ROUND ON SCREEN, first and quiet: the number the rail gives it,
          the word "Now", no actions. It is what makes the next row's number
          read as base + 1 rather than as a skipped 1. */}
      {nowRound && nowRound.title ? (
        <ol className="setup-q__list setup-q__list--now">
          <li className="setup-q__row setup-q__row--now" data-testid="queue-now-row">
            <span className="setup-q__pos" aria-hidden="true" data-testid="queue-pos">{roundBase > 0 ? roundBase : '·'}</span>
            <span className="setup-q__main">
              <span className="setup-q__name" title={nowRound.title}>{nowRound.title}</span>
              <span className="setup-q__meta">
                <span className="setup-q__flag setup-q__flag--now">Now</span>
              </span>
            </span>
          </li>
        </ol>
      ) : null}

      {count === 0 ? (
        <p className="setup-q__empty" data-testid="queue-empty">
          <b>Ask next</b> puts a question at the top of the running order — it waits until
          you end the current round. <b>Ask now</b> puts it on screen straight away.
        </p>
      ) : (
        <ol className="setup-q__list" data-testid="queue-list">
          {rows.map((row, rowIndex) => {
            if (rowIndex >= shownQueued) return null;
            const pending = busy.has(row.key);
            /*
              PARKED, BY THE SERVER'S OWN RULE. The reason comes from the same
              resolver the plan runs, so this tag and the serve can never
              disagree. `not-in-set` is left to the local `missing` warn below,
              which already covers it from the browser rows.
            */
            const parked = blockedByKey.get(row.key);
            const parkedHere = isParked(row);
            const own = isOwnKey(row.key);
            const ownRow = own ? ownByKey.get(row.key) : null;
            const ownTitle = (ownRow && ownRow.title) || row.title || '';
            if (own) {
              const armed = armedRemove === row.key;
              return (
                <li
                  key={row.key}
                  className={`setup-q__row setup-q__row--own ${row.key === nextKey ? 'is-next' : ''}`}
                  data-testid="queue-row"
                  data-own="true"
                >
                  <span className="setup-q__pos" aria-hidden="true" data-testid="queue-pos">{numberOf(rowIndex)}</span>
                  <span className="setup-q__main">
                    <span className="setup-q__name" title={ownTitle}>{ownTitle || OQ.yours}</span>
                    <span className="setup-q__meta">
                      {row.key === nextKey && (
                        <span className="setup-q__flag" data-testid="queue-next-flag">Next</span>
                      )}
                      <YoursMark />
                    </span>
                    {armed ? (
                      <span className="setup-q__arm" role="group" aria-label={OQ.remove} data-testid="queue-own-arm">
                        <span className="setup-q__arm-t">{OQ.removeAsk(ownTitle)}</span>
                        <Button variant="secondary" size={variant === 'touch' ? 44 : 36} onClick={() => setArmedRemove(null)}>{OQ.keepIt}</Button>
                        <Button
                          variant="danger"
                          size={variant === 'touch' ? 44 : 36}
                          onClick={() => { setArmedRemove(null); (onRemoveOwn || onRemove)(row.key, { title: ownTitle }); }}
                          data-testid="queue-own-remove-confirm"
                        >
                          {OQ.remove}
                        </Button>
                      </span>
                    ) : null}
                  </span>
                  {rowMenu ? actsCells({
                    up: onMove ? moveButton('earlier', { disabled: !row.canMoveEarlier || pending, onClick: () => onMove(row.key, 'earlier'), label: ownTitle }) : null,
                    down: onMove ? moveButton('later', { disabled: !row.canMoveLater || pending, onClick: () => onMove(row.key, 'later'), label: ownTitle }) : null,
                    out: (
                      <RowMenu
                        label={`More for ${ownTitle || OQ.yours}`}
                        testId="queue-own-menu"
                        items={[
                          onEditOwn && { id: 'edit', label: OQ.edit, disabled: pending, onSelect: () => onEditOwn(row.key, ownRow) },
                          (onRemoveOwn || onRemove) && { id: 'remove', label: OQ.remove, disabled: pending, onSelect: () => setArmedRemove(row.key) },
                        ]}
                      />
                    ),
                  }) : actsCells({
                    primary: onEditOwn ? (
                      <Button
                        variant="secondary"
                        size={variant === 'touch' ? 44 : 36}
                        className="setup-q__edit"
                        disabled={pending}
                        onClick={() => onEditOwn(row.key, ownRow)}
                        aria-label={`${OQ.edit}: ${ownTitle}`}
                        data-testid="queue-own-edit"
                      >
                        {OQ.edit}
                      </Button>
                    ) : null,
                    up: onMove ? moveButton('earlier', { disabled: !row.canMoveEarlier || pending, onClick: () => onMove(row.key, 'earlier'), label: ownTitle }) : null,
                    down: onMove ? moveButton('later', { disabled: !row.canMoveLater || pending, onClick: () => onMove(row.key, 'later'), label: ownTitle }) : null,
                    drop: (onRemoveOwn || onRemove) ? (
                      <button
                        type="button"
                        className="setup-q__btn setup-q__btn--drop"
                        disabled={pending}
                        onClick={() => setArmedRemove(row.key)}
                        aria-label={`${OQ.remove}: ${ownTitle}`}
                        data-testid="queue-own-remove"
                      >
                        <Icon name="Trash" weight="bold" size={14} />
                      </button>
                    ) : null,
                  })}
                </li>
              );
            }
            return (
              <li
                key={row.key}
                className={`setup-q__row ${row.key === nextKey ? 'is-next' : ''} ${row.missing ? 'is-missing' : ''}`}
                data-testid="queue-row"
              >
                <span className="setup-q__pos" aria-hidden="true" data-testid="queue-pos">{numberOf(rowIndex)}</span>
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
                {/*
                  THE FIVE CELLS (see actsCells): the owner's four verbs, "move
                  up/move down/disable/move back out of the immediate queue",
                  after the asks — the SAME cells the auto and Yours rows
                  carry, so every list's buttons align down the panel.

                  DISABLED AT THE EDGES rather than absent: a control that
                  disappears on the first row would empty its cell and the
                  buttons would move under the finger as the list reorders.
                  The predicate is `queueRows`', which is `queueMove`'s clamp.
                */}
                {rowMenu ? actsCells({
                  up: onMove ? moveButton('earlier', { disabled: !row.canMoveEarlier || pending, onClick: () => onMove(row.key, 'earlier'), label: row.title || row.key }) : null,
                  down: onMove ? moveButton('later', { disabled: !row.canMoveLater || pending, onClick: () => onMove(row.key, 'later'), label: row.title || row.key }) : null,
                  out: setRowMenu(row.key, row.missing ? row.key : (row.title || row.key), { pending, queued: true, disable: true }),
                }) : actsCells({
                  primary: hasAsks ? askButtons(row.key, row.missing ? row.key : (row.title || row.key), pending) : null,
                  up: onMove ? moveButton('earlier', { disabled: !row.canMoveEarlier || pending, onClick: () => onMove(row.key, 'earlier'), label: row.title || row.key }) : null,
                  down: onMove ? moveButton('later', { disabled: !row.canMoveLater || pending, onClick: () => onMove(row.key, 'later'), label: row.title || row.key }) : null,
                  drop: onDisable ? (
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
                  ) : null,
                  out: onRemove ? (
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
                  ) : null,
                })}
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
      {shownAuto > 0 && (
        <div className="setup-q__auto" data-testid="queue-auto">
          <p className="setup-q__auto-head">
            {count === 0 ? 'Coming up — automatic order' : 'Then, automatically'}
          </p>
          <ol className="setup-q__list setup-q__list--auto">
            {autoRows.map((row, autoIndex) => {
              if (autoIndex >= shownAuto) return null;
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
              const acts = Boolean(onAutoMove || hasAsks);
              return (
                <li
                  key={row.questionId}
                  className={`setup-q__row setup-q__row--auto ${acts ? 'setup-q__row--acts' : ''}`}
                  data-testid="queue-auto-row"
                >
                  <span className="setup-q__pos" aria-hidden="true" data-testid="queue-pos">{numberOf(rows.length + autoIndex)}</span>
                  <span className="setup-q__main">
                    <span className="setup-q__name">{label}</span>
                    <span className="setup-q__meta">
                      <span className="setup-q__flag setup-q__flag--auto">Auto</span>
                      {row.categoryName && <span className="setup-q__cat">{row.categoryName}</span>}
                    </span>
                  </span>
                  {/* Disabled at the edges, never removed — the same rule
                      the queued rows follow. The out cell stays EMPTY: an
                      auto row is not in the queue, so there is nothing to
                      move it back out of. It was a greyed-out X once, and the
                      owner read that as a broken remove button; a control
                      that can never work is not drawn, but its cell is kept. */}
                  {acts && rowMenu ? actsCells({
                    up: onAutoMove ? moveButton('earlier', {
                      disabled: !canEarlier,
                      onClick: () => onAutoMove(row.questionId, 'earlier'),
                      label,
                      title: 'Moving this makes the whole listed order manual — every Auto row above becomes a queued row you can edit.',
                    }) : null,
                    down: onAutoMove ? moveButton('later', {
                      disabled: !canLater,
                      onClick: () => onAutoMove(row.questionId, 'later'),
                      label,
                      title: 'Moving this makes the whole listed order manual — every Auto row shown becomes a queued row you can edit.',
                    }) : null,
                    out: setRowMenu(questionKey(String(row.questionId)), label, { disable: Boolean(onAutoMove) }),
                  }) : acts && actsCells({
                    primary: hasAsks ? askButtons(questionKey(String(row.questionId)), label) : null,
                    up: onAutoMove ? moveButton('earlier', {
                      disabled: !canEarlier,
                      onClick: () => onAutoMove(row.questionId, 'earlier'),
                      label,
                      title: 'Moving this makes the whole listed order manual — every Auto row above becomes a queued row you can edit.',
                    }) : null,
                    down: onAutoMove ? moveButton('later', {
                      disabled: !canLater,
                      onClick: () => onAutoMove(row.questionId, 'later'),
                      label,
                      title: 'Moving this makes the whole listed order manual — every Auto row shown becomes a queued row you can edit.',
                    }) : null,
                    drop: onAutoMove && onDisable ? (
                      <button
                        type="button"
                        className="setup-q__btn setup-q__btn--drop"
                        onClick={() => onDisable(row.questionId, { queued: false })}
                        title="Don't ask this question at all this session. It moves to the Disabled list below, where you can bring it back."
                        aria-label={`Disable ${label} for this session`}
                      >
                        <Icon name="EyeSlash" weight="bold" size={14} />
                      </button>
                    ) : null,
                    outTestId: 'queue-auto-slot',
                  })}
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
      {/* THE REST OF THE ORDER, ONE PRESS AWAY (the menu's default view
          draws five rows). Says how many, so nothing is hidden blind. */}
      {hiddenRows > 0 || (limit && showAll && rows.length + autoRows.length > limit) ? (
        <p className="setup-q__more" data-testid="queue-show-all">
          {hiddenRows > 0 ? <span>{`${hiddenRows} more`}</span> : null}
          {hiddenRows > 0 ? <span aria-hidden="true">{' · '}</span> : null}
          <Button variant="tertiary" size="sm" onClick={() => setShowAll((v) => !v)}>
            {hiddenRows > 0 ? 'Show all' : 'Show fewer'}
          </Button>
        </p>
      ) : null}

      {showExcluded && excludedRows.length > 0 && onRestore && (
        <div className="setup-q__auto" data-testid="queue-disabled">
          <p className="setup-q__auto-head">Disabled this session</p>
          <ol className="setup-q__list setup-q__list--auto">
            {excludedRows.map((row) => (
              <li key={row.key} className="setup-q__row setup-q__row--auto setup-q__row--acts" data-testid="queue-disabled-row">
                <span className="setup-q__pos" aria-hidden="true">·</span>
                <span className="setup-q__main">
                  <span className="setup-q__name">{row.title || row.key}</span>
                  <span className="setup-q__meta">
                    <span className="setup-q__warn">Will not be asked</span>
                  </span>
                </span>
                {actsCells({
                  drop: (
                    <button
                      type="button"
                      className="setup-q__btn"
                      onClick={() => onRestore(row.key)}
                      title="Put it back into play — the automatic order picks it up again."
                      aria-label={`Restore ${row.title || row.key}`}
                    >
                      <Icon name="Eye" weight="bold" size={14} />
                    </button>
                  ),
                })}
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

/**
 * PUT ASIDE THIS SESSION (the Session menu's Up next · More options): the
 * per-session veto list with its way back. The same rows QueueList draws under
 * the order when `showExcluded` is on; a veto with no undo is a trap.
 */
export function PutAsideList({ rows = [], onRestore = null }) {
  if (!rows.length || !onRestore) return null;
  return (
    <ol className="setup-q__list setup-q__list--auto smenu-aside" data-testid="queue-disabled">
      {rows.map((row) => (
        <li key={row.key} className="smenu-aside__row" data-testid="queue-disabled-row">
          <span className="smenu-aside__name" title={row.title || row.key}>{row.title || row.key}</span>
          <Button
            variant="secondary"
            size={36}
            onClick={() => onRestore(row.key)}
            title="Put it back into play — the automatic order picks it up again."
            aria-label={`Restore ${row.title || row.key}`}
          >
            Restore
          </Button>
        </li>
      ))}
    </ol>
  );
}
