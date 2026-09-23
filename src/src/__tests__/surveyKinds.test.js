import {
  SURVEY_KINDS,
  SURVEY_CATEGORY,
  surveyKindMeta,
  kindLabel,
  previewLine,
  convertKind,
  defaultsFor,
  estimateMinutes,
} from '../config/surveyKinds';
import { ICONS } from '../components/Icon';

/*
 * The browser's vocabulary for the five survey question kinds.
 * Contract: docs/design/survey-redesign/IMPLEMENTATION-phase-0-1.md ("THE CONTRACT").
 */

describe('SURVEY_KINDS', () => {
  test('lists the five kinds in the order the Add menu shows them', () => {
    expect(SURVEY_KINDS.map((k) => k.id)).toEqual(['rating', 'choice', 'yesno', 'rank', 'text']);
  });

  test('every kind has a label, a one-sentence blurb and an icon the Icon wrapper really has', () => {
    for (const k of SURVEY_KINDS) {
      expect(k.label).toBeTruthy();
      expect(k.blurb).toMatch(/\.$|”$/);
      expect(ICONS[k.icon]).toBeDefined();
    }
  });

  test('every survey row is filed under one category, because the importer needs one', () => {
    expect(SURVEY_CATEGORY).toBe('Survey');
  });

  test('an unknown kind reads as an open answer rather than crashing', () => {
    expect(surveyKindMeta('nonsense').id).toBe('text');
    expect(surveyKindMeta('choice').label).toBe('Multiple choice');
  });
});

describe('kindLabel', () => {
  test('a 0–10 rating is named for what it is', () => {
    expect(kindLabel({ kind: 'rating', scale: '0-10' })).toBe('Rating 0–10');
    expect(kindLabel({ kind: 'rating', scale: '1-5' })).toBe('Rating');
    expect(kindLabel({ kind: 'yesno' })).toBe('Yes / No');
  });
});

describe('previewLine — the one line under each question in the editor', () => {
  test('rating shows the range and its end labels', () => {
    expect(previewLine({ kind: 'rating', scale: '1-5', lowLabel: 'Not useful', highLabel: 'Very useful' }))
      .toBe('1–5 · Not useful → Very useful');
  });

  test('rating without labels shows the range only; 0–10 says it is a recommend score; stars say stars', () => {
    expect(previewLine({ kind: 'rating', scale: '1-10' })).toBe('1–10');
    expect(previewLine({ kind: 'rating', scale: '0-10' })).toBe('0–10 · recommend score');
    expect(previewLine({ kind: 'rating', scale: 'stars' })).toBe('1–5 stars');
  });

  test('choice counts options and states the picking rule', () => {
    expect(previewLine({ kind: 'choice', options: ['a', 'b', 'c', 'd'], allowMultiple: false }))
      .toBe('4 options · pick one');
    expect(previewLine({ kind: 'choice', options: ['a', 'b', 'c', 'd'], allowMultiple: true, maxPicks: 2, allowOther: true }))
      .toBe('4 options · pick up to 2 · + write-in');
    expect(previewLine({ kind: 'choice', options: ['a', 'b', 'c'], allowMultiple: true, maxPicks: null }))
      .toBe('3 options · pick any');
  });

  test('yes/no names its answers, Not sure, and when it asks why', () => {
    expect(previewLine({ kind: 'yesno', unsure: true, followUpWhen: 'no', followUpPrompt: 'Why not?' }))
      .toBe('Yes / No / Not sure · asks why on No');
    expect(previewLine({ kind: 'yesno', yesLabel: 'Keep it', noLabel: 'Drop it', followUpWhen: 'any', followUpPrompt: 'Why?' }))
      .toBe('Keep it / Drop it · asks why either way');
    expect(previewLine({ kind: 'yesno' })).toBe('Yes / No');
  });

  test('rank counts items and says how much ranking is asked for', () => {
    expect(previewLine({ kind: 'rank', options: ['a', 'b', 'c', 'd', 'e'], rankTop: 3 })).toBe('5 items · top 3 is enough');
    expect(previewLine({ kind: 'rank', options: ['a', 'b', 'c'], rankTop: null })).toBe('3 items · rank all');
  });

  test('open answer states its length and limit', () => {
    expect(previewLine({ kind: 'text', textLength: 'long', maxLength: 500 })).toBe('Long answer · up to 500 characters');
    expect(previewLine({ kind: 'text', textLength: 'short', maxLength: 280 })).toBe('Short answer · up to 280 characters');
  });
});

describe('defaultsFor', () => {
  test('matches the contract table', () => {
    expect(defaultsFor('rating')).toEqual({ kind: 'rating', required: false, scale: '1-5', lowLabel: '', highLabel: '' });
    expect(defaultsFor('choice')).toEqual({
      kind: 'choice', required: false, options: ['', ''], allowMultiple: false, maxPicks: null, allowOther: false, shuffle: false,
    });
    expect(defaultsFor('yesno')).toEqual({
      kind: 'yesno', required: false, yesLabel: '', noLabel: '', unsure: false, followUpWhen: '', followUpPrompt: '',
    });
    expect(defaultsFor('rank')).toEqual({ kind: 'rank', required: false, options: ['', '', ''], rankTop: null });
    expect(defaultsFor('text')).toEqual({
      kind: 'text', required: false, textLength: 'long', maxLength: 500, placeholder: '', themes: true,
    });
  });
});

describe('convertKind — switching a question to another kind', () => {
  const choice = { title: 'Best part?', kind: 'choice', options: ['Demo', 'Q&A', 'Stories'], allowMultiple: true, maxPicks: 2, allowOther: true, shuffle: true };

  test('choice → rank keeps the list and loses only choice-only settings, which it names', () => {
    const { row, loses } = convertKind(choice, 'rank');
    expect(row.kind).toBe('rank');
    expect(row.options).toEqual(['Demo', 'Q&A', 'Stories']);
    expect(row.title).toBe('Best part?');
    expect(row.allowMultiple).toBeUndefined();
    expect(loses).toEqual(['pick up to 2', 'the write-in box', 'shuffling']);
  });

  test('choice → rank with a plain list loses nothing, so it switches without asking', () => {
    const { loses } = convertKind({ kind: 'choice', options: ['a', 'b', 'c'], allowMultiple: false }, 'rank');
    expect(loses).toEqual([]);
  });

  test('rank → choice keeps the list', () => {
    const { row, loses } = convertKind({ kind: 'rank', options: ['a', 'b', 'c', 'd'], rankTop: null }, 'choice');
    expect(row.options).toEqual(['a', 'b', 'c', 'd']);
    expect(row.allowMultiple).toBe(false);
    expect(loses).toEqual([]);
  });

  test('choice with eight options → rank keeps seven and names the one it drops', () => {
    const eight = { kind: 'choice', options: ['1', '2', '3', '4', '5', '6', '7', '8'] };
    const { row, loses } = convertKind(eight, 'rank');
    expect(row.options).toHaveLength(7);
    expect(loses).toEqual(['option “8”']);
  });

  test('rating → open answer loses the filled labels, named, and takes the text defaults', () => {
    const { row, loses } = convertKind({ kind: 'rating', scale: '1-10', lowLabel: 'Low', highLabel: '' }, 'text');
    expect(row).toMatchObject({ kind: 'text', textLength: 'long', maxLength: 500, themes: true });
    expect(row.scale).toBeUndefined();
    expect(loses).toEqual(['the 1–10 scale', 'the label “Low”']);
  });

  test('a default rating (1–5, no labels) switches without asking', () => {
    expect(convertKind({ kind: 'rating', scale: '1-5', lowLabel: '', highLabel: '' }, 'yesno').loses).toEqual([]);
  });

  test('switching to the kind it already is changes nothing', () => {
    const { row, loses } = convertKind(choice, 'choice');
    expect(row).toEqual(choice);
    expect(loses).toEqual([]);
  });

  test('required survives every switch', () => {
    expect(convertKind({ kind: 'text', required: true }, 'rating').row.required).toBe(true);
  });
});

describe('estimateMinutes', () => {
  test('about 20 seconds a question, a minute for each open answer, rounded up', () => {
    expect(estimateMinutes([{ kind: 'rating' }, { kind: 'choice' }, { kind: 'text' }])).toBe(2);
    expect(estimateMinutes([])).toBe(0);
    expect(estimateMinutes(new Array(8).fill({ kind: 'rating' }))).toBe(3);
  });
});

describe('convertKind names an open answer\'s settings when it drops them (review finding)', () => {
  test('a short answer, a custom limit and themes off are named', () => {
    const { loses } = convertKind({ kind: 'text', textLength: 'short', maxLength: 140, placeholder: '', themes: false }, 'rating');
    expect(loses).toEqual(['a short answer', 'the 140-character limit', 'leaving it out of Workie’s themes']);
  });
  test('a default open answer still switches without asking', () => {
    expect(convertKind({ kind: 'text', textLength: 'long', maxLength: 500, placeholder: '', themes: true }, 'yesno').loses).toEqual([]);
    expect(convertKind({ kind: 'text', textLength: 'short', maxLength: 280, themes: true }, 'yesno').loses).toEqual(['a short answer']);
  });
});
