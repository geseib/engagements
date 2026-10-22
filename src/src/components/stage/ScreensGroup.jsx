import React, { useId } from 'react';
import { SCREEN_WORDS as W } from '../../config/roomScreen';
import { presentStatusFrom } from '../../config/presentStatus';
import { willPlace } from '../../present/roomWindow';
import RoomWindowLink, { RoomWindowTab } from './RoomWindowLink';
import HelpButton from '../HelpButton';
import { helpFor } from '../../config/help/screens';
import './ScreensGroup.css';

/**
 * THE SCREENS GROUP (docs/design/settings-consolidation, tab 1). One place for
 * everything about what the room watches, drawn in two places: the Session
 * panel's Settings tab and Setup in the loop (StepView). The owner, 16 Oct:
 * "there doesnt seem to be a way when clicking on the setup button to change
 * screen mode."
 *
 *   Where the room watches  one screen or two: the lobby chooser's choice
 *                           (config/roomScreen.js), stored per browser
 *   Room's window           Open ↗ and whether it is really up
 *                           (config/presentStatus.js), on two screens only
 *   Room screen size        was "Display profile": it sizes whatever the room
 *                           watches, on one screen or two
 *
 * `offerChoice` is false for game types two screens do not cover
 * (config/surfaces.js TWO_SURFACE_TYPES); then only the size is offered.
 *
 * The first two rows are exported, so the Build Room's Screens group
 * (buildroom/BuildSessionPanel.jsx WallScreens) draws the same parts.
 */

/** One screen or two: the segment, with the hint for the current choice. `words` may override the hints. */
export function ScreenChoiceRow({ choice = 'classic', onChoose = () => {}, words = W, help = '' }) {
  const two = choice === 'two';
  return (
    <div className="scr-row" data-row="where">
      <div className="scr-k">
        {/* `help`: the screen id whose section explains one screen or two
            (Help Phase 3). Here rather than on the lobby's chooser, which on
            one screen is drawn on the stage the room watches. */}
        <span className="scr-label">
          {words.where}
          {help ? <HelpButton {...helpFor(help)} variant="inline" size="small" tooltip={`Help: ${words.where}`} className="help-button-quiet scr-help" /> : null}
        </span>
        <span className="scr-hint">{two ? words.whereHintTwo : words.whereHintOne}</span>
      </div>
      <div className="scr-seg" role="group" aria-label={words.where}>
        <button type="button" className="scr-seg-btn" aria-pressed={!two} onClick={() => { if (two) onChoose('classic'); }}>{words.one}</button>
        <button type="button" className="scr-seg-btn" aria-pressed={two} onClick={() => { if (!two) onChoose('two'); }}>{words.two}</button>
      </div>
    </div>
  );
}

/**
 * The room's window: its state alone (the row's label already names it, W2),
 * the one instruction as text when it is open but not full screen (W3), Open ↗
 * and, on a laptop with no second display, Open as a tab with its line.
 * `linkProps` go on Open ↗ (a capability id, a title).
 */
export function RoomWindowRow({ href, detail = null, linkProps = {} }) {
  if (!href) return null;
  const status = presentStatusFrom(detail);
  const placing = willPlace();
  const note = status.state === 'windowed' ? W.fillOnce
    : status.state === 'closed' && !placing ? W.noSecondDisplay : '';
  return (
    <div className="scr-row" data-row="window">
      <div className="scr-k">
        <span className="scr-label">{W.window}</span>
        <span className={`scr-hint scr-stat is-${status.tone}`} role="status" title={status.hint}>{status.short}</span>
        {note ? <span className="scr-hint scr-note">{note}</span> : null}
      </div>
      <span className="scr-acts">
        {status.state === 'closed' && !placing ? <RoomWindowTab className="scr-open scr-open--quiet" href={href} /> : null}
        <RoomWindowLink className="scr-open" href={href} {...linkProps}>{W.open}</RoomWindowLink>
      </span>
    </div>
  );
}
export const DISPLAY_PROFILES = [
  ['room', 'Room — projector'],
  ['tv', 'TV — large panel'],
  ['call', 'Call — screen share'],
  ['table', 'Table — laptop'],
];

export default function ScreensGroup({
  choice = 'classic',
  offerChoice = false,
  onChoose = () => {},
  presentHref = '',
  presentDetail = null,
  profile = 'room',
  onProfileChange = () => {},
}) {
  const two = choice === 'two';
  // Setup and the panel can both draw this group: one id each.
  const sizeId = useId();
  return (
    <div className="scr">
      {offerChoice ? <ScreenChoiceRow choice={choice} onChoose={onChoose} help="host-room-screen-chooser" /> : null}
      {offerChoice && two && presentHref ? <RoomWindowRow href={presentHref} detail={presentDetail} /> : null}
      <div className="scr-row">
        <div className="scr-k">
          <label className="scr-label" htmlFor={sizeId}>{W.size}</label>
          <span className="scr-hint">{W.sizeHint}</span>
        </div>
        <select id={sizeId} className="scr-select" value={profile} onChange={(e) => onProfileChange(e.target.value)}>
          {DISPLAY_PROFILES.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
