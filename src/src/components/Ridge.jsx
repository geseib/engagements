import React, { useId } from "react";

/**
 * Warm Summit mountain motif (design spec §4).
 *
 * One inline-SVG ridgeline — three overlapping vector paths anchored to the
 * bottom edge with tokened fills (--ridge-front / --ridge-mid / --ridge-back)
 * plus a soft radial amber summit-glow behind the peaks. Razor-sharp at any
 * projector resolution, zero external deps. Replaces the Osmo .webp parallax.
 *
 * It is a persistent backdrop across the four big-screen states and recedes
 * when content needs the stage:
 *   lobby    -> tall band (~40vh), warm low glow; event title floats above peaks
 *   question -> thin ~15vh band, glow near-zero; the question owns the screen
 *   results  -> glow brightens & rises: peaks catch an amber alpenglow rim-light
 *   summit   -> filled peak + full amber convergence (pair with <Confetti> above)
 *
 * Content always floats above it. 400ms transform/opacity cross-fade between
 * states is handled by CSS transitions below.
 *
 * Usage: <Ridge variant="lobby | question | results | summit" />
 */
const VARIANTS = {
  lobby:    { band: "40vh", glow: 0.35, glowShift: 0,   rim: 0,    frontFill: "var(--ridge-front)" },
  question: { band: "15vh", glow: 0.05, glowShift: 8,   rim: 0,    frontFill: "var(--ridge-front)" },
  results:  { band: "28vh", glow: 0.6,  glowShift: -6,  rim: 0.7,  frontFill: "var(--ridge-front)" },
  summit:   { band: "46vh", glow: 0.85, glowShift: -10, rim: 0.9,  frontFill: "var(--primary-deep)" },
};

export default function Ridge({ variant = "lobby", className = "", style = {} }) {
  const cfg = VARIANTS[variant] ?? VARIANTS.lobby;
  const uid = useId().replace(/:/g, "");
  const glowId = `ridge-glow-${uid}`;

  return (
    <div
      aria-hidden="true"
      className={`ridge ridge--${variant} ${className}`}
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: cfg.band,
        pointerEvents: "none",
        zIndex: 0,
        overflow: "hidden",
        transition: "height 400ms ease",
        ...style,
      }}
    >
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 1200 600"
        preserveAspectRatio="none"
        style={{ display: "block", position: "absolute", inset: 0 }}
      >
        <defs>
          <radialGradient id={glowId} cx="50%" cy="42%" r="55%">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.9" />
            <stop offset="45%" stopColor="var(--primary)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* amber summit-glow — the only warm light on the stage */}
        <rect
          x="0"
          y="0"
          width="1200"
          height="600"
          fill={`url(#${glowId})`}
          opacity={cfg.glow}
          transform={`translate(0 ${cfg.glowShift * 6})`}
          style={{ transition: "opacity 400ms ease, transform 400ms ease" }}
        />

        {/* back range */}
        <path
          d="M0,600 L0,510 L260,540 L520,500 L780,540 L1040,510 L1200,530 L1200,600 Z"
          fill="var(--ridge-back)"
        />
        {/* mid range */}
        <path
          d="M0,600 L0,470 L220,500 L430,430 L640,470 L860,420 L1080,480 L1200,460 L1200,600 Z"
          fill="var(--ridge-mid)"
        />
        {/* front range — sharp central summit under the glow */}
        <path
          d="M0,600 L0,420 L180,470 L340,360 L520,300 L600,230 L700,320 L880,380 L1060,440 L1200,410 L1200,600 Z"
          fill={cfg.frontFill}
          stroke="var(--primary)"
          strokeWidth="2"
          strokeOpacity={cfg.rim}
          style={{ transition: "stroke-opacity 400ms ease, fill 400ms ease" }}
        />
      </svg>
    </div>
  );
}
