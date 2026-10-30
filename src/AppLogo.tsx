import { useId } from "react";

export default function AppLogo() {
  const uid = useId().replace(/:/g, "");
  const bg = `logo-bg-${uid}`;
  const glow = `logo-glow-${uid}`;
  const edge = `logo-edge-${uid}`;
  const mark = `logo-mark-${uid}`;
  const shine = `logo-shine-${uid}`;

  return (
    <span className="app-logo" aria-hidden="true">
      <svg viewBox="0 0 64 64" role="img">
        <defs>
          <linearGradient id={bg} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#26262f" />
            <stop offset="42%" stopColor="#111116" />
            <stop offset="100%" stopColor="#000000" />
          </linearGradient>
          <radialGradient id={glow} cx="0.28" cy="0.16" r="0.85">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.4" />
            <stop offset="36%" stopColor="#ffffff" stopOpacity="0.09" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={edge} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.55" />
            <stop offset="42%" stopColor="#ffffff" stopOpacity="0.06" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0.2" />
          </linearGradient>
          <linearGradient id={mark} x1="0" y1="0" x2="0.8" y2="1">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="55%" stopColor="#f2f2f7" />
            <stop offset="100%" stopColor="#b6b6c4" />
          </linearGradient>
          <linearGradient id={shine} x1="0" y1="0" x2="0.7" y2="1">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
        </defs>
        <rect width="64" height="64" rx="16" fill={`url(#${bg})`} />
        <path
          d="M0 0h64v20C46 30 26 6 0 22Z"
          fill={`url(#${shine})`}
          opacity="0.7"
        />
        <rect width="64" height="64" rx="16" fill={`url(#${glow})`} />
        <rect
          x="0.65"
          y="0.65"
          width="62.7"
          height="62.7"
          rx="15.35"
          fill="none"
          stroke={`url(#${edge})`}
          strokeWidth="1.3"
        />
        <path
          d="M19 23.5 31 32 19 40.5"
          fill="none"
          stroke={`url(#${mark})`}
          strokeWidth="4.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M36 41h10"
          fill="none"
          stroke="#f2f2f7"
          strokeWidth="4.6"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}
