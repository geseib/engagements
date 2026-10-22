/**
 * WRITING QUESTIONS BY HAND — for whoever writes the questions, who may be an
 * admin, may be a host with their own set, and is doing a different job from
 * either while they are doing it. Building with AI is `builder-ai` in ./ai.js.
 *
 * Every field below is the question form in components/QuestionsPanel.jsx
 * (checked 22 Oct 2026): Category * (CategoryPicker), Title *, "Question
 * detail" (trivia) / "Detail shown to the room", Option A–F, "Correct answer",
 * "Difficulty", the poll's kind (SurveyQuestionFields, POLL_KINDS), "Round
 * direction" and "Whose material is this?" (Call & Answer), "Instruction shown
 * to the room", "School / source", "Picture" (QuestionImageField), "Reveal
 * (shown only after the round)", "Tags", "Background for Workie". Saving a set
 * and its versions belong to admin-question-sets (admin-console.js).
 *
 * The reveal section is the reason this role's guides needed writing rather
 * than folding into Admin: the withheld-detail field is the most
 * misunderstood thing in a question set.
 */

const manual = {
  id: 'builder-manual',
  title: 'Writing questions',
  icon: 'NotePencil',
  summary: 'The fields of a question, what each one is for, and the one everybody leaves empty.',
  sections: [
    /*
      QuestionsPanel.jsx:1382 "Add a question", :1393 "Add questions…", the
      question dialog with "Writing alongside these." (the other questions in
      the category), Done, then the set's save ("Save as version N").
    */
    {
      id: 'adding-one',
      title: 'Adding a question',
      icon: 'Plus',
      blocks: [
        {
          t: 'steps',
          items: [
            { title: 'Open the set', text: 'In Question sets, press Edit on your set; its Questions panel lists every question.' },
            { title: 'Press Add a question', text: 'Choose the category first: the other questions in it appear under Writing alongside these, as the voice to match.' },
            { title: 'Fill in the fields', text: 'The fields depend on the format; see below. **Draft this with AI** gives you a first go (Building with AI).' },
            { title: 'Press Done, then save the set', text: 'Nothing is written until the set is saved, and one save makes one new version. Question sets, in the admin guides, explains versions.' },
          ],
        },
      ],
    },
    {
      id: 'trivia-question',
      title: 'A trivia question',
      icon: 'Brain',
      blocks: [
        {
          t: 'list',
          items: [
            { title: 'Title', text: 'The short version, for lists and the round\'s header.' },
            { title: 'Question detail', text: 'The full question, as the room will read it.' },
            { title: 'Option A to Option F', text: 'Up to six options; fill in only the ones you need. Make the wrong ones plausible, or the round is not a round.' },
            { title: 'Correct answer', text: 'Which option is right; it offers only the options you filled in. Getting this wrong is the worst mistake a set can have: it is wrong in public, with points attached.' },
            { title: 'Difficulty', text: 'Easy, medium or hard.' },
            { title: 'Reveal (shown only after the round)', text: 'The explanation, revealed with the answer. See below.' },
          ],
        },
      ],
    },
    /*
      Call & Answer / Wavelength: "Detail shown to the room", "Round direction"
      (Inherit the set's direction) and "Whose material is this?" (Apply
      rounds) when the format has directions, "Instruction shown to the room",
      "School / source".
    */
    {
      id: 'open-answer-question',
      title: 'An open-answer question (Call & Answer, Wavelength)',
      icon: 'ChatCircleText',
      blocks: [
        {
          t: 'list',
          items: [
            { title: 'Title', text: 'Usually the question itself. Short enough to read from the back of the room.' },
            { title: 'Detail shown to the room', text: 'The background: why you are asking, what frame to answer in.' },
            { title: 'Instruction shown to the room', text: 'How to answer: "One sentence", "as your worst self", "assume it already failed".' },
            { title: 'Round direction', text: 'Call & Answer only. Leave it to inherit the set\'s direction, or choose another for this question. An Apply round names the material in **Whose material is this?**.' },
            { title: 'School / source', text: 'Where the idea comes from, if it matters.' },
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
    /*
      engagementType === 'poll': SurveyQuestionFields with POLL_KINDS
      (choice, rating, yesno, text): "Multiple choice", "Rating", "Yes / No",
      "Open answer"; rating scales 1–5, 1–10, 0–10, Stars with labels under
      each end; yes/no "Yes reads" / "No reads".
    */
    {
      id: 'poll-question',
      title: 'A poll question',
      icon: 'ChartBar',
      blocks: [
        {
          t: 'p',
          text: 'A poll question is one of four kinds; choose the kind, then fill in what it needs:',
        },
        {
          t: 'list',
          items: [
            { title: 'Multiple choice', text: 'The options, and whether people pick one or several.' },
            { title: 'Rating', text: 'A scale (1 to 5, 1 to 10, 0 to 10, or stars) and the words under each end.' },
            { title: 'Yes / No', text: 'What the two buttons say, for example Approve and Decline.' },
            { title: 'Open answer', text: 'A line or a paragraph.' },
          ],
        },
      ],
    },
    /*
      THE FIELD THIS GUIDE EXISTS FOR. The owner's framing, which is broader
      than the field's name and is why the `{reveal}` alias was added
      alongside it: *"it could be any information that the host doesnt want
      revealed (or the creator of the question set really) until after they
      have responded with their thoughts."*
    */
    {
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
          text: 'That is what the **Reveal (shown only after the round)** field is for. It is never shown to players while they are answering, so it is safe to put the spoiler there. Workie is given it at results, so What we heard can compare what the room said with what was true, and then reveal it.',
        },
        { t: 'h', text: 'It is not only for trivia' },
        {
          t: 'p',
          text: 'Any format can use it. An art round with no right answer still has a real title worth revealing at the end.',
        },
        {
          t: 'note',
          tone: 'warn',
          title: 'An empty reveal is the commonest set mistake there is',
          text: 'If Workie promises to reveal the real title and then does not, the field is empty. Workie is not withholding it; it never had it. Fill the field in, and the reveal happens.',
        },
        {
          t: 'note',
          tone: 'info',
          title: 'Two names, one field',
          text: 'Prompts can refer to it as {answerDetails} or as {reveal}. They are the same content.',
        },
      ],
    },
    /*
      QuestionsPanel.jsx:2291 "Background for Workie", 600 chars, "Facts and
      context Workie may use. Never shown to players."; "Tags".
    */
    {
      id: 'notes-for-workie',
      title: 'Notes for Workie, and tags',
      icon: 'Note',
      blocks: [
        {
          t: 'p',
          text: '**Background for Workie** holds facts and context for this question, up to 600 characters: the numbers behind it, what happened, who said it. Players never see it. Workie draws on it when it writes What we heard, every time the question is played.',
        },
        {
          t: 'p',
          text: '**Tags** are your own words for finding questions later, separated by commas. A question drafted by AI carries a tag saying so; delete it if you rewrite the question as your own.',
        },
      ],
    },
    /*
      QuestionImageField.jsx: a file name or web address ("mona-lisa.jpg, or
      https://…"), Upload / Replace, Clear ("Nothing is deleted from storage").
    */
    {
      id: 'pictures',
      title: 'Pictures',
      icon: 'Image',
      blocks: [
        {
          t: 'p',
          text: 'Type a web address or a file name into **Picture**, or press Upload to add an image file. Clear takes the picture off the question without deleting the file. On an art round the image is the question: the text asks what people see in it, and the reveal carries what it actually is.',
        },
      ],
    },
    /*
      CategoryPicker.jsx: pick an existing category or create one deliberately;
      the 25th is refused (utils/addQuestions.js:23, three 8-bit host masks).
    */
    {
      id: 'categories',
      title: 'Categories',
      icon: 'ListChecks',
      blocks: [
        {
          t: 'p',
          text: 'Categories let a host play a slice of a set, switching them on and off during the session. Choose an existing one in the Category field, or add a new one there on purpose. Aim for a handful of meaningful ones rather than one per question: a category with a single question is a filter nobody uses.',
        },
        {
          t: 'note',
          tone: 'warn',
          title: 'There are 24 category slots per set',
          text: 'That is a hard limit, not a style guide. The 25th category is refused.',
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
