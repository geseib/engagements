/**
 * A BUILD ROOM'S WORDS FOR config/roomContent.js (owner, 17 Oct 2026).
 *
 * The projected screens (screens/BuildStageScreen, BuildBuildScreen,
 * BuildHistoryScreen) are the same components on the host's one screen and on
 * the room's window, so both destinations reach roomContentFor through here:
 * which moment the Stage is in, and the words of it — the ask's prompt, its
 * options with their detail, the ask's own detail and the room's reasons (the
 * function decides where each shows: 18 Oct 2026, option detail everywhere), and
 * Claude's one status (buildScreens.js claudeState, the rule the dock and the
 * Host's Now card read). Never a name: the reasons go without their authors.
 */
import { roomContentFor } from '../config/roomContent';
import { claudeState, runCurrentItem } from './buildScreens';

/** Which room-content moment the Stage is showing. */
export function buildMomentOf({
  current = null, wheel = false, point = null, run = null, showing = false, sent = null,
} = {}) {
  if (showing) return 'BUILD_SHOWING';
  // THE SENT TO CLAUDE CARD (owner, 23 Oct 2026) leads until the next ask opens (buildScreens sentCard).
  if (sent && !current) return 'BUILD_SENT';
  if (current && wheel) return 'BUILD_WHEEL';
  // A decided ask is on the Stage only while it is Sent to Claude (buildScreens sentStageAsk): its result.
  if (current) return ['results', 'decided'].includes(current.status) ? 'BUILD_RESULTS' : 'BUILD_ASK';
  if (point) return 'BUILD_POINT';
  if (run) return 'BUILD_RUN';
  return 'BUILD_IDLE';
}

/**
 * Claude's status, as the room may read it. `quote: false` while the Sent to
 * Claude card is up: the card says the words, so the line under it does not.
 */
export function claudeWords(room, now, { quote = true } = {}) {
  const st = claudeState(room, now);
  return {
    key: st.key,
    headline: st.headline,
    // Sent to Claude (I9): beside an open ask the one line is what was sent, word for word; never a hidden send's.
    line: quote && st.key === 'sent' && st.sent && st.sent.text && !st.sent.hidden && st.sent.verb !== 'decided' ? (st.sent.plain ? st.sent.text : `\u201c${st.sent.text}\u201d`) : (st.line || ''),
    dur: st.doing && !st.doing.stale ? st.doing.dur : '',
    helperLine: st.helperLine || '',
  };
}

export function buildRoomData(room, current, now, card = null) {
  const whys = current && current.results && Array.isArray(current.results.whys) ? current.results.whys : [];
  const step = room && room.run ? runCurrentItem(room.run) : null;
  return {
    prompt: current ? current.prompt : '',
    detail: current ? current.detail : '',
    options: current ? (current.options || []) : [],
    whys: whys.map((w) => ({ label: w.label, text: w.text })),
    claude: claudeWords(room, now, { quote: !card }),
    step: step ? { k: step.k, text: step.text } : null,
    sent: card ? { text: card.text, pick: card.pick } : null,
  };
}

/** The room content for one Build Room screen. `card`: the Sent to Claude card (buildScreens sentCard), when it leads. */
export function buildRoomContent(moment, profile, room, current, now, card = null) {
  return roomContentFor(moment, profile, buildRoomData(room, current, now, card));
}
