import React from 'react';
import Icon from './Icon';
import { BUILD_KIND, EVENT_KIND } from '../config/engagementKinds';
import pricing from '../../../lambda-functions/game/pricing';

/**
 * BUILD ROOM AND EVENT LAND ON THEIR OWN PAGE (docs/design/new-engagement
 * frames 7 and 8; experience plan 4c). Their setup fields are in this dialog
 * now (BuildRoomFields, EventFields), so Create makes the thing here and lands
 * on its own page: a Build Room on its room page's setup, an event on its
 * agenda. Step 3 is "Next: …": what this dialog makes (the title, ticked) and
 * what the next page is for (arrows, never numbers: the visual review read
 * numbered tiles as steps done here).
 *
 * On the Free plan the price line is REPLACED by which plan brings events,
 * and the dialog's Continue is disabled (GameSetupDialog's eventBlocked).
 */
export const OTHER_BLURBS = Object.freeze({
  [BUILD_KIND]: 'Build something with your Claude Code while the room suggests and votes. You decide. The goal and who can join are below, each with a default.',
  [EVENT_KIND]: 'A whole agenda behind one code: quizzes, polls, talks and breaks, in the order you run them. Say the day below, then build the agenda.',
});
/* The price, its own line so the Free plan can REPLACE it (frame 8). */
const EVENT_PRICE = `${pricing.formatCents(pricing.PER_EVENT_CENTS)} an event, counted when it first goes live.`;

const STEPS = {
  [BUILD_KIND]: [
    ['Connect Claude Code', 'Copy one command into Claude Code on this computer'],
    ['The room joins', 'People join with a code; Claude asks them through you'],
  ],
  [EVENT_KIND]: [
    ['Agenda', 'Quizzes, polls, talks and breaks, in your order'],
    ['Go live', 'One join code for the whole day'],
  ],
};

export default function OtherFormatHandoff({ kind, title = '', blocked = false, planName = '', billingHref = '' }) {
  const isBuild = kind === BUILD_KIND;
  const name = isBuild ? 'Build Room' : 'The event';
  return (
    <div className="gsd-handoff" data-testid="gsd-handoff">
      <p className="gsd-handoff-t">
        <Icon name={isBuild ? 'Wrench' : 'CalendarBlank'} size={18} />
        <b>{name} opens on its own page</b>
      </p>
      {/* The sentence the old dialog showed under the pills, kept word for word. */}
      <p className="gsd-handoff-d">{OTHER_BLURBS[kind]}</p>
      <ul className="gsd-handoff-tiles">
        <li className={title.trim() ? 'is-done' : undefined}>
          <Icon name={title.trim() ? 'Check' : 'CaretRight'} size={14} weight="bold" />
          <b>Title</b>
          <span>{title.trim() ? `“${title.trim()}”` : 'Type it above'}</span>
        </li>
        {(STEPS[kind] || []).map(([head, line]) => (
          <li key={head}>
            <Icon name="CaretRight" size={14} />
            <b>{head}</b>
            <span>{line}</span>
          </li>
        ))}
      </ul>
      {isBuild ? (
        <p className="gsd-handoff-note">
          <Icon name="Info" size={14} />
          <span>You need <b>Claude Code</b> on the computer you build on. No question set: Claude writes the questions as it goes.</span>
        </p>
      ) : blocked ? (
        <p className="gsd-handoff-note" data-testid="gsd-event-plan">
          <Icon name="Lock" size={14} />
          <span>
            {`Events come with the ${planName || 'paid plan'}. `}
            <a href={billingHref}>See plans</a>
          </span>
        </p>
      ) : (
        <p className="gsd-handoff-note" data-testid="gsd-event-price">
          <Icon name="CreditCard" size={14} />
          <span>{EVENT_PRICE}</span>
        </p>
      )}
    </div>
  );
}
