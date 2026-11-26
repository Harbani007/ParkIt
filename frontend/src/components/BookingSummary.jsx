import StatusBadge from './StatusBadge.jsx';
import { formatINR } from '../lib/money.js';
import { formatTimeRange } from '../lib/time.js';

// Card for one API Booking. `showCustomer` adds name/email/phone when the booking carries `customer`
// (the API includes it for admin viewers). `children` render in an action row at the bottom.
export default function BookingSummary({ booking, showCustomer = false, children }) {
  if (!booking) return null;
  const { booking_code: code, slot, vehicle_number: vehicle, starts_at: start, ends_at: end, hours, amount, customer } = booking;
  return (
    <article className="card stack" aria-label={`Booking ${code}`}>
      <div className="row row-between">
        <span className="code">{code}</span>
        <StatusBadge booking={booking} />
      </div>
      <dl className="dl dl-tight">
        {showCustomer && customer ? (
          <div>
            <dt>Customer</dt>
            <dd>
              {customer.name}
              {customer.phone ? ` · ${customer.phone}` : ''}
              {customer.email ? <><br /><span className="muted">{customer.email}</span></> : null}
            </dd>
          </div>
        ) : null}
        <div><dt>When</dt><dd>{formatTimeRange(start, end)}</dd></div>
        <div><dt>Slot</dt><dd>{slot ? `${slot.code} (${slot.vehicle_type})` : '—'}</dd></div>
        <div><dt>Vehicle</dt><dd>{vehicle}</dd></div>
        <div><dt>Duration</dt><dd>{hours} {hours === 1 ? 'hour' : 'hours'}</dd></div>
        <div><dt>Amount</dt><dd><strong>{formatINR(amount)}</strong></dd></div>
      </dl>
      {children ? <div className="row no-print">{children}</div> : null}
    </article>
  );
}
