import React from 'react';
import { wallCreditFor } from '../../config/comments';

/**
 * THE FEEDBACK WALL — what the room reads while it comments on a round.
 *
 * The owner, 2026-09-24, on the shipped wall: "the small type is not needed
 * and it doesnt seem like a designer put this part together." It had a kicker
 * repeating the headline, two lines on a class (`.lede`) no stylesheet
 * defined — so they fell to the page's ~13px UI size on a projector — a
 * "7 comments so far" line stating the meter's number twice in one viewport,
 * and the featured quote's author and anchor in label-size uppercase.
 *
 * Now every word is at a tier the room can read. While comments arrive: the
 * question, and one instruction line at body size. Once the host features
 * one: the comment as a pull quote at the primary tier, credited in sentence
 * case at body size, and the question steps down a tier so the quote leads.
 * The count lives in the meter; the comments themselves in the meter's list,
 * which leaves the featured one out (RoomMeter.jsx).
 *
 * The featured comment carries its author: the phone told the writer "your
 * name will be shown with this comment". Pressing the quote takes it down —
 * `onTakeDown(commentId)` is the same toggle the meter's cards call.
 */
export default function FeedbackWall({ featured = null, onTakeDown }) {
  const credit = featured ? wallCreditFor(featured) : '';
  const who = featured && String(featured.playerName || '').trim();

  return (
    <>
      <h1 className={`hero${featured ? ' fb-question' : ''}`}>What do you make of it?</h1>
      {!featured && (
        <p className="fb-ask">Tap any part of the round on your phone and say what you think.</p>
      )}
      {featured && (
        <button
          type="button"
          className="fb-quote"
          data-drop="4"
          data-drop-note="The featured comment"
          title="Press to take it down"
          onClick={() => onTakeDown?.(featured.commentId)}
        >
          <span className="mark" aria-hidden="true">“</span>
          <p className="say">{featured.text}</p>
          {(who || credit) && (
            <p className="by">
              {who ? <><b>{who}</b>{credit ? ` ${credit}` : ''}</> : `${credit.charAt(0).toUpperCase()}${credit.slice(1)}`}
            </p>
          )}
        </button>
      )}
    </>
  );
}
