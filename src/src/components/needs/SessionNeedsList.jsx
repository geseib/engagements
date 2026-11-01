import React from 'react';
import Button from '../ui/Button';
import NeedsActions from './NeedsActions';
import PrivateReveal from './PrivateReveal';
import { NEEDS_LEVELS, NEEDS_WORDS } from '../../config/needsYou';
import './NeedsYou.css';

/** One named item with its buttons. */
export function NeedsItem({ item, onAct, busy, error = '' }) {
  return (
    <li className={`ny-item${item.level === NEEDS_LEVELS.NOW ? ' is-now' : ''}`} data-testid={`needs-item-${item.kind}`}>
      <p className="ny-item-t">{item.text}</p>
      {item.detail ? <p className="ny-item-d">{item.detail}</p> : null}
      {error ? <p className="ny-item-d ny-error" role="alert">{error}</p> : null}
      <NeedsActions item={item} onAct={onAct} busy={busy} />
    </li>
  );
}

/**
 * THIS SESSION'S NEEDS, AS A LIST (the bell's first section, the phone
 * Remote's card, the one-screen sheet). On a private screen each item is
 * named with its buttons. With `oneScreen` each item is its KIND only
 * ("A name request") until "Show on this screen" is pressed for it, and the
 * other way is the phone: "Open on your phone" when the Remote is connected
 * (it is already waiting there), else "Connect your phone" (PLAN §3.3).
 */
export default function SessionNeedsList({
  needs, onAct, busy = false, error = '', oneScreen = false, remoteConnected = false, onConnectPhone = null,
}) {
  const items = (needs && needs.items) || [];
  if (!items.length) return <p className="ny-empty" data-testid="needs-empty">{NEEDS_WORDS.calm}</p>;
  if (!oneScreen) {
    return (
      <>
        {error ? <p className="ny-empty ny-error" role="alert">{error}</p> : null}
        <ul className="ny-list" data-testid="needs-list">
          {items.map((item) => <NeedsItem key={item.id} item={item} onAct={onAct} busy={busy} />)}
        </ul>
      </>
    );
  }
  const phone = remoteConnected
    ? <span className="ny-item-d">{NEEDS_WORDS.waitingOnPhone}</span>
    : (typeof onConnectPhone === 'function'
      ? <Button size="sm" variant="quiet" onClick={onConnectPhone}>{NEEDS_WORDS.connectPhone}</Button>
      : null);
  return (
    <ul className="ny-list" data-testid="needs-list">
      {items.map((item) => (
        <li key={item.id} className={`ny-item${item.level === NEEDS_LEVELS.NOW ? ' is-now' : ''}`} data-testid={`needs-kind-${item.kind}`}>
          <p className="ny-item-t">{item.kindText}</p>
          {/* The sheet's heading already says "The room can see this screen";
              each item does not say it again. */}
          <PrivateReveal oneScreen note={false} summary="" testId={`needs-reveal-${item.kind}`} after={phone}>
            <ul className="ny-list"><NeedsItem item={item} onAct={onAct} busy={busy} /></ul>
          </PrivateReveal>
        </li>
      ))}
    </ul>
  );
}
