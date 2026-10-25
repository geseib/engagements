/**
 * WHAT THE SET IS ABOUT, AND ITS CATEGORIES, sent by every "Write N more"
 * builder (owner, 2026-10-25). The prompt side is tests/category-brief.js.
 */
import fs from 'fs';
import path from 'path';
import { appendCategoryContext } from '../utils/appendMode';

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'components', f), 'utf8');

describe('appendCategoryContext', () => {
  const appendTo = {
    setName: 'Q3 launch', mode: 'existing', categories: ['Planning', ' ', 'Support'],
    about: { title: 'Q3 launch', description: 'What went well.', aiContext: 'For support leads.' },
  };

  test('adding sends the set as it is, and its categories', () => {
    expect(appendCategoryContext(appendTo)).toEqual({
      aboutSet: { title: 'Q3 launch', description: 'What went well.', aiContext: 'For support leads.' },
      categories: ['Planning', 'Support'],
    });
  });

  // rejects: sending a new set's form-derived copy back as "what the set is about".
  test('making a new set sends nothing', () => {
    expect(appendCategoryContext(null)).toEqual({});
    expect(appendCategoryContext({})).toEqual({});
  });

  test('a set with no copy still sends its name and categories', () => {
    expect(appendCategoryContext({ setName: 'S', mode: 'new', categories: ['A'] }))
      .toEqual({ aboutSet: { title: 'S', description: '', aiContext: '' }, categories: ['A'] });
  });

  test('all three builders send it', () => {
    for (const f of ['TriviaAIBuilder.jsx', 'PollAIBuilder.jsx', 'AIScenarioBuilder.jsx']) {
      expect(read(f)).toMatch(/\.\.\.appendCategoryContext\(appendTo\)/);
    }
  });

  // rejects: the poll builder's one category contradicted by "use ONLY these
  // categories … spread evenly", which is the trivia builder's requirement.
  test('the poll builder does not add the spread-evenly requirement to its one category', () => {
    expect(read('PollAIBuilder.jsx')).toMatch(/appendsToExisting\(appendTo\)\s*\?\s*String\(pollConfig\.customPrompt/);
  });

  test('QuestionsPanel hands the builders the set\'s own copy', () => {
    expect(read('QuestionsPanel.jsx')).toMatch(/about: \{\s*title: questionSet\?\.name/);
  });
});
