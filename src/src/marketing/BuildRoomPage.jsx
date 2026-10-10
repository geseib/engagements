import React, { useEffect } from 'react';
import MarketingShell, { goToAuth } from './MarketingShell';
import { pluginSlash, pluginPaths } from '../buildroom/pluginTier';
import './BuildRoomPage.css';

const LOOP = ['Ask', 'Decide', 'Build', 'Test', 'Remember'];

const CASES = [
  ['Shape and prototype a new product', 'Agree who it is for, choose the first experience and test a working version before the workshop ends.'],
  ['Improve an internal workflow', 'Let the people who do the work name the friction, choose the priority and try the new flow together.'],
  ['Build a small team tool', 'Turn a repeated manual task into a useful tool while the team supplies the rules and edge cases.'],
  ['Run a collaborative hack day', 'Give every participant a voice in what gets built, even when only one person is driving Claude Code.'],
];


/**
 * BEFORE YOU START (docs/design/build-room-before-you-start; owner 2026-10-10).
 * Only the host's laptop needs setting up. The install command is NOT shown
 * here: it is in a room's Connect window, once signed in. No time estimate:
 * none was ever measured. Every path names this site's own plugin
 * (pluginTier.js), as engage-mcp.mjs writes it.
 */
const NEEDS = [
  ['Claude Code, installed and signed in', 'On the laptop that will run the build.'],
  ['Node 18 or later', <>Check with <code>node --version</code>.</>],
  ['Git', "Each room's project is a git repository."],
  ['A terminal on that laptop', 'The commands are for macOS and Linux.'],
];

function setupSteps() {
  return [
    ['Create a room', <>Sign in as a host and choose <b>Build Room</b>. Give it a title; the room can decide what to build.</>],
    ['Install the Engage plugin', <>Once per laptop. The command is in the room&apos;s <b>Connect Claude Code</b> window once you&apos;re signed in. Run it in a terminal: it downloads one file from this site and adds the plugin to Claude Code. Run it again to update.</>],
    ['Paste the start command', <>In the same window, mint a key and copy the start command. Paste it into the terminal: it makes the project folder and starts Claude Code in it. Then type <code>{pluginSlash('kickoff')}</code>.</>],
  ];
}

function laptopChanges() {
  const { pluginDir, configFile } = pluginPaths();
  return {
    once: [
      ['~/.engage-mcp.mjs', "The plugin's one file, downloaded from this site."],
      [pluginDir, 'The plugin: its commands, hooks and skill.'],
      [configFile, 'The address of this Engage site.'],
      ["Claude Code's plugin list", 'Engage, added as a local plugin.'],
    ],
    room: [
      ['~/build-room/<name>/', 'A new folder with git, a README.md and a DECISIONS.md.'],
      ['<name>/.engage/', "The room's key. Never committed."],
      ['<name>/.claude/settings.local.json', 'Turns the Engage plugin on for this folder. Never committed.'],
    ],
  };
}

function ChangeList({ items }) {
  return (
    <dl>
      {items.map(([where, what]) => <div key={where}><dt>{where}</dt><dd>{what}</dd></div>)}
    </dl>
  );
}

export default function BuildRoomPage() {
  // The New Build Room page links to /build-room#before-you-start; the section
  // renders after the browser's own jump to the hash, so scroll to it here.
  useEffect(() => {
    const id = typeof window !== 'undefined' ? window.location.hash.slice(1) : '';
    const el = id && document.getElementById(id);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' });
  }, []);
  const changes = laptopChanges();
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

      <section id="before-you-start" className="mk-section mk-section--b" aria-labelledby="mk-bys-title">
        <div className="mk-shell">
          <div className="mk-section-head">
            <p className="mk-kicker">Before you start</p>
            <h2 className="mk-title" id="mk-bys-title">Set up the host&apos;s laptop once.</h2>
            <p className="mk-lead">Only the host needs this. Everyone else joins from laptops, tablets and phones with a QR code or session code, and needs no account.</p>
          </div>
          <div className="mk-bys">
            <div>
              <h3>What you need</h3>
              <ul className="mk-bys-need">
                {NEEDS.map(([need, note]) => (
                  <li key={need}><span className="mk-bys-ck" aria-hidden="true" /><div><b>{need}</b><span>{note}</span></div></li>
                ))}
              </ul>
            </div>
            <div>
              <h3>Three steps</h3>
              <ol className="mk-bys-steps">
                {setupSteps().map(([title, text], i) => (
                  <li key={title}>
                    <span className="mk-bys-sn" aria-hidden="true">{i + 1}</span>
                    <div>
                      <h4>{title}</h4>
                      <p>{text}</p>
                      {i === 1 && <p><a className="mk-bys-link" href="/engage-mcp.mjs">Read the file first</a></p>}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
          <div className="mk-bys-chg">
            <h3>What it changes on the laptop</h3>
            <div className="mk-bys-chg-grid">
              <div className="mk-bys-col"><h4>Once, when you install</h4><ChangeList items={changes.once} /></div>
              <div className="mk-bys-col"><h4>Each room</h4><ChangeList items={changes.room} /></div>
            </div>
            <p className="mk-bys-foot"><b>Nothing else.</b> The plugin acts only in a folder connected to a room. There it saves a hidden git snapshot after each turn and sends the room one plain line per step Claude takes.</p>
          </div>
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
