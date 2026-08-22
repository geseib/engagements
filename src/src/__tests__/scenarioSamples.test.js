/**
 * The sample-idea deck behind the scenario builder's first step
 * (config/scenarioSamples.js). The cards are the teaching device for what
 * each round kind means, so the deck's shape is a contract: every teachable
 * kind covered, every sample concrete enough to prefill a form, and nothing
 * in them that the prompt guards would refuse downstream.
 */
import { SCENARIO_SAMPLES, samplesForKind } from '../config/scenarioSamples';
import { ROUND_KIND_IDS } from '../config/roundKinds';

// The hardcoded call-and-answer scenario-type ids in AIScenarioBuilder.jsx —
// a sample naming anything else selects a template that does not exist and
// falls to the bare-custom defaults, silently.
const CA_TEMPLATE_IDS = [
  'lessons-learned', 'problem-solving', 'interview-prep',
  'amazon-principles', 'team-building', 'custom',
];

describe('the sample deck', () => {
  test('every named kind teaches with at least three samples; custom teaches with none', () => {
    // rejects: a kind whose card row is one lonely idea, and rejects handing
    // our ideas to an operator who just wrote their own direction.
    for (const kind of ROUND_KIND_IDS) {
      if (kind === 'custom') {
        expect(samplesForKind(kind)).toEqual([]);
      } else {
        expect(samplesForKind(kind).length).toBeGreaterThanOrEqual(3);
      }
    }
  });

  test('unknown kinds get an empty deck, not a crash', () => {
    expect(samplesForKind('banana')).toEqual([]);
    expect(samplesForKind(undefined)).toEqual([]);
  });

  test('every sample is complete, unique, and names a real template', () => {
    const ids = new Set();
    for (const samples of Object.values(SCENARIO_SAMPLES)) {
      for (const s of samples) {
        expect(ids.has(s.id)).toBe(false);
        ids.add(s.id);
        expect(s.title.trim().length).toBeGreaterThan(0);
        expect(s.description.trim().length).toBeGreaterThan(0);
        // The context is the prefill — it has to be a real brief, not a stub.
        expect(s.context.trim().length).toBeGreaterThan(60);
        expect(CA_TEMPLATE_IDS).toContain(s.templateId);
      }
    }
  });

  test('no sample smuggles the bracket-placeholder defect into a generated set', () => {
    // rejects: sample briefs written in the [placeholder] style the save
    // guards exist to refuse — the prefill must model the clean form.
    for (const samples of Object.values(SCENARIO_SAMPLES)) {
      for (const s of samples) {
        expect(s.context).not.toMatch(/\[[^\]]+\]/);
        expect(s.description).not.toMatch(/\[[^\]]+\]/);
      }
    }
  });
});
