import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { surveyWallSubtitle } from '../../hooks/useSurveyProgress';

/**
 * THE WALL WHILE A SURVEY COLLECTS — docs/design/survey-redesign/
 * s-01-collecting.html, and the content half of s-07-whos-left.html.
 *
 * Self-paced: nobody in the room is looking up, so the wall's job is the way
 * IN and nothing else. The join block and its QR stay up the whole time — the
 * lobby's own `.joinblock` / `.qr` / `.joininfo` classes, so it is the same
 * object a room has already learned to scan, with s-01's two labels ("Scan,
 * or go to" / "and enter"). The progress is the meter's (RoomMeter's rows),
 * not this column's.
 *
 * WHAT IS NOT HERE, ON PURPOSE:
 *   - no names, ever. This component is not handed the roster at all; the one
 *     place a name may appear on the wall is the meter's "Still going" list,
 *     on request, in the two Names values that record any.
 *   - no arrivals. A survey's words wait for the close (20-wall's note:
 *     "Collecting is not ASK").
 *   - no `.bar2` under anything — see RoomMeter.jsx.
 *
 * `title` defaults to s-01's own line. It is an invitation, not data: the rail
 * already carries the session's title, and repeating it 2 inches below would
 * be the same fact twice in one viewport.
 */
export default function SurveyCollecting({
  questionCount = 0,
  names,
  playUrl,
  joinUrl,
  code,
  title = 'Tell us how today went',
}) {
  return (
    <>
      <p className="stitle">{title}</p>
      <p className="ssub">{surveyWallSubtitle({ questionCount, names })}</p>
      {code && (
        <div className="joinblock">
          <div className="qr">
            <QRCodeSVG value={playUrl} size={512} level="M" includeMargin={false} />
          </div>
          <div className="joininfo">
            <div className="lbl">Scan, or go to</div>
            <div className="url">{joinUrl}</div>
            <div className="lbl">and enter</div>
            <div className="code">{code}</div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * THE WALL ONCE IT IS CLOSED (and, with `ended`, once the session is over).
 *
 * Phase 2 freezes the counts; it does not draw results — that is phase 3's
 * walk-through, inside this same SURVEY#CLOSED state. So this says what is
 * true now: it is closed, and how many answered. Counts only, the same numbers
 * the close response and the `surveyClosed` frame carry; never a name, never
 * an answer. No join block: nobody can answer a closed survey, and a QR on the
 * wall would invite the room to try.
 */
export function SurveyClosed({ n = null, finished = null, ended = false }) {
  const known = n != null && finished != null;
  return (
    <>
      <div className="kicker">{ended ? 'Session complete' : 'Survey closed'}</div>
      <p className="stitle">Thank you for your answers</p>
      {known && (
        <p className="ssub">
          {`${n} ${Number(n) === 1 ? 'person' : 'people'} answered · ${finished} finished.`}
        </p>
      )}
    </>
  );
}
