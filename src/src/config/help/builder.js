/**
 * THE TWO BUILDER GUIDES — for whoever writes the questions, who may be an
 * admin, may be a host with their own set, and is doing a different job from
 * either while they are doing it.
 *
 * The reveal section is the reason this role's guides needed writing rather
 * than folding into Admin. The withheld-detail field is the single most
 * misunderstood thing in a question set: it shipped populated but untagged, so
 * the AI was told to reveal something the editor never offered a way to fill
 * in, and rooms watched the AI promise a reveal that never arrived.
 */

const manual = {
  id: 'builder-manual',
  title: 'Writing questions',
  icon: 'NotePencil',
  summary: 'The fields, what each one is for, and the one everybody leaves empty.',
  sections: [
    {
      title: 'A trivia question',
      icon: 'Brain',
      blocks: [
        {
          t: 'list',
          items: [
            { title: 'Title', text: 'The short version, for lists and for the round header.' },
            { title: 'Question', text: 'The full text, as the room will read it.' },
            { title: 'Four options', text: 'A, B, C and D. Make the wrong ones plausible or the round is not a round.' },
            { title: 'Correct answer', text: 'Which of the four. Getting this wrong is the worst bug a set can have — it is wrong in public, with points attached.' },
            { title: 'Answer details', text: 'The explanation, revealed with the answer. This is the reveal field — see below.' },
            { title: 'Category and difficulty', text: 'Used for filtering and for pacing.' },
          ],
        },
      ],
    },
    {
      title: 'An open-answer question',
      icon: 'ChatCircleText',
      blocks: [
        {
          t: 'list',
          items: [
            { title: 'Title', text: 'The prompt itself, usually. Short enough to project.' },
            { title: 'Detail', text: 'The background — why you are asking, what frame to answer in.' },
            { title: 'Custom instructions', text: 'Guidance for the answer. "One sentence", "as your worst self", "assume it already failed".' },
            { title: 'Category', text: 'For filtering.' },
          ],
        },
        {
          t: 'note',
          tone: 'tip',
          title: 'The best open questions are uncomfortable',
          text: 'A question everyone can answer safely produces answers nobody wants to read out. Ask for the thing people are already thinking.',
        },
      ],
    },
    {
      /*
        THE FIELD THIS GUIDE EXISTS FOR. The owner's framing, which is broader
        than the field's name and is why the `{reveal}` alias was added
        alongside it: *"it could be any information that the host doesnt want
        revealed (or the creator of the question set really) until after they
        have responded with their thoughts."*
      */
      title: 'Holding something back until they have answered',
      icon: 'EyeSlash',
      blocks: [
        {
          t: 'p',
          text: 'Some rounds are only worth playing if a detail is withheld while people answer: the real title of the painting, the number the study actually found, what the company did next, the punchline.',
        },
        {
          t: 'p',
          text: 'That is what the answer-details field is for. It is never shown to players while they are answering, so it is safe to put the spoiler there — and it is handed to the AI at results time, so the summary can compare what the room said against what was actually true, and then reveal it.',
        },
        { t: 'h', text: 'It is not only for trivia' },
        {
          t: 'p',
          text: 'The name says "answer details" and the job is wider than that. Any kind of session can use it. An art round with no right answer still has a real title worth revealing at the end.',
        },
        {
          t: 'note',
          tone: 'warn',
          title: 'An empty reveal is the commonest set bug there is',
          text: 'If the AI promises to reveal the real title and then does not, the field is empty. The AI is not withholding it — it never had it. Fill the field in, and the reveal happens.',
        },
        {
          t: 'note',
          tone: 'info',
          title: 'Two names, one field',
          text: 'Prompts can refer to it as {answerDetails} or as {reveal}. They are the same content — the second name exists because that is what people look for when they want this behaviour.',
        },
      ],
    },
    {
      title: 'Pictures',
      icon: 'Image',
      blocks: [
        {
          t: 'p',
          text: 'A question can carry a picture, via the Picture field. On an art round the image is the question — the text asks what people see in it, and the withheld detail carries what it actually is.',
        },
      ],
    },
    {
      title: 'Categories',
      icon: 'ListChecks',
      blocks: [
        {
          t: 'p',
          text: 'Categories let a host play a slice of a set. Aim for a handful of meaningful ones rather than one per question — a category that matches a single question is a filter nobody will use.',
        },
        {
          t: 'note',
          tone: 'warn',
          title: 'There are 24 category slots per set',
          text: 'That is a hard ceiling in the storage format, not a style guide. Sets that sprawl past it will not behave.',
        },
      ],
    },
  ],
};

const ai = {
  id: 'builder-ai',
  title: 'Building with AI',
  icon: 'MagicWand',
  summary: 'Getting a usable set out of a generator, and what to check before anyone plays it.',
  sections: [
    {
      title: 'Describing what you want',
      icon: 'ChatCircleText',
      blocks: [
        {
          t: 'p',
          text: 'The generator is much better with constraints than with adjectives. "Fun questions about technology" produces exactly what you would expect. Say who the room is, what you want them arguing about, and how long you have.',
        },
        {
          t: 'list',
          items: [
            'Who is in the room — a team, a conference, a family at Christmas.',
            'What the session is actually for — warm-up, retrospective, teaching something.',
            'The tone, in words you would use to a person.',
            'How many questions, and roughly how long each should take.',
          ],
        },
        {
          t: 'note',
          tone: 'tip',
          title: 'Lock the fields you have already decided',
          text: 'The assistant can fill the metadata from your description, and a locked field is left alone. Lock the name and the category list, then let it regenerate the rest as many times as you like.',
        },
      ],
    },
    {
      title: 'Longer sets run as a job',
      icon: 'Timer',
      blocks: [
        {
          t: 'p',
          text: 'A large set is not generated while you wait. It runs in the background and appears when it is done, so you can close the dialog and get on with something else.',
        },
        {
          t: 'note',
          tone: 'info',
          title: 'A name collision refuses rather than overwrites',
          text: 'If a set of that name already exists the job is refused. Nothing you already have is replaced by a generator.',
        },
      ],
    },
    {
      title: 'Before you let anyone play it',
      icon: 'MagnifyingGlass',
      blocks: [
        {
          t: 'note',
          tone: 'warn',
          title: 'Check the answer keys',
          text: 'A generated trivia question can be fluent and wrong. It will be wrong in front of a room, with points riding on it, and you will be the one arguing with somebody who knows the real answer.',
        },
        {
          t: 'list',
          items: [
            'Exactly one option is right, and the other three are plausible.',
            'The answer-details field is filled in, especially on any round meant to end in a reveal.',
            'The categories are a usable handful, not twenty synonyms.',
            'Nothing is subtly about the wrong country, decade or company.',
          ],
        },
      ],
    },
    {
      title: 'If it keeps coming out wrong the same way',
      icon: 'Sparkle',
      blocks: [
        {
          t: 'p',
          text: 'Repeated, consistent problems are the generation prompt rather than your description. Too long, too corporate, always four options when you asked for three — fix the prompt once in the Prompts section and every future set inherits the fix.',
        },
      ],
    },
  ],
};

export const BUILDER_ROLE = {
  id: 'builder',
  title: 'For builders',
  icon: 'Buildings',
  blurb: 'Writing the questions, by hand or with the AI.',
  guides: [manual, ai],
};
