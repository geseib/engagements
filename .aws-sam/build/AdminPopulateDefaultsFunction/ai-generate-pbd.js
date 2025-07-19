const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');

const bedrock = new BedrockRuntimeClient({ region: 'us-west-2' });

exports.handler = async (event) => {
  console.log('🤖 AI Generate PBD request:', JSON.stringify(event, null, 2));

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const requestBody = JSON.parse(event.body || '{}');
    const {
      templateType = 'executive-leadership',
      industry = 'general',
      careerLevel = 'mid-level',
      customContext = '',
      includeOptionalRoles = true
    } = requestBody;

    console.log('Generating PBD template with params:', {
      templateType,
      industry,
      careerLevel,
      customContext,
      includeOptionalRoles
    });

    // Build the AI prompt for PBD template generation
    const prompt = buildPBDPrompt(templateType, industry, careerLevel, customContext, includeOptionalRoles);

    console.log('Generated prompt:', prompt);

    // Call Claude via Bedrock
    const claudeRequest = {
      modelId: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 4000,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      })
    };

    const response = await bedrock.send(new InvokeModelCommand(claudeRequest));
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    
    console.log('Claude response received');

    // Extract and parse the generated content
    let generatedContent = responseBody.content[0].text;
    
    // Try to extract JSON from the response
    let pbdTemplate;
    try {
      // Look for JSON in the response
      const jsonMatch = generatedContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        pbdTemplate = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (parseError) {
      console.warn('Could not parse JSON from response, creating structured response');
      pbdTemplate = createFallbackTemplate(templateType, industry, careerLevel);
    }

    console.log('✅ Successfully generated PBD template');

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        template: pbdTemplate,
        metadata: {
          templateType,
          industry,
          careerLevel,
          generatedAt: new Date().toISOString()
        }
      })
    };

  } catch (error) {
    console.error('❌ PBD generation error:', error);
    
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        error: 'Failed to generate PBD template',
        details: error.message
      })
    };
  }
};

function buildPBDPrompt(templateType, industry, careerLevel, customContext, includeOptionalRoles) {
  const basePrompt = `Generate a Personal Board of Directors (PBD) template for ${industry} professionals at ${careerLevel} level.

Template Type: ${templateType}
Industry: ${industry}
Career Level: ${careerLevel}
Custom Context: ${customContext || 'None provided'}
Include Optional Roles: ${includeOptionalRoles}

Please generate a comprehensive PBD template with the following structure:

{
  "title": "Template title",
  "description": "Brief description of this PBD template",
  "targetAudience": "Who this template is designed for",
  "sections": [
    {
      "id": "mission-goal",
      "title": "Mission & Career Goal",
      "description": "Define personal mission and career objectives",
      "prompts": {
        "mission": "Prompt for mission statement",
        "careerGoal": "Prompt for 12-24 month career goal"
      },
      "aiGuidance": "What AI should say to guide users through this section"
    },
    {
      "id": "board-roles",
      "title": "Board Member Roles", 
      "description": "Define each board member role",
      "roles": [
        {
          "id": "mentor",
          "title": "Mentor",
          "description": "Someone who provides guidance and wisdom",
          "tips": ["Tip 1", "Tip 2", "Tip 3"],
          "idealTraits": ["Trait 1", "Trait 2"],
          "questionPrompts": {
            "name": "Who could serve as your mentor?",
            "whyThisPerson": "Why is this person ideal for this role?",
            "whatIGive": "What value do you bring to this relationship?",
            "whatIGet": "What do you hope to gain from this relationship?"
          }
        }
      ]
    }
  ],
  "actionPlanTemplate": {
    "gapAnalysisPrompts": ["Prompt 1", "Prompt 2"],
    "nextStepsTemplate": ["Action 1", "Action 2"],
    "cadenceOptions": ["monthly", "quarterly", "ad-hoc"],
    "relationshipStages": ["strong", "forming", "needToAsk", "dontKnow"]
  }
}

Generate complete role definitions for: Mentor, Peer, Sponsor/Champion, Specialist Advisor, Challenger${includeOptionalRoles ? ', and Mentee' : ''}.

For each role, provide:
- Clear definition and purpose
- 3-4 tips for finding someone for this role
- 2-3 ideal traits to look for
- Industry-specific examples when relevant
- Thoughtful question prompts

Make the content specific to ${industry} and ${careerLevel} professionals. Include industry-relevant examples and terminology.

Return ONLY the JSON structure, no additional text.`;

  return basePrompt;
}

function createFallbackTemplate(templateType, industry, careerLevel) {
  return {
    title: `${industry} ${careerLevel} Personal Board of Directors`,
    description: `A comprehensive PBD template designed for ${careerLevel} professionals in ${industry}`,
    targetAudience: `${careerLevel} professionals in ${industry} looking to build strategic career relationships`,
    sections: [
      {
        id: "mission-goal",
        title: "Mission & Career Goal",
        description: "Define your personal mission and career objectives",
        prompts: {
          mission: "What is your personal career mission statement?",
          careerGoal: "What is your primary career goal for the next 12-24 months?"
        },
        aiGuidance: "A strong mission statement and clear goal will help you identify the right people for your board."
      },
      {
        id: "board-roles",
        title: "Board Member Roles",
        description: "Define each board member role and identify potential candidates",
        roles: [
          {
            id: "mentor",
            title: "Mentor",
            description: "Someone 2-3 levels above you who provides guidance and wisdom",
            tips: [
              "Look for someone in your desired career path",
              "Seek someone with 5-10 years more experience",
              "Find someone willing to invest in your growth"
            ],
            idealTraits: ["Experienced", "Generous with time", "Good listener"],
            questionPrompts: {
              name: "Who could serve as your mentor?",
              whyThisPerson: "Why is this person ideal for this mentoring role?",
              whatIGive: "What value and insights can you bring to this relationship?",
              whatIGet: "What guidance and wisdom do you hope to gain?"
            }
          },
          {
            id: "peer",
            title: "Peer",
            description: "Someone at your level who can collaborate and share experiences",
            tips: [
              "Look within your current organization or industry",
              "Find someone facing similar challenges",
              "Seek mutual support and accountability"
            ],
            idealTraits: ["Similar experience level", "Growth-minded", "Collaborative"],
            questionPrompts: {
              name: "Who is a valuable peer connection?",
              whyThisPerson: "Why is this person a good peer board member?",
              whatIGive: "How can you support their career growth?",
              whatIGet: "What mutual support and insights can you share?"
            }
          },
          {
            id: "sponsor",
            title: "Sponsor/Champion",
            description: "Someone with influence who actively advocates for your advancement",
            tips: [
              "Identify someone with decision-making power",
              "Build a track record of strong performance first",
              "Look for someone who already knows your work"
            ],
            idealTraits: ["Influential", "Respected", "Willing to advocate"],
            questionPrompts: {
              name: "Who could champion your career advancement?",
              whyThisPerson: "Why would this person be willing to sponsor you?",
              whatIGive: "How do you support their goals and initiatives?",
              whatIGet: "What advocacy and opportunities can they provide?"
            }
          },
          {
            id: "specialist",
            title: "Specialist Advisor",
            description: "An expert in a specific skill or domain relevant to your goals",
            tips: [
              "Identify key skills you need to develop",
              "Look for recognized experts in that area",
              "Seek someone passionate about sharing knowledge"
            ],
            idealTraits: ["Deep expertise", "Teaching mindset", "Current knowledge"],
            questionPrompts: {
              name: "Who is an expert in skills you need?",
              whyThisPerson: "What specific expertise makes them valuable?",
              whatIGive: "How can you contribute to their work or mission?",
              whatIGet: "What specialized knowledge and skills can you learn?"
            }
          },
          {
            id: "challenger",
            title: "Challenger",
            description: "Someone who pushes your thinking and challenges your assumptions",
            tips: [
              "Look for someone with a different perspective",
              "Find someone comfortable with difficult conversations",
              "Seek someone who cares about your growth"
            ],
            idealTraits: ["Direct communicator", "Different background", "Growth-focused"],
            questionPrompts: {
              name: "Who challenges your thinking constructively?",
              whyThisPerson: "How do they push you to grow and improve?",
              whatIGive: "What openness and receptivity do you bring?",
              whatIGet: "What honest feedback and new perspectives can you gain?"
            }
          }
        ]
      }
    ],
    actionPlanTemplate: {
      gapAnalysisPrompts: [
        "Which roles do you still need to fill?",
        "What relationship building do you need to prioritize?",
        "Where are your biggest networking gaps?"
      ],
      nextStepsTemplate: [
        "Identify specific individuals for each role",
        "Plan your approach for each relationship",
        "Schedule initial conversations or meetings",
        "Set regular check-in cadences"
      ],
      cadenceOptions: ["monthly", "quarterly", "ad-hoc"],
      relationshipStages: ["strong", "forming", "needToAsk", "dontKnow"]
    }
  };
}