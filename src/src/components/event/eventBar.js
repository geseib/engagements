/**
 * THE EVENT'S DOOR IN THE PLAYER'S BAR (events M4, roadmap D3: "The attendee
 * screen has an 'Agenda' button everywhere").
 *
 * The attendee's page (EventAttendeePage.jsx) provides `{ onAgenda }` around
 * the session it is playing; PlayerShell reads it and draws one "Agenda"
 * button in the bar. A context rather than a prop because the shell is drawn
 * by every one of PlayerPage's screens and by SurveyRunner's: threading a prop
 * through each would touch forty call sites to say one thing. Outside an event
 * there is no provider, the value is null, and the bar is exactly as before.
 */
import { createContext } from 'react';

export const EventBarContext = createContext(null);

export default EventBarContext;
