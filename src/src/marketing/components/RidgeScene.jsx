import React from 'react';
import './RidgeScene.css';

/**
 * The route is the mockup's own cubic Bézier:
 *   M92 418 C 196 398 238 352 328 338 S 468 302 520 270 S 572 236 600 216
 * The two `S` (smooth) segments are expanded here into explicit cubics: each
 * one's first control point is the reflection of the previous segment's
 * second control point about their shared join.
 *   seg1: P0(92,418)  C1(196,398) C2(238,352) P1(328,338)
 *   seg2: P1(328,338) C1(418,324) C2(468,302) P2(520,270)   [C1 = 2*P1 - seg1.C2]
 *   seg3: P2(520,270) C1(572,238) C2(572,236) P3(600,216)   [C1 = 2*P2 - seg2.C2]
 */
const SEGMENTS = [
  [[92, 418], [196, 398], [238, 352], [328, 338]],
  [[328, 338], [418, 324], [468, 302], [520, 270]],
  [[520, 270], [572, 238], [572, 236], [600, 216]],
];

const SAMPLES_PER_SEGMENT = 40;

function cubicPoint([p0x, p0y], [c1x, c1y], [c2x, c2y], [p3x, p3y], t) {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return [
    a * p0x + b * c1x + c * c2x + d * p3x,
    a * p0y + b * c1y + c * c2y + d * p3y,
  ];
}

/**
 * A pure-math arc-length lookup table, built once at module load. jsdom has
 * no getPointAtLength and this needs none: it samples each cubic segment,
 * accumulates Euclidean distance between samples, and later interpolates
 * along that table so equal steps of `progress` cover equal distance (an
 * even climb) rather than equal parameter `t` (which would race through the
 * flatter segments and crawl the steep ones).
 */
function buildArcLengthTable() {
  const points = [];
  const cumLen = [0];
  SEGMENTS.forEach((seg) => {
    for (let i = 0; i <= SAMPLES_PER_SEGMENT; i += 1) {
      const t = i / SAMPLES_PER_SEGMENT;
      const [x, y] = cubicPoint(seg[0], seg[1], seg[2], seg[3], t);
      if (points.length > 0) {
        const [px, py] = points[points.length - 1];
        cumLen.push(cumLen[cumLen.length - 1] + Math.hypot(x - px, y - py));
      }
      points.push([x, y]);
    }
  });
  return { points, cumLen, total: cumLen[cumLen.length - 1] };
}

const ARC_TABLE = buildArcLengthTable();

/** Clamp progress to [0,1]; a non-number reads as 0. */
export function pointOnRoute(progress) {
  const numeric = Number(progress);
  const p = Number.isFinite(numeric) ? Math.min(1, Math.max(0, numeric)) : 0;
  const target = p * ARC_TABLE.total;
  const { cumLen, points } = ARC_TABLE;

  let lo = 0;
  let hi = cumLen.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cumLen[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  const i = Math.max(1, lo);
  const segStart = cumLen[i - 1];
  const segEnd = cumLen[i];
  const segT = segEnd > segStart ? (target - segStart) / (segEnd - segStart) : 0;
  const [x0, y0] = points[i - 1];
  const [x1, y1] = points[i];
  return {
    x: Math.round(x0 + (x1 - x0) * segT),
    y: Math.round(y0 + (y1 - y0) * segT),
  };
}

/** Drift depths and total travel from the brief: back 0.15, mid 0.35, front
 * 0.60, 140px of travel at depth 1 across the whole page. Negative = upward. */
const DEPTH = { back: 0.15, mid: 0.35, front: 0.6 };
const TRAVEL = 140;

const driftStyle = (depth, progress) => ({
  '--mk-drift': `${(-TRAVEL * depth * progress).toFixed(1)}px`,
});

export default function RidgeScene({ progress = 0 }) {
  const climber = pointOnRoute(progress);

  return (
    <div className="mk-ridge" aria-hidden="true">
      <div className="mk-ridge-sky" />
      <svg className="mk-ridge-stars" viewBox="0 0 1200 400" preserveAspectRatio="xMidYMin slice">
        <circle cx="88" cy="54" r="1.5" /><circle cx="212" cy="122" r="1.1" />
        <circle cx="318" cy="40" r="1.7" /><circle cx="404" cy="150" r="1" />
        <circle cx="512" cy="76" r="1.3" /><circle cx="596" cy="34" r="1" />
        <circle cx="688" cy="118" r="1.6" /><circle cx="770" cy="58" r="1.1" />
        <circle cx="866" cy="142" r="1.2" /><circle cx="944" cy="46" r="1.5" />
        <circle cx="1042" cy="104" r="1" /><circle cx="1136" cy="66" r="1.4" />
        <circle cx="150" cy="196" r="1" /><circle cx="1004" cy="180" r="1.1" />
      </svg>
      {/* No inline opacity: the glow renders at exactly the mockup's CSS at
          every progress value — ramping it made first paint visibly dimmer
          than the owner-approved mockup, which the contrast audit was
          measured against. */}
      <div className="mk-ridge-glow" />
      <div className="mk-ridge-haze" />

      <svg
        className="mk-ridge-layer mk-ridge-back"
        viewBox="0 0 1200 420"
        preserveAspectRatio="xMidYMax slice"
        style={driftStyle(DEPTH.back, progress)}
      >
        <path className="mk-ridge-body" d="M0 300 L120 236 L230 268 L360 176 L470 232 L600 108 L720 196 L840 150 L960 224 L1080 180 L1200 246 L1200 420 L0 420 Z" />
      </svg>

      <svg
        className="mk-ridge-layer mk-ridge-mid"
        viewBox="0 0 1200 420"
        preserveAspectRatio="xMidYMax slice"
        style={driftStyle(DEPTH.mid, progress)}
      >
        <path className="mk-ridge-body" d="M0 352 L150 300 L280 330 L420 244 L540 292 L600 214 L680 270 L810 226 L940 300 L1060 262 L1200 318 L1200 420 L0 420 Z" />
        <path className="mk-ridge-route" d="M92 418 C 196 398 238 352 328 338 S 468 302 520 270 S 572 236 600 216" />
        <circle className="mk-ridge-climber-halo" cx={climber.x} cy={climber.y} r="15" />
        <circle className="mk-ridge-climber" cx={climber.x} cy={climber.y} r="6.5" />
        <line className="mk-ridge-mast" x1="600" y1="216" x2="600" y2="186" />
        <path className="mk-ridge-flag" d="M601 186 L628 195 L601 204 Z" />
      </svg>

      <svg
        className="mk-ridge-layer mk-ridge-front"
        viewBox="0 0 1200 420"
        preserveAspectRatio="xMidYMax slice"
        style={driftStyle(DEPTH.front, progress)}
      >
        <path className="mk-ridge-body" d="M0 400 L110 360 L240 388 L380 322 L500 364 L600 300 L700 348 L830 310 L980 368 L1110 336 L1200 372 L1200 420 L0 420 Z" />
      </svg>
    </div>
  );
}
