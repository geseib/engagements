import * as Ph from "@phosphor-icons/react";

/**
 * Warm Summit icon wrapper around @phosphor-icons/react.
 *
 * Weight discipline (see design spec §3):
 *   - "duotone" (amber fill) for the ~15 feature / hero icons
 *   - "bold" for inline UI controls (the default)
 *   - "fill" for status dots
 *
 * Usage: <Icon name="Trophy" weight="duotone" color="var(--primary)" size={32} />
 * Unknown names fall back to a Circle so a typo never crashes a render.
 */
export default function Icon({
  name,
  weight = "bold",
  size = 24,
  color = "currentColor",
  ...rest
}) {
  const C = Ph[name] ?? Ph.Circle;
  return <C size={size} weight={weight} color={color} {...rest} />;
}
