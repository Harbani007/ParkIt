import StatusBadge from './StatusBadge.jsx';
import { formatINR } from '../lib/money.js';
import { formatTimeRange } from '../lib/time.js';

const dd = { margin: 0 };

// Card for one API Booking. `showCustomer` adds name/phone (admin bookings carry `customer`).
// `children` render in an action row at the bottom (links, buttons).
export default function BookingSummary({ booking, showCustomer = false, children }) {
  if (!booking) return null;
  const { booking_code: code, slot, vehicle_number: vehicle, starts_at: start, ends_at: end, hours, amount, customer } = booking;
  return (
    <article className="card stack" aria-label={`Booking ${code}`}>
      <div className="row row-between">
        <span className="code">{code}</span>
        <StatusBadge booking={booking} />
      </div>
      <dl className="stack" style={{ margin: 0, gap: 'var(--space-2)' }}>
        {showCustomer && customer ? (
          <div>
            <dt className="muted">Customer</dt>
            <dd style={dd}>{customer.name}{customer.phone ? ` · ${customer.phone}` : ''}</dd>
          </div>
        ) : null}
        <div><dt className="muted">When</dt><dd style={dd}>{formatTimeRange(start, end)}</dd></div>
        <div><dt className="muted">Slot</dt><dd style={dd}>{slot ? `${slot.code} (${slot.vehicle_type})` : '—'}</dd></div>
        <div><dt className="muted">Vehicle</dt><dd style={dd}>{vehicle}</dd></div>
        <div><dt className="muted">Duration</dt><dd style={dd}>{hours} {hours === 1 ? 'hour' : 'hours'}</dd></div>
        <div><dt className="muted">Amount</dt><dd style={dd}><strong>{formatINR(amount)}</strong></dd></div>
      </dl>
      {children ? <div className="row no-print">{children}</div> : null}
    </article>
  );
}
