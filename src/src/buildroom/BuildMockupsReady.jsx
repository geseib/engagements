/**
 * MOCKUPS READY, WHERE THE HOST IS LOOKING (owner, 23 Oct 2026, dev game 2550:
 * Claude made three mockups for a vote, but the room was in the opening with
 * an Ideas ask open, and the one way to them was a card in Waiting for you
 * reading "Close ask 002 and open this", with nothing pointing at it).
 *
 * The oldest of Claude's proposed Choose asks with every picture in
 * (buildScreens mockupsCard): the question, the A/B/C tiles (a click opens the
 * mockup viewer), and two moves, the same calls Waiting for you's card makes:
 *   Put to the room now   opens it; with an ask open, asks first, then the
 *                         server closes that ask and opens this one
 *   Next, after this ask  lines it up (`opennext`): it opens when the open
 *                         ask closes. The lead during the opening, so the
 *                         mockups follow the step the room is on
 * Lined up, it reads "Opens after ask N" with Not next. "+N more in Waiting
 * for you" when more are ready. Host screens only: the Host screen's main
 * area and the console's Your part now; the Stage's dock has only a cue.
 */
import React, { useContext, useState } from 'react';
import BuildImage from './BuildImage';
import { ViewerContext } from './MockupViewer';
import { W } from './words';
import { mockupsCard } from './buildScreens';
import Button from '../components/ui/Button';

const askNo = (askId) => Number(askId) || askId;

export default function MockupsReady({
  room, busy, ended, run, api, className = '',
}) {
  const openViewer = useContext(ViewerContext);
  const [confirming, setConfirming] = useState(null); // the askId a confirm belongs to
  const card = ended ? null : mockupsCard(room);
  if (!card) return null;
  const { ask, more, queued, open, nextLeads } = card;
  const putNow = () => run(() => api.askAction(ask.askId, { action: 'open' }));
  const lineUp = (action) => run(() => api.askAction(ask.askId, { action }));
  const asking = confirming === ask.askId && open;
  return (
    <section className={`brm-panel brm-mockready${className ? ` ${className}` : ''}`} aria-label={W.mockupsCardHead} data-testid="brm-mockups-card" data-ask={ask.askId}>
      <p className="brm-mockready-k">{W.mockupsCardHead} · Ask {askNo(ask.askId)}</p>
      <p className="brm-reviewq">{ask.prompt}</p>
      <ul className="brm-mocktiles">
        {(ask.options || []).map((o) => (
          <li key={o.label}>
            <BuildImage imageId={o.imageId} alt={`Choice ${o.label}`} className="brm-mocktile-img" onOpen={openViewer ? () => openViewer(ask.askId, o.label, 'host') : null} />
            <span className="brm-mocktile-t"><b>{o.label}</b> {o.title}</span>
          </li>
        ))}
      </ul>
      {queued ? (
        <div className="brm-row brm-gap">
          <span className="brm-chip" data-testid="brm-mockups-queued">{W.opensAfterAsk(open ? askNo(open.askId) : '')}</span>
          <Button type="button" size={36} className="brm-tight brm-push" disabled={busy} onClick={() => lineUp('notNext')}>{W.notNext}</Button>
        </div>
      ) : asking ? (
        <div className="brm-row brm-gap" role="group" aria-label={W.closeAndOpen(askNo(open.askId))}>
          <b>{W.closeAndOpen(askNo(open.askId))}</b>
          <Button type="button" size={36} className="brm-ctl brm-push" onClick={() => setConfirming(null)}>{W.keepItOpen}</Button>
          <Button type="button" variant="primary" size={36} className="brm-ctl" disabled={busy} onClick={async () => { setConfirming(null); await putNow(); }}>{W.closeAndOpenYes}</Button>
        </div>
      ) : (
        <div className="brm-row brm-gap">
          {open && (
            <Button type="button" variant={nextLeads ? 'primary' : 'secondary'} size={36} className="brm-ctl" disabled={busy} title={W.opensWhenClose(askNo(open.askId))} onClick={() => lineUp('openNext')}>
              {W.nextAfterThis}
            </Button>
          )}
          <Button type="button" variant={nextLeads ? 'secondary' : 'primary'} size={36} className="brm-ctl" disabled={busy} onClick={() => (open ? setConfirming(ask.askId) : putNow())}>
            {W.putToRoomNow}
          </Button>
        </div>
      )}
      {nextLeads && !queued && !asking && <p className="brm-hint">{W.nextFollowsStep}</p>}
      {more > 0 && <p className="brm-hint" data-testid="brm-mockups-more">{W.moreInWaiting(more)}</p>}
    </section>
  );
}
