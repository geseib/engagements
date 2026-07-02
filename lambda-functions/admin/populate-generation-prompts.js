const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');

const tableName = process.env.TABLE_NAME;
const dynamoClient = new DynamoDBClient({});
const dynamodb = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: {
    removeUndefinedValues: true
  }
});

// Shared framing for wavelength generation. Wavelength is a word-association
// alignment game: the host shows a SUBJECT, every participant lists up to 10
// words for it, and the game measures overlap across participants.
const WAVELENGTH_SPEC = 'Create wavelength subjects for a team word-association alignment game. Each item is a single short, evocative SUBJECT (1-4 words, e.g. "Remote Work", "Customer Trust") that every participant responds to by listing up to 10 words or short phrases that come to mind; the game then measures how many words overlap across participants. Pick subjects broad enough that everyone can produce 10 associations, yet specific enough that overlap is meaningful. Mix concrete and abstract subjects. Do NOT write questions, scenarios, sentences to complete, or anything with a correct answer.';

const WAVELENGTH_OUTPUT_FORMAT = '\n\nReturn as JSON array: [{"title": "Subject (1-4 words)", "detail": "One sentence of framing for the subject", "category": "Category", "customInstructions": "Enter up to 10 words or short phrases that come to mind when you think about this subject."}]\nReturn ONLY the JSON array.';

// All generation prompts extracted from frontend components
const generationPrompts = {
  // Call and Answer / Scenario Generation
  "call-and-answer": {
    "lessons-learned": {
      name: "Lessons Learned Scenarios",
      description: "Real-world situations where teams learned valuable lessons",
      basePrompt: "Create scenarios based on common workplace challenges and the lessons learned from them",
      contextTemplate: "\n\nContext: {context}",
      audienceTemplate: "\nAudience: {audience}",
      categoryTemplate: "\nOrganize scenarios into {numberOfCategories} categories.\nMust include these categories: {mustHaveCategories}",
      outputFormat: '\n\nReturn as JSON array: [{"title": "Title", "category": "Category", "detail": "Description", "school": "Professional Development", "customInstructions": "Instructions"}]\nReturn ONLY the JSON array.',
      defaultSettings: {
        difficulty: "medium", 
        numberOfCategories: 4,
        mustHaveCategories: "Leadership, Project Management, Team Dynamics, Problem Resolution",
        customTitle: "Lessons Learned Workshop",
        context: "Professional development workshop focusing on real-world challenges and the valuable lessons learned from them",
        audience: "Team leaders, project managers, and experienced professionals"
      },
      status: "active",
      isDefault: true,
      tags: ["scenarios", "lessons-learned", "workplace", "professional-development"]
    },
    "problem-solving": {
      name: "Problem-Solving Challenges", 
      description: "Current problems your team is tackling that need solutions",
      basePrompt: "Generate problem scenarios that require creative thinking and collaborative solutions",
      contextTemplate: "\n\nContext: {context}",
      audienceTemplate: "\nAudience: {audience}",
      categoryTemplate: "\nOrganize scenarios into {numberOfCategories} categories.\nMust include these categories: {mustHaveCategories}",
      outputFormat: '\n\nReturn as JSON array: [{"title": "Title", "category": "Category", "detail": "Description", "school": "Professional Development", "customInstructions": "Instructions"}]\nReturn ONLY the JSON array.',
      defaultSettings: {
        difficulty: "medium",
        numberOfCategories: 5,
        mustHaveCategories: "Technical Challenges, Process Improvement, Team Collaboration, Innovation, Risk Management",
        customTitle: "Problem-Solving Challenge Session",
        context: "Interactive session designed to tackle current workplace challenges through collaborative problem-solving",
        audience: "Cross-functional teams, managers, and solution-oriented professionals"
      },
      status: "active",
      isDefault: true,
      tags: ["scenarios", "problem-solving", "workplace", "collaboration"]
    },
    "interview-prep": {
      name: "Interview Preparation",
      description: "Practice questions for job interviews and assessments", 
      basePrompt: "Create interview-style questions that help candidates prepare and practice their responses",
      contextTemplate: "\n\nContext: {context}",
      audienceTemplate: "\nAudience: {audience}",
      categoryTemplate: "\nOrganize scenarios into {numberOfCategories} categories.\nMust include these categories: {mustHaveCategories}",
      outputFormat: '\n\nReturn as JSON array: [{"title": "Title", "category": "Category", "detail": "Description", "school": "Professional Development", "customInstructions": "Instructions"}]\nReturn ONLY the JSON array.',
      defaultSettings: {
        difficulty: "medium",
        numberOfCategories: 3,
        mustHaveCategories: "Behavioral Questions, Technical Skills, Situational Judgment",
        customTitle: "Interview Preparation Workshop",
        context: "Comprehensive practice session for job interviews with scenario-based questions",
        audience: "Job seekers, career changers, and professionals seeking advancement"
      },
      status: "active",
      isDefault: true,
      tags: ["scenarios", "interview-prep", "career", "preparation"]
    },
    "amazon-principles": {
      name: "Amazon Leadership Principles",
      description: "Scenarios based on Amazon's 16 Leadership Principles",
      basePrompt: "Generate scenarios that explore Amazon Leadership Principles through real-world situations",
      contextTemplate: "\n\nContext: {context}",
      audienceTemplate: "\nAudience: {audience}",
      categoryTemplate: "\nOrganize scenarios into {numberOfCategories} categories.\nMust include these categories: {mustHaveCategories}",
      outputFormat: '\n\nReturn as JSON array: [{"title": "Title", "category": "Category", "detail": "Description", "school": "Professional Development", "customInstructions": "Instructions"}]\nReturn ONLY the JSON array.',
      defaultSettings: {
        difficulty: "medium",
        numberOfCategories: 4,
        mustHaveCategories: "Customer Obsession, Ownership, Invent & Simplify, Bias for Action",
        customTitle: "Amazon Leadership Principles Workshop",
        context: "Deep dive into Amazon's 16 Leadership Principles through real-world scenarios and STAR method practice",
        audience: "Amazon employees, leadership candidates, and professionals interested in Amazon culture"
      },
      status: "active",
      isDefault: true,
      tags: ["scenarios", "amazon-principles", "leadership", "STAR"]
    },
    "team-building": {
      name: "Team Building Exercises",
      description: "Scenarios that promote team collaboration and communication",
      basePrompt: "Create team-building scenarios that encourage discussion and collaboration",
      contextTemplate: "\n\nContext: {context}",
      audienceTemplate: "\nAudience: {audience}",
      categoryTemplate: "\nOrganize scenarios into {numberOfCategories} categories.\nMust include these categories: {mustHaveCategories}",
      outputFormat: '\n\nReturn as JSON array: [{"title": "Title", "category": "Category", "detail": "Description", "school": "Professional Development", "customInstructions": "Instructions"}]\nReturn ONLY the JSON array.',
      defaultSettings: {
        difficulty: "medium",
        numberOfCategories: 3,
        mustHaveCategories: "Communication, Trust Building, Conflict Resolution",
        customTitle: "Team Building Workshop",
        context: "Collaborative exercises designed to strengthen team bonds and improve communication",
        audience: "Team members, project groups, and departments looking to improve collaboration"
      },
      status: "active",
      isDefault: true,
      tags: ["scenarios", "team-building", "collaboration", "communication"]
    },
    "custom": {
      name: "Custom Scenarios",
      description: "Define your own specific scenario requirements",
      basePrompt: "Create scenarios based on the custom requirements provided",
      contextTemplate: "\n\nContext: {context}",
      audienceTemplate: "\nAudience: {audience}",
      categoryTemplate: "\nOrganize scenarios into {numberOfCategories} categories.\nMust include these categories: {mustHaveCategories}",
      outputFormat: '\n\nReturn as JSON array: [{"title": "Title", "category": "Category", "detail": "Description", "school": "Professional Development", "customInstructions": "Instructions"}]\nReturn ONLY the JSON array.',
      defaultSettings: {
        difficulty: "medium",
        numberOfCategories: 3,
        mustHaveCategories: "",
        customTitle: "Custom Scenarios",
        context: "",
        audience: ""
      },
      status: "active",
      isDefault: true,
      tags: ["scenarios", "custom", "flexible"]
    }
  },

  // Trivia Generation
  "trivia": {
    "general-knowledge": {
      name: "General Knowledge Trivia",
      description: "Broad knowledge questions across various topics",
      basePrompt: "Create general knowledge trivia questions covering history, science, geography, and culture",
      contextTemplate: "\n\nContext: {context}",
      audienceTemplate: "\nAudience: {audience}",
      categoryTemplate: "\nOrganize questions into {numberOfCategories} categories.\nMust include these categories: {mustHaveCategories}",
      outputFormat: '\n\nReturn as JSON array: [{"title": "Short title", "questionDetail": "Full question text", "category": "Category", "optionA": "Choice A", "optionB": "Choice B", "optionC": "Choice C", "optionD": "Choice D", "correctAnswer": "OptionA", "answerDetails": "Explanation", "difficulty": "easy|medium|hard"}]\nReturn ONLY the JSON array.',
      defaultSettings: {
        difficulty: "medium",
        numberOfCategories: 4,
        mustHaveCategories: "History, Science, Geography, Culture",
        numChoices: 4,
        numCorrect: 1
      },
      status: "active",
      isDefault: true,
      tags: ["trivia", "general-knowledge", "education", "quiz"]
    },
    "subject-specific": {
      name: "Subject-Specific Trivia",
      description: "Deep dive into a specific subject or field",
      basePrompt: "Generate trivia questions focused on a specific subject area with varying difficulty levels",
      contextTemplate: "\n\nTopic: {context}",
      audienceTemplate: "\nAudience: {audience}",
      categoryTemplate: "\nOrganize questions into {numberOfCategories} categories.\nMust include these categories: {mustHaveCategories}",
      outputFormat: '\n\nReturn as JSON array: [{"title": "Short title", "questionDetail": "Full question text", "category": "Category", "optionA": "Choice A", "optionB": "Choice B", "optionC": "Choice C", "optionD": "Choice D", "correctAnswer": "OptionA", "answerDetails": "Explanation", "difficulty": "easy|medium|hard"}]\nReturn ONLY the JSON array.',
      defaultSettings: {
        difficulty: "medium",
        numberOfCategories: 3,
        mustHaveCategories: "",
        numChoices: 4,
        numCorrect: 1
      },
      status: "active",
      isDefault: true,
      tags: ["trivia", "subject-specific", "focused", "education"]
    },
    "workplace-trivia": {
      name: "Workplace & Business Trivia",
      description: "Business knowledge and workplace concepts",
      basePrompt: "Create trivia questions about business concepts, workplace skills, and professional knowledge",
      contextTemplate: "\n\nContext: {context}",
      audienceTemplate: "\nAudience: {audience}",
      categoryTemplate: "\nOrganize questions into {numberOfCategories} categories.\nMust include these categories: {mustHaveCategories}",
      outputFormat: '\n\nReturn as JSON array: [{"title": "Short title", "questionDetail": "Full question text", "category": "Category", "optionA": "Choice A", "optionB": "Choice B", "optionC": "Choice C", "optionD": "Choice D", "correctAnswer": "OptionA", "answerDetails": "Explanation", "difficulty": "easy|medium|hard"}]\nReturn ONLY the JSON array.',
      defaultSettings: {
        difficulty: "medium",
        numberOfCategories: 4,
        mustHaveCategories: "Business Strategy, Management, Finance, Professional Skills",
        numChoices: 4,
        numCorrect: 1
      },
      status: "active",
      isDefault: true,
      tags: ["trivia", "business", "workplace", "professional"]
    },
    "fun-facts": {
      name: "Fun Facts & Interesting Trivia",
      description: "Entertaining and surprising facts",
      basePrompt: "Generate fun and interesting trivia questions with surprising facts and entertaining knowledge",
      contextTemplate: "\n\nContext: {context}",
      audienceTemplate: "\nAudience: {audience}",
      categoryTemplate: "\nOrganize questions into {numberOfCategories} categories.\nMust include these categories: {mustHaveCategories}",
      outputFormat: '\n\nReturn as JSON array: [{"title": "Short title", "questionDetail": "Full question text", "category": "Category", "optionA": "Choice A", "optionB": "Choice B", "optionC": "Choice C", "optionD": "Choice D", "correctAnswer": "OptionA", "answerDetails": "Explanation", "difficulty": "easy|medium|hard"}]\nReturn ONLY the JSON array.',
      defaultSettings: {
        difficulty: "medium",
        numberOfCategories: 5,
        mustHaveCategories: "Animals, Science, Entertainment, History, World Records",
        numChoices: 4,
        numCorrect: 1
      },
      status: "active",
      isDefault: true,
      tags: ["trivia", "fun-facts", "entertainment", "interesting"]
    },
    "custom-trivia": {
      name: "Custom Trivia Topics",
      description: "Define your own trivia topic and requirements",
      basePrompt: "Create trivia questions based on the specific topic and requirements provided",
      contextTemplate: "\n\nTopic: {context}",
      audienceTemplate: "\nAudience: {audience}",
      categoryTemplate: "\nOrganize questions into {numberOfCategories} categories.\nMust include these categories: {mustHaveCategories}",
      outputFormat: '\n\nReturn as JSON array: [{"title": "Short title", "questionDetail": "Full question text", "category": "Category", "optionA": "Choice A", "optionB": "Choice B", "optionC": "Choice C", "optionD": "Choice D", "correctAnswer": "OptionA", "answerDetails": "Explanation", "difficulty": "easy|medium|hard"}]\nReturn ONLY the JSON array.',
      defaultSettings: {
        difficulty: "medium",
        numberOfCategories: 3,
        mustHaveCategories: "",
        numChoices: 4,
        numCorrect: 1
      },
      status: "active",
      isDefault: true,
      tags: ["trivia", "custom", "flexible"]
    }
  },

  // Poll Generation
  "poll": {
    "opinion-polls": {
      name: "Opinion & Preference Polls",
      description: "Gather opinions and preferences from participants",
      basePrompt: "Create poll questions that gather opinions, preferences, and viewpoints on various topics",
      contextTemplate: "\n\nContext: {context}",
      audienceTemplate: "\nAudience: {audience}",
      categoryTemplate: "\nOrganize polls into {numberOfCategories} categories.\nMust include these categories: {mustHaveCategories}",
      outputFormat: '\n\nReturn as JSON array: [{"title": "Question/prompt", "detail": "Background context", "category": "Category", "customInstructions": "Response guidance"}]\nReturn ONLY the JSON array.',
      defaultSettings: {
        difficulty: "medium",
        numberOfCategories: 3,
        mustHaveCategories: "Preferences, Opinions, Viewpoints"
      },
      status: "active",
      isDefault: true,
      tags: ["poll", "opinion", "preference", "feedback"]
    },
    "decision-making": {
      name: "Decision-Making Polls",
      description: "Help teams make decisions through voting",
      basePrompt: "Generate poll questions that help teams make decisions and choose between options",
      contextTemplate: "\n\nContext: {context}",
      audienceTemplate: "\nAudience: {audience}",
      categoryTemplate: "\nOrganize polls into {numberOfCategories} categories.\nMust include these categories: {mustHaveCategories}",
      outputFormat: '\n\nReturn as JSON array: [{"title": "Question/prompt", "detail": "Background context", "category": "Category", "customInstructions": "Response guidance"}]\nReturn ONLY the JSON array.',
      defaultSettings: {
        difficulty: "medium",
        numberOfCategories: 3,
        mustHaveCategories: "Strategic Decisions, Process Choices, Priority Setting"
      },
      status: "active",
      isDefault: true,
      tags: ["poll", "decision-making", "voting", "choice"]
    },
    "feedback-polls": {
      name: "Feedback & Assessment Polls",
      description: "Collect feedback and assess understanding",
      basePrompt: "Create poll questions to gather feedback, assess understanding, and measure satisfaction",
      contextTemplate: "\n\nContext: {context}",
      audienceTemplate: "\nAudience: {audience}",
      categoryTemplate: "\nOrganize polls into {numberOfCategories} categories.\nMust include these categories: {mustHaveCategories}",
      outputFormat: '\n\nReturn as JSON array: [{"title": "Question/prompt", "detail": "Background context", "category": "Category", "customInstructions": "Response guidance"}]\nReturn ONLY the JSON array.',
      defaultSettings: {
        difficulty: "medium",
        numberOfCategories: 3,
        mustHaveCategories: "Feedback, Assessment, Satisfaction"
      },
      status: "active",
      isDefault: true,
      tags: ["poll", "feedback", "assessment", "satisfaction"]
    },
    "icebreaker-polls": {
      name: "Icebreaker & Team Polls",
      description: "Fun polls to break the ice and learn about team members",
      basePrompt: "Generate fun and engaging poll questions that help team members get to know each other",
      contextTemplate: "\n\nContext: {context}",
      audienceTemplate: "\nAudience: {audience}",
      categoryTemplate: "\nOrganize polls into {numberOfCategories} categories.\nMust include these categories: {mustHaveCategories}",
      outputFormat: '\n\nReturn as JSON array: [{"title": "Question/prompt", "detail": "Background context", "category": "Category", "customInstructions": "Response guidance"}]\nReturn ONLY the JSON array.',
      defaultSettings: {
        difficulty: "easy",
        numberOfCategories: 4,
        mustHaveCategories: "Personal Interests, Fun Facts, Preferences, Getting to Know You"
      },
      status: "active",
      isDefault: true,
      tags: ["poll", "icebreaker", "team-building", "fun"]
    },
    "custom-polls": {
      name: "Custom Poll Topics",
      description: "Define your own poll topic and requirements",
      basePrompt: "Create poll questions based on the specific topic and requirements provided",
      contextTemplate: "\n\nContext: {context}",
      audienceTemplate: "\nAudience: {audience}",
      categoryTemplate: "\nOrganize polls into {numberOfCategories} categories.\nMust include these categories: {mustHaveCategories}",
      outputFormat: '\n\nReturn as JSON array: [{"title": "Question/prompt", "detail": "Background context", "category": "Category", "customInstructions": "Response guidance"}]\nReturn ONLY the JSON array.',
      defaultSettings: {
        difficulty: "medium",
        numberOfCategories: 3,
        mustHaveCategories: ""
      },
      status: "active",
      isDefault: true,
      tags: ["poll", "custom", "flexible"]
    }
  },

  // Wavelength Generation
  // Wavelength items are SUBJECTS for a word-association alignment game: every
  // participant lists up to 10 words for the subject, and the game measures how
  // many words overlap across participants (results render as a word cloud).
  "wavelength": {
    "tech-terms": {
      name: "Technology Terms",
      description: "Technology subjects for word-association alignment",
      basePrompt: WAVELENGTH_SPEC + " Draw subjects from technology and software development: languages, practices, tools, platforms, and architecture concepts.",
      contextTemplate: "\n\nContext: {context}",
      audienceTemplate: "\nAudience: {audience}",
      categoryTemplate: "\nOrganize subjects into {numberOfCategories} categories.\nMust include these categories: {mustHaveCategories}",
      outputFormat: WAVELENGTH_OUTPUT_FORMAT,
      defaultSettings: {
        difficulty: "medium",
        numberOfCategories: 4,
        mustHaveCategories: "Programming, Cloud Computing, Development Tools, Architecture",
        customTitle: "Technology Terms Wavelength",
        context: "Word association exercise using technology and software development concepts",
        audience: "Software developers, technical teams, and technology professionals"
      },
      status: "active",
      isDefault: true,
      tags: ["wavelength", "technology", "programming", "technical"]
    },
    "business-concepts": {
      name: "Business Concepts",
      description: "Business and management subjects for word-association alignment",
      basePrompt: WAVELENGTH_SPEC + " Draw subjects from business, strategy, and management: markets, leadership, operations, finance, and organizational life.",
      contextTemplate: "\n\nContext: {context}",
      audienceTemplate: "\nAudience: {audience}",
      categoryTemplate: "\nOrganize subjects into {numberOfCategories} categories.\nMust include these categories: {mustHaveCategories}",
      outputFormat: WAVELENGTH_OUTPUT_FORMAT,
      defaultSettings: {
        difficulty: "medium",
        numberOfCategories: 4,
        mustHaveCategories: "Strategy, Operations, Finance, Leadership",
        customTitle: "Business Concepts Wavelength",
        context: "Explore business and management terms through creative word association",
        audience: "Business professionals, managers, and leadership teams"
      },
      status: "active",
      isDefault: true,
      tags: ["wavelength", "business", "strategy", "management"]
    },
    "lists-favorites": {
      name: "Lists & Favorites",
      description: "Everyday life and personal interest subjects for word-association alignment",
      basePrompt: WAVELENGTH_SPEC + ' Draw subjects from everyday life and personal interests: entertainment, food, travel, hobbies, and shared experiences (e.g. "Road Trips", "Comfort Food") so participants can compare their spontaneous associations.',
      contextTemplate: "\n\nContext: {context}",
      audienceTemplate: "\nAudience: {audience}",
      categoryTemplate: "\nOrganize subjects into {numberOfCategories} categories.\nMust include these categories: {mustHaveCategories}",
      outputFormat: WAVELENGTH_OUTPUT_FORMAT,
      defaultSettings: {
        difficulty: "easy",
        numberOfCategories: 5,
        mustHaveCategories: "Entertainment, Professional Resources, Places & Travel, Personal Growth, Hobbies & Interests",
        customTitle: "Lists & Favorites Workshop",
        context: "Share personal preferences and recommendations with your team through curated lists",
        audience: "All team members looking to connect and share interests"
      },
      status: "active",
      isDefault: true,
      tags: ["wavelength", "lists", "favorites", "personal", "sharing"]
    },
    "brainstorming": {
      name: "Brainstorming Sessions",
      description: "Work-life subjects that reveal shared team priorities",
      basePrompt: WAVELENGTH_SPEC + ' Draw subjects from the team\'s working life: products, processes, challenges, goals, and opportunities (e.g. "Our Next Launch", "Team Meetings") so overlapping words reveal shared priorities.',
      contextTemplate: "\n\nContext: {context}",
      audienceTemplate: "\nAudience: {audience}",
      categoryTemplate: "\nOrganize subjects into {numberOfCategories} categories.\nMust include these categories: {mustHaveCategories}",
      outputFormat: WAVELENGTH_OUTPUT_FORMAT,
      defaultSettings: {
        difficulty: "medium",
        numberOfCategories: 4,
        mustHaveCategories: "Product Ideas, Process Improvements, Problem Solutions, Future Opportunities",
        customTitle: "Team Brainstorming Session",
        context: "Collaborative ideation session for generating solutions and innovations",
        audience: "Cross-functional teams, product teams, and innovation groups"
      },
      status: "active",
      isDefault: true,
      tags: ["wavelength", "brainstorming", "innovation", "ideas"]
    },
    "icebreakers-fun": {
      name: "Icebreakers & Fun",
      description: "Fun, relatable subjects for playful word association",
      basePrompt: WAVELENGTH_SPEC + ' Draw fun, universally relatable subjects (e.g. "Monday Mornings", "Office Coffee", "Summer Vacation") that spark playful associations and easy laughs when the overlap is revealed.',
      contextTemplate: "\n\nContext: {context}",
      audienceTemplate: "\nAudience: {audience}",
      categoryTemplate: "\nOrganize subjects into {numberOfCategories} categories.\nMust include these categories: {mustHaveCategories}",
      outputFormat: WAVELENGTH_OUTPUT_FORMAT,
      defaultSettings: {
        difficulty: "easy",
        numberOfCategories: 5,
        mustHaveCategories: "Personal Interests, Fun Facts, Dreams & Aspirations, Hidden Talents, Life Experiences",
        customTitle: "Fun Icebreakers Session",
        context: "Get to know your teammates better through fun and engaging prompts",
        audience: "New teams, remote teams, or groups looking to build rapport"
      },
      status: "active",
      isDefault: true,
      tags: ["wavelength", "icebreakers", "fun", "personal", "team-building"]
    },
    "custom": {
      name: "Custom Subjects",
      description: "Define your own subjects for word association",
      basePrompt: WAVELENGTH_SPEC + " Draw subjects from the custom topics provided.",
      contextTemplate: "\n\nContext: {context}",
      audienceTemplate: "\nAudience: {audience}",
      categoryTemplate: "\nOrganize subjects into {numberOfCategories} categories.\nMust include these categories: {mustHaveCategories}",
      outputFormat: WAVELENGTH_OUTPUT_FORMAT,
      defaultSettings: {
        difficulty: "medium",
        numberOfCategories: 3,
        mustHaveCategories: "",
        customTitle: "Custom Wavelength Workshop",
        context: "Custom list-based exercise tailored to your specific needs",
        audience: "Customized based on requirements"
      },
      status: "active",
      isDefault: true,
      tags: ["wavelength", "custom", "flexible"]
    }
  }
};

exports.handler = async (event) => {
  console.log('🚀 Populating generation prompts...');

  try {
    const timestamp = new Date().toISOString();
    let totalPrompts = 0;

    for (const [gameType, scenarios] of Object.entries(generationPrompts)) {
      console.log(`📝 Processing ${gameType} prompts...`);
      
      for (const [scenarioType, promptData] of Object.entries(scenarios)) {
        const promptItem = {
          PK: 'AIPROMPTS',
          SK: `AIPROMPT#GENERATION#${scenarioType}#${gameType}`,
          promptType: 'generation',
          gameType: gameType,
          scenarioType: scenarioType,
          name: promptData.name,
          description: promptData.description,
          basePrompt: promptData.basePrompt,
          contextTemplate: promptData.contextTemplate,
          audienceTemplate: promptData.audienceTemplate,
          categoryTemplate: promptData.categoryTemplate,
          outputFormat: promptData.outputFormat,
          defaultSettings: promptData.defaultSettings,
          status: promptData.status,
          isDefault: promptData.isDefault,
          tags: promptData.tags,
          createdAt: timestamp,
          updatedAt: timestamp,
          version: '1.0.0'
        };

        const putCommand = new PutCommand({
          TableName: tableName,
          Item: promptItem
        });

        await dynamodb.send(putCommand);
        totalPrompts++;
        
        console.log(`✅ Added: ${gameType} - ${scenarioType}`);
      }
    }

    console.log(`🎉 Successfully populated ${totalPrompts} generation prompts!`);

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: JSON.stringify({
        message: `Successfully populated ${totalPrompts} generation prompts`,
        totalPrompts,
        gameTypes: Object.keys(generationPrompts),
        timestamp
      })
    };

  } catch (error) {
    console.error('❌ Error populating generation prompts:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: JSON.stringify({
        error: 'Failed to populate generation prompts',
        message: error.message
      })
    };
  }
};