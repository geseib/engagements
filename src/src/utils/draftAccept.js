/**
 * ACCEPTING A DRAFT INTO AN EXISTING SET — the editor's own merge, run from
 * the review screen.
 *
 * The rows that join a set go through exactly what QuestionsPanel's
 * `acceptGenerated` does: the set's live questions are read, the kept items
 * become rows (`rowsFromItems`), strays are re-filed into the set's categories
 * or kept as new ones (`holdToMode`), and the WHOLE working copy is written
 * back as one new version through the importer's replace. One writer of a
 * set's CSV, the one the round-trip tests guard — the server deliberately has
 * no second one (admin/generation-drafts.js header).
 *
 * The server brackets it: CLAIM (once — a double click claims once, and the
 * accept is audited before anything is written), then the save here, then
 * COMPLETE with the version the save made — or RELEASE when the save failed,
 * and the draft is back for review with nothing changed.
 */
import { authFetch } from '../auth/authFetch';
import {
  claimAppendDraft, completeAppendDraft, releaseAppendDraft, libraryHeaders,
} from './draftsApi';
import { ADD_MODES, rowsFromItems, holdToMode } from './addQuestions';
import {
  editableRows, rowsToCsv, workingCopyProblems, summarizeRowChanges,
} from './questionRows';
import { parseUpgradeRequired } from './upgradeRequired';

const apiBase = () => (typeof window !== 'undefined' && window.API_BASE) || '';

/**
 * @returns {Promise<{ok: true, version, previousVersion, kept, left}
 *                  | {ok: false, error, planLimit?}>}
 */
export async function acceptIntoSet(draft, libraryKey) {
  const claim = await claimAppendDraft(draft.draftId, libraryKey);
  if (!claim.ok) return { ok: false, error: claim.data.error || `The accept was refused (HTTP ${claim.status}).` };

  const release = async (error, extra = {}) => {
    try { await releaseAppendDraft(draft.draftId, libraryKey); } catch (e) { /* the claim goes stale in five minutes */ }
    return { ok: false, error, ...extra };
  };

  try {
    const type = draft.engagementType;
    const res = await authFetch(`${apiBase()}question-sets/${encodeURIComponent(draft.targetSetId)}/questions`, {
      headers: libraryHeaders(libraryKey),
    });
    if (!res.ok) return release(`The set's questions could not be read (HTTP ${res.status}). Nothing was changed.`);
    const rows = editableRows(await res.json(), type);
    const baselineOrder = rows.map((r) => r.uid);
    const incoming = rowsFromItems((claim.data.items || []).map((it) => it.item));
    const mode = draft.appendMode === 'new' ? ADD_MODES.NEW : ADD_MODES.EXISTING;
    const held = holdToMode(incoming, rows, mode, { spread: true });
    if (!held.kept.length) return release('None of the kept questions could be added to this set. Nothing was changed.');
    const nextRows = [...rows, ...held.kept];
    const problems = workingCopyProblems(nextRows, type);
    if (problems.length) {
      return release(`${problems.length} question${problems.length === 1 ? '' : 's'} cannot be saved yet: `
        + problems.slice(0, 3).map((p) => `"${p.title || 'untitled'}" ${p.problems.join(' and ')}`).join('; ')
        + '. Edit or leave them out, then accept again.');
    }
    const summary = summarizeRowChanges(nextRows, baselineOrder);
    const left = (Number(claim.data.left) || 0) + held.dropped.length;
    const save = await authFetch(`${apiBase()}admin/upload-questions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...libraryHeaders(libraryKey) },
      body: JSON.stringify({
        replaceSetId: draft.targetSetId,
        fileName: 'ai-draft-accept.csv',
        fileContent: rowsToCsv(nextRows, type, { renumber: summary.reordered }),
        engagementType: type,
        versionNote: `AI: ${held.kept.length} added from a reviewed draft${left ? `, ${left} left out` : ''}.`,
      }),
    });
    const result = await save.json().catch(() => ({}));
    if (!save.ok) {
      const planLimit = parseUpgradeRequired(save.status, result);
      return release(result.error || `The save failed (HTTP ${save.status}). Nothing was changed.`, planLimit ? { planLimit } : {});
    }
    const previousVersion = claim.data.activeVersion ?? null;
    await completeAppendDraft(draft.draftId, {
      version: result.version ?? null, previousVersion, kept: held.kept.length, left,
    }, libraryKey);
    return {
      ok: true, version: result.version ?? null, previousVersion, kept: held.kept.length, left,
      questionCount: result.questionCount ?? null,
    };
  } catch (error) {
    return release(`The accept did not finish: ${error.message}. Nothing was changed.`);
  }
}

/** Switch the set back to the version before this accept (the draft's own undo). */
export async function undoAccept(draftId, libraryKey) {
  const res = await authFetch(`${apiBase()}admin/generation-drafts/${encodeURIComponent(draftId)}/undo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...libraryHeaders(libraryKey) },
    body: '{}',
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}
