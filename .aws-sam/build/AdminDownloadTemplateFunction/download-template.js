exports.handler = async (event) => {
  try {
    const templateType = event.queryStringParameters?.type || 'call-and-answer';

    let csvTemplate, filename;

    if (templateType === 'trivia') {
      filename = 'trivia-template.csv';
      csvTemplate = 'Category,Question#,Title,Detail_lesson,School,CustomInstruction,CorrectAnswer,WrongAnswer1,WrongAnswer2,WrongAnswer3,WrongAnswer4,WrongAnswer5,Difficulty\n' +
        '"Business",1,"What is the primary purpose of a SWOT analysis?","SWOT analysis is a strategic planning tool used to evaluate strengths, weaknesses, opportunities, and threats.","Business School","Choose the best answer.","To evaluate strengths, weaknesses, opportunities, and threats","To calculate financial ratios","To manage employee performance","To design marketing campaigns","To create organizational charts","To analyze customer feedback","medium"\n' +
        '"Technology",2,"Which programming language is primarily used for web development?","Web development involves creating websites and web applications using various programming languages.","Tech School","Select the correct answer.","JavaScript","Assembly","COBOL","Fortran","BASIC","Pascal","easy"\n' +
        '"Leadership",3,"What is emotional intelligence in leadership?","Emotional intelligence refers to the ability to understand and manage emotions effectively in leadership contexts.","Business School","Pick the most accurate definition.","The ability to understand and manage emotions","The ability to solve complex problems","The ability to memorize information","The ability to work with numbers","The ability to lift heavy objects","The ability to run fast","medium"';
    } else if (templateType === 'poll') {
      filename = 'poll-template.csv';
      csvTemplate = 'Category,Question#,Title,Detail_lesson,School,CustomInstruction,Options,AllowMultiple\n' +
        '"Workplace",1,"What is your preferred work environment?","Understanding work environment preferences helps create better workplace policies.","Business School","Select your preference.","Office|Remote|Hybrid|Co-working space","false"\n' +
        '"Communication",2,"Which communication tools do you use most?","Communication tool preferences vary by generation and work style.","Business School","You may select multiple options.","Email|Slack|Teams|Phone|Video calls|In-person","true"\n' +
        '"Development",3,"What skills would you like to develop?","Professional development priorities help guide training programs.","Business School","Choose your top priorities.","Leadership|Technical skills|Communication|Project management|Data analysis","true"';
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
    } else {
      // call-and-answer (default)
      filename = 'call-and-answer-template.csv';
      csvTemplate = 'Category,Question#,Title,Detail_lesson,School,CustomInstruction\n' +
        '"Leadership",1,"MOST EFFECTIVE LEADERSHIP STYLE","Leadership is about inspiring others to achieve their potential. From transformational leaders who create vision to servant leaders who put team first. Consider different situations where different approaches work better. Think about technical skill, cultural impact, innovation, and lasting influence.","School of Management","How would you apply this leadership principle in your current team or organization?"\n' +
        '"Innovation",2,"GREATEST INNOVATION METHOD","Innovation drives progress and competitive advantage. From design thinking to lean startup methodology to blue ocean strategy. Consider methods that improve quality of life, enable other innovations, transform society, or solve fundamental problems.","School of Innovation","What innovative approach would you implement in your current project?"\n' +
        '"Strategy",3,"BEST STRATEGIC APPROACH","Strategic thinking involves long-term planning and competitive positioning. From Porter\'s Five Forces to Blue Ocean Strategy to systems thinking approaches. Consider frameworks that provide competitive advantage while remaining adaptable to changing conditions.","School of Strategy","How would you adapt this strategic concept to your industry?"';
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