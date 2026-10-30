import { useId } from "react";

export default function AppLogo() {
  const gradientId = useId().replace(/:/g, "");
  return (
    <span className="app-logo" aria-hidden="true">
      <svg viewBox="0 0 64 64" role="img">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#2563eb" />
            <stop offset="55%" stopColor="#7c3aed" />
            <stop offset="100%" stopColor="#a855f7" />
          </linearGradient>
        </defs>
        <rect width="64" height="64" rx="15" fill={`url(#${gradientId})`} />
        <path
          d="M19 23.5 31 32 19 40.5"
          fill="none"
          stroke="#fff"
          strokeWidth="4.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M36 41h10"
          fill="none"
          stroke="#fff"
          strokeWidth="4.5"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}
