import React, { useLayoutEffect, useRef } from 'react';
import RoomWindowLink from './RoomWindowLink';
import CompletionFlag from './CompletionFlag';
import HelpButton from '../HelpButton';
import { helpFor } from '../../config/help/screens';
import { DockKeyContext, keyName } from './KeyCap';
import Icon from '../Icon';
import HW from '../../config/hostWords';

/**
 * The dock — the `.dock` grid area, and the room's one persistent action
 * strip. This is a GRID ROW, not a fixed overlay. `position:fixed`
 * guarantees the control is *visible*; a grid row guarantees it is
 * *placed* — it cannot be covered by a rail, clipped by a
 * `height:100vh;overflow:hidden` ancestor (the exact bug documented at
 * ../../styles.css:7190), or reach a state where reserved padding fights
 * the content. It reserves `--dock-h` per profile through the `.dock` rule
 * in ../../styles/stage.css.
 *
 * The primary action is not reimplemented here — it is whatever the caller
 * passes as children, in practice the existing HostActionBar rendered with
 * `bigScreen`. Its keyboard handling, its typing-target guard and its
 * disabled-hint behaviour are untouched; only its positioning CSS changes,
 * because HostActionBar's own big-screen-mode rule already goes static
 * inside a container like this one.
 *
 * `status` and `hint` are optional, room-safe text — the sentence the room
 * needs (e.g. "Some are still answering") and, separately, the room-safe
 * explanation the big screen shows in place of HostActionBar's own
 * disabled-hint (which HostActionBar hides in big-screen mode, because a
 * host-facing hint like "Waiting on 3 more" is a private instruction, not
 * something to project). Neither renders an empty element when absent.
 *
 * `notice` marks the status as the session goal's notice ("That's your 2.
 * Keep going if there's time, or end the session." — config/goalStage.js).
 * It is drawn as an amber chip, `.status.notice`, rather than the grey status
 * line it used to share, which the 2026-09-29 QA drive missed on a projector
 * (finding #22). Still words only: nothing about it blocks the primary.
 *
 * `kbd` is the key that also fires the primary — "SPACE" in every mockup dock,
 * on every state. It has to be rendered HERE and not left to HostActionBar,
 * which hides its own `__kbd` under `.big-screen-mode`, the mode the dock
 * always passes: without this the affordance is invisible in all four
 * profiles, which is the state the `.dock .kbd` note in ../../styles/stage.css
 * was written to prevent. It sits immediately after the primary, as it does in
 * the mockups, and it is aria-hidden because it is a visual affordance for the
 * operator, not a control.
 *
 * ---------------------------------------------------------------------------
 * `progress` — WHERE THE ANSWERED / VOTED COUNT GOES WHEN THE METER'S COLUMN IS
 * TAKEN AWAY. This is the fix for a reported defect and the reasoning matters,
 * because the behaviour it changes was deliberate.
 *
 * The fitter enters the meter into the ordered sacrifice at priority -1, ahead
 * of every content group (hooks/fitPolicy.js), and `widen()` surrenders the
 * column by setting `.main.solo` and `meter.hidden = true`. CHROME BEFORE
 * CONTENT is correct and is not being reversed here — width is the cheapest
 * lever on the stage and an answer must never be thrown away to keep a column.
 *
 * What was wrong is that surrendering the COLUMN also deleted the COUNT, and
 * those are not the same thing. The column is 210-460px of horizontal stage;
 * the fraction is seven characters. Measured against the mockups with the
 * shipped fitter, at 1280x720 Room, TV and Call all lose the meter on
 * `05-vote`, and TV loses it on `03-ask-trivia` at 1920x1080 as well — which is
 * precisely the owner's report that "the larger views also don't have the
 * player counts for answered/voted". The bigger the ladder, the sooner the
 * content overflows, and the first thing sacrificed is the number the host is
 * waiting on.
 *
 * So the column still goes and the count moves here, into a row that is already
 * a fixed-height flex line with a `.spacer` in it — zero additional content
 * height, zero column width.
 *
 * EXACTLY ONE OF THE TWO IS EVER VISIBLE, and the switch is CSS, not React.
 * Audit check A12 fails a viewport that states progress more than once, so this
 * mirror is `display:none` until `.main[data-auto-solo="1"] ~ .dock` matches —
 * `data-auto-solo` being the attribute `widen()` already sets and `unwiden()`
 * already clears. Driving it off the fitter's own attribute means React never
 * has to learn what the fitter decided, and the two can never disagree; see
 * ../../styles/stage.css, where the rule and this argument are repeated next to
 * the selector.
 * ---------------------------------------------------------------------------
 */
/**
 * THE LAST RESORT WHEN THE DOCK IS CROWDED. The key hints give way first, by
 * width, in ../../styles/stage.css; an event's AGENDA chip adds a 94px target,
 * so they give way sooner there (`data-agenda`). If the row still runs past the
 * edge, `data-crowded` is set and the quiet items keep their glyph and drop
 * their word (AGENDA, PRESENT; the name stays in the aria-label and
 * the title), the key hint goes and the Space cap goes. If it is STILL too
 * wide, `data-crowded="2"`: the secondary and tertiary round buttons keep
 * their glyph and hide their word visually (still their accessible name, and
 * their title); and only then `"3"`, Main menu down to its house. The main
 * button and SESSION always keep their words.
 *
 * IT USED TO WRAP. A crowded dock took a second line (27 Sep 2026: SESSION
 * clipped at 1280x720 on a closed survey's feedback beat in an event), and on
 * 2 Nov the owner reported exactly that second line, once the Needs-you bell
 * joined the row: "the bottom bar became 2 lines". A second line moves every
 * button the host has learned to find and takes a row from the stage, so the
 * dock never wraps now outside the portrait-tablet rule (max-width:900px).
 *
 * Measured, not guessed from a breakpoint, because the labels change with
 * every beat: the attribute is cleared, the row measured with its words, and
 * set again only if it overflows — so it can never hold itself in place.
 */
function useCrowded(ref, deps) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const over = () => el.scrollWidth > el.clientWidth + 1;
    const fit = () => {
      el.removeAttribute('data-crowded');
      if (!over()) return;
      // One step at a time, measuring after each (see ../../styles/stage.css):
      // '' the hints go and AGENDA / PRESENT keep their glyph; '2' the second
      // and third round buttons keep their glyph; '3' Main menu keeps its
      // glyph too, because it is the way out the owner could not find; '4'
      // the status narrows. The main button and SESSION never lose their words.
      const steps = ['', '2', '3', '4'];
      for (let i = 0; i < steps.length; i += 1) {
        el.setAttribute('data-crowded', steps[i]);
        if (!over()) break;
      }
    };
    fit();
    window.addEventListener('resize', fit);
    // AND WHEN THE LADDER CHANGES UNDER IT. The stage puts its profile class
    // on <html> in an effect that runs after this one, and the host can switch
    // profile mid-session; either way the words grow (TV's floor is 26px)
    // with no resize and no new props, so the first measure was Room's.
    // Settles in one pass: fit() always starts from the cleared state, so a
    // second call lands where the first did and reports no new size.
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => fit()) : null;
    if (ro) {
      // The dock, and every item in it: a font swap changes their widths and
      // not always the dock's height.
      ro.observe(el);
      el.querySelectorAll(':scope > *, .host-action-bar__actions > *').forEach((item) => ro.observe(item));
    }
    // A web font arriving widens every word without a resize either.
    const fonts = typeof document !== 'undefined' && document.fonts && typeof document.fonts.addEventListener === 'function'
      ? document.fonts : null;
    if (fonts) fonts.addEventListener('loadingdone', fit);
    return () => {
      window.removeEventListener('resize', fit);
      if (ro) ro.disconnect();
      if (fonts) fonts.removeEventListener('loadingdone', fit);
    };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}

/*
  FIXED SLOTS (docs/design/parity/PLAN.md §2a; owner, 17 Oct 2026: "the bottom
  row buttons jump all over the place"). The right-hand items are anchored at
  the right edge, so only what sits to their RIGHT can move them. Two things
  did: the SPACE cap, removed whenever Space did nothing (a disabled primary,
  an open overlay), which slid the main button right and back; and the hint,
  which sat after the buttons and pushed them by the width of its words.
  So a `kbd` passed as '' keeps its slot, hidden (`data-off`, visibility in
  styles.css), and the hint comes before the buttons. A caller that never
  passes `kbd` still gets none.

  THE KEY IS ON THE BUTTON NOW (owner, 31 Oct 2026: "i dont like the word
  SPACE just dangling outside the button"). The dock no longer draws it; it
  hands `kbd` to the main button's <KeyCap> through DockKeyContext
  (./KeyCap.jsx), which draws a small cap at the button's trailing edge.

  `home` is a type's way back to its own host screen (Build Room's HOST), a
  fixed item just before SESSION; the two are always last.

  `onMainMenu` is the other end (owner, 2 Nov 2026: "im not real sure how to
  get back to the main menu here"): Main menu, FIRST in the dock, before the
  status, shaped like the dock's other quiet items. The caller hands it the
  console's own leave (GameHostPage's requestLeave, which asks first when
  people are in the room); the dock only draws it, and only when given one. `setupCount` and
  `setupOpen` let SESSION carry a count (someone asking to take a name) and
  say whether its panel is open, without a second SESSION button;
  `setupProps` are extra attributes for it (a data- attribute, say).
*/
// Kept as an export for anything that imported it from here.
export { keyName };

/*
  `lead` MAKES THIS "YOUR PART NOW" (experience plan §3.3, Phase 2 step 2h).
  The host stage puts the same strip directly under the top bar, slim, so the
  main button sits where the console's does: a <section> named by `lead`,
  `.dock.dock--part`, the word first, then the status, the count when the
  meter's column has gone, the hint and the round's buttons. Main menu, the
  bell, `?` and the Session menu are the top bar's (components/console/
  ConsoleTop.jsx), so a caller passing `lead` passes none of them here: one
  place for each thing. It holds still and stays one line exactly as the
  bottom dock does (the same fixed slots, the same useCrowded steps).
*/
export default function Dock({
  status, hint, kbd, onSetup, onAgenda, present = null, complete = false, notice = false, progress = null,
  statusLink = '', onStatusLink = null, home = null, setupCount = 0, setupCountLabel = '', setupOpen,
  setupProps = null, help = '', onMainMenu = null, lead = '', children, ...rest
}) {
  const ref = useRef(null);
  useCrowded(ref, [status, hint, kbd, onSetup, onAgenda, present, notice, progress, statusLink, home, setupCount, help, onMainMenu, lead, children]);
  // THE LATE COUNT AS A LINK (late items Task 4): `statusLink` is the last
  // part of the status ("1 late answer kept", or "Review" at the end), and
  // opens the host's late list. Only when the status really ends with it.
  const linked = Boolean(statusLink && onStatusLink && typeof status === 'string' && status.endsWith(statusLink));
  const Tag = lead ? 'section' : 'footer';
  return (
    <Tag
      className={lead ? 'dock dock--part' : 'dock'}
      ref={ref}
      aria-label={lead || undefined}
      data-agenda={onAgenda ? '' : undefined}
      {...rest}
    >
      {lead ? <span className="dock-k" aria-hidden="true">{lead}</span> : null}
      {typeof onMainMenu === 'function' && (
        <button
          type="button"
          className="dock-more dock-main"
          onClick={onMainMenu}
          aria-label={HW.mainMenu}
          title={HW.mainMenuHint}
          data-testid="dock-main-menu"
        >
          <Icon name="House" weight="bold" size={16} color="currentColor" />
          <span className="dock-more-lbl">{HW.mainMenu}</span>
        </button>
      )}
      {status && (
        <span
          className={`status${complete ? ' go' : ''}${notice ? ' notice' : ''}`}
          aria-live="polite"
          data-goal-notice={notice ? '' : undefined}
          // Your part now keeps its status on one line (stage.css): a cut
          // status carries its full words here (engage-design hard rule 7).
          title={lead && typeof status === 'string' ? status : undefined}
        >
          {linked ? (
            <>
              {status.slice(0, status.length - statusLink.length)}
              <button type="button" className="status-link" onClick={onStatusLink}>{statusLink}</button>
            </>
          ) : status}
        </span>
      )}
      {progress && (progress.heading || progress.body) && (
        <span
          className={`dock-progress${progress.complete ? ' done' : ''}`}
          data-progress-mirror=""
        >
          <b className="lbl">{progress.heading}</b>
          <span className="val">{progress.body}</span>
          {progress.complete && <CompletionFlag />}
        </span>
      )}
      <span className="spacer" />
      {hint && <span className="hint">{hint}</span>}
      <DockKeyContext.Provider value={typeof kbd === 'string' ? kbd : null}>
        {children}
      </DockKeyContext.Provider>
      {/*
        HELP (Help Phase 3): `help` is a screen id from config/help/screens.js,
        and the `?` opens that guide section on the host's screen, in the
        modal. The stage around the dock is the room's and carries no help;
        the dock is the host's control, so its `?` sits with AGENDA and
        SESSION, shaped like them, and only where a caller asks for it.
        Before them: `home` and SESSION are always the last two.
      */}
      {help ? (
        <HelpButton {...helpFor(help)} variant="inline" size="small" tooltip="Help" className="dock-more dock-help" />
      ) : null}
      {/*
        LAST IN THE DOCK, AND ON PURPOSE.

        The mockup put this first, at the far left, while the panel it opens is
        `right: 0`. So the host clicked bottom-left and a surface appeared on
        the far side of a projected screen — a long way to travel with a room
        watching, and no cue that the two were the same thing. The control now
        sits at the edge it opens from.

        It reads SESSION, not SETUP. Setup is something you do once, before
        anybody arrives; this panel is where the host sees who is in the room,
        which question comes next, and how the session is running, all of it
        mid-round. The panel's own heading stays "Session setup" because that
        is what the Settings tab does — the button names the whole thing.
        Still not "Console": user testing killed the proper noun.

        No `⋯` beside the word. The glyph and the label said the same thing
        inside one 48px target, and the whole argument for adding the label
        was that the glyph alone was unhittable.

        HIDDEN WHEN THERE IS NOTHING FOR IT TO OPEN (fix round 1, M1). Every
        caller on the live stage has a session panel and passes `onSetup`;
        `SurveyWalkthrough.jsx` does not, and an unconditional button here was
        a live-looking control wired to nothing once it stopped being the
        only caller.
      */}
      {/*
        AN EVENT'S ITEM (events M3, roadmap D5): the way back to the event's
        agenda, beside SESSION and shaped like it. It only navigates: the item
        keeps running (Pause and End are on the board's rows, and going live on
        another item finishes this one). Only where there is an event.
      */}
      {onAgenda && (
        <button
          type="button"
          className="dock-more"
          onClick={onAgenda}
          aria-label="Back to the event's agenda"
          title="Back to the event's agenda — the phones stay where they are"
        >
          <Icon name="ListBullets" weight="bold" size={16} color="currentColor" />
          <span className="dock-more-lbl">AGENDA</span>
        </button>
      )}
      {/*
        PRESENT (two-surface PLAN 2.13): opens /present, the page the room
        sees, in a new window — a real link, so the browser's own "open in new
        window" and a drag to the projector both work. Shaped like AGENDA and
        SESSION. Reads PRESENTING once a Presentation has connected (the host
        door's `presenting`). Only where the two-surface switch is on. The
        Build Room's Stage passes it always, with the window's status as its
        `title` (owner, 19 Oct 2026: the room's window from the Stage too).
        Its accessible label says "the room's window", the help's word for it
        (owner's decision 1, 22 Oct 2026); it said "the Presentation".
      */}
      {present && present.href && (
        <RoomWindowLink
          className="dock-more dock-present"
          href={present.href}
          aria-label={present.presenting > 0 ? 'Presenting. Open another room\'s window' : 'Open the room\'s window in a new window'}
          title={present.title || 'Drag it to the second screen and press F'}
          data-presenting={present.presenting > 0 ? '' : undefined}
        >
          {/* A surface may name it in its own words (`label`: the Build Room's "ROOM'S WINDOW"). */}
          <Icon name="Monitor" weight="bold" size={16} color="currentColor" />
          <span className="dock-more-lbl">{present.label || (present.presenting > 0 ? 'PRESENTING' : 'PRESENT')}</span>
        </RoomWindowLink>
      )}
      {home}
      {onSetup && (
        <button
          type="button"
          className={`dock-more${setupCount > 0 ? ' dock-more--lit' : ''}`}
          onClick={onSetup}
          aria-label={setupCount > 0 && setupCountLabel ? `Session panel, ${setupCount}${setupCountLabel}` : 'Session panel'}
          aria-haspopup={setupOpen === undefined ? undefined : 'dialog'}
          aria-expanded={setupOpen === undefined ? undefined : Boolean(setupOpen)}
          title="Session panel — backslash key"
          {...(setupProps || {})}
        >
          <span className="dock-more-lbl">SESSION</span>
          {setupCount > 0 && <span className="dock-more-n">{setupCount}{setupCountLabel && <span className="dock-sr">{setupCountLabel}</span>}</span>}
        </button>
      )}
    </Tag>
  );
}
