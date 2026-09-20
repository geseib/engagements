/**
 * EVERY SCREEN CLIP SLOT ON THE MARKETING PAGES, AND THE ONLY LIST OF THEM.
 * poster/webm/mp4 are null until the capture script (sub-project 2) records
 * them; ClipFrame shows a captioned still until then. Paths, when set, are
 * site-relative under /assets/marketing/ — never another origin.
 */
const slot = (frame, caption, alt) => ({ frame, caption, alt, poster: null, webm: null, mp4: null });

export const CLIPS = {
  'trivia-host': slot('tv', 'Trivia on the big screen',
    'The host screen shows a trivia question with four choices, answers lock in, then the correct answer and the standings appear.'),
  'trivia-player': slot('phone', 'Answering from a phone',
    'A phone shows the same question; the player taps a choice and sees whether it was right.'),
  'poll-host': slot('tv', 'Call and answer on the big screen',
    'The host screen shows a prompt, ideas from the room arrive one by one, the room votes, and the results are revealed with a summary.'),
  'poll-player': slot('phone', 'Adding an idea, then voting',
    'A phone shows the prompt; the player types an idea and sends it, then votes on the ideas from the rest of the room.'),
  'join-qr': slot('tv', 'Joining by QR code',
    'The lobby screen shows a QR code and a four-digit code while player names appear as people join.'),
  builder: slot('laptop', 'Drafting a set from your material',
    'The set builder takes a topic and source material and drafts questions, which the host reviews and edits.'),
  report: slot('laptop', 'The session report',
    'The report opens on paper: every answer, the vote breakdown, comments and the summary, then exports to PDF.'),
};
