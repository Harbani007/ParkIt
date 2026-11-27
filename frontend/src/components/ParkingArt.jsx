// Hero illustration: a top-down parking lot with a car pulling into a free bay and a QR ticket.
// Plain inline SVG, decorative only.
const BAY_X = [40, 128, 216, 304, 392];

function Car({ x, y, body, glass = '#cbd5e1' }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x="0" y="0" width="52" height="92" rx="14" fill={body} />
      <rect x="7" y="16" width="38" height="18" rx="6" fill={glass} opacity="0.9" />
      <rect x="7" y="60" width="38" height="14" rx="5" fill={glass} opacity="0.7" />
      <rect x="4" y="3" width="10" height="5" rx="2" fill="#fde68a" />
      <rect x="38" y="3" width="10" height="5" rx="2" fill="#fde68a" />
    </g>
  );
}

export default function ParkingArt() {
  return (
    <svg className="hero-art" viewBox="0 0 480 380" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="asphalt" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1e293b" />
          <stop offset="1" stopColor="#0f172a" />
        </linearGradient>
        <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#34d399" stopOpacity="0.55" />
          <stop offset="1" stopColor="#34d399" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Lot */}
      <rect x="10" y="20" width="460" height="300" rx="28" fill="url(#asphalt)" />
      <rect x="10" y="20" width="460" height="300" rx="28" fill="none" stroke="rgba(255,255,255,0.08)" />
      {/* Bay lines */}
      {BAY_X.map((x) => (
        <line key={x} x1={x} y1="44" x2={x} y2="176" stroke="#fbbf24" strokeWidth="4" strokeLinecap="round" opacity="0.9" />
      ))}
      <line x1="40" y1="176" x2="392" y2="176" stroke="#fbbf24" strokeWidth="2" strokeDasharray="10 10" opacity="0.5" />
      {/* Driving lane arrows */}
      <path d="M70 250h300" stroke="rgba(255,255,255,0.25)" strokeWidth="4" strokeDasharray="18 14" strokeLinecap="round" />
      <path d="M380 240l16 10-16 10" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />

      {/* Parked cars */}
      <Car x={58} y={64} body="#3b82f6" />
      <Car x={146} y={64} body="#e2e8f0" glass="#94a3b8" />
      <Car x={322} y={64} body="#f43f5e" />

      {/* Free bay with glow and a car pulling in */}
      <ellipse cx="260" cy="112" rx="70" ry="70" fill="url(#glow)" />
      <rect x="226" y="52" width="68" height="116" rx="10" fill="none" stroke="#34d399" strokeWidth="2.5" strokeDasharray="7 6" />
      <g className="car-in">
        <Car x={234} y={64} body="#10b981" glass="#a7f3d0" />
      </g>
      <g transform="translate(244 192)">
        <rect x="0" y="0" width="32" height="32" rx="9" fill="#10b981" />
        <path d="M11 24V8h6a5 5 0 0 1 0 10h-3v6z M14 11v4.5h3a2.25 2.25 0 0 0 0-4.5z" fill="#052e1f" fillRule="evenodd" />
      </g>

      {/* Floating QR ticket */}
      <g className="float">
        <g transform="translate(300 214) rotate(-6)">
          <rect x="0" y="0" width="150" height="128" rx="16" fill="#fff" />
          <rect x="0" y="0" width="150" height="34" rx="16" fill="#172554" />
          <rect x="0" y="18" width="150" height="16" fill="#172554" />
          <circle cx="18" cy="17" r="5" fill="#34d399" />
          <rect x="30" y="12" width="64" height="10" rx="5" fill="rgba(255,255,255,0.85)" />
          {/* QR */}
          <g transform="translate(14 46)">
            <rect width="66" height="66" rx="6" fill="#f1f5f9" />
            <rect x="6" y="6" width="18" height="18" rx="3" fill="#0f172a" />
            <rect x="42" y="6" width="18" height="18" rx="3" fill="#0f172a" />
            <rect x="6" y="42" width="18" height="18" rx="3" fill="#0f172a" />
            <rect x="11" y="11" width="8" height="8" rx="1.5" fill="#f1f5f9" />
            <rect x="47" y="11" width="8" height="8" rx="1.5" fill="#f1f5f9" />
            <rect x="11" y="47" width="8" height="8" rx="1.5" fill="#f1f5f9" />
            <rect x="30" y="30" width="7" height="7" fill="#0f172a" />
            <rect x="42" y="42" width="7" height="7" fill="#0f172a" />
            <rect x="52" y="34" width="7" height="7" fill="#0f172a" />
            <rect x="30" y="50" width="7" height="7" fill="#0f172a" />
            <rect x="52" y="52" width="7" height="7" fill="#10b981" />
          </g>
          <rect x="90" y="52" width="46" height="8" rx="4" fill="#cbd5e1" />
          <rect x="90" y="68" width="34" height="8" rx="4" fill="#e2e8f0" />
          <rect x="90" y="92" width="46" height="18" rx="9" fill="#d1fae5" />
          <path d="M100 101l4 4 8-8" fill="none" stroke="#047857" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </g>
    </svg>
  );
}
