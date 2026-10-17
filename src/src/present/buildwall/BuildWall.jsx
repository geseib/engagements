/**
 * THE BUILD ROOM'S WINDOW: /present?gameId=…&type=build&k=… (parity PLAN §2.4, B7).
 *
 * The room's own window, on the projector. Public and stateless: it draws
 * only what the wall read carries (useBuildWall: GET build-play/wall?k=),
 * follows the server's choice of screen (`wall.screen`: Stage, Build or
 * History), its codes card (`wall.codes`) and its display profile
 * (`wall.profile`). A reload, a dropped network or a second copy on another
 * computer lands on the same screen. Never the signed-in fetch
 * (__tests__/buildWallImports.test.js walks every import from here).
 *
 * The screens are B6's display components (buildroom/screens/) with NO
 * controls: nothing on the wall can be pressed, and it names nobody unless the
 * host turned List names on (the server decides; wallView is an allowlist).
 *
 * NEVER SCROLLS (host standards §5). The Stage has the shared fitter. Build
 * fits its newest screenshot into what is left of the screen. History shows
 * the newest entries that fit and "and N earlier" (fit lever 3), measured
 * here after each layout, never a scrollbar.
 */
import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { ImageLoader } from '../../buildroom/BuildImage';
import BuildStageScreen from '../../buildroom/screens/BuildStageScreen';
import BuildBuildScreen from '../../buildroom/screens/BuildBuildScreen';
import BuildHistoryScreen from '../../buildroom/screens/BuildHistoryScreen';
import { W } from '../../buildroom/words';
import { PROFILES, profileClass } from '../../config/displayProfile';
import useBuildWall from './useBuildWall';
import { wallRoom, wallState } from './wallRoom';
import '../../buildroom/BuildRoom.css';
import './BuildWall.css';

function useNow(ms) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** The profile's ladder on the document root, where the four ladders are declared (styles/stage.css). */
function useRootProfile(profile, again) {
  useEffect(() => {
    const root = document.documentElement;
    const cls = profileClass(profile);
    PROFILES.forEach((p) => root.classList.remove(`d-${p}`));
    root.classList.add(cls);
    return () => root.classList.remove(cls);
  }, [profile, again]);
}

/** How many of `items` (top to bottom) end inside `box`, leaving `reserve` px for the "and N earlier" line. */
export function countThatFit(box, items, reserve = 0) {
  if (!box || !items.length) return items.length;
  const limit = box.getBoundingClientRect().bottom - reserve;
  let n = 0;
  for (const el of items) {
    if (el.getBoundingClientRect().bottom > limit + 0.5) break;
    n += 1;
  }
  return n;
}

const overflows = (el) => Boolean(el) && el.scrollHeight > el.clientHeight + 1;

/**
 * History on the wall: measure, then cut to what fits, newest first. Runs
 * again when the story, the profile or the window's size changes.
 */
function useHistoryFit(on, key) {
  const [size, setSize] = useState(0);
  const [loads, setLoads] = useState(0);
  // The cut belongs to one story at one size: a new one starts from everything.
  const [cut, setCut] = useState({ at: '', story: null, decided: null });
  const at = `${on}|${key}|${size}`;
  const fit = cut.at === at ? cut : null;
  useEffect(() => {
    if (!on) return undefined;
    const onResize = () => setSize((s) => s + 1);
    // A picture that arrives makes its row taller: measure again, keeping the cut
    // (only ever shorter, so a picture mounting again cannot start a loop).
    const onLoad = (e) => { if (e.target && e.target.tagName === 'IMG') setLoads((n) => n + 1); };
    window.addEventListener('resize', onResize);
    document.addEventListener('load', onLoad, true);
    return () => {
      window.removeEventListener('resize', onResize);
      document.removeEventListener('load', onLoad, true);
    };
  }, [on]);
  useLayoutEffect(() => {
    if (!on) return;
    const main = document.querySelector('.bwall .brm-histmain');
    const side = document.querySelector('.bwall .brm-histside');
    const next = {};
    const line = (box) => {
      const p = box && box.querySelector('.brm-earlier');
      return p ? p.getBoundingClientRect().height : 48;
    };
    if (main && overflows(main)) {
      const items = [...main.querySelectorAll(':scope > .brm-story > li')];
      const cur = fit && fit.story ? fit.story : items.length;
      next.story = Math.max(1, Math.min(cur - 1, countThatFit(main, items, line(main) + 8)));
      if (fit && fit.story === 1) delete next.story;
    }
    if (side && overflows(side)) {
      const items = [...side.querySelectorAll('.brm-decided > li')];
      const cur = fit && fit.decided ? fit.decided : items.length;
      // Rows past the bottom of the side, less the line that counts them.
      const room = countThatFit(side, items, line(side) + 8);
      next.decided = Math.max(1, Math.min(cur - 1, room));
      if (fit && fit.decided === 1) delete next.decided;
    }
    if (Object.keys(next).length) setCut({ ...(fit || { story: null, decided: null }), ...next, at });
  }, [on, fit, at, loads]);
  return fit;
}

/** A plain line in the middle of the room's screen: connecting, a changed link, a gone session. */
function WallQuiet({ line, profile = 'room' }) {
  useRootProfile(profile, line);
  return (
    <div className="brm bwall bwall--quiet" data-theme="dark" data-wall-state="quiet">
      <p className="bwall-quiet" role="status">{line}</p>
    </div>
  );
}

export default function BuildWall({ gameId, k }) {
  const { status, wall, loadImage } = useBuildWall(gameId, k);
  const now = useNow(5000);
  const room = useMemo(() => (wall ? wallRoom(wall) : null), [wall]);
  const ws = wallState(wall);
  const screen = ws.screen;
  const ended = Boolean(room && room.state === 'ENDED');
  const storyKey = room ? `${(room.log || []).length}:${(room.asks || []).length}:${(room.images || []).length}:${ws.profile}` : '';
  const fit = useHistoryFit(status === 'ok' && screen === 'history', storyKey);
  useRootProfile(ws.profile, screen);

  if (status === 'link-changed') return <WallQuiet line={W.wallLinkChanged} />;
  if (status === 'not-found') return <WallQuiet line={W.wallNotFound} />;
  if (status !== 'ok' || !room) return <WallQuiet line={W.wallConnecting} />;

  const codesUp = ws.codes !== 'none' && !ended;
  let body;
  if (screen === 'stage') {
    body = <BuildStageScreen room={room} now={now} show={{ codesUp }} profile={ws.profile} />;
  } else {
    body = (
      <div className="bwall-frame">
        <header className="bwall-head">
          <span className="bwall-title">{room.title || 'Build Room'}</span>
          {ended
            ? <span className="bwall-ended">{W.wallEnded}</span>
            : <span className="bwall-join">{`${window.location.host}/play`} <b>{room.gameId}</b></span>}
        </header>
        <div className="bwall-body">
          {screen === 'build'
            ? <BuildBuildScreen room={room} now={now} profile={ws.profile} />
            : <BuildHistoryScreen room={room} now={now} fit={fit} profile={ws.profile} />}
        </div>
      </div>
    );
  }
  return (
    <ImageLoader.Provider value={loadImage}>
      <div className={`brm brm-room brm--present bwall bwall--${screen}`} data-theme="dark" data-wall-screen={screen} data-profile={ws.profile}>
        {body}
      </div>
    </ImageLoader.Provider>
  );
}
