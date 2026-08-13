/**
 * Pure logic behind the question-set editor.
 *
 * Everything here is deliberately free of React and of `authFetch` so it can be
 * tested directly — the admin surface sits behind an auth provider that makes a
 * render test of the editor impractical (same reasoning as config/gameSession).
 *
 * The three rules this file exists to protect:
 *
 * 1. The edit payload is a DIFF. A field the owner did not touch is omitted; a
 *    field they blanked is sent as ''. The backend guards on `!== undefined`,
 *    so flattening a blank to null is what used to make clearing a field a
 *    silent no-op.
 * 2. Deleting the ACTIVE version is refused (409) and has to say so in words —
 *    "delete failed" tells the owner nothing about the fix (promote first).
 * 3. Deleting a version a live engagement is pinned to comes back 200 with a
 *    warning and the game ids, NOT deleted. That is a question, not a result,
 *    and the ids have to reach the screen before anyone confirms.
 */

import { normalizeGameType } from '../config/gameTypes';
import { normalizeRoundKind, ROUND_KINDS } from '../config/roundKinds';

/**
 * Question-set fields the editor can change, and how to describe a change to
 * one of them in the save confirmation.
 *
 * The set editor used to report a bare "updated successfully" for every save,
 * including saves where the field the owner actually cared about was silently
 * discarded by the backend. Naming each landed change makes a no-op visible.
 */
export const EDITABLE_SET_FIELDS = {
  description: 'description',
  customInstruction: 'custom instructions',
  aiContextInstruction: 'AI context',
  promptId: 'AI summary prompt',
  engagementType: 'engagement type',
  roundNoun: 'round label',
  personaId: "Workie's voice",
  roundKind: 'round direction',
  roundKindBrief: 'custom direction'
};

export function describeSetChange(field, value) {
  const label = EDITABLE_SET_FIELDS[field] || field;
  if (!value) {
    if (field === 'promptId') return 'AI summary prompt reset to the game-type default';
    if (field === 'personaId') return "Workie's voice reset to adapting to the session";
    if (field === 'roundKind') return 'round direction reset to Produce';
    return `${label} cleared`;
  }
  // The stored value is an enum id; the operator picked a labelled card. Echo
  // the label back, or a save confirmation reads "round direction set to
  // \"judge\"" for something the screen called Judge.
  if (field === 'roundKind') return `round direction set to ${ROUND_KINDS[value]?.label || value}`;
  return `${label} set to "${value}"`;
}

/** One-line preview of a long free-text field for the set list. */
export function truncate(text, max = 90) {
  const value = String(text || '').trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

const trimmed = (value) => String(value ?? '').trim();

/**
 * The set as the editor found it. This is the baseline the save payload diffs
 * against, so it must be normalised exactly the way the form normalises its own
 * values — otherwise every open-and-save would report phantom changes.
 */
export function editableSnapshot(questionSet = {}) {
  return {
    description: trimmed(questionSet.description),
    customInstruction: trimmed(questionSet.customInstruction),
    aiContextInstruction: trimmed(questionSet.aiContextInstruction),
    promptId: trimmed(questionSet.promptId),
    engagementType: normalizeGameType(questionSet.engagementType),
    roundNoun: trimmed(questionSet.roundNoun),
    personaId: trimmed(questionSet.personaId),
    // Kept RAW, not resolved to `produce`. The save payload is a diff against
    // this snapshot, so resolving an absent value to a default here would make
    // every open-and-save of the ~41 sets that predate this field write a
    // direction nobody chose — the exact opposite of D1's "no migration".
    // An unrecognised stored value normalises to '' for the same reason a
    // reader treats it as produce: the form must not offer to re-save junk.
    roundKind: normalizeRoundKind(questionSet.roundKind) || '',
    roundKindBrief: trimmed(questionSet.roundKindBrief)
  };
}

/**
 * Build the PUT body for /admin/edit-question-set/{setId}.
 *
 * `name` always goes; every other field only when it differs from the snapshot.
 * An omitted key means "leave it alone", an empty string means "clear it".
 */
export function buildEditPayload(name, current, original = {}) {
  const changed = {};
  for (const field of Object.keys(EDITABLE_SET_FIELDS)) {
    if (current[field] !== (original[field] ?? '')) changed[field] = current[field];
  }
  return { name: trimmed(name), ...changed };
}

/** What actually landed, in the owner's words. `applied` comes from the backend. */
export function summarizeEditResult(name, applied = {}) {
  const summary = Object.keys(applied).map((f) => describeSetChange(f, applied[f]));
  return summary.length
    ? `Saved "${name}" — ${summary.join('; ')}.`
    : `Saved "${name}" — title only, no other fields changed.`;
}

/* ------------------------------------------------------------------ CSV --- */

/**
 * Quote-aware CSV reader. Naive `split(',')` mis-counts every set whose
 * questions contain a comma, which is most of them, and the replace preview is
 * worthless if its counts are wrong.
 */
export function parseCsv(text) {
  const source = String(text ?? '').replace(/\r\n?/g, '\n');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (inQuotes) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  row.push(field);
  rows.push(row);

  while (rows.length && rows[rows.length - 1].every((f) => f.trim() === '')) rows.pop();
  return rows;
}

/**
 * Counts for the replace preview: how many questions and how many distinct
 * categories the uploaded file will produce.
 */
export function summarizeCsv(text) {
  const rows = parseCsv(text);
  const empty = { headers: [], questionCount: 0, categoryCount: 0, categories: [] };

  if (!rows.length) return { ...empty, error: 'That file is empty.' };

  const headers = rows[0].map((h) => h.trim());
  const body = rows.slice(1).filter((r) => r.some((f) => f.trim() !== ''));
  if (!body.length) {
    return { ...empty, headers, error: 'That file has a header row but no questions.' };
  }

  const categoryIndex = headers.findIndex((h) => h.toLowerCase() === 'category');
  const categories = [];
  if (categoryIndex >= 0) {
    for (const r of body) {
      const value = (r[categoryIndex] || '').trim();
      if (value && !categories.includes(value)) categories.push(value);
    }
  }

  return {
    headers,
    questionCount: body.length,
    categoryCount: categories.length,
    categories,
    error: null,
    warning: categoryIndex < 0
      ? 'No Category column in this file — the server will decide how to group these questions.'
      : null
  };
}

function countLine(label, from, to) {
  const delta = to - from;
  const suffix = delta === 0 ? 'unchanged' : delta > 0 ? `${delta} more` : `${-delta} fewer`;
  return `${label}: ${from} → ${to} (${suffix})`;
}

/**
 * The "what will happen" lines shown BEFORE the flip.
 *
 * The owner's mental model is "the old questions get deleted". They are not —
 * the previous version stays and can be promoted back — and saying so plainly
 * is friendlier than the model they arrived with.
 */
export function describeReplacePlan(currentSet = {}, preview = {}, nextVersion) {
  const from = {
    questions: Number(currentSet.totalQuestions || 0),
    categories: Number(currentSet.categoryCount || 0)
  };
  const lines = [
    countLine('Questions', from.questions, Number(preview.questionCount || 0)),
    countLine('Categories', from.categories, Number(preview.categoryCount || 0))
  ];
  const label = nextVersion ? `version ${nextVersion}` : 'a new version';
  lines.push(
    `This writes ${label} and makes it the one new engagements use. `
    + 'The current version is kept and can be promoted back from the version list; '
    + 'engagements already in play stay on the version they started with.'
  );
  return lines;
}

/* -------------------------------------------------------------- versions --- */

/** Newest first, with the shape the panel renders. Tolerates a bare array or {versions:[]}. */
export function normalizeVersions(payload, activeVersion) {
  const list = Array.isArray(payload)
    ? payload
    : (payload && Array.isArray(payload.versions) ? payload.versions : []);

  return list
    .map((v) => {
      const version = Number(v.version);
      return {
        version,
        createdAt: v.createdAt || '',
        questionCount: Number(v.questionCount || 0),
        categoryCount: Number(v.categoryCount || 0),
        sourceFile: v.sourceFile || '',
        // The row's own flag wins, but fall back to the set's activeVersion so a
        // versions payload that omits isActive still marks something active.
        isActive: v.isActive === true || (activeVersion != null && version === Number(activeVersion)),
        pinnedByGames: Array.isArray(v.pinnedByGames) ? v.pinnedByGames : []
      };
    })
    .filter((v) => Number.isFinite(v.version))
    .sort((a, b) => b.version - a.version);
}

/** The highest version number seen, so the preview can name the version it will write. */
export function nextVersionNumber(versions = [], activeVersion) {
  const numbers = versions.map((v) => Number(v.version)).filter(Number.isFinite);
  if (activeVersion != null && Number.isFinite(Number(activeVersion))) numbers.push(Number(activeVersion));
  if (!numbers.length) return null;
  return Math.max(...numbers) + 1;
}

/**
 * Turn a DELETE /admin/question-sets/{id}/versions/{n} response into an outcome
 * the panel can act on.
 *
 *   409 { error, activeVersion }        -> 'refused'  (say how to fix it)
 *   200 { warning, pinnedByGames: [] }  -> 'confirm'  (name the games, then ask)
 *   200 { deleted: true }               -> 'deleted'
 */
export function interpretVersionDelete(version, status, body = {}) {
  const payload = body || {};

  if (status === 409) {
    const active = payload.activeVersion != null ? ` (v${payload.activeVersion})` : '';
    return {
      outcome: 'refused',
      pinnedByGames: [],
      message: `Version ${version} is the active version${active} and cannot be deleted. `
        + 'Promote another version first, then delete this one.'
    };
  }

  if (status >= 200 && status < 300) {
    const pinned = Array.isArray(payload.pinnedByGames) ? payload.pinnedByGames : [];
    if (payload.deleted === true) {
      return { outcome: 'deleted', pinnedByGames: [], message: `Version ${version} deleted.` };
    }
    if (payload.warning || pinned.length) {
      const count = pinned.length;
      const games = count ? ` (${pinned.join(', ')})` : '';
      return {
        outcome: 'confirm',
        pinnedByGames: pinned,
        message: payload.warning
          || `${count} engagement${count === 1 ? ' is' : 's are'} still playing version ${version}${games}. `
            + `Deleting it will break ${count === 1 ? 'that engagement' : 'them'} mid-session.`
      };
    }
    return { outcome: 'deleted', pinnedByGames: [], message: `Version ${version} deleted.` };
  }

  return {
    outcome: 'error',
    pinnedByGames: [],
    message: `Delete failed: ${payload.error || `HTTP ${status}`}`
  };
}

/** Tone for StatusMessage. Never inferred from the copy — see utils/statusTone. */
export function versionDeleteTone(outcome) {
  if (outcome === 'deleted') return 'success';
  if (outcome === 'confirm') return 'pending';
  return 'error';
}

/* -------------------------------------------------------------- prompts --- */

/**
 * Which AI prompts belong in a question set's "AI Summary Prompt" picker.
 *
 * The picker was listing every prompt in the table — 47 of them on engagedev —
 * for a set that can only use about seven. Two independent reasons a prompt
 * does not belong:
 *
 *   1. It is for a different game type. A trivia analysis prompt cannot say
 *      anything useful about a call-and-answer round.
 *   2. It is a GENERATION prompt. Those write questions; they can never drive a
 *      summary. `get-ai-summary.js` rejects them (no `template`, and no
 *      `instructions` + `outputFormat`) and silently falls back to the default,
 *      which is exactly the "I picked a prompt and nothing changed" symptom.
 *
 * Game type is compared through `normalizeGameType` because the table holds two
 * spellings — `callandanswer`/`polls` from the original seeds, `call-and-answer`
 * /`poll` from later ones. Comparing raw strings is why the upload dropdown has
 * never shown a single poll prompt.
 *
 * `summaryPromptStatus` is deliberately NOT used to exclude. Summary prompts are
 * metadata-only rows whose content lives in S3, so the list endpoint reports
 * `unknown` for them; filtering on it would empty the picker entirely. It is
 * only used to annotate a prompt already known to be unusable.
 */
export function selectableSummaryPrompts(prompts = [], engagementType) {
  const wanted = normalizeGameType(engagementType);
  return prompts.filter((p) => {
    if (!p || !p.promptId) return false;              // malformed rows: no usable value
    if (p.status && p.status !== 'active') return false;
    if (p.promptType === 'generation') return false;
    if (String(p.promptId).startsWith('gen-')) return false;
    const gt = normalizeGameType(p.gameType);
    return gt === wanted || p.gameType === 'all';
  });
}
