import { useId } from "react";

export default function AppLogo() {
  const uid = useId().replace(/:/g, "");
  const bg = `logo-bg-${uid}`;
  const edge = `logo-edge-${uid}`;

  return (
    <span className="app-logo" aria-hidden="true">
      <svg viewBox="0 0 64 64" role="img">
        <defs>
          <linearGradient id={bg} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#15151b" />
            <stop offset="55%" stopColor="#08080b" />
            <stop offset="100%" stopColor="#000000" />
          </linearGradient>
          <linearGradient id={edge} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.5" />
            <stop offset="16%" stopColor="#ffffff" stopOpacity="0.03" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0.04" />
          </linearGradient>
        </defs>
        <rect width="64" height="64" rx="15" fill={`url(#${bg})`} />
        <rect
          x="0.6"
          y="0.6"
          width="62.8"
          height="62.8"
          rx="14.4"
          fill="none"
          stroke={`url(#${edge})`}
          strokeWidth="1"
        />
        <g
          fill="none"
          stroke="#ffffff"
          strokeWidth="2.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M32 13.5 50.5 23.5 32 33.5 13.5 23.5Z" />
          <path d="M13.5 23.5V41L32 51V33.5" />
          <path d="M50.5 23.5V41L32 51" />
        </g>
      </svg>
    </span>
  );
}
