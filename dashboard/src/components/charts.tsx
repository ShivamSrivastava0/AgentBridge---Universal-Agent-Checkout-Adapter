'use client';

import { motion } from 'motion/react';
import { useState } from 'react';
import { formatPaise } from '@/lib/format';
import { ease } from './motion';

/** Smooth area chart with a line that draws itself and a hover readout. */
export function AreaChart({ points }: { points: { label: string; value: number; sub?: string }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 600;
  const H = 180;
  const P = 8;
  const max = Math.max(1, ...points.map((p) => p.value));
  const step = (W - P * 2) / Math.max(1, points.length - 1);
  const xy = points.map((p, i) => [P + i * step, H - P - (p.value / max) * (H - P * 2 - 10)] as const);
  const line = xy.reduce((d, [x, y], i) => {
    if (i === 0) return `M${x},${y}`;
    const [px, py] = xy[i - 1]!;
    const cx = (px + x) / 2;
    return `${d} C${cx},${py} ${cx},${y} ${x},${y}`;
  }, '');
  const area = `${line} L${xy.at(-1)![0]},${H} L${xy[0]![0]},${H} Z`;
  const h = hover !== null ? points[hover] : null;

  return (
    <div className="area-chart">
      <div className="area-readout" aria-live="polite">
        {h ? (
          <>
            <strong>{formatPaise(h.value)}</strong> <span>{h.label}{h.sub ? ` · ${h.sub}` : ''}</span>
          </>
        ) : (
          <span>Hover the chart to see each day</span>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Paid volume per day" onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="areaFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={0} x2={W} y1={H * f} y2={H * f} className="grid-line" />
        ))}
        <motion.path d={area} fill="url(#areaFill)" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: 0.4 }} />
        <motion.path
          d={line}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={2.5}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.2, ease }}
        />
        {xy.map(([x, y], i) => (
          <g key={i}>
            <rect x={x - step / 2} y={0} width={step} height={H} fill="transparent" onMouseEnter={() => setHover(i)} />
            {hover === i && (
              <>
                <line x1={x} x2={x} y1={0} y2={H} className="hover-line" />
                <circle cx={x} cy={y} r={5} className="hover-dot" />
              </>
            )}
          </g>
        ))}
      </svg>
      <div className="area-axis">
        {points.map((p, i) => (
          <span key={i} className={i % 2 ? 'odd' : ''}>
            {p.label.split(' ')[0]}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Donut with animated segments and a legend. */
export function Donut({ segments, center }: { segments: { label: string; value: number; color: string }[]; center: { value: string; label: string } }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const R = 52;
  const C = 2 * Math.PI * R;
  const arcs = segments.map((s, i) => {
    const len = (s.value / total) * C;
    const offset = segments.slice(0, i).reduce((sum, x) => sum + (x.value / total) * C, 0);
    return { ...s, len, offset };
  });
  return (
    <div className="donut">
      <svg viewBox="0 0 140 140" role="img" aria-label="How orders were decided">
        <circle cx={70} cy={70} r={R} className="donut-track" />
        {arcs.map(({ len, offset, ...s }, i) => (
            <motion.circle
              key={s.label}
              cx={70}
              cy={70}
              r={R}
              fill="none"
              stroke={s.color}
              strokeWidth={16}
              strokeDasharray={`${len} ${C - len}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 70 70)"
              initial={{ opacity: 0, strokeDasharray: `0 ${C}` }}
              animate={{ opacity: 1, strokeDasharray: `${Math.max(0, len - 2)} ${C - Math.max(0, len - 2)}` }}
              transition={{ duration: 0.9, delay: 0.15 * i, ease }}
            />
        ))}
        <text x={70} y={68} textAnchor="middle" className="donut-value">
          {center.value}
        </text>
        <text x={70} y={86} textAnchor="middle" className="donut-label">
          {center.label}
        </text>
      </svg>
      <ul className="legend">
        {segments.map((s) => (
          <li key={s.label}>
            <span className="swatch" style={{ background: s.color }} />
            <span className="legend-label">{s.label}</span>
            <b>{s.value}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Circular budget gauge. */
export function BudgetRing({ used, total, size = 112 }: { used: number; total: number; size?: number }) {
  const pct = Math.min(1, total > 0 ? used / total : 0);
  const R = 44;
  const C = 2 * Math.PI * R;
  const tone = pct > 0.9 ? 'var(--bad)' : pct > 0.7 ? 'var(--warn)' : 'var(--accent)';
  return (
    <div className="budget-ring" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100">
        <circle cx={50} cy={50} r={R} className="budget-ring-track" />
        <motion.circle
          cx={50}
          cy={50}
          r={R}
          fill="none"
          stroke={tone}
          strokeWidth={9}
          strokeLinecap="round"
          transform="rotate(-90 50 50)"
          strokeDasharray={C}
          initial={{ strokeDashoffset: C }}
          animate={{ strokeDashoffset: C * (1 - pct) }}
          transition={{ duration: 1.1, ease }}
        />
      </svg>
      <div className="budget-ring-center">
        <strong>{Math.round(pct * 100)}%</strong>
        <span>used</span>
      </div>
    </div>
  );
}
