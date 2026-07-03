"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";

interface Props {
  score: number; // 0–100
  size?: number;
}

export default function CredibilityGauge({ score, size = 180 }: Props) {
  const [displayed, setDisplayed] = useState(0);

  // Animate the number counting up
  useEffect(() => {
    const start = Date.now();
    const duration = 1200;
    const tick = () => {
      const elapsed = Date.now() - start;
      const pct = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - pct, 3);
      setDisplayed(Math.round(eased * score));
      if (pct < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [score]);

  // Arc maths — a 240° arc centered at the bottom
  const cx = size / 2;
  const cy = size / 2 + size * 0.08;
  const r = size * 0.38;
  const strokeW = size * 0.072;
  const startAngle = -210; // degrees
  const endAngle = 30;
  const totalDeg = endAngle - startAngle;

  function polar(cx: number, cy: number, r: number, deg: number) {
    const rad = (deg * Math.PI) / 180;
    return {
      x: cx + r * Math.cos(rad),
      y: cy + r * Math.sin(rad),
    };
  }

  function arcPath(startDeg: number, endDeg: number) {
    const s = polar(cx, cy, r, startDeg);
    const e = polar(cx, cy, r, endDeg);
    const largeArc = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
    return `M ${s.x} ${s.y} A ${r} ${r} 0 ${largeArc} 1 ${e.x} ${e.y}`;
  }

  const filledDeg = startAngle + (score / 100) * totalDeg;

  // Colour stops
  const trackColor = "#1f1f24";
  const fillColor =
    score >= 65 ? "#34d399" :   // emerald
    score >= 35 ? "#fbbf24" :   // amber
    "#f87171";                   // red

  const gradId = `gauge-grad-${Math.round(score)}`;

  return (
    <div className="flex flex-col items-center select-none" style={{ width: size }}>
      <svg width={size} height={size * 0.76} viewBox={`0 0 ${size} ${size * 0.76}`}>
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={fillColor} stopOpacity="0.6" />
            <stop offset="100%" stopColor={fillColor} />
          </linearGradient>
        </defs>

        {/* Track */}
        <path
          d={arcPath(startAngle, endAngle)}
          fill="none"
          stroke={trackColor}
          strokeWidth={strokeW}
          strokeLinecap="round"
        />

        {/* Filled arc — animated */}
        <motion.path
          d={arcPath(startAngle, filledDeg)}
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth={strokeW}
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
        />

        {/* Needle dot */}
        {(() => {
          const np = polar(cx, cy, r, filledDeg);
          return (
            <motion.circle
              cx={np.x}
              cy={np.y}
              r={strokeW * 0.65}
              fill={fillColor}
              initial={{ opacity: 0, scale: 0 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.8, duration: 0.4 }}
            />
          );
        })()}

        {/* Centre score */}
        <text
          x={cx}
          y={cy + 4}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="white"
          fontSize={size * 0.22}
          fontWeight="800"
          fontFamily="system-ui, sans-serif"
        >
          {displayed}
        </text>
        <text
          x={cx}
          y={cy + size * 0.175}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="#6b7280"
          fontSize={size * 0.075}
          fontWeight="600"
          fontFamily="system-ui, sans-serif"
        >
          / 100
        </text>

        {/* Labels */}
        {[0, 35, 65, 100].map(v => {
          const deg = startAngle + (v / 100) * totalDeg;
          const lp = polar(cx, cy, r + strokeW * 1.4, deg);
          return (
            <text
              key={v}
              x={lp.x}
              y={lp.y}
              textAnchor="middle"
              dominantBaseline="middle"
              fill="#4b5563"
              fontSize={size * 0.055}
              fontFamily="system-ui, sans-serif"
            >
              {v}
            </text>
          );
        })}
      </svg>

      {/* Verdict label */}
      <div
        className={`text-xs font-bold uppercase tracking-widest mt-1 ${
          score >= 65 ? "text-emerald-400" :
          score >= 35 ? "text-amber-400" :
          "text-red-400"
        }`}
      >
        {score >= 65 ? "✓ Credible" : score >= 35 ? "⚠ Questionable" : "✗ Low Credibility"}
      </div>
      <div className="text-[10px] text-neutral-600 mt-0.5 uppercase tracking-wider">Credibility Score</div>
    </div>
  );
}
