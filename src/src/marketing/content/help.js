/**
 * Page-level copy for /help, transcribed verbatim from
 * docs/design/marketing-redesign/05-help.html (entities decoded).
 *
 * This is the ONLY marketing copy on the page. Everything else -- role
 * names, guide titles, guide bodies -- comes from the real corpus in
 * `config/help/`, per Task 11's controller ruling 1: the mockup's sidebar and
 * sample guide ("Playing", "Joining a session"...) are placeholders that do
 * not exist in the corpus, and rendering them would advertise guides nobody
 * can open.
 */
export const HELP_PAGE = {
  kicker: 'Help',
  title: 'Guides for players, hosts and admins.',
  lead: 'The same guides the in-app help button shows, at an address you can send to somebody.',
  searchLabel: 'Search the guides',
  searchEmpty: 'No guides match that search.',
  guidesToggle: 'All guides',
  guideFooter: 'Still stuck? The help button inside a session shows this same guide without losing your place.',
};
