import React from 'react';
import './ClipStill.css';

/**
 * A drawn still for a clip slot that has no recording yet — the sketched
 * product UI from docs/design/marketing-redesign/mk.css's `.mk-ss*` rules,
 * lifted from the mockups (01-home.html, 02-how-it-works.html). The outer
 * element carries the accessible name; everything drawn inside it is
 * `aria-hidden` so a screen reader hears the one alt text, not a pile of
 * fake UI copy.
 */

const TRIVIA_HOST = (
  <>
    <div className="mk-ss-top">
      <span className="mk-ss-dot" />
      <span className="mk-ss-chip">Trivia · Question 4 of 10</span>
      <span className="mk-ss-code">4821</span>
    </div>
    <p className="mk-ss-q">Which of these did the 2025 retro name as the single biggest cause of rework?</p>
    <div className="mk-ss-opts">
      <div className="mk-ss-opt"><b>A</b> Unclear acceptance criteria</div>
      <div className="mk-ss-opt"><b>B</b> Late design changes</div>
      <div className="mk-ss-opt mk-ss-right"><b>C</b> Requirements agreed in a call and never written down</div>
      <div className="mk-ss-opt"><b>D</b> Environment drift</div>
    </div>
    <div className="mk-ss-foot">
      <span className="mk-ss-chip">18 of 20 answered</span>
      <span className="mk-ss-grow" />
      <span className="mk-ss-chip">Reveal</span>
    </div>
  </>
);

const TRIVIA_PLAYER = (
  <>
    <div className="mk-ss-top"><span className="mk-ss-dot" /><span className="mk-ss-chip">Priya</span></div>
    <p className="mk-ss-q">Biggest cause of rework?</p>
    <div className="mk-ss-opts">
      <div className="mk-ss-opt"><b>A</b> Criteria</div>
      <div className="mk-ss-opt"><b>B</b> Design</div>
      <div className="mk-ss-opt mk-ss-right"><b>C</b> Never written</div>
      <div className="mk-ss-opt"><b>D</b> Drift</div>
    </div>
    <div className="mk-ss-cta">Locked in</div>
  </>
);

/* The results of a call-and-answer round (2026-09-25). It used to be
 * labelled VOTE with vote counts on the bars; the numbers the stage shows
 * are the RESULTS points of a ranked top three, scored 3/2/1
 * (game/get-results.js). The numbers match the home tally. */
const POLL_HOST = (
  <>
    <div className="mk-ss-top">
      <span className="mk-ss-dot" />
      <span className="mk-ss-chip">Results</span>
      <span className="mk-ss-code">4821</span>
    </div>
    <p className="mk-ss-q">What should we stop doing in the next quarter?</p>
    <div className="mk-ss-bars">
      <div className="mk-ss-bar">
        <span>Parallel discovery on three products</span><em>52</em>
        <span className="mk-ss-track"><i style={{ width: '82%' }} /></span>
      </div>
      <div className="mk-ss-bar">
        <span>Weekly status meeting nobody reads</span><em>44</em>
        <span className="mk-ss-track"><i style={{ width: '69%' }} /></span>
      </div>
      <div className="mk-ss-bar">
        <span>Hand-built release notes</span><em>24</em>
        <span className="mk-ss-track mk-ss-cool"><i style={{ width: '38%' }} /></span>
      </div>
    </div>
    <div className="mk-ss-foot">
      <span className="mk-ss-chip">20 of 20 voted</span>
      <span className="mk-ss-grow" />
      <span className="mk-ss-chip">Next question</span>
    </div>
  </>
);

const POLL_PLAYER = (
  <>
    <div className="mk-ss-top"><span className="mk-ss-dot" /><span className="mk-ss-chip">Your idea</span></div>
    <p className="mk-ss-q">What should we stop doing?</p>
    <div className="mk-ss-field">Parallel discovery on three products at once</div>
    <div className="mk-ss-doc">
      <span className="mk-ss-line" />
      <span className="mk-ss-line mk-ss-short" />
    </div>
    <div className="mk-ss-cta">Send</div>
  </>
);

const JOIN_QR = (
  <>
    <div className="mk-ss-top"><span className="mk-ss-dot" /><span className="mk-ss-chip">Lobby</span><span className="mk-ss-code">4821</span></div>
    <div className="mk-ss-qr" />
    <div className="mk-ss-people">
      <span className="mk-ss-person">Priya</span><span className="mk-ss-person">Tomas</span>
      <span className="mk-ss-person">Alina</span><span className="mk-ss-person">Sam</span>
      <span className="mk-ss-person">Jo</span><span className="mk-ss-person">Marek</span>
      <span className="mk-ss-person">+14</span>
    </div>
  </>
);

const BUILDER = (
  <>
    <div className="mk-ss-top"><span className="mk-ss-dot" /><span className="mk-ss-chip">Your sets</span><span className="mk-ss-code">Host</span></div>
    <div className="mk-ss-opts">
      <div className="mk-ss-opt mk-ss-right"><b>&bull;</b> Q3 planning &mdash; stop / start · 6 questions</div>
      <div className="mk-ss-opt"><b>&bull;</b> Onboarding trivia · 10 questions</div>
      <div className="mk-ss-opt"><b>&bull;</b> Retro prompts &mdash; September · 5 questions</div>
    </div>
    <div className="mk-ss-cta">Start session</div>
  </>
);

const REPORT = (
  <div className="mk-ss-doc">
    <span className="mk-ss-line mk-ss-title" style={{ width: '64%' }} />
    <span className="mk-ss-line" />
    <span className="mk-ss-line" style={{ width: '86%' }} />
    <span className="mk-ss-line mk-ss-warm" style={{ width: '72%' }} />
    <span className="mk-ss-line" />
    <span className="mk-ss-line mk-ss-warm" style={{ width: '48%' }} />
    <span className="mk-ss-line" style={{ width: '70%' }} />
    <span className="mk-ss-line" style={{ width: '90%' }} />
  </div>
);

/*
 * The three stills the /how-it-works tour draws that exist nowhere else —
 * lifted from docs/design/marketing-redesign/02-how-it-works.html steps 3-5,
 * the same way the seven above were lifted. `ClipFrame`'s `still` prop
 * selects one of these independently of the manifest `slot` it is drawn into.
 */

const TOUR_ASK = (
  <>
    <div className="mk-ss-top">
      <span className="mk-ss-dot" />
      <span className="mk-ss-chip">Trivia · Ask</span>
      <span className="mk-ss-code">4821</span>
    </div>
    <p className="mk-ss-q">Which of these did the 2025 retro name as the single biggest cause of rework?</p>
    <div className="mk-ss-opts">
      <div className="mk-ss-opt"><b>A</b> Unclear acceptance criteria</div>
      <div className="mk-ss-opt"><b>B</b> Late design changes</div>
      <div className="mk-ss-opt"><b>C</b> Requirements agreed in a call and never written down</div>
      <div className="mk-ss-opt"><b>D</b> Environment drift</div>
    </div>
    <div className="mk-ss-foot"><span className="mk-ss-chip">14 of 20 answered</span></div>
  </>
);

const TOUR_VOTE = (
  <>
    <div className="mk-ss-top"><span className="mk-ss-dot" /><span className="mk-ss-chip">Vote</span></div>
    <p className="mk-ss-q">Pick the ones worth carrying.</p>
    <div className="mk-ss-opts">
      <div className="mk-ss-opt mk-ss-right"><b>✓</b> Parallel discovery on three products</div>
      <div className="mk-ss-opt"><b>{' '}</b> Weekly status meeting</div>
      <div className="mk-ss-opt"><b>{' '}</b> Hand-built release notes</div>
      <div className="mk-ss-opt"><b>{' '}</b> Two-week estimates</div>
    </div>
    <div className="mk-ss-cta">Cast vote</div>
  </>
);

const TOUR_RESULTS = (
  <>
    <div className="mk-ss-top">
      <span className="mk-ss-dot" />
      <span className="mk-ss-chip">Call and answer · Results</span>
      <span className="mk-ss-code">4821</span>
    </div>
    <div className="mk-ss-bars">
      <div className="mk-ss-bar">
        <span>Parallel discovery on three products</span><em>9</em>
        <span className="mk-ss-track"><i style={{ width: '82%' }} /></span>
      </div>
      <div className="mk-ss-bar">
        <span>Weekly status meeting nobody reads</span><em>7</em>
        <span className="mk-ss-track"><i style={{ width: '64%' }} /></span>
      </div>
      <div className="mk-ss-bar">
        <span>Hand-built release notes</span><em>4</em>
        <span className="mk-ss-track mk-ss-cool"><i style={{ width: '36%' }} /></span>
      </div>
      <div className="mk-ss-bar">
        <span>Two-week estimates on unscoped work</span><em>0</em>
        <span className="mk-ss-track mk-ss-cool"><i style={{ width: '2%' }} /></span>
      </div>
    </div>
    <div className="mk-ss-foot"><span className="mk-ss-chip">Next question</span></div>
  </>
);

/*
 * The two stills the refreshed hero draws (docs/design/refresh-2026-09-22/
 * _src/build.py HERO_STAGE): trivia RESULTS with the correct row carrying the
 * headline and shares beside every option (open question 2's recommended
 * answer — one green row and four bars read at thumbnail size where a vote
 * page does not), and the phone that has just been told its score.
 */

const HERO_RESULTS = (
  <>
    <div className="mk-ss-top">
      <span className="mk-ss-dot" />
      <span className="mk-ss-chip">Results · Q4 of 10</span>
      <span className="mk-ss-code">4821</span>
    </div>
    <p className="mk-ss-q">Which did the retro name as the biggest cause of rework?</p>
    <div className="mk-ss-bars">
      <div className="mk-ss-bar mk-ss-right">
        <span><b>C</b> Requirements agreed in a call and never written down</span><em>58%</em>
        <span className="mk-ss-track"><i style={{ width: '58%' }} /></span>
      </div>
      <div className="mk-ss-bar">
        <span>A Unclear acceptance criteria</span><em>22%</em>
        <span className="mk-ss-track mk-ss-cool"><i style={{ width: '22%' }} /></span>
      </div>
      <div className="mk-ss-bar">
        <span>B Late design changes</span><em>14%</em>
        <span className="mk-ss-track mk-ss-cool"><i style={{ width: '14%' }} /></span>
      </div>
      <div className="mk-ss-bar">
        <span>D Environment drift</span><em>6%</em>
        <span className="mk-ss-track mk-ss-cool"><i style={{ width: '6%' }} /></span>
      </div>
    </div>
    <div className="mk-ss-foot">
      <span className="mk-ss-chip">20 of 20 answered</span>
      <span className="mk-ss-grow" />
      <span className="mk-ss-chip">Next question</span>
    </div>
  </>
);

/* "+14 pts", not "+120": a right answer scores 10 plus up to 5 for speed
 * (websocket/message.js), so 15 is the most one question can pay. */
const HERO_PHONE = (
  <>
    <div className="mk-ss-top"><span className="mk-ss-dot" /><span className="mk-ss-chip">Priya</span></div>
    <p className="mk-ss-q">You picked C</p>
    <div className="mk-ss-opts">
      <div className="mk-ss-opt mk-ss-right"><b>C</b> Never written</div>
    </div>
    <div className="mk-ss-cta">+14 pts</div>
  </>
);

const STILLS = {
  'hero-results': { content: HERO_RESULTS, extraClass: '' },
  'hero-phone': { content: HERO_PHONE, extraClass: '' },
  'trivia-host': { content: TRIVIA_HOST, extraClass: '' },
  'trivia-player': { content: TRIVIA_PLAYER, extraClass: '' },
  'poll-host': { content: POLL_HOST, extraClass: '' },
  'poll-player': { content: POLL_PLAYER, extraClass: '' },
  'join-qr': { content: JOIN_QR, extraClass: '' },
  builder: { content: BUILDER, extraClass: '' },
  report: { content: REPORT, extraClass: ' mk-ss--paper' },
  'tour-ask': { content: TOUR_ASK, extraClass: '' },
  'tour-vote': { content: TOUR_VOTE, extraClass: '' },
  'tour-results': { content: TOUR_RESULTS, extraClass: '' },
};

export default function ClipStill({ slot, alt }) {
  const entry = STILLS[slot];

  if (!entry) return <div className="mk-ss" role="img" aria-label={alt} />;

  return (
    <div className={`mk-ss${entry.extraClass}`} role="img" aria-label={alt}>
      <div aria-hidden="true">{entry.content}</div>
    </div>
  );
}
