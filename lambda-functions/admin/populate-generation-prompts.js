/**
 * Seed the built-in question-GENERATION prompts (AIGenerationPromptEditor /
 * AIScenarioBuilder), as distinct from the summary "analysis" prompts seeded by
 * ./populate-defaults.js.
 *
 * ⚠️ NOT ROUTED. There is no API Gateway event for this handler in
 * template-clean.yaml, so nothing can invoke it today; the rows it describes
 * were presumably written by an earlier routed version. It is kept (rather than
 * deleted) because the prompt text below is the only copy of these generation
 * prompts, and fixed (rather than left alone) so that routing it later cannot
 * recreate the promptId bug — see the note on `promptId` in the writer.
 */
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { normalizeGameType } = require('./shared/game-types');
const { WAVELENGTH_SPEC } = require('./shared/wavelength-spec');

const tableName = process.env.TABLE_NAME;
const dynamoClient = new DynamoDBClient({});
const dynamodb = DynamoDBDocumentClient.from(dynamoClient, {
  marshallOptions: {
    removeUndefinedValues: true
  }
});

// WHAT THE `outputFormat` FIELD IS NOW. Every generator writes through a tool
// schema (shared/structured-generation.js buildItemsTool and the trivia, poll
// and question builders' own), and none of them reads this field — so the
// JSON-array instructions it used to hold were never sent, and the wavelength
// one asked for "One sentence of framing", which the game forbids. The field
// stays on the row because the generation prompt editor shows it.
const SCHEMA_NOTE = 'Not sent to the model: the generator\'s tool schema is the output contract.';

// Not read by anything: TriviaAIBuilder and PollAIBuilder send no promptId, and
// ai-generate-trivia.js / ai-generate-polls.js look no prompt row up. Kept as
// the owner's prompt text, and labelled so nobody edits them expecting a change.
const UNUSED = ' (Not used by the trivia/poll builders.)';

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
      outputFormat: SCHEMA_NOTE,
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
      outputFormat: SCHEMA_NOTE,
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
      outputFormat: SCHEMA_NOTE,
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
      outputFormat: SCHEMA_NOTE,
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
      outputFormat: SCHEMA_NOTE,
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
      outputFormat: SCHEMA_NOTE,
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
      description: "Broad knowledge questions across various topics" + UNUSED,
      basePrompt: "Create general knowledge trivia questions covering history, science, geography, and culture",
      contextTemplate: "\n\nContext: {context}",
      audienceTemplate: "\nAudience: {audience}",
      categoryTemplate: "\nOrganize questions into {numberOfCategories} categories.\nMust include these categories: {mustHaveCategories}",
      outputFormat: SCHEMA_NOTE,
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
      description: "Deep dive into a specific subject or field" + UNUSED,
      basePrompt: "Generate trivia questions focused on a specific subject area with varying difficulty levels",
      contextTemplate: "\n\nTopic: {context}",
      audienceTemplate: "\nAudience: {audience}",
      categoryTemplate: "\nOrganize questions into {numberOfCategories} categories.\nMust include these categories: {mustHaveCategories}",
      outputFormat: SCHEMA_NOTE,
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
      description: "Business knowledge and workplace concepts" + UNUSED,
      basePrompt: "Create trivia questions about business concepts, workplace skills, and professional knowledge",
      contextTemplate: "\n\nContext: {context}",
      audienceTemplate: "\nAudience: {audience}",
      categoryTemplate: "\nOrganize questions into {numberOfCategories} categories.\nMust include these categories: {mustHaveCategories}",
      outputFormat: SCHEMA_NOTE,
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
      description: "Entertaining and surprising facts" + UNUSED,
      basePrompt: "Generate fun and interesting trivia questions with surprising facts and entertaining knowledge",
      contextTemplate: "\n\nContext: {context}",
      audienceTemplate: "\nAudience: {audience}",
      categoryTemplate: "\nOrganize questions into {numberOfCategories} categories.\nMust include these categories: {mustHaveCategories}",
      outputFormat: SCHEMA_NOTE,
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
      description: "Define your own trivia topic and requirements" + UNUSED,
      basePrompt: "Create trivia questions based on the specific topic and requirements provided",
      contextTemplate: "\n\nTopic: {context}",
      audienceTemplate: "\nAudience: {audience}",
      categoryTemplate: "\nOrganize questions into {numberOfCategories} categories.\nMust include these categories: {mustHaveCategories}",
      outputFormat: SCHEMA_NOTE,
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
      description: "Gather opinions and preferences from participants" + UNUSED,
      basePrompt: "Create instant poll questions (choice, rating, yes/no or open) that gather opinions, preferences and viewpoints",
      contextTemplate: "\n\nContext: {context}",
      audienceTemplate: "\nAudience: {audience}",
      categoryTemplate: "\nOrganize polls into {numberOfCategories} categories.\nMust include these categories: {mustHaveCategories}",
      outputFormat: SCHEMA_NOTE,
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
      description: "Help teams make decisions with a quick poll" + UNUSED,
      basePrompt: "Create instant poll questions, mostly choice and yes/no, that help a team choose between options",
      contextTemplate: "\n\nContext: {context}",
      audienceTemplate: "\nAudience: {audience}",
      categoryTemplate: "\nOrganize polls into {numberOfCategories} categories.\nMust include these categories: {mustHaveCategories}",
      outputFormat: SCHEMA_NOTE,
      defaultSettings: {
        difficulty: "medium",
        numberOfCategories: 3,
        mustHaveCategories: "Strategic Decisions, Process Choices, Priority Setting"
      },
      status: "active",
      isDefault: true,
      tags: ["poll", "decision-making", "choice"]
    },
    "feedback-polls": {
      name: "Feedback & Assessment Polls",
      description: "Collect feedback and assess understanding" + UNUSED,
      basePrompt: "Create instant poll questions, mostly rating and choice, that gather feedback and measure satisfaction",
      contextTemplate: "\n\nContext: {context}",
      audienceTemplate: "\nAudience: {audience}",
      categoryTemplate: "\nOrganize polls into {numberOfCategories} categories.\nMust include these categories: {mustHaveCategories}",
      outputFormat: SCHEMA_NOTE,
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
      description: "Fun polls to break the ice and learn about team members" + UNUSED,
      basePrompt: "Create light instant poll questions that help team members get to know each other",
      contextTemplate: "\n\nContext: {context}",
      audienceTemplate: "\nAudience: {audience}",
      categoryTemplate: "\nOrganize polls into {numberOfCategories} categories.\nMust include these categories: {mustHaveCategories}",
      outputFormat: SCHEMA_NOTE,
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
      description: "Define your own poll topic and requirements" + UNUSED,
      basePrompt: "Create instant poll questions (choice, rating, yes/no or open) on the topic and requirements provided",
      contextTemplate: "\n\nContext: {context}",
      audienceTemplate: "\nAudience: {audience}",
      categoryTemplate: "\nOrganize polls into {numberOfCategories} categories.\nMust include these categories: {mustHaveCategories}",
      outputFormat: SCHEMA_NOTE,
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
      outputFormat: SCHEMA_NOTE,
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
      outputFormat: SCHEMA_NOTE,
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
      outputFormat: SCHEMA_NOTE,
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
      outputFormat: SCHEMA_NOTE,
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
      outputFormat: SCHEMA_NOTE,
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
      outputFormat: SCHEMA_NOTE,
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

exports.generationPrompts = generationPrompts;

exports.handler = async (event) => {
  console.log('🚀 Populating generation prompts...');

  try {
    const timestamp = new Date().toISOString();
    let totalPrompts = 0;

    for (const [rawGameType, scenarios] of Object.entries(generationPrompts)) {
      const gameType = normalizeGameType(rawGameType);
      console.log(`📝 Processing ${gameType} prompts...`);

      for (const [scenarioType, promptData] of Object.entries(scenarios)) {
        // These rows previously carried NO `promptId` attribute at all while
        // still matching get-ai-prompts.js's `begins_with(SK, 'AIPROMPT#')`
        // filter. In a React <select> that means `value={undefined}`, which
        // React omits — and a DOM <option> with no value attribute reports its
        // LABEL TEXT as its value. Selecting one wrote a string like
        // "Lessons Learned Scenarios (call-and-answer - )" into a question
        // set's promptId: a dangling reference that silently falls back to the
        // default. The id is derived (not random) so re-running is idempotent.
        const promptId = `gen-${gameType}-${scenarioType}`;

        const promptItem = {
          PK: 'AIPROMPTS',
          SK: `AIPROMPT#${promptId}`,
          promptId,
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