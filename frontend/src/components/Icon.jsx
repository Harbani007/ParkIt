// Small hand-drawn line icons (inline SVG, no icon library). Decorative: hidden from screen readers.
const PATHS = {
  car: (
    <>
      <path d="M5 16V11.5L7 6.5A2 2 0 0 1 8.9 5h6.2A2 2 0 0 1 17 6.5l2 5V16" />
      <path d="M3.5 16h17v2.5a1 1 0 0 1-1 1H18a1 1 0 0 1-1-1V17H7v1.5a1 1 0 0 1-1 1H4.5a1 1 0 0 1-1-1z" />
      <path d="M5 11.5h14" />
      <circle cx="7.5" cy="14" r="0.6" />
      <circle cx="16.5" cy="14" r="0.6" />
    </>
  ),
  bike: (
    <>
      <circle cx="6" cy="16" r="3.5" />
      <circle cx="18" cy="16" r="3.5" />
      <path d="M6 16l4-7h5l3 7M10 9 8.5 6H6.5M15 9l-1.5-3H16" />
    </>
  ),
  qr: (
    <>
      <rect x="3.5" y="3.5" width="6" height="6" rx="1" />
      <rect x="14.5" y="3.5" width="6" height="6" rx="1" />
      <rect x="3.5" y="14.5" width="6" height="6" rx="1" />
      <path d="M14.5 14.5h2.5v2.5M20.5 14.5v6h-3M14.5 20.5v-2" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 5 6v5.5c0 4.2 3 7.8 7 9.5 4-1.7 7-5.3 7-9.5V6z" />
      <path d="m8.8 12.2 2.2 2.2 4.4-4.6" />
    </>
  ),
  cloud: (
    <path d="M7 18.5h10.5a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.6 9.6 4.5 4.5 0 0 0 7 18.5z" />
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  rupee: (
    <path d="M7 5h10M7 9h10M9.5 5c3.5 0 5 1.6 5 4s-1.5 4-5 4H7l7.5 6" />
  ),
  chart: (
    <>
      <path d="M4 20h16" />
      <rect x="5.5" y="12" width="3" height="6" rx="0.8" />
      <rect x="10.5" y="7" width="3" height="11" rx="0.8" />
      <rect x="15.5" y="10" width="3" height="8" rx="0.8" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  calendar: (
    <>
      <rect x="4" y="5.5" width="16" height="14" rx="2" />
      <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
    </>
  ),
  mail: (
    <>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
      <path d="m4.5 7 7.5 6 7.5-6" />
    </>
  ),
  gate: (
    <>
      <path d="M4 20V9M4 9h16v3H4" />
      <path d="M7 9l2 3M11 9l2 3M15 9l2 3" />
    </>
  ),
  cross: <path d="M7 7l10 10M17 7 7 17" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.3" />
    </>
  ),
  home: (
    <>
      <path d="M4 11.5 12 5l8 6.5" />
      <path d="M6.5 10v9.5h11V10" />
      <path d="M10 19.5v-5h4v5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
};

export default function Icon({ name, size = 20, className = '' }) {
  return (
    <svg
      className={`icon ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

// Brand mark: a "P" parking sign with an emerald dot.
export function BrandMark({ size = 30 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false" className="brand-mark">
      <rect width="32" height="32" rx="9" fill="#172554" />
      <path d="M11 24V8h6.2a5.4 5.4 0 0 1 0 10.8H14.4V24z M14.4 11v4.8h2.6a2.4 2.4 0 0 0 0-4.8z" fill="#fff" fillRule="evenodd" />
      <circle cx="25" cy="25" r="3.2" fill="#10B981" stroke="#172554" strokeWidth="1.6" />
    </svg>
  );
}
