import React from 'react';

/**
 * THE BUILD ROOM'S FOUR SETUP FIELDS, IN NEW ENGAGEMENT'S OPTIONAL SECTION
 * (experience plan 4c; audit E N2: "Its four fields — goal, who decides,
 * visibility, review — would fit the dialog's Optional section").
 *
 * Choosing Build Room used to hand the title to a second form on its own page
 * (BuildCreate, with a full page load and its own card, X and buttons). Now
 * the four fields sit here, in one quiet fold whose summary names the defaults
 * in force, like Advanced does for a session. Every one has a safe default,
 * so a host who opens nothing gets the room deciding, anyone with the code,
 * and Claude's questions reviewed first. Create makes the room and lands on
 * its own page's setup (connect Claude Code, the room joins).
 *
 * The words are BuildCreate's, kept so the two forms read alike; the checks
 * are buildSetupProblem's (buildroom/buildHostApi.js), shared by both.
 * Controlled: `value` is { goal, decides, visibility, accessCode, review }.
 */
export function buildSummary(value) {
  const v = value || {};
  const changed = [];
  if (v.decides === 'host') changed.push('you set the goal');
  else if (String(v.goal || '').trim()) changed.push('a starting idea');
  if (v.visibility === 'private') changed.push('private, with an access code');
  if (v.review === false) changed.push('Claude’s questions go straight to the room');
  return changed.length
    ? { changed: true, text: `Changed: ${changed.join(', ')}.` }
    : { changed: false, text: 'Defaults: the room decides what to build, anyone with the code joins, you review Claude’s questions first.' };
}

export default function BuildRoomFields({ value, onChange, open = false, onToggle }) {
  const v = value || {};
  const set = (patch) => onChange && onChange(patch);
  const summary = buildSummary(v);
  return (
    <details className="gsd-adv gsd-xfold" data-testid="gsd-build-fields" open={open || undefined} onToggle={onToggle}>
      <summary>
        <span className="gsd-adv-k"><i className="gsd-chev" aria-hidden="true" />Build Room setup</span>
        <span className="gsd-adv-s">
          {summary.changed ? <b>{summary.text}</b> : <>Optional · {summary.text}</>}
        </span>
      </summary>
      <div className="gsd-adv-body gsd-xfields">
        <fieldset className="gsd-xfield">
          <legend>What to build</legend>
          <label className="gsd-xcheck">
            <input type="radio" name="gsd-build-decides" checked={v.decides !== 'host'} onChange={() => set({ decides: 'room' })} />
            The room decides
          </label>
          <label className="gsd-xcheck">
            <input type="radio" name="gsd-build-decides" checked={v.decides === 'host'} onChange={() => set({ decides: 'host' })} />
            I&apos;ve set the goal
          </label>
          <small className="dialog-help-text">
            {v.decides === 'host'
              ? 'Claude builds toward your goal. The opening starts from who it is for.'
              : 'The title is only the session’s name. The room picks what to make in the opening, and Claude waits for it.'}
          </small>
        </fieldset>
        <label className="gsd-xfield" htmlFor="gsd-build-goal">
          <span className="gsd-xlabel">
            {v.decides === 'host' ? 'Goal: what should exist when we’re done?' : 'Goal (optional): a starting idea for the room'}
          </span>
          <textarea
            id="gsd-build-goal"
            className="dialog-textarea"
            rows={3}
            maxLength={2000}
            value={v.goal || ''}
            onChange={(e) => set({ goal: e.target.value })}
            placeholder="e.g. A one-page site where a volunteer can pick a shift in under a minute, on a phone."
          />
          <small className="dialog-help-text">It shows on the room’s screen and at the top of the report.</small>
        </label>
        <fieldset className="gsd-xfield">
          <legend>Who can join</legend>
          <label className="gsd-xcheck">
            <input type="radio" name="gsd-build-vis" checked={v.visibility !== 'private'} onChange={() => set({ visibility: 'public' })} />
            Anyone with the code
          </label>
          <label className="gsd-xcheck">
            <input type="radio" name="gsd-build-vis" checked={v.visibility === 'private'} onChange={() => set({ visibility: 'private' })} />
            Private: an access code as well
          </label>
          {v.visibility === 'private' && (
            <input
              id="gsd-build-code"
              className="dialog-input"
              aria-label="Access code"
              maxLength={40}
              value={v.accessCode || ''}
              onChange={(e) => set({ accessCode: e.target.value })}
              placeholder="Access code"
            />
          )}
        </fieldset>
        <label className="gsd-xcheck">
          <input type="checkbox" checked={v.review !== false} onChange={(e) => set({ review: e.target.checked })} />
          <span>
            Review Claude&apos;s questions before the room sees them
            <small className="dialog-help-text">Recommended. You can switch this off in the room.</small>
          </span>
        </label>
      </div>
    </details>
  );
}
