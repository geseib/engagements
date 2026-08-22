import React, { useState, useEffect, useCallback, useRef } from 'react';
import FileUploadPrompt from './FileUploadPrompt';
import { authFetch } from '../auth/authFetch';
import { startGenerationJob, pollGenerationJob } from '../utils/aiBatchClient';
import { normalizeTags, tagsToCsvCell } from '../utils/tags';
import { csvRow, buildCsv } from '../utils/csv';
import Icon from './Icon';
import RoundKindPicker from './RoundKindPicker';
import { samplesForKind } from '../config/scenarioSamples';
import {
  roundKindApplies,
  roundKindParticipantInstruction,
  roundKindGaps,
  DEFAULT_ROUND_KIND,
} from '../config/roundKinds';
import GenerationJobPanel from './GenerationJobPanel';
import GeneratedItemsTable from './GeneratedItemsTable';
import StatusMessage from './StatusMessage';
import AIFormAssist from './AIFormAssist';
import FieldLock from './FieldLock';
import { BUILDER_FORM_FIELDS } from '../config/builderFormFields';
import {
  interpretGenerationJob,
  rememberGenerationJob,
  recallGenerationJob,
  forgetGenerationJob,
  resumeIsGone,
} from '../utils/generationJob';

const API_BASE = window.API_BASE;
const ENDPOINT = `${API_BASE}admin/ai-generate-scenarios`;

// Shared framing for wavelength generation. Wavelength is a word-association
// alignment game: the host shows a SUBJECT, every participant lists up to 10
// words for it, and the game measures how many words overlap across players.
const WAVELENGTH_SPEC = 'Create wavelength subjects for a team word-association alignment game. Each item is a single short, evocative SUBJECT (1-4 words, e.g. "Remote Work", "Customer Trust") that every participant responds to by listing up to 10 words or short phrases that come to mind; the game then measures how many words overlap across participants. Pick subjects broad enough that everyone can produce 10 associations, yet specific enough that overlap is meaningful. Mix concrete and abstract subjects. Do NOT write questions, scenarios, sentences to complete, or anything with a correct answer.';

function AIScenarioBuilder({ onClose, onScenariosGenerated, engagementType = 'call-and-answer' }) {
  const [step, setStep] = useState(1);
  const [scenarioConfig, setScenarioConfig] = useState({
    type: '',
    context: '',
    audience: '',
    difficulty: engagementType === 'trivia' ? 'medium' : 'detailed',
    count: 5,
    customPrompt: '',
    customTitle: '',
    numberOfCategories: 3,
    mustHaveCategories: '',
    // DIRECTION — what the room is asked to DO, which is not the same question
    // as the topic the cards below answer. See config/roundKinds.js.
    roundKind: DEFAULT_ROUND_KIND,
    roundKindBrief: '',
    roundKindInstruction: ''
  });
  const [generatedScenarios, setGeneratedScenarios] = useState([]);
  const [generatedMetadata, setGeneratedMetadata] = useState(null);
  const [currentScenarioIndex, setCurrentScenarioIndex] = useState(0);
  // The last poll response, in the shape jobToResponse() actually sends.
  //
  // This builder had the worst version of the bug: its catch touched
  // `partialItems` not at all, and it still reached the review UI over a failed
  // job — `onProgress` fires on the final poll, before the old throw, so
  // `generatedScenarios` was already populated and `generatedScenarios.length >
  // 0` was already true. Branching on the outcome is what fixes that.
  const [job, setJob] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [transportError, setTransportError] = useState(null);
  const [generationStatus, setGenerationStatus] = useState('');
  const [excluded, setExcluded] = useState(() => new Set());
  const [editingItem, setEditingItem] = useState(false);
  const [reviewingPartial, setReviewingPartial] = useState(false);
  // Raw text of the tag field while it is being edited. null = not editing, so
  // the input falls back to the scenario's stored tags. Normalising on every
  // keystroke would eat the hyphen out of "remote-" as it is typed.
  const [tagDraft, setTagDraft] = useState(null);
  const jobIdRef = useRef(null);
  const [availablePrompts, setAvailablePrompts] = useState([]);
  const [loadingPrompts, setLoadingPrompts] = useState(true);
  const [promptsError, setPromptsError] = useState(null);

  /*
   * FIELDS THE OPERATOR HAS LOCKED AGAINST THE AI HELPER.
   *
   * The owner: *"unless locked, a small icon lock/unlock on cells."*
   *
   * Held here rather than inside AIFormAssist because the padlocks live beside
   * these inputs and this is the component that owns the values they guard.
   * The set travels with the drafting request, where it becomes the tool schema
   * — a locked field is never offered to the model at all — and it is checked
   * again in `utils/fieldDrafting.applyFieldDraft` on the way back. A lock is
   * never merely a UI state.
   */
  const [lockedFields, setLockedFields] = useState(() => new Set());
  const toggleLock = (field) => setLockedFields((prev) => {
    const next = new Set(prev);
    if (next.has(field)) next.delete(field); else next.add(field);
    return next;
  });
  const assistForm = BUILDER_FORM_FIELDS.scenario;
  const lockFor = (field) => (
    <FieldLock
      field={field}
      label={assistForm.fields.find((f) => f.key === field).label}
      locked={lockedFields.has(field)}
      onToggle={toggleLock}
    />
  );

  // Fetch available prompts from database
  useEffect(() => {
    fetchAvailablePrompts();
  }, [engagementType]);

  const fetchAvailablePrompts = async () => {
    try {
      setLoadingPrompts(true);
      const params = new URLSearchParams({
        promptType: 'generation',
        gameType: engagementType,
        status: 'active'
      });
      
      const response = await authFetch(`${API_BASE}admin/ai-prompts?${params}`);
      const data = await response.json();
      
      if (response.ok) {
        setAvailablePrompts(data.prompts || []);
        setPromptsError(null);
      } else {
        console.error('Failed to fetch prompts:', data.error);
        setPromptsError(data.error || 'Failed to load prompts');
        setAvailablePrompts([]);
      }
    } catch (error) {
      console.error('Error fetching prompts:', error);
      setPromptsError('Failed to load prompts');
      setAvailablePrompts([]);
    } finally {
      setLoadingPrompts(false);
    }
  };

  // Define hardcoded scenario types based on engagement type (fallback if database empty)
  const getHardcodedScenarioTypes = (engagementType) => {
    switch (engagementType) {
      case 'trivia':
        return [
          {
            id: 'general-knowledge',
            title: 'General Knowledge Trivia',
            description: 'Broad knowledge questions across various topics',
            prompt: 'Create general knowledge trivia questions covering history, science, geography, and culture'
          },
          {
            id: 'subject-specific',
            title: 'Subject-Specific Trivia',
            description: 'Deep dive into a specific subject or field',
            prompt: 'Generate trivia questions focused on a specific subject area with varying difficulty levels'
          },
          {
            id: 'workplace-trivia',
            title: 'Workplace & Business Trivia',
            description: 'Business knowledge and workplace concepts',
            prompt: 'Create trivia questions about business concepts, workplace skills, and professional knowledge'
          },
          {
            id: 'fun-facts',
            title: 'Fun Facts & Interesting Trivia',
            description: 'Entertaining and surprising facts',
            prompt: 'Generate fun and interesting trivia questions with surprising facts and entertaining knowledge'
          },
          {
            id: 'custom-trivia',
            title: 'Custom Trivia Topics',
            description: 'Define your own trivia topic and requirements',
            prompt: 'Create trivia questions based on the specific topic and requirements provided'
          },
          {
            id: 'custom',
            title: 'Custom Scenarios',
            description: 'Define your own specific scenario requirements with minimal pre-prompt info',
            prompt: 'Create scenarios based on the custom requirements provided'
          }
        ];

      case 'poll':
        return [
          {
            id: 'opinion-polls',
            title: 'Opinion & Preference Polls',
            description: 'Gather opinions and preferences from participants',
            prompt: 'Create poll questions that gather opinions, preferences, and viewpoints on various topics'
          },
          {
            id: 'decision-making',
            title: 'Decision-Making Polls',
            description: 'Help teams make decisions through voting',
            prompt: 'Generate poll questions that help teams make decisions and choose between options'
          },
          {
            id: 'feedback-polls',
            title: 'Feedback & Assessment Polls',
            description: 'Collect feedback and assess understanding',
            prompt: 'Create poll questions to gather feedback, assess understanding, and measure satisfaction'
          },
          {
            id: 'icebreaker-polls',
            title: 'Icebreaker & Team Polls',
            description: 'Fun polls to break the ice and learn about team members',
            prompt: 'Generate fun and engaging poll questions that help team members get to know each other'
          },
          {
            id: 'custom-polls',
            title: 'Custom Poll Topics',
            description: 'Define your own poll topic and requirements',
            prompt: 'Create poll questions based on the specific topic and requirements provided'
          },
          {
            id: 'custom',
            title: 'Custom Scenarios',
            description: 'Define your own specific scenario requirements with minimal pre-prompt info',
            prompt: 'Create scenarios based on the custom requirements provided'
          }
        ];

      case 'wavelength':
        return [
          {
            id: 'tech-terms',
            title: 'Technology Terms',
            description: 'Technology subjects for word-association alignment',
            prompt: `${WAVELENGTH_SPEC} Draw subjects from technology and software development: languages, practices, tools, platforms, and architecture concepts.`
          },
          {
            id: 'business-concepts',
            title: 'Business Concepts',
            description: 'Business and management subjects for word-association alignment',
            prompt: `${WAVELENGTH_SPEC} Draw subjects from business, strategy, and management: markets, leadership, operations, finance, and organizational life.`
          },
          {
            id: 'industry-specific',
            title: 'Industry-Specific Terms',
            description: 'Subjects specific to your industry or domain',
            prompt: `${WAVELENGTH_SPEC} Draw subjects from the target industry or professional domain so overlapping words reveal how aligned the team's mental models are.`
          },
          {
            id: 'leadership-themes',
            title: 'Leadership & Culture',
            description: 'Leadership and culture subjects that surface team alignment',
            prompt: `${WAVELENGTH_SPEC} Draw subjects from leadership themes, company culture, and team dynamics (e.g. "Great Managers", "Our Culture", "Trust").`
          },
          {
            id: 'abstract-concepts',
            title: 'Abstract Concepts',
            description: 'Big ideas that spark rich, comparable associations',
            prompt: `${WAVELENGTH_SPEC} Draw abstract subjects (e.g. "Innovation", "Risk", "Success") that every participant can associate with and that reveal how differently people think about big ideas.`
          },
          {
            id: 'lists-favorites',
            title: 'Everyday Life & Interests',
            description: 'Everyday life and personal interest subjects for word association',
            prompt: `${WAVELENGTH_SPEC} Draw subjects from everyday life and personal interests: entertainment, food, travel, hobbies, and shared experiences (e.g. "Road Trips", "Comfort Food") so participants can compare their spontaneous associations.`
          },
          {
            id: 'brainstorming',
            title: 'Work & Team Priorities',
            description: 'Work-life subjects that reveal shared team priorities',
            prompt: `${WAVELENGTH_SPEC} Draw subjects from the team's working life: products, processes, challenges, goals, and opportunities (e.g. "Our Next Launch", "Team Meetings") so overlapping words reveal shared priorities.`
          },
          {
            id: 'team-building',
            title: 'Team Building & Culture',
            description: 'Shared experiences and team connections',
            prompt: `${WAVELENGTH_SPEC} Draw subjects around shared team experiences, values, and goals (e.g. "Our Team", "Winning Together", "Onboarding") so the overlap shows what the team holds in common.`
          },
          {
            id: 'reflection-retrospective',
            title: 'Reflection & Learning',
            description: 'Reflection subjects for lessons learned and growth',
            prompt: `${WAVELENGTH_SPEC} Draw reflective subjects about lessons, growth, and change (e.g. "Last Quarter", "Feedback", "Lessons Learned") so overlapping words reveal shared takeaways.`
          },
          {
            id: 'icebreakers-fun',
            title: 'Icebreakers & Fun',
            description: 'Fun, relatable subjects for playful word association',
            prompt: `${WAVELENGTH_SPEC} Draw fun, universally relatable subjects (e.g. "Monday Mornings", "Office Coffee", "Summer Vacation") that spark playful associations and easy laughs when the overlap is revealed.`
          },
          {
            id: 'custom',
            title: 'Custom Subjects',
            description: 'Define your own subjects for word association',
            prompt: `${WAVELENGTH_SPEC} Draw subjects from the custom topics provided.`
          }
        ];
      case 'call-and-answer':
      default:
        return [
          {
            id: 'lessons-learned',
            title: 'Lessons Learned Scenarios',
            description: 'Real-world situations where teams learned valuable lessons',
            prompt: 'Create scenarios based on common workplace challenges and the lessons learned from them'
          },
          {
            id: 'problem-solving',
            title: 'Problem-Solving Challenges',
            description: 'Current problems your team is tackling that need solutions',
            prompt: 'Generate problem scenarios that require creative thinking and collaborative solutions'
          },
          {
            id: 'interview-prep',
            title: 'Interview Preparation',
            description: 'Practice questions for job interviews and assessments',
            prompt: 'Create interview-style questions that help candidates prepare and practice their responses'
          },
          {
            id: 'amazon-principles',
            title: 'Amazon Leadership Principles',
            description: 'Scenarios based on Amazon\'s 16 Leadership Principles',
            prompt: 'Generate scenarios that explore Amazon Leadership Principles through real-world situations'
          },
          {
            id: 'team-building',
            title: 'Team Building Exercises',
            description: 'Scenarios that promote team collaboration and communication',
            prompt: 'Create team-building scenarios that encourage discussion and collaboration'
          },
          {
            id: 'custom',
            title: 'Custom Scenarios',
            description: 'Define your own specific scenario requirements',
            prompt: 'Create scenarios based on the custom requirements provided'
          }
        ];
    }
  };

  // Combine database prompts with hardcoded types (additive, not replacement)
  const getScenarioTypes = (engagementType) => {
    const hardcodedTypes = getHardcodedScenarioTypes(engagementType);
    
    // Each database prompt gets its own card with unique ID
    const databaseTypes = availablePrompts.map(prompt => ({
      id: `db-${prompt.SK}`, // Use unique database ID
      title: prompt.name,
      description: prompt.description,
      prompt: prompt.basePrompt,
      source: 'database',
      dbPrompt: prompt // Store full prompt data for pre-filling form
    }));
    
    // Start with database prompts (each gets its own card)
    const combined = [...databaseTypes];
    
    // Add hardcoded types, but skip any that would duplicate database functionality
    hardcodedTypes.forEach(hardcoded => {
      // Always add the generic "custom" option for starting from scratch
      if (hardcoded.id === 'custom') {
        combined.push({ ...hardcoded, source: 'hardcoded' });
      } else {
        // Add other hardcoded types only if they don't have database equivalents
        const hasDbEquivalent = databaseTypes.some(db => db.dbPrompt.scenarioType === hardcoded.id);
        if (!hasDbEquivalent) {
          combined.push({ ...hardcoded, source: 'hardcoded' });
        }
      }
    });
    
    return combined;
  };

  const scenarioTypes = getScenarioTypes(engagementType);

  // Get template defaults from selected scenario type (database prompt or hardcoded)
  const getTemplateDefaults = (scenarioTypeId) => {
    // Find the selected scenario type
    const selectedType = scenarioTypes.find(t => t.id === scenarioTypeId);
    
    if (selectedType && selectedType.source === 'database' && selectedType.dbPrompt) {
      // Pre-fill with database prompt information
      const prompt = selectedType.dbPrompt;
      return {
        customTitle: prompt.name,
        context: prompt.description || '', // Use the prompt's description as context
        audience: '', // Leave blank for admin to specify
        numberOfCategories: prompt.defaultSettings?.numberOfCategories || 3,
        mustHaveCategories: prompt.defaultSettings?.mustHaveCategories || '',
        difficulty: prompt.defaultSettings?.difficulty || (engagementType === 'trivia' ? 'medium' : 'detailed'),
        customPrompt: prompt.basePrompt || '' // Pre-fill with the base prompt so admin can see and edit
      };
    }
    
    // Fallback for hardcoded types or when no database prompt found
    return {
      customTitle: selectedType?.title || 'Custom Session',
      context: '',
      audience: '',
      numberOfCategories: 3,
      mustHaveCategories: '',
      difficulty: engagementType === 'trivia' ? 'medium' : 'detailed',
      customPrompt: ''
    };
  };

  /**
   * Is the direction complete enough to generate with?
   *
   * Only `custom` can be incomplete: it has no house direction and no house
   * participant instruction, so an empty brief would send the generator a
   * prompt with a hole where the direction should be, and an empty instruction
   * would put a blank line in front of the room. The four named kinds are
   * always complete, which is why this is empty for them.
   */
  const kindGaps = roundKindApplies(engagementType)
    ? roundKindGaps(scenarioConfig.roundKind, {
      brief: scenarioConfig.roundKindBrief,
      instruction: scenarioConfig.roundKindInstruction,
    })
    : [];

  const handleTypeSelection = (type) => {
    // Refused here rather than at Generate: picking a topic is the step that
    // leaves this screen, and an incomplete direction is not recoverable from
    // the next one — the picker does not live there.
    if (kindGaps.length > 0) return;
    const templateDefaults = getTemplateDefaults(type);
    setScenarioConfig(prev => ({
      ...prev,
      type,
      ...templateDefaults
    }));
    setStep(2);
  };

  /*
    A SAMPLE IDEA is a template selection plus a prefilled brief. The card the
    operator tapped picks the best-fitting template under the hood
    (sample.templateId — a database template with that scenarioType supersedes
    the hardcoded one automatically) and lands them on step 2 with the
    sample's context already written, all of it editable. Its title becomes
    the working title; the template's own name would be record-speak here.
  */
  const handleSampleSelection = (sample) => {
    if (kindGaps.length > 0) return;
    /*
      THE templateId NAMES A KIND OF TEMPLATE, NOT A CARD ID — and the two
      diverge exactly when a database template exists: getScenarioTypes gives
      each db prompt a unique `db-<SK>` id and REMOVES the hardcoded card it
      supersedes, so `type: 'lessons-learned'` matched nothing at generate
      time and the run died on `selectedType.prompt` of undefined ("Lost
      contact with the job", live on dev, produce / Hard-won lessons).
      Resolve through the same supersession: the db card whose scenarioType
      matches, else the surviving hardcoded card, else the custom canvas.
    */
    const resolved = scenarioTypes.find((t) => t.dbPrompt?.scenarioType === sample.templateId)
      || scenarioTypes.find((t) => t.id === sample.templateId)
      || scenarioTypes.find((t) => t.id === 'custom')
      || scenarioTypes.find((t) => /custom/.test(t.id));
    if (!resolved) return;
    const templateDefaults = getTemplateDefaults(resolved.id);
    setScenarioConfig(prev => ({
      ...prev,
      type: resolved.id,
      ...templateDefaults,
      context: sample.context,
      customTitle: sample.title,
    }));
    setStep(2);
  };

  /** See TriviaAIBuilder.watchJob — same contract, same reasons. */
  const watchJob = useCallback(async (jobId) => {
    jobIdRef.current = jobId;
    setIsGenerating(true);
    setTransportError(null);
    setStep(3);
    try {
      const terminal = await pollGenerationJob(ENDPOINT, jobId, {
        label: 'Generation',
        onStatus: setGenerationStatus,
        // Show partial results as they land rather than a spinner for minutes.
        onProgress: (update) => {
          setJob(update);
          if (Array.isArray(update.items) && update.items.length > 0) {
            setGeneratedScenarios(update.items);
          }
        }
      });
      setJob(terminal);
      setGeneratedScenarios(Array.isArray(terminal.items) ? terminal.items : []);
      setGeneratedMetadata(null); // Will be generated later
      setCurrentScenarioIndex(0);
    } catch (error) {
      console.error('AI generation error:', error);
      if (resumeIsGone(error)) {
        forgetGenerationJob(ENDPOINT);
        jobIdRef.current = null;
        setJob(null);
        setStep(2);
        setGenerationStatus('That job has expired — generation jobs are readable for three days. Start a new one.');
      } else {
        // Keep the stored id: the worker may still be running.
        setTransportError(error.message);
      }
    } finally {
      setIsGenerating(false);
    }
  }, []);

  useEffect(() => {
    const stored = recallGenerationJob(ENDPOINT);
    if (!stored) return;
    setGenerationStatus('Reconnecting to the job you left…');
    watchJob(stored.jobId);
  }, [watchJob]);

  const dismissJob = () => {
    forgetGenerationJob(ENDPOINT);
    jobIdRef.current = null;
  };

  const backToConfiguration = () => {
    dismissJob();
    setJob(null);
    setTransportError(null);
    setGenerationStatus('');
    setGeneratedScenarios([]);
    setExcluded(new Set());
    setEditingItem(false);
    setReviewingPartial(false);
    setStep(2);
  };

  const retryRemaining = (remaining) => {
    setScenarioConfig(prev => ({ ...prev, count: Math.max(1, remaining || prev.count) }));
    backToConfiguration();
  };

  const toggleExcluded = (index) => {
    setExcluded(prev => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index); else next.add(index);
      return next;
    });
  };

  const handleConfigSubmit = async () => {
    console.log('🤖 Starting AI scenario generation...', scenarioConfig);
    setIsGenerating(true);
    setGenerationStatus('Generating scenarios with AI...');
    setTransportError(null);
    setJob(null);
    setGeneratedScenarios([]);
    setExcluded(new Set());
    setEditingItem(false);
    setReviewingPartial(false);
    setStep(3);

    try {
      const selectedType = scenarioTypes.find(t => t.id === scenarioConfig.type);
      let basePrompt;
      
      if (selectedType && selectedType.source === 'database' && selectedType.dbPrompt) {
        // Use database prompt with templates
        const selectedPrompt = selectedType.dbPrompt;
        basePrompt = selectedPrompt.basePrompt;
        
        // Apply templates if provided (custom prompts may have empty templates)
        if (scenarioConfig.context && selectedPrompt.contextTemplate) {
          basePrompt += selectedPrompt.contextTemplate.replace('{context}', scenarioConfig.context);
        } else if (scenarioConfig.context && !selectedPrompt.contextTemplate) {
          // For minimal custom prompts, add context directly
          basePrompt += `\n\nContext: ${scenarioConfig.context}`;
        }
        
        if (scenarioConfig.audience && selectedPrompt.audienceTemplate) {
          basePrompt += selectedPrompt.audienceTemplate.replace('{audience}', scenarioConfig.audience);
        } else if (scenarioConfig.audience && !selectedPrompt.audienceTemplate) {
          // For minimal custom prompts, add audience directly
          basePrompt += `\nAudience: ${scenarioConfig.audience}`;
        }
        
        if (selectedPrompt.categoryTemplate) {
          let categoryText = selectedPrompt.categoryTemplate;
          categoryText = categoryText.replace('{numberOfCategories}', scenarioConfig.numberOfCategories);
          if (scenarioConfig.mustHaveCategories) {
            categoryText = categoryText.replace('{mustHaveCategories}', scenarioConfig.mustHaveCategories);
          }
          basePrompt += categoryText;
        } else {
          // For minimal custom prompts, add category info directly if needed
          if (scenarioConfig.numberOfCategories > 1) {
            basePrompt += `\nNumber of categories needed: ${scenarioConfig.numberOfCategories}`;
          }
          if (scenarioConfig.mustHaveCategories) {
            basePrompt += `\nMust include these categories: ${scenarioConfig.mustHaveCategories}`;
          }
        }
        
        // Add difficulty/detail level
        const levelLabel = engagementType === 'trivia' ? 'Difficulty Level' : 'Level of Detail';
        basePrompt += `\n\n${levelLabel}: ${scenarioConfig.difficulty}`;
        
      } else {
        // Fallback to hardcoded prompt structure. `selectedType?.` and a
        // last-resort instruction, so a type id that matches no card degrades
        // to a custom-style run instead of killing the job on `.prompt` of
        // undefined — the "Lost contact with the job" failure.
        basePrompt = (selectedType && selectedType.prompt)
          || 'Create scenarios based on the custom requirements provided';
        if (scenarioConfig.context) {
          basePrompt += `\n\nContext: ${scenarioConfig.context}`;
        }
        if (scenarioConfig.audience) {
          basePrompt += `\nAudience: ${scenarioConfig.audience}`;
        }
        
        const levelLabel = engagementType === 'trivia' ? 'Difficulty Level' : 'Level of Detail';
        basePrompt += `\n\n${levelLabel}: ${scenarioConfig.difficulty}`;
        basePrompt += `\nNumber of categories needed: ${scenarioConfig.numberOfCategories}`;
        
        if (scenarioConfig.mustHaveCategories) {
          basePrompt += `\nMust include these categories: ${scenarioConfig.mustHaveCategories}`;
        }
      }

      if (scenarioConfig.customPrompt) {
        basePrompt += `\n\nAdditional Requirements: ${scenarioConfig.customPrompt}`;
      }

      // Generation runs as an ASYNCHRONOUS JOB, not inside this request.
      //
      // It used to fan out one Bedrock call per scenario — twenty calls for
      // twenty scenarios — because each call had to finish inside API Gateway's
      // hard 30s integration timeout. It never did: CloudWatch put this endpoint
      // at 28.4s average and 40.1s maximum, so the gateway returned its own 503
      // while the Lambda was still working, and retrying only repeated it. The
      // per-call floor was already 1700 output tokens (~38s), so no batch size
      // could have fitted.
      //
      // The endpoint now returns a jobId immediately and we poll. One call can
      // then write every scenario at once, which is also what stops the
      // duplicates: twenty parallel calls were each blind to the other nineteen.
      const backendScenarioType = selectedType?.source === 'database' && selectedType.dbPrompt
        ? selectedType.dbPrompt.scenarioType
        : scenarioConfig.type;

      const { jobId } = await startGenerationJob(ENDPOINT, {
        scenarioType: backendScenarioType,
        engagementType: engagementType,
        prompt: basePrompt,
        count: scenarioConfig.count,
        difficulty: scenarioConfig.difficulty,
        context: scenarioConfig.context,
        audience: scenarioConfig.audience,
        customPrompt: scenarioConfig.customPrompt,
        customTitle: scenarioConfig.customTitle,
        numberOfCategories: scenarioConfig.numberOfCategories,
        mustHaveCategories: scenarioConfig.mustHaveCategories,
        // DIRECTION. The backend puts this IN FRONT OF the topic's basePrompt,
        // because basePrompt used to be the first thing the model read and
        // first is what a model follows — which is why typing an Apply brief
        // into "Additional Requirements" never changed the shape of the output.
        roundKind: scenarioConfig.roundKind,
        roundKindBrief: scenarioConfig.roundKindBrief,
        // THE SET'S OWN COPY, COMPUTED HERE AND SENT WITH THE REQUEST.
        //
        // The worker creates the question set itself now — that is the fix for
        // "Close — this keeps running", which was true about the job and false
        // about the outcome — and it needs the title, description and the two
        // instruction fields to do it. They are computed in the browser rather
        // than re-derived in the Lambda because only the browser holds the
        // pieces: the operator's own participant instruction for a `custom`
        // round kind, the chosen topic card's title, the STAR addendum. A
        // second server-side implementation of generateCustomInstructions()
        // would drift from this one on the first change to either.
        setMetadata: {
          title: generateTitle(),
          description: generateDescription(),
          customInstructions: generateCustomInstructions(),
          aiContextInstructions: generateAIContextInstructions()
        }
      }, { label: 'Generation', onStatus: setGenerationStatus });

      rememberGenerationJob(ENDPOINT, jobId, { scenarioType: backendScenarioType });
      await watchJob(jobId);
    } catch (error) {
      console.error('AI generation error:', error);
      setIsGenerating(false);
      setTransportError(error.message);
    }
  };

  const handleScenarioEdit = (index, field, value) => {
    const updatedScenarios = [...generatedScenarios];
    updatedScenarios[index] = { ...updatedScenarios[index], [field]: value };
    setGeneratedScenarios(updatedScenarios);
  };

  const handleExportCSV = () => {
    const csvContent = generateCSVContent();
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    
    // Use a meaningful filename based on the selected type
    const selectedType = scenarioTypes.find(t => t.id === scenarioConfig.type);
    const typeName = selectedType?.title?.replace(/[^a-zA-Z0-9]/g, '-') || 'scenarios';
    a.download = `${typeName}-scenarios-${Date.now()}.csv`;
    
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const generateCSVContent = () => {
    const headers = 'Category,Question#,Title,Detail_lesson,School,CustomInstruction,Tags';

    // First, group scenarios by category. Excluded rows are excluded
    // everywhere — exporting one the operator just dropped would make the CSV
    // and the set disagree.
    const scenariosByCategory = {};
    keptScenarios.forEach(scenario => {
      const category = scenario.category || 'AI Generated';
      if (!scenariosByCategory[category]) {
        scenariosByCategory[category] = [];
      }
      scenariosByCategory[category].push(scenario);
    });

    // Generate CSV rows with proper category-relative numbering
    const rows = [];
    Object.keys(scenariosByCategory).forEach(category => {
      scenariosByCategory[category].forEach((scenario, index) => {
        const questionNumber = index + 1; // Category-relative numbering
        rows.push(csvRow([
          category,
          questionNumber,
          scenario.title,
          scenario.detail,
          scenario.school || 'Professional Development',
          scenario.customInstructions || '',
          tagsToCsvCell(scenario.tags)
        ]));
      });
    });

    return buildCsv(headers, rows);
  };

  /**
   * The worker already made the set. Take the operator to it and write nothing.
   *
   * THIS IS THE NO-DOUBLE-CREATION RULE, on the client side of it. The job
   * record carries `createdSet` as soon as the worker has created it, and it is
   * written BEFORE the job goes terminal, so a terminal job either has a set or
   * genuinely has none. Posting to /admin/upload-questions here as well would
   * be refused (the importer will not overwrite an existing set) and would
   * report that refusal as a failure over a set that exists.
   */
  const handleOpenCreatedSet = () => {
    dismissJob();
    onScenariosGenerated({ createdSet: interpreted.createdSet });
  };

  const handleLoadIntoSystem = () => {
    // Use AI-generated metadata if available, otherwise generate from configuration
    const metadata = generatedMetadata || {
      title: generateTitle(),
      description: generateDescription(),
      customInstructions: generateCustomInstructions(),
      aiContextInstructions: generateAIContextInstructions()
    };

    dismissJob();
    onScenariosGenerated({
      scenarios: keptScenarios,
      metadata: metadata,
      // The set's DIRECTION travels with it to /admin/upload-questions. Without
      // this the kind would steer the generation and then be forgotten at the
      // moment the set is created, so the library, the editor and every later
      // regeneration would believe the set was Produce.
      roundKind: scenarioConfig.roundKind,
      roundKindBrief: scenarioConfig.roundKindBrief
    });
  };

  // Generate contextual title based on scenario type and content
  const generateTitle = () => {
    // Use custom title if provided, otherwise generate from scenario type
    if (scenarioConfig.customTitle && scenarioConfig.customTitle.trim()) {
      return scenarioConfig.customTitle.trim();
    }

    // Find the selected type and use its title
    const selectedType = scenarioTypes.find(t => t.id === scenarioConfig.type);
    const typeName = selectedType?.title || 'Professional Development';
    const audienceText = scenarioConfig.audience ? ` for ${scenarioConfig.audience}` : '';

    return `${typeName}${audienceText}`;
  };

  // Generate contextual description
  const generateDescription = () => {
    const contextText = scenarioConfig.context ? ` Context: ${scenarioConfig.context.substring(0, 100)}${scenarioConfig.context.length > 100 ? '...' : ''}` : '';
    const audienceText = scenarioConfig.audience ? ` Target audience: ${scenarioConfig.audience}.` : '';

    // NO COUNT IN THE SENTENCE. It used to open with
    // `${generatedScenarios.length} AI-generated scenarios`, which only worked
    // because this ran after generation. It now also runs BEFORE it, at the
    // moment the job is started, so the worker can name the set it creates —
    // and at that point the count is zero. A description that says "0
    // AI-generated scenarios" over eighteen of them is worse than one that
    // does not count at all, and the real number is on the set already as
    // questionCount.
    return `AI-generated scenarios for ${scenarioConfig.difficulty} difficulty level.${audienceText}${contextText}`;
  };

  /**
   * WHAT THE ROOM IS TOLD WHILE IT ANSWERS — derived from the round KIND.
   *
   * THIS IS THE LINE THAT PRODUCED THE REPORTED DEFECT. It used to be a
   * hardcoded map keyed on the scenario TYPE, with this fallback for every type
   * outside its six keys — which is every database prompt and every "something
   * else":
   *
   *     'Engage thoughtfully with each scenario and share your experiences
   *      and insights.'
   *
   * The importer stamps this string onto every question that carries no
   * instruction of its own (upload-questions.js) and the room reads it during
   * ASK. So a round that had just handed people a passage about somebody else's
   * surgical checklists told them to draw on their own experience. The set was
   * not confusing because the questions were bad; it was confusing because the
   * instruction was answering a different question from the one on screen.
   *
   * The kind is the only thing that knows what the participant is holding, so
   * the kind writes this line. The scenario type does not, and must not: a
   * topic-keyed map here is exactly the defect, whatever its contents.
   */
  const generateCustomInstructions = () => {
    // Wavelength takes no round kind — the room is handed a bare subject and
    // lists associations, so "invention" and "verdict" mean nothing for it.
    // Its one instruction is a property of the game, not of a direction.
    if (engagementType === 'wavelength') {
      return 'Enter up to 10 words or short phrases that come to mind when you think about this subject.';
    }

    const base = roundKindParticipantInstruction(
      scenarioConfig.roundKind,
      scenarioConfig.roundKindInstruction
    );

    // A topic may ADD a format note on top of the direction. It may never
    // replace it and there is deliberately NO FALLBACK ENTRY: an unrecognised
    // topic contributes nothing, which is the whole difference between this map
    // and the one it replaced. STAR is the only survivor of the old six because
    // it is the only one that described a FORMAT rather than a direction — the
    // other five were all doing the round kind's job, badly, from the wrong
    // axis. Do not restore them and do not give this map a `||` default.
    const selectedType = scenarioTypes.find(t => t.id === scenarioConfig.type);
    const actualScenarioType = selectedType?.source === 'database' && selectedType.dbPrompt
      ? selectedType.dbPrompt.scenarioType
      : scenarioConfig.type;
    const addendum = { 'amazon-principles': 'Use the STAR format: Situation, Task, Action, Results.' }[actualScenarioType];

    return [base, addendum].filter(Boolean).join(' ');
  };

  // Generate AI context instructions
  const generateAIContextInstructions = () => {
    const audienceContext = scenarioConfig.audience ? ` The target audience is ${scenarioConfig.audience}.` : '';
    const difficultyContext = ` These are ${scenarioConfig.difficulty}-level scenarios.`;
    
    // Check if it's Amazon Leadership Principles for special context
    const selectedType = scenarioTypes.find(t => t.id === scenarioConfig.type);
    const actualScenarioType = selectedType?.source === 'database' && selectedType.dbPrompt 
      ? selectedType.dbPrompt.scenarioType 
      : scenarioConfig.type;
    const typeContext = actualScenarioType === 'amazon-principles' ? ' Focus on Amazon Leadership Principles and STAR format responses.' : '';

    return `These scenarios are designed for professional development and learning.${audienceContext}${difficultyContext}${typeContext} Provide constructive feedback and encourage specific, detailed responses.`;
  };

  const navigateScenario = (direction) => {
    // Drop any in-flight tag edit; it belongs to the scenario being left.
    setTagDraft(null);
    if (direction === 'prev' && currentScenarioIndex > 0) {
      setCurrentScenarioIndex(currentScenarioIndex - 1);
    } else if (direction === 'next' && currentScenarioIndex < generatedScenarios.length - 1) {
      setCurrentScenarioIndex(currentScenarioIndex + 1);
    }
  };

  const currentScenario = generatedScenarios[currentScenarioIndex];
  const keptScenarios = generatedScenarios.filter((_, index) => !excluded.has(index));

  const interpreted = interpretGenerationJob(job);
  const reviewing = !isGenerating && !transportError
    && (interpreted.outcome === 'complete'
      || (interpreted.outcome === 'partial' && reviewingPartial));

  /** A scenario with no prompt text is nothing a room can respond to. */
  const scenarioDefect = (scenario) => {
    if (!String(scenario?.title || '').trim()) return 'No title.';
    if (!String(scenario?.detail || '').trim()) return 'No scenario text — there is nothing for the room to respond to.';
    return null;
  };

  // Helper functions for context-aware placeholders
  const getContextPlaceholder = () => {
    const selectedType = scenarioTypes.find(t => t.id === scenarioConfig.type);
    if (selectedType && selectedType.source === 'database' && selectedType.dbPrompt) {
      const prompt = selectedType.dbPrompt;
      // Use database-stored context placeholder if available
      if (prompt.defaultSettings?.contextPlaceholder) {
        return prompt.defaultSettings.contextPlaceholder;
      }
      // Fallback to prompt-specific defaults
      if (prompt.scenarioType === 'amazon-principles') {
        return 'e.g., Startup environment, large enterprise, remote team...';
      } else if (prompt.scenarioType === 'interview-prep') {
        return 'e.g., Software engineering roles, management positions, entry-level...';
      }
    }
    return 'Describe the context, industry, or specific situation...';
  };

  const getAudiencePlaceholder = () => {
    const selectedType = scenarioTypes.find(t => t.id === scenarioConfig.type);
    if (selectedType && selectedType.source === 'database' && selectedType.dbPrompt) {
      const prompt = selectedType.dbPrompt;
      // Use database-stored audience placeholder if available
      if (prompt.defaultSettings?.audiencePlaceholder) {
        return prompt.defaultSettings.audiencePlaceholder;
      }
      // Fallback to prompt-specific defaults
      if (prompt.scenarioType === 'amazon-principles') {
        return 'e.g., Engineering managers, senior engineers, leadership team...';
      } else if (prompt.scenarioType === 'interview-prep') {
        return 'e.g., Job candidates, hiring managers, recent graduates...';
      }
    }
    return 'e.g., Software Engineers, Managers, New Hires...';
  };

  const getMustHaveCategoriesPlaceholder = () => {
    const selectedType = scenarioTypes.find(t => t.id === scenarioConfig.type);
    if (selectedType && selectedType.source === 'database' && selectedType.dbPrompt) {
      const prompt = selectedType.dbPrompt;
      // Use database-stored sample categories if available
      if (prompt.defaultSettings?.sampleCategories) {
        return prompt.defaultSettings.sampleCategories;
      }
      // Fallback to prompt-specific defaults
      if (prompt.scenarioType === 'amazon-principles') {
        return 'Customer Obsession, Ownership, Invent and Simplify...';
      }
    }
    return 'Leadership, Management, Communication...';
  };

  return (
    <div className="ai-scenario-builder-modal">
      <div className="modal-overlay" onClick={onClose}></div>
      <div className="modal-content scenario-builder" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2><Icon name="Sparkle" weight="duotone" size={16} color="var(--primary)" /> AI {engagementType === 'trivia' ? 'Trivia' : engagementType === 'poll' ? 'Poll' : engagementType === 'wavelength' ? 'Wavelength' : 'Scenario'} Builder</h2>
          <button className="close-button" onClick={onClose}><Icon name="X" weight="bold" size={16} color="currentColor" /></button>
        </div>

        <div className="modal-body">
          {step === 1 && (
            <div className="scenario-type-selection">
              {/*
                TWO CONTROLS, NOT ONE, AND IN THIS ORDER.

                Direction first, topic second. They are different questions —
                "what does the room DO" and "what is it ABOUT" — and conflating
                them into the topic cards alone is the defect this slice
                repairs: every built-in topic is reflection-shaped, so an
                operator who wanted "here is somebody else's material, land it
                here" had one lever and it steered the wrong axis.

                Direction leads because it changes what a good topic answer even
                looks like, and because the generator reads it first for the
                same reason. Wavelength renders no picker: it hands the room a
                bare subject and asks for word associations, so no direction
                applies to it (config/roundKinds.js).
              */}
              {roundKindApplies(engagementType) && (
                <section className="round-kind-step">
                  <h3 id="round-kind-heading">What will the room do with each one?</h3>
                  <p className="step-lede">
                    This is the direction, not the subject. It decides whether people are
                    inventing an answer, working on material you hand them, or delivering a
                    verdict — and it is what makes the questions and the on-screen
                    instruction agree with each other.
                  </p>
                  <RoundKindPicker
                    headingId="round-kind-heading"
                    value={scenarioConfig.roundKind}
                    onChange={(roundKind) => setScenarioConfig(prev => ({ ...prev, roundKind }))}
                    brief={scenarioConfig.roundKindBrief}
                    onBriefChange={(roundKindBrief) => setScenarioConfig(prev => ({ ...prev, roundKindBrief }))}
                    instruction={scenarioConfig.roundKindInstruction}
                    onInstructionChange={(roundKindInstruction) => setScenarioConfig(prev => ({ ...prev, roundKindInstruction }))}
                  />
                </section>
              )}

              {/*
                THE SECOND QUESTION NOW ANSWERS THE FIRST. This heading used to
                read "What type of scenarios do you want to create?" over a
                wall of template cards that ignored the direction just chosen —
                two abstract taxonomies in a row, the second in record-speak
                ("Lessons Learned - Strategic Insights"). The owner: "those
                seem odd after you pick produce/apply/improve... these could
                be sample idea, so they understand."

                On call-and-answer the samples lead: three concrete briefs per
                direction (config/scenarioSamples.js), switching with the kind,
                each prefilling the next step. The templates remain below as
                the quieter second route — they are real (admins tune them)
                but they are a means, not the question. Other engagement types
                have no direction picker and keep the template cards as their
                primary, unchanged.
              */}
              {roundKindApplies(engagementType)
                && samplesForKind(scenarioConfig.roundKind).length > 0 && (
                <section className="scenario-samples" data-testid="scenario-samples">
                  <h3>Some ideas for this kind of round — tap one to start from it</h3>
                  <p className="step-lede">
                    Each one prefills the next step. Everything stays editable.
                  </p>
                  <div className={`scenario-types-grid${kindGaps.length > 0 ? ' is-blocked' : ''}`}>
                    {samplesForKind(scenarioConfig.roundKind).map((sample) => (
                      <div
                        key={sample.id}
                        className="scenario-type-card"
                        data-testid="scenario-sample-card"
                        aria-disabled={kindGaps.length > 0 || undefined}
                        onClick={() => handleSampleSelection(sample)}
                      >
                        <h4>{sample.title}</h4>
                        <p>{sample.description}</p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <h3>
                {/* "Or" only when samples are actually above it — the custom
                    direction shows none (its author has already said what
                    they want), and an "Or" with no first option reads broken. */}
                {roundKindApplies(engagementType)
                  ? `${samplesForKind(scenarioConfig.roundKind).length > 0 ? 'Or start' : 'Start'} from a template`
                  : `What type of ${engagementType === 'trivia' ? 'trivia questions' : engagementType === 'poll' ? 'poll questions' : engagementType === 'wavelength' ? 'wavelength topics' : 'scenarios'} do you want to create?`}
              </h3>

              {loadingPrompts ? (
                <div className="loading-prompts">
                  <div className="spinner"></div>
                  <p>Loading available prompt templates...</p>
                </div>
              ) : promptsError ? (
                <div className="prompts-error">
                  <p><Icon name="Warning" weight="fill" size={16} color="var(--primary)" /> {promptsError}</p>
                  <p>Using default templates as fallback.</p>
                  <button onClick={fetchAvailablePrompts} className="btn-secondary">
                    Retry Loading
                  </button>
                </div>
              ) : availablePrompts.length === 0 ? (
                <div className="no-prompts">
                  <p><Icon name="Info" weight="fill" size={16} color="var(--secondary)" /> No database prompts found for {engagementType}. Using default templates.</p>
                </div>
              ) : null}
              
              <div className={`scenario-types-grid${kindGaps.length > 0 ? ' is-blocked' : ''}`}>
                {scenarioTypes.map(type => (
                  <div
                    key={type.id}
                    className="scenario-type-card"
                    aria-disabled={kindGaps.length > 0 || undefined}
                    onClick={() => handleTypeSelection(type.id)}
                  >
                    <h4>{type.title}</h4>
                    <p>{type.description}</p>
                    {type.source === 'database' && (
                      <span className="prompt-source"><Icon name="ChartBar" weight="duotone" size={16} color="var(--primary)" /> Database Template</span>
                    )}
                    {type.source === 'hardcoded' && (
                      <span className="prompt-source"><Icon name="Buildings" weight="bold" size={16} color="currentColor" /> Built-in Template</span>
                    )}
                  </div>
                ))}
              </div>

              {/*
                THE DOOR THAT NEEDS NO CARD. The owner: "they need to be able
                to proceed without selecting something else." Until now the
                only way off this step was clicking a sample or a template —
                an operator who had picked their direction and just wanted to
                describe things themselves was forced through somebody else's
                framing first. This continues with the bare custom canvas:
                nothing prefilled, next step empty and theirs. Same kindGaps
                refusal as every card — an incomplete custom direction is not
                recoverable from step 2.
              */}
              {(() => {
                const blank = scenarioTypes.find((t) => t.id === 'custom')
                  || scenarioTypes.find((t) => /custom/.test(t.id));
                if (!blank) return null;
                return (
                  <div className="scenario-continue-row">
                    <button
                      type="button"
                      className="btn-secondary"
                      data-testid="scenario-continue-blank"
                      disabled={kindGaps.length > 0}
                      onClick={() => handleTypeSelection(blank.id)}
                    >
                      {'Or just continue — describe it yourself on the next step →'}
                    </button>
                  </div>
                );
              })()}
            </div>
          )}

          {step === 2 && (
            <div className="scenario-configuration">
              <h3>Configure Your {engagementType === 'trivia' ? 'Trivia Questions' : engagementType === 'poll' ? 'Poll Questions' : engagementType === 'wavelength' ? 'Wavelength Prompts' : 'Scenarios'}</h3>
              {/* Only ever set on this step by the resume path, when the stored
                  job id has outlived the job record's three-day TTL. */}
              <StatusMessage message={generationStatus} tone="pending" />

              {/*
                THE AI HELPER, ahead of the fields it writes into. The realistic
                case the owner described is an operator who has filled in the
                Context box and wants the rest proposed — so the offer belongs
                where they are about to give up, not at the bottom of the form.
              */}
              <AIFormAssist
                formId={assistForm.formId}
                fields={assistForm.fields}
                seed={assistForm.seed}
                values={scenarioConfig}
                locked={lockedFields}
                onApply={(patch) => setScenarioConfig(prev => ({ ...prev, ...patch }))}
                hints={[
                  `The operator asked for ${scenarioConfig.numberOfCategories} categories.`,
                  `Level of detail: ${scenarioConfig.difficulty}.`,
                  scenarioTypes.find(t => t.id === scenarioConfig.type)
                    ? `Topic card chosen: ${scenarioTypes.find(t => t.id === scenarioConfig.type).title}.`
                    : ''
                ].filter(Boolean)}
              />

              <div className="config-form">
                <div className="form-group">
                  <div className="label-row">
                    <label>Question Set Title</label>
                    {lockFor('customTitle')}
                  </div>
                  <input
                    type="text"
                    value={scenarioConfig.customTitle}
                    onChange={(e) => setScenarioConfig(prev => ({ ...prev, customTitle: e.target.value }))}
                    placeholder={`Enter a title for your ${engagementType === 'trivia' ? 'trivia set' : engagementType === 'poll' ? 'poll set' : engagementType === 'wavelength' ? 'wavelength set' : 'question set'}...`}
                  />
                </div>

                <div className="form-group">
                  <div className="label-row">
                    <label>Context/Background</label>
                    {lockFor('context')}
                  </div>
                  <textarea
                    value={scenarioConfig.context}
                    onChange={(e) => setScenarioConfig(prev => ({ ...prev, context: e.target.value }))}
                    placeholder={getContextPlaceholder()}
                    rows="3"
                  />
                </div>

                <div className="form-group">
                  <div className="label-row">
                    <label>Target Audience</label>
                    {lockFor('audience')}
                  </div>
                  <input
                    type="text"
                    value={scenarioConfig.audience}
                    onChange={(e) => setScenarioConfig(prev => ({ ...prev, audience: e.target.value }))}
                    placeholder={getAudiencePlaceholder()}
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>Number of Categories (Max: 24)</label>
                    <input
                      type="number"
                      min="1"
                      max="24"
                      value={scenarioConfig.numberOfCategories}
                      onChange={(e) => setScenarioConfig(prev => ({ ...prev, numberOfCategories: Math.min(24, Math.max(1, parseInt(e.target.value) || 1)) }))}
                    />
                    <small style={{color: '#666', fontSize: '12px'}}>
                      System supports maximum 24 categories due to bitmask limitations
                    </small>
                  </div>
                  <div className="form-group">
                    <div className="label-row">
                      <label>Must Have Categories</label>
                      {lockFor('mustHaveCategories')}
                    </div>
                    <input
                      type="text"
                      value={scenarioConfig.mustHaveCategories}
                      onChange={(e) => setScenarioConfig(prev => ({ ...prev, mustHaveCategories: e.target.value }))}
                      placeholder={getMustHaveCategoriesPlaceholder()}
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label>
                      {engagementType === 'trivia' ? 'Difficulty Level' : 'Level of Detail'}
                    </label>
                    <select
                      value={scenarioConfig.difficulty}
                      onChange={(e) => setScenarioConfig(prev => ({ ...prev, difficulty: e.target.value }))}
                    >
                      {engagementType === 'trivia' ? (
                        <>
                          <option value="easy">Easy</option>
                          <option value="medium">Medium</option>
                          <option value="hard">Hard</option>
                        </>
                      ) : (
                        <>
                          <option value="brief">Brief</option>
                          <option value="detailed">Detailed</option>
                          <option value="comprehensive">Comprehensive</option>
                        </>
                      )}
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Number of {engagementType === 'trivia' ? 'Questions' : engagementType === 'poll' ? 'Polls' : engagementType === 'wavelength' ? 'Prompts' : 'Scenarios'}: <strong>{scenarioConfig.count}</strong></label>
                    <div className="quantity-controls">
                      <input
                        type="range"
                        min="1"
                        max="100"
                        value={scenarioConfig.count}
                        onChange={(e) => setScenarioConfig(prev => ({ ...prev, count: parseInt(e.target.value) }))}
                        className="quantity-slider"
                      />
                      <input
                        type="number"
                        min="1"
                        max="100"
                        value={scenarioConfig.count}
                        onChange={(e) => setScenarioConfig(prev => ({ ...prev, count: Math.min(100, Math.max(1, parseInt(e.target.value) || 1)) }))}
                        className="quantity-input"
                      />
                    </div>
                    <div className="quantity-presets">
                      <button type="button" className="preset-btn" onClick={() => setScenarioConfig(prev => ({ ...prev, count: 5 }))}>5</button>
                      <button type="button" className="preset-btn" onClick={() => setScenarioConfig(prev => ({ ...prev, count: 10 }))}>10</button>
                      <button type="button" className="preset-btn" onClick={() => setScenarioConfig(prev => ({ ...prev, count: 20 }))}>20</button>
                      <button type="button" className="preset-btn" onClick={() => setScenarioConfig(prev => ({ ...prev, count: 50 }))}>50</button>
                    </div>
                  </div>
                </div>

                <div className="form-group">
                  <div className="label-row">
                    <label>Base Prompt &amp; Additional Requirements</label>
                    {lockFor('customPrompt')}
                  </div>
                  <textarea
                    value={scenarioConfig.customPrompt}
                    onChange={(e) => setScenarioConfig(prev => ({ ...prev, customPrompt: e.target.value }))}
                    placeholder="Edit the base generation prompt or add specific requirements, themes, or constraints..."
                    rows="4"
                  />
                  <small style={{color: '#666', fontSize: '12px'}}>
                    This shows the base prompt from your selected template. You can edit it or add additional requirements.
                  </small>
                </div>

                <FileUploadPrompt
                  onContentExtracted={(content) => {
                    setScenarioConfig(prev => ({
                      ...prev,
                      customPrompt: prev.customPrompt + '\n\n' + content
                    }));
                  }}
                  acceptedFormats={['.txt', '.pdf', '.md', '.docx']}
                  label="Or upload a document with context/examples"
                />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="scenario-generation">
              {!reviewing ? (
                <GenerationJobPanel
                  job={interpreted}
                  noun="scenarios"
                  jobId={jobIdRef.current}
                  createsSet
                  statusLine={generationStatus}
                  transportError={transportError}
                  onKeepRunning={onClose}
                  onReconnect={() => jobIdRef.current && watchJob(jobIdRef.current)}
                  onReview={() => setReviewingPartial(true)}
                  onRetryRemaining={retryRemaining}
                  onDiscard={backToConfiguration}
                  onBackToConfig={backToConfiguration}
                />
              ) : !editingItem ? (
                /*
                  ONCE THE WORKER HAS MADE THE SET, THIS TABLE IS A RECEIPT.
                  Excluding or editing a row here would change an array that is
                  no longer what gets saved — all of them are already in the
                  draft. Both row controls are therefore withheld rather than
                  left live and inert, and the primary action opens the set
                  instead of creating one. The set's own editor is where those
                  edits belong, and the header copy says so.
                */
                <GeneratedItemsTable
                  items={generatedScenarios}
                  requested={interpreted.requested}
                  noun="scenarios"
                  excluded={excluded}
                  savedAs={interpreted.createdSet}
                  onToggleExclude={interpreted.createdSet ? undefined : toggleExcluded}
                  onEdit={interpreted.createdSet
                    ? undefined
                    : (index) => { setCurrentScenarioIndex(index); setTagDraft(null); setEditingItem(true); }}
                  primary={(scenario) => scenario.title}
                  secondary={(scenario) => scenario.detail}
                  flag={scenarioDefect}
                  columns={[
                    { header: 'Category', value: (scenario) => scenario.category, width: '160px', filterable: true },
                  ]}
                  actions={(
                    <>
                      <button className="btn-secondary" onClick={handleExportCSV}>
                        <Icon name="FileText" weight="bold" size={16} color="currentColor" /> Export CSV
                      </button>
                      {interpreted.createdSet ? (
                        <button className="btn-primary" onClick={handleOpenCreatedSet}>
                          <Icon name="ArrowRight" weight="bold" size={16} color="currentColor" />{' '}
                          Open &ldquo;{interpreted.createdSet.setName}&rdquo;
                        </button>
                      ) : (
                        <button className="btn-primary" onClick={handleLoadIntoSystem} disabled={keptScenarios.length === 0}>
                          <Icon name="DownloadSimple" weight="bold" size={16} color="currentColor" /> Load {keptScenarios.length} into System
                        </button>
                      )}
                    </>
                  )}
                />
              ) : (
                <div className="scenario-review">
                  <div className="scenario-navigation">
                    <button
                      className="nav-button prev"
                      onClick={() => navigateScenario('prev')}
                      disabled={currentScenarioIndex === 0}
                    >
                      <Icon name="ArrowLeft" weight="bold" size={16} color="currentColor" /> Previous
                    </button>
                    
                    <div className="scenario-counter">
                      <span>Scenario {currentScenarioIndex + 1} of {generatedScenarios.length}</span>
                      <h3>{currentScenario?.title}</h3>
                    </div>
                    
                    <button
                      className="nav-button next"
                      onClick={() => navigateScenario('next')}
                      disabled={currentScenarioIndex === generatedScenarios.length - 1}
                    >
                      Next <Icon name="ArrowRight" weight="bold" size={16} color="currentColor" />
                    </button>
                  </div>

                  <div className="scenario-editor">
                    <div className="form-group">
                      <label>Title</label>
                      <input
                        type="text"
                        value={currentScenario?.title || ''}
                        onChange={(e) => handleScenarioEdit(currentScenarioIndex, 'title', e.target.value)}
                      />
                    </div>

                    <div className="form-group">
                      <label>Category</label>
                      <input
                        type="text"
                        value={currentScenario?.category || ''}
                        onChange={(e) => handleScenarioEdit(currentScenarioIndex, 'category', e.target.value)}
                      />
                    </div>

                    <div className="form-group">
                      <label>Scenario Details</label>
                      <textarea
                        value={currentScenario?.detail || ''}
                        onChange={(e) => handleScenarioEdit(currentScenarioIndex, 'detail', e.target.value)}
                        rows="6"
                      />
                    </div>

                    <div className="form-group">
                      <label>Custom Instructions</label>
                      <textarea
                        value={currentScenario?.customInstructions || ''}
                        onChange={(e) => handleScenarioEdit(currentScenarioIndex, 'customInstructions', e.target.value)}
                        rows="2"
                        placeholder="Specific instructions for participants..."
                      />
                    </div>

                    {/*
                      Suggested tags, not imposed tags. The model that just wrote
                      the scenario is best placed to say what it is about, but the
                      owner gets the final word before anything is saved. Stored
                      as a flat lowercase kebab-case array under `tags` — the same
                      field name and shape the AIPROMPT# rows already use.
                    */}
                    <div className="form-group">
                      <label>Tags <span className="field-hint">suggested — edit freely, comma separated</span></label>
                      <input
                        type="text"
                        value={tagDraft !== null ? tagDraft : (currentScenario?.tags || []).join(', ')}
                        onChange={(e) => setTagDraft(e.target.value)}
                        onBlur={() => {
                          if (tagDraft !== null) {
                            handleScenarioEdit(currentScenarioIndex, 'tags', normalizeTags(tagDraft));
                            setTagDraft(null);
                          }
                        }}
                        placeholder="remote-work, conflict-resolution, leadership"
                      />
                      {(currentScenario?.tags || []).length > 0 && (
                        <div className="tag-chips">
                          {currentScenario.tags.map((tag) => (
                            <span className="tag-chip" key={tag}>{tag}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="scenario-actions">
                    <button className="btn-secondary" onClick={() => { setTagDraft(null); setEditingItem(false); }}>
                      <Icon name="ListChecks" weight="bold" size={16} color="currentColor" /> Back to all {generatedScenarios.length} scenarios
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() => toggleExcluded(currentScenarioIndex)}
                    >
                      {excluded.has(currentScenarioIndex) ? 'Put this one back' : 'Leave this one out'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="modal-footer">
          {step === 1 && (
            <>
              <button className="btn-secondary" onClick={onClose}>
                Cancel
              </button>
            </>
          )}
          {step === 2 && (
            <>
              <button className="btn-secondary" onClick={() => setStep(1)}>
                <Icon name="ArrowLeft" weight="bold" size={16} color="currentColor" /> Back
              </button>
              <button className="btn-primary" onClick={handleConfigSubmit}>
                <Icon name="Sparkle" weight="duotone" size={16} color="var(--primary)" /> Generate Scenarios
              </button>
            </>
          )}
          {step === 3 && reviewing && (
            <>
              <button className="btn-secondary" onClick={backToConfiguration}>
                <Icon name="ArrowLeft" weight="bold" size={16} color="currentColor" /> Back to Configuration
              </button>
              <button className="btn-secondary" onClick={onClose}>
                Cancel
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default AIScenarioBuilder;
