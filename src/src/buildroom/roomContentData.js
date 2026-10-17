/**
 * A BUILD ROOM'S WORDS FOR config/roomContent.js (owner, 17 Oct 2026).
 *
 * The projected screens (screens/BuildStageScreen, BuildBuildScreen,
 * BuildHistoryScreen) are the same components on the host's one screen and on
 * the room's window, so both destinations reach roomContentFor through here:
 * which moment the Stage is in, and the words of it — the ask's prompt, its
 * options, its detail and reasons (Call only, the function decides), and
 * Claude's one status (buildScreens.js claudeState, the rule the dock and the
 * Host's Now card read). Never a name: the reasons go without their authors.
 */
import { roomContentFor } from '../config/roomContent';
import { claudeState, runCurrentItem } from './buildScreens';

/** Which room-content moment the Stage is showing. */
export function buildMomentOf({
  current = null, wheel = false, point = null, run = null, showing = false,
} = {}) {
  if (showing) return 'BUILD_SHOWING';
  if (current && wheel) return 'BUILD_WHEEL';
  if (current) return current.status === 'results' ? 'BUILD_RESULTS' : 'BUILD_ASK';
  if (point) return 'BUILD_POINT';
  if (run) return 'BUILD_RUN';
  return 'BUILD_IDLE';
}

/** Claude's status, as the room may read it. */
export function claudeWords(room, now) {
  const st = claudeState(room, now);
  return {
    key: st.key,
    headline: st.headline,
    line: st.line || '',
    dur: st.doing && !st.doing.stale ? st.doing.dur : '',
    helperLine: st.helperLine || '',
  };
}

export function buildRoomData(room, current, now) {
  const whys = current && current.results && Array.isArray(current.results.whys) ? current.results.whys : [];
  const step = room && room.run ? runCurrentItem(room.run) : null;
  return {
    prompt: current ? current.prompt : '',
    detail: current ? current.detail : '',
    options: current ? (current.options || []) : [],
    whys: whys.map((w) => ({ label: w.label, text: w.text })),
    claude: claudeWords(room, now),
    step: step ? { k: step.k, text: step.text } : null,
  };
}

/** The room content for one Build Room screen. */
export function buildRoomContent(moment, profile, room, current, now) {
  return roomContentFor(moment, profile, buildRoomData(room, current, now));
}
