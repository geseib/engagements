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
      filename = 'trivia-template.csv';
      csvTemplate = 'id,title,questionDetail,category,optionA,optionB,optionC,optionD,optionE,optionF,correctAnswer,answerDetails,difficulty,Tags\n' +
        '1,"What is the primary purpose of a SWOT analysis?","What is the primary purpose of a SWOT analysis in business strategy?","Business","To evaluate strengths, weaknesses, opportunities, and threats","To calculate financial ratios","To manage employee performance","To design marketing campaigns","To create organizational charts","To analyze customer feedback","OptionA","SWOT analysis is a strategic planning tool used to evaluate Strengths, Weaknesses, Opportunities, and Threats that can affect a business or project. It provides a structured approach to strategic planning by examining internal factors (strengths and weaknesses) and external factors (opportunities and threats).","medium","strategy|business-analysis|planning"\n' +
        '2,"Which programming language is primarily used for web development?","Which programming language is most commonly used for client-side web development?","Technology","JavaScript","Assembly","COBOL","Fortran","BASIC","Pascal","OptionA","JavaScript is the primary programming language for client-side web development. It runs in web browsers and enables interactive web pages, dynamic content updates, and modern web applications. While other languages can be used for web development, JavaScript is essential for front-end development.","easy","technology|web-development|programming"\n' +
        '3,"What is emotional intelligence in leadership?","What does emotional intelligence mean in the context of leadership?","Leadership","The ability to understand and manage emotions","The ability to solve complex problems","The ability to memorize information","The ability to work with numbers","The ability to lift heavy objects","The ability to run fast","OptionA","Emotional intelligence in leadership refers to the ability to recognize, understand, and manage both your own emotions and the emotions of others. This includes self-awareness, self-regulation, empathy, and social skills - all crucial for effective leadership and team management.","medium","leadership|soft-skills|emotional-intelligence"';
    } else if (templateType === 'poll') {
      filename = 'poll-template.csv';
      csvTemplate = 'Category,Question#,Title,Detail_lesson,School,CustomInstruction,Options,AllowMultiple,Tags\n' +
        '"Workplace",1,"What is your preferred work environment?","Understanding work environment preferences helps create better workplace policies.","Business School","Select your preference.","Office|Remote|Hybrid|Co-working space","false","remote-work|workplace"\n' +
        '"Communication",2,"Which communication tools do you use most?","Communication tool preferences vary by generation and work style.","Business School","You may select multiple options.","Email|Slack|Teams|Phone|Video calls|In-person","true","communication|tools"\n' +
        '"Development",3,"What skills would you like to develop?","Professional development priorities help guide training programs.","Business School","Choose your top priorities.","Leadership|Technical skills|Communication|Project management|Data analysis","true","professional-development"';
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
      // (up to 10 words each); the game measures word overlap across players
      filename = 'wavelength-template.csv';
      csvTemplate = 'Category,Question#,Title,Detail_lesson,School,CustomInstruction,Tags\n' +
        '"Workplace",1,"Remote Work","How and where we get our best work done.","General","Enter up to 10 words or short phrases that come to mind when you think about this subject.","remote-work"\n' +
        '"Culture",2,"Customer Trust","What it takes to earn and keep the confidence of the people we serve.","General","Enter up to 10 words or short phrases that come to mind when you think about this subject.","trust|culture"\n' +
        '"Team",3,"Accountability","Who owns outcomes and how ownership shows up day to day.","General","Enter up to 10 words or short phrases that come to mind when you think about this subject.","accountability|team"';
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
      // call-and-answer (default)
      filename = 'call-and-answer-template.csv';
      csvTemplate = 'Category,Question#,Title,Detail_lesson,School,CustomInstruction,Tags\n' +
        '"Leadership",1,"MOST EFFECTIVE LEADERSHIP STYLE","Leadership is about inspiring others to achieve their potential. From transformational leaders who create vision to servant leaders who put team first. Consider different situations where different approaches work better. Think about technical skill, cultural impact, innovation, and lasting influence.","School of Management","How would you apply this leadership principle in your current team or organization?","leadership|management"\n' +
        '"Innovation",2,"GREATEST INNOVATION METHOD","Innovation drives progress and competitive advantage. From design thinking to lean startup methodology to blue ocean strategy. Consider methods that improve quality of life, enable other innovations, transform society, or solve fundamental problems.","School of Innovation","What innovative approach would you implement in your current project?","innovation|strategy"\n' +
        '"Strategy",3,"BEST STRATEGIC APPROACH","Strategic thinking involves long-term planning and competitive positioning. From Porter\'s Five Forces to Blue Ocean Strategy to systems thinking approaches. Consider frameworks that provide competitive advantage while remaining adaptable to changing conditions.","School of Strategy","How would you adapt this strategic concept to your industry?","strategy|planning"';
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