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
      filename = 'survey-template.json';
      const surveyTemplate = {
        title: "Sample Survey Template",
        description: "This is a sample survey with different question types",
        questions: [
          {
            id: 1,
            question: "How satisfied are you with our service?",
            type: "rating",
            scale: { type: "1-5", lowLabel: "Very Dissatisfied", highLabel: "Very Satisfied" },
            required: true
          },
          {
            id: 2,
            question: "Which features do you use most?",
            type: "multiple_choice",
            options: ["Feature A", "Feature B", "Feature C", "Feature D"],
            allowMultiple: true,
            required: true
          },
          {
            id: 3,
            question: "What improvements would you suggest?",
            type: "text_entry",
            textType: "long",
            placeholder: "Please share your suggestions...",
            required: false
          }
        ]
      };
      return {
        statusCode: 200,
        body: JSON.stringify({
          filename: filename,
          content: JSON.stringify(surveyTemplate, null, 2)
        }),
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': 'application/json'
        }
      };
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