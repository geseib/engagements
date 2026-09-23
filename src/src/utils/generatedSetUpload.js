/**
 * UPLOAD WHAT AN AI BUILDER MADE, WHEN THE WORKER COULD NOT MAKE THE SET.
 *
 * A finished generation normally arrives with `createdSet`: the worker made the
 * draft itself (admin/shared/generated-set.js) and the page only opens it. When
 * the worker could NOT (the organisation is at its stored-set allowance, or
 * the job predates server-side creation), the builder hands its page the kept
 * items and the metadata instead, and the PAGE has to make the set through
 * /admin/upload-questions.
 *
 * ONE PATH, TWO PAGES. This lived inside AdminPage as four handlers and three
 * CSV writers. The host shelf (HostQuestionSetsDialog) mounts the same four
 * builders but could not reach any of it, so on this path it closed the
 * builder and saved nothing. By then the builder had forgotten its job, so
 * nothing was left to go back to. Both pages call `uploadGeneratedSet` now,
 * and neither owns a copy.
 *
 * Nothing here draws. It returns the notice each page renders in its own style:
 * `{ text, tone }` for a sentence, or `{ limit, outcome, tone }` for the
 * plan-limit notice (22-plan-limit-notice.html), which both pages render with
 * PlanLimitNotice.
 */
import { authFetch } from '../auth/authFetch';
import { adminApiUrl } from './adminApi';
import { parseUpgradeRequired } from './upgradeRequired';
import { tagsToCsvCell } from './tags';
import { csvRow, buildCsv, optionsToCsvCell, allowMultipleToCsvCell } from './csv';
import { surveyItemsToCsv } from './surveyDraft';

/** Items grouped by category, in first-seen order: the importer numbers per category. */
function byCategory(items, fallback) {
  const groups = {};
  items.forEach((item) => {
    const category = item.category || fallback;
    if (!groups[category]) groups[category] = [];
    groups[category].push(item);
  });
  return groups;
}

function scenariosToCsv(scenarios) {
  const headers = 'Category,Question#,Title,Detail_lesson,School,CustomInstruction,Tags';
  const rows = [];
  const groups = byCategory(scenarios, 'AI Generated');
  Object.keys(groups).forEach((category) => {
    groups[category].forEach((scenario, index) => {
      rows.push(csvRow([
        category,
        index + 1, // category-relative numbering: 1, 2, 3 for each category
        scenario.title,
        scenario.detail,
        scenario.school || 'Professional Development',
        scenario.customInstructions || '',
        tagsToCsvCell(scenario.tags),
      ]));
    });
  });
  return buildCsv(headers, rows);
}

function triviaToCsv(questions) {
  const headers = 'Category,Question#,Title,QuestionDetail,AnswerDetails,School,OptionA,OptionB,OptionC,OptionD,OptionE,OptionF,CorrectAnswer,Difficulty,Tags';
  const rows = [];
  const groups = byCategory(questions, 'General');
  Object.keys(groups).forEach((category) => {
    groups[category].forEach((trivia, index) => {
      // Kept as OptionA-style names; upload-questions.js resolves them.
      const correctAnswer = Array.isArray(trivia.correctAnswer) ? trivia.correctAnswer.join(',') : trivia.correctAnswer;
      rows.push(csvRow([
        category,
        index + 1,
        trivia.title,
        trivia.questionDetail || trivia.detail || '',
        trivia.answerDetails || '',
        trivia.school || 'General',
        trivia.optionA || '',
        trivia.optionB || '',
        trivia.optionC || '',
        trivia.optionD || '',
        trivia.optionE || '',
        trivia.optionF || '',
        correctAnswer,
        trivia.difficulty,
        tagsToCsvCell(trivia.tags),
      ]));
    });
  });
  return buildCsv(headers, rows);
}

function pollsToCsv(questions) {
  // ONE `Options` column, pipe-separated — see optionsToCsvCell(). This used
  // to emit Option1..Option5, which upload-questions.js does not read and has
  // no fallback for, so every AI-generated poll set imported with zero
  // options. Do not "restore" the numbered columns.
  const headers = 'Category,Question#,Title,Detail_lesson,School,CustomInstruction,Options,AllowMultiple,Tags';
  const rows = [];
  const groups = byCategory(questions, 'General');
  Object.keys(groups).forEach((category) => {
    groups[category].forEach((poll, index) => {
      rows.push(csvRow([
        category,
        index + 1,
        poll.title,
        poll.detail || '',
        poll.school || 'General',
        poll.customInstructions || '',
        optionsToCsvCell(poll.options),
        allowMultipleToCsvCell(poll.allowMultiple),
        tagsToCsvCell(poll.tags),
      ]));
    });
  });
  return buildCsv(headers, rows);
}

/*
  WHAT DIFFERS BY BUILDER, and nothing else does.

  `items`      the key the builder hands its kept items over under.
  `type`       the engagement type the set is imported as. Scenario has none of
               its own: it is the builder for call-and-answer and for every
               format without a builder, so the caller says which.
  `direction`  whether the round direction (roundKind/roundKindBrief) travels.
               Only the scenario and poll builders have a direction picker.
  `instructions` whether the set-level instructions travel. The survey builder
               writes none, and the console never sent them for a survey.
*/
const KINDS = {
  scenario: {
    items: 'scenarios', toCsv: scenariosToCsv, type: null, direction: true, instructions: true,
    processing: 'Processing AI-generated scenarios…', created: 'question set created',
  },
  trivia: {
    items: 'questions', toCsv: triviaToCsv, type: 'trivia', direction: false, instructions: true,
    processing: 'Processing AI-generated trivia questions…', created: 'trivia set created',
  },
  poll: {
    items: 'questions', toCsv: pollsToCsv, type: 'poll', direction: true, instructions: true,
    processing: 'Processing AI-generated poll questions…', created: 'poll set created',
  },
  survey: {
    // The survey branch of the one CSV contract (surveyDraft.js → rowsToCsv).
    items: 'questions', toCsv: surveyItemsToCsv, type: 'survey', direction: false, instructions: false,
    processing: 'Processing AI-generated survey questions…', created: 'draft survey created',
  },
};

function kindOf(kind) {
  const spec = KINDS[kind];
  if (!spec) throw new Error(`Unknown builder kind: ${kind}`);
  return spec;
}

/** The CSV the importer reads, for one builder's kept items. */
export function generatedSetCsv(kind, items) {
  return kindOf(kind).toCsv(items || []);
}

/**
 * The /admin/upload-questions body for what a builder handed over.
 *
 * @param {'scenario'|'trivia'|'poll'|'survey'} kind which builder made it
 * @param {object} data the builder's hand-over: `{ scenarios | questions, metadata, roundKind?, roundKindBrief? }`
 * @param {{engagementType?: string, now?: number}} [options]
 *   engagementType  the format a SCENARIO set is imported as (the others are fixed)
 */
export function generatedSetUploadBody(kind, data, { engagementType = 'call-and-answer', now = Date.now() } = {}) {
  const spec = kindOf(kind);
  const { metadata, roundKind, roundKindBrief } = data;
  return {
    fileName: `${metadata.title.replace(/[^a-zA-Z0-9]/g, '_')}-${now}.csv`,
    fileContent: generatedSetCsv(kind, data[spec.items]),
    customTitle: metadata.title,
    customDescription: metadata.description,
    ...(spec.instructions ? {
      customInstructions: metadata.customInstructions,
      aiContextInstructions: metadata.aiContextInstructions,
    } : {}),
    engagementType: spec.type || engagementType,
    // The direction travels with the set, or it steers one generation and is
    // then forgotten: the library, the editor and every regeneration would
    // read the set as Produce. An unset one is OMITTED, not sent empty —
    // upload-questions.js stores it only when non-empty.
    ...(spec.direction && roundKind ? { roundKind } : {}),
    ...(spec.direction && roundKindBrief ? { roundKindBrief } : {}),
    isAIGenerated: true,
  };
}

/** What the page says while the upload is in flight. */
export function generatedSetPendingNotice(kind) {
  return { text: kindOf(kind).processing, tone: 'pending' };
}

/**
 * Make the set from what the builder handed over. Never throws.
 *
 * @returns {Promise<
 *   { ok: true,  notice: {text, tone} } |
 *   { ok: false, limit: object, notice: {limit, outcome, tone} } |
 *   { ok: false, notice: {text, tone} }
 * >}
 *   `limit` is set only on a plan-limit refusal. The console keeps it for the
 *   Billing section. `notice` is ready for either page to render.
 */
export async function uploadGeneratedSet(kind, data, { engagementType } = {}) {
  try {
    const response = await authFetch(adminApiUrl('admin/upload-questions'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(generatedSetUploadBody(kind, data, { engagementType })),
    });
    const result = await response.json();

    if (response.ok) {
      return {
        ok: true,
        notice: { text: `${result.message} — ${kindOf(kind).created}. Open it from the list to review it.`, tone: 'success' },
      };
    }
    // A 402 is a plan fact, not an upload fault. It is said as the plan-limit
    // notice: what ran out, and what this reader can do about it. It used to
    // be text ending "Open Plan & usage to request the Team plan", with no
    // link, shown to people who may not request.
    const limit = parseUpgradeRequired(response, result);
    if (limit) {
      return { ok: false, limit, notice: { limit, outcome: 'Nothing was saved.', tone: 'error' } };
    }
    return { ok: false, notice: { text: `Upload failed: ${result.error || 'Unknown error'}`, tone: 'error' } };
  } catch (error) {
    console.error('Upload error:', error);
    return { ok: false, notice: { text: `Upload failed: ${error.message}`, tone: 'error' } };
  }
}
