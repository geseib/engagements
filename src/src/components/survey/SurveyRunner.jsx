import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { PlayerShell } from '../PlayerShell';
import Icon from '../Icon';
import { namesMode } from '../../config/surveyNames';
import { getClientId } from '../joinResult';
import { getRespondentId } from './respondent';
import { stateRank, SURVEY_OPEN, SURVEY_CLOSED } from '../../utils/playerPhase';
import {
  identityFor, fetchSurvey, fetchMine, saveAnswer, submitSurvey,
} from '../../utils/surveyClient';
import useSurveyAutosave, { RETRY_MS } from './useSurveyAutosave';
import { isAnswered, summaryFor, seededOrder, countWord } from './surveyAnswers';
import RatingInput from './RatingInput';
import ChoiceInput from './ChoiceInput';
import YesNoInput from './YesNoInput';
import RankInput from './RankInput';
import TextInput from './TextInput';

/**
 * A SURVEY, ON THE PHONE OF SOMEBODY WHO HAS JOINED ONE.
 *
 * The phone half of docs/design/survey-redesign/IMPLEMENTATION-phase-2.md
 * (Track C), drawn from the mockups p-01 … p-12 in that directory, which are
 * the design. One component, five screens, in this order:
 *
 *   loading → answering(i) → review → sent          and, whenever the host says,
 *                                                     closed · ended
 *
 * A survey is paced by the PERSON, not the room: there are no rounds, and the
 * only thing the room decides is when it closes. So every answer is saved the
 * moment it is given (useSurveyAutosave), the person moves with Back / Next,
 * and "Send" only marks the row complete — partial answers count, and answers
 * stay editable until the host closes the survey.
 *
 * WHERE THE STATE COMES FROM. `state` is PlayerPage's phase (driven by `/state`
 * and the `surveyClosed` / `gameEnded` frames); `GET /survey` reports one too,
 * and a save or Send refused `SURVEY_CLOSED` means the survey closed under the
 * person — that code, and no other refusal (utils/surveyClient.js). The screen
 * follows the highest-ranked of the three (utils/playerPhase.js), so no stale
 * source can reopen a closed survey.
 *
 * THE NAMES PROMISE (config/surveyNames.js, `phoneLead` + `phoneLine`) is shown
 * above question 1 and nowhere else (p-01, p-11, p-12): it is said once, at
 * the moment the person decides whether to answer, in the player's existing
 * anonymity style (`.plr-anon`).
 */

const TWO_MINUTES = 2;

/** Send is tried this many more times, on the autosave's own back-off, before it says it did not go. */
const SEND_RETRY_MS = RETRY_MS.slice(0, 3);

const NOTHING_YET = 'Answer at least one question to send.';

const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

function capitalised(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** The rank-highest of the phases this component has heard. */
function effectiveState(...states) {
  return states.filter(Boolean).reduce((best, s) => (stateRank(s) > stateRank(best) ? s : best), null);
}

/** The status line above the dock's buttons. */
function SavedLine({ status, error, idleText = 'Answers save as you go' }) {
  let text;
  let tone = '';
  switch (status) {
    case 'saving': text = 'Saving…'; break;
    case 'saved': text = 'Saved'; break;
    case 'error': text = 'Not saved – retrying'; tone = ' plr-saved--bad'; break;
    case 'rejected': text = error ? `Not saved — ${error}` : 'Not saved'; tone = ' plr-saved--bad'; break;
    default: text = idleText; tone = ' plr-saved--idle';
  }
  return (
    <p className={`plr-saved${tone}`} aria-live="polite">
      <i aria-hidden="true" />
      {text}
    </p>
  );
}

const LookUpCue = ({ children }) => (
  <div className="plr-lookup">
    <svg
      width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
    >
      <path d="M12 20V5" /><path d="M6 11l6-6 6 6" /><path d="M4 3h16" />
    </svg>
    <div>{children}</div>
  </div>
);

export default function SurveyRunner({
  gameId,
  playerName,
  apiBase = window.API_BASE,
  fetchFn,
  state,
  warning = null,
  online = true,
  banner = null,
  storage,
}) {
  const doFetch = fetchFn || ((...args) => fetch(...args));
  const [load, setLoad] = useState({ status: 'loading', error: null });
  const [attempt, setAttempt] = useState(0);
  const [survey, setSurvey] = useState(null);
  const [answers, setAnswers] = useState({});
  const [view, setView] = useState({ screen: 'answering', index: 0, fromReview: false });
  const [closedHere, setClosedHere] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState(null);
  const reasonId = useId();
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const names = survey ? namesMode(survey.names).id : null;
  const identity = useMemo(() => {
    if (!names) return null;
    return identityFor(names, {
      respondentId: names === 'named' ? null : getRespondentId(gameId, storage),
      playerName,
      clientId: getClientId(gameId, storage),
    });
  }, [names, gameId, playerName, storage]);
  const identityRef = useRef(identity);
  identityRef.current = identity;

  const save = useCallback(
    (qid, value) => saveAnswer({
      fetchFn: doFetch, apiBase, gameId, qid, value, identity: identityRef.current,
    }),
    // doFetch is rebuilt each render only when no fetchFn is given; the global never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fetchFn, apiBase, gameId],
  );
  const autosave = useSurveyAutosave({ save, onClosed: () => setClosedHere(true) });

  /* ---- load: the survey, then this phone's own row ------------------------ */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const got = await fetchSurvey({ fetchFn: doFetch, apiBase, gameId });
      if (cancelled) return;
      if (!got.ok) {
        if (got.closed) {
          setClosedHere(true);
          setLoad({ status: 'closed', error: null });
        } else if (got.notStarted) setLoad({ status: 'not-started', error: null });
        else setLoad({ status: 'error', error: got.error });
        return;
      }
      const s = got.survey;
      const mode = namesMode(s.names).id;
      const who = identityFor(mode, {
        respondentId: mode === 'named' ? null : getRespondentId(gameId, storage),
        playerName,
        clientId: getClientId(gameId, storage),
      });
      const mine = await fetchMine({ fetchFn: doFetch, apiBase, gameId, identity: who });
      if (cancelled) return;
      if (mine.closed) setClosedHere(true);
      const had = mine.ok ? mine.answers : {};
      const questions = s.questions || [];
      const firstOpen = questions.findIndex((q) => !isAnswered(q, had[q.qid]));
      let next;
      if (mine.complete) next = { screen: 'sent', index: 0, fromReview: false };
      else if (firstOpen === -1 && questions.length) next = { screen: 'review', index: 0, fromReview: false };
      else next = { screen: 'answering', index: Math.max(0, firstOpen), fromReview: false };
      setSurvey(s);
      setAnswers(had);
      setView(next);
      setLoad({ status: 'ready', error: null });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, attempt]);

  /* A survey that had not opened when this phone arrived loads when it does. */
  useEffect(() => {
    if (load.status === 'not-started' && stateRank(state) >= stateRank(SURVEY_OPEN)) {
      setAttempt((a) => a + 1);
    }
  }, [state, load.status]);

  const questions = survey ? survey.questions || [] : [];
  const total = questions.length;
  const current = effectiveState(state, survey && survey.state, closedHere ? SURVEY_CLOSED : null);
  const isOpen = stateRank(current) <= stateRank(SURVEY_OPEN);
  const openRef = useRef(isOpen);
  openRef.current = isOpen;

  /* ---- answering --------------------------------------------------------- */
  const give = (q, value, opts) => {
    setAnswers((prev) => ({ ...prev, [q.qid]: value }));
    setNotice(null);
    // What travels is either an answer the server would count, or null to clear it.
    autosave.change(q.qid, isAnswered(q, value) ? value : null, { debounce: Boolean(opts && opts.typing) });
  };

  const goTo = (screen, index = 0, fromReview = false) => {
    if (view.screen === 'answering' && questions[view.index]) autosave.flush(questions[view.index].qid);
    setNotice(null);
    setView({ screen, index, fromReview });
  };

  const firstMissingRequired = () => questions.findIndex((q) => q.required && !isAnswered(q, answers[q.qid]));
  const answeredAny = () => questions.some((q) => isAnswered(q, answers[q.qid]));

  /*
    SEND. Everything typed is saved first, then the row is marked complete.
    A refusal worth retrying — no connection, a 5xx (`BUSY`, `CONFLICT`), a
    409 that is not a close — is sent again on the autosave's back-off, since
    a second Send of a complete row is a harmless 200; only `SURVEY_CLOSED`
    puts the closed screen up.
  */
  const send = async () => {
    const missing = firstMissingRequired();
    if (missing >= 0) {
      setNotice(`Question ${missing + 1} needs an answer before you can send.`);
      setView({ screen: 'answering', index: missing, fromReview: true });
      return;
    }
    if (!answeredAny()) {
      setNotice(NOTHING_YET);
      return;
    }
    setSending(true);
    setNotice(null);
    const flushed = await autosave.flushAll();
    if (!mountedRef.current) return;
    if (flushed.closed) { setSending(false); return; }
    let result;
    for (let attempt = 0; ; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop
      result = await submitSurvey({ fetchFn: doFetch, apiBase, gameId, identity: identityRef.current });
      if (!mountedRef.current) return;
      if (!result.retry || attempt >= SEND_RETRY_MS.length || !openRef.current) break;
      setNotice('Not sent yet – trying again…');
      // eslint-disable-next-line no-await-in-loop
      await pause(SEND_RETRY_MS[attempt]);
      if (!mountedRef.current) return;
    }
    setSending(false);
    if (result.ok) { setNotice(null); setView({ screen: 'sent', index: 0, fromReview: false }); return; }
    if (result.closed) { setClosedHere(true); return; }
    if (result.nothingAnswered && !(result.missing && result.missing.length)) {
      setNotice(NOTHING_YET);
      return;
    }
    if (result.missing && result.missing.length) {
      const at = questions.findIndex((q) => result.missing.includes(q.qid));
      const index = at >= 0 ? at : 0;
      setNotice(`Question ${index + 1} needs an answer before you can send.`);
      setView({ screen: 'answering', index, fromReview: true });
      return;
    }
    setNotice(result.error || 'That did not send. Try again.');
  };

  /* ---- the warning banner, over whatever is on screen --------------------- */
  const warnedAt = (warning && (warning.warnedAt || true)) || (survey && survey.warnedAt) || null;
  const minutes = (warning && Number.isInteger(warning.minutes) && warning.minutes > 0) ? warning.minutes : TWO_MINUTES;
  const warningBanner = warnedAt && isOpen ? (
    <div className="plr-banner" role="status">
      <Icon name="Timer" weight="bold" size={16} />
      <div>
        <b>{capitalised(countWord(minutes))} {minutes === 1 ? 'minute' : 'minutes'} left.</b>{' '}
        Your host will close the survey soon. Everything you have answered counts, even if you
        do not press Send.
      </div>
    </div>
  ) : null;
  const banners = (banner || warningBanner) ? <>{banner}{warningBanner}</> : null;

  // The session's own name in the bar, from GET /survey — or nothing at all.
  const sessionTitle = (survey && typeof survey.title === 'string' && survey.title.trim()) || null;
  const shell = (props, body) => (
    <PlayerShell who={playerName} online={online} banner={banners} category={sessionTitle} {...props}>
      {body}
    </PlayerShell>
  );

  /* ---- ENDED: every session type ends; a survey's shows no score ---------- */
  if (current === 'ENDED' || current === 'END') {
    return shell({ phase: 'done', volume: 'watch', ctx: 'Session complete', centre: true }, (
      <>
        <p className="plr-lab">That&apos;s a wrap</p>
        <h1 className="plr-h1">Thanks for taking part, {playerName}.</h1>
        <p className="plr-lede plr-muted">The session is over. You can close this page.</p>
        <LookUpCue>
          If your host shares what the room said, it will be on the main screen — they will send
          anything more themselves.
        </LookUpCue>
      </>
    ));
  }

  /* ---- CLOSED ------------------------------------------------------------ */
  if (current === SURVEY_CLOSED) {
    const gaveAny = questions.some((q) => isAnswered(q, answers[q.qid]));
    return shell({ phase: 'done', volume: 'watch', ctx: 'Survey closed', centre: true }, (
      <>
        <h1 className="plr-h1 plr-h1--primary">The survey is closed.</h1>
        <p className="plr-lede plr-muted">
          {gaveAny
            ? `Thanks, ${playerName}. Everything you answered counts, whether or not you pressed Send.`
            : 'Your host has closed it, so there is nothing more to answer.'}
        </p>
        <LookUpCue>
          Your host may put the results on the main screen. Nobody’s name is shown there.
        </LookUpCue>
      </>
    ));
  }

  /* ---- before the questions are here ------------------------------------- */
  if (load.status !== 'ready') {
    if (load.status === 'not-started') {
      return shell({ phase: 'quiet', volume: 'rest', ctx: 'Survey', centre: true }, (
        <>
          <p className="plr-lab">You&apos;re in</p>
          <h1 className="plr-h1 plr-h1--primary">Joined as {playerName}.</h1>
          <p className="plr-lede plr-muted">
            The survey opens when your host is ready. This page will change on its own.
          </p>
        </>
      ));
    }
    if (load.status === 'error') {
      return shell({
        phase: 'quiet',
        volume: 'act',
        ctx: 'Survey',
        centre: true,
        dock: (
          <button type="button" className="plr-btn" onClick={() => { setLoad({ status: 'loading', error: null }); setAttempt((a) => a + 1); }}>
            Try again
          </button>
        ),
      }, (
        <>
          <h1 className="plr-h1 plr-h1--primary">The survey did not load.</h1>
          <p className="plr-lede plr-muted">{load.error}</p>
        </>
      ));
    }
    return shell({ phase: 'quiet', volume: 'rest', ctx: 'Survey', centre: true }, (
      <p className="plr-lede plr-muted">Loading the survey…</p>
    ));
  }

  /* ---- SENT (rest volume: no dock, no amber) ----------------------------- */
  if (view.screen === 'sent') {
    return shell({ phase: 'quiet', volume: 'rest', ctx: 'Sent', centre: true }, (
      <>
        <h1 className="plr-h1 plr-h1--primary">Thanks, {playerName} — that’s everything.</h1>
        <p className="plr-lede plr-muted">
          Your answers are in. You can still change them from here until the host closes the survey.
        </p>
        <button type="button" className="plr-linkish plr-linkish--quiet" onClick={() => goTo('review')}>
          Change my answers
        </button>
        <LookUpCue>
          When the survey closes, your host may put the results on the main screen.
        </LookUpCue>
      </>
    ));
  }

  /* ---- REVIEW ------------------------------------------------------------ */
  if (view.screen === 'review' || total === 0) {
    const skipped = questions.filter((q) => !q.required && !isAnswered(q, answers[q.qid])).length;
    const missing = firstMissingRequired();
    const nothingYet = total > 0 && !answeredAny();
    let reason = notice;
    if (missing >= 0) reason = `Question ${missing + 1} needs an answer before you can send.`;
    else if (nothingYet) reason = NOTHING_YET;
    const lede = [
      skipped === 1 ? 'One was optional and you skipped it.' : '',
      skipped > 1 ? `${capitalised(countWord(skipped))} were optional and you skipped them.` : '',
      'Anything can change until your host closes the survey.',
    ].filter(Boolean).join(' ');
    const blocked = missing >= 0 || nothingYet || sending;
    return shell({
      phase: 'ask',
      volume: 'act',
      ctx: 'Survey',
      progress: 100,
      dock: (
        <>
          <SavedLine status={autosave.status} error={autosave.error} idleText="Everything is saved as you go" />
          {reason && (
            <p className="plr-note" id={reasonId}>{reason}</p>
          )}
          <div className="plr-pair">
            <button
              type="button"
              className="plr-btn plr-btn--ghost"
              disabled={total === 0}
              onClick={() => goTo('answering', Math.max(0, total - 1))}
            >
              Back
            </button>
            <button
              type="button"
              className="plr-btn"
              disabled={blocked || total === 0}
              aria-describedby={reason ? reasonId : undefined}
              onClick={send}
            >
              {sending ? 'Sending…' : 'Send my answers'}
            </button>
          </div>
        </>
      ),
    }, (
      <>
        <h1 className="plr-q">Check your answers</h1>
        <p className="plr-detail plr-muted">{lede}</p>
        <ol className="plr-rev" aria-label="Your answers">
          {questions.map((q, i) => {
            const given = isAnswered(q, answers[q.qid]);
            let said = summaryFor(q, answers[q.qid]);
            if (!given) said = q.required ? 'Needs an answer' : 'Skipped — optional';
            return (
              <li key={q.qid}>
                <span className="plr-rev-n" aria-hidden="true">{i + 1}</span>
                <span className="plr-rev-b">
                  <span className="plr-rev-t">{q.title}</span>
                  <span className={`plr-rev-a${given ? '' : ' plr-rev-a--none'}`}>{said}</span>
                </span>
                <button
                  type="button"
                  className="plr-rev-ed"
                  aria-label={`${given ? 'Change' : 'Answer'} question ${i + 1}`}
                  onClick={() => goTo('answering', i, true)}
                >
                  {given ? 'Change' : 'Answer'}
                </button>
              </li>
            );
          })}
        </ol>
      </>
    ));
  }

  /* ---- ANSWERING --------------------------------------------------------- */
  const index = Math.min(view.index, total - 1);
  const q = questions[index];
  const value = answers[q.qid] ?? null;
  const answered = isAnswered(q, value);
  const held = q.required && !answered;
  const last = index === total - 1;
  const forward = () => {
    if (view.fromReview || last) goTo('review');
    else goTo('answering', index + 1);
  };
  let primaryLabel = answered || q.required ? 'Next' : 'Skip';
  if (view.fromReview) primaryLabel = 'Review';

  const mode = namesMode(survey.names);
  const shuffleSeed = `${(identity && identity.respondentId) || playerName}:${q.qid}`;
  const inputProps = {
    question: q,
    value,
    onChange: (v, opts) => give(q, v, opts),
    onBlur: () => autosave.flush(q.qid),
  };
  let input;
  switch (q.kind) {
    case 'rating': input = <RatingInput {...inputProps} />; break;
    case 'choice':
      input = (
        <ChoiceInput
          {...inputProps}
          order={q.shuffle ? seededOrder(shuffleSeed, (q.options || []).length) : null}
        />
      );
      break;
    case 'yesno': input = <YesNoInput {...inputProps} />; break;
    case 'rank': input = <RankInput {...inputProps} />; break;
    default: input = <TextInput {...inputProps} />;
  }

  return shell({
    phase: 'ask',
    volume: 'act',
    ctx: `${index + 1} of ${total}`,
    progress: (index * 100) / total,
    dock: (
      <>
        {/* The idle "Answers save as you go" gives way to the reason when there
            is one: two quiet lines above two buttons is one too many. */}
        {!((held || notice) && autosave.status === 'idle') && (
          <SavedLine status={autosave.status} error={autosave.error} />
        )}
        {(held || notice) && (
          <p className="plr-note" id={reasonId}>
            {held ? 'This one needs an answer before you go on.' : notice}
          </p>
        )}
        <div className="plr-pair">
          <button
            type="button"
            className="plr-btn plr-btn--ghost"
            disabled={index === 0 && !view.fromReview}
            onClick={() => (view.fromReview && index === 0 ? goTo('review') : goTo('answering', index - 1, view.fromReview))}
          >
            Back
          </button>
          <button
            type="button"
            className="plr-btn"
            disabled={held}
            aria-describedby={held || notice ? reasonId : undefined}
            onClick={forward}
          >
            {primaryLabel}
          </button>
        </div>
      </>
    ),
  }, (
    <>
      {index === 0 && (
        <p className="plr-anon">
          {mode.phoneLead && <><b>{mode.phoneLead}</b>{' '}</>}
          {mode.phoneLine}
        </p>
      )}
      <p className="plr-qno">
        Question {index + 1}{' '}
        <span className="plr-req">· {q.required ? 'needs an answer' : 'optional'}</span>
      </p>
      <h1 className="plr-q">{q.title}</h1>
      {String(q.detail || '').trim() && <p className="plr-detail plr-muted">{q.detail}</p>}
      <React.Fragment key={q.qid}>{input}</React.Fragment>
    </>
  ));
}
