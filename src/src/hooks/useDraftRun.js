/**
 * WHAT EVERY AI BUILDER DOES THE SAME WAY ABOUT DRAFTS AND DESTINATIONS.
 * docs/design/ai-generation-review/README.md.
 *
 *   - WHERE: the library the run is saved into. Chosen in the builder for a
 *     new set (only libraries this person may write to, defaulting to the one
 *     the console stands in), and for "Add questions" it is the set's own —
 *     stated, not chosen. It travels as the X-Engage-Org header on the POST
 *     and on every poll, which is what the server judges.
 *   - THE SLOT: the browser's memory of the run, keyed by SET as well as by
 *     builder. One slot per builder was how an "Add questions" run on one set
 *     was resumed by the new-set builder, or overwritten by the next run.
 *   - THE HAND-OFF: a run that finished into a draft is not reviewed in the
 *     builder any more. The builder hands the draft to the page
 *     (`onDraftReady`), which opens the one review screen (DraftReview).
 *
 * The builders keep their own forms, progress and legacy review screens; this
 * only replaces the parts that must not differ between them.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  rememberGenerationJob, recallGenerationJob, forgetGenerationJob,
} from '../utils/generationJob';
import { isAppend } from '../utils/appendMode';
import { libraryHeaders } from '../utils/draftsApi';
import { useLibraries, defaultLibraryKey } from '../utils/libraries';

export default function useDraftRun({
  endpoint, appendTo = null, libraries: given = null, onDraftReady = null,
}) {
  const appending = isAppend(appendTo);
  /*
    THE LIST IS READ ONLY WHEN IT IS NEEDED. An addition goes where its set
    is, and a new set's default — the library the console stands in — needs no
    list either: the request simply carries no override. So a builder opened
    with no list handed in asks the server nothing until the person presses
    "Choose another" (DestinationField).
  */
  const [wantList, setWantList] = useState(false);
  const { libraries } = useLibraries({ libraries: given, skip: appending || (!given && !wantList) });
  const [destination, setDestination] = useState('');

  useEffect(() => {
    if (appending || destination || !libraries.length) return;
    setDestination(defaultLibraryKey(libraries));
  }, [appending, destination, libraries]);

  const libraryKey = appending ? (appendTo.libraryKey || '') : destination;
  const headers = useMemo(() => libraryHeaders(libraryKey), [libraryKey]);

  const slot = appending && appendTo.setId ? `${endpoint}#${appendTo.setId}` : endpoint;

  /** The set an addition is for, as the server reads it (generation-drafts.js). */
  const appendTarget = appending && appendTo.setId
    ? { setId: appendTo.setId, scope: appendTo.scope || '', mode: appendTo.mode || 'existing' }
    : null;

  const handOffRef = useRef(onDraftReady);
  handOffRef.current = onDraftReady;

  return {
    appending,
    libraries,
    askForLibraries: () => setWantList(true),
    destination,
    setDestination,
    libraryKey,
    headers,
    slot,
    appendTarget,
    stored: () => recallGenerationJob(slot),
    remember: (jobId, extra = {}) => rememberGenerationJob(slot, jobId, { ...extra, libraryKey }),
    forget: () => forgetGenerationJob(slot),
    /** Headers for a resumed job: the library it was started in. */
    headersFor: (stored) => libraryHeaders((stored && stored.libraryKey) || libraryKey),
    /**
     * A terminal job that wrote a draft goes to the page's review. True when
     * it was handed off — the builder then has nothing left to show.
     */
    handOff(terminal, startedIn = libraryKey) {
      const draftId = terminal && terminal.draftId;
      if (!draftId || typeof handOffRef.current !== 'function') return false;
      forgetGenerationJob(slot);
      handOffRef.current({ draftId, libraryKey: startedIn || '' });
      return true;
    },
  };
}
