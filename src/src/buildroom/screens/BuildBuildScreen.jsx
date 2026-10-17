/**
 * BUILD: what Claude has built so far (owner, 2026-10-05: "present is really
 * switching to the local live view of the development server"). Showing the
 * running page inside Engage waits on a browser check (PLAN step 0: an https
 * page could not frame localhost in Chromium 152), so this screen shows the
 * newest screenshot and opens the running build in a new tab: the fallback
 * the design keeps anyway (C8).
 *
 * A display component (parity PLAN §2.5, B6). With `controls` (one screen:
 * the host's page) it offers Share demo, as before. With none (the room's
 * window) it has no button; the build's link and its QR stay, they are for
 * the room.
 *
 * controls: { ended, busy, run, api }
 */
import React, { useContext } from 'react';
import BuildImage from '../BuildImage';
import { ViewerContext } from '../MockupViewer';
import { W } from '../words';
import { latestBuild } from '../buildScreens';
import { wifiState, demoRunnable } from '../wifiShare';
import { wifiLink, BuildScreenQr } from '../BuildWifiShare';
import { safeHref } from '../links';
import {
  askById, OpenLink, WallComment, freshWallComment,
} from './common';

export default function BuildBuildScreen({ room, now, controls = null }) {
  const latest = latestBuild(room);
  const { shot } = latest;
  const openViewer = useContext(ViewerContext);
  // A newest screenshot that is a choice ask's option opens the viewer (R2).
  const shotAsk = shot && shot.askId ? askById(room, shot.askId) : null;
  const shotOpt = shotAsk && shotAsk.kind === 'choice' ? (shotAsk.options || []).find((o) => o.label === shot.label) : null;
  // SHARE DEMO (D3, D6): shared, the link is the address every device gets; not, it is this laptop's own.
  const lan = room.lan || {};
  const shareLink = ['on', 'quiet'].includes(wifiState(lan, now).state) ? wifiLink(room) : '';
  const link = shareLink || latest.link;
  const offerShare = Boolean(controls) && !controls.ended && !lan.wanted && demoRunnable(room) && Boolean(controls.api);
  let shown = link;
  if (shareLink) { try { shown = new URL(shareLink).host; } catch (e) { shown = ''; } }
  return (
    <section className="brm-screenbody brm-buildscreen" aria-label="The build" data-capability="build-screen">
      <WallComment comment={freshWallComment(room, now)} />
      <div className="brm-row brm-buildrow">
        <h2 className="brm-q">{W.buildSoFar}</h2>
        {safeHref(link) && <span className="brm-push"><OpenLink href={link} label={W.openBuild} primary={!offerShare} /></span>}
        {offerShare && (
          <button type="button" className={`brm-btn brm-btn--primary${safeHref(link) ? '' : ' brm-push'}`} disabled={controls.busy} onClick={() => controls.run(() => controls.api.share({ on: true }))}>{W.shareDemo}</button>
        )}
      </div>
      {safeHref(link) && (
        <p className="brm-buildurl">
          <span className="brm-buildurl-u">{shown}</span>
          <span className="brm-buildurl-who">{shareLink ? W.anyoneOnWifi : W.onlyThisLaptop}</span>
        </p>
      )}
      {shot ? (
        <BuildImage imageId={shot.imageId} caption={shot.caption} className="brm-shot brm-shot--build" onOpen={controls && shotOpt && openViewer ? () => openViewer(shotAsk.askId, shotOpt.label, 'build') : null} linked={Boolean(controls)} />
      ) : (
        <div className="brm-empty">Nothing to show yet.</div>
      )}
      <BuildScreenQr link={shareLink} open={lan.open} />
    </section>
  );
}
