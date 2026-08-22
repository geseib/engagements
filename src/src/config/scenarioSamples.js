/**
 * SAMPLE IDEAS FOR THE SCENARIO BUILDER — the cards that answer the direction.
 *
 * The owner, on step 1 as it stood: *"it has these cards that say what kind of
 * scenario do you want to build. those seem odd after you pick
 * produce/apply/improve/etc. i would think its better to change what shows up
 * there based on which type you select, and these could be sample idea, so
 * they understand."*
 *
 * The old step stacked two taxonomies: first the round kind ("what will the
 * room DO"), then a wall of template cards named like database records
 * ("Lessons Learned - Strategic Insights") that did not respond to the choice
 * just made. Two abstract questions in a row, the second one template-speak.
 *
 * These are the replacement for the second wall on call-and-answer: three
 * CONCRETE ideas per direction, written as briefs an operator can recognise
 * their own situation in. Clicking one does not lock anything in — it picks
 * the best-fitting generation template under the hood and PREFILLS the next
 * step's context with the brief, all of it editable. The samples are also the
 * teaching device: reading three of them tells you what "apply" means better
 * than any definition.
 *
 * `custom` has no samples on purpose: an operator who wrote their own
 * direction has already said what they want, and handing them our ideas at
 * that moment would talk over them. They get scratch and the templates.
 *
 * `templateId` names a HARDCODED scenario type id from AIScenarioBuilder's
 * call-and-answer list (lessons-learned, problem-solving, interview-prep,
 * amazon-principles, team-building, custom). Database templates supersede
 * hardcoded ones with the same scenarioType at runtime, so a sample keeps
 * benefiting from an admin's tuned template without naming it.
 */

export const SCENARIO_SAMPLES = {
  produce: [
    {
      id: 'produce-hard-won',
      title: 'Hard-won lessons',
      description: 'Everyone shares a real experience on a theme, and the room votes on what teaches the most.',
      context: 'Rounds where each person recounts a real experience of their own on the theme, with what it cost and what it taught. Favor prompts that surface specifics - a project, a decision, a number - over opinions.',
      templateId: 'lessons-learned',
    },
    {
      id: 'produce-next-bets',
      title: 'Our next bets',
      description: 'The room proposes what to do next — ideas, priorities, names — and votes on the best.',
      context: 'Rounds where each person proposes something concrete the team should do next: an initiative, a priority, a fix, a name for the thing. Prompts should ask for ONE proposal each, specific enough to vote on.',
      templateId: 'problem-solving',
    },
    {
      id: 'produce-identity',
      title: 'What we stand for',
      description: 'Prompts about who the team is and wants to be — answered in the room\'s own words.',
      context: 'Rounds about the team itself: what we should be known for, what we refuse to do, what our customers would say about us. Answers come from conviction, not analysis - prompts should invite a stance.',
      templateId: 'team-building',
    },
  ],
  apply: [
    {
      id: 'apply-case',
      title: 'A case, landed on us',
      description: 'Each round presents a short case or story; the room lands its lesson on your own situation.',
      context: 'Each round presents a short real-world case or story in the lesson text, and the prompt asks the room to land it on OUR situation: what is the equivalent here, and what would we do about it?',
      templateId: 'lessons-learned',
    },
    {
      id: 'apply-playbook',
      title: 'Someone else\'s playbook',
      description: 'Principles or methods from elsewhere — Amazon\'s LPs, a book, a framework — applied here.',
      context: 'Each round presents one principle or method from an outside playbook (a leadership principle, a chapter, a framework rule) and asks the room to apply it to a real, current piece of our own work.',
      templateId: 'amazon-principles',
    },
    {
      id: 'apply-material',
      title: 'The reading, made real',
      description: 'Material the room was given — an article, a policy, training — turned into "so what do WE do".',
      context: 'Rounds built on material the room has been given (an article, a policy, a training module): each lesson recaps one piece of it, and the prompt asks what changes for us specifically because of it.',
      templateId: 'lessons-learned',
    },
  ],
  improve: [
    {
      id: 'improve-ours',
      title: 'Our own stuff, redlined',
      description: 'Real artifacts of yours — docs, processes, messages — that the room makes better.',
      context: 'Each round presents a real artifact of ours (a doc excerpt, a process step, a customer message) and asks the room to improve it: what specifically would you change, and why is yours better?',
      templateId: 'problem-solving',
    },
    {
      id: 'improve-pain',
      title: 'The process that hurts',
      description: 'Known friction points, one per round — the room proposes the fix.',
      context: 'Rounds about known friction: each lesson names one thing that is slow, confusing, or painful today, and the prompt asks for a concrete improvement - smallest change first, with what it would take.',
      templateId: 'problem-solving',
    },
    {
      id: 'improve-pitch',
      title: 'Make the pitch better',
      description: 'Drafts and pitches that are almost right — the room sharpens them.',
      context: 'Each round presents a draft that is almost right - a pitch line, a summary, an answer - and asks the room to sharpen it. The improved version is the answer; votes go to the sharpest rewrite.',
      templateId: 'team-building',
    },
  ],
  judge: [
    {
      id: 'judge-ready',
      title: 'Ready or not',
      description: 'Things about to ship or decide — the room delivers a verdict with reasons.',
      context: 'Each round presents something on the verge - a launch, a decision, a plan - and asks for a verdict: ready or not, go or hold, with the ONE reason that decides it. Votes go to the best-argued call.',
      templateId: 'problem-solving',
    },
    {
      id: 'judge-triage',
      title: 'Keep, kill, or fix',
      description: 'A portfolio judged one item per round — what stays, what goes, what gets fixed first.',
      context: 'Rounds that triage a portfolio one item at a time (features, meetings, tools, rules): each prompt asks keep, kill, or fix - and what earns that verdict. Specific stakes in every lesson.',
      templateId: 'lessons-learned',
    },
    {
      id: 'judge-bar',
      title: 'Does it clear the bar?',
      description: 'Answers, work samples, or candidates judged against a stated standard.',
      context: 'Each round presents one piece of work or one answer and a stated standard, and asks: does it clear the bar? The response names the verdict and the gap - what exactly is missing, or what carried it.',
      templateId: 'interview-prep',
    },
  ],
  // custom: none, deliberately — see the header.
};

/** The samples for one round kind. [] for custom and anything unknown. */
export function samplesForKind(roundKind) {
  return SCENARIO_SAMPLES[roundKind] || [];
}
