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
      id: 'trivia-question',
      title: 'A trivia question',
      icon: 'Brain',
      blocks: [
        {
          t: 'list',
          items: [
            { title: 'Title', text: 'The short version, for lists and for the round header.' },
            { title: 'Question', text: 'The full text, as the room will read it.' },
            { title: 'Options', text: 'A to D, and E and F when the question needs them: up to six. Make the wrong ones plausible or the round is not a round.' },
            { title: 'Correct answer', text: 'Which option is right. Getting this wrong is the worst bug a set can have — it is wrong in public, with points attached.' },
            { title: 'Answer details', text: 'The explanation, revealed with the answer. This is the reveal field — see below.' },
            { title: 'Category and difficulty', text: 'Used for filtering and for pacing.' },
          ],
        },
      ],
    },
    {
      id: 'open-answer-question',
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
      id: 'holding-back',
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
      id: 'pictures',
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
      id: 'categories',
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

/**
 * The builder area. Assembled into roles by ./index.js (ROLE_AREAS); see
 * docs/help-refresh/STRUCTURE.md for the map and the conventions.
 * Writing questions by hand.
 */
export const AREA = {
  id: 'builder',
  guides: { builder: [manual] },
};
