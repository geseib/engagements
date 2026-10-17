import React, { useId } from 'react';
import { SCREEN_WORDS as W } from '../../config/roomScreen';
import { presentStatusFrom } from '../../config/presentStatus';
import RoomWindowLink from './RoomWindowLink';
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
 */
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
  const status = presentStatusFrom(presentDetail);
  return (
    <div className="scr">
      {offerChoice ? (
        <div className="scr-row">
          <div className="scr-k">
            <span className="scr-label">{W.where}</span>
            <span className="scr-hint">{two ? W.whereHintTwo : W.whereHintOne}</span>
          </div>
          <div className="scr-seg" role="group" aria-label={W.where}>
            <button type="button" className="scr-seg-btn" aria-pressed={!two} onClick={() => { if (two) onChoose('classic'); }}>{W.one}</button>
            <button type="button" className="scr-seg-btn" aria-pressed={two} onClick={() => { if (!two) onChoose('two'); }}>{W.two}</button>
          </div>
        </div>
      ) : null}
      {offerChoice && two && presentHref ? (
        <div className="scr-row">
          <div className="scr-k">
            <span className="scr-label">{W.window}</span>
            <span className={`scr-hint scr-stat is-${status.tone}`} role="status" title={status.hint}>{status.label}</span>
          </div>
          <RoomWindowLink className="scr-open" href={presentHref}>{W.open}</RoomWindowLink>
        </div>
      ) : null}
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
