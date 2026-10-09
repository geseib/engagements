import React from 'react';
import MarketingShell, { goToAuth } from './MarketingShell';
import './BuildRoomPage.css';

const LOOP = ['Ask', 'Decide', 'Build', 'Test', 'Remember'];

const CASES = [
  ['Shape and prototype a new product', 'Agree who it is for, choose the first experience and test a working version before the workshop ends.'],
  ['Improve an internal workflow', 'Let the people who do the work name the friction, choose the priority and try the new flow together.'],
  ['Build a small team tool', 'Turn a repeated manual task into a useful tool while the team supplies the rules and edge cases.'],
  ['Run a collaborative hack day', 'Give every participant a voice in what gets built, even when only one person is driving Claude Code.'],
];

export default function BuildRoomPage() {
  return (
    <MarketingShell title="Build Room" current="cases" rootClass="mk-build-room-page">
      <section className="mk-br-hero">
        <div className="mk-shell mk-br-hero-grid">
          <div>
            <p className="mk-kicker">Build Room</p>
            <h1 className="mk-display">Build software with the people who will use it.</h1>
            <p className="mk-lead">Connect a Claude Code project to a shared room. People suggest, vote and test from their own browsers while the host guides what Claude builds next.</p>
            <p className="mk-br-loop">Ask → Decide → Build → Test → Remember</p>
            <div className="mk-br-actions">
              <a className="mk-btn mk-btn-primary mk-btn-lg" href="#walkthrough">Watch the walkthrough</a>
              <a className="mk-btn mk-btn-ghost mk-btn-lg" href="/auth?mode=register" onClick={goToAuth('/auth?mode=register')}>Create a host account</a>
            </div>
          </div>
          <div className="mk-br-hero-art">
            <img src="/assets/marketing/engage-build-room-poster.jpg" alt="A Build Room Stage question and the shared project Claude Code is building" />
          </div>
        </div>
      </section>

      <section id="walkthrough" className="mk-section mk-section--a">
        <div className="mk-shell">
          <div className="mk-section-head">
            <p className="mk-kicker">A real room, a real build</p>
            <h2 className="mk-title">Watch the team shape the work as it happens.</h2>
            <p className="mk-lead">This walkthrough follows a team building Connect Four. The subject is playful; the loop is the same one teams use for product ideas, workflows and internal tools.</p>
          </div>
          <video className="mk-br-video" controls playsInline preload="none" poster="/assets/marketing/engage-build-room-poster.jpg" aria-label="Build Room walkthrough with narration and captions">
            <source src="/assets/marketing/engage-build-room.mp4" type="video/mp4" />
            <track kind="captions" src="/assets/marketing/engage-build-room.vtt" srcLang="en" label="English" />
            <a href="/assets/marketing/engage-build-room.mp4">Watch the Build Room walkthrough</a>
          </video>
          <p className="mk-muted mk-br-transcript"><a href="/assets/marketing/engage-build-room-transcript.html">Read the Build Room transcript</a></p>
        </div>
      </section>

      <section className="mk-section mk-section--b">
        <div className="mk-shell">
          <div className="mk-section-head">
            <p className="mk-kicker">How the loop works</p>
            <h2 className="mk-title">The room decides. Claude Code does the work.</h2>
          </div>
          <ol className="mk-br-steps">
            {LOOP.map((step, index) => (
              <li key={step}>
                <span>{index + 1}</span>
                <h3>{step}</h3>
                <p>{[
                  'Gather ideas or put a clear question on the Stage.',
                  'Vote, rate or let the host turn the discussion into one direction.',
                  'The decision reaches the connected Claude Code project.',
                  'Share the working result, collect feedback and ask the next question.',
                  'History keeps the ideas, choices, screenshots and changes together.',
                ][index]}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mk-section mk-section--a">
        <div className="mk-shell">
          <div className="mk-section-head">
            <p className="mk-kicker">Where it fits</p>
            <h2 className="mk-title">Use the Build Room when the people in the room know what good looks like.</h2>
          </div>
          <div className="mk-br-cases">
            {CASES.map(([title, text]) => <article key={title}><h3>{title}</h3><p>{text}</p></article>)}
          </div>
        </div>
      </section>

      <section className="mk-section mk-section--b">
        <div className="mk-shell mk-br-requirements">
          <div>
            <p className="mk-kicker">What you need</p>
            <h2 className="mk-title">One host. One Claude Code project. Any number of browsers.</h2>
          </div>
          <ul className="mk-mode-list">
            <li>The host connects the project through the Engage plugin for Claude Code.</li>
            <li>Participants join by QR code or session code. They do not need accounts.</li>
            <li>The Stage carries questions, choices and results on the room screen.</li>
            <li>The Build screen shows the latest working result. On the same Wi-Fi, the host can also share the live build; otherwise the room sees Claude’s screenshots.</li>
          </ul>
        </div>
      </section>

      <section className="mk-cta">
        <div className="mk-shell mk-cta-in">
          <h2 className="mk-title">Bring the room into the build.</h2>
          <div className="mk-cta-row">
            <a className="mk-btn mk-btn-primary mk-btn-lg" href="/auth?mode=register" onClick={goToAuth('/auth?mode=register')}>Create a host account</a>
            <a className="mk-btn mk-btn-ghost mk-btn-lg" href="/use-cases">See every use case</a>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
