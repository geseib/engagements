import React, { useState } from 'react';
import Icon from './Icon';
/*
  ONE VOCABULARY FOR ONE CHECK. The staff score card and this banner now both
  render `tally` and `observed`, so the category words, the band words and the
  summary line live in utils/reviewMeasurement.js rather than twice.
*/
import {
  CATEGORIES, SET_SUBJECT, bandWord, capitalised, categoryRow, categoryWords,
  measuredTally, rowsOf, setTextClean, summaryLine, worstFirst,
} from '../utils/reviewMeasurement';
import './SetReviewBanner.css';

/**
 * A SET THAT NEEDS CHANGES — docs/design/tenancy-redesign/06-share-rejected.html.
 *
 * Not a screen: the editor's state when the submitted version is flagged, was
 * rejected by a person, or was taken down (the staff note leads, spec §10.2).
 * The rejection NAMES the questions and QUOTES the finding's sentence — "two
 * of thirty is a five-minute edit; 'your set was rejected' is an abandoned
 * feature" (RATIONALE §3). The sentence is model-written text about the
 * author's own content; it is rendered as text, never markup.
 *
 * TOKEN-ONLY AND THEME-AGNOSTIC, deliberately. This sits inside the set
 * editor, which is still part-paper on the monolith stylesheet; declaring
 * `data-theme="dark"` here would make a dusk island in a paper form — the
 * defect the player shell just had removed, mirrored. Every pairing is asserted
 * on both grounds in __tests__/srevPalette.test.js.
 */
const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');
const byQuestion = (findings) => {
  const map = new Map();
  for (const f of findings || []) {
    if (!f.questionId || f.questionId === '(set)') continue;
    if (!map.has(f.questionId)) map.set(f.questionId, []);
    map.get(f.questionId).push(f);
  }
  return [...map.entries()];
};
// Only a bare `q<digits>` id (e.g. "q014") gets the mockup's "Q14" short form.
// A real tenancy id like "c001#003" is returned verbatim — "Qc001#003" would
// be noise, not a label.
const label = (id) => (/^q0*\d+$/i.test(String(id)) ? `Q${String(id).replace(/^q0*/i, '')}` : String(id));

/**
 * WHAT THE CHECK MEASURED — the half `findings` has never carried.
 *
 * `findings` is what HELD the set. `tally` and `observed` are everything the
 * check saw, at every band, whether or not it intervened, so this block is the
 * answer to "how much of my set was looked at, and what did it nearly catch?"
 * — the question a status and a sentence cannot answer.
 *
 * Only a tally with the FULL scope marker is a measurement; a check made before
 * measuring existed has none, and an empty block in its place would read as
 * "measured, and nothing found" (`measuredTally`). So the block is absent for
 * such a version rather than blank.
 *
 * Each observation is named by the QUESTION LABEL, not its text. The score
 * card names them by text because staff cannot decrypt an organisation's rows
 * and read the public copy instead; the route feeding this banner has no
 * kms:Decrypt grant and does not need one — this banner lives in the set
 * editor, which is already holding the plaintext questions these ids name, and
 * "Edit Q14" is the control that takes the author to one.
 */
function Measured({ entry }) {
  const tally = measuredTally(entry.reviewTally);
  if (!tally) return null;
  const observed = rowsOf(entry.reviewObserved);
  // What held the set is named above, question by question, with its sentence.
  // Repeating it here would state one fact about one question twice in one
  // view; this list is what the check saw and LET THROUGH.
  const heldIds = new Set((entry.reviewFindings || []).map((f) => f.questionId));
  const letThrough = worstFirst(observed.filter((o) => o.intervened === false && !heldIds.has(o.questionId)));
  return (
    <>
      <h3 className="srev-h">What the check measured</h3>
      <p className="srev-summary" data-testid="srev-summary">
        {summaryLine(tally, entry.questionCount, setTextClean(tally, observed))}
      </p>
      <ul className="srev-cats">
        {CATEGORIES.map(([id, words]) => {
          const { worst, where } = categoryRow(id, tally, observed);
          return (
            <li key={id} className="srev-cat" data-testid="srev-cat">
              <span className="srev-cat-name">{capitalised(words)}</span>
              {worst
                ? <span className={`srev-band srev-band--${bandWord(worst)}`}>{bandWord(worst)}</span>
                : <span className="srev-none">none</span>}
              <span className="srev-cat-where">{where}</span>
            </li>
          );
        })}
      </ul>
      {letThrough.length > 0 && (
        <>
          <h3 className="srev-h">Seen and let through</h3>
          <ul className="srev-list" data-testid="srev-seen">
            {letThrough.map((o, i) => (
              <li key={`${o.questionId}-${i}`} className="srev-item">
                <div className="srev-item-head">
                  <strong>{o.questionId === SET_SUBJECT ? "The set's own text" : label(o.questionId)}</strong>
                  <span className="srev-none">{bandWord(o.band)} · {categoryWords(o.category)} · let through</span>
                </div>
                {o.explanation && <p className="srev-why">{o.explanation}</p>}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

export default function SetReviewBanner({ entry, scope = '', share, busy = false, onResubmit, onAppeal, onFocusQuestion }) {
  const [asking, setAsking] = useState(false);
  const [message, setMessage] = useState('');
  const review = entry && entry.review;
  const staffNote = share && share.note;
  /*
    THE SHARE STAMP DECIDES, NOT THE REVIEW ROW, while the library is serving it.

    Engage staff can re-run the content check on the version the public library
    already serves (the score card's "Run the check again"). That check writes
    its verdict onto the ORGANISATION's own REVIEW row — which `entry.review`
    is — and deliberately writes no share stamp, because nothing about the
    author's share changed: their set is still published, and the re-check
    publishes, unpublishes and takes down nothing.

    Read from `entry.review` alone this banner told them a person at Engage was
    looking at a version nobody had asked about, or that their set "was not
    published" while it was live, and offered Resubmit and "Ask for a human
    review" — an appeal that would knock their own live set out of its published
    state. So the stamp, which is the author's own share request and the one
    author-facing fact a re-check never moves, is what is believed here: while it
    still reads `published` this banner has nothing to say.

    Not `entry.published`, which is the PUBLISHED marker: that outlives a check
    the organisation itself submits for an already-published version, and THAT
    answer is theirs to read — their submission moves the stamp, so it arrives
    here. versionChip (utils/shareState.js) can use the marker because a chip
    only labels; this banner asks them to act.
  */
  if (share && share.status === 'published') return null;
  const waiting = review === 'escalated' || review === 'appealed';
  const flagged = review === 'flagged' || (share && share.status === 'flagged');
  if (!waiting && !flagged) return null;

  /*
    ── ENGAGE'S OWN SHARED SET SAYS NONE OF THIS ─────────────────────────────

    Every sentence below is about a SUBMISSION: a version an organisation sent
    to Engage, which was or was not published, leaving their own private copy
    untouched. A PLATFORM set is none of those things. It is served to every
    organisation already, it belongs to no organisation, and its check
    (check-question-set.js `checkPlatformSet`) publishes nothing, unpublishes
    nothing and moves no share stamp — so "this set was not published",
    "nothing was shared" and "your copy is still private to your organisation"
    would be three false statements in one paragraph, and Resubmit and the
    appeal two controls with nobody to press them and nothing to ask for.

    What is true of it is the measurement, which is the same measurement, and
    the fact that the library has gone on serving the set throughout. Where a
    worse-than-passed outcome is ANSWERED is the moderation queue
    (set-check-worker.js raises `PLATFORM#<setId>`); switching the set off is
    the console's own control and stays there.
  */
  const house = scope === 'platform';
  if (house) {
    return (
      <section className="srev" role="status">
        <div className="srev-lead">
          <Icon name={waiting ? 'UserCircle' : 'Warning'} weight="fill" size={18} color={waiting ? 'var(--primary)' : 'var(--srev-flag-ink)'} />
          <p>
            <strong>
              {waiting
                ? `The check sent version ${entry.version} of this Engage set to a person.`
                : `The check flagged version ${entry.version} of this Engage set.`}
            </strong>{' '}
            It is still being served to every organisation{entry.checkedAt ? `; checked on ${day(entry.checkedAt)}` : ''}.
            The moderation queue is where this is answered.
          </p>
        </div>
        <Measured entry={entry} />
      </section>
    );
  }

  if (waiting) {
    /*
      One line and no tint while there is nothing else to say — the shape this
      state has always had. A version that WAS measured has a block under that
      line, and a one-row flex box centred on its icon cannot hold one, so the
      modifier turns the row back into a column. Both are `.srev--waiting`, so
      the transparent ground is stated once.
    */
    const measured = Boolean(measuredTally(entry.reviewTally));
    return (
      <section className={`srev srev--waiting${measured ? ' srev--waiting-wide' : ''}`} role="status">
        <div className="srev-lead">
          <Icon name="UserCircle" weight="fill" size={18} color="var(--primary)" />
          <p>Waiting for a person at Engage to look at version {entry.version}. The outcome will show here.</p>
        </div>
        <Measured entry={entry} />
      </section>
    );
  }
  const questions = byQuestion(entry.reviewFindings);
  const setFindings = (entry.reviewFindings || []).filter((f) => f.questionId === '(set)');
  const total = Number(entry.questionCount) || 0;
  const passed = total ? total - questions.length : null;
  /*
    NOTHING TO COUNT IS NOT A COUNT OF NOTHING.

    Two refusals reach this branch carrying no findings at all. A TAKEDOWN
    stamps `flagged` (public-library-item.js) on a version whose own check
    PASSED — the library was serving it, so nothing had ever held it. A
    REVIEWER'S REFUSAL stamps the same (moderation-decide.js, the plain and
    the resumed reject alike), and a person's reason is a NOTE, not
    per-question findings.

    Counted from `reviewFindings` regardless, both read "0 of 30 questions
    were flagged" directly under the staff note that has just told the author
    their set was taken out of the public library — a number meaning the
    opposite of the sentence above it. And a finding against the set's own
    name or description carries the id '(set)', which byQuestion() drops, so a
    set held for its own text counted zero flagged questions while having
    everything to say.

    So the count speaks only when it has questions to count. Otherwise the
    check DATE takes its place — true of every version that was checked, and
    the one thing this sentence was carrying that a refusal without findings
    still has — and a version with no date says nothing there at all.
  */
  const flaggedLine = questions.length
    ? `${questions.length} of ${total || '—'} questions were flagged${entry.checkedAt ? ` on ${day(entry.checkedAt)}` : ''}.`
    : (entry.checkedAt ? `Checked on ${day(entry.checkedAt)}.` : '');
  // The same emptiness one line down: a heading over a list naming nothing,
  // and "the other 30 questions passed" with nothing for those thirty to be
  // other THAN. A refusal that named no question gets no section about named
  // questions — what it does get is the staff note, the measurement and the
  // way back, which are below and are all true of it.
  const named = questions.length + setFindings.length;
  return (
    <section className="srev" role="status">
      <div className="srev-lead">
        <Icon name="Warning" weight="fill" size={18} color="var(--srev-flag-ink)" />
        <p>
          {staffNote && <><strong>From Engage:</strong> {staffNote} </>}
          <strong>This set was not published.</strong>{' '}
          {flaggedLine && <>{flaggedLine}{' '}</>}
          Nothing was shared, and your copy is untouched — it is still private to your organisation and still usable in your own sessions.
        </p>
      </div>
      {named > 0 && (
        <>
        <h3 className="srev-h">What was flagged</h3>
        <ul className="srev-list">
          {questions.map(([id, findings]) => (
            <li key={id} className="srev-item">
              <div className="srev-item-head">
                <strong>{label(id)}</strong>
                {onFocusQuestion && (
                  <button type="button" className="srev-btn srev-btn--sm" onClick={() => onFocusQuestion(id)}>Edit {label(id)}</button>
                )}
              </div>
              {findings.map((f, i) => (
                <p key={i} className="srev-why">{f.explanation || `Flagged for ${String(f.category || '').toLowerCase()}.`}</p>
              ))}
            </li>
          ))}
          {setFindings.map((f, i) => (
            <li key={`set-${i}`} className="srev-item">
              <div className="srev-item-head"><strong>The set's own text</strong></div>
              <p className="srev-why">{f.explanation || `The set's name, description or category names were flagged for ${String(f.category || '').toLowerCase()}.`}</p>
            </li>
          ))}
          {passed !== null && passed >= 0 && (
            <li className="srev-item srev-item--ok">
              <Icon name="Check" weight="bold" size={14} color="currentColor" /> The other {passed} questions passed. They are unchanged and need no attention.
            </li>
          )}
        </ul>
        </>
      )}
      <Measured entry={entry} />
      <div className="srev-acts">
        {onResubmit && (
          <button type="button" className="srev-btn srev-btn--primary" disabled={busy} onClick={() => onResubmit(entry.version)}>Resubmit</button>
        )}
        {onAppeal && !asking && (
          <div className="srev-appeal">
            <p><strong>Think this is wrong?</strong> Ask a person to look at it. Automated review is deliberately cautious, and a set about safety is exactly the kind it gets wrong.</p>
            <button type="button" className="srev-btn" disabled={busy} onClick={() => setAsking(true)}>Ask for a human review</button>
          </div>
        )}
        {onAppeal && asking && (
          <div className="srev-appeal">
            <label htmlFor="srev-msg">Tell Engage why (optional)</label>
            <textarea id="srev-msg" className="srev-msg" maxLength={500} rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
            <div className="srev-acts">
              <button type="button" className="srev-btn" onClick={() => setAsking(false)}>Cancel</button>
              <button type="button" className="srev-btn srev-btn--primary" disabled={busy} onClick={() => onAppeal(entry.version, message.trim())}>Send</button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
