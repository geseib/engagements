/**
 * READY QUESTIONS FOR CLAUDE (docs/superpowers/plans/2026-10-22-build-room-question-sets.md,
 * step 4; owner 22 Oct: "different questions for a training site, vs a game,
 * vs a paper"). Claude cannot read the team's question sets; the host's page
 * can. Once the room has said what it is making, the page hands the matching
 * sets' askable questions to the room (POST build/ready), and Claude's
 * room_status lists them by section.
 *
 * Which sets: those tagged for the kind, else the general ones (no for- tag),
 * at most three, as the library orders them. Only questions a Build Room can
 * ask (buildAskFromQuestion), in the set's order.
 */
import { useEffect, useRef } from 'react';
import {
  isBuildRoomSet, buildAskFromQuestion, rankSetsForKind,
} from './readyQuestions';
import { editableRows } from '../utils/questionRows';

export const READY_SETS = 3;
export const READY_QUESTIONS = 40;

/** The sets to hand over for this kind: its own, or else the general ones. */
export function setsForClaude(sets, kind) {
  const ready = (sets || []).filter((st) => isBuildRoomSet(st) && ['call-and-answer', 'poll'].includes(st.engagementType));
  const r = rankSetsForKind(ready, kind);
  return (r.first.length ? r.first : r.general).slice(0, READY_SETS);
}

/** One set's rows as the questions Claude reads: `{ kind, prompt, category, options? }`. */
export function questionsForClaude(payload, set) {
  return editableRows(payload, set.engagementType)
    .map((row) => ({ row, out: buildAskFromQuestion(row, set) }))
    .filter((x) => x.out.ask)
    .map(({ row, out }) => ({
      kind: out.ask.kind,
      prompt: out.ask.prompt,
      category: String(row.category || ''),
      ...(out.ask.kind === 'choice' ? { options: out.ask.options.map((o) => o.title) } : {}),
    }));
}

/** The body for POST build/ready, capped as the server caps it. */
export async function readyBody(api, kind) {
  const sets = setsForClaude(await api.questionSets(), kind);
  let left = READY_QUESTIONS;
  const out = [];
  for (const set of sets) {
    if (left <= 0) break;
    const questions = questionsForClaude(await api.setQuestions(set), set).slice(0, left);
    left -= questions.length;
    if (questions.length) out.push({ name: set.name || 'Ready questions', questions });
  }
  return { kind, sets: out };
}

/**
 * The host page's hook: once per kind, after the room has a kind and the
 * server's copy is for another kind (or none), hand them over. Quiet on
 * failure: Claude simply has no ready questions.
 */
export function useReadyForClaude(room, api, { ended = false } = {}) {
  const kind = (room && room.buildKind) || '';
  const have = (room && room.ready && room.ready.kind) || '';
  const sent = useRef('');
  useEffect(() => {
    if (!kind || ended || !api || !api.saveReady || !api.questionSets || have === kind || sent.current === kind) return undefined;
    sent.current = kind;
    let live = true;
    readyBody(api, kind)
      .then((body) => (live ? api.saveReady(body) : null))
      .catch(() => { sent.current = ''; });
    return () => { live = false; };
  }, [kind, have, ended, api]);
}
