/**
 * THE TWO KEYWORD CLASSIFIERS AGREE — the server's (which answers for an AI
 * draft when the model names no topic) and the browser's (which pre-selects a
 * topic for an unfiled set being switched on in the set list).
 *
 * rejects: the set list pre-selecting one topic for a set whose AI draft was
 * suggested another; a keyword added on one side only; a client answer that is
 * not on the shelf.
 */
import * as client from '../config/topicKeywords';
import { SET_TOPIC_IDS } from '../config/setTopics';

// eslint-disable-next-line global-require
const server = require('../../../lambda-functions/admin/shared/topic-keywords.js');

const FIXTURES = [
  { title: 'Renaissance painters', description: 'Museums and galleries of Europe' },
  { title: 'Team retrospective', description: 'How our project went' },
  { title: 'Household habits' },
  { title: 'Oscar winning movies' },
  { title: 'World cuisine', description: 'Recipes, chefs and a little wine' },
  { title: 'Capital cities' },
  { title: 'Mental health at work', description: 'Sleep, stress and burnout' },
  { title: 'Ancient Egypt' },
  { title: 'Shakespeare and his poetry' },
  { title: 'Jazz albums' },
  { title: 'Climate change' },
  { title: 'How elections work' },
  { title: 'Machine learning basics' },
  { title: 'World Cup football' },
  { title: 'Song football' }, // a tie
  { title: 'Zxq', description: 'AI-generated scenarios for detailed difficulty level.' }, // nothing scores
  { title: 'Friday quiz', questions: [{ title: 'Which planet is largest?', tags: ['space'] }, 'Who wrote Hamlet?'] },
  {},
];

describe('topic keyword parity', () => {
  test('the keyword tables are the same', () => {
    expect(client.TOPIC_KEYWORDS).toEqual(server.TOPIC_KEYWORDS);
    expect(client.TIE_ORDER).toEqual(server.TIE_ORDER);
    expect(client.FALLBACK_TOPIC).toBe(server.FALLBACK_TOPIC);
  });

  test.each(FIXTURES.map((f) => [f.title || '(empty)', f]))('%s → the same topic on both sides', (_, set) => {
    const mine = client.classifySetTopic(set);
    expect(mine).toBe(server.classifySetTopic(set));
    expect(client.scoreSetTopics(set)).toEqual(server.scoreSetTopics(set));
    expect(SET_TOPIC_IDS).toContain(mine);
  });
});
