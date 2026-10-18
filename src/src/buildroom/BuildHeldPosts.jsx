/**
 * THE RELEASE GATE IN THE QUEUE (owner, 17 Oct 2026: "Have thing get to host
 * queue to release to room"; parity PLAN §2c). Claude's posts and screenshots
 * wait in Waiting for you while Session › Settings › Claude says to check
 * them: one card each, with its words, its picture and its link, and two
 * moves: Release to the room, or Keep to myself (private for good). Release
 * all when several wait. The Host screen only: never projected.
 */
import React from 'react';
import Icon from '../components/Icon';
import BuildImage from './BuildImage';
import { SafeLink } from './screens/common';
import { postImageId } from './buildScreens';
import { W } from './words';

const clock = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try { return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; }
};

/** One held post: what Claude wants the room to see, and the host's two moves. */
export function QueuePost({ entry, busy, ended, run, api }) {
  const imageId = postImageId(entry);
  const act = (action) => run(() => api.postsAction(action, [entry.logId]));
  return (
    <div className="brm-idea brm-qpost" data-capability="release-posts">
      <div className="brm-row brm-gap">
        <span className="brm-who">{W.postWants} · {clock(entry.createdAt)}</span>
      </div>
      <div className="brm-idea-text">{entry.text}</div>
      {entry.detail && !imageId && <div className="brm-hint">{entry.detail}</div>}
      {imageId && <BuildImage imageId={imageId} alt={entry.text} className="brm-shot brm-shot--tl" />}
      {entry.link && <SafeLink className="brm-lnk brm-block" href={entry.link}>{entry.link}</SafeLink>}
      {!ended && (
        <div className="brm-idea-acts">
          <button type="button" className="brm-btn brm-btn--sm" disabled={busy} onClick={() => act('release')}>
            <Icon name="Eye" size={14} /> {W.postRelease}
          </button>
          <button type="button" className="brm-btn brm-btn--sm brm-btn--ghost" disabled={busy} onClick={() => act('keep')}>{W.postKeep}</button>
        </div>
      )}
    </div>
  );
}

/** Release all, when two or more posts wait. */
export function ReleaseAll({ posts, busy, ended, run, api }) {
  if (ended || posts.length < 2) return null;
  return (
    <div className="brm-row brm-gap brm-ackall" data-capability="release-posts">
      <span className="brm-hint">{W.postsWaiting(posts.length)}</span>
      <button type="button" className="brm-btn brm-btn--sm brm-push" disabled={busy} onClick={() => run(() => api.postsAction('release', posts.map((p) => p.logId)))}>
        {W.postReleaseAll(posts.length)}
      </button>
    </div>
  );
}
