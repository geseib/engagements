const { SURVEY_CATEGORY, itemsToSurveyCsv } = require('./shared/survey-kinds');

/*
  SURVEY TEMPLATES, as contract-shaped items (shared/survey-kinds.js). Each is a
  starting point a person downloads, edits and imports — or that the New set
  dialog's "A template" route offers (docs/design/survey-redesign mockup 01).
  They mix kinds on purpose, so every template also shows what the kinds look
  like in the CSV. tests/survey-upload.js imports every one of them and requires
  zero skipped rows.
*/

/** The default: one question of every kind, in the Add-menu order. */
const EVERY_KIND_TEMPLATE = [
  { kind: 'rating', title: 'How useful was this session for your work?', required: true, scale: '1-5', lowLabel: 'Not useful', highLabel: 'Very useful', tags: ['usefulness'] },
  { kind: 'choice', title: 'Which part was most valuable to you?', options: ['The live demo', 'The case studies', 'The Q&A'], allowOther: true, tags: ['content'] },
  { kind: 'yesno', title: 'Was the length about right?', required: true, unsure: true, followUpWhen: 'no', followUpPrompt: 'What would you cut or add?', tags: ['format'] },
  { kind: 'rank', title: 'Rank these topics for next time', options: ['Customer stories', 'Product roadmap', 'Team wins', 'Culture & hiring'], rankTop: 2, tags: ['topics'] },
  { kind: 'text', title: 'What would you like to see added or changed?', textLength: 'long', placeholder: 'A sentence or two is plenty.', tags: ['suggestions'] },
];

/*
  THE POLL TEMPLATE: one question of each kind a poll may be, in the order the
  kinds are offered (POLL_KINDS), each in a category of its own — a poll keeps
  its categories, which is what lets a host switch a group of questions off.
  The yes/no uses Approve / Decline rather than the default Yes / No, so the
  template also shows that a binary question's two answers can be renamed.
  tests/survey-upload.js imports it and requires zero skipped rows.
*/
const POLL_TEMPLATE = [
  { kind: 'choice', category: 'Workplace', title: 'Where do you do your best work?', detail: 'Pick the one that is true most weeks.', options: ['In the office', 'At home', 'A mix of both', 'Somewhere else entirely'], tags: ['workplace'] },
  { kind: 'rating', category: 'Meetings', title: 'How useful was this week’s team meeting?', scale: '1-5', lowLabel: 'A waste of time', highLabel: 'Worth every minute', tags: ['meetings'] },
  { kind: 'yesno', category: 'Decisions', title: 'Should we move the release to Thursday?', detail: 'It gives QA one more day; support covers Friday.', yesLabel: 'Approve', noLabel: 'Decline', tags: ['release'] },
  { kind: 'text', category: 'Ideas', title: 'In a few words: what should we stop doing?', textLength: 'short', maxLength: 280, tags: ['ideas'] },
];

const SURVEY_TEMPLATES = Object.freeze({
  // THE MOCKUPS' SURVEY — docs/design/survey-redesign/_src/content.py, the one
  // every screen in that folder draws, so the template a person starts from is
  // the survey they were shown. Its answer lists are that talk's, which is the
  // point of a template: replace them with yours.
  'presentation-feedback': [
    { kind: 'rating', title: 'How useful was today’s session for your work?', required: true, scale: '1-5', lowLabel: 'Not useful', highLabel: 'Very useful' },
    { kind: 'rating', title: 'How likely are you to recommend this session to a colleague?', scale: '0-10', lowLabel: 'Not at all likely', highLabel: 'Extremely likely' },
    { kind: 'choice', title: 'Which part of the presentation was most valuable to you?', required: true, options: ['Live demo of the new console', 'The three customer case studies, with their renewal numbers', 'Pricing roadmap for FY27', 'The open Q&A', 'Hiring plan update'] },
    { kind: 'choice', title: 'Which formats would you want more of next time?', options: ['More time for questions', 'A hands-on breakout', 'Slides sent a day ahead', 'A recording afterwards'], allowMultiple: true, maxPicks: 2, allowOther: true },
    { kind: 'yesno', title: 'Was the length about right?', required: true, unsure: true, followUpWhen: 'no', followUpPrompt: 'What would you cut or add?' },
    { kind: 'rank', title: 'Rank these topics for the next all-hands', options: ['Customer stories', 'Product roadmap', 'Team wins', 'Culture & hiring', 'Financials'], rankTop: 3 },
    { kind: 'text', title: 'What was the best part of the presentation?', textLength: 'long', maxLength: 500 },
    { kind: 'text', title: 'What would you like to see added or changed?', textLength: 'short', maxLength: 280 },
  ],
  'event-feedback': [
    { kind: 'rating', title: 'Overall, how would you rate the event?', required: true, scale: '1-5', lowLabel: 'Poor', highLabel: 'Excellent' },
    { kind: 'rating', title: 'How likely are you to recommend this event to a colleague?', scale: '0-10', lowLabel: 'Not at all likely', highLabel: 'Extremely likely' },
    { kind: 'choice', title: 'What did you come for?', options: ['The talks', 'Meeting people', 'The workshops', 'Hearing what is next'], allowMultiple: true, allowOther: true },
    { kind: 'rating', title: 'How was the venue?', scale: 'stars' },
    { kind: 'yesno', title: 'Would you come back next year?', required: true, unsure: true, followUpWhen: 'no', followUpPrompt: 'What would make it worth your time?' },
    { kind: 'text', title: 'What was the highlight for you?', textLength: 'long' },
    { kind: 'text', title: 'What one thing should we change?', textLength: 'short' },
  ],
  'workshop-retro': [
    { kind: 'rating', title: 'How well did the workshop meet its goals?', required: true, scale: '1-5', lowLabel: 'Not at all', highLabel: 'Completely' },
    { kind: 'choice', title: 'How was the pace?', options: ['Too slow', 'About right', 'Too fast'] },
    { kind: 'rank', title: 'Rank the activities by how useful they were', options: ['The opening exercise', 'Small-group work', 'The group discussion', 'The action planning'] },
    { kind: 'yesno', title: 'Did you leave with a clear next step?', required: true, followUpWhen: 'no', followUpPrompt: 'What would have made it clearer?' },
    { kind: 'text', title: 'What went well?', textLength: 'long' },
    { kind: 'text', title: 'What should we do differently next time?', textLength: 'long' },
    { kind: 'rating', title: 'How confident are you about applying this?', scale: '1-10', lowLabel: 'Not confident', highLabel: 'Very confident' },
  ],
  'training-evaluation': [
    { kind: 'rating', title: 'How relevant was the training to your role?', required: true, scale: '1-5', lowLabel: 'Not relevant', highLabel: 'Very relevant' },
    { kind: 'rating', title: 'How clear was the trainer?', required: true, scale: '1-5', lowLabel: 'Hard to follow', highLabel: 'Very clear' },
    { kind: 'choice', title: 'How much of the material was new to you?', options: ['Almost none of it', 'Some of it', 'Most of it', 'All of it'] },
    { kind: 'choice', title: 'Which formats worked for you?', options: ['Live demonstrations', 'Hands-on exercises', 'Group discussion', 'Reading material'], allowMultiple: true, allowOther: true },
    { kind: 'yesno', title: 'Do you feel ready to use what you learned?', unsure: true, followUpWhen: 'no', followUpPrompt: 'What would help you get there?' },
    { kind: 'rating', title: 'How likely are you to recommend this training to a colleague?', scale: '0-10', lowLabel: 'Not at all likely', highLabel: 'Extremely likely' },
    { kind: 'text', title: 'What will you do differently as a result?', textLength: 'long' },
    { kind: 'text', title: 'What should the next session cover?', textLength: 'short' },
  ],
  'team-pulse': [
    { kind: 'rating', title: 'How manageable is your workload right now?', required: true, scale: '1-5', lowLabel: 'Overwhelming', highLabel: 'Very manageable' },
    { kind: 'rating', title: 'How supported do you feel by the team?', required: true, scale: '1-5', lowLabel: 'Not supported', highLabel: 'Fully supported' },
    { kind: 'yesno', title: 'Do you have what you need to do your job well?', unsure: true, followUpWhen: 'no', followUpPrompt: 'What is missing?' },
    { kind: 'choice', title: 'What is getting in the way most this month?', options: ['Too many meetings', 'Unclear priorities', 'Waiting on others', 'Tools and systems'], allowOther: true },
    { kind: 'rank', title: 'Rank what would help most', options: ['Fewer meetings', 'Clearer priorities', 'More time to focus', 'Better tools'], rankTop: 2 },
    { kind: 'text', title: 'Anything else the team should know?', textLength: 'short', placeholder: 'Optional — only if there is something on your mind.' },
  ],
});

exports.handler = async (event) => {
  try {
    const templateType = event.queryStringParameters?.type || 'call-and-answer';

    let csvTemplate, filename;

    if (templateType === 'trivia') {
      // AN EXAMPLE IS A RULE TO AN AI. A host pastes this file beside the
      // authoring prompt (src/src/config/aiAuthoringPrompt.js), and a model
      // copies what it sees before it reads what it is told. So the rows obey
      // that prompt: the correct letter varies (A, C, B), A-D are four
      // plausible answers of the same kind, E and F are left empty, and one
      // row shows the optional trailing Background column. Every row used to
      // be correct on OptionA with two joke options. tests/template-roundtrip.js.
      filename = 'trivia-template.csv';
      csvTemplate = 'id,title,questionDetail,category,optionA,optionB,optionC,optionD,optionE,optionF,correctAnswer,answerDetails,difficulty,Tags,Background\n' +
        '1,"What a SWOT analysis is for","What is a SWOT analysis used for?","Business","Weighing strengths, weaknesses, opportunities and threats","Forecasting next year\'s revenue","Ranking staff by performance","Setting the marketing budget","","","OptionA","SWOT stands for Strengths, Weaknesses, Opportunities and Threats. The first two look inward at the organisation; the last two look outward at its market.","easy","strategy|planning",""\n' +
        '2,"The language every browser runs","Which programming language runs natively in every major web browser?","Technology","Python","Java","JavaScript","C#","","","OptionC","JavaScript is the language browsers run directly. Python, Java and C# reach a web page only through a server or an extra layer.","easy","technology|web","JavaScript was created at Netscape in 1995. Despite the name it is unrelated to Java."\n' +
        '3,"Emotional intelligence at work","In leadership, what does emotional intelligence mean?","Leadership","Solving technical problems quickly","Recognising and managing emotions, your own and other people\'s","Remembering detail under pressure","Reading financial statements","","","OptionB","Emotional intelligence is noticing and managing emotions, in yourself and in others. In a leader it shows up as staying steady under pressure and reading how the team is really doing.","medium","leadership|people",""';
    } else if (templateType === 'poll') {
      // A POLL TEMPLATE IS THE CONTRACT CSV — a survey's columns, with each
      // row keeping its own Category — built by the same shared/survey-kinds.js
      // the importer validates with, so it can never carry a row the importer
      // would skip. One question of each of the four poll kinds.
      filename = 'poll-template.csv';
      csvTemplate = itemsToSurveyCsv(POLL_TEMPLATE);
    } else if (templateType === 'survey') {
      // A SURVEY TEMPLATE IS A CSV NOW — the contract's survey branch, built by
      // the same shared/survey-kinds.js the importer validates with, so a
      // template can never carry a row the importer would skip. It used to be a
      // JSON document the importer refused, which made it a template for
      // nothing. `?template=<id>` picks one of the named starting points in
      // SURVEY_TEMPLATES below; without it you get one question of every kind.
      const templateId = String(event.queryStringParameters?.template || '').trim();
      if (templateId && !SURVEY_TEMPLATES[templateId]) {
        return {
          statusCode: 400,
          body: JSON.stringify({
            error: `There is no survey template called "${templateId}". The templates are: ${Object.keys(SURVEY_TEMPLATES).join(', ')}.`
          }),
          headers: { 'Access-Control-Allow-Origin': '*' }
        };
      }
      filename = templateId ? `survey-${templateId}.csv` : 'survey-template.csv';
      csvTemplate = itemsToSurveyCsv(templateId ? SURVEY_TEMPLATES[templateId] : EVERY_KIND_TEMPLATE,
        { category: SURVEY_CATEGORY });
    } else if (templateType === 'wavelength') {
      // Wavelength: short evocative SUBJECTS players free-associate on
      // (up to 10 words each); the game measures word overlap across players.
      // Detail_lesson is EMPTY on purpose: a sentence about what the subject
      // means seeds the very words the round exists to compare, which is why
      // the generator strips it (ai-generate-scenarios.js normalizeItem).
      filename = 'wavelength-template.csv';
      csvTemplate = 'Category,Question#,Title,Detail_lesson,School,CustomInstruction,Tags\n' +
        '"Workplace",1,"Remote Work","","General","Enter up to 10 words or short phrases that come to mind when you think about this subject.","remote-work"\n' +
        '"Culture",2,"Customer Trust","","General","Enter up to 10 words or short phrases that come to mind when you think about this subject.","trust|culture"\n' +
        '"Team",3,"Accountability","","General","Enter up to 10 words or short phrases that come to mind when you think about this subject.","accountability|team"';
    } else if (templateType === 'art-title' || templateType === 'art') {
      // Art Title: an ordinary call-and-answer round that carries an Image URL.
      // Players view the artwork and invent their own title, then vote as usual.
      //
      // Two columns do the spoiler work, and they are not interchangeable:
      //   Detail_lesson  is SHOWN TO PLAYERS during ASK — leave it blank, or the
      //                  round is over before it starts.
      //   AnswerDetails  is the REVEAL: the real title of the work plus one point
      //                  of trivia. It reaches no player or host payload; only
      //                  game/get-ai-summary.js reads it, and that runs at RESULTS.
      // School credits the artist/era and is safe to show.
      filename = 'art-title-template.csv';
      csvTemplate = 'Category,Question#,Title,Detail_lesson,School,CustomInstruction,AnswerDetails,Image,Tags\n' +
        '"Renaissance",1,"THE ENIGMATIC SMILE","","Leonardo da Vinci, c. 1503","","Real title: Mona Lisa (La Gioconda), Leonardo da Vinci, c. 1503-1519, Louvre, Paris. Trivia: it was stolen from the Louvre in 1911 by a former museum workman, and the two years it spent missing are much of the reason it is the most famous painting in the world.","https://commons.wikimedia.org/wiki/Special:FilePath/Mona_Lisa,_by_Leonardo_da_Vinci,_from_C2RMF_retouched.jpg?width=900","renaissance|portrait"\n' +
        '"Post-Impressionism",2,"A SWIRLING NIGHT SKY","","Vincent van Gogh, 1889","","Real title: The Starry Night, Vincent van Gogh, 1889, Museum of Modern Art, New York. Trivia: van Gogh painted it from the window of his room at the Saint-Paul asylum in Saint-Remy-de-Provence, where he had admitted himself voluntarily the year before.","https://commons.wikimedia.org/wiki/Special:FilePath/Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg?width=900","post-impressionism|landscape"\n' +
        '"Ukiyo-e",3,"THE TOWERING SEA","","Katsushika Hokusai, c. 1831","","Real title: The Great Wave off Kanagawa, from Thirty-six Views of Mount Fuji, Katsushika Hokusai, c. 1831. Trivia: it is a woodblock print rather than a painting, so thousands of impressions were pulled - and the small peak in the trough of the wave is Mount Fuji, which most people miss on first look.","https://commons.wikimedia.org/wiki/Special:FilePath/The_Great_Wave_off_Kanagawa.jpg?width=900","ukiyo-e|woodblock"';
    } else {
      // call-and-answer (default). The rows follow the authoring prompt
      // (src/src/config/aiAuthoringPrompt.js) because an AI copies them: a
      // lesson is one concrete practice in plain words, and the instruction
      // is the owner's rule — forward-looking, through the TEAM's lens, a
      // question. It used to read "How would you apply… in your current team"
      // over "greatest of all time" boilerplate. tests/template-roundtrip.js.
      filename = 'call-and-answer-template.csv';
      csvTemplate = 'Category,Question#,Title,Detail_lesson,School,CustomInstruction,Tags\n' +
        '"Learning",1,"THE BLAMELESS REVIEW","After something goes wrong, the team writes down what happened and why without naming anyone as at fault. The aim is to fix the conditions that allowed the mistake, so people report problems early instead of hiding them.","Site Reliability Engineering","What would our team need to change to run a review like this after our next setback?","learning|incidents"\n' +
        '"Quality",2,"STOP THE LINE","On a Toyota assembly line, any worker can stop production when they spot a defect. Stopping costs minutes; a defect that travels down the line costs far more. The person closest to the problem is trusted to act on it.","Toyota Production System","Where could our team give the person closest to a problem the right to stop the work?","quality|lean"\n' +
        '"Decisions",3,"DISAGREE AND COMMIT","Once a decision has been argued out, everyone backs it fully, including the people who argued against it. The disagreement happens before the decision is made, not afterwards in the corridor.","Amazon Leadership Principles","Which decision could our team commit to fully, now that it has been argued out?","decisions|teamwork"';
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        filename: filename,
        content: csvTemplate
      }),
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      }
    };

  } catch (error) {
    console.error('Download template error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: `Failed to generate template: ${error.message}` }),
      headers: { 'Access-Control-Allow-Origin': '*' }
    };
  }
};