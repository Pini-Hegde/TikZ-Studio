"use client";

import { useEffect, useId, useRef, useState } from "react";
import "./Logo.css";

// The TikZ Studio mark, "Code Bloom": LaTeX braces (the code) cradle a commutative diagram (the classic TikZ
// figure) whose peak is the AI sparkle — your words become code, the code becomes a figure. It plays that story
// on mount, twinkles while idle and replays on hover; with `loop` it retells the story forever, fading the drawing
// out between rounds. Its own ice-blue tile keeps it the same on light and dark.
// Static copy: app/icon.svg. Alternatives: rough stuff/logos.html.

// A four-point sparkle with concave sides, centred on (cx, cy) with tip radius R.
const star = (cx: number, cy: number, R: number) => {
  const a = 0.124 * R, b = 0.276 * R, c = 0.286 * R;
  return `M${cx} ${cy - R} C${cx + a} ${cy - c} ${cx + b} ${cy - a} ${cx + R} ${cy} C${cx + b} ${cy + a} ${cx + a} ${cy + c} ${cx} ${cy + R} C${cx - a} ${cy + c} ${cx - b} ${cy + a} ${cx - R} ${cy} C${cx - b} ${cy - a} ${cx - a} ${cy - c} ${cx} ${cy - R} Z`;
};

const STORY_MS = 2400; // the intro's length; hovering again during it doesn't restart it
const LOOP_MS = 6000; // one looped round: the story, a pause on the finished mark, then the fade
const FADE_MS = 450;

export default function Logo({ size = 32, loop = false }: { size?: number; loop?: boolean }) {
  // Gradient ids must be unique per instance and safe inside url(#…).
  const id = `logo${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  // Re-keying the <svg> remounts it, which restarts every CSS animation: the hover replay.
  const [run, setRun] = useState(0);
  const [fading, setFading] = useState(false);
  const startedAt = useRef(0);

  // Loop: near the end of each round fade the drawing out, then remount to draw it again. Reduced motion: no loop.
  useEffect(() => {
    if (!loop || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const fade = setTimeout(() => setFading(true), LOOP_MS - FADE_MS);
    const next = setTimeout(() => {
      setFading(false);
      setRun((n) => n + 1);
    }, LOOP_MS);
    return () => {
      clearTimeout(fade);
      clearTimeout(next);
    };
  }, [loop, run]);

  const replay = () => {
    if (loop) return; // already retelling the story
    const now = performance.now();
    if (now - startedAt.current < STORY_MS) return;
    startedAt.current = now;
    setRun((n) => n + 1);
  };

  return (
    <svg key={run} className="lg lg-bloom" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" onMouseEnter={replay}>
      <defs>
        <linearGradient id={`${id}t`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7edaf4" />
          <stop offset="0.25" stopColor="#3bb3de" />
          <stop offset="0.5" stopColor="#198bb9" />
          <stop offset="0.75" stopColor="#0c6b99" />
          <stop offset="1" stopColor="#024e7c" />
        </linearGradient>
        <radialGradient id={`${id}s`} cx="0.28" cy="0" r="0.85">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.42" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}k`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffeebb" />
          <stop offset="1" stopColor="#fbb361" />
        </linearGradient>
        <radialGradient id={`${id}g`}>
          <stop offset="0" stopColor="#fcc26f" stopOpacity="0.6" />
          <stop offset="1" stopColor="#fcc26f" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Ice-blue tile, top sheen, crisp inner edge, and a faint coordinate grid like drafting paper. */}
      <rect x="2" y="2" width="60" height="60" rx="17" fill={`url(#${id}t)`} />
      <rect x="2" y="2" width="60" height="60" rx="17" fill={`url(#${id}s)`} />
      <rect x="2.75" y="2.75" width="58.5" height="58.5" rx="16.25" fill="none" stroke="#ffffff" strokeOpacity="0.28" strokeWidth="1.5" />
      <g fill="#ffffff" opacity="0.18">
        {[16, 32, 48].flatMap((x) => [16, 32, 48].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1" />))}
      </g>

      <g className={loop && fading ? "art out" : "art"}>
        {/* The code: TikZ's curly braces. */}
        <path className="ln brace brace-l" pathLength={1} strokeWidth="3.2" d="M22 14 C17 14 17 17 17 21 L17 27 C17 30 15.5 32 12.5 32 C15.5 32 17 34 17 37 L17 43 C17 47 17 50 22 50" />
        <path className="ln brace brace-r" pathLength={1} strokeWidth="3.2" d="M42 14 C47 14 47 17 47 21 L47 27 C47 30 48.5 32 51.5 32 C48.5 32 47 34 47 37 L47 43 C47 47 47 50 42 50" />

        {/* The figure: a commutative diamond growing up from its base node. */}
        <path className="ln e1" pathLength={1} strokeWidth="2.3" strokeOpacity="0.9" d="M32 47.5 L24.5 37" />
        <path className="ln e2" pathLength={1} strokeWidth="2.3" strokeOpacity="0.9" d="M32 47.5 L39.5 37" />
        <path className="ln e3" pathLength={1} strokeWidth="2.3" strokeOpacity="0.9" d="M24.5 37 L32 24.5" />
        <path className="ln e4" pathLength={1} strokeWidth="2.3" strokeOpacity="0.9" d="M39.5 37 L32 24.5" />
        <g className="node n1">
          <circle cx="32" cy="47.5" r="3.7" fill="#ffffff" />
          <circle cx="32" cy="47.5" r="1.5" fill="#0e527b" />
        </g>
        <circle className="node n2" cx="24.5" cy="37" r="3.2" fill="#ffffff" />
        <circle className="node n3" cx="39.5" cy="37" r="3.2" fill="#ffffff" />

        {/* The AI: a golden sparkle crowning the figure, its glow, and a small twinkle in the corner. */}
        <circle className="glow" cx="32" cy="24" r="12" fill={`url(#${id}g)`} />
        <path className="spark" d={star(32, 24, 8)} fill={`url(#${id}k)`} stroke="#ffffff" strokeOpacity="0.6" strokeWidth="0.8" />
        <circle className="core" cx="32" cy="24" r="1.45" fill="#ffffff" />
        <path className="mini" d={star(53, 11.5, 3.6)} fill="#ffffff" />
      </g>
    </svg>
  );
}
