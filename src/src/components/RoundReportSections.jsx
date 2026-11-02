import React, { useEffect, useState } from 'react';
import Icon from './Icon';
import MarkdownRenderer from './MarkdownRenderer';
import { hasSummary } from '../config/sessionHistory';
import {
  anchorLabelFor, excerptOf, plainOf, SUMMARY_LABEL,
} from '../config/comments';
import { ballotOfRow, placeComments } from '../config/commentPlacement';

/**
 * ONE ROUND'S REPORT ON A PARTICIPANT'S PHONE, laid out for commenting —
 * docs/design/phone-comments (D1–D10), experience plan Phase 3b.
 *
 * The owner, 1 Nov 2026: *"it is not super apparent the comment buttons go
 * with AI read vs responses … are they commenting on all responses or each
 * separately. how do we know which response they are commenting on."*
 *
 * So the page is three sections with real headings, and every action sits
 * inside the thing it is about and names it:
 *
 *   1. Workie's read — the read folded to five lines, then "Comment on
 *      Workie's read", then its comments behind "Show N comments".
 *   2. The responses — one card per response: the author, "Response 2 · 6
 *      votes, the most" (the BALLOT number in words, D8), the text, then
 *      "Reply to this response", then that response's replies.
 *   3. Anything else about this round? — last, for what is about neither,
 *      with "Comment on the whole round". The host's "Said in the room" notes
 *      land here.
 *
 * No action is ever the bare word "Comment", and each one's accessible name
 * begins with its visible label (WCAG 2.5.3).
 *
 * A comment sits under the thing it is about by `placeComments`
 * (config/commentPlacement.js): a reply stored with a ballot number goes under
 * the response with that number; an older one is matched by its quote, or
 * goes under the whole round, quote and all.
 *
 * Only `FeedbackRoundPanel` draws this (RoundReport routes here when it is
 * given `onComment`). The host's past-round dialog keeps its own layout.
 */

/** The target key a comment, a card and the compose sheet share. */
export const rowKey = (i) => `row:${i}`;

const nameOf = (row) => {
  const n = row && (row.playerName || row.name);
  return typeof n === 'string' && n.trim() ? n.trim() : null;
};

/** How a thread toggle reads: "Show 2 replies (1 yours)" / "Hide 3 replies". */
function threadLabel(open, n, mine, noun) {
  const word = n === 1 ? noun : (noun === 'reply' ? 'replies' : `${noun}s`);
  const yours = mine === 0 ? '' : (n === 1 ? ' (yours)' : ` (${mine} yours)`);
  return `${open ? 'Hide' : 'Show'} ${n} ${word}${open ? '' : yours}`;
}

/** The sentence under an author's name: "Response 2 · 6 votes, the most". */
function responseMeta({ number, byQuestion, votes, showVotes, mostVotes, tiedAtMost }) {
  const head = `${byQuestion ? 'Question' : 'Response'} ${number}`;
  if (!showVotes || !Number.isFinite(votes)) return head;
  const count = votes === 0 ? 'no votes' : `${votes} ${votes === 1 ? 'vote' : 'votes'}`;
  if (votes > 0 && votes === mostVotes) {
    return `${head} · ${count}, ${tiedAtMost ? 'tied for the most' : 'the most'}`;
  }
  return `${head} · ${count}`;
}

/** One comment in a thread. */
function ThreadItem({ comment, mine, justNow, fallbackLabel }) {
  const who = mine ? (justNow ? 'You · just now' : 'You') : (comment.playerName || comment.name || fallbackLabel);
  return (
    <li className={`fbr-thread__item${mine ? ' is-mine' : ''}`}>
      <span className="fbr-thread__who">
        {who}
        {comment.featured === true && <span className="fbr-thread__featured">Shown to the room</span>}
      </span>
      <span className="fbr-thread__text">{comment.text}</span>
    </li>
  );
}

/** A section's comments, behind a toggle. */
function Thread({ id, list, open, onToggle, noun, playerName, sent }) {
  if (!list.length) return null;
  const isMine = (c) => Boolean(playerName) && (c.playerName === playerName || c.name === playerName);
  const mine = list.filter(isMine).length;
  return (
    <div className="fbr-thread">
      <button
        type="button"
        className="fbr-thread__toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={onToggle}
      >
        {threadLabel(open, list.length, mine, noun)}
        <Icon name={open ? 'CaretUp' : 'CaretDown'} size={14} />
      </button>
      <ol id={id} className="fbr-thread__list" hidden={!open}>
        {list.map((comment, i) => (
          <ThreadItem
            key={comment.commentId || i}
            comment={comment}
            mine={isMine(comment)}
            justNow={Boolean(sent && sent.commentId && sent.commentId === comment.commentId)}
            fallbackLabel="Name hidden"
          />
        ))}
      </ol>
    </div>
  );
}

/** The confirmation for the comment just posted, inside its own card. */
function SentLine({ sent, here }) {
  if (!sent || sent.key !== here) return null;
  return (
    <p className="fbr-sent" role="status" aria-live="polite">
      <Icon name="CheckCircle" size={18} />
      <span><b>{sent.lead}</b> {sent.rest}</span>
    </p>
  );
}

export default function RoundReportSections({
  round,
  comments = [],
  onComment,
  commentTarget = null,
  sent = null,
  playerName = '',
  answersEmptyText = 'Nobody responded to this round.',
  onRetryAnswers,
}) {
  const answers = Array.isArray(round.answers) ? round.answers : [];
  const byQuestion = round.kind === 'survey';
  const options = Array.isArray(round.options) ? round.options : [];
  const summary = round.aiSummary || {};
  const showSummary = hasSummary(round);
  const readText = summary.markdownResponse || summary.summaryText || '';
  const placed = placeComments(comments, answers);
  const base = `fbr-${round.number || round.ordinal || 'r'}`;
  const replyNoun = byQuestion ? 'comment' : 'reply';

  /* THREADS ARE COLLAPSED (fork 6), and a thread opens on its own once you
     post in it, so your words are on screen where you put them. */
  const [openThreads, setOpenThreads] = useState(() => new Set());
  const [readOpen, setReadOpen] = useState(false);
  const [openRows, setOpenRows] = useState(() => new Set());
  const toggle = (setter, key) => setter((cur) => {
    const next = new Set(cur);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const sentKey = sent && sent.key;
  useEffect(() => {
    if (!sentKey) return;
    setOpenThreads((cur) => (cur.has(sentKey) ? cur : new Set([...cur, sentKey])));
  }, [sentKey]);

  const rowKeysWithReplies = answers.map((_a, i) => rowKey(i)).filter((_k, i) => (placed.byRow.get(i) || []).length);
  const allOpen = rowKeysWithReplies.length > 0 && rowKeysWithReplies.every((k) => openThreads.has(k));
  const setAllReplies = () => setOpenThreads((cur) => {
    const next = new Set(cur);
    rowKeysWithReplies.forEach((k) => (allOpen ? next.delete(k) : next.add(k)));
    return next;
  });

  // "6 votes, the most" — only where the round collected votes at all.
  const votesOf = (row) => (Number.isFinite(Number(row && row.votes)) ? Number(row.votes) : NaN);
  const voteCounts = answers.map(votesOf).filter(Number.isFinite);
  const showVotes = !byQuestion && voteCounts.some((v) => v > 0);
  const mostVotes = voteCounts.length ? Math.max(...voteCounts) : 0;
  const tiedAtMost = voteCounts.filter((v) => v === mostVotes).length > 1;

  /* THE ANCHORS. Each carries what the compose sheet says about its target
     (heading, quote, the words for the move prompt and the confirmation), so
     nothing downstream re-derives which thing was tapped. */
  const summaryAnchor = () => ({
    anchorKind: 'summary',
    anchorRef: '',
    anchorLabel: SUMMARY_LABEL,
    anchorExcerpt: excerptOf(readText),
    targetKey: 'summary',
    noun: 'comment',
    heading: `Comment on ${SUMMARY_LABEL}`,
    quoteHead: SUMMARY_LABEL,
    targetName: SUMMARY_LABEL,
    isWorkie: true,
    sentLead: 'Comment posted',
    sentRest: `under ${SUMMARY_LABEL}.`,
  });
  const roundAnchor = () => ({
    anchorKind: 'results',
    anchorRef: '',
    anchorLabel: anchorLabelFor({ anchorKind: 'results' }),
    anchorExcerpt: excerptOf(round.title || ''),
    targetKey: 'round',
    noun: 'comment',
    heading: 'Comment on the whole round',
    quoteHead: 'The whole round',
    targetName: 'the whole round',
    sentLead: 'Comment posted',
    sentRest: 'on the whole round.',
  });
  const rowAnchor = (answer, i) => {
    const ballot = ballotOfRow(answer);
    const number = ballot || i + 1;
    const who = byQuestion ? null : nameOf(answer);
    // A row with a ballot number is anchored by it (B1); a row without one
    // (a survey's question, a payload from before 3c) keeps its position.
    const ref = ballot
      ? { anchorKind: 'response', anchorRef: String(ballot), anchorBasis: 'ballot' }
      : { anchorKind: 'response', anchorRef: String(i) };
    const targetName = byQuestion
      ? `question ${number}`
      : (who ? `${who}’s response` : `response ${number}`);
    return {
      ...ref,
      anchorLabel: anchorLabelFor(ref, { answers }),
      anchorExcerpt: excerptOf(answer.answer),
      targetKey: rowKey(i),
      noun: replyNoun,
      heading: byQuestion ? `Comment on question ${number}` : `Reply to ${targetName}`,
      quoteHead: byQuestion ? `Question ${number}` : `Response ${number}${who ? ` · ${who}` : ''}`,
      targetName,
      sentLead: byQuestion ? 'Comment posted' : 'Reply posted',
      sentRest: byQuestion || !who
        ? `under ${targetName}.`
        : `under ${targetName} (response ${number}).`,
    };
  };

  const jump = (id) => {
    const el = typeof document !== 'undefined' ? document.getElementById(id) : null;
    if (el && typeof el.scrollIntoView === 'function') {
      const still = typeof window !== 'undefined' && window.matchMedia
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ block: 'start', behavior: still ? 'auto' : 'smooth' });
    }
  };

  const readLong = plainOf(readText).length > 320;
  const responsesHeading = byQuestion ? 'Results by question' : 'The responses';

  return (
    <div className="fbr-report">
      <nav className="fbr-jump" aria-label="Sections of this page">
        <button type="button" className="fbr-jump__link" onClick={() => jump(`${base}-read`)}>{SUMMARY_LABEL}</button>
        <button type="button" className="fbr-jump__link" onClick={() => jump(`${base}-responses`)}>
          {`${responsesHeading} · ${answers.length}`}
        </button>
        <button type="button" className="fbr-jump__link" onClick={() => jump(`${base}-else`)}>Anything else</button>
      </nav>

      {/* THE QUESTION. Not a card and not commentable (config/comments.js):
          a plain label and a rule, so it never reads as a fourth target. */}
      <section className="fbr-q" aria-label="The question">
        <p className="fbr-q__label">The question</p>
        <p className="fbr-q__title">{round.title}</p>
        {round.detail && <p className="fbr-q__detail">{round.detail}</p>}
        {round.image && (
          <img
            src={round.image}
            alt={round.title}
            className="fbr-q__image"
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
        )}
        {round.school && <p className="fbr-q__detail">{round.school}</p>}
        {round.task && (
          <p className="fbr-q__task"><span className="fbr-q__task-label">Your turn</span>{round.task}</p>
        )}
        {options.length > 0 && (
          <ul className="fbr-q__options">
            {options.map((option, i) => <li key={i}>{option}</li>)}
          </ul>
        )}
        {round.answerDetails && <p className="fbr-q__detail">{round.answerDetails}</p>}
      </section>

      {/* 1. WORKIE'S READ — first (fork 1), one card with the periwinkle edge. */}
      <section
        id={`${base}-read`}
        className={`fbr-sec fbr-card fbr-card--workie${commentTarget === 'summary' ? ' is-target' : ''}`}
        aria-labelledby={`${base}-read-h`}
      >
        <SentLine sent={sent} here="summary" />
        <div className="fbr-sec__head">
          <Icon name="Sparkle" size={18} />
          <h2 id={`${base}-read-h`} className="fbr-sec__title">{SUMMARY_LABEL}</h2>
        </div>
        {showSummary ? (
          <>
            {/* Cut to five lines VISUALLY; the whole read stays in the DOM. */}
            <div className={`fbr-read__body${readLong && !readOpen ? ' is-folded' : ''}`}>
              {summary.markdownResponse ? (
                <MarkdownRenderer content={summary.markdownResponse} className="past-round__md" />
              ) : (
                <>
                  {summary.summaryText && <MarkdownRenderer content={summary.summaryText} className="past-round__md" />}
                  {Array.isArray(summary.discussionQuestions) && summary.discussionQuestions.length > 0 && (
                    <>
                      <p className="fbr-read__sub">Discussion</p>
                      <ul>
                        {summary.discussionQuestions.map((q, i) => (
                          <li key={i}><MarkdownRenderer content={q} className="past-round__md" /></li>
                        ))}
                      </ul>
                    </>
                  )}
                  {Array.isArray(summary.nextSteps) && summary.nextSteps.length > 0 && (
                    <>
                      <p className="fbr-read__sub">Next steps</p>
                      <ul>
                        {summary.nextSteps.map((st, i) => (
                          <li key={i}><MarkdownRenderer content={st} className="past-round__md" /></li>
                        ))}
                      </ul>
                    </>
                  )}
                </>
              )}
            </div>
            {readLong && (
              <button
                type="button"
                className="fbr-more"
                aria-expanded={readOpen}
                onClick={() => setReadOpen((v) => !v)}
              >
                {readOpen ? 'Show less of Workie’s read' : 'Read all of Workie’s read'}
              </button>
            )}
            {summary.personaName && <p className="fbr-quiet">{`In ${summary.personaName}'s voice`}</p>}
            <div className="fbr-card__foot">
              <button
                type="button"
                className="fbr-act"
                onClick={(e) => onComment(summaryAnchor(), e.currentTarget)}
              >
                <Icon name="ChatCircleText" size={18} />
                <span>{`Comment on ${SUMMARY_LABEL}`}</span>
              </button>
            </div>
          </>
        ) : (
          <p className="fbr-quiet">No summary was generated for this round.</p>
        )}
        <Thread
          id={`${base}-read-thread`}
          list={placed.summary}
          open={openThreads.has('summary')}
          onToggle={() => toggle(setOpenThreads, 'summary')}
          noun="comment"
          playerName={playerName}
          sent={sent}
        />
      </section>

      {/* 2. THE RESPONSES — one card each; you reply on the card you mean. */}
      <section id={`${base}-responses`} className="fbr-sec" aria-labelledby={`${base}-responses-h`}>
        <div className="fbr-sec__head">
          <Icon name="UsersThree" size={18} />
          <h2 id={`${base}-responses-h`} className="fbr-sec__title">
            {responsesHeading}
            <span className="fbr-sec__count">{` · ${answers.length}`}</span>
          </h2>
          {rowKeysWithReplies.length > 0 && (
            <button type="button" className="fbr-more fbr-sec__all" aria-pressed={allOpen} onClick={setAllReplies}>
              {allOpen ? 'Close all replies' : 'Open all replies'}
            </button>
          )}
        </div>
        {answers.length > 0 && !byQuestion && (
          <p className="fbr-sec__hint">
            {showVotes ? 'Most votes first. ' : ''}To reply to one, use the button on its card.
          </p>
        )}
        {answers.length === 0 ? (
          <>
            <p className="fbr-quiet">{answersEmptyText}</p>
            {onRetryAnswers && (
              <button type="button" className="fbr-act" onClick={onRetryAnswers}>Try again</button>
            )}
          </>
        ) : (
          <ol className="fbr-cards">
            {answers.map((answer, i) => {
              const key = rowKey(i);
              const who = byQuestion ? null : nameOf(answer);
              const ballot = ballotOfRow(answer);
              const number = ballot || i + 1;
              const mine = Boolean(playerName) && who === playerName;
              const text = String(answer.answer ?? '');
              const long = text.length > 220;
              const rowOpen = openRows.has(key);
              const anchor = rowAnchor(answer, i);
              const start = excerptOf(text, 60);
              const actionLabel = byQuestion ? 'Comment on this question' : 'Reply to this response';
              const aria = byQuestion
                ? `${actionLabel}: ${start} (question ${number})`
                : `${actionLabel}: ${start} (${who ? `${who}, ` : ''}response ${number})`;
              return (
                <li
                  key={i}
                  id={`${base}-${key.replace(':', '-')}`}
                  className={`fbr-card fbr-card--response${commentTarget === key ? ' is-target' : ''}`}
                >
                  <SentLine sent={sent} here={key} />
                  {who && (
                    <p className="fbr-card__who">
                      {who}
                      {mine && <span className="fbr-chip">Yours</span>}
                    </p>
                  )}
                  <p className="fbr-card__meta">
                    {responseMeta({
                      number, byQuestion, votes: votesOf(answer), showVotes, mostVotes, tiedAtMost,
                    })}
                  </p>
                  <p className={`fbr-card__text${long && !rowOpen ? ' is-folded' : ''}`}>{text}</p>
                  {long && (
                    <button
                      type="button"
                      className="fbr-more"
                      aria-expanded={rowOpen}
                      onClick={() => toggle(setOpenRows, key)}
                    >
                      {rowOpen ? 'Show less' : 'Read all'}
                    </button>
                  )}
                  <div className="fbr-card__foot">
                    <button
                      type="button"
                      className="fbr-act"
                      aria-label={aria}
                      onClick={(e) => onComment(anchor, e.currentTarget)}
                    >
                      <Icon name="ChatCircleText" size={18} />
                      <span>{actionLabel}</span>
                    </button>
                  </div>
                  <Thread
                    id={`${base}-${key.replace(':', '-')}-thread`}
                    list={placed.byRow.get(i) || []}
                    open={openThreads.has(key)}
                    onToggle={() => toggle(setOpenThreads, key)}
                    noun={replyNoun}
                    playerName={playerName}
                    sent={sent}
                  />
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {/* 3. ANYTHING ELSE — last, worded as "something else" (D3). */}
      <section
        id={`${base}-else`}
        className={`fbr-sec fbr-card fbr-card--else${commentTarget === 'round' ? ' is-target' : ''}`}
        aria-labelledby={`${base}-else-h`}
      >
        <SentLine sent={sent} here="round" />
        <div className="fbr-sec__head">
          <Icon name="DotsThree" size={18} />
          <h2 id={`${base}-else-h`} className="fbr-sec__title">Anything else about this round?</h2>
        </div>
        <p className="fbr-sec__hint">
          For a comment that is not about Workie’s read or any one response, for example something nobody said.
        </p>
        {placed.round.length > 0 && (
          <ol className="fbr-thread__list fbr-else__list">
            {placed.round.map((comment, i) => (
              <li key={comment.commentId || i} className={`fbr-thread__item${playerName && (comment.playerName === playerName) ? ' is-mine' : ''}`}>
                <span className="fbr-thread__who">
                  {playerName && comment.playerName === playerName
                    ? (sent && sent.commentId === comment.commentId ? 'You · just now' : 'You')
                    : (comment.playerName || comment.name || 'Name hidden')}
                </span>
                {/* An older reply whose response could not be found keeps its
                    quote here, so it still says what it was about. */}
                {comment.anchorKind === 'response' && comment.anchorExcerpt && (
                  <span className="fbr-thread__quote">{plainOf(comment.anchorExcerpt)}</span>
                )}
                <span className="fbr-thread__text">{comment.text}</span>
              </li>
            ))}
          </ol>
        )}
        <div className="fbr-card__foot">
          <button
            type="button"
            className="fbr-act fbr-act--wide"
            onClick={(e) => onComment(roundAnchor(), e.currentTarget)}
          >
            <Icon name="ChatCircleText" size={18} />
            <span>Comment on the whole round</span>
          </button>
        </div>
      </section>
    </div>
  );
}
