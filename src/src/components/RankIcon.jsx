import React from 'react';
import Icon from './Icon';

/**
 * Placement badge — gold trophy for 1st, silver/bronze medals for 2nd/3rd, a
 * neutral pin for everyone else. The same ladder appeared inline in five places
 * across the host and player pages; keeping it here means the leaderboard, the
 * results panel and the round-score card can never drift apart.
 */
export const RANK_COLOR = {
  1: 'var(--primary)',
  2: 'var(--silver)',
  3: 'var(--bronze)',
};

export default function RankIcon({ rank, size = 20, ...rest }) {
  if (rank === 1) {
    return <Icon name="Trophy" weight="fill" size={size} color={RANK_COLOR[1]} {...rest} />;
  }
  if (rank === 2 || rank === 3) {
    return <Icon name="Medal" weight="fill" size={size} color={RANK_COLOR[rank]} {...rest} />;
  }
  return <Icon name="MapPin" weight="bold" size={Math.round(size * 0.9)} color="var(--muted)" {...rest} />;
}

/** "1st Place" / "2nd Place" / … — ordinal suffix handled for the teens too. */
export function rankLabel(rank) {
  const n = Number(rank) || 0;
  const tens = n % 100;
  const suffix =
    tens >= 11 && tens <= 13 ? 'th'
    : n % 10 === 1 ? 'st'
    : n % 10 === 2 ? 'nd'
    : n % 10 === 3 ? 'rd'
    : 'th';
  return `${n}${suffix} Place`;
}

/** Vote-slot ordering used by call-and-answer ranked voting. */
export const VOTE_POSITIONS = { first: 1, second: 2, third: 3 };
