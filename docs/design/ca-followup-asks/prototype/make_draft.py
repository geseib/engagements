"""Builds docs/design/ca-followup-asks/prompt-draft.json from readable text blocks.
Design only: the file is installed nowhere."""
import json, sys

OUT = sys.argv[1]

ASK_RULES = """FOLLOW-UP ASKS. After the read, the host may send ONE short question to everyone's phone, laptop or tablet. Suggest up to three. The host picks one, may edit it, and sends it. The room answers in under a minute.

There are three types and only three:
- "agree": a statement the room agrees or disagrees with. The screen adds "Do you agree?" and the answers Agree, Disagree and Not sure, so give only the statement. The statement is words copied from ONE answer, in order, at most 20 words, cut from the answer but never reworded. If those words sit inside a condition ("if", "might", "could", "unless", "when"), the condition comes with them.
- "choice": one question and 2 to 4 options. Each option is words copied from a DIFFERENT answer, in order, at most 8 words, cut but never reworded. Every option must answer the question as asked, and picking one must mean not picking the others. Give each option the number of the answer it comes from.
- "open": a question that asks the room for something this round did not produce: an example, a first step, a cost, a reason. Never ask the room to repeat the task they just answered.

ASK RULES. Every one applies to every ask.
A1. Ground it. Name the numbered answers each ask comes from, from the list "Every answer, numbered". Nothing in an ask may come from anywhere else.
A2. Do not lead. Never write "don't you think", "shouldn't we" or "isn't it true", and never add a claim of your own to a statement or a question. Never hint which option is right. Options are parallel: similar length, same grammar, none of them a straw man. List options in the order of their answer numbers.
A3. If the read named a split ("Not settled"), one ask puts that split to the room unresolved: a "choice" between the two sides, or an "agree" on one side. If the read said "No split", do not invent one: test whether the top-voted idea holds for the people who did not vote for it.
A4. A statement every person in the room would agree with is a wasted ask. Pick one that people could reasonably disagree with.
A5. Name nobody. No person's name and no clue to who wrote an answer, anywhere in the ask.
A6. Write for a phone held at arm's length: a question at most 110 characters, one sentence, plain words.
A7. "why" is for the host only and never shown to the room: one sentence saying what the room's answer would settle. Begin with a verb: Shows, Settles, Tests, Finds.
A8. Fewer is fine. If only one ask is worth sending, suggest one. If the count under "How many people answered" is 0, suggest none. If it is 1 or 2, suggest at most one, of type "open".
A9. Never ask for anything personal: no health, pay, performance, politics, or anyone's opinion of a colleague."""

ASK_SCHEMA = {
    "type": "object",
    "properties": {
        "asks": {
            "type": "array",
            "maxItems": 3,
            "items": {
                "type": "object",
                "properties": {
                    "type": {"type": "string", "enum": ["agree", "choice", "open"]},
                    "question": {"type": "string", "description": "choice and open: the question the room sees, at most 110 characters. Leave out for agree."},
                    "statement": {"type": "string", "description": "agree only: words copied in order from one answer, at most 20 words."},
                    "options": {
                        "type": "array", "minItems": 2, "maxItems": 4,
                        "description": "choice only.",
                        "items": {"type": "object", "properties": {
                            "text": {"type": "string", "description": "Words copied in order from the answer, at most 8 words."},
                            "answer": {"type": "integer", "description": "The number of the answer the words come from."}},
                            "required": ["text", "answer"]},
                    },
                    "answers": {"type": "array", "items": {"type": "integer"}, "description": "The numbers of the answers this ask comes from."},
                    "why": {"type": "string", "description": "For the host only: one sentence on what the room's answer would settle. Begins with a verb."},
                },
                "required": ["type", "answers", "why"],
            },
        }
    },
    "required": ["asks"],
}

SEPARATE_INSTRUCTIONS = """You have just read back one round of a call-and-answer session to the room. Your read is printed below under "The read the room just heard". The room saw it on the screen at the front.

Now do one more, smaller job.

""" + ASK_RULES + """

WHAT YOU HAVE BEEN GIVEN, and it is all you have:

- The session: {eventTitle}
- The task the room was set: {task}
- The story or topic the task was set against: {questionTitle}
- How many people answered: {responseCount}
- How many people voted: {voteCount}
- Every answer, numbered, with the vote points it earned: {numberedAnswers}
- The read the room just heard: {readBack}

Reply by calling the tool suggest_follow_up_asks exactly once. Write nothing else."""

draft = {
    "name": "Call & Answer: follow-up asks (DRAFT, not installed)",
    "description": "Design draft for docs/design/ca-followup-asks. A second, small model call made after the round's read: up to three typed follow-up asks (agree, choice, open) the host can send to the room. The read-back prompt (sets/prompt-callandanswer-workie-advisor.json) is unchanged. Installed nowhere.",
    "gameType": "call-and-answer",
    "status": "draft",
    "isDefault": False,
    "recommended": "followUpAsks",
    "followUpAsks": {
        "why": "A separate call, not a fifth section of the read. Measured (PROTOTYPE.md): both shapes parsed 8 of 8, so parsing does not decide it. The separate call leaves the tuned read-back prompt and every surface that renders markdownResponse untouched, sends the answers with no author beside them (the read itself may still name a top-voted author, so the server check rejects any roster name in what the room sees), runs only when wanted (about 6 s, against 12 to 15 s for the read), and returns a tool call that claude-route already checks and falls back from on the 5.5 path. All four separate calls called the tool with toolChoice auto, which is the 5.5 condition.",
        "modelChoice": "The round's own analysis model (summary-models.js), sent through claude-route.send(site: 'followup-asks'). No assistant prefill. Bedrock 4.x receives toolChoice {tool: suggest_follow_up_asks}; the 5.5 route rewrites a forced choice to auto plus the closing sentence of the instructions, and treats a reply without the tool call as a failure that falls back to Bedrock.",
        "maxTokens": 1200,
        "instructions": SEPARATE_INSTRUCTIONS,
        "variables": {
            "eventTitle": "as the read",
            "task": "as the read (resolveTask)",
            "questionTitle": "as the read",
            "responseCount": "as the read",
            "voteCount": "as the read",
            "numberedAnswers": "NEW. Every answer as '1. (14 vote points) \"…\"', in the read's ranked order, WITHOUT names on any round: the asks never need an author, so none is sent. The numbers are what an ask's answers/options cite, and what the server checks the copied words against.",
            "readBack": "the stored round read (AISummary markdownResponse), decrypted; the fallback template read is never passed — no asks are suggested from a fallback",
        },
        "tool": {
            "name": "suggest_follow_up_asks",
            "description": "Suggest up to three follow-up asks the host can send to the room after the read.",
            "input_schema": ASK_SCHEMA,
        },
    },
    "inBandVariant": json.load(open(__file__.replace("make_draft.py", "prompt-draft-v1.json")))["inBandVariant"],
}

with open(OUT, "w") as f:
    json.dump(draft, f, indent=2, ensure_ascii=False)
    f.write("\n")
print("wrote", OUT)
