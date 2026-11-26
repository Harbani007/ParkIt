import { statusLabel, statusTone } from '../lib/status.js';

// Pass `booking` ({ status, overstayed }) or `status` (+ `overstayed`).
export default function StatusBadge({ booking, status, overstayed }) {
  const s = status ?? booking?.status;
  const over = overstayed ?? booking?.overstayed ?? false;
  return (
    <span className="row" style={{ display: 'inline-flex', gap: 'var(--space-2)' }}>
      <span className={`badge badge-${statusTone(s)}`}>{statusLabel(s)}</span>
      {over ? <span className="badge badge-warning">Overstayed</span> : null}
    </span>
  );
}
